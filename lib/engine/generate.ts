import { getDefaultResume, type Owner, type Position, type ResumeData } from "@/lib/data";
import { orderByRelevance } from "./order";
import { selectBullets, type RankBullets } from "./select";

/**
 * The relevance floor: if SELECT returns fewer than this many relevant Bullets,
 * the Keywords are treated as clearing no floor and the Default Resume is served
 * instead of a keyword-tailored one.
 */
export const RELEVANCE_FLOOR = 3;

export interface GenerateResponse {
  /** `"tailored"` when Keywords cleared the relevance floor, else `"default"`. */
  mode: "tailored" | "default";
  keywords: string;
  owner: Owner;
  /** Positions to render, already ordered and grouped. */
  positions: Position[];
  dataHash: string;
}

/**
 * Produce a resume for the given Keywords: run SELECT, apply the relevance
 * floor, and order the result. Fewer than {@link RELEVANCE_FLOOR} relevant
 * Bullets yields the Default Resume; otherwise the selected Bullets are ordered
 * by relevance within reverse-chronological Positions.
 */
export async function generateResume(
  keywords: string,
  data: ResumeData,
  rankBullets: RankBullets,
): Promise<GenerateResponse> {
  const rankedIds = await selectBullets(keywords, data, rankBullets);

  const base = { keywords, owner: data.owner, dataHash: data.dataHash };

  if (rankedIds.length < RELEVANCE_FLOOR) {
    return { ...base, mode: "default", positions: getDefaultResume(data) };
  }

  return { ...base, mode: "tailored", positions: orderByRelevance(data, rankedIds) };
}
