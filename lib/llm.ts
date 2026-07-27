import Anthropic from "@anthropic-ai/sdk";
import type { RankBullets, SelectableBullet } from "./engine/select";

/**
 * Claude client wrapper. Runs server-side only (this module is imported solely
 * by the `/api/generate` route), so `ANTHROPIC_API_KEY` never reaches the client.
 */

// Fast model for SELECT, per docs/adr/0002. Rephrase (a later slice) will use the
// mid model.
const SELECT_MODEL = "claude-haiku-4-5";

const SELECT_SYSTEM = [
  "You rank resume bullets by relevance to an HR user's keywords.",
  "You are given the keywords and a list of bullets, each with an id.",
  "Return only the ids of bullets genuinely relevant to the keywords, ranked most",
  "relevant first. Omit bullets that are not relevant. Do not invent ids, do not",
  "rewrite any text, and do not return an id more than once.",
].join(" ");

/** JSON schema constraining the model to a ranked list of Bullet IDs. */
const RANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    relevant_ids: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["relevant_ids"],
} as const;

/**
 * Build the real {@link RankBullets} backed by the Claude fast model. The
 * caller (the engine) validates the returned IDs, so this only needs to return
 * the model's best-effort ranking.
 */
export function createRankBullets(): RankBullets {
  const client = new Anthropic();

  return async (keywords: string, selectable: SelectableBullet[]) => {
    const bulletList = selectable.map((b) => `${b.id}: ${b.text}`).join("\n");

    const response = await client.messages.create({
      model: SELECT_MODEL,
      max_tokens: 1024,
      system: SELECT_SYSTEM,
      output_config: { format: { type: "json_schema", schema: RANK_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Keywords: ${keywords}\n\nBullets:\n${bulletList}`,
        },
      ],
    });

    const text = response.content.find((block) => block.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(text) as { relevant_ids?: unknown };
    if (!Array.isArray(parsed.relevant_ids)) return [];
    return parsed.relevant_ids.filter((id): id is string => typeof id === "string");
  };
}
