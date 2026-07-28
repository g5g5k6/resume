import { getDefaultResume, type Owner, type Position, type ResumeData } from "@/lib/data";
import { orderByRelevance } from "./order";
import { rephraseBullets, type ChosenBullet, type Rephrase } from "./rephrase";
import { selectBullets, type RankBullets } from "./select";
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

export interface GenerateResponse {
  /** `"tailored"` when Keywords cleared the relevance floor, else `"default"`. */
  mode: "tailored" | "default";
  keywords: string;
  owner: Owner;
  /** Positions to render, already ordered and grouped. */
  positions: Position[];
  dataHash: string;
}

/** The chosen Bullets in relevance order, each carrying its original text. */
function chosenBullets(data: ResumeData, rankedIds: string[]): ChosenBullet[] {
  const textById = new Map(
    data.positions.flatMap((p) => p.bullets.map((b) => [b.id, b.text] as const)),
  );
  return rankedIds.map((id) => ({ id, text: textById.get(id)! }));
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
  const rankedIds = await selectBullets(keywords, data, deps.rankBullets);

  const base = { keywords, owner: data.owner, dataHash: data.dataHash };

  if (rankedIds.length < RELEVANCE_FLOOR) {
    return { ...base, mode: "default", positions: getDefaultResume(data) };
  }

  const chosen = chosenBullets(data, rankedIds);
  const rephrased = await rephraseBullets(keywords, chosen, deps.rephrase);
  const verified = await verifyBullets(rephrased, deps.judge);

  const textById = new Map(verified.map((b) => [b.id, b.text]));
  return { ...base, mode: "tailored", positions: orderByRelevance(data, rankedIds, textById) };
}
