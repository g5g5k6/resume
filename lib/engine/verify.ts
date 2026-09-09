import type { RephrasedBullet } from "./rephrase";

/**
 * The VERIFY stage. Two gates, both biased toward safety: any doubt falls the
 * Bullet back to its original text, so a reworded Bullet can never introduce a
 * fact absent from the Owner's source.
 *
 * 1. A deterministic pre-filter that freezes *facts, not phrasing* (ADR 0004):
 *    every number (at any position) and every proper noun *except the
 *    sentence-initial token* in the rewrite must already appear in the source.
 *    Excluding the opening token lets REPHRASE change the leading verb
 *    ("Implemented" → "Engineered") for keyword-driven variety, while still
 *    blocking every fabricated number and every mid-sentence fabricated name.
 *    The deliberate cost: a fabricated name placed *sentence-initially* slips
 *    this gate and is caught only by the judge below.
 * 2. A batched LLM judge over the survivors, for subtler distortions the
 *    deterministic gate misses (overstatement, changed meaning with the same
 *    words) — and the sole catcher of a sentence-initial fabricated name.
 */

/**
 * Number tokens, each kept with its immediate unit/percent suffix and lowercased
 * so a magnitude change is caught: `2M` → `2m`, `35%` → `35%`, `80ms` → `80ms`,
 * `p99` → `99`, `1,500` → `1500`. Keeping the suffix means `2M` and `2B` are
 * different tokens — changing the unit fails the subset check.
 */
export function extractNumbers(text: string): Set<string> {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?(?:%|[A-Za-z]+)?/g) ?? [];
  return new Set(matches.map((n) => n.replace(/,/g, "").toLowerCase()));
}

/** Split `text` into tokens with surrounding punctuation stripped, empties dropped. */
function cleanTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter((t) => t !== "");
}

/**
 * Every capitalized token, surrounding punctuation stripped. Position-agnostic —
 * it includes the sentence-initial word. Used as the *source* superset, where a
 * legitimately-present opening verb should count toward what a rewrite may reuse.
 */
export function extractCapitalized(text: string): Set<string> {
  return new Set(cleanTokens(text).filter((t) => /^[A-Z]/.test(t)));
}

/**
 * The capitalized tokens the fidelity check treats as proper nouns: every
 * capitalized token *except the sentence-initial one* (dropped via `.slice(1)`).
 * Used as the rewrite side of the subset check; see the module note above for
 * why the opening token is exempt.
 */
export function extractProperNouns(text: string): Set<string> {
  return new Set(
    cleanTokens(text)
      .slice(1)
      .filter((t) => /^[A-Z]/.test(t)),
  );
}

function isSubset(subset: Set<string>, superset: Set<string>): boolean {
  for (const value of subset) {
    if (!superset.has(value)) return false;
  }
  return true;
}

/**
 * Deterministic faithfulness (see the module note above). Every number in
 * `rewrite` (at any position) and every proper noun — capitalized tokens except
 * the opening one — must already appear in `source`. Conservative: a
 * rejected-but-faithful rewrite only costs a fallback to the (truthful) original.
 */
export function isFaithful(source: string, rewrite: string): boolean {
  if (!isSubset(extractNumbers(rewrite), extractNumbers(source))) return false;
  return isSubset(extractProperNouns(rewrite), extractCapitalized(source));
}

/** A source/rewrite pair handed to the judge, keyed by its Bullet id. */
export interface RewritePair {
  id: string;
  source: string;
  rewrite: string;
}

/**
 * The judge's LLM call: given source/rewrite pairs, return each id's
 * faithfulness verdict (`{ [id]: boolean }`). Injected so the engine can be
 * tested without a live model.
 */
export type Judge = (pairs: RewritePair[]) => Promise<Record<string, boolean>>;

/**
 * Why a Bullet carries the wording it does, as far as verification can tell.
 * Reported rather than left for a caller to infer: "every Bullet kept the Owner's
 * wording" means something very different when the gate rejected every rewrite
 * than when REPHRASE returned good originals, and no count of reverted Bullets
 * can separate those on its own (ADR 0006).
 */
export type VerifiedOutcome =
  /** REPHRASE returned no usable rewrite for this Bullet, so nothing was checked. */
  | "not-rewritten"
  /** The rewrite passed both checks and is the text that renders. */
  | "tuned"
  /** The deterministic fidelity gate rejected the rewrite; the judge never saw it. */
  | "reverted-by-gate"
  /** The judge did not return an explicit `true` — false, or no verdict at all. */
  | "reverted-by-judge";

/** A Bullet after VERIFY: its final text, and why that is the text. */
export interface VerifiedBullet extends RephrasedBullet {
  outcome: VerifiedOutcome;
}

/**
 * Verify rewrites and return each Bullet with its final text and the reason for
 * it. Rewrites that fail the deterministic gate fall back to original and skip
 * the judge; survivors go to one batched judge call, and any verdict that is not
 * an explicit `true` (false, or a missing id) also falls back to original.
 */
export async function verifyBullets(
  bullets: RephrasedBullet[],
  judge: Judge,
): Promise<VerifiedBullet[]> {
  // Deterministic gate. A Bullet that was never reworded needs no check.
  const afterDeterministic: VerifiedBullet[] = bullets.map((bullet) => {
    if (bullet.text === bullet.original) return { ...bullet, outcome: "not-rewritten" };
    return isFaithful(bullet.original, bullet.text)
      ? { ...bullet, outcome: "tuned" }
      : { ...bullet, text: bullet.original, outcome: "reverted-by-gate" };
  });

  // Only a still-tuned Bullet has a rewrite left for the judge to rule on.
  const survivors = afterDeterministic.filter((b) => b.outcome === "tuned");
  if (survivors.length === 0) return afterDeterministic;

  const verdicts = await judge(
    survivors.map((b) => ({ id: b.id, source: b.original, rewrite: b.text })),
  );

  return afterDeterministic.map((bullet) => {
    if (bullet.outcome !== "tuned") return bullet;
    return verdicts[bullet.id] === true
      ? bullet
      : { ...bullet, text: bullet.original, outcome: "reverted-by-judge" };
  });
}
