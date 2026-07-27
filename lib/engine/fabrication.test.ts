import { describe, expect, it } from "vitest";
import { loadResumeData } from "@/lib/data";
import { generateResume } from "./generate";
import type { Rephrase } from "./rephrase";
import { isFaithful, type Judge } from "./verify";

/**
 * The zero-fabrication guarantee (acceptance criterion for #4): across many
 * keyword sets, no rendered Bullet may contain a number or proper noun absent
 * from its source — even when REPHRASE fabricates AND the judge is compromised.
 * This exercises the deterministic gate as the hard floor.
 */

const data = loadResumeData();
const allIds = data.positions.flatMap((p) => p.bullets.map((b) => b.id));
const sourceById = new Map(
  data.positions.flatMap((p) => p.bullets.map((b) => [b.id, b.text] as const)),
);

// Injects a proper noun ("Zephyr") and a number ("4242") never in any source.
const fabricate = (text: string) => `${text} using the Zephyr platform for 4242 firms`;
// Faithful reword: insert a lowercase word after the opening word — keeps every
// number and capitalized token, so it passes the deterministic gate.
const faithfulReword = (text: string) => text.replace(/^(\S+)\s/, "$1 reliably ");

// Adversarial REPHRASE: every other chosen Bullet is fabricated.
const adversarialRephrase: Rephrase = async (_kw, chosen) => {
  const rewrites: Record<string, string> = {};
  chosen.forEach((b, i) => {
    rewrites[b.id] = i % 2 === 0 ? faithfulReword(b.text) : fabricate(b.text);
  });
  return rewrites;
};

// Compromised judge: waves everything through, so the deterministic gate is the
// only thing standing between a fabrication and the rendered page.
const passEverything: Judge = async (items) =>
  Object.fromEntries(items.map((i) => [i.id, true]));

describe("fabrication fixture — zero facts absent from source", () => {
  it("sanity-checks that the fixture actually fabricates", () => {
    const source = sourceById.get(allIds[0])!;
    expect(isFaithful(source, fabricate(source))).toBe(false);
  });

  it("keeps every rendered Bullet faithful across 10 keyword sets", async () => {
    let survivedRewrites = 0;

    for (let s = 0; s < 10; s++) {
      // Rotate a window of 4 distinct Bullets into the selection for this set.
      const selected = [0, 1, 2, 3].map((k) => allIds[(s + k) % allIds.length]);
      const rankBullets = async () => selected;

      const result = await generateResume(`keyword set ${s}`, data, {
        rankBullets,
        rephrase: adversarialRephrase,
        judge: passEverything,
      });

      expect(result.mode).toBe("tailored");

      for (const position of result.positions) {
        for (const bullet of position.bullets) {
          const source = sourceById.get(bullet.id)!;
          // The core guarantee: no number or proper noun absent from the source.
          expect(isFaithful(source, bullet.text)).toBe(true);
          // Fabricated markers must never survive.
          expect(bullet.text).not.toContain("Zephyr");
          expect(bullet.text).not.toContain("4242");
          if (bullet.text !== source) survivedRewrites += 1;
        }
      }
    }

    // Faithful rewrites should still get through — the gate isn't just reverting
    // everything to original.
    expect(survivedRewrites).toBeGreaterThan(0);
  });
});
