"use client";
import type { AppSettings } from "@/types";

export function SettingsPanel(props: {
  open: boolean;
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  onClose: () => void;
  onClearAll: () => void;
  onClearCache: () => Promise<void>;
  modelMeta: { model?: string; params?: string; vocabSize?: number; contextLength?: number; device?: string; dtype?: string; eosId?: number[] | number | null; bosId?: number | null; padId?: number | null };
  modelStatus: string;
  lastStats?: { inputTokens: number; generatedTokens: number; generationTimeMs: number; firstTokenMs?: number; tokensPerSec: number; stopReason?: string } | null;
  loadMetrics?: { runtimeImportMs?: number; initMs?: number; downloadMs?: number; cached?: boolean; modelSizeBytes?: number; downloadedBytes?: number; downloadMBps?: number; warmupMs?: number } | null;
}) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={props.onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          <button onClick={props.onClose} className="text-sm text-neutral-500 hover:underline">
            Close
          </button>
        </div>

        <label className="mb-3 block text-sm">
          <div className="mb-1 text-neutral-600 dark:text-neutral-300">Theme</div>
          <select
            value={props.settings.theme}
            onChange={(e) => props.onChange({ ...props.settings, theme: e.target.value as AppSettings["theme"] })}
            className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>

        <label className="mb-3 block text-sm">
          <div className="mb-1 text-neutral-600 dark:text-neutral-300">Temperature: {props.settings.temperature.toFixed(2)} (0.5–0.7 khuyến nghị)</div>
          <input
            type="range"
            min={0.1}
            max={1.2}
            step={0.05}
            value={props.settings.temperature}
            onChange={(e) => props.onChange({ ...props.settings, temperature: Number(e.target.value) })}
            className="w-full"
          />
        </label>

        <label className="mb-4 block text-sm">
          <div className="mb-1 text-neutral-600 dark:text-neutral-300">Max tokens: {props.settings.maxTokens}</div>
          <input
            type="range"
            min={32}
            max={512}
            step={8}
            value={props.settings.maxTokens}
            onChange={(e) => props.onChange({ ...props.settings, maxTokens: Number(e.target.value) })}
            className="w-full"
          />
          <div className="mt-1 text-[11px] text-neutral-500">top_p 0.9 · repetition_penalty 1.1 (cố định trong generationConfig)</div>
        </label>

        <div className="mb-4 rounded-xl bg-neutral-100 p-3 font-mono text-xs leading-relaxed dark:bg-neutral-900">
          <div className="font-semibold">Model information (from runtime)</div>
          <div>Model: {props.modelMeta.model ?? "onnx-community/Qwen2.5-0.5B-Instruct"}</div>
          <div>Parameters: {props.modelMeta.params ?? "~494M"}</div>
          <div>Tokenizer: Qwen2 BPE, vocab {props.modelMeta.vocabSize ?? 151936}</div>
          <div>EOS token ID: {props.modelMeta.eosId == null ? "…" : Array.isArray(props.modelMeta.eosId) ? props.modelMeta.eosId.join(", ") : props.modelMeta.eosId}</div>
          <div>BOS token ID: {props.modelMeta.bosId ?? "…"}</div>
          <div>PAD token ID: {props.modelMeta.padId ?? "…"}</div>
          <div>Context length: {props.modelMeta.contextLength ?? 2048}</div>
          <div>Device: {props.modelMeta.device ?? "wasm"} ({props.modelMeta.dtype ?? "q4"})</div>
          <div>Status: {props.modelStatus}</div>
          <div>Where: browser Web Worker (ONNX Runtime), weights cached from HuggingFace Hub</div>
          <div>External AI API: none</div>
          {props.loadMetrics && (
            <>
              <div>Model size: {props.loadMetrics.modelSizeBytes ? `${(props.loadMetrics.modelSizeBytes / 1048576).toFixed(0)} MB` : "…"}</div>
              <div>Downloaded: {props.loadMetrics.downloadedBytes ? `${(props.loadMetrics.downloadedBytes / 1048576).toFixed(0)} MB` : "0 MB"}</div>
              <div>Download speed: {props.loadMetrics.downloadMBps ? `${props.loadMetrics.downloadMBps.toFixed(1)} MB/s` : "—"}</div>
              <div>Cache: {props.loadMetrics.cached ? "hit" : "miss"}</div>
              <div>Runtime import: {props.loadMetrics.runtimeImportMs ?? "?"} ms</div>
              <div>Download: {props.loadMetrics.downloadMs ?? "?"} ms{props.loadMetrics.cached ? " (cache hit)" : ""}</div>
              <div>Init: {props.loadMetrics.initMs ?? "?"} ms</div>
              {typeof props.loadMetrics.warmupMs === "number" && <div>Warm-up: {props.loadMetrics.warmupMs} ms</div>}
            </>
          )}
          {props.lastStats && (
            <>
              <div>Input tokens: {props.lastStats.inputTokens}</div>
              <div>Generated tokens: {props.lastStats.generatedTokens}</div>
              <div>Generation time: {props.lastStats.generationTimeMs} ms</div>
              {typeof props.lastStats.firstTokenMs === "number" && <div>First token: {props.lastStats.firstTokenMs} ms</div>}
              <div>Tokens/sec: {props.lastStats.tokensPerSec.toFixed(1)}</div>
              {props.lastStats.stopReason && <div>Stop reason: {props.lastStats.stopReason}</div>}
            </>
          )}
        </div>

        <button
          onClick={() => {
            if (confirm("Xóa toàn bộ chat?")) props.onClearAll();
          }}
          className="mb-2 w-full rounded-xl border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
        >
          Clear all chats
        </button>

        <button
          onClick={async () => {
            if (confirm("Xóa model cache và tải lại? (dùng khi nghi cache cũ/hỏng)")) await props.onClearCache();
          }}
          className="mb-4 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Clear model cache & reload
        </button>

        <div className="text-center text-xs text-neutral-500">
          <div className="font-semibold text-sm text-neutral-700 dark:text-neutral-200">ChatBinBeo</div>
          <div>Created by Bin Beo</div>
        </div>
      </div>
    </div>
  );
}
