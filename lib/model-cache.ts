"use client";
import { MODEL_REVISION, MODEL_VERSION_KEY } from "@/ai/generationConfig";

/** Delete the runtime's HuggingFace/transformers caches (shared with the worker). */
export async function clearModelCaches(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  const keys = await caches.keys();
  let removed = 0;
  for (const k of keys) {
    if (/transformers|huggingface/i.test(k)) {
      try {
        if (await caches.delete(k)) removed++;
      } catch {
        /* keep trying the rest */
      }
    }
  }
  return removed;
}

/**
 * Auto-invalidate caches from an older pinned model revision so a new
 * deployment can never run on mixed old/new weight files.
 */
export async function invalidateStaleModelCache(): Promise<"cleared" | "current" | "unavailable"> {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(MODEL_VERSION_KEY);
  } catch {
    return "unavailable";
  }
  if (saved === MODEL_REVISION) return "current";
  await clearModelCaches();
  try {
    localStorage.setItem(MODEL_VERSION_KEY, MODEL_REVISION);
  } catch {
    /* ignore */
  }
  return saved === null ? "current" : "cleared";
}
