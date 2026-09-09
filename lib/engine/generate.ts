import type { GenerateResponse } from "@/lib/contract";
import { composeSurfaced, getDefaultResume, type ResumeData } from "@/lib/data";
import { orderByRelevance } from "./order";
import { rephraseBullets, type ChosenBullet, type Rephrase } from "./rephrase";
import { selectBullets, type RankBullets, type SelectedBullet } from "./select";
import { verifyBullets, type Judge, type VerifiedOutcome } from "./verify";

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

/** The two stages that degrade rather than fail the request. */
type Stage = "REPHRASE" | "JUDGE";

/**
 * Wrap a stage call so an outage answers as if the stage had returned nothing.
 * That routes the outage into the fallback the stage already implements per
 * Bullet: REPHRASE with no rewrites leaves every Bullet on its surfaced original,
 * and JUDGE with no verdicts reverts every rewrite. An outage is therefore the
 * routine per-Bullet condition at n=all, reached by a different path — not new
 * tolerance, and never a retry (ADR 0006).
 *
 * The wrapper sits on the injected call rather than around the stage that uses
 * it, so a bug inside {@link rephraseBullets} or {@link verifyBullets} still
 * fails loudly instead of quietly degrading.
 *
 * `wentDown` answers, afterwards, whether the fallback fired — the one cause
 * verification cannot report, because the engine is what caught the throw.
 *
 * The error itself is logged here rather than folded into the per-request line:
 * that line counts Bullets and names causes, and has nowhere to put a stack.
 */
function tolerateOutage<A extends unknown[], V>(
  stage: Stage,
  call: (...args: A) => Promise<Record<string, V>>,
) {
  let down = false;
  return {
    call: async (...args: A): Promise<Record<string, V>> => {
      try {
        return await call(...args);
      } catch (err) {
        down = true;
        console.error(`${stage} unavailable — falling back to the Owner's own wording:`, err);
        return {};
      }
    },
    wentDown: () => down,
  };
}

/**
 * Every reason a Bullet carries the wording it does: verification's four, plus
 * the two only the engine can attribute, because it is what caught the throw.
 * Without these, a stage outage is indistinguishable in the log from Claude
 * quietly returning good originals.
 */
type PhrasingCause = VerifiedOutcome | "rephrase-unavailable" | "judge-unavailable";

/**
 * Re-attribute the outcomes verification could only guess at. A REPHRASE outage
 * reaches VERIFY as "no rewrites offered", and a JUDGE outage as "no verdict
 * returned" — both true, neither the actual reason. A Bullet the deterministic
 * gate already reverted keeps its own cause either way.
 */
function phrasingCauses(
  outcomes: VerifiedOutcome[],
  outages: { rephrase: boolean; judge: boolean },
): PhrasingCause[] {
  return outcomes.map((outcome) => {
    if (outages.rephrase) return "rephrase-unavailable";
    if (outages.judge && outcome === "reverted-by-judge") return "judge-unavailable";
    return outcome;
  });
}

/**
 * One structured line per request, so the Owner can answer "is rephrasing
 * working?" from the logs instead of reading resumes and guessing. The counts
 * separate an outage (nothing tuned, with a stage cause) from a quiet stretch of
 * Claude returning good originals (nothing tuned, no cause), and make slow drift
 * visible — a tuned rate sliding from five-of-five to two-of-five over weeks —
 * which neither an error nor a boolean flag would ever reveal.
 *
 * `original` counts the Bullets that kept the Owner's own wording. It is
 * deliberately not called "fallback": CONTEXT.md reserves that word against the
 * Default Resume, which this line also reports on, in `mode`.
 *
 * Logs only. Nothing here reaches the wire or the HR User: the output is truthful
 * either way, and `mode` answers a different question (ADR 0006).
 */
function logPhrasing(mode: GenerateResponse["mode"], causes: PhrasingCause[]): void {
  const breakdown: Partial<Record<Exclude<PhrasingCause, "tuned">, number>> = {};
  let tuned = 0;
  for (const cause of causes) {
    if (cause === "tuned") tuned += 1;
    else breakdown[cause] = (breakdown[cause] ?? 0) + 1;
  }
  console.info(
    JSON.stringify({
      event: "phrasing",
      mode,
      tuned,
      original: causes.length - tuned,
      causes: breakdown,
    }),
  );
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
    // No Bullet was chosen, so no phrasing decision was made — logged all the same,
    // so the line is one per request and the tuned rate is taken over `tailored`.
    logPhrasing("default", []);
    return { ...base, mode: "default", positions: getDefaultResume(data) };
  }

  const chosen = chosenBullets(selected);

  // SELECT above is left to throw: it has no per-Bullet fallback, and nothing was
  // ranked, so there is nothing to show. REPHRASE and JUDGE degrade instead — the
  // Bullets were chosen and their Fragments surfaced before either call, so
  // Keyword-driven content variety survives and only sentence variety is lost.
  const rephraseStage = tolerateOutage("REPHRASE", deps.rephrase);
  const rephrased = await rephraseBullets(keywords, chosen, rephraseStage.call);

  const judgeStage = tolerateOutage("JUDGE", deps.judge);
  const verified = await verifyBullets(rephrased, judgeStage.call);

  logPhrasing(
    "tailored",
    phrasingCauses(
      verified.map((b) => b.outcome),
      { rephrase: rephraseStage.wentDown(), judge: judgeStage.wentDown() },
    ),
  );
  return { ...base, mode: "tailored", positions: orderByRelevance(data, verified) };
}
