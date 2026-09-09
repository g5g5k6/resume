import { NextResponse } from "next/server";
import type { GenerateError, GenerateResponse } from "@/lib/contract";
import { loadResumeData } from "@/lib/data";
import { generateResume } from "@/lib/engine/generate";
import { createClaudeStages } from "@/lib/llm";
import { getStore } from "@/lib/redis";
import {
  MAX_KEYWORDS_LENGTH,
  cacheKey,
  checkRateLimit,
  dailyCap,
  getCached,
  recordSpend,
  setCached,
} from "@/lib/protect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every failure path answers with the same named shape, so the page reads one
 * contract instead of matching object literals by convention. `message` is the
 * HR-appropriate copy the page renders verbatim.
 */
function errorResponse(message: string, status: number): NextResponse<GenerateError> {
  return NextResponse.json<GenerateError>({ error: message }, { status });
}

/** Best-effort client IP from the proxy headers Vercel sets, for rate limiting. */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * POST /api/generate — takes HR keywords, runs the SELECT stage, and returns the
 * ordered selection as JSON. Fewer than the relevance floor of matches yields
 * the Default Resume. The Claude call runs here so the API key stays server-side.
 *
 * Guarded against runaway cost (each miss can fire up to three paid LLM calls):
 * per-IP rate limit → result cache → daily spend cap, before any LLM work. See
 * {@link ../../../lib/protect}.
 */
export async function POST(
  request: Request,
): Promise<NextResponse<GenerateResponse | GenerateError>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be JSON.", 400);
  }

  const keywords = (body as { keywords?: unknown })?.keywords;
  if (typeof keywords !== "string" || keywords.trim() === "") {
    return errorResponse("`keywords` is required and must be a non-empty string.", 400);
  }

  const trimmed = keywords.trim();

  // Input length cap — reject over-long keywords before any LLM call, closing
  // the unbounded-input-token hole. Runs before the store touches, too.
  if (trimmed.length > MAX_KEYWORDS_LENGTH) {
    return errorResponse("Please keep keywords short — a role or a few skills works best.", 400);
  }

  const store = getStore();

  // 1. Per-IP rate limit — the cheapest guard, so it runs first.
  if (!(await checkRateLimit(store, clientIp(request)))) {
    return errorResponse(
      "You're sending requests too quickly. Please wait a minute and try again.",
      429,
    );
  }

  try {
    const data = loadResumeData();
    const key = cacheKey(trimmed, data.dataHash);

    // 2. Result cache — a hit returns without touching the LLM or the spend cap.
    const cached = await getCached<GenerateResponse>(store, key);
    if (cached) return NextResponse.json(cached);

    // 3. Daily spend cap — counted only for cache misses, which actually pay.
    if ((await recordSpend(store)) > dailyCap()) {
      return errorResponse("We've hit today's request limit. Please try again tomorrow.", 429);
    }

    const result = await generateResume(trimmed, data, createClaudeStages());
    await setCached(store, key, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("generate failed:", err);
    return errorResponse("Could not generate a resume right now. Please try again.", 500);
  }
}
