/**
 * A chosen Bullet handed to REPHRASE: its id and its *surfaced* text — the core
 * plus the FACET-SELECTed additive Fragments, already joined into one string.
 * This subset is the only text REPHRASE ever sees, so a dropped Fragment is not
 * available for it to reintroduce.
 */
export interface ChosenBullet {
  id: string;
  text: string;
}

/**
 * The REPHRASE stage's LLM call: given the Keywords and every chosen Bullet,
 * return one rewrite per Bullet keyed by its id (`{ [id]: rewrite }`). Raw model
 * output — the strict 1:1 enforcement is {@link rephraseBullets}'s job. Injected
 * so the engine can be tested without a live model.
 */
export type Rephrase = (
  keywords: string,
  chosen: ChosenBullet[],
) => Promise<Record<string, string>>;

/** A Bullet after REPHRASE: its `original` surfaced-subset text and the working `text`. */
export interface RephrasedBullet {
  id: string;
  /** The surfaced subset REPHRASE started from; VERIFY checks the rewrite against this. */
  original: string;
  /** The rewrite when one was returned for this id, otherwise `original`. */
  text: string;
}

/**
 * Run REPHRASE and enforce a strict 1:1 mapping: every chosen Bullet gets exactly
 * one candidate text, in the input order. A Bullet whose id is missing from the
 * response — or whose rewrite is blank — falls back to its original text; ids the
 * model returns that were never requested are ignored.
 */
export async function rephraseBullets(
  keywords: string,
  chosen: ChosenBullet[],
  rephrase: Rephrase,
): Promise<RephrasedBullet[]> {
  const rewrites = await rephrase(keywords, chosen);

  return chosen.map((bullet) => {
    const rewrite = rewrites[bullet.id];
    const usable = typeof rewrite === "string" && rewrite.trim() !== "";
    return { id: bullet.id, original: bullet.text, text: usable ? rewrite.trim() : bullet.text };
  });
}
