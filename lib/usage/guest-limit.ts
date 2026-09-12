// Guest usage limits — single source of truth for throttling anonymous use.
// Consulted at the exact choke point where generation is admitted
// (useModel.generate), not just in UI, so a guest at the limit cannot start
// new inference. Authenticated users bypass it entirely.
//
// Honest limitation: inference runs client-side with public weights, so this
// is a soft limit enforced by the shipped app — it cannot stop someone who
// drives the model runtime directly. It stops casual overuse, not adversaries.

const KEY = "chatbinbeo.guest-usage.v1";

export const GUEST_MESSAGE_LIMIT = 30;
export const GUEST_WINDOW_MS = 24 * 60 * 60 * 1000;

interface UsageState {
  count: number;
  windowStart: number;
}

function readState(now: number): UsageState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { count: 0, windowStart: now };
    const s = JSON.parse(raw) as Partial<UsageState>;
    if (typeof s.count !== "number" || typeof s.windowStart !== "number") {
      return { count: 0, windowStart: now };
    }
    // Rolling window: reset once the window has fully elapsed.
    if (now - s.windowStart >= GUEST_WINDOW_MS) return { count: 0, windowStart: now };
    return { count: Math.max(0, Math.floor(s.count)), windowStart: s.windowStart };
  } catch {
    return { count: 0, windowStart: now };
  }
}

function writeState(s: UsageState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked — treat as fresh each time rather than crash */
  }
}

export interface GuestLimitStatus {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** ms until the window resets (0 when allowed) */
  resetInMs: number;
}

export function checkGuestLimit(now: number = Date.now()): GuestLimitStatus {
  const s = readState(now);
  const allowed = s.count < GUEST_MESSAGE_LIMIT;
  return {
    allowed,
    remaining: Math.max(0, GUEST_MESSAGE_LIMIT - s.count),
    limit: GUEST_MESSAGE_LIMIT,
    resetInMs: allowed ? 0 : Math.max(0, s.windowStart + GUEST_WINDOW_MS - now),
  };
}

/** Consume one guest message. Call only when a generation is actually admitted. */
export function recordGuestMessage(now: number = Date.now()): GuestLimitStatus {
  const s = readState(now);
  const next = { count: s.count + 1, windowStart: s.windowStart };
  writeState(next);
  return checkGuestLimit(now);
}

export function resetGuestUsage(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
