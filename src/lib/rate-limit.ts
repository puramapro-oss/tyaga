/**
 * Rate limit mémoire par user (fenêtre fixe). Suffisant V1 single-instance
 * Vercel ; les transitions rapides tolèrent la approximation.
 */

const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = windows.get(key);

  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }

  entry.count += 1;
  if (entry.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}
