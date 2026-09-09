import type { Bullet, ResumeData } from "@/lib/data";

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
 * A ranked Bullet exactly as the model returned it: an id (array order encodes
 * relevance rank) and the ids of the *additive* Fragments to surface. Raw — none
 * of it has been checked against the Owner's data, so an id here may name nothing,
 * name another Bullet's Fragment, name a core Fragment, or repeat.
 */
export interface RankedBullet {
  id: string;
  fragmentIds: string[];
}

/**
 * A ranked Bullet after validation against the Owner's data — a distinct type
 * from {@link RankedBullet} so the compiler tells checked from unchecked. It
 * carries the Bullet itself rather than an id, so no downstream module rebuilds
 * an id lookup or asserts non-null on an invariant established here. Array order
 * still encodes relevance rank; `fragmentIds` are guaranteed to be that Bullet's
 * own additive Fragment ids, deduplicated, and an empty list surfaces the core
 * alone.
 */
export interface SelectedBullet {
  bullet: Bullet;
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
 * A Bullet as this stage needs it: what SELECT is shown, plus what checking
 * SELECT's answer takes — the Bullet itself and the Fragment ids it may surface.
 * Both derive from one `!core` filter, so "additive" has a single source of truth.
 */
interface KnownBullet {
  bullet: Bullet;
  additiveIds: Set<string>;
  selectable: SelectableBullet;
}

function knownBullet(bullet: Bullet): KnownBullet {
  const additives: SelectableFragment[] = bullet.fragments
    .filter((f) => !f.core)
    .map((f) => ({ id: f.id, text: f.text }));
  return {
    bullet,
    additiveIds: new Set(additives.map((f) => f.id)),
    selectable: { id: bullet.id, text: bullet.text, additives },
  };
}

/**
 * Run SELECT over all Bullets and return the relevant Bullets, ranked
 * most-relevant first. Model output is sanitized: unknown Bullet ids are dropped
 * and duplicates removed (keeping the model's relevance order), and each Bullet's
 * `fragmentIds` are narrowed to that Bullet's own additive Fragment ids
 * (unknown/foreign/core ids and duplicates removed). What survives is a
 * {@link SelectedBullet} carrying the Bullet this stage already had in hand.
 */
export async function selectBullets(
  keywords: string,
  data: ResumeData,
  rankBullets: RankBullets,
): Promise<SelectedBullet[]> {
  // Keyed by Bullet id, and also the order SELECT sees: ids are assigned
  // positionally at load (`p{pos}b{bullet}`, lib/data.ts), so they are unique and
  // this Map's insertion order is the Owner's authored order.
  const known = new Map(
    data.positions
      .flatMap((position) => position.bullets)
      .map((bullet) => [bullet.id, knownBullet(bullet)] as const),
  );

  const raw = await rankBullets(
    keywords,
    [...known.values()].map((k) => k.selectable),
  );

  const seen = new Set<string>();
  const selected: SelectedBullet[] = [];
  for (const ranked of raw) {
    const match = known.get(ranked.id);
    if (!match || seen.has(ranked.id)) continue;
    seen.add(ranked.id);

    const seenFragments = new Set<string>();
    const fragmentIds: string[] = [];
    for (const fid of ranked.fragmentIds) {
      if (match.additiveIds.has(fid) && !seenFragments.has(fid)) {
        seenFragments.add(fid);
        fragmentIds.push(fid);
      }
    }
    selected.push({ bullet: match.bullet, fragmentIds });
  }
  return selected;
}
