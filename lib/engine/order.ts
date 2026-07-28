import { sortByReverseChronology, type Position, type ResumeData } from "@/lib/data";

/**
 * Group the selected Bullets back into their Positions for the Tailored Resume:
 * Positions reverse-chronological, Bullets within each Position in relevance
 * order (the order of `rankedIds`), and Positions with no selected Bullets
 * dropped.
 *
 * `textById` optionally overrides Bullet text with the verified rewrite for each
 * id; a Bullet with no entry keeps its original text.
 */
export function orderByRelevance(
  data: ResumeData,
  rankedIds: string[],
  textById?: Map<string, string>,
): Position[] {
  const rankOf = new Map(rankedIds.map((id, index) => [id, index]));

  const withSelected = data.positions
    .map((position) => ({
      ...position,
      bullets: position.bullets
        .filter((bullet) => rankOf.has(bullet.id))
        .map((bullet) => ({ ...bullet, text: textById?.get(bullet.id) ?? bullet.text }))
        .sort((a, b) => rankOf.get(a.id)! - rankOf.get(b.id)!),
    }))
    .filter((position) => position.bullets.length > 0);

  return sortByReverseChronology(withSelected);
}
