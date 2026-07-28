import type { ResumeData } from "@/lib/data";

/** A Bullet handed to the selector: just its id and the Owner's original text. */
export interface SelectableBullet {
  id: string;
  text: string;
}

/**
 * The SELECT stage's LLM call: given the HR User's Keywords and every Bullet,
 * return the relevant Bullet IDs ranked most-relevant first. The returned IDs
 * are raw model output and are NOT yet validated against the data — that is
 * {@link selectBullets}'s job. Injected so the engine can be tested without a
 * live model.
 */
export type RankBullets = (
  keywords: string,
  selectable: SelectableBullet[],
) => Promise<string[]>;

/**
 * Run SELECT over all Bullets and return the relevant Bullet IDs, ranked
 * most-relevant first. Model output is sanitized: unknown IDs are dropped and
 * duplicates removed, preserving the model's relevance order.
 */
export async function selectBullets(
  keywords: string,
  data: ResumeData,
  rankBullets: RankBullets,
): Promise<string[]> {
  const selectable: SelectableBullet[] = data.positions.flatMap((position) =>
    position.bullets.map((bullet) => ({ id: bullet.id, text: bullet.text })),
  );

  const raw = await rankBullets(keywords, selectable);

  const known = new Set(selectable.map((b) => b.id));
  const seen = new Set<string>();
  const ranked: string[] = [];
  for (const id of raw) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      ranked.push(id);
    }
  }
  return ranked;
}
