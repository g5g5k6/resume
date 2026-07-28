import { NextResponse } from "next/server";
import { loadResumeData } from "@/lib/data";
import { generateResume, type GenerateResponse } from "@/lib/engine/generate";
import { createJudge, createRankBullets, createRephrase } from "@/lib/llm";
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
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const keywords = (body as { keywords?: unknown })?.keywords;
  if (typeof keywords !== "string" || keywords.trim() === "") {
    return NextResponse.json(
      { error: "`keywords` is required and must be a non-empty string." },
      { status: 400 },
    );
  }

  const trimmed = keywords.trim();

  // Input length cap — reject over-long keywords before any LLM call, closing
  // the unbounded-input-token hole. Runs before the store touches, too.
  if (trimmed.length > MAX_KEYWORDS_LENGTH) {
    return NextResponse.json(
      { error: "Please keep keywords short — a role or a few skills works best." },
      { status: 400 },
    );
  }

  const store = getStore();

  // 1. Per-IP rate limit — the cheapest guard, so it runs first.
  if (!(await checkRateLimit(store, clientIp(request)))) {
    return NextResponse.json(
      { error: "You're sending requests too quickly. Please wait a minute and try again." },
      { status: 429 },
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
      return NextResponse.json(
        { error: "We've hit today's request limit. Please try again tomorrow." },
        { status: 429 },
      );
    }

    const result = await generateResume(trimmed, data, {
      rankBullets: createRankBullets(),
      rephrase: createRephrase(),
      judge: createJudge(),
    });
    await setCached(store, key, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("generate failed:", err);
    return NextResponse.json(
      { error: "Could not generate a resume right now. Please try again." },
      { status: 500 },
    );
  }
}
