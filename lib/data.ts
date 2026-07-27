import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

/**
 * Loads, validates, and enriches the Owner's experience data from
 * `resume.data.yaml`. Bullet IDs (`p{posIdx}b{bulletIdx}`) are assigned here at
 * load time — they are never stored in the file — and a `dataHash` of the raw
 * file contents is computed so downstream caches invalidate when the data changes.
 */

const MONTH = /^\d{4}-\d{2}$/;

/** The literal an ongoing Position uses for its `end` date. */
export const PRESENT = "present";

/**
 * Sort key for {@link PRESENT}: larger than any real month, but finite so that
 * two ongoing Positions compare equal (`key - key === 0`) and fall through to
 * the start-date tiebreak instead of producing `NaN`.
 */
const PRESENT_MONTH_KEY = Number.MAX_SAFE_INTEGER;

const rawBulletSchema = z.object({
  text: z.string().min(1),
  default: z.boolean(),
});

const rawPositionSchema = z.object({
  company: z.string().min(1),
  title: z.string().min(1),
  start: z.string().regex(MONTH, "start must be YYYY-MM"),
  end: z.union([z.string().regex(MONTH, "end must be YYYY-MM"), z.literal(PRESENT)]),
  location: z.string().min(1),
  bullets: z.array(rawBulletSchema).min(1),
});

const rawDataSchema = z.object({
  owner: z.object({
    name: z.string().min(1),
    headline: z.string().min(1),
    contact: z.object({
      email: z.string().min(1),
      location: z.string().min(1),
      links: z.array(z.string()),
    }),
  }),
  positions: z.array(rawPositionSchema).min(1),
});

export type Owner = z.infer<typeof rawDataSchema>["owner"];

export interface Bullet {
  /** Deterministic, assigned at load: `p{posIdx}b{bulletIdx}`. */
  id: string;
  text: string;
  default: boolean;
}

export interface Position {
  company: string;
  title: string;
  /** `YYYY-MM`. */
  start: string;
  /** `YYYY-MM` or the literal `"present"`. */
  end: string;
  location: string;
  bullets: Bullet[];
}

export interface ResumeData {
  owner: Owner;
  positions: Position[];
  /** Hash of the raw file contents; changes whenever the data changes. */
  dataHash: string;
}

export const DEFAULT_DATA_PATH = path.join(process.cwd(), "resume.data.yaml");

/**
 * Parse and validate raw YAML text into a {@link ResumeData}, assigning Bullet
 * IDs and computing the `dataHash`. Throws a readable error on malformed input.
 */
export function parseResumeData(rawText: string): ResumeData {
  let parsed: unknown;
  try {
    parsed = parse(rawText);
  } catch (err) {
    throw new Error(`resume.data.yaml is not valid YAML: ${(err as Error).message}`);
  }

  const result = rawDataSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`resume.data.yaml failed validation:\n${issues}`);
  }

  const { owner, positions } = result.data;

  const enriched: Position[] = positions.map((position, posIdx) => ({
    ...position,
    bullets: position.bullets.map((bullet, bulletIdx) => ({
      ...bullet,
      id: `p${posIdx}b${bulletIdx}`,
    })),
  }));

  const dataHash = createHash("sha256").update(rawText).digest("hex").slice(0, 16);

  return { owner, positions: enriched, dataHash };
}

/** Read and parse the resume data file from disk. */
export function loadResumeData(filePath: string = DEFAULT_DATA_PATH): ResumeData {
  let rawText: string;
  try {
    rawText = readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(`Could not read resume data at ${filePath}: ${(err as Error).message}`);
  }
  return parseResumeData(rawText);
}

/**
 * Sortable key for a `YYYY-MM` month or `"present"`. `"present"` sorts after any
 * real month so ongoing Positions come first in reverse-chronological order.
 */
export function monthKey(value: string): number {
  if (value === PRESENT) return PRESENT_MONTH_KEY;
  const [year, month] = value.split("-").map(Number);
  return year * 12 + (month - 1);
}

/**
 * Sort Positions reverse-chronologically (most recent first) by end date, then
 * start date. Returns a new array; the input is not mutated.
 */
export function sortByReverseChronology(positions: Position[]): Position[] {
  return [...positions].sort((a, b) => {
    const endDiff = monthKey(b.end) - monthKey(a.end);
    if (endDiff !== 0) return endDiff;
    return monthKey(b.start) - monthKey(a.start);
  });
}

/**
 * The Default Resume: Positions in reverse-chronological order, each carrying
 * only its `default: true` Bullets in original order. Positions with no default
 * Bullets are omitted.
 */
export function getDefaultResume(data: ResumeData): Position[] {
  const withDefaults = data.positions
    .map((position) => ({
      ...position,
      bullets: position.bullets.filter((b) => b.default),
    }))
    .filter((position) => position.bullets.length > 0);
  return sortByReverseChronology(withDefaults);
}
