import { readFileSync, existsSync } from "node:fs";
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

const rawFragmentSchema = z.object({
  text: z.string().min(1),
  /** Marks the one Fragment carrying the verb/spine. Exactly one per Bullet. */
  core: z.boolean().optional(),
});

const rawBulletSchema = z
  .object({
    fragments: z.array(rawFragmentSchema).min(1),
    default: z.boolean(),
  })
  .superRefine((bullet, ctx) => {
    const cores = bullet.fragments.filter((f) => f.core === true).length;
    if (cores !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a Bullet must have exactly one core Fragment, found ${cores}`,
        path: ["fragments"],
      });
    }
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

/**
 * Separator used to join a Bullet's Fragments into its canonical text. A single
 * space, so additive clauses append cleanly after the core (see ADR 0004).
 */
export const FRAGMENT_SEPARATOR = " ";

export interface Fragment {
  /** Deterministic, assigned at load in authored order: `p{posIdx}b{bulletIdx}f{fragIdx}`. */
  id: string;
  text: string;
  /** True for the single spine Fragment; false for additives. */
  core: boolean;
}

export interface Bullet {
  /** Deterministic, assigned at load: `p{posIdx}b{bulletIdx}`. */
  id: string;
  /** The Owner's authored Fragments, in authored order. Exactly one is `core`. */
  fragments: Fragment[];
  /**
   * Canonical joined text: core first, then additives in authored order, joined
   * by {@link FRAGMENT_SEPARATOR}. Derived — every existing consumer reads this
   * exactly as it read the former single-string `text`.
   */
  text: string;
  default: boolean;
}

/** Order Fragments core-first, keeping the additives in their authored order. */
function coreFirst(fragments: Fragment[]): Fragment[] {
  return [...fragments.filter((f) => f.core), ...fragments.filter((f) => !f.core)];
}

/**
 * Join a Bullet's Fragments into its canonical text: the core first, then the
 * additive Fragments in authored order. Assumes exactly one core (guaranteed by
 * {@link rawBulletSchema}).
 */
function joinFragments(fragments: Fragment[]): string {
  return coreFirst(fragments)
    .map((f) => f.text)
    .join(FRAGMENT_SEPARATOR);
}

/**
 * Compose a Bullet's *surfaced* text for the Tailored Resume: the core Fragment
 * (always kept) plus the additive Fragments whose ids are in
 * `surfacedAdditiveIds`, ordered core-first with additives in authored order and
 * joined by {@link FRAGMENT_SEPARATOR}. An empty set yields the core alone; the
 * full set reproduces the Bullet's canonical {@link Bullet.text}. This is the
 * subset REPHRASE assembles and VERIFY checks against (see ADR 0004).
 */
export function composeSurfaced(bullet: Bullet, surfacedAdditiveIds: Set<string>): string {
  return joinFragments(bullet.fragments.filter((f) => f.core || surfacedAdditiveIds.has(f.id)));
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
 * A gitignored local override holding the Owner's real data. When present it wins
 * over the committed {@link DEFAULT_DATA_PATH} (which holds only sample data), so
 * real experience never enters git while the repo still runs from the sample on a
 * fresh clone. To use real data locally: copy `resume.data.yaml` to this path and
 * edit it.
 */
export const LOCAL_DATA_PATH = path.join(process.cwd(), "resume.data.local.yaml");

/**
 * Resolve which data file {@link loadResumeData} reads by default: the local
 * override if it exists, else the committed sample. `exists` is injectable for
 * tests.
 */
export function resolveDataPath(exists: (p: string) => boolean = existsSync): string {
  return exists(LOCAL_DATA_PATH) ? LOCAL_DATA_PATH : DEFAULT_DATA_PATH;
}

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
    bullets: position.bullets.map((bullet, bulletIdx) => {
      const id = `p${posIdx}b${bulletIdx}`;
      const fragments: Fragment[] = bullet.fragments.map((fragment, fragIdx) => ({
        id: `${id}f${fragIdx}`,
        text: fragment.text,
        core: fragment.core === true,
      }));
      return { id, fragments, text: joinFragments(fragments), default: bullet.default };
    }),
  }));

  const dataHash = createHash("sha256").update(rawText).digest("hex").slice(0, 16);

  return { owner, positions: enriched, dataHash };
}

/** Read and parse the resume data file from disk. */
export function loadResumeData(filePath: string = resolveDataPath()): ResumeData {
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
