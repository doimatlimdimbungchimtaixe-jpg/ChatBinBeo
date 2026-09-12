import type { ChatModel, ChatModelInfo } from "./ChatModel";
import type { GenerationOptions, Message } from "@/types";
import {
  MODEL_ID,
  MODEL_REVISION,
  DTYPE,
  CONTEXT_USED,
  SYSTEM_PROMPT,
  GENERATION_DEFAULTS,
  normalizeHistory,
  cleanGeneratedText,
} from "@/ai/generationConfig";

// Re-export shared constants under legacy names.
export const QWEN_MODEL_ID = MODEL_ID;
export const QWEN_DTYPE = DTYPE;
export const QWEN_CONTEXT_USED = CONTEXT_USED;

export interface GenerationStats {
  inputTokens: number;
  generatedTokens: number;
  generationTimeMs: number;
  firstTokenMs?: number;
  tokensPerSec: number;
  stopReason?: string;
  model: string;
  params: string;
  tokenizer: string;
  contextLength: number;
  device: string;
}

export class QwenChatModel implements ChatModel {
  readonly info: ChatModelInfo = {
    name: MODEL_ID,
    params: "~494M (Qwen2.5-0.5B-Instruct, 24 layers, hidden 896, GQA, SwiGLU)",
    vocabSize: 151936,
    contextWindow: CONTEXT_USED,
    location: "browser Web Worker (ONNX Runtime WASM/WebGPU), weights cached from HuggingFace Hub",
    usesExternalApi: false,
  };
  loaded = false;
  lastStats: GenerationStats | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tok: any = null;
  private stopped = false;
  private device: string = "wasm";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private eosIds: any = undefined;

  async load(onProgress?: (p: number) => void): Promise<void> {
    if (this.loaded) return;
    const { pipeline } = await import("@huggingface/transformers");
    try {
      const { env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      env.useBrowserCache = true;
    } catch { /* ignore */ }
    const useGpu = typeof navigator !== "undefined" && !!(navigator as Navigator & { gpu?: unknown }).gpu;
    this.device = useGpu ? "webgpu" : "wasm";
    try {
      this.pipe = await pipeline("text-generation", MODEL_ID, {
        dtype: DTYPE,
        revision: MODEL_REVISION,
        device: useGpu ? "webgpu" : "wasm",
        progress_callback: (p: { progress?: number }) => {
          if (typeof p?.progress === "number") onProgress?.(p.progress);
        },
      } as never);
    } catch {
      this.device = "wasm";
      this.pipe = await pipeline("text-generation", MODEL_ID, {
        dtype: DTYPE,
        revision: MODEL_REVISION,
        device: "wasm",
        progress_callback: (p: { progress?: number }) => {
          if (typeof p?.progress === "number") onProgress?.(p.progress);
        },
      } as never);
    }
    this.tok = this.pipe.tokenizer;
    try {
      const e = this.tok?.eos_token_id;
      this.eosIds = Array.isArray(e) ? e.filter(Number.isInteger) : Number.isInteger(e) ? e : undefined;
    } catch { /* eos stays undefined */ }
    try {
      const vocab = this.tok?.get_vocab?.();
      const size = typeof vocab === "object" && vocab !== null ? Object.keys(vocab).length : this.tok?.vocab_size;
      if (typeof size === "number" && size > 0) (this.info as { vocabSize: number }).vocabSize = size;
    } catch { /* keep documented 151936 */ }
    this.loaded = true;
  }

  stop(): void {
    this.stopped = true;
  }

  private buildPrompt(messages: Message[]): string {
    const turns = normalizeHistory(messages.map((m) => ({ role: m.role, content: m.content })));
    try {
      if (this.tok?.apply_chat_template) {
        return this.tok.apply_chat_template(
          [{ role: "system", content: SYSTEM_PROMPT }, ...turns],
          { tokenize: false, add_generation_prompt: true }
        ) as string;
      }
    } catch { /* fall through */ }
    let p = `<|im_start|>system\n${SYSTEM_PROMPT}<|im_end|>\n`;
    for (const t of turns) p += `<|im_start|>${t.role}\n${t.content}<|im_end|>\n`;
    p += `<|im_start|>assistant\n`;
    return p;
  }

  async generate(messages: Message[], options?: GenerationOptions): Promise<string> {
    let out = "";
    for await (const part of this.stream(messages, options)) out = part;
    return out;
  }

  async *stream(messages: Message[], options?: GenerationOptions): AsyncIterable<string> {
    if (!this.loaded || !this.pipe) throw new Error("Model chưa load. Đợi model tải xong rồi thử lại.");
    this.stopped = false;
    const maxTokens = Math.min(
      Math.max(options?.maxTokens ?? GENERATION_DEFAULTS.maxTokens, 8),
      GENERATION_DEFAULTS.maxTokensCap
    );
    const temperature = options?.temperature ?? GENERATION_DEFAULTS.temperature;
    const prompt = this.buildPrompt(messages);

    let inputTokens = 0;
    try {
      const enc = this.tok?.encode?.(prompt);
      inputTokens = Array.isArray(enc) ? enc.length : this.pipe.tokenizer?.encode?.(prompt)?.length ?? 0;
    } catch {
      inputTokens = Math.ceil(prompt.length / 4);
    }

    const { TextStreamer } = await import("@huggingface/transformers");
    let full = "";
    let firstTokenMs: number | null = null;
    const t0 = Date.now();
    const streamer = new TextStreamer(this.tok, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        if (firstTokenMs === null) firstTokenMs = Date.now() - t0;
        full += text;
        options?.onToken?.(cleanGeneratedText(full));
      },
    });

    let output: unknown = null;
    try {
      const genOpts: Record<string, unknown> = {
        max_new_tokens: maxTokens,
        temperature,
        top_p: GENERATION_DEFAULTS.topP,
        repetition_penalty: GENERATION_DEFAULTS.repetitionPenalty,
        do_sample: temperature > 0.05,
        return_full_text: false,
        streamer,
      };
      if (this.eosIds !== undefined) genOpts.eos_token_id = this.eosIds;
      output = await this.pipe(prompt, genOpts);
    } catch (e) {
      if (this.stopped) return;
      throw e;
    }
    if (this.stopped || options?.signal?.aborted) return;

    try {
      const arr = output as { generated_text?: string }[];
      const text = Array.isArray(arr) && typeof arr[arr.length - 1]?.generated_text === "string"
        ? cleanGeneratedText(arr[arr.length - 1].generated_text as string)
        : cleanGeneratedText(full);
      full = text.trim();
    } catch {
      full = cleanGeneratedText(full);
    }

    const dtMs = Math.max(1, Date.now() - t0);
    let generatedTokens = 0;
    try {
      generatedTokens = this.tok?.encode?.(full)?.length ?? 0;
    } catch {
      generatedTokens = Math.ceil(full.length / 4);
    }
    this.lastStats = {
      inputTokens,
      generatedTokens,
      generationTimeMs: dtMs,
      firstTokenMs: firstTokenMs ?? dtMs,
      tokensPerSec: generatedTokens / (dtMs / 1000),
      stopReason: this.stopped ? "stop" : generatedTokens >= maxTokens - 2 ? "max_tokens" : "eos",
      model: MODEL_ID,
      params: this.info.params,
      tokenizer: `Qwen2 BPE, vocab ${this.info.vocabSize}`,
      contextLength: CONTEXT_USED,
      device: this.device,
    };
    options?.onToken?.(full);
    yield full;
  }
}
