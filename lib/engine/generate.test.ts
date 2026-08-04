import { describe, expect, it, vi } from "vitest";
import { parseResumeData } from "@/lib/data";
import { generateResume, type EngineDeps } from "./generate";
import type { RankedBullet } from "./select";
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
