import { describe, expect, it, vi } from "vitest";
import { parseResumeData } from "@/lib/data";
import { selectBullets, type RankedBullet } from "./select";

const YAML = `
owner:
  name: X
  headline: Y
  contact: { email: a@b.c, location: Z, links: [] }
positions:
  - company: A
    title: T
    start: "2022-01"
    end: present
    location: L
    bullets:
      - fragments:
          - text: first
            core: true
          - text: at low latency
          - text: for millions of users
        default: true
      - fragments:
          - text: second
            core: true
        default: false
  - company: B
    title: T
    start: "2019-01"
    end: "2021-01"
    location: L
    bullets:
      - fragments:
          - text: third
            core: true
        default: true
`;

// p0b0: core p0b0f0 + additives p0b0f1, p0b0f2 · p0b1: core p0b1f0 · p1b0: core p1b0f0
const data = parseResumeData(YAML);

const ranked = (id: string, fragmentIds: string[] = []): RankedBullet => ({ id, fragmentIds });

describe("selectBullets", () => {
  it("passes each Bullet's id, ranking text, and additive Fragments to the ranker", async () => {
    const rank = vi.fn().mockResolvedValue([]);
    await selectBullets("kw", data, rank);
    expect(rank).toHaveBeenCalledWith("kw", [
      {
        id: "p0b0",
        text: "first at low latency for millions of users",
        additives: [
          { id: "p0b0f1", text: "at low latency" },
          { id: "p0b0f2", text: "for millions of users" },
        ],
      },
      { id: "p0b1", text: "second", additives: [] },
      { id: "p1b0", text: "third", additives: [] },
    ]);
  });

  it("returns valid Bullets in the ranker's relevance order", async () => {
    const rank = vi.fn().mockResolvedValue([ranked("p1b0"), ranked("p0b0")]);
    expect((await selectBullets("kw", data, rank)).map((r) => r.id)).toEqual(["p1b0", "p0b0"]);
  });

  it("keeps the Keyword-relevant additive Fragment ids per Bullet", async () => {
    const rank = vi.fn().mockResolvedValue([ranked("p0b0", ["p0b0f2"])]);
    const result = await selectBullets("kw", data, rank);
    expect(result).toEqual([{ id: "p0b0", fragmentIds: ["p0b0f2"] }]);
  });

  it("drops unknown Bullet ids the model may hallucinate", async () => {
    const rank = vi.fn().mockResolvedValue([ranked("p0b0"), ranked("p9b9"), ranked("nonsense")]);
    expect((await selectBullets("kw", data, rank)).map((r) => r.id)).toEqual(["p0b0"]);
  });

  it("de-duplicates repeated Bullet ids, keeping first occurrence", async () => {
    const rank = vi.fn().mockResolvedValue([ranked("p0b0"), ranked("p1b0"), ranked("p0b0")]);
    expect((await selectBullets("kw", data, rank)).map((r) => r.id)).toEqual(["p0b0", "p1b0"]);
  });

  it("narrows fragmentIds to the Bullet's own additives — drops core, foreign, unknown", async () => {
    // p0b0f0 is the core (not listable), p0b1f0 belongs to another Bullet, zzz is bogus.
    const rank = vi
      .fn()
      .mockResolvedValue([ranked("p0b0", ["p0b0f1", "p0b0f0", "p0b1f0", "zzz", "p0b0f1"])]);
    const result = await selectBullets("kw", data, rank);
    expect(result).toEqual([{ id: "p0b0", fragmentIds: ["p0b0f1"] }]);
  });
});
