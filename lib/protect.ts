import type { Store } from "./redis";

/**
 * Cost & abuse protection for the public `/api/generate` endpoint, where every
 * cache miss can fire up to three paid LLM calls. Three independent guards, all
 * backed by a shared {@link Store}:
 *
 * 1. **Result cache** keyed on `keywords + dataHash` — identical requests skip the
 *    LLM entirely, and editing the data (new `dataHash`) orphans old entries.
 * 2. **Per-IP rate limit** — a fixed 60s window of {@link RATE_LIMIT} requests.
 * 3. **Daily spend cap** — a hard ceiling on LLM-consuming requests per UTC day.
 */

/** Max requests per IP within {@link RATE_WINDOW_SECONDS}. */
export const RATE_LIMIT = 5;
/** The rate-limit window, in seconds. */
export const RATE_WINDOW_SECONDS = 60;

/**
 * Cache entries live this long; a safety net for keys orphaned by data edits.
 * A generous TTL is a hit-rate knob, not a staleness risk: `dataHash` invalidates
 * entries instantly on any data edit. See ADR 0003.
 */
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Daily counters expire after two days — the date-stamped key rotates anyway. */
const SPEND_TTL_SECONDS = 2 * 24 * 60 * 60;

const DEFAULT_DAILY_CAP = 50;

/** Keywords longer than this are rejected before any LLM call. See ADR 0003. */
export const MAX_KEYWORDS_LENGTH = 200;

// ---- Result cache ---------------------------------------------------------

/**
 * Normalize keywords to a canonical token set so every phrasing of one intent
 * collapses to a single cache key: lowercase, strip punctuation, split on
 * whitespace, de-duplicate, and sort. `"Backend, Go"`, `"go backend"`, and
 * `"BACKEND  go"` all map to `"backend go"`. This affects the cache key only —
 * the original phrasing is still what reaches the LLM on a miss.
 */
function normalizeKeywords(keywords: string): string {
  const words = keywords
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return [...new Set(words)].sort().join(" ");
}

/**
 * The cache key for a request. Keywords are normalized (see
 * {@link normalizeKeywords}) so equivalent phrasings share one entry; folding
 * `dataHash` in means an edit to `resume.data.yaml` produces a new key space,
 * so stale results are never served.
 */
export function cacheKey(keywords: string, dataHash: string): string {
  return `cache:${dataHash}:${normalizeKeywords(keywords)}`;
}

/** Read and JSON-decode a cached result, or `null` on a miss. */
export async function getCached<T>(store: Store, key: string): Promise<T | null> {
  const raw = await store.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A corrupt entry is treated as a miss rather than failing the request.
    return null;
  }
}

/** JSON-encode and store a result under `key`. */
export async function setCached(store: Store, key: string, value: unknown): Promise<void> {
  await store.set(key, JSON.stringify(value), CACHE_TTL_SECONDS);
}

/**
 * Increment a fixed-window counter, setting its expiry on the first hit of the
 * window so the count resets cleanly. Shared by the rate limit and the daily cap.
 */
async function bumpCounter(store: Store, key: string, ttlSeconds: number): Promise<number> {
  const count = await store.incr(key);
  if (count === 1) await store.expire(key, ttlSeconds);
  return count;
}

// ---- Per-IP rate limit ----------------------------------------------------

/**
 * Record one request from `ip` against a fixed 60s window and report whether it
 * is within the limit. Returns `false` for the request that exceeds
 * {@link RATE_LIMIT} (the caller should answer 429).
 */
export async function checkRateLimit(store: Store, ip: string): Promise<boolean> {
  const count = await bumpCounter(store, `rl:${ip}`, RATE_WINDOW_SECONDS);
  return count <= RATE_LIMIT;
}

// ---- Daily spend cap ------------------------------------------------------

/** The configured daily request ceiling, or {@link DEFAULT_DAILY_CAP} if unset/invalid. */
export function dailyCap(): number {
  const raw = process.env.DAILY_REQUEST_CAP;
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_CAP;
}

/** The current UTC day as `YYYY-MM-DD`, used to date-stamp the spend counter. */
export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Count one LLM-consuming request against `day` and return the running total for
 * that day. The caller compares it to {@link dailyCap}; over-cap requests still
 * increment, which only keeps the counter pinned above the cap — the guarantee
 * (no more than `cap` requests reach the LLM) holds regardless.
 */
export async function recordSpend(store: Store, day: string = todayKey()): Promise<number> {
  return bumpCounter(store, `spend:${day}`, SPEND_TTL_SECONDS);
}
