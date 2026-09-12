"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "@/types";
import { checkGuestLimit, recordGuestMessage } from "./usage/guest-limit";

export type ModelStatus = "idle" | "loading" | "ready" | "error";
export type LoadPhase = "runtime-loading" | "downloading" | "loading-model" | "warming-up" | "ready";

const LOG = "[ChatBinBeo]";
/** Warn (not fail) if no token arrives within this time — WASM first token can be slow. */
const STUCK_WARN_MS = 90_000;
/** Recover if a generation produces nothing for this long — prevents "Generating forever". */
const STUCK_FAIL_MS = 300_000;

export interface LoadMetrics {
  runtimeImportMs?: number;
  initMs?: number;
  downloadMs?: number;
  cached?: boolean;
  warmupMs?: number;
  device?: string;
  dtype?: string;
}

export interface RuntimeStats {
  inputTokens: number;
  generatedTokens: number;
  generationTimeMs: number;
  firstTokenMs?: number;
  tokensPerSec: number;
  stopReason?: string;
  model: string;
  params: string;
  tokenizer: string;
  contextLength: number;
  device: string;
  dtype?: string;
}

interface Pending {
  onToken: (p: string) => void;
  resolve: (v: { full: string; stats: RuntimeStats | null }) => void;
  reject: (e: Error) => void;
  full: string;
  gotToken: boolean;
  warnTimer: ReturnType<typeof setTimeout> | null;
  failTimer: ReturnType<typeof setTimeout> | null;
}

function clearTimers(p: Pending) {
  if (p.warnTimer) clearTimeout(p.warnTimer);
  if (p.failTimer) clearTimeout(p.failTimer);
  p.warnTimer = p.failTimer = null;
}

