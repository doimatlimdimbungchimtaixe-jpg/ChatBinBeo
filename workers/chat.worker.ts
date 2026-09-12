/// <reference lib="webworker" />
// ChatBinBeo REAL inference worker.
//   UI messages -> normalize -> Qwen2.5 chat template -> tokenizer -> token IDs
//   -> ONNX forward (Qwen2.5-0.5B-Instruct q4, WebGPU->WASM) -> logits
//   -> sample (temp/top_p/rep-penalty) autoregressively -> TextStreamer -> UI.
// No keyword matching, no replies list, no fake typing.

import {
  MODEL_ID,
  DTYPE,
  CONTEXT_USED,
  VOCAB_DOC,
  SYSTEM_PROMPT,
  GENERATION_DEFAULTS,
  DEGENERATE_CHUNK_STREAK,
  RUNAWAY_CHARS,
  normalizeHistory,
  cleanGeneratedText,
} from "../ai/generationConfig";

const CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.0";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let HF: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipe: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tok: any = null;
let stopped = false;
let ready = false;
let deviceUsed = "wasm";
// Latest streamed text of the in-flight generation (for degenerate-abort diagnostics).
let activeTail = "";
// Token IDs read from the REAL tokenizer at load — never guessed.
let EOS_IDS: number[] | number | undefined;
let BOS_ID: number | null = null;
let PAD_ID: number | null = null;
const intOrNull = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);
let loadMetrics: Record<string, number | boolean | string> | null = null;

function buildPrompt(messages: { role: string; content: string }[]): string {
  const turns = normalizeHistory(messages);
  try {
    if (tok?.apply_chat_template) {
      // Qwen2.5-Instruct's own chat template (roles system/user/assistant, ChatML).
      return tok.apply_chat_template([{ role: "system", content: SYSTEM_PROMPT }, ...turns], {
        tokenize: false,
        add_generation_prompt: true,
      });
    }
  } catch { /* fallback below */ }
  let p = `<|im_start|>system\n${SYSTEM_PROMPT}<|im_end|>\n`;
  for (const t of turns) p += `<|im_start|>${t.role}\n${t.content}<|im_end|>\n`;
  p += `<|im_start|>assistant\n`;
  return p;
}

function post(m: unknown) {
  (self as unknown as { postMessage: (m: unknown) => void }).postMessage(m);
}

