// Concise-response suite — current app pipeline (temp 0.5, top_p 0.9,
// rep penalty 1.1, max 160, concise system prompt, explicit EOS).
// Asserts are TEST-TIME ONLY. Nothing here ships into the app.
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
const SKIBIDI_RE = /sk.?b.?d.?/i;

const VI = /[đĐơƠưƯăĂâÂêÊôÔáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/;
const ECHO = /tell them|do not write in english|provide an explanation of the topic|prefer to be asked/i;
const WHAT_LOOP = /(what\?\s*){3,}/i;
const ROLE_LEAK = /<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|(^|\n)\s*(user|assistant|system|developer)\s*:/i;

function clean(t) {
  let s = String(t ?? "").split(/<\|im_start\|>[\s\S]*$/)[0];
  s = s.replace(/<\|im_end\|>/g, "").replace(/<\|endoftext\|>/g, "");
  const m = s.search(/\n\s*(user|assistant|system|developer)\s*:/i);
  if (m > 12) s = s.slice(0, m);
  return s.trim();
}

const pipe = await pipeline("text-generation", MODEL_ID, { dtype: "q4", device: "cpu" });
const tok = pipe.tokenizer;
let eosOpt = {};
try {
  const e = tok.eos_token_id;
  if (Array.isArray(e) ? e.length : Number.isInteger(e)) eosOpt = { eos_token_id: e };
} catch { /* ignore */ }

async function gen(turns, maxTokens = GEN.maxTokens) {
  const prompt = tok.apply_chat_template(
    [{ role: "system", content: SYSTEM_PROMPT }, ...turns.slice(-8)],
    { tokenize: false, add_generation_prompt: true }
  );
  const inputTokens = tok.encode(prompt)?.length ?? 0;
  const chunks = [];
  const streamer = new TextStreamer(tok, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (t) => chunks.push(t),
  });
  const out = await pipe(prompt, {
    max_new_tokens: maxTokens,
    temperature: GEN.temperature,
    top_p: GEN.topP,
    repetition_penalty: GEN.repetitionPenalty,
    do_sample: true,
    return_full_text: false,
    ...eosOpt,
    streamer,
  });
  const final = clean(out[out.length - 1]?.generated_text ?? "");
  let streak = 1, maxStreak = chunks.length ? 1 : 0;
  for (let i = 1; i < chunks.length; i++) {
    streak = chunks[i].length > 0 && chunks[i] === chunks[i - 1] ? streak + 1 : 1;
    if (streak > maxStreak) maxStreak = streak;
  }
  return { final, nospace: final.replace(/\s+/g, ""), streamed: chunks.join("").trim(), maxStreak, inputTokens };
}

let pass = 0, fail = 0;
function verdict(name, r, extraChecks = []) {
  const probs = [];
  if (!r.final) probs.push("empty");
  if (VI.test(r.final)) probs.push("vietnamese-leak");
  if (ECHO.test(r.final)) probs.push("instruction-echo");
  if (WHAT_LOOP.test(r.final)) probs.push("what-loop");
  if (ROLE_LEAK.test(r.final)) probs.push("role-leak");
  if (r.maxStreak >= 12) probs.push(`streak=${r.maxStreak}`);
  if (r.streamed !== r.final) probs.push("stream!=final");
  for (const [label, ok] of extraChecks) if (!ok) probs.push(label);
  const ok = probs.length === 0;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} [${name}] len=${r.final.length} in=${r.inputTokens} ${probs.join(",")}`);
  console.log(`   ${JSON.stringify(r.final.slice(0, 150))}`);
}

const SHORT = 300; // casual messages must stay short
const CASES = [
  ["hello", "hello", (r) => [["short", r.final.length <= SHORT]]],
  ["ok-bro", "ok bro", (r) => [["short", r.final.length <= SHORT]]],
  ["whats-up", "what's up?", (r) => [["short", r.final.length <= SHORT]]],
  ["gravity", "what is gravity?", (r) => [["topic", /gravit/i.test(r.final)], ["concise", r.final.length <= 900]]],
  ["skibidi", "what is skibidi toilet?", (r) => [["topic", SKIBIDI_RE.test(r.nospace)], ["concise", r.final.length <= 900]]],
  ["story", "tell me a short story", (r) => [["story-like", r.final.length >= 150 && r.final.length <= 1400]]],
  ["gravity-2sent", "explain gravity in 2 sentences", (r) => [["topic", /gravit/i.test(r.final)], ["concise", r.final.length <= 600]]],
];
for (const [name, q, extra] of CASES) {
  for (let i = 1; i <= 3; i++) {
    const r = await gen([{ role: "user", content: q }]);
    verdict(`${name}#${i}`, r, extra(r));
  }
}
for (let t = 1; t <= 2; t++) {
  const h1 = [{ role: "user", content: "My name is Bin." }];
  const a1 = await gen(h1);
  verdict(`ctx-1#${t}`, a1, []);
  const h2 = [...h1, { role: "assistant", content: a1.final }, { role: "user", content: "What is my name?" }];
  const a2 = await gen(h2);
  verdict(`ctx-2#${t}`, a2, [["recalls-Bin", /bin/i.test(a2.final)]]);
  const h3 = [...h2, { role: "assistant", content: a2.final }, { role: "user", content: "What did I tell you earlier?" }];
  const a3 = await gen(h3);
  verdict(`ctx-3#${t}`, a3, [["uses-context", /bin|name|told/i.test(a3.final)]]);
}

console.log(fail === 0 ? `\nALL PASS (${pass})` : `\n${fail} FAILURES / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
