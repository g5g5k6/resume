import { describe, expect, it, vi } from "vitest";
import type { RephrasedBullet } from "./rephrase";
import {
  extractCapitalized,
  extractNumbers,
  extractProperNouns,
  isFaithful,
  verifyBullets,
} from "./verify";

describe("extractNumbers", () => {
  it("keeps each number with its unit or percent suffix", () => {
    expect(extractNumbers("Served 2M requests/day at p99 under 80ms")).toEqual(
      new Set(["2m", "99", "80ms"]),
    );
  });

  it("strips thousands separators", () => {
    expect(extractNumbers("reconciled 1,500,000 transactions and 35%")).toEqual(
      new Set(["1500000", "35%"]),
    );
  });
});

describe("extractCapitalized", () => {
  it("collects every capitalized word, first word included", () => {
    expect(extractCapitalized("Built a Python API on Redis")).toEqual(
      new Set(["Built", "Python", "API", "Redis"]),
    );
  });

  it("ignores lowercase words and punctuation", () => {
    expect(extractCapitalized("designed a fast service")).toEqual(new Set());
  });
});

describe("extractProperNouns", () => {
  it("excludes the sentence-initial token, keeping the rest", () => {
    // "Built" is the opening verb, capitalized only because it starts the sentence.
    expect(extractProperNouns("Built a Python API on Redis")).toEqual(
      new Set(["Python", "API", "Redis"]),
    );
  });

  it("excludes the opening token even when it looks like a proper noun", () => {
    // The accepted gap: a sentence-initial name is invisible to this check.
    expect(extractProperNouns("Zephyr powers the Redis cache")).toEqual(new Set(["Redis"]));
  });

  it("keeps a mid-sentence proper noun when the opening word is lowercase", () => {
    expect(extractProperNouns("built a Python API")).toEqual(new Set(["Python", "API"]));
  });
});

describe("isFaithful — deterministic subset gate", () => {
  const source = "Built a Python API serving 2M requests/day on Redis";

  it("accepts a rewrite that keeps every number and capitalized token", () => {
    expect(isFaithful(source, "Built a fast Python API handling 2M requests on Redis")).toBe(true);
  });

  it("rejects a rewrite that introduces a new number", () => {
    expect(isFaithful(source, "Built a Python API serving 5M requests on Redis")).toBe(false);
  });

  it("rejects a magnitude/unit change (2M vs 2B)", () => {
    expect(isFaithful(source, "Built a Python API serving 2B requests on Redis")).toBe(false);
  });

  it("rejects a rewrite that introduces a new proper noun mid-sentence", () => {
    expect(isFaithful(source, "Built a Python API on Redis and Kafka")).toBe(false);
  });

  it("accepts an opening-verb change — the opening token is not a proper-noun check", () => {
    expect(isFaithful(source, "Engineered a fast Python API serving 2M requests on Redis")).toBe(
      true,
    );
  });

  it("still rejects a fabricated number placed in the opening token", () => {
    expect(isFaithful(source, "5M-request Python API on Redis")).toBe(false);
  });

  it("lets a sentence-initial fabricated name slip the gate (accepted gap, JUDGE's job)", () => {
    // ADR 0004: a name placed sentence-initially is invisible to the deterministic
    // gate and is left to the JUDGE. Every non-initial token here is from source.
    expect(isFaithful(source, "Zephyr powered the Python API serving 2M requests on Redis")).toBe(
      true,
    );
  });
});

function reworded(id: string, original: string, text: string): RephrasedBullet {
  return { id, original, text };
}

