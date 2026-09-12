// Stress: does "how to play roblox" EVER veer into interview/dev garbage?
// Also probes temp 1.2 (top of old UI slider) as a possible trigger.
// Fresh pipeline per call is impossible (one pipe), but each call is an
// independent generate() just like the app does — no shared prompt state.
import { pipeline } from "@huggingface/transformers";
import { SYSTEM_PROMPT, normalizeHistory } from "../ai/generationConfig.ts";

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const SUSPECT = /9KB100|design principles|software development|requirements|deployment/i;
const ECHO = /tell them|do not write in english|prefer to be asked/i;
const ROLE_LEAK = /<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|(^|\n)\s*(user|assistant|system|developer)\s*:/i;

const pipe = await pipeline("text-generation", MODEL_ID, { dtype: "q4", device: "cpu" });
const tok = pipe.tokenizer;
let eosOpt = {};
try {
  const e = tok.eos_token_id;
  if (Array.isArray(e) ? e.length : Number.isInteger(e)) eosOpt = { eos_token_id: e };
} catch { /* ignore */ }

async function gen(turns, temperature) {
  const prompt = tok.apply_chat_template(
    [{ role: "system", content: SYSTEM_PROMPT }, ...normalizeHistory(turns)],
    { tokenize: false, add_generation_prompt: true }
  );
  const out = await pipe(prompt, {
    max_new_tokens: 120, temperature, top_p: 0.9, repetition_penalty: 1.1,
    do_sample: temperature > 0.05, return_full_text: false, ...eosOpt,
  });
  return String(out[out.length - 1]?.generated_text ?? "").trim();
}

let suspectHits = 0, echoHits = 0;
for (let i = 1; i <= 10; i++) {
  const t = await gen([{ role: "user", content: "how to play roblox" }], 0.5);
  const s = SUSPECT.test(t), e = ECHO.test(t) || ROLE_LEAK.test(t);
  if (s) suspectHits++;
  if (e) echoHits++;
  console.log(`[roblox-0.5 #${i}] suspect=${s} echo/leak=${e} len=${t.length}`);
  console.log(`   ${JSON.stringify(t.slice(0, 130))}`);
}
for (let i = 1; i <= 3; i++) {
  const t = await gen([{ role: "user", content: "how to play roblox" }], 1.2);
  const s = SUSPECT.test(t);
  if (s) suspectHits++;
  console.log(`[roblox-1.2 #${i}] suspect=${s} len=${t.length}`);
  console.log(`   ${JSON.stringify(t.slice(0, 130))}`);
}
// with-history variant, exact browser shape
const a1 = await gen([{ role: "user", content: "hello" }], 0.5);
const a2 = await gen([
  { role: "user", content: "hello" },
  { role: "assistant", content: a1 },
  { role: "user", content: "how to play roblox" },
], 0.5);
console.log(`[seq] suspect=${SUSPECT.test(a2)} len=${a2.length}`);
console.log(`   ${JSON.stringify(a2.slice(0, 130))}`);
console.log(`\nSUSPECT HITS: ${suspectHits} | ECHO/LEAK HITS: ${echoHits}`);
process.exit(0);
