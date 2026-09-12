// TRACE script — reproduces the EXACT reported scenario with full pipeline logging.
// No UI, no storage: pure prompt -> tokens -> model -> text.
import { pipeline } from "@huggingface/transformers";
import { SYSTEM_PROMPT, GENERATION_DEFAULTS, normalizeHistory } from "../ai/generationConfig.ts";

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const SUSPECT = /9KB100|design principles|deployment|requirements/i;

const pipe = await pipeline("text-generation", MODEL_ID, { dtype: "q4", device: "cpu" });
const tok = pipe.tokenizer;
let eosOpt = {};
try {
  const e = tok.eos_token_id;
  if (Array.isArray(e) ? e.length : Number.isInteger(e)) eosOpt = { eos_token_id: e };
} catch { /* ignore */ }

async function tracedGen(label, turns) {
  console.log(`\n===== ${label} =====`);
  const norm = normalizeHistory(turns);
  console.log("Messages (post-normalize):");
  norm.forEach((m, i) => console.log(`[${i}] role=${m.role} content=${JSON.stringify(m.content.slice(0, 120))}`));
  const prompt = tok.apply_chat_template(
    [{ role: "system", content: SYSTEM_PROMPT }, ...norm],
    { tokenize: false, add_generation_prompt: true }
  );
  console.log("--- Formatted prompt ---");
  console.log(prompt);
  console.log("--- end prompt ---");
  const ids = tok.encode(prompt);
  console.log(`Input token count: ${ids.length}`);
  console.log(`First 20 IDs: [${ids.slice(0, 20).join(", ")}]`);
  const roundtrip = tok.decode(ids, { skip_special_tokens: false });
  console.log("Decode roundtrip contains suspect text:", SUSPECT.test(roundtrip));
  const out = await pipe(prompt, {
    max_new_tokens: 120,
    temperature: GENERATION_DEFAULTS.temperature,
    top_p: GENERATION_DEFAULTS.topP,
    repetition_penalty: GENERATION_DEFAULTS.repetitionPenalty,
    do_sample: true,
    return_full_text: false,
    ...eosOpt,
  });
  const text = String(out[out.length - 1]?.generated_text ?? "").trim();
  console.log("--- Model output ---");
  console.log(text);
  console.log("--- end output ---");
  console.log("Output contains suspect text:", SUSPECT.test(text));
  return text;
}

// §3: empty conversation, Roblox only
const fresh = await tracedGen("FRESH roblox (no history)", [
  { role: "user", content: "How to play Roblox?" },
]);

// §5: exact reported sequence hello -> roblox
const a1 = await tracedGen("SEQ msg1: hello", [{ role: "user", content: "hello" }]);
const a2 = await tracedGen("SEQ msg2: how to play roblox (with history)", [
  { role: "user", content: "hello" },
  { role: "assistant", content: a1 },
  { role: "user", content: "how to play roblox" },
]);

// §20: spec questions back-to-back
for (const q of ["Hello", "What is 2 + 2?", "What is gravity?", "How do I play Roblox?", "Who created you?"]) {
  await tracedGen(`SPEC: ${q}`, [{ role: "user", content: q }]);
}
console.log("\nTRACE DONE.");
process.exit(0);
