import { describe, expect, it } from "vitest";
import { parseResumeData } from "@/lib/data";
import { orderByRelevance } from "./order";

const YAML = `
owner:
  name: X
  headline: Y
  contact: { email: a@b.c, location: Z, links: [] }
positions:
  - company: Newer
    title: T
    start: "2023-01"
    end: present
    location: L
    bullets:
      - fragments:
          - text: n-first
            core: true
        default: true
      - fragments:
          - text: n-second
            core: true
        default: false
  - company: Older
    title: T
    start: "2019-01"
    end: "2021-01"
    location: L
    bullets:
      - fragments:
          - text: o-first
            core: true
        default: true
`;

const data = parseResumeData(YAML); // Newer: p0b0,p0b1 · Older: p1b0

describe("orderByRelevance", () => {
  it("orders Positions reverse-chronologically regardless of relevance rank", () => {
    // Older Position's bullet is ranked most relevant, but Newer still comes first.
    const positions = orderByRelevance(data, ["p1b0", "p0b0"]);
    expect(positions.map((p) => p.company)).toEqual(["Newer", "Older"]);
  });

  it("orders Bullets within a Position by relevance rank", () => {
    const positions = orderByRelevance(data, ["p0b1", "p0b0"]);
    expect(positions[0].bullets.map((b) => b.text)).toEqual(["n-second", "n-first"]);
  });

  it("keeps only selected Bullets and drops Positions with none", () => {
    const positions = orderByRelevance(data, ["p0b0"]);
    expect(positions.map((p) => p.company)).toEqual(["Newer"]);
    expect(positions[0].bullets.map((b) => b.id)).toEqual(["p0b0"]);
  });

  it("preserves the Owner's original wording", () => {
    const positions = orderByRelevance(data, ["p0b0"]);
    expect(positions[0].bullets[0].text).toBe("n-first");
  });
});
