import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseResumeData } from "@/lib/data";
import { generateResume, type EngineDeps } from "./generate";
import type { RankBullets, RankedBullet } from "./select";
import type { Rephrase } from "./rephrase";
import type { Judge } from "./verify";

/** Terse RankedBullet builder: `r("p0b0")` or `r("p0b0", "p0b0f1")`. */
const r = (id: string, ...fragmentIds: string[]): RankedBullet => ({ id, fragmentIds });

const YAML = `
owner:
  name: James
  headline: Backend Engineer
  contact: { email: a@b.c, location: Taipei, links: [] }
positions:
  - company: Newer
    title: T
    start: "2023-01"
    end: present
    location: L
    bullets:
      - fragments:
          - text: built api
            core: true
        default: true
      - fragments:
          - text: cut spend
            core: true
        default: true
      - fragments:
          - text: mentored
            core: true
        default: false
  - company: Older
    title: T
    start: "2019-01"
    end: "2021-01"
    location: L
    bullets:
      - fragments:
          - text: billing pipeline
            core: true
        default: true
`;

// The engine emits a per-request phrasing line and reports stage outages; only the
// log suite below asserts on them, so keep the rest of this file's output clean.
beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const data = parseResumeData(YAML);
// ids: Newer p0b0,p0b1,p0b2 · Older p1b0

// Default stages: no rewrites (everything falls back to original), empty judge.
const noRewrites: Rephrase = async () => ({});
const emptyJudge: Judge = async () => ({});

function deps(over: Partial<EngineDeps> = {}): EngineDeps {
  return {
    rankBullets: vi.fn().mockResolvedValue([]),
    rephrase: noRewrites,
    judge: emptyJudge,
    ...over,
  };
}

describe("generateResume — happy path (>= floor matches)", () => {
  it("returns a tailored resume ordered by relevance within reverse-chron Positions", async () => {
    const rankBullets = vi.fn().mockResolvedValue([r("p1b0"), r("p0b1"), r("p0b0")]);
    const result = await generateResume("go billing api", data, deps({ rankBullets }));

    expect(result.mode).toBe("tailored");
    expect(result.keywords).toBe("go billing api");
    expect(result.dataHash).toBe(data.dataHash);
    // Positions reverse-chronological even though Older ranked first.
    expect(result.positions.map((p) => p.company)).toEqual(["Newer", "Older"]);
    // Within Newer, relevance order (p0b1 before p0b0).
    expect(result.positions[0].bullets.map((b) => b.text)).toEqual(["cut spend", "built api"]);
  });

  it("applies verified rewrites to the rendered text", async () => {
    const rankBullets = vi.fn().mockResolvedValue([r("p0b0"), r("p0b1"), r("p1b0")]);
    const rephrase: Rephrase = async () => ({
      p0b0: "built api", // unchanged
      p0b1: "reduced spend", // faithful rewrite (no new numbers/nouns)
      p1b0: "billing pipeline",
    });
    const judge: Judge = async () => ({ p0b1: true });
    const result = await generateResume("kw", data, deps({ rankBullets, rephrase, judge }));

    const texts = result.positions.flatMap((p) => p.bullets.map((b) => b.text));
    expect(texts).toContain("reduced spend");
    expect(texts).not.toContain("mentored"); // p0b2 not selected
  });
});

describe("generateResume — relevance floor (< 3 matches → Default Resume)", () => {
  it("falls back to the Default Resume when the model returns too few matches", async () => {
    const rankBullets = vi.fn().mockResolvedValue([r("p0b0")]);
    const rephrase = vi.fn(noRewrites);
    const result = await generateResume("astrophysics", data, deps({ rankBullets, rephrase }));

    expect(result.mode).toBe("default");
    // Default Resume = all default:true bullets in original wording; no rephrase.
    expect(rephrase).not.toHaveBeenCalled();
    const texts = result.positions.flatMap((p) => p.bullets.map((b) => b.text));
    expect(texts).toEqual(["built api", "cut spend", "billing pipeline"]);
  });

  it("falls back to the Default Resume when nothing matches", async () => {
    const rankBullets = vi.fn().mockResolvedValue([]);
    const result = await generateResume("nonsense", data, deps({ rankBullets }));
    expect(result.mode).toBe("default");
    expect(result.positions.length).toBeGreaterThan(0);
  });
});

