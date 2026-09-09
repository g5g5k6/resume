import { sortByReverseChronology, type Position, type ResumeData } from "@/lib/data";

/**
 * A Bullet ready to be placed back into its Position, supplied in relevance
 * order — its array position *is* its rank, so no parallel id list has to be
 * kept in agreement. (Named for what ORDER takes, as `SelectableBullet` and
 * `ChosenBullet` are; the *ordered* Bullets are the ones this module returns.)
 *
 * `text` is the Bullet's final wording: the rewrite when one survived VERIFY,
 * otherwise the Owner's surfaced original. VERIFY's per-Bullet result satisfies
 * this structurally, so the pipeline hands its verified Bullets straight over.
 */
export interface PlaceableBullet {
  id: string;
  text: string;
}

/**
 * Group the selected Bullets back into their Positions for the Tailored Resume:
 * Positions reverse-chronological, Bullets within each Position in relevance
 * order (the order of `bullets`), and Positions with no selected Bullets dropped.
 *
 * Each placed Bullet renders the text that travelled with it, so the wording
 * decision stays with REPHRASE and VERIFY — ordering never re-derives it.
 */
export function orderByRelevance(data: ResumeData, bullets: PlaceableBullet[]): Position[] {
  // One lookup keyed by Bullet id: rank is the array position and the text
  // travels with the entry, so there is no second structure to keep in step.
  const placement = new Map(bullets.map((b, rank) => [b.id, { rank, text: b.text }]));

  const withSelected = data.positions
    .map((position) => ({
      ...position,
      bullets: position.bullets
        .filter((bullet) => placement.has(bullet.id))
        .map((bullet) => ({ ...bullet, text: placement.get(bullet.id)!.text }))
        .sort((a, b) => placement.get(a.id)!.rank - placement.get(b.id)!.rank),
    }))
    .filter((position) => position.bullets.length > 0);

  return sortByReverseChronology(withSelected);
}
