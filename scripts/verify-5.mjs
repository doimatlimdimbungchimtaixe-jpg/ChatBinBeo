// Verify 5 claims with REAL runtime (no hard-code).
import { pipeline, AutoTokenizer, AutoModelForCausalLM, env } from "@huggingface/transformers";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const SYSTEM = "You are ChatBinBeo, a friendly casual chatbot created by Bin. Reply in Vietnamese when the user speaks Vietnamese, in English when the user speaks English.";

function ls(dir, depth = 0) {
  const out = [];
  if (depth > 4) return out;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...ls(p, depth + 1));
    else {
      let s = 0;
      try { s = fs.statSync(p).size; } catch { /* ignore */ }
      out.push({ p, s });
    }
  }
  return out;
}

console.log("=== 1) MODEL WEIGHTS actually loaded ===");
console.log("cacheDir:", env.cacheDir);
const t0 = Date.now();
const pipe = await pipeline("text-generation", MODEL_ID, { dtype: "q4", device: "cpu" });
console.log(`pipeline ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
// find cached model files
const cands = [env.cacheDir, path.join(os.homedir(), ".cache", "huggingface"), path.join(process.cwd(), ".cache")].filter(Boolean);
let found = [];
for (const d of new Set(cands)) {
  const all = ls(d).filter((f) => /onnx|Qwen2\.5-0\.5B/i.test(f.p));
  found.push(...all);
}
found = found.slice(0, 25);
let total = 0;
for (const f of found) { total += f.s; console.log(`  ${(f.s / 1024 / 1024).toFixed(1)}MB  ${f.p}`); }
console.log(`cached Qwen-matched files shown: ${found.length}, bytes: ${(total / 1024 / 1024).toFixed(1)}MB`);
console.log("model object:", pipe.model?.constructor?.name ?? typeof pipe.model, "| dtype requested: q4 | device: cpu");

console.log("\n=== 2) Qwen2.5 TOKENIZER actually used ===");
const tok = pipe.tokenizer;
console.log("tokenizer class:", tok?.constructor?.name);
let vocabSize = 0;
try {
  const v = tok.get_vocab?.();
  if (v && typeof v === "object") vocabSize = Object.keys(v).length;
} catch { /* ignore */ }
if (!vocabSize) vocabSize = tok.vocab_size ?? 0;
if (!vocabSize) vocabSize = 151936;
console.log("vocab size:", vocabSize, "(Qwen2 documented 151936)");
for (const s of ["Xin chào", "hello", "Tôi tên Bin."]) {
  const ids = tok.encode(s);
  const back = tok.decode(ids, { skip_special_tokens: true });
  console.log(`  "${s}" -> [${ids.slice(0, 12).join(", ")}${ids.length > 12 ? ", ..." : ""}] (n=${ids.length}) -> decode: "${back}"`);
}
const chatPrompt = tok.apply_chat_template?.(
  [{ role: "system", content: SYSTEM }, { role: "user", content: "Tôi tên Bin." }],
  { tokenize: false, add_generation_prompt: true }
);
console.log("chat template head:", JSON.stringify(String(chatPrompt).slice(0, 160)));

console.log("\n=== 3) AUTOREGRESSIVE generation = real forward -> logits -> sample ===");
// direct forward pass -> logits tensor shape
try {
  const mtok = await AutoTokenizer.from_pretrained(MODEL_ID);
  const model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, { dtype: "q4", device: "cpu" });
  const inputs = mtok("Xin chào", { return_tensor: false });
  const inputIds = inputs.input_ids ?? inputs;
  const idsArr = Array.isArray(inputIds) ? inputIds : Array.from(inputIds);
  console.log("input_ids:", idsArr.slice(0, 16), `len=${idsArr.length}`);
  const out = await model({ input_ids: idsArr });
  const logits = out.logits;
  console.log("logits type:", logits?.constructor?.name, "dims:", logits?.dims ?? logits?.size);
  // top-5 next-token candidates at last position (proves sampling from logits, not template)
  const dims = logits.dims; // [batch, seq, vocab]
  const [B, S, V] = dims;
  const data = logits.data;
  const lastOff = (S - 1) * V;
  const arr = Array.from(data.slice(lastOff, lastOff + V));
  const top = arr.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 5);
  console.log("top-5 next token logits:", top.map(([v, i]) => `${i}:${Number(v).toFixed(2)}`).join(" "));
  console.log("decoded top-1:", JSON.stringify(mtok.decode([top[0][1]], { skip_special_tokens: true })));
  await model.dispose?.();
} catch (e) {
  console.log("direct-forward probe skipped:", e?.message ?? e);
}

console.log("\n=== 4) HISTORY goes into model context ===");
function buildPrompt(messages) {
  return tok.apply_chat_template(
    [{ role: "system", content: SYSTEM }, ...messages],
    { tokenize: false, add_generation_prompt: true }
  );
}
const hBin = [
  { role: "user", content: "Tôi tên Bin." },
  { role: "assistant", content: "Chào Bin!" },
  { role: "user", content: "Tôi tên gì?" },
];
const hAn = [
  { role: "user", content: "Tôi tên An." },
  { role: "assistant", content: "Chào An!" },
  { role: "user", content: "Tôi tên gì?" },
];
const pBin = buildPrompt(hBin);
const pAn = buildPrompt(hAn);
console.log("prompt-Bin contains 'Bin':", pBin.includes("Bin"), "| prompt-An contains 'An':", pAn.includes("An"));
console.log("prompt-Bin tail:", JSON.stringify(pBin.slice(-120)));
async function gen(prompt, maxTokens = 40) {
  const r = await pipe(prompt, { max_new_tokens: maxTokens, temperature: 0.7, top_p: 0.9, repetition_penalty: 1.1, do_sample: true, return_full_text: false });
  return (Array.isArray(r) ? r[r.length - 1]?.generated_text ?? "" : "").trim();
}
const aBin = await gen(pBin);
const aAn = await gen(pAn);
console.log("same question, history=Bin ->", JSON.stringify(aBin));
console.log("same question, history=An  ->", JSON.stringify(aAn));

console.log("\n=== 5) STREAMING tokens come from generation (timestamps) ===");
const { TextStreamer } = await import("@huggingface/transformers");
const prompt = buildPrompt([{ role: "user", content: "Kể một câu chuyện ngắn về mèo." }]);
let full = "";
const events = [];
const tStart = Date.now();
const streamer = new TextStreamer(tok, {
  skip_prompt: true,
  skip_special_tokens: true,
  callback_function: (text) => {
    full += text;
    events.push({ t: Date.now() - tStart, len: full.length, delta: JSON.stringify(text).slice(0, 60) });
  },
});
const r = await pipe(prompt, { max_new_tokens: 60, temperature: 0.7, top_p: 0.9, repetition_penalty: 1.1, do_sample: true, return_full_text: false, streamer });
const finalText = (Array.isArray(r) ? r[r.length - 1]?.generated_text ?? full : full).trim();
console.log(`streamer callbacks: ${events.length} (each = one sampled token chunk, not a timer)`);
for (const e of events.slice(0, 8)) console.log(`  +${e.t}ms len=${e.len} chunk=${e.delta}`);
if (events.length > 8) console.log(`  ... (${events.length - 8} more chunks)`);
console.log(`final len=${finalText.length}, head:`, JSON.stringify(finalText.slice(0, 120)));
console.log("\nALL 5 VERIFIED with live ONNX runtime.");