// A Bullet with two additive Fragments (throughput vs latency) so FACET-SELECT
// can surface different facts of the same accomplishment across Keywords.
const FACET_YAML = `
owner:
  name: James
  headline: Backend Engineer
  contact: { email: a@b.c, location: Taipei, links: [] }
positions:
  - company: Acme
    title: T
    start: "2023-01"
    end: present
    location: L
    bullets:
      - fragments:
          - text: Built a data platform
            core: true
          - text: handling 2M requests/day
          - text: at p99 under 80ms
        default: true
      - fragments:
          - text: Led the platform team
            core: true
        default: true
      - fragments:
          - text: Cut infra cost by half
            core: true
        default: true
`;
// p0b0: core p0b0f0 + additives p0b0f1 (throughput), p0b0f2 (latency) · p0b1 · p0b2
const facetData = parseResumeData(FACET_YAML);
const textOf = (result: { positions: { bullets: { id: string; text: string }[] }[] }, id: string) =>
  result.positions.flatMap((p) => p.bullets).find((b) => b.id === id)!.text;

describe("generateResume — FACET-SELECT content variety", () => {
  it("surfaces different additive Fragments of the same Bullet across Keywords", async () => {
    const throughput = await generateResume(
      "high throughput",
      facetData,
      deps({ rankBullets: async () => [r("p0b0", "p0b0f1"), r("p0b1"), r("p0b2")] }),
    );
    const latency = await generateResume(
      "low latency",
      facetData,
      deps({ rankBullets: async () => [r("p0b0", "p0b0f2"), r("p0b1"), r("p0b2")] }),
    );

    expect(textOf(throughput, "p0b0")).toBe("Built a data platform handling 2M requests/day");
    expect(textOf(latency, "p0b0")).toBe("Built a data platform at p99 under 80ms");
    // Each surfaces its own fact and omits the irrelevant one.
    expect(textOf(throughput, "p0b0")).not.toContain("p99");
    expect(textOf(latency, "p0b0")).not.toContain("2M");
  });

  it("always renders the core, even when no additive Fragment is surfaced", async () => {
    const result = await generateResume(
      "leadership",
      facetData,
      deps({ rankBullets: async () => [r("p0b0"), r("p0b1"), r("p0b2")] }),
    );
    expect(textOf(result, "p0b0")).toBe("Built a data platform");
  });

  it("reverts a hallucinated token from a dropped Fragment (VERIFY vs surfaced subset)", async () => {
    // Surface only latency (p0b0f2); throughput (p0b0f1, with "2M") is dropped.
    const rankBullets = async () => [r("p0b0", "p0b0f2"), r("p0b1"), r("p0b2")];
    // REPHRASE smuggles the dropped fact's number back in.
    const rephrase: Rephrase = async () => ({
      p0b0: "Built a data platform handling 2M requests/day at p99 under 80ms",
    });
    // Even a fully-permissive judge cannot save it — the deterministic gate reverts
    // first, because "2M" is absent from the surfaced subset.
    const judge: Judge = async () => ({ p0b0: true });
    const result = await generateResume(
      "low latency",
      facetData,
      deps({ rankBullets, rephrase, judge }),
    );

    expect(textOf(result, "p0b0")).toBe("Built a data platform at p99 under 80ms");
    expect(textOf(result, "p0b0")).not.toContain("2M");
  });
});

/**
 * A stage outage is the per-Bullet fallback REPHRASE and VERIFY already implement,
 * at n=all — not new tolerance (ADR 0006). Driven through the existing dependency
 * seam with fakes that reject; no new seam.
 */
