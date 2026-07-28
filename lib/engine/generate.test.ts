import { describe, expect, it, vi } from "vitest";
import { parseResumeData } from "@/lib/data";
import { generateResume, type EngineDeps } from "./generate";
import type { Rephrase } from "./rephrase";
import type { Judge } from "./verify";

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
      - text: built api
        default: true
      - text: cut spend
        default: true
      - text: mentored
        default: false
  - company: Older
    title: T
    start: "2019-01"
    end: "2021-01"
    location: L
    bullets:
      - text: billing pipeline
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
    const rankBullets = vi.fn().mockResolvedValue(["p1b0", "p0b1", "p0b0"]);
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
    const rankBullets = vi.fn().mockResolvedValue(["p0b0", "p0b1", "p1b0"]);
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
    const rankBullets = vi.fn().mockResolvedValue(["p0b0"]);
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
