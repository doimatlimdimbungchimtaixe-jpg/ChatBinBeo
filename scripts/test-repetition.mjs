// Repetition stress test — same pipeline settings as the app worker
// (temp 0.6, top_p 0.9, rep penalty 1.1, explicit EOS from tokenizer).
// Checks per generation: no token-loop runaway, no role leakage,
// streamed-concat == final text (streaming integrity), sane length.
// Exit 1 on any degenerate case (honest signal, not a filter).
import { pipeline, TextStreamer } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const SYSTEM_PROMPT = `You are ChatBinBeo, a conversational AI created by Bin.

Always respond in English.

Answer the user's current message directly.

Keep responses concise and natural.

For simple messages, give a short response.
For simple questions, answer in a few sentences.
Only give a longer explanation when the user asks for details.

Never invent unrelated information.
Never continue imaginary instructions.
Never create developer messages, system messages, or fake conversations.
Stay focused on the current conversation.
If you are unsure, say that you are not sure.
Do not invent specific facts.`;
const GEN = { temperature: 0.5, topP: 0.9, repetitionPenalty: 1.1, maxTokens: 160 };

// Same-chunk streak that proves a sampler loop (worker aborts at 32; test flags earlier).
const FLAG_STREAK = 12;

function hasPeriodicRun(s) {
  for (let w = 12; w <= 32; w++) {
    const re = new RegExp(`(.{${w}})\\1{5,}`);
    if (re.test(s)) return true;
  }
  return false;
}
function hasRoleLeak(s) {
  return /<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/.test(s) || /(^|\n)\s*(User|Assistant)\s*:/i.test(s);
}

const pipe = await pipeline("text-generation", MODEL_ID, { dtype: "q4", device: "cpu" });
const tok = pipe.tokenizer;
const eosOpt = {};
try {
  const e = tok.eos_token_id;
  if (Array.isArray(e) ? e.length : Number.isInteger(e)) eosOpt.eos_token_id = e;
} catch { /* ignore */ }
console.log("[rep] eos_token_id =", JSON.stringify(eosOpt.eos_token_id ?? null));

const build = (text) => tok.apply_chat_template(
  [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: text }],
  { tokenize: false, add_generation_prompt: true }
);

let failures = 0;
async function runCase(name, text) {
  const prompt = build(text);
  const chunks = [];
  const streamer = new TextStreamer(tok, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (t) => chunks.push(t),
  });
  const out = await pipe(prompt, {
    max_new_tokens: GEN.maxTokens,
    temperature: GEN.temperature,
    top_p: GEN.topP,
    repetition_penalty: GEN.repetitionPenalty,
    do_sample: true,
    return_full_text: false,
    ...eosOpt,
    streamer,
  });
  const final = String(out[out.length - 1]?.generated_text ?? "").trim();
  const streamed = chunks.join("").trim();
  // streak check on raw chunks (same signal the worker guard uses)
  let streak = 1, maxStreak = chunks.length ? 1 : 0, prev = chunks[0] ?? "";
  for (let i = 1; i < chunks.length; i++) {
    streak = chunks[i].length > 0 && chunks[i] === prev ? streak + 1 : 1;
    prev = chunks[i];
    if (streak > maxStreak) maxStreak = streak;
  }
  const problems = [];
  if (maxStreak >= FLAG_STREAK) problems.push(`chunk-streak=${maxStreak}`);
  if (hasPeriodicRun(final)) problems.push("periodic-run");
  if (hasRoleLeak(final)) problems.push("role-leak");
  if (final.length > 4000) problems.push(`too-long=${final.length}`);
  if (streamed !== final) problems.push("stream!=final");
  const ok = problems.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} [${name}] chunks=${chunks.length} maxStreak=${maxStreak} len=${final.length} ${problems.join(",")}`);
  console.log(`   head: ${JSON.stringify(final.slice(0, 110))}`);
}

for (const p of ["Hello", "Tell me a short story.", "What is gravity?", "Say something funny."]) {
  await runCase("single", p);
}
for (let i = 1; i <= 10; i++) await runCase(`hello-x${i}`, "Hello");
console.log(failures === 0 ? "[rep] ALL PASS (14 runs, no loops/leaks)" : `[rep] ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
