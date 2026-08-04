import Anthropic from "@anthropic-ai/sdk";
import type { RankBullets, SelectableBullet } from "./engine/select";
import type { ChosenBullet, Rephrase } from "./engine/rephrase";
import type { Judge } from "./engine/verify";

/**
 * Claude client wrapper. Runs server-side only (this module is imported solely
 * by the `/api/generate` route), so `ANTHROPIC_API_KEY` never reaches the client.
 *
 * Models per docs/adr/0002: the fast model for SELECT and the judge, the mid
 * model for REPHRASE.
 */
const FAST_MODEL = "claude-haiku-4-5";
const MID_MODEL = "claude-sonnet-5";

const client = new Anthropic();

/**
 * One structured-JSON turn: constrains the model to `schema` and returns the
 * parsed object. Structured outputs guarantee the response matches `schema`, so
 * a plain `JSON.parse` of the text block is safe.
 */
async function structuredTurn<T>(args: {
  model: string;
  maxTokens: number;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  /** Disable thinking on models where it is on by default (the mid model). */
  disableThinking?: boolean;
}): Promise<T> {
  const response = await client.messages.create({
    model: args.model,
    max_tokens: args.maxTokens,
    system: args.system,
    ...(args.disableThinking ? { thinking: { type: "disabled" as const } } : {}),
    output_config: { format: { type: "json_schema", schema: args.schema } },
    messages: [{ role: "user", content: args.prompt }],
  });

  const text = response.content.find((block) => block.type === "text")?.text ?? "{}";
  return JSON.parse(text) as T;
}

// ---- SELECT ---------------------------------------------------------------

const SELECT_SYSTEM = [
  "You rank resume bullets by relevance to an HR user's keywords.",
  "You are given the keywords and a list of bullets, each with an id.",
  "Return only the ids of bullets genuinely relevant to the keywords, ranked most",
  "relevant first. Omit bullets that are not relevant. Do not invent ids, do not",
  "rewrite any text, and do not return an id more than once.",
].join(" ");

const RANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    relevant_ids: { type: "array", items: { type: "string" } },
  },
  required: ["relevant_ids"],
} as const;

/** The real {@link RankBullets} backed by the Claude fast model. */
export function createRankBullets(): RankBullets {
  return async (keywords: string, selectable: SelectableBullet[]) => {
    const bulletList = selectable.map((b) => `${b.id}: ${b.text}`).join("\n");
    const parsed = await structuredTurn<{ relevant_ids?: unknown }>({
      model: FAST_MODEL,
      maxTokens: 1024,
      system: SELECT_SYSTEM,
      prompt: `Keywords: ${keywords}\n\nBullets:\n${bulletList}`,
      schema: RANK_SCHEMA,
    });
    if (!Array.isArray(parsed.relevant_ids)) return [];
    return parsed.relevant_ids.filter((id): id is string => typeof id === "string");
  };
}

// ---- REPHRASE -------------------------------------------------------------

const REPHRASE_SYSTEM = [
  "You reword resume bullets to emphasize an HR user's keywords WITHOUT changing",
  "any facts. Return exactly one rewrite per input bullet, keyed by its id.",
  "You are free to change the verb, lead with any word, and reorder clauses so the",
  "wording fits the keywords. Hard constraint, because a downstream check discards",
  "any rewrite that breaks it: keep every number and every proper noun (metrics,",
  "company names, product names, acronyms) exactly as written in the source, and",
  "introduce no number or name absent from the source. Do not add facts. If a",
  "bullet is already well-phrased, return it unchanged. One concise sentence each.",
].join(" ");

const REPHRASE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    rewrites: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          text: { type: "string" },
        },
        required: ["id", "text"],
      },
    },
  },
  required: ["rewrites"],
} as const;

/** The real {@link Rephrase} backed by the Claude mid model. */
export function createRephrase(): Rephrase {
  return async (keywords: string, chosen: ChosenBullet[]) => {
    const bulletList = chosen.map((b) => `${b.id}: ${b.text}`).join("\n");
    const parsed = await structuredTurn<{ rewrites?: { id?: unknown; text?: unknown }[] }>({
      model: MID_MODEL,
      maxTokens: 2048,
      disableThinking: true,
      system: REPHRASE_SYSTEM,
      prompt: `Keywords: ${keywords}\n\nBullets:\n${bulletList}`,
      schema: REPHRASE_SCHEMA,
    });

    const rewrites: Record<string, string> = {};
    for (const rewrite of parsed.rewrites ?? []) {
      if (typeof rewrite?.id === "string" && typeof rewrite?.text === "string") {
        rewrites[rewrite.id] = rewrite.text;
      }
    }
    return rewrites;
  };
}

// ---- JUDGE ----------------------------------------------------------------

const JUDGE_SYSTEM = [
  "You check whether each reworded resume bullet stays faithful to its source.",
  "A rewrite is faithful only if it makes no claim, number, name, or nuance absent",
  "from the source and does not overstate it. For each id, return faithful=true or",
  "faithful=false. When in doubt, return false.",
].join(" ");

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          faithful: { type: "boolean" },
        },
        required: ["id", "faithful"],
      },
    },
  },
  required: ["verdicts"],
} as const;

/** The real {@link Judge} backed by the Claude fast model. */
export function createJudge(): Judge {
  return async (pairs) => {
    const list = pairs
      .map((p) => `id: ${p.id}\nsource: ${p.source}\nrewrite: ${p.rewrite}`)
      .join("\n\n");
    const parsed = await structuredTurn<{ verdicts?: { id?: unknown; faithful?: unknown }[] }>({
      model: FAST_MODEL,
      maxTokens: 1024,
      system: JUDGE_SYSTEM,
      prompt: `Judge each pair:\n\n${list}`,
      schema: JUDGE_SCHEMA,
    });

    const verdicts: Record<string, boolean> = {};
    for (const verdict of parsed.verdicts ?? []) {
      if (typeof verdict?.id === "string" && typeof verdict?.faithful === "boolean") {
        verdicts[verdict.id] = verdict.faithful;
      }
    }
    return verdicts;
  };
}
