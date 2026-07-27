import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Claude wrapper so the route never makes a network call. The ranked
// ids are set per-test via `mockRanking`; rephrase/judge are inert (no rewrites),
// so the route renders original wording.
let mockRanking: string[] = [];
vi.mock("@/lib/llm", () => ({
  createRankBullets: () => async () => mockRanking,
  createRephrase: () => async () => ({}),
  createJudge: () => async () => ({}),
}));

import { POST } from "./route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockRanking = [];
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
});
