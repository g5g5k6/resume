import type { ResumeData } from "@/lib/data";

/** An additive Fragment offered to FACET-SELECT: its id and text. */
export interface SelectableFragment {
  id: string;
  text: string;
}

/**
 * A Bullet handed to the selector: its id, its concatenated Fragment prose (what
 * SELECT *ranks* on), and its additive Fragments (what FACET-SELECT may choose to
 * surface). The core is never listed — it is always kept — and no Fragment is a
 * selection tag or match key: ranking is on `text` alone (ADR 0001 / glossary).
 */
export interface SelectableBullet {
  id: string;
  text: string;
  additives: SelectableFragment[];
}

/**
 * A selected Bullet: its id (array order encodes relevance rank) and the ids of
 * the Keyword-relevant *additive* Fragments to surface. The core is always kept,
 * so it never appears here; an empty `fragmentIds` surfaces the core alone.
 */
export interface RankedBullet {
  id: string;
  fragmentIds: string[];
}

/**
 * The SELECT stage's LLM call, with FACET-SELECT folded in: given the Keywords
 * and every Bullet, return the relevant Bullets ranked most-relevant first and,
 * per Bullet, which additive Fragments to surface. Raw model output — NOT yet
 * validated against the data; that is {@link selectBullets}'s job. Injected so
 * the engine can be tested without a live model.
 */
export type RankBullets = (
  keywords: string,
  selectable: SelectableBullet[],
) => Promise<RankedBullet[]>;

/**
 * Run SELECT over all Bullets and return the relevant Bullets, ranked
 * most-relevant first. Model output is sanitized: unknown Bullet ids are dropped
 * and duplicates removed (keeping the model's relevance order), and each Bullet's
 * `fragmentIds` are narrowed to that Bullet's own additive Fragment ids
 * (unknown/foreign/core ids and duplicates removed).
 */
export async function selectBullets(
  keywords: string,
  data: ResumeData,
  rankBullets: RankBullets,
): Promise<RankedBullet[]> {
  const bullets = data.positions.flatMap((position) => position.bullets);

  const selectable: SelectableBullet[] = bullets.map((bullet) => ({
    id: bullet.id,
    text: bullet.text,
    additives: bullet.fragments
      .filter((f) => !f.core)
      .map((f) => ({ id: f.id, text: f.text })),
  }));

  const raw = await rankBullets(keywords, selectable);

  // Per Bullet, the set of ids the model is allowed to surface (its additives) —
  // derived from `selectable` so "additive" has a single source of truth.
  const additiveIdsByBullet = new Map(
    selectable.map((b) => [b.id, new Set(b.additives.map((f) => f.id))]),
  );

  const seen = new Set<string>();
  const ranked: RankedBullet[] = [];
  for (const entry of raw) {
    const allowed = additiveIdsByBullet.get(entry.id);
    if (!allowed || seen.has(entry.id)) continue;
    seen.add(entry.id);

    const seenFragments = new Set<string>();
    const fragmentIds: string[] = [];
    for (const fid of entry.fragmentIds) {
      if (allowed.has(fid) && !seenFragments.has(fid)) {
        seenFragments.add(fid);
        fragmentIds.push(fid);
      }
    }
    ranked.push({ id: entry.id, fragmentIds });
  }
  return ranked;
}
