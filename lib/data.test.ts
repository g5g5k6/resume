import { describe, expect, it } from "vitest";
import {
  getDefaultResume,
  loadResumeData,
  monthKey,
  parseResumeData,
  type ResumeData,
} from "./data";

const VALID_YAML = `
owner:
  name: Test Owner
  headline: Backend Engineer
  contact:
    email: test@example.com
    location: Somewhere
    links:
      - https://example.com
positions:
  - company: Newer Co
    title: Senior Engineer
    start: "2023-01"
    end: present
    location: Remote
    bullets:
      - text: Recent default bullet
        default: true
      - text: Recent non-default bullet
        default: false
  - company: Older Co
    title: Engineer
    start: "2019-01"
    end: "2021-06"
    location: Onsite
    bullets:
      - text: Old default bullet
        default: true
      - text: Another old default bullet
        default: true
`;

describe("parseResumeData — validation", () => {
  it("parses a well-formed file", () => {
    const data = parseResumeData(VALID_YAML);
    expect(data.owner.name).toBe("Test Owner");
    expect(data.positions).toHaveLength(2);
  });

  it("throws loudly on invalid YAML syntax", () => {
    expect(() => parseResumeData("owner: [unclosed")).toThrow(/not valid YAML/);
  });

  it("throws when a required owner field is missing", () => {
    const bad = VALID_YAML.replace("  name: Test Owner\n", "");
    expect(() => parseResumeData(bad)).toThrow(/failed validation/);
  });

  it("throws when a position has no bullets", () => {
    const bad = `
owner:
  name: X
  headline: Y
  contact: { email: a@b.c, location: Z, links: [] }
positions:
  - company: C
    title: T
    start: "2020-01"
    end: present
    location: L
    bullets: []
`;
    expect(() => parseResumeData(bad)).toThrow(/failed validation/);
  });

  it("throws when a date is not YYYY-MM", () => {
    const bad = VALID_YAML.replace('start: "2023-01"', 'start: "January 2023"');
    expect(() => parseResumeData(bad)).toThrow(/failed validation/);
  });

  it("throws when default is missing on a bullet", () => {
    const bad = VALID_YAML.replace("        default: true\n", "");
    expect(() => parseResumeData(bad)).toThrow(/failed validation/);
  });
});

describe("parseResumeData — Bullet ID assignment", () => {
  it("assigns deterministic p{posIdx}b{bulletIdx} ids", () => {
    const data = parseResumeData(VALID_YAML);
    expect(data.positions[0].bullets.map((b) => b.id)).toEqual(["p0b0", "p0b1"]);
    expect(data.positions[1].bullets.map((b) => b.id)).toEqual(["p1b0", "p1b1"]);
  });

  it("produces unique ids across the whole file", () => {
    const data = parseResumeData(VALID_YAML);
    const ids = data.positions.flatMap((p) => p.bullets.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("parseResumeData — dataHash", () => {
  it("is stable for identical input", () => {
    expect(parseResumeData(VALID_YAML).dataHash).toBe(parseResumeData(VALID_YAML).dataHash);
  });

  it("changes when the data changes", () => {
    const a = parseResumeData(VALID_YAML).dataHash;
    const b = parseResumeData(VALID_YAML.replace("Recent default bullet", "Edited")).dataHash;
    expect(a).not.toBe(b);
  });
});

describe("monthKey", () => {
  it("orders present after any real month", () => {
    expect(monthKey("present")).toBeGreaterThan(monthKey("2099-12"));
  });

  it("orders later months higher", () => {
    expect(monthKey("2023-06")).toBeGreaterThan(monthKey("2023-01"));
    expect(monthKey("2024-01")).toBeGreaterThan(monthKey("2023-12"));
  });
});

describe("getDefaultResume — ordering and grouping", () => {
  const data = parseResumeData(VALID_YAML);

  it("returns positions reverse-chronologically", () => {
    const positions = getDefaultResume(data);
    expect(positions.map((p) => p.company)).toEqual(["Newer Co", "Older Co"]);
  });

  it("keeps only default: true bullets", () => {
    const positions = getDefaultResume(data);
    expect(positions[0].bullets.map((b) => b.text)).toEqual(["Recent default bullet"]);
    expect(positions[1].bullets.map((b) => b.text)).toEqual([
      "Old default bullet",
      "Another old default bullet",
    ]);
  });

  it("preserves original wording", () => {
    const positions = getDefaultResume(data);
    expect(positions[0].bullets[0].text).toBe("Recent default bullet");
  });

  it("breaks ties by start date when two positions are both ongoing", () => {
    const twoPresent: ResumeData = {
      ...data,
      positions: [
        { ...data.positions[1], company: "Older Present", start: "2018-01", end: "present" },
        { ...data.positions[0], company: "Newer Present", start: "2024-01", end: "present" },
      ],
    };
    const positions = getDefaultResume(twoPresent);
    expect(positions.map((p) => p.company)).toEqual(["Newer Present", "Older Present"]);
  });

  it("omits positions with no default bullets", () => {
    const noDefaults: ResumeData = {
      ...data,
      positions: [
        {
          ...data.positions[0],
          bullets: data.positions[0].bullets.map((b) => ({ ...b, default: false })),
        },
        data.positions[1],
      ],
    };
    const positions = getDefaultResume(noDefaults);
    expect(positions.map((p) => p.company)).toEqual(["Older Co"]);
  });
});

describe("loadResumeData — real file", () => {
  it("loads and validates resume.data.yaml from disk", () => {
    const data = loadResumeData();
    expect(data.owner.name).toBeTruthy();
    expect(data.positions.length).toBeGreaterThanOrEqual(2);
    const defaults = getDefaultResume(data);
    expect(defaults.length).toBeGreaterThan(0);
    expect(defaults.every((p) => p.bullets.every((b) => b.default))).toBe(true);
  });
});
