import { afterEach, describe, expect, it } from "vitest";
import { createMemoryStore } from "./redis";
import {
  RATE_LIMIT,
  RATE_WINDOW_SECONDS,
  cacheKey,
  checkRateLimit,
  dailyCap,
  getCached,
  recordSpend,
  setCached,
} from "./protect";

describe("cacheKey", () => {
  it("is stable for the same keywords + dataHash", () => {
    expect(cacheKey("go backend", "abc123")).toBe(cacheKey("go backend", "abc123"));
  });

  it("changes when the dataHash changes (edits invalidate the entry)", () => {
    expect(cacheKey("go backend", "abc123")).not.toBe(cacheKey("go backend", "def456"));
  });

  it("changes when the keywords change", () => {
    expect(cacheKey("go backend", "abc123")).not.toBe(cacheKey("rust backend", "abc123"));
  });
});

describe("result cache", () => {
  it("round-trips a stored value", async () => {
    const store = createMemoryStore();
    const key = cacheKey("go backend", "abc123");
    expect(await getCached(store, key)).toBeNull();

    await setCached(store, key, { mode: "tailored", positions: [] });
    expect(await getCached(store, key)).toEqual({ mode: "tailored", positions: [] });
  });

  it("misses for a different dataHash after the data is edited", async () => {
    const store = createMemoryStore();
    await setCached(store, cacheKey("go backend", "old"), { mode: "tailored" });
    expect(await getCached(store, cacheKey("go backend", "new"))).toBeNull();
  });
});

describe("checkRateLimit", () => {
  it("allows up to the limit then rejects", async () => {
    const store = createMemoryStore();
    const results: boolean[] = [];
    for (let i = 0; i < RATE_LIMIT + 1; i++) {
      results.push(await checkRateLimit(store, "1.2.3.4"));
    }
    // First RATE_LIMIT allowed, the next one rejected.
    expect(results).toEqual([...Array(RATE_LIMIT).fill(true), false]);
  });

  it("tracks each IP independently", async () => {
    const store = createMemoryStore();
    for (let i = 0; i < RATE_LIMIT; i++) await checkRateLimit(store, "1.1.1.1");
    // A fresh IP is unaffected by another IP hitting its cap.
    expect(await checkRateLimit(store, "2.2.2.2")).toBe(true);
  });

  it("sets the window expiry on the first request only", async () => {
    const store = createMemoryStore();
    let expireCalls = 0;
    const spied = {
      ...store,
      expire: async (key: string, seconds: number) => {
        expireCalls++;
        expect(seconds).toBe(RATE_WINDOW_SECONDS);
        return store.expire(key, seconds);
      },
    };
    await checkRateLimit(spied, "9.9.9.9");
    await checkRateLimit(spied, "9.9.9.9");
    expect(expireCalls).toBe(1);
  });
});

describe("dailyCap", () => {
  const original = process.env.DAILY_REQUEST_CAP;
  afterEach(() => {
    if (original === undefined) delete process.env.DAILY_REQUEST_CAP;
    else process.env.DAILY_REQUEST_CAP = original;
  });

  it("reads the cap from the env var", () => {
    process.env.DAILY_REQUEST_CAP = "42";
    expect(dailyCap()).toBe(42);
  });

  it("defaults to 200 when unset or invalid", () => {
    delete process.env.DAILY_REQUEST_CAP;
    expect(dailyCap()).toBe(200);
    process.env.DAILY_REQUEST_CAP = "not-a-number";
    expect(dailyCap()).toBe(200);
  });
});

describe("recordSpend", () => {
  it("counts up across requests within the same day", async () => {
    const store = createMemoryStore();
    const day = "2026-07-27";
    expect(await recordSpend(store, day)).toBe(1);
    expect(await recordSpend(store, day)).toBe(2);
    expect(await recordSpend(store, day)).toBe(3);
  });

  it("counts each day separately", async () => {
    const store = createMemoryStore();
    await recordSpend(store, "2026-07-27");
    await recordSpend(store, "2026-07-27");
    expect(await recordSpend(store, "2026-07-28")).toBe(1);
  });
});
