export function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function now(): number {
  return Date.now();
}

export function titleFromMessage(text: string): string {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 42);
  return t || "New chat";
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
