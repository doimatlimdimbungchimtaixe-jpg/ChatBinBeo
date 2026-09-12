"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { MessageBubble } from "@/components/MessageBubble";
import { ChatInput } from "@/components/ChatInput";
import { SettingsPanel } from "@/components/SettingsPanel";
import { useConversations, useSettings } from "@/lib/store";
import { useChatModel } from "@/lib/useModel";
import { isProbablyVietnamese } from "@/lib/detectVietnamese";
import { clearModelCaches } from "@/lib/model-cache";
import type { Message } from "@/types";

const SUGGESTIONS = ["Tell me a random fact", "Let's chat", "Ask me something"];

export default function Page() {
  const { conversations, active, activeId, select, newChat, addMessage, updateMessage, rename, remove, clearChat, clearAll, storageError } =
    useConversations();
  const { settings, setSettings } = useSettings();
  const { status, error, phase, progress, modelMeta, loadMetrics, lastStats, firstTokenPending, generate, stop, retryLoad } = useChatModel();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [langWarning, setLangWarning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stuckTop, setStuckTop] = useState(false);

  // Auto-scroll only while the user is already near the bottom — never yank
  // them away from older messages they are reading.
  const nearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    if (!stuckTop) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.messages.length, generating, stuckTop]);

  useEffect(() => {
    if (status === "ready") console.debug("[ChatBinBeo] model ready");
  }, [status]);

  const ensureChat = useCallback((): string => {
    if (activeId) return activeId;
    return newChat();
  }, [activeId, newChat]);

  const runModel = useCallback(
    async (chatId: string, history: Message[], targetAssistantId?: string) => {
      console.debug("[ChatBinBeo] generation started");
      setGenerating(true);
      setGenError(null);
      // Regenerate reuses the existing assistant bubble; a fresh send appends a new one.
      const assistant = targetAssistantId
        ? { id: targetAssistantId } as Message
        : addMessage(chatId, "assistant", "");
      let firstToken = true;
      try {
        const { full } = await generate(
          history,
          { maxTokens: settings.maxTokens, temperature: settings.temperature },
          (partial) => {
            if (firstToken) {
              firstToken = false;
              console.debug("[ChatBinBeo] first token received");
            }
            updateMessage(chatId, assistant.id, partial);
          }
        );
        console.debug("[ChatBinBeo] generation finished");
        updateMessage(chatId, assistant.id, full || "…");
      } catch (e) {
        // Never swallow: real error to console (dev) + visible recoverable state (UI).
        console.error("[ChatBinBeo] generation error", e);
        const msg = e instanceof Error ? e.message : "Generation failed.";
        setGenError(msg);
        if (!targetAssistantId) updateMessage(chatId, assistant.id, "");
      } finally {
        setGenerating(false);
      }
    },
    [addMessage, generate, settings.maxTokens, settings.temperature, updateMessage]
  );

  const onSend = useCallback(
    (text: string) => {
      console.debug("[ChatBinBeo] submit");
      const t = text.trim();
      if (!t) return;
      if (generating) return;
      // UI validation only: Vietnamese input is stopped here with a warning.
      // No request is sent, no answer is fabricated — the model stays the only responder.
      if (isProbablyVietnamese(t)) {
        setLangWarning(true);
        return;
      }
      setLangWarning(false);
      if (status !== "ready") {
        setGenError("Model is still loading... Đợi model sẵn sàng rồi gửi lại.");
        return;
      }
      const chatId = ensureChat();
      const userMsg: Message = addMessage(chatId, "user", t);
      console.debug("[ChatBinBeo] user message added");
      // Snapshot the next state explicitly — React setState is async, so the model
      // must be called with nextMessages (history + new user msg), not stale `active`.
      const base = (active?.id === chatId ? active.messages : conversations.find((c) => c.id === chatId)?.messages ?? []).concat([userMsg]);
      void runModel(chatId, base);
    },
    [ensureChat, addMessage, active, conversations, runModel, generating, status]
  );

  const onRegenerate = useCallback(() => {
    if (!active || generating || status !== "ready") return;
    const msgs = [...active.messages];
    let targetId: string | undefined;
    // Regenerate in place: history without the old answer, stream into the same bubble.
    if (msgs.length && msgs[msgs.length - 1].role === "assistant") {
      const last = msgs[msgs.length - 1];
      targetId = last.id;
      msgs.pop();
    }
    void runModel(active.id, msgs, targetId);
  }, [active, generating, status, runModel]);

  const onCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* fall through to legacy fallback (mobile / non-secure contexts) */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  const lastAssistantIdx = useMemo(() => {
    if (!active) return -1;
    for (let i = active.messages.length - 1; i >= 0; i--) if (active.messages[i].role === "assistant" && active.messages[i].content) return i;
    return -1;
  }, [active]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        open={sidebarOpen}
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => {
          select(id);
          setSidebarOpen(false);
        }}
        onNew={() => {
          newChat();
          setSidebarOpen(false);
        }}
        onRename={rename}
        onDelete={remove}
        onOpenSettings={() => setSettingsOpen(true)}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2.5 dark:border-neutral-800">
          <button onClick={() => setSidebarOpen(true)} className="rounded-lg px-2 py-1 hover:bg-neutral-100 md:hidden dark:hover:bg-neutral-900">
            ☰
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{active?.title ?? "ChatBinBeo"}</div>
          </div>
        </header>

        {(status === "error" || error) && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            Model load thất bại: {error}{" "}
            <button onClick={retryLoad} className="underline">
              Thử lại
            </button>
          </div>
        )}
        {storageError && <div className="border-b border-yellow-200 bg-yellow-50 px-4 py-2 text-xs text-yellow-800">{storageError}</div>}
        {genError && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">Generation failed: {genError}</div>}
        {langWarning && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <span>ChatBinBeo currently only speaks English. Please send your message in English.</span>
            <button onClick={() => setLangWarning(false)} className="shrink-0 rounded-lg border border-amber-400 px-3 py-1 font-medium hover:bg-amber-100 dark:hover:bg-amber-900">
              OK
            </button>
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={() => setStuckTop(!nearBottom())}
          className="flex-1 overflow-y-auto"
        >
          {!active || active.messages.length === 0 ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 text-center">
              <h1 className="text-3xl font-semibold tracking-tight">ChatBinBeo</h1>
              <p className="mt-2 text-[15px] text-neutral-600 dark:text-neutral-300">What do you want to talk about?</p>
              <div className="mt-4 max-w-md rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                Note: ChatBinBeo only chats in <b>English</b>.
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => onSend(s)}
                    disabled={status !== "ready" || generating}
                    className="rounded-full border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    {s}
                  </button>
                ))}
              </div>
              {status === "loading" && (
                <div className="mt-4 max-w-md text-xs text-neutral-500">
                  {phase === "downloading" ? (
                    <>Downloading model...{progress !== null ? ` ${(progress * 100).toFixed(0)}%` : ""} (lần đầu tải weights, các lần sau dùng cache)</>
                  ) : phase === "runtime-loading" ? (
                    <>Loading runtime... (UI vẫn dùng được, model chạy nền trong Worker)</>
                  ) : (
                    <>Loading model... (lần đầu tải weights, các lần sau dùng cache)</>
                  )}
                </div>
              )}
              {status === "ready" && lastStats && (
                <div className="mt-4 rounded-xl border border-neutral-200 px-3 py-2 text-left font-mono text-[11px] leading-relaxed text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">
                  <div>Model: {lastStats.model}</div>
                  <div>Parameters: {lastStats.params}</div>
                  <div>Tokenizer: {lastStats.tokenizer}</div>
                  <div>Context length: {lastStats.contextLength}</div>
                  <div>Model loaded: true</div>
                  <div>Input tokens: {lastStats.inputTokens}</div>
                  <div>Generated tokens: {lastStats.generatedTokens}</div>
                  <div>Generation time: {lastStats.generationTimeMs} ms</div>
                  {typeof lastStats.firstTokenMs === "number" && <div>First token: {lastStats.firstTokenMs} ms</div>}
                  <div>Tokens/sec: {lastStats.tokensPerSec.toFixed(1)}</div>
                  {lastStats.stopReason && <div>Stop reason: {lastStats.stopReason}</div>}
                  <div>Device: {lastStats.device}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
              {generating && firstTokenPending && (
                <div className="text-xs text-neutral-500">Generating... (đang chờ token đầu tiên từ model)</div>
              )}
              {active.messages
                .filter((m) => !(m.role === "assistant" && !m.content && !generating))
                .map((m, i, arr) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    onCopy={onCopy}
                    generating={generating && i === arr.length - 1 && m.role === "assistant"}
                    isLastAssistant={m.role === "assistant" && i === lastAssistantIdx}
                    onRegenerate={onRegenerate}
                  />
                ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
        {stuckTop && active && active.messages.length > 0 && (
          <button
            onClick={() => {
              setStuckTop(false);
              scrollToBottom();
            }}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full border border-neutral-300 bg-white px-4 py-2 text-xs font-medium shadow-lg hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
          >
            ↓ New response
          </button>
        )}

        <ChatInput disabled={status !== "ready"} generating={generating} onSend={onSend} onStop={() => stop()} />
      </main>

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
        onClearAll={clearAll}
        onClearCache={async () => {
          await clearModelCaches();
          location.reload();
        }}
        modelMeta={modelMeta}
        modelStatus={status}
        lastStats={lastStats}
        loadMetrics={loadMetrics}
      />
    </div>
  );
}
