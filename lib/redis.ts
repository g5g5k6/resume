import { Redis } from "@upstash/redis";

/**
 * The tiny slice of Redis the protection layer needs (cache, rate-limit counters,
 * daily spend counter). Abstracting it behind an interface keeps the protection
 * logic ({@link ./protect}) testable against an in-memory fake — no live Redis in
 * unit tests — and lets the route swap the real Upstash client in production.
 *
 * Values are opaque strings; callers JSON-encode structured data themselves.
 */
export interface Store {
  get(key: string): Promise<string | null>;
  /** Set `key`, optionally expiring after `ttlSeconds`. */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** Atomically increment the integer at `key` (from 0 if unset) and return it. */
  incr(key: string): Promise<number>;
  /** (Re)set the expiry on an existing `key`. */
  expire(key: string, seconds: number): Promise<void>;
}

/**
 * A Map-backed {@link Store} with lazy TTL expiry. Serves two roles: the fixture
 * unit tests run against, and a graceful local-dev fallback when Upstash env vars
 * are absent. It is per-process, so on stateless serverless it would not share
 * state across invocations — production must configure Upstash for the guarantees
 * to hold.
 */
export function createMemoryStore(): Store {
  const entries = new Map<string, { value: string; expiresAt?: number }>();

  const live = (key: string): { value: string; expiresAt?: number } | undefined => {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    async get(key) {
      return live(key)?.value ?? null;
    },
    async set(key, value, ttlSeconds) {
      entries.set(key, {
        value,
        expiresAt: ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : undefined,
      });
    },
    async incr(key) {
      const entry = live(key);
      const next = (entry ? Number(entry.value) : 0) + 1;
      entries.set(key, { value: String(next), expiresAt: entry?.expiresAt });
      return next;
    },
    async expire(key, seconds) {
      const entry = live(key);
      if (entry) entry.expiresAt = Date.now() + seconds * 1000;
    },
  };
}

/** Wrap an Upstash REST client in the {@link Store} interface. */
function createUpstashStore(url: string, token: string): Store {
  // Disable auto-deserialization so `get` returns raw strings; the protection
  // layer owns JSON encoding and expects strings back.
  const redis = new Redis({ url, token, automaticDeserialization: false });

  return {
    async get(key) {
      return (await redis.get<string>(key)) ?? null;
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds !== undefined) {
        await redis.set(key, value, { ex: ttlSeconds });
      } else {
        await redis.set(key, value);
      }
    },
    async incr(key) {
      return await redis.incr(key);
    },
    async expire(key, seconds) {
      await redis.expire(key, seconds);
    },
  };
}

let store: Store | undefined;
let warnedFallback = false;

/**
 * The process-wide {@link Store}: Upstash when `UPSTASH_REDIS_REST_URL`/`_TOKEN`
 * are set, otherwise an in-memory fallback so local dev runs without provisioning
 * Redis. Memoized so a single client is reused across invocations within a warm
 * serverless instance.
 *
 * In production the fallback would silently defeat the cost guards (a per-process
 * store shares no state across stateless serverless instances), so a missing
 * config throws there rather than degrading quietly.
 */
export function getStore(): Store {
  if (store) return store;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    store = createUpstashStore(url, token);
    return store;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production; " +
        "the cache, rate limiting, and daily spend cap depend on shared Redis state.",
    );
  }

  if (!warnedFallback) {
    console.warn(
      "Upstash Redis env vars not set — using an in-memory store for local dev. " +
        "Cache, rate limiting, and the daily cap will not persist across processes.",
    );
    warnedFallback = true;
  }
  store = createMemoryStore();
  return store;
}
