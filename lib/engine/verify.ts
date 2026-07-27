import type { RephrasedBullet } from "./rephrase";

/**
 * The VERIFY stage. Two gates, both biased toward safety: any doubt falls the
 * Bullet back to its original text, so a reworded Bullet can never introduce a
 * fact absent from the Owner's source.
 *
 * 1. A deterministic pre-filter — every number and capitalized token in the
 *    rewrite must already appear in the source. Cheap, and airtight against
 *    fabricated numbers, metrics, and names.
 * 2. A batched LLM judge over the survivors, for subtler distortions the
 *    deterministic gate misses (overstatement, changed meaning with the same
 *    words).
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

/**
 * Every capitalized token, surrounding punctuation stripped. Deliberately
 * position-agnostic: a proper noun is caught wherever it sits (first word, after
 * an abbreviation, mid-sentence). The cost is that a rewrite which merely opens
 * with a different capitalized verb fails the check and falls back to the
 * (truthful) original — the design's intended safety bias.
 */
export function extractCapitalized(text: string): Set<string> {
  const tokens = text
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter((t) => t !== "" && /^[A-Z]/.test(t));
  return new Set(tokens);
}

function isSubset(subset: Set<string>, superset: Set<string>): boolean {
  for (const value of subset) {
    if (!superset.has(value)) return false;
  }
  return true;
}

/**
 * Deterministic faithfulness: every number and capitalized token in `rewrite`
 * must already appear in `source`. Conservative — it may reject a faithful
 * rewrite, which only costs a fallback to the (truthful) original.
 */
export function isFaithful(source: string, rewrite: string): boolean {
  if (!isSubset(extractNumbers(rewrite), extractNumbers(source))) return false;
  return isSubset(extractCapitalized(rewrite), extractCapitalized(source));
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
 * Verify rewrites and return each Bullet with its final text. Rewrites that fail
 * the deterministic gate fall back to original and skip the judge; survivors go
 * to one batched judge call, and any verdict that is not an explicit `true`
 * (false, or a missing id) also falls back to original.
 */
export async function verifyBullets(
  bullets: RephrasedBullet[],
  judge: Judge,
): Promise<RephrasedBullet[]> {
  // Deterministic gate. A Bullet that was never reworded needs no check.
  const afterDeterministic = bullets.map((bullet) => {
    if (bullet.text === bullet.original) return bullet;
    return isFaithful(bullet.original, bullet.text) ? bullet : { ...bullet, text: bullet.original };
  });

  const survivors = afterDeterministic.filter((b) => b.text !== b.original);
  if (survivors.length === 0) return afterDeterministic;

  const verdicts = await judge(
    survivors.map((b) => ({ id: b.id, source: b.original, rewrite: b.text })),
  );

  return afterDeterministic.map((bullet) => {
    if (bullet.text === bullet.original) return bullet;
    return verdicts[bullet.id] === true ? bullet : { ...bullet, text: bullet.original };
  });
}
