import { describe, expect, it, vi } from "vitest";
import type { RephrasedBullet } from "./rephrase";
import { extractCapitalized, extractNumbers, isFaithful, verifyBullets } from "./verify";

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

  it("rejects a fabricated proper noun even in the opening word", () => {
    expect(isFaithful(source, "Google-grade Python API on Redis")).toBe(false);
  });

  it("rejects a rewrite that changes the opening capitalized verb (conservative)", () => {
    expect(isFaithful(source, "Shipped a Python API on Redis")).toBe(false);
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
