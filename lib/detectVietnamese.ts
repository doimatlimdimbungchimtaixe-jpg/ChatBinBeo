// UI-layer Vietnamese detector (input validation ONLY).
// It never generates answers — the model (Qwen2.5-0.5B-Instruct) always does.
// Conservative by design: English with emoji/numbers/punctuation must pass.

/** Characters essentially unique to Vietnamese in everyday text. */
const VI_UNIQUE = /[đĐơƠưƯăĂ]/;
/** Vietnamese vowels with tone marks (also occur in a few other languages). */
const VI_MARKS =
  /[âÂêÊôÔáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/g;

/**
 * Returns true only for probable Vietnamese:
 * - any VI-unique char (đ/ơ/ư/ă...), OR
 * - at least 2 tone-marked vowels (so "café", "naïve", "Hello bro 😭" pass).
 */
export function isProbablyVietnamese(text: string): boolean {
  if (!text) return false;
  if (VI_UNIQUE.test(text)) return true;
  const marks = text.match(VI_MARKS);
  return (marks?.length ?? 0) >= 2;
}
