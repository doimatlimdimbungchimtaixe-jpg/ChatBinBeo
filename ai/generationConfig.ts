// Single source of truth for ChatBinBeo generation (no scattered hard-code).
// Qwen2.5-0.5B-Instruct, quantized q4, browser ONNX Runtime.

export const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
export const DTYPE = "q4";
/** Sliding window we actually feed (model max is 32768; 2048 keeps RAM/browser sane). */
export const CONTEXT_USED = 2048;
export const VOCAB_DOC = 151936;

export const SYSTEM_PROMPT = `You are ChatBinBeo, a conversational AI created by Bin.

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

export const GENERATION_DEFAULTS = {
  temperature: 0.5,
  topP: 0.9,
  repetitionPenalty: 1.1,
  maxTokens: 160,
  maxTokensCap: 512,
} as const;

/** Keep recent history only — Qwen2.5-0.5B dilutes with too much context. */
export const CONTEXT_CONFIG = {
  maxTurns: 8,
  maxCharsPerMessage: 600,
} as const;

/**
 * Emergency runaway guard (safety net, NOT the fix — the fix is correct
 * template + EOS + sampling). If one identical streamed chunk repeats this
 * many times in a row, the sampler has collapsed into a loop and the
 * inference loop itself is aborted with an error (never a fake answer).
 */
export const DEGENERATE_CHUNK_STREAK = 32;
/** Absolute character tripwire for runaway detokenization. */
export const RUNAWAY_CHARS = 8000;

/** Cut role-leakage artifacts if the model emits them (stop-sequence safety net). */
const LEAK_CUT = /<\|im_start\|>[\s\S]*$/;
export function cleanGeneratedText(text: string): string {
  let t = String(text ?? "");
  // strip any ChatML control remnants the streamer didn't skip
  t = t.split(LEAK_CUT)[0];
  t = t.replace(/<\|im_end\|>/g, "").replace(/<\|endoftext\|>/g, "");
  // cut a leaked next-turn ("... \nUser: ...") — model must stop at its own turn
  const m = t.search(/\n\s*(User|Assistant)\s*:/i);
  // only cut if there is real content before the leaked marker
  if (m > 12) t = t.slice(0, m);
  return t.trim();
}

export interface NormalizedTurn {
  role: "user" | "assistant";
  content: string;
}

/** Normalize + trim history: valid roles, order kept, most-recent kept. */
export function normalizeHistory(
  messages: { role: string; content: unknown }[],
  maxTurns: number = CONTEXT_CONFIG.maxTurns,
  maxChars: number = CONTEXT_CONFIG.maxCharsPerMessage
): NormalizedTurn[] {
  const turns: NormalizedTurn[] = [];
  for (const m of messages ?? []) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
    if (!role) continue; // drop system/unknown — system prompt is added separately
    const content = sanitizeForPrompt(String(m?.content ?? "").trim());
    if (!content) continue;
    turns.push({ role, content: content.slice(0, maxChars) });
  }
  return turns.slice(-maxTurns);
}

/**
 * Prompt hygiene for PREVIOUS turns only (never touches the live answer).
 * A past generation that leaked ChatML control tokens or a fake
 * "User:/Assistant:" turn would otherwise be fed back verbatim and teach the
 * model to keep roleplaying. Stripping those artifacts is context repair,
 * not answer filtering.
 */
export function sanitizeForPrompt(content: string): string {
  let t = content;
  // Drop any ChatML control block that leaked into a saved message.
  t = t.split(/<\|im_start\|>[\s\S]*$/)[0];
  t = t.replace(/<\|im_end\|>|<\|endoftext\|>/g, "");
  // Cut a leaked next-turn header ("...answer\nUser: ...") if present.
  const m = t.search(/\n\s*(user|assistant|system|developer)\s*:/i);
  if (m > 12) t = t.slice(0, m);
  return t.trim();
}
