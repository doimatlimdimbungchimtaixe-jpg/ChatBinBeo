"use client";
import { useCallback, useEffect, useState } from "react";
import type { AppSettings, Conversation, Message, ThemeMode } from "@/types";
import { now, uid, titleFromMessage } from "./utils";
import { GUEST_OWNER, migrateGuestToUser, ownerNamespace, readConversations, writeConversations } from "./history/storage";

const SETTINGS_KEY = "chatbinbeo.settings.v1";

const DEFAULT_SETTINGS: AppSettings = { theme: "system", temperature: 0.5, maxTokens: 160 };

function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = JSON.parse(raw) as Partial<AppSettings>;
    return {
      theme: (s.theme as ThemeMode) ?? "system",
      temperature: typeof s.temperature === "number" ? Math.min(1.5, Math.max(0.1, s.temperature)) : 0.8,
      maxTokens: typeof s.maxTokens === "number" ? Math.min(256, Math.max(16, s.maxTokens)) : 120,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useConversations(ownerId: string) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [migrationNote, setMigrationNote] = useState<number | null>(null);

  // Reload whenever the signed-in account changes — each owner only ever
  // sees their own namespace. Guest chats are merged into the account first
  // (same tick), so nothing is lost or shown under the wrong owner.
  useEffect(() => {
    let moved = 0;
    if (ownerId !== GUEST_OWNER) moved = migrateGuestToUser(ownerId);
    setConversations(readConversations(ownerId));
    setActiveId(null);
    setMigrationNote(moved > 0 ? moved : null);
  }, [ownerId]);

  useEffect(() => {
    if (conversations.length === 0) return;
    const ok = writeConversations(ownerId, conversations);
    setStorageError(ok ? null : "Không lưu được chat (storage đầy hoặc bị chặn).");
  }, [conversations, ownerId]);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const newChat = useCallback((): string => {
    const id = uid("chat");
    const c: Conversation = { id, title: "New chat", messages: [], createdAt: now(), updatedAt: now() };
    setConversations((prev) => [c, ...prev]);
    setActiveId(id);
    return id;
  }, []);

  const select = useCallback((id: string) => setActiveId(id), []);

  const addMessage = useCallback((chatId: string, role: Message["role"], content: string): Message => {
    const m: Message = { id: uid("msg"), role, content, createdAt: now() };
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== chatId) return c;
        const title = c.messages.length === 0 && role === "user" ? titleFromMessage(content) : c.title;
        return { ...c, title, messages: [...c.messages, m], updatedAt: now() };
      })
    );
    return m;
  }, []);

  const updateMessage = useCallback((chatId: string, msgId: string, content: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id !== chatId ? c : { ...c, messages: c.messages.map((m) => (m.id === msgId ? { ...m, content } : m)), updatedAt: now() }))
    );
  }, []);

  const rename = useCallback((chatId: string, title: string) => {
    setConversations((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: title.trim() || c.title, updatedAt: now() } : c)));
  }, []);

  const remove = useCallback((chatId: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== chatId);
      return next;
    });
    setActiveId((cur) => (cur === chatId ? null : cur));
  }, []);

  const clearChat = useCallback((chatId: string) => {
    setConversations((prev) => prev.map((c) => (c.id === chatId ? { ...c, messages: [], updatedAt: now() } : c)));
  }, []);

  const clearAll = useCallback(() => {
    setConversations([]);
    setActiveId(null);
    try {
      localStorage.removeItem(ownerNamespace(ownerId));
    } catch { /* ignore */ }
  }, [ownerId]);

  return { conversations, active, activeId, select, newChat, addMessage, updateMessage, rename, remove, clearChat, clearAll, storageError, migrationNote, dismissMigrationNote: () => setMigrationNote(null) };
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    setSettings(readSettings());
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch { /* ignore */ }
    const root = document.documentElement;
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const dark = settings.theme === "dark" || (settings.theme === "system" && prefersDark);
    root.classList.toggle("dark", dark);
  }, [settings]);
  return { settings, setSettings };
}
