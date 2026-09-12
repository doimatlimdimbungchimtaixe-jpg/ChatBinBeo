// Quality test (legacy suite — see test-concise.mjs for current cases).
import { pipeline } from "@huggingface/transformers";

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

function normalizeHistory(messages, maxTurns = 8, maxChars = 600) {
  const turns = [];
  for (const m of messages ?? []) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
    if (!role) continue;
    const content = String(m?.content ?? "").trim();
    if (!content) continue;
    turns.push({ role, content: content.slice(0, maxChars) });
  }
  return turns.slice(-maxTurns);
}
function cleanGeneratedText(text) {
  let t = String(text ?? "");
  t = t.split(/<\|im_start\|>[\s\S]*$/)[0];
  t = t.replace(/<\|im_end\|>/g, "").replace(/<\|endoftext\|>/g, "");
  const m = t.search(/\n\s*(User|Assistant)\s*:/i);
  if (m > 12) t = t.slice(0, m);
  return t.trim();
}

async function main() {
  console.log("[q] loading...");
  const pipe = await pipeline("text-generation", MODEL_ID, { dtype: "q4", device: "cpu" });
  const tok = pipe.tokenizer;
  const build = (msgs) => tok.apply_chat_template(
    [{ role: "system", content: SYSTEM_PROMPT }, ...normalizeHistory(msgs)],
    { tokenize: false, add_generation_prompt: true }
  );
  const chat = async (msgs) => {
    const prompt = build(msgs);
    const inputTokens = tok.encode(prompt)?.length ?? 0;
    const t0 = Date.now();
    const out = await pipe(prompt, {
      max_new_tokens: GEN.maxTokens,
      temperature: GEN.temperature,
      top_p: GEN.topP,
      repetition_penalty: GEN.repetitionPenalty,
      do_sample: true,
      return_full_text: false,
    });
    const raw = Array.isArray(out) ? out[out.length - 1]?.generated_text ?? "" : "";
    const full = cleanGeneratedText(raw);
    return { full, inputTokens, gen: tok.encode(full)?.length ?? 0, ms: Date.now() - t0 };
  };
  const cases = [
    [{ role: "user", content: "Xin chào, bạn là ai?" }],
    [{ role: "user", content: "Tôi tên Bin. Hãy nhớ điều đó trong cuộc trò chuyện này." }],
    [
      { role: "user", content: "Tôi tên Bin. Hãy nhớ điều đó trong cuộc trò chuyện này." },
      { role: "assistant", content: "Chào Bin! Mình sẽ nhớ tên bạn trong cuộc trò chuyện này." },
      { role: "user", content: "Tôi tên gì?" },
    ],
    [{ role: "user", content: "Giải thích tại sao bầu trời có màu xanh bằng ngôn ngữ đơn giản." }],
    [{ role: "user", content: "Tell me a short funny story." }],
    [{ role: "user", content: "What is the difference between a star and a planet?" }],
  ];
  for (const msgs of cases) {
    const r = await chat(msgs);
    console.log("\n=== USER:", msgs[msgs.length - 1].content);
    console.log("AI:", r.full);
    console.log(`(in=${r.inputTokens} out=${r.gen} ${r.ms}ms ${(r.gen / (r.ms / 1000)).toFixed(1)} tok/s)`);
  }
  console.log("\n[q] done.");
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