describe("verifyBullets", () => {
  it("reverts a deterministic failure to original and skips the judge for it", async () => {
    const judge = vi.fn().mockResolvedValue({});
    const bullets = [reworded("a", "shipped 2M requests", "shipped 5M requests")]; // new number
    const result = await verifyBullets(bullets, judge);
    expect(result[0].text).toBe("shipped 2M requests");
    expect(judge).not.toHaveBeenCalled();
  });

  it("keeps a rewrite the judge marks faithful", async () => {
    const judge = vi.fn().mockResolvedValue({ a: true });
    const bullets = [reworded("a", "cut spend", "reduced spend")];
    const result = await verifyBullets(bullets, judge);
    expect(result[0].text).toBe("reduced spend");
  });

  it("reverts a rewrite the judge marks unfaithful", async () => {
    const judge = vi.fn().mockResolvedValue({ a: false });
    const bullets = [reworded("a", "cut spend", "slashed spend dramatically")];
    const result = await verifyBullets(bullets, judge);
    expect(result[0].text).toBe("cut spend");
  });

  it("reverts a rewrite the judge omits (missing verdict is not faithful)", async () => {
    const judge = vi.fn().mockResolvedValue({});
    const bullets = [reworded("a", "cut spend", "reduced spend")];
    const result = await verifyBullets(bullets, judge);
    expect(result[0].text).toBe("cut spend");
  });

  it("sends only deterministic survivors to the judge, unchanged Bullets excluded", async () => {
    const judge = vi.fn().mockResolvedValue({ b: true });
    const bullets = [
      reworded("a", "cut spend", "cut spend"), // unchanged → skipped
      reworded("b", "cut spend", "reduced spend"), // survives → judged
      reworded("c", "shipped 2M", "shipped 5M"), // det-fail → reverted, not judged
    ];
    await verifyBullets(bullets, judge);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge.mock.calls[0][0].map((p: { id: string }) => p.id)).toEqual(["b"]);
  });

  it("does not call the judge when nothing survives the deterministic gate", async () => {
    const judge = vi.fn().mockResolvedValue({});
    const bullets = [reworded("a", "shipped 2M", "shipped 5M")];
    await verifyBullets(bullets, judge);
    expect(judge).not.toHaveBeenCalled();
  });
});

/**
 * The cause is *reported*, not inferred: "all five Bullets kept the Owner's
 * wording" means something very different if the gate rejected five rewrites than
 * if REPHRASE returned five good originals. Only verification can tell those
 * apart, so it says which (ADR 0006).
 */
describe("verifyBullets — reported outcome", () => {
  const outcomes = async (bullets: RephrasedBullet[], verdicts: Record<string, boolean> = {}) =>
    (await verifyBullets(bullets, async () => verdicts)).map((b) => b.outcome);

  it("reports a Bullet REPHRASE never reworded as not rewritten", async () => {
    expect(await outcomes([reworded("a", "cut spend", "cut spend")])).toEqual(["not-rewritten"]);
  });

  it("reports a surviving rewrite as tuned", async () => {
    expect(await outcomes([reworded("a", "cut spend", "reduced spend")], { a: true })).toEqual([
      "tuned",
    ]);
  });

  it("reports a rewrite the deterministic gate rejected", async () => {
    expect(await outcomes([reworded("a", "shipped 2M requests", "shipped 5M requests")])).toEqual([
      "reverted-by-gate",
    ]);
  });

  it("reports a rewrite the judge rejected, and one it never answered for", async () => {
    const rejected = await outcomes([reworded("a", "cut spend", "reduced spend")], { a: false });
    const omitted = await outcomes([reworded("a", "cut spend", "reduced spend")]);
    expect(rejected).toEqual(["reverted-by-judge"]);
    expect(omitted).toEqual(["reverted-by-judge"]);
  });

  it("reports each Bullet's own outcome across a mixed batch", async () => {
    const result = await outcomes(
      [
        reworded("a", "cut spend", "cut spend"),
        reworded("b", "cut spend", "reduced spend"),
        reworded("c", "shipped 2M", "shipped 5M"),
        reworded("d", "cut spend", "slashed spend"),
      ],
      { b: true, d: false },
    );
    expect(result).toEqual(["not-rewritten", "tuned", "reverted-by-gate", "reverted-by-judge"]);
  });
});
