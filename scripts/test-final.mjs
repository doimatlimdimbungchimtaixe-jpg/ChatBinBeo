// Final validation for the Bin Beo creator prompt (temp 0.5, max 160).
// TEST-TIME ONLY asserts. Nothing here ships into the app.
import { pipeline, TextStreamer } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const SYSTEM_PROMPT = `You are ChatBinBeo, a conversational AI created by Bin Beo.

If the user asks who created you, who made you, who built you, or who developed you, answer naturally that you were created by Bin Beo.

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
const VI = /[đĐơƠưƯăĂâÂêÊôÔáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/;
const ECHO = /tell them|do not write in english|provide an explanation of the topic|prefer to be asked/i;
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

async function gen(turns) {
  const prompt = tok.apply_chat_template(
    [{ role: "system", content: SYSTEM_PROMPT }, ...turns.slice(-8)],
    { tokenize: false, add_generation_prompt: true }
  );
  const chunks = [];
  const streamer = new TextStreamer(tok, { skip_prompt: true, skip_special_tokens: true, callback_function: (t) => chunks.push(t) });
  const out = await pipe(prompt, { max_new_tokens: GEN.maxTokens, temperature: GEN.temperature, top_p: GEN.topP, repetition_penalty: GEN.repetitionPenalty, do_sample: true, return_full_text: false, ...eosOpt, streamer });
  const final = clean(out[out.length - 1]?.generated_text ?? "");
  let streak = 1, maxStreak = chunks.length ? 1 : 0;
  for (let i = 1; i < chunks.length; i++) {
    streak = chunks[i].length > 0 && chunks[i] === chunks[i - 1] ? streak + 1 : 1;
    if (streak > maxStreak) maxStreak = streak;
  }
  return { final, maxStreak, okStream: chunks.join("").trim() === final };
}

let pass = 0, fail = 0;
function verdict(name, text, extra = []) {
  const probs = [];
  if (!text) probs.push("empty");
  if (VI.test(text)) probs.push("vietnamese-leak");
  if (ECHO.test(text)) probs.push("instruction-echo");
  if (ROLE_LEAK.test(text)) probs.push("role-leak");
  for (const [label, ok] of extra) if (!ok) probs.push(label);
  const ok = probs.length === 0;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} [${name}] len=${text.length} ${probs.join(",")}`);
  console.log(`   ${JSON.stringify(text.slice(0, 150))}`);
}

for (let i = 1; i <= 3; i++) {
  const r = await gen([{ role: "user", content: "Who created you?" }]);
  verdict(`creator#${i}`, r.final, [["bin-beo", /bin\s*beo/i.test(r.final)]]);
}
for (const [name, q, max] of [["hello", "hello", 300], ["ok-bro", "ok bro", 300], ["gravity", "what is gravity?", 900], ["story", "tell me a short story", 1400]]) {
  const r = await gen([{ role: "user", content: q }]);
  const extra = [];
  if (r.final.length > max) extra.push(`too-long(${r.final.length})`);
  if (r.maxStreak >= 12) extra.push(`streak=${r.maxStreak}`);
  if (!r.okStream) extra.push("stream!=final");
  if (name === "gravity" && !/gravit/i.test(r.final)) extra.push("off-topic");
  verdict(`${name}`, r.final, extra);
}
const h1 = [{ role: "user", content: "My name is Bin." }];
const a1 = await gen(h1);
const a2 = await gen([...h1, { role: "assistant", content: a1.final }, { role: "user", content: "What is my name?" }]);
verdict("ctx-recall", a2.final, [["recalls-Bin", /bin/i.test(a2.final)]]);

console.log(fail === 0 ? `\nALL PASS (${pass})` : `\n${fail} FAILURES / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
