import { NextResponse } from "next/server";
import { loadResumeData } from "@/lib/data";
import { generateResume } from "@/lib/engine/generate";
import { createRankBullets } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/generate — takes HR keywords, runs the SELECT stage, and returns the
 * ordered selection as JSON. Fewer than the relevance floor of matches yields
 * the Default Resume. The Claude call runs here so the API key stays server-side.
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

  try {
    const data = loadResumeData();
    const result = await generateResume(keywords.trim(), data, createRankBullets());
    return NextResponse.json(result);
  } catch (err) {
    console.error("generate failed:", err);
    return NextResponse.json(
      { error: "Could not generate a resume right now. Please try again." },
      { status: 500 },
    );
  }
}
