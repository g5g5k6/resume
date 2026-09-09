import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { describe, expect, it, vi } from "vitest";

/**
 * A stand-in SDK that counts how many clients get built and refuses to talk. The
 * count is what makes the laziness and memoization claims testable; the refusal
 * means nothing here needs credentials or a network.
 */
const sdk = vi.hoisted(() => ({ constructions: 0 }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => {
        throw new Error("no network in tests");
      },
    };
    constructor() {
      sdk.constructions++;
    }
  },
}));

import { createClaudeStages, formatSelectable, type CreateMessage } from "./llm";

/**
 * The SDK's response shape, minimally. The fakes speak that shape on purpose —
 * picking the wrong content block and truncating are the failures this seam
 * exists to make reachable. Cast because a real `Message` carries usage and
 * billing fields no test needs.
 */
function message(content: unknown[], stopReason = "end_turn"): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "test",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as Message;
}

/** A well-formed JSON body, the way a healthy stage answers. */
const jsonReply = (payload: unknown) => message([{ type: "text", text: JSON.stringify(payload) }]);

/** Whatever the model actually emitted — truncated, or not JSON at all. */
const rawReply = (text: string) => message([{ type: "text", text }], "max_tokens");

/** Stages wired to one canned response, plus the params each stage asked for. */
function stagesFor(response: Message) {
  const calls: MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (params) => {
    calls.push(params);
    return response;
  };
  return { stages: createClaudeStages(create), calls };
}

/** Stages answering with a well-formed JSON body. */
const stagesReplying = (payload: unknown) => stagesFor(jsonReply(payload));

describe("formatSelectable", () => {
  it("renders a Bullet with no additive Fragments as one id-and-text line", () => {
    expect(formatSelectable({ id: "p0b0", text: "shipped it", additives: [] })).toBe(
      "p0b0: shipped it",
    );
  });

  it("lists a Bullet's additive Fragments under it, each with its own id", () => {
    expect(
      formatSelectable({
        id: "p0b0",
        text: "shipped it at low latency",
        additives: [{ id: "p0b0f1", text: "at low latency" }],
      }),
    ).toBe("p0b0: shipped it at low latency\n  additive fragments:\n    p0b0f1: at low latency");
  });
});

describe("createClaudeStages", () => {
  it("builds every stage without constructing a client", () => {
    const before = sdk.constructions;
    const deps = createClaudeStages();
    expect(Object.keys(deps).sort()).toEqual(["judge", "rankBullets", "rephrase"]);
    expect(sdk.constructions).toBe(before);
  });

  it("constructs the default client once and reuses it across stages", async () => {
    const stages = createClaudeStages();
    // The fake client refuses to talk, which is beside the point — the question is
    // how many clients two calls down the default path build. This is the only
    // test that reaches the real (lazy) client, so the file total answers it.
    await expect(stages.rankBullets("kw", [])).rejects.toThrow();
    await expect(stages.judge([])).rejects.toThrow();
    expect(sdk.constructions).toBe(1);
  });

  it("routes SELECT through the injected call, on the fast model", async () => {
    const { stages, calls } = stagesReplying({
      selections: [{ id: "p0b0", fragment_ids: ["p0b0f1"] }],
    });
    const ranked = await stages.rankBullets("kw", [
      { id: "p0b0", text: "shipped it", additives: [] },
    ]);

    expect(ranked).toEqual([{ id: "p0b0", fragmentIds: ["p0b0f1"] }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("claude-haiku-4-5");
  });

  it("routes REPHRASE through the injected call, on the mid model with thinking off", async () => {
    const { stages, calls } = stagesReplying({ rewrites: [{ id: "p0b0", text: "reworded" }] });
    const rewrites = await stages.rephrase("kw", [{ id: "p0b0", text: "shipped it" }]);

    expect(rewrites).toEqual({ p0b0: "reworded" });
    expect(calls[0].model).toBe("claude-sonnet-5");
    expect(calls[0].thinking).toEqual({ type: "disabled" });
  });

  it("routes JUDGE through the injected call, on the fast model", async () => {
    const { stages, calls } = stagesReplying({ verdicts: [{ id: "p0b0", faithful: false }] });
    const verdicts = await stages.judge([
      { id: "p0b0", source: "shipped it", rewrite: "reworded" },
    ]);

    expect(verdicts).toEqual({ p0b0: false });
    expect(calls[0].model).toBe("claude-haiku-4-5");
  });

  it("constrains every stage to structured JSON", async () => {
    const select = stagesReplying({ selections: [] });
    const rephrase = stagesReplying({ rewrites: [] });
    const judge = stagesReplying({ verdicts: [] });
    await select.stages.rankBullets("kw", []);
    await rephrase.stages.rephrase("kw", []);
    await judge.stages.judge([]);

    for (const { calls } of [select, rephrase, judge]) {
      expect(calls).toHaveLength(1);
      expect(calls[0].output_config?.format).toMatchObject({ type: "json_schema" });
    }
  });
});

/**
 * Structured outputs constrain decoding, but that guarantee does not cover
 * truncation at the token limit, a refusal, the wrong content block, or a
 * parameter change that drops the format config. One check at the wire catches
 * all four — and must throw, so a broken response never reads as an empty one
 * (ADR 0006).
 */
describe("wire-shape failures", () => {
  it("throws on a truncated response rather than yielding an empty selection", async () => {
    // Cut off at max_tokens mid-array — the case that used to arrive as `[]` and
    // silently serve the Default Resume.
    const { stages } = stagesFor(rawReply('{"selections":[{"id":"p0b0","fragment_'));
    await expect(stages.rankBullets("kw", [])).rejects.toThrow(/SELECT/);
  });

  it("throws when the response carries no text block", async () => {
    const { stages } = stagesFor(message([{ type: "thinking", thinking: "hmm", signature: "s" }]));
    await expect(stages.rankBullets("kw", [])).rejects.toThrow(/SELECT/);
  });

  it("throws when the response parses but is not the shape that was asked for", async () => {
    const { stages } = stagesFor(rawReply('{"selections":[{"id":42,"fragment_ids":[]}]}'));
    await expect(stages.rankBullets("kw", [])).rejects.toThrow(/SELECT/);
  });

  it("throws for REPHRASE and JUDGE too, naming the stage", async () => {
    const rephrase = stagesFor(rawReply('{"rewrites":[{"id":"p0b0"}]}'));
    await expect(rephrase.stages.rephrase("kw", [])).rejects.toThrow(/REPHRASE/);

    const judge = stagesFor(rawReply('{"verdicts":[{"id":"p0b0","faithful":"yes"}]}'));
    await expect(judge.stages.judge([])).rejects.toThrow(/JUDGE/);
  });
});
