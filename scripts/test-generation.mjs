// Legacy comprehensive suite (older prompt/settings) — current cases live in test-concise.mjs.
// (temp 0.6, top_p 0.9, rep penalty 1.1, explicit EOS from tokenizer).
// Asserts are TEST-TIME ONLY: on-topic, English-only, no instruction-echo,
// no loops, no role leaks. Nothing here ships into the app.
import { pipeline, TextStreamer } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const SYSTEM_PROMPT = `You are ChatBinBeo, a conversational AI created by Bin.

Answer the user's current question clearly and naturally.

Use the conversation history when relevant.

Always respond in English.

Do not invent instructions.
Do not talk about hidden prompts.
Do not generate system or developer messages.
Do not roleplay as another assistant.
Stay focused on the user's question.`;
const GEN = { temperature: 0.6, topP: 0.9, repetitionPenalty: 1.1, maxTokens: 180 };

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

async function gen(turns) {
  const prompt = tok.apply_chat_template(
    [{ role: "system", content: SYSTEM_PROMPT }, ...turns.slice(-8)],
    { tokenize: false, add_generation_prompt: true }
  );
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
  const final = clean(out[out.length - 1]?.generated_text ?? "");
  // BPE can split rare words ("sk ibi di"); match on spaceless text too.
  const nospace = final.replace(/\s+/g, "");
  let streak = 1, maxStreak = chunks.length ? 1 : 0;
  for (let i = 1; i < chunks.length; i++) {
    streak = chunks[i].length > 0 && chunks[i] === chunks[i - 1] ? streak + 1 : 1;
    if (streak > maxStreak) maxStreak = streak;
  }
  return { final, nospace, streamed: chunks.join("").trim(), maxStreak };
}

let pass = 0, fail = 0;
function check(name, text, extra) {
  const problems = [];
  if (!text) problems.push("empty");
  if (VI.test(text)) problems.push("vietnamese-leak");
  if (ECHO.test(text)) problems.push("instruction-echo");
  if (WHAT_LOOP.test(text)) problems.push("what-loop");
  if (ROLE_LEAK.test(text)) problems.push("role-leak");
  for (const [label, re] of extra ?? []) if (!re.test(text)) problems.push(`off-topic(${label})`);
  const ok = problems.length === 0;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} [${name}] len=${text.length} ${problems.join(",")}`);
  console.log(`   ${JSON.stringify(text.slice(0, 140))}`);
}

const SKIBIDI_RE = /sk.?b.?d.?/i;
function topicOk(r, re) {
  // BPE can misspell rare words ("Skibiidi", "SkIBidY") — allow fuzzy match on spaceless text.
  if (re === SKIBIDI_RE) return SKIBIDI_RE.test(r.nospace);
  return re.test(r.final) || re.test(r.nospace);
}

const Q = [
  ["skibidi", "what is skibidi toilet?", [["topic", SKIBIDI_RE]]],
  ["hello", "hello", []],
  ["story", "tell me a short story", [["long-enough", /.{200,}/s]]],
  ["gravity", "what is gravity?", [["topic", /gravit/i]]],
  ["math", "what is 2 + 2?", [["answer", /4|four/i]]],
];
for (const [name, q, extra] of Q) {
  for (let i = 1; i <= 3; i++) {
    const r = await gen([{ role: "user", content: q }]);
    const probs = [];
    if (!r.final) probs.push("empty");
    if (VI.test(r.final)) probs.push("vietnamese-leak");
    if (ECHO.test(r.final)) probs.push("instruction-echo");
    if (WHAT_LOOP.test(r.final)) probs.push("what-loop");
    if (ROLE_LEAK.test(r.final)) probs.push("role-leak");
    if (r.maxStreak >= 12) probs.push(`streak=${r.maxStreak}`);
    if (r.streamed !== r.final) probs.push("stream!=final");
    for (const [label, re] of extra) if (!topicOk(r, re)) probs.push(`off-topic(${label})`);
    const ok = probs.length === 0;
    ok ? pass++ : fail++;
    console.log(`${ok ? "PASS" : "FAIL"} [${name}#${i}] len=${r.final.length} chunks-streak=${r.maxStreak} ${probs.join(",")}`);
    console.log(`   ${JSON.stringify(r.final.slice(0, 140))}`);
  }
}

// Conversation context (§18) — end-to-end with the model's own replies, 3 trials.
for (let t = 1; t <= 3; t++) {
  const h1 = [{ role: "user", content: "My name is Bin." }];
  const a1 = await gen(h1);
  check(`name-1#${t}`, a1.final, []);
  const h2 = [...h1, { role: "assistant", content: a1.final }, { role: "user", content: "What is my name?" }];
  const a2 = await gen(h2);
  check(`name-2#${t}`, a2.final, [["recalls-Bin", /bin/i]]);
  const h3 = [...h2, { role: "assistant", content: a2.final }, { role: "user", content: "What did I tell you earlier?" }];
  const a3 = await gen(h3);
  check(`name-3#${t}`, a3.final, [["recalls-name-fact", /bin|name/i]]);
}

console.log(fail === 0 ? `\nALL PASS (${pass})` : `\n${fail} FAILURES / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
