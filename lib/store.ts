"use client";
import { useCallback, useEffect, useState } from "react";
import type { AppSettings, Conversation, Message, ThemeMode } from "@/types";
import { now, uid, titleFromMessage } from "./utils";

const CHATS_KEY = "chatbinbeo.conversations.v1";
// Namespaces from the retired accounts era — adopted once so nobody loses chats.
const LEGACY_KEYS = ["chatbinbeo.conversations.guest.v1"];
const SETTINGS_KEY = "chatbinbeo.settings.v1";

function validConversation(c: unknown): c is Conversation {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  return typeof o.id === "string" && Array.isArray(o.messages);
}

function readChats(): Conversation[] {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) return arr.filter(validConversation);
      return [];
    }
    // One-time adoption of pre-accounts history.
    for (const k of LEGACY_KEYS) {
      try {
        const legacy = localStorage.getItem(k);
        if (!legacy) continue;
        const arr = JSON.parse(legacy) as unknown;
        if (Array.isArray(arr) && arr.length > 0) {
          const chats = arr.filter(validConversation);
          localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
          return chats;
        }
      } catch {
        /* try next key */
      }
    }
    return [];
  } catch {
    return [];
  }
}

function writeChats(chats: Conversation[]): boolean {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats.slice(0, 100)));
    return true;
  } catch {
    return false;
  }
}

function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = JSON.parse(raw) as Partial<AppSettings>;
    return {
      theme: (s.theme as ThemeMode) ?? "system",
      temperature: typeof s.temperature === "number" ? Math.min(1.2, Math.max(0.1, s.temperature)) : 0.5,
      maxTokens: typeof s.maxTokens === "number" ? Math.min(512, Math.max(32, s.maxTokens)) : 160,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const DEFAULT_SETTINGS: AppSettings = { theme: "system", temperature: 0.5, maxTokens: 160 };

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    setConversations(readChats());
  }, []);

  useEffect(() => {
    if (conversations.length === 0) return;
    const ok = writeChats(conversations);
    setStorageError(ok ? null : "Cannot save chats (storage full or blocked).");
  }, [conversations]);

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
    setConversations((prev) => prev.filter((c) => c.id !== chatId));
    setActiveId((cur) => (cur === chatId ? null : cur));
  }, []);

  const clearChat = useCallback((chatId: string) => {
    setConversations((prev) => prev.map((c) => (c.id === chatId ? { ...c, messages: [], updatedAt: now() } : c)));
  }, []);

  const clearAll = useCallback(() => {
    setConversations([]);
    setActiveId(null);
    try {
      localStorage.removeItem(CHATS_KEY);
    } catch { /* ignore */ }
  }, []);

  return { conversations, active, activeId, select, newChat, addMessage, updateMessage, rename, remove, clearChat, clearAll, storageError };
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
