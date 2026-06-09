/**
 * In-memory rate limiter with fixed-window buckets (blueprint §3 rate limiting).
 * NOTE: single-instance only. For multi-replica deploys move to Redis.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Consume one token for `key`. Returns whether the call is allowed.
 *
 * @param key      Unique bucket key (e.g. `reveal:${userId}`).
 * @param max      Max requests allowed per window.
 * @param windowMs Window length in milliseconds.
 */
export function rateLimit(
  key: string,
  max: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: max - 1, resetAt };
  }

  if (existing.count >= max) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: max - existing.count,
    resetAt: existing.resetAt,
  };
}

/** Test/maintenance helper — clears all buckets. */
export function _resetRateLimits(): void {
  buckets.clear();
}
