import { describe, expect, it, vi } from "vitest";
import { parseResumeData } from "@/lib/data";
import { selectBullets } from "./select";

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
      - text: first
        default: true
      - text: second
        default: false
  - company: B
    title: T
    start: "2019-01"
    end: "2021-01"
    location: L
    bullets:
      - text: third
        default: true
`;

const data = parseResumeData(YAML); // ids: p0b0, p0b1, p1b0

describe("selectBullets", () => {
  it("passes every Bullet's id and text to the ranker", async () => {
    const rank = vi.fn().mockResolvedValue([]);
    await selectBullets("kw", data, rank);
    expect(rank).toHaveBeenCalledWith("kw", [
      { id: "p0b0", text: "first" },
      { id: "p0b1", text: "second" },
      { id: "p1b0", text: "third" },
    ]);
  });

  it("returns valid ids in the ranker's relevance order", async () => {
    const rank = vi.fn().mockResolvedValue(["p1b0", "p0b0"]);
    expect(await selectBullets("kw", data, rank)).toEqual(["p1b0", "p0b0"]);
  });

  it("drops unknown ids the model may hallucinate", async () => {
    const rank = vi.fn().mockResolvedValue(["p0b0", "p9b9", "nonsense"]);
    expect(await selectBullets("kw", data, rank)).toEqual(["p0b0"]);
  });

  it("de-duplicates repeated ids, keeping first occurrence", async () => {
    const rank = vi.fn().mockResolvedValue(["p0b0", "p1b0", "p0b0"]);
    expect(await selectBullets("kw", data, rank)).toEqual(["p0b0", "p1b0"]);
  });
});
