import { describe, expect, it, vi } from "vitest";
import { parseResumeData } from "@/lib/data";
import { generateResume } from "./generate";

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

describe("generateResume — happy path (>= floor matches)", () => {
  it("returns a tailored resume ordered by relevance within reverse-chron Positions", async () => {
    // Model ranks: Older's bullet most relevant, then two Newer bullets.
    const rank = vi.fn().mockResolvedValue(["p1b0", "p0b1", "p0b0"]);
    const result = await generateResume("go billing api", data, rank);

    expect(result.mode).toBe("tailored");
    expect(result.keywords).toBe("go billing api");
    expect(result.dataHash).toBe(data.dataHash);
    // Positions reverse-chronological even though Older ranked first.
    expect(result.positions.map((p) => p.company)).toEqual(["Newer", "Older"]);
    // Within Newer, relevance order (p0b1 before p0b0).
    expect(result.positions[0].bullets.map((b) => b.text)).toEqual(["cut spend", "built api"]);
  });

  it("only includes selected Bullets, in the Owner's original wording", async () => {
    const rank = vi.fn().mockResolvedValue(["p0b0", "p0b1", "p1b0"]);
    const result = await generateResume("kw", data, rank);
    const texts = result.positions.flatMap((p) => p.bullets.map((b) => b.text));
    expect(texts).toEqual(["built api", "cut spend", "billing pipeline"]);
    expect(texts).not.toContain("mentored"); // p0b2 was not selected
  });
});

describe("generateResume — relevance floor (< 3 matches → Default Resume)", () => {
  it("falls back to the Default Resume when the model returns too few matches", async () => {
    const rank = vi.fn().mockResolvedValue(["p0b0"]);
    const result = await generateResume("astrophysics", data, rank);

    expect(result.mode).toBe("default");
    // Default Resume = all default:true bullets (excludes p0b2 "mentored").
    const texts = result.positions.flatMap((p) => p.bullets.map((b) => b.text));
    expect(texts).toEqual(["built api", "cut spend", "billing pipeline"]);
  });

  it("falls back to the Default Resume when nothing matches", async () => {
    const rank = vi.fn().mockResolvedValue([]);
    const result = await generateResume("nonsense", data, rank);
    expect(result.mode).toBe("default");
    expect(result.positions.length).toBeGreaterThan(0);
  });
});
