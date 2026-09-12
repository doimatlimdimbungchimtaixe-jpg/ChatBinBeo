// Per-owner conversation storage (local-first).
//
// Every conversation carries its owner's id (`userId`). All reads/writes go
// through namespaced keys, so one account's history is never visible under
// another account on shared browsers. The owner id always comes from the
// verified auth session (never from URL params or message content).
//
// Persistence is device-local (localStorage). No conversation ever leaves the
// browser, which is also why no server secret is involved. A server database
// can replace this module later behind the same function shapes.

import type { Conversation } from "@/types";
import { resetGuestUsage } from "@/lib/usage/guest-limit";

export const GUEST_OWNER = "guest";
const NS_PREFIX = "chatbinbeo.conversations.";
const NS_SUFFIX = ".v1";
const MIGRATED_PREFIX = "chatbinbeo.migrated.";

export function ownerNamespace(ownerId: string): string {
  return `${NS_PREFIX}${ownerId}${NS_SUFFIX}`;
}

export function ownerIdFor(sessionUserId: string | null | undefined): string {
  return sessionUserId ? `user:${sessionUserId}` : GUEST_OWNER;
}

function validConversation(c: unknown): c is Conversation {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  return typeof o.id === "string" && Array.isArray(o.messages);
}

export function readConversations(ownerId: string): Conversation[] {
  try {
    const raw = localStorage.getItem(ownerNamespace(ownerId));
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(validConversation);
  } catch {
    return [];
  }
}

/** Returns false when storage is full/blocked (caller surfaces the warning). */
export function writeConversations(ownerId: string, chats: Conversation[]): boolean {
  try {
    localStorage.setItem(ownerNamespace(ownerId), JSON.stringify(chats.slice(0, 100)));
    return true;
  } catch {
    return false;
  }
}

function migratedKey(userOwnerId: string): string {
  return `${MIGRATED_PREFIX}${userOwnerId}`;
}

export function wasMigrated(userOwnerId: string): boolean {
  try {
    return localStorage.getItem(migratedKey(userOwnerId)) === "1";
  } catch {
    return true; // storage broken → don't attempt migration loops
  }
}

function markMigrated(userOwnerId: string): void {
  try {
    localStorage.setItem(migratedKey(userOwnerId), "1");
  } catch {
    /* ignore */
  }
}

/**
 * Move guest conversations into the signed-in account once, skipping
 * duplicates by id. Returns the number of conversations moved.
 */
export function migrateGuestToUser(userOwnerId: string): number {
  if (userOwnerId === GUEST_OWNER || wasMigrated(userOwnerId)) return 0;
  const guest = readConversations(GUEST_OWNER);
  if (guest.length === 0) {
    markMigrated(userOwnerId);
    return 0;
  }
  const existing = readConversations(userOwnerId);
  const ids = new Set(existing.map((c) => c.id));
  const fresh = guest.filter((c) => !ids.has(c.id));
  if (fresh.length > 0) {
    writeConversations(userOwnerId, [...fresh, ...existing]);
  }
  try {
    localStorage.removeItem(ownerNamespace(GUEST_OWNER));
  } catch {
    /* ignore */
  }
  resetGuestUsage();
  markMigrated(userOwnerId);
  return fresh.length;
}
