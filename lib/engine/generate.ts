import type { GenerateResponse } from "@/lib/contract";
import { composeSurfaced, getDefaultResume, type ResumeData } from "@/lib/data";
import { orderByRelevance } from "./order";
import { rephraseBullets, type ChosenBullet, type Rephrase } from "./rephrase";
import { selectBullets, type RankBullets, type SelectedBullet } from "./select";
import { verifyBullets, type Judge } from "./verify";

/**
 * The relevance floor: if SELECT returns fewer than this many relevant Bullets,
 * the Keywords are treated as clearing no floor and the Default Resume is served
 * instead of a keyword-tailored one.
 */
export const RELEVANCE_FLOOR = 3;

/** The LLM-backed stages the pipeline needs, injected so it can be tested with fakes. */
export interface EngineDeps {
  rankBullets: RankBullets;
  rephrase: Rephrase;
  judge: Judge;
}

/**
 * The chosen Bullets in relevance order, each carrying its *surfaced* text — the
 * core plus only the FACET-SELECTed additive Fragments. This surfaced subset is
 * what REPHRASE assembles and what VERIFY later checks against, so a Fragment
 * FACET-SELECT dropped can never leak back in and pass.
 *
 * SELECT validated these against the Owner's data and handed the Bullets over, so
 * there is nothing to look up and nothing to assert.
 */
function chosenBullets(selected: SelectedBullet[]): ChosenBullet[] {
  return selected.map(({ bullet, fragmentIds }) => ({
    id: bullet.id,
    text: composeSurfaced(bullet, new Set(fragmentIds)),
  }));
}

/**
 * Answer as if the stage had returned nothing when its call fails. That routes an
 * outage into the fallback the stage already implements per Bullet: REPHRASE with
 * no rewrites leaves every Bullet on its surfaced original, and JUDGE with no
 * verdicts reverts every rewrite. An outage is therefore the routine per-Bullet
 * condition at n=all, reached by a different path — not new tolerance, and never
 * a retry (ADR 0006).
 *
 * The wrapper sits on the injected call rather than around the stage that uses
 * it, so a bug inside {@link rephraseBullets} or {@link verifyBullets} still
 * fails loudly instead of quietly degrading.
 *
 * The cause is logged because it survives nowhere else — the route only sees a
 * resume that came back normally. (Superseded by the structured per-request line
 * that also counts how many Bullets kept original wording.)
 */
function emptyOnOutage<A extends unknown[], V>(
  stage: string,
  call: (...args: A) => Promise<Record<string, V>>,
): (...args: A) => Promise<Record<string, V>> {
  return async (...args) => {
    try {
      return await call(...args);
    } catch (err) {
      console.error(`${stage} unavailable — falling back to the Owner's own wording:`, err);
      return {};
    }
  };
}

/**
 * Produce a resume for the given Keywords. Runs SELECT and applies the relevance
 * floor: fewer than {@link RELEVANCE_FLOOR} relevant Bullets yields the Default
 * Resume (original wording, no rephrase). Otherwise the chosen Bullets are
 * reworded toward the Keywords (REPHRASE), checked for fabrication (VERIFY —
 * anything doubtful reverts to the original), and ordered by relevance within
 * reverse-chronological Positions.
 */
export async function generateResume(
  keywords: string,
  data: ResumeData,
  deps: EngineDeps,
): Promise<GenerateResponse> {
  const selected = await selectBullets(keywords, data, deps.rankBullets);

  const base = { keywords, owner: data.owner, dataHash: data.dataHash };

  if (selected.length < RELEVANCE_FLOOR) {
    return { ...base, mode: "default", positions: getDefaultResume(data) };
  }

  const chosen = chosenBullets(selected);

  // SELECT above is left to throw: it has no per-Bullet fallback, and nothing was
  // ranked, so there is nothing to show. REPHRASE and JUDGE degrade instead — the
  // Bullets were chosen and their Fragments surfaced before either call, so
  // Keyword-driven content variety survives and only sentence variety is lost.
  const rephrased = await rephraseBullets(
    keywords,
    chosen,
    emptyOnOutage("REPHRASE", deps.rephrase),
  );
  const verified = await verifyBullets(rephrased, emptyOnOutage("JUDGE", deps.judge));

  return { ...base, mode: "tailored", positions: orderByRelevance(data, verified) };
}
