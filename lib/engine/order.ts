import { sortByReverseChronology, type Position, type ResumeData } from "@/lib/data";

/**
 * Group the selected Bullets back into their Positions for the Tailored Resume:
 * Positions reverse-chronological, Bullets within each Position in relevance
 * order (the order of `rankedIds`), and Positions with no selected Bullets
 * dropped.
 */
export function orderByRelevance(data: ResumeData, rankedIds: string[]): Position[] {
  const rankOf = new Map(rankedIds.map((id, index) => [id, index]));

  const withSelected = data.positions
    .map((position) => ({
      ...position,
      bullets: position.bullets
        .filter((bullet) => rankOf.has(bullet.id))
        .sort((a, b) => rankOf.get(a.id)! - rankOf.get(b.id)!),
    }))
    .filter((position) => position.bullets.length > 0);

  return sortByReverseChronology(withSelected);
}