export function useChatModel() {
  const [status, setStatus] = useState<ModelStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<LoadPhase | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [modelMeta, setModelMeta] = useState<{ model?: string; params?: string; vocabSize?: number; contextLength?: number; device?: string; dtype?: string; eosId?: number[] | number | null; bosId?: number | null; padId?: number | null }>({});
  const [loadMetrics, setLoadMetrics] = useState<LoadMetrics | null>(null);
  const [lastStats, setLastStats] = useState<RuntimeStats | null>(null);
  const [firstTokenPending, setFirstTokenPending] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<string, Pending>());
  const idRef = useRef(0);

  // NOTE: deps MUST stay [] — the worker lives for the whole page session.
  // Re-running this effect would terminate the worker mid-generation and hang
  // every in-flight generate() promise (isGenerating stuck at true forever).
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    setPhase("runtime-loading");
    console.debug(`${LOG} worker init`);
    const init = async () => {
      try {
        if (typeof Worker === "undefined") throw new Error("Browser không hỗ trợ Web Worker.");
        const w = new Worker(new URL("../workers/chat.worker.ts", import.meta.url), { type: "module" });
        workerRef.current = w;
        w.onmessage = (ev: MessageEvent) => {
          const m = ev.data as {
            type: string; id?: string; partial?: string; full?: string; message?: string;
            model?: string; params?: string; vocabSize?: number; contextLength?: number; device?: string; dtype?: string;
            eosId?: number[] | number | null; bosId?: number | null; padId?: number | null;
            progress?: number; stats?: RuntimeStats | null; phase?: LoadPhase; loadMetrics?: LoadMetrics; warmupMs?: number;
          };
          if (m.type === "phase") {
            if (!cancelled && m.phase) setPhase(m.phase === "ready" ? "ready" : m.phase);
          } else if (m.type === "progress") {
            if (!cancelled && typeof m.progress === "number") {
              setProgress(m.progress);
              setPhase((ph) => (ph === "runtime-loading" ? "downloading" : ph ?? "downloading"));
            }
          } else if (m.type === "ready") {
            if (!cancelled) {
              console.debug(`${LOG} model ready`, m.device ?? "");
              setModelMeta({ model: m.model, params: m.params, vocabSize: m.vocabSize, contextLength: m.contextLength, device: m.device, dtype: m.dtype, eosId: m.eosId, bosId: m.bosId, padId: m.padId });
              if (m.loadMetrics) setLoadMetrics(m.loadMetrics);
              setStatus("ready");
              setPhase("ready");
              setProgress(null);
            }
          } else if (m.type === "warmup-done") {
            if (!cancelled && typeof m.warmupMs === "number") {
              setLoadMetrics((prev) => ({ ...(prev ?? {}), warmupMs: m.warmupMs }));
            }
          } else if (m.type === "generating") {
            if (!cancelled) setFirstTokenPending(true);
          } else if (m.type === "token") {
            const p = m.id && pendingRef.current.get(m.id);
            if (p && m.partial !== undefined) {
              if (!p.gotToken) {
                p.gotToken = true;
                console.debug(`${LOG} first token received`);
                if (p.warnTimer) clearTimeout(p.warnTimer);
                p.warnTimer = null;
              }
              if (!cancelled) setFirstTokenPending(false);
              p.full = m.partial;
              p.onToken(m.partial);
            }
          } else if (m.type === "done") {
            const p = m.id && pendingRef.current.get(m.id);
            if (p) {
              pendingRef.current.delete(m.id!);
              clearTimers(p);
              if (!cancelled) setFirstTokenPending(false);
              console.debug(`${LOG} generation finished`, m.stats ? `${m.stats.generatedTokens} tok / ${m.stats.generationTimeMs}ms` : "(stopped)");
              if (m.stats && !cancelled) setLastStats(m.stats);
              p.resolve({ full: m.full ?? p.full, stats: m.stats ?? null });
            }
          } else if (m.type === "error") {
            console.error(`${LOG} worker error`, m.message ?? "");
            if (m.id) {
              const p = pendingRef.current.get(m.id);
              if (p) {
                pendingRef.current.delete(m.id);
                clearTimers(p);
                if (!cancelled) setFirstTokenPending(false);
                p.reject(new Error(m.message ?? "Model error"));
              }
            } else if (!cancelled) {
              setStatus("error");
              setError(m.message ?? "Model load thất bại.");
            }
          }
        };
        w.onerror = (ev) => {
          console.error(`${LOG} worker onerror`, ev);
          if (!cancelled) {
            setStatus("error");
            setError("Worker lỗi. Thử reload trang.");
          }
        };
        w.onmessageerror = (ev) => {
          console.error(`${LOG} worker onmessageerror`, ev);
        };
        w.postMessage({ type: "load" });
      } catch (e) {
        console.error(`${LOG} worker init failed`, e);
        if (!cancelled) {
          setStatus("error");
          setError(e instanceof Error ? e.message : "Không khởi tạo được model.");
        }
      }
    };
    init();
    return () => {
      cancelled = true;
      // Never leave a generate() promise hanging: reject everything in flight.
      for (const [, p] of pendingRef.current) {
        clearTimers(p);
        p.reject(new Error("Worker đã dừng."));
      }
      pendingRef.current.clear();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const generate = useCallback(
    (
      messages: Message[],
      opts: { maxTokens: number; temperature: number; isGuest?: boolean },
      onToken: (p: string) => void
    ): Promise<{ full: string; stats: RuntimeStats | null }> => {
      return new Promise((resolve, reject) => {
        const w = workerRef.current;
        if (!w || status !== "ready") {
          reject(new Error("Model is still loading... Đợi model sẵn sàng rồi thử lại."));
          return;
        }
        // Guest limit is enforced HERE — the single choke point that admits
        // generation — so a capped guest cannot start new inference.
        if (opts.isGuest) {
          const gate = checkGuestLimit();
          if (!gate.allowed) {
            reject(
              new Error(
                "Guest limit reached.\n\nSign in with Google to continue chatting and save your history."
              )
            );
            return;
          }
          recordGuestMessage();
        }
        // Validate payload — never send undefined/empty content into the tokenizer.
        const clean = messages
          .filter((m) => (m.role === "user" || m.role === "assistant") && String(m.content ?? "").trim().length > 0)
          .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
        if (clean.length === 0 || clean[clean.length - 1].role !== "user") {
          // Allow regeneration (history may end with assistant only if caller popped it wrongly),
          // but never send an empty/invalid payload.
          if (clean.length === 0) {
            reject(new Error("Tin nhắn rỗng, không gửi vào model."));
            return;
          }
        }
        const maxTokens = Number.isFinite(opts.maxTokens) ? Math.min(Math.max(Math.round(opts.maxTokens), 8), 512) : 180;
        const temperature = Number.isFinite(opts.temperature) ? opts.temperature : 0.6;
        const id = `g${++idRef.current}_${Date.now()}`;
        console.debug(`${LOG} generation started`, `msgs=${clean.length}`);
        const pending: Pending = {
          onToken,
          resolve: (v) => { clearTimers(pending); resolve(v); },
          reject: (e) => { clearTimers(pending); reject(e); },
          full: "",
          gotToken: false,
          warnTimer: null,
          failTimer: null,
        };
        // Stuck watchdog: detection only — it never fabricates a response.
        pending.warnTimer = setTimeout(() => {
          const p = pendingRef.current.get(id);
          if (p && !p.gotToken) console.warn(`${LOG} Generation appears stuck (no token yet). Worker/device may be slow — still waiting.`);
        }, STUCK_WARN_MS);
        pending.failTimer = setTimeout(() => {
          const p = pendingRef.current.get(id);
          if (p && !p.gotToken) {
            console.error(`${LOG} generation timed out with zero tokens — recovering`);
            pendingRef.current.delete(id);
            workerRef.current?.postMessage({ type: "stop" });
            p.reject(new Error("AI generation failed (timeout, không có token). Please try again."));
          }
        }, STUCK_FAIL_MS);
        pendingRef.current.set(id, pending);
        w.postMessage({ type: "generate", id, messages: clean, options: { maxTokens, temperature } });
      });
    },
    [status]
  );

  const stop = useCallback(() => {
    console.debug(`${LOG} stop requested`);
    setFirstTokenPending(false);
    workerRef.current?.postMessage({ type: "stop" });
  }, []);

  const retryLoad = useCallback(() => {
    workerRef.current?.postMessage({ type: "load" });
    setStatus("loading");
    setPhase("runtime-loading");
    setError(null);
  }, []);

  return { status, error, phase, progress, modelMeta, loadMetrics, lastStats, firstTokenPending, generate, stop, retryLoad };
}