async function loadAll() {
  const tImport0 = Date.now();
  post({ type: "phase", phase: "runtime-loading" });
  console.debug("[ChatBinBeo] worker: loading runtime");
  if (!HF) {
    // webpackIgnore: fetch ESM runtime from CDN at runtime, don't bundle ONNX into Next build.
    HF = await import(/* webpackIgnore: true */ CDN);
  }
  try {
    HF.env.useBrowserCache = true;
  } catch { /* ignore */ }
  const runtimeImportMs = Date.now() - tImport0;

  const useGpu = !!(globalThis as { navigator?: { gpu?: unknown } }).navigator?.gpu;
  const order = useGpu ? ["webgpu", "wasm"] : ["wasm"];
  const tPipe0 = Date.now();
  let firstProgressAt = 0;
  let lastProgressAt = 0;
  let sawDownload = false;
  // Real byte counts straight from the runtime's progress events (per shard).
  const fileTotals = new Map<string, number>();
  const fileLoaded = new Map<string, number>();
  let lastErr: unknown = null;
  for (const dev of order) {
    try {
      post({ type: "phase", phase: "downloading" });
      pipe = await HF.pipeline("text-generation", MODEL_ID, {
        dtype: DTYPE,
        device: dev,
        progress_callback: (p: { status?: string; progress?: number; file?: string; loaded?: number; total?: number }) => {
          const now = Date.now();
          if (typeof p?.total === "number" && p.total > 0 && p.file) fileTotals.set(p.file, p.total);
          if (typeof p?.loaded === "number" && p.file) fileLoaded.set(p.file, Math.max(fileLoaded.get(p.file) ?? 0, p.loaded));
          if (p?.status === "progress" && typeof p?.progress === "number") {
            if (!firstProgressAt) firstProgressAt = now;
            lastProgressAt = now;
            // progress events with byte totals only happen while actually downloading
            sawDownload = true;
            post({ type: "progress", progress: p.progress, file: (p as { file?: string }).file ?? null });
          } else if (p?.status === "done") {
            post({ type: "progress", progress: 1, file: (p as { file?: string }).file ?? null });
          }
        },
      });
      deviceUsed = dev;
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr || !pipe) throw lastErr instanceof Error ? lastErr : new Error("Không tải được model weights.");
  const initMs = Date.now() - tPipe0;
  // download time = span with real byte-progress; 0 when fully served from cache
  const downloadMs = sawDownload && firstProgressAt && lastProgressAt ? Math.max(1, lastProgressAt - firstProgressAt) : 0;
  let modelSizeBytes = 0;
  for (const v of fileTotals.values()) modelSizeBytes += v;
  let downloadedBytes = 0;
  for (const v of fileLoaded.values()) downloadedBytes += v;
  if (downloadedBytes === 0) downloadedBytes = modelSizeBytes;
  tok = pipe.tokenizer;
  // Resolve special token IDs from the actual Qwen2.5 tokenizer (not hardcoded guesses).
  try {
    const e = tok?.eos_token_id;
    EOS_IDS = Array.isArray(e) ? e.filter(Number.isInteger) : intOrNull(e) ?? undefined;
    BOS_ID = intOrNull(tok?.bos_token_id);
    PAD_ID = intOrNull(tok?.pad_token_id);
  } catch { /* diagnostics fall back below */ }
  ready = true;
  console.debug("[ChatBinBeo] worker: model ready", deviceUsed);
  loadMetrics = {
    runtimeImportMs,
    initMs,
    downloadMs,
    cached: !sawDownload,
    modelSizeBytes,
    downloadedBytes,
    downloadMBps: downloadMs > 0 && downloadedBytes > 0 ? downloadedBytes / (downloadMs / 1000) / 1048576 : 0,
    device: deviceUsed,
    dtype: DTYPE,
  };
  post({ type: "phase", phase: "ready" });
  // Single 1-token warm-up in background (compiles kernels so first real answer is faster).
  // Non-blocking: UI is already usable; metrics update when done.
  void (async () => {
    const tW = Date.now();
    try {
      await pipe("Hi", { max_new_tokens: 1, do_sample: false, return_full_text: false });
      loadMetrics = { ...loadMetrics, warmupMs: Date.now() - tW };
      post({ type: "warmup-done", warmupMs: Date.now() - tW });
    } catch { /* warm-up is best-effort */ }
  })();
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as {
    type: string;
    id?: string;
    messages?: { role: string; content: string }[];
    options?: { maxTokens?: number; temperature?: number; topP?: number; repetitionPenalty?: number };
  };
  try {
    if (msg.type === "load") {
      if (!ready) await loadAll();
      let vocabSize = VOCAB_DOC;
      try {
        const v = tok?.get_vocab?.();
        if (v && typeof v === "object" && Object.keys(v).length > 0) vocabSize = Object.keys(v).length;
        else if (typeof tok?.vocab_size === "number" && tok.vocab_size > 0) vocabSize = tok.vocab_size;
      } catch { /* keep doc value */ }
      post({ type: "ready", model: MODEL_ID, params: "~494M", vocabSize, contextLength: CONTEXT_USED, device: deviceUsed, dtype: DTYPE, loadMetrics, eosId: EOS_IDS ?? null, bosId: BOS_ID, padId: PAD_ID });
      return;
    }
    if (msg.type === "stop") {
      stopped = true;
      return;
    }
    if (msg.type === "generate") {
      if (!ready || !pipe || !tok) await loadAll();
      stopped = false;
      const id = msg.id!;
      const prompt = buildPrompt(msg.messages ?? []);
      try {
        const roles = (msg.messages ?? []).map((m) => m.role).join(",");
        console.debug("[ChatBinBeo] worker: context", `messages=${(msg.messages ?? []).length} roles=[${roles}]`);
      } catch { /* ignore */ }
      activeTail = "";
      let inputTokens = 0;
      try {
        inputTokens = tok.encode(prompt)?.length ?? 0;
      } catch {
        inputTokens = Math.ceil(prompt.length / 4);
      }
      const maxTokens = Math.min(
        Math.max(msg.options?.maxTokens ?? GENERATION_DEFAULTS.maxTokens, 8),
        GENERATION_DEFAULTS.maxTokensCap
      );
      const temperature = msg.options?.temperature ?? GENERATION_DEFAULTS.temperature;
      console.debug("[ChatBinBeo] worker: formatted prompt", `${prompt.length} chars`, JSON.stringify(prompt.slice(0, 160)));
      console.debug("[ChatBinBeo] worker: inference started", `inputTokens=${inputTokens}`);
      let full = "";
      let firstTokenMs: number | null = null;
      let degenerate = false;
      const t0 = Date.now();
      post({ type: "generating", id });
      // NOTE: callback chunks are per-token deltas from the sampler — each token
      // is generated exactly once and appended once. No re-decoding of old tokens.
      let lastChunk = "";
      let streak = 0;
      const streamer = new HF.TextStreamer(tok, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text: string) => {
          if (stopped) return;
          if (firstTokenMs === null) firstTokenMs = Date.now() - t0;
          // Runaway guard: an identical chunk streak means the sampler collapsed
          // into a token loop. Abort the INFERENCE LOOP itself (throw unwinds
          // pipe()), then report an error — never a fabricated answer.
          if (text.length > 0 && text === lastChunk) streak += 1;
          else {
            lastChunk = text;
            streak = 1;
          }
          full += text;
          activeTail += text;
          if (streak >= DEGENERATE_CHUNK_STREAK || full.length > RUNAWAY_CHARS) {
            stopped = true;
            degenerate = true;
            throw new Error("__CHATBINBEO_DEGENERATE__");
          }
          post({ type: "token", id, partial: cleanGeneratedText(full) });
        },
      });
      const genOpts: Record<string, unknown> = {
        max_new_tokens: maxTokens,
        temperature,
        top_p: msg.options?.topP ?? GENERATION_DEFAULTS.topP,
        repetition_penalty: msg.options?.repetitionPenalty ?? GENERATION_DEFAULTS.repetitionPenalty,
        do_sample: temperature > 0.05,
        return_full_text: false,
        streamer,
      };
      // Explicit stop tokens from the real tokenizer — generation must end on EOS.
      if (EOS_IDS !== undefined) genOpts.eos_token_id = EOS_IDS;
      const out = (await pipe(prompt, genOpts)) as { generated_text?: string }[];
      if (stopped) {
        post({ type: "done", id, full: cleanGeneratedText(full), stats: null, stopped: true });
        return;
      }
      try {
        if (Array.isArray(out) && typeof out[out.length - 1]?.generated_text === "string") {
          const t = cleanGeneratedText(out[out.length - 1].generated_text as string);
          if (t.length >= cleanGeneratedText(full).length) full = t;
        }
      } catch { /* keep streamed */ }
      full = cleanGeneratedText(full);
      let generatedTokens = 0;
      try {
        generatedTokens = tok.encode(full)?.length ?? 0;
      } catch {
        generatedTokens = Math.ceil(full.length / 4);
      }
      const dtMs = Math.max(1, Date.now() - t0);
      // Stop reason is inferred from real runtime state (no fabricated certainty).
      const stopReason = stopped ? "stop" : generatedTokens >= maxTokens - 2 ? "max_tokens" : "eos";
      post({
        type: "done",
        id,
        full,
        stats: {
          inputTokens,
          generatedTokens,
          generationTimeMs: dtMs,
          firstTokenMs: firstTokenMs ?? dtMs,
          tokensPerSec: generatedTokens / (dtMs / 1000),
          stopReason,
          model: MODEL_ID,
          params: "~494M (Qwen2.5-0.5B-Instruct)",
          tokenizer: `Qwen2 BPE, vocab ${VOCAB_DOC}`,
          contextLength: CONTEXT_USED,
          device: deviceUsed,
          dtype: DTYPE,
        },
      });
      return;
    }
  } catch (e) {
    // Degenerate-loop abort: report it plainly with the tail token IDs for
    // debugging. The user can retry; nothing fake is returned.
    if (e instanceof Error && e.message === "__CHATBINBEO_DEGENERATE__") {
      let tailIds: number[] = [];
      try {
        const enc: unknown = tok.encode(activeTail);
        if (Array.isArray(enc)) tailIds = (enc as number[]).slice(-16);
      } catch { /* ignore */ }
      console.error("[ChatBinBeo] worker: Repetition detected, generation aborted. tailTokenIds=", tailIds);
      post({ type: "error", id: (msg as { id?: string }).id, message: "Generation stopped because repetitive output was detected." });
      return;
    }
    // A stop between pipe() start and finish is user intent, not a failure.
    if (stopped) {
      post({ type: "done", id: (msg as { id?: string }).id, full: "", stats: null, stopped: true });
      return;
    }
    console.error("[ChatBinBeo] worker error", e instanceof Error ? e.message : e);
    post({ type: "error", id: (msg as { id?: string }).id, message: e instanceof Error ? e.message : "worker error" });
  }
};

export {};
