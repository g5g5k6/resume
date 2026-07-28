import { describe, expect, it, vi } from "vitest";
import { rephraseBullets, type ChosenBullet } from "./rephrase";

const chosen: ChosenBullet[] = [
  { id: "p0b0", text: "built api" },
  { id: "p0b1", text: "cut spend" },
  { id: "p1b0", text: "billing pipeline" },
];

describe("rephraseBullets — strict 1:1 mapping", () => {
  it("uses the rewrite when one is returned for a Bullet's id", async () => {
    const rephrase = vi.fn().mockResolvedValue({
      p0b0: "shipped api",
      p0b1: "reduced spend",
      p1b0: "ran billing",
    });
    const result = await rephraseBullets("kw", chosen, rephrase);
    expect(result).toEqual([
      { id: "p0b0", original: "built api", text: "shipped api" },
      { id: "p0b1", original: "cut spend", text: "reduced spend" },
      { id: "p1b0", original: "billing pipeline", text: "ran billing" },
    ]);
  });

  it("falls back to original for a Bullet whose id is missing from the response", async () => {
    const rephrase = vi.fn().mockResolvedValue({ p0b0: "shipped api" });
    const result = await rephraseBullets("kw", chosen, rephrase);
    expect(result.map((b) => b.text)).toEqual(["shipped api", "cut spend", "billing pipeline"]);
  });

  it("falls back to original for a blank rewrite", async () => {
    const rephrase = vi.fn().mockResolvedValue({ p0b0: "   ", p0b1: "reduced spend", p1b0: "" });
    const result = await rephraseBullets("kw", chosen, rephrase);
    expect(result.map((b) => b.text)).toEqual(["built api", "reduced spend", "billing pipeline"]);
  });

  it("ignores ids the model returns that were never requested", async () => {
    const rephrase = vi.fn().mockResolvedValue({
      p0b0: "shipped api",
      p0b1: "reduced spend",
      p1b0: "ran billing",
      p9b9: "hallucinated bullet",
    });
    const result = await rephraseBullets("kw", chosen, rephrase);
    expect(result.map((b) => b.id)).toEqual(["p0b0", "p0b1", "p1b0"]);
  });

  it("trims surrounding whitespace from a usable rewrite", async () => {
    const rephrase = vi.fn().mockResolvedValue({ p0b0: "  shipped api  " });
    const result = await rephraseBullets("kw", chosen, rephrase);
    expect(result[0].text).toBe("shipped api");
  });
});
