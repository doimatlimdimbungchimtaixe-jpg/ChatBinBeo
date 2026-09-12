import { pipeline } from "@huggingface/transformers";
import { SYSTEM_PROMPT, GENERATION_DEFAULTS, normalizeHistory, cleanGeneratedText } from "../ai/generationConfig.ts";

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const pipe = await pipeline("text-generation", MODEL_ID, { dtype: "q4", device: "cpu" });
const tok = pipe.tokenizer;
const chat = async (text) => {
  const prompt = tok.apply_chat_template(
    [{ role: "system", content: SYSTEM_PROMPT }, ...normalizeHistory([{ role: "user", content: text }])],
    { tokenize: false, add_generation_prompt: true }
  );
  const out = await pipe(prompt, {
    max_new_tokens: 120,
    temperature: GENERATION_DEFAULTS.temperature,
    top_p: GENERATION_DEFAULTS.topP,
    repetition_penalty: GENERATION_DEFAULTS.repetitionPenalty,
    do_sample: true,
    return_full_text: false,
  });
  const raw = Array.isArray(out) ? out[out.length - 1]?.generated_text ?? "" : "";
  console.log("USER:", text);
  console.log("AI:", cleanGeneratedText(raw));
  console.log("---");
};
await chat("Xin chào, bạn là ai?");
await chat("Tôi tên Bin. Bạn có nhớ không?");
await chat("Hello, who are you?");
process.exit(0);
