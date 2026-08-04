import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore, type Store } from "@/lib/redis";
import { MAX_KEYWORDS_LENGTH } from "@/lib/protect";

// Mock the Claude wrapper so the route never makes a network call. `rankCalls`
// counts SELECT invocations so we can prove a cache hit skips the LLM. The ranked
// Bullet ids are set per-test via `mockRanking` (surfacing no additives, since the
// real data is single-core); rephrase/judge are inert (no rewrites), so the route
// renders original wording.
let mockRanking: string[] = [];
let rankCalls = 0;
vi.mock("@/lib/llm", () => ({
  createRankBullets: () => async () => {
    rankCalls++;
    return mockRanking.map((id) => ({ id, fragmentIds: [] }));
  },
  createRephrase: () => async () => ({}),
  createJudge: () => async () => ({}),
}));

// A fresh in-memory store per test, so cache/rate-limit/spend state never leaks
// between cases. The route reaches Redis only through `getStore`.
let store: Store;
vi.mock("@/lib/redis", async () => {
  const actual = await vi.importActual<typeof import("@/lib/redis")>("@/lib/redis");
  return { ...actual, getStore: () => store };
});

import { POST } from "./route";

function post(body: unknown, ip = "1.2.3.4"): Request {
  return new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockRanking = [];
  rankCalls = 0;
  store = createMemoryStore();
});

describe("POST /api/generate", () => {
  it("returns a tailored selection as JSON on the happy path", async () => {
    // Three real ids from resume.data.yaml (Acme, Globex, Initech).
    mockRanking = ["p0b0", "p1b0", "p2b0"];
    const res = await POST(post({ keywords: "backend go billing" }));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.mode).toBe("tailored");
    expect(json.keywords).toBe("backend go billing");
    expect(typeof json.dataHash).toBe("string");
    const ids = json.positions.flatMap((p: { bullets: { id: string }[] }) =>
      p.bullets.map((b) => b.id),
    );
    // Positions reverse-chronological (Acme → Globex → Initech), one selected
    // Bullet each, in that order — the "ordered" part of the contract.
    expect(ids).toEqual(["p0b0", "p1b0", "p2b0"]);
  });

  it("falls back to the Default Resume when too few Bullets match", async () => {
    mockRanking = ["p0b0"]; // below the relevance floor
    const res = await POST(post({ keywords: "underwater basket weaving" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mode).toBe("default");
    expect(json.positions.length).toBeGreaterThan(0);
  });

  it("rejects a missing keywords field with 400", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
  });

  it("rejects blank keywords with 400", async () => {
    const res = await POST(post({ keywords: "   " }));
    expect(res.status).toBe(400);
  });

  it("serves an identical repeat request from cache without calling the LLM", async () => {
    mockRanking = ["p0b0", "p1b0", "p2b0"];

    const first = await POST(post({ keywords: "backend go billing" }));
    expect(first.status).toBe(200);
    expect(rankCalls).toBe(1);

    // Same keywords + unchanged data → cache hit, no second SELECT call.
    const second = await POST(post({ keywords: "backend go billing" }));
    expect(second.status).toBe(200);
    expect(rankCalls).toBe(1);
    expect(await second.json()).toEqual(await first.json());
  });

  it("rejects over-length keywords with 400, before any LLM or store call", async () => {
    // Track store touches so we can prove the guard runs before the cache/counter.
    let storeCalls = 0;
    const bare = store;
    store = new Proxy(bare, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return (...args: unknown[]) => {
            storeCalls++;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return value;
      },
    });

    const res = await POST(post({ keywords: "a".repeat(MAX_KEYWORDS_LENGTH + 1) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/keep keywords short/i);
    expect(rankCalls).toBe(0);
    expect(storeCalls).toBe(0);
  });

  it("returns 429 for the 6th request from an IP within a minute", async () => {
    mockRanking = ["p0b0", "p1b0", "p2b0"];
    // Distinct keywords each time so the cache never short-circuits the counter.
    for (let i = 0; i < 5; i++) {
      const ok = await POST(post({ keywords: `query number ${i}` }));
      expect(ok.status).toBe(200);
    }
    const blocked = await POST(post({ keywords: "query number 6" }));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toMatch(/too quickly/i);
  });

  it("returns a friendly 429 once the daily cap is exceeded", async () => {
    const original = process.env.DAILY_REQUEST_CAP;
    process.env.DAILY_REQUEST_CAP = "1";
    try {
      mockRanking = ["p0b0", "p1b0", "p2b0"];
      // First cache-miss request consumes the day's single allowed call.
      const first = await POST(post({ keywords: "first distinct query" }));
      expect(first.status).toBe(200);

      // Second distinct request is over the cap → friendly message, not a 500.
      const capped = await POST(post({ keywords: "second distinct query" }));
      expect(capped.status).toBe(429);
      expect((await capped.json()).error).toMatch(/tomorrow/i);
    } finally {
      if (original === undefined) delete process.env.DAILY_REQUEST_CAP;
      else process.env.DAILY_REQUEST_CAP = original;
    }
  });
});