describe("generateResume — per-stage degradation", () => {
  const outage = () => new Error("stage unavailable");
  /** Faithful rewrites: they clear the deterministic gate, so the judge is reached. */
  const rewritesAll: Rephrase = async () => ({
    p0b0: "shipped api",
    p0b1: "reduced spend",
    p1b0: "ran billing",
  });
  const ORIGINALS = ["built api", "cut spend", "billing pipeline"];
  const rankAll = async () => [r("p0b0"), r("p0b1"), r("p1b0")];

  it("keeps the Owner's original wording when REPHRASE is unavailable", async () => {
    const rephrase: Rephrase = async () => {
      throw outage();
    };
    const result = await generateResume("kw", data, deps({ rankBullets: rankAll, rephrase }));

    // Still a Tailored Resume, still ordered — only the rewording is missing.
    expect(result.mode).toBe("tailored");
    expect(result.positions.map((p) => p.company)).toEqual(["Newer", "Older"]);
    expect(result.positions.flatMap((p) => p.bullets.map((b) => b.text))).toEqual(ORIGINALS);
  });

  it("still surfaces the Keyword-relevant Fragments when REPHRASE is unavailable", async () => {
    // FACET-SELECT ran before the failing call, so content variety survives and
    // only sentence variety is lost — ADR 0004's two levers, degrading apart.
    const rephrase: Rephrase = async () => {
      throw outage();
    };
    const latency = await generateResume(
      "low latency",
      facetData,
      deps({ rankBullets: async () => [r("p0b0", "p0b0f2"), r("p0b1"), r("p0b2")], rephrase }),
    );

    expect(textOf(latency, "p0b0")).toBe("Built a data platform at p99 under 80ms");
    expect(textOf(latency, "p0b0")).not.toContain("2M");
  });

  it("reverts every rewrite to its surfaced original when JUDGE is unavailable", async () => {
    const judge: Judge = async () => {
      throw outage();
    };
    const result = await generateResume(
      "kw",
      data,
      deps({ rankBullets: rankAll, rephrase: rewritesAll, judge }),
    );

    expect(result.mode).toBe("tailored");
    // No rewrite survives a judge that never answered.
    expect(result.positions.flatMap((p) => p.bullets.map((b) => b.text))).toEqual(ORIGINALS);
  });

  it("fails the request when SELECT is unavailable — nothing was ranked", async () => {
    const rankBullets = async () => {
      throw outage();
    };
    await expect(generateResume("kw", data, deps({ rankBullets }))).rejects.toThrow(
      "stage unavailable",
    );
  });

  // Each stage gets its own non-retry case: the spend counter increments once per
  // cache-miss request, before any Claude call, so a retry would falsify ADR 0003's
  // bound invisibly.
  it("does not retry REPHRASE", async () => {
    const rephrase = vi.fn<Rephrase>(async () => {
      throw outage();
    });
    await generateResume("kw", data, deps({ rankBullets: rankAll, rephrase }));
    expect(rephrase).toHaveBeenCalledTimes(1);
  });

  it("does not retry JUDGE", async () => {
    // Rewrites that survive the deterministic gate, so the judge is actually called.
    const judge = vi.fn<Judge>(async () => {
      throw outage();
    });
    await generateResume("kw", data, deps({ rankBullets: rankAll, rephrase: rewritesAll, judge }));
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("does not retry SELECT", async () => {
    const rankBullets = vi.fn<RankBullets>(async () => {
      throw outage();
    });
    await expect(generateResume("kw", data, deps({ rankBullets }))).rejects.toThrow();
    expect(rankBullets).toHaveBeenCalledTimes(1);
  });

  it("reports the cause, since a degraded response otherwise looks normal", async () => {
    // The route sees a resume that returned fine, so this log is the only trace an
    // Owner has that rephrasing was down.
    const rephrase: Rephrase = async () => {
      throw outage();
    };
    await generateResume("kw", data, deps({ rankBullets: rankAll, rephrase }));

    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining("REPHRASE"),
      expect.any(Error),
    );
  });
});

/**
 * The log line is where "is rephrasing working?" gets answered. It has to separate
 * an outage (nothing tuned, with a stage cause) from a quiet stretch of Claude
 * returning good originals (nothing tuned, no cause) — a distinction no count and
 * no boolean can make on its own (ADR 0006).
 */
describe("generateResume — per-request phrasing log", () => {
  const rankAll = async () => [r("p0b0"), r("p0b1"), r("p1b0")];

  /** The file-level spy, which this suite reads rather than merely silences. */
  const logged = () => vi.mocked(console.info);

  /** The one structured line this request emitted, parsed back. */
  const line = () => {
    expect(logged()).toHaveBeenCalledTimes(1);
    return JSON.parse(logged().mock.calls[0][0] as string);
  };

  it("counts every Bullet whose phrasing Claude tuned", async () => {
    const rephrase: Rephrase = async () => ({
      p0b0: "shipped api",
      p0b1: "reduced spend",
      p1b0: "ran billing",
    });
    const judge: Judge = async () => ({ p0b0: true, p0b1: true, p1b0: true });
    await generateResume("kw", data, deps({ rankBullets: rankAll, rephrase, judge }));

    expect(line()).toMatchObject({ mode: "tailored", tuned: 3, original: 0, causes: {} });
  });

  it("separates a quiet stretch of good originals from an outage", async () => {
    // Claude answered fine and simply returned nothing worth changing.
    await generateResume("kw", data, deps({ rankBullets: rankAll }));

    expect(line()).toMatchObject({
      tuned: 0,
      original: 3,
      causes: { "not-rewritten": 3 },
    });
  });

  it("names REPHRASE as the cause when the engine caught its failure", async () => {
    const rephrase: Rephrase = async () => {
      throw new Error("stage unavailable");
    };
    await generateResume("kw", data, deps({ rankBullets: rankAll, rephrase }));

    // Same zero tuned count as the quiet stretch above — the cause is what tells
    // the two apart, and only the engine knows it, because it caught the throw.
    expect(line()).toMatchObject({
      tuned: 0,
      original: 3,
      causes: { "rephrase-unavailable": 3 },
    });
  });

  it("names JUDGE as the cause when the engine caught its failure", async () => {
    const rephrase: Rephrase = async () => ({
      p0b0: "shipped api",
      p0b1: "reduced spend",
      p1b0: "ran billing",
    });
    const judge: Judge = async () => {
      throw new Error("stage unavailable");
    };
    await generateResume("kw", data, deps({ rankBullets: rankAll, rephrase, judge }));

    expect(line()).toMatchObject({
      tuned: 0,
      original: 3,
      causes: { "judge-unavailable": 3 },
    });
  });

  it("breaks a mixed request down by cause", async () => {
    const rephrase: Rephrase = async () => ({
      p0b0: "shipped api", // judge says yes → tuned
      p0b1: "cut spend 5M", // new number → deterministic gate reverts
      p1b0: "ran billing", // judge says no → reverted
    });
    const judge: Judge = async () => ({ p0b0: true, p1b0: false });
    await generateResume("kw", data, deps({ rankBullets: rankAll, rephrase, judge }));

    expect(line()).toMatchObject({
      tuned: 1,
      original: 2,
      causes: { "reverted-by-gate": 1, "reverted-by-judge": 1 },
    });
  });

  it("logs the Default Resume path too, where no phrasing decision was made", async () => {
    await generateResume("nonsense", data, deps({ rankBullets: async () => [] }));
    expect(line()).toMatchObject({ mode: "default", tuned: 0, original: 0, causes: {} });
  });

  it("emits no phrasing line when SELECT fails — nothing was phrased", async () => {
    // A hard failure must not look like a Default Resume with nothing tuned.
    const rankBullets = async () => {
      throw new Error("stage unavailable");
    };
    await expect(generateResume("kw", data, deps({ rankBullets }))).rejects.toThrow();
    expect(logged()).not.toHaveBeenCalled();
  });

  it("puts nothing about degradation on the wire", async () => {
    const rephrase: Rephrase = async () => {
      throw new Error("stage unavailable");
    };
    const result = await generateResume("kw", data, deps({ rankBullets: rankAll, rephrase }));

    // `mode` still answers only the relevance-floor question; the HR User sees
    // the same two values and no new field.
    expect(result.mode).toBe("tailored");
    expect(Object.keys(result).sort()).toEqual([
      "dataHash",
      "keywords",
      "mode",
      "owner",
      "positions",
    ]);
  });
});
