import { describe, expect, it } from "vitest";
import { loadResumeData } from "@/lib/data";
import { generateResume } from "./generate";
import type { Rephrase } from "./rephrase";
import { isFaithful, verifyBullets, type Judge } from "./verify";

/**
 * The deterministic gate's fidelity boundary after ADR 0004 (VERIFY freezes
 * facts, not phrasing). With a compromised judge, the gate ALONE still blocks:
 *   - every fabricated number, at any position, and
 *   - every fabricated proper noun EXCEPT one placed sentence-initially.
 *
 * The one case it no longer covers — a name placed sentence-initially — is the
 * JUDGE's responsibility. The "sentence-initial fabrication" suite below pins
 * that boundary, including the deliberately-accepted gap where a compromised
 * judge lets such a name through (ADR 0004). The 10-keyword-set sweep exercises
 * the gate as the hard floor for every mid-sentence fabrication.
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

describe("mid-sentence fabrication — the deterministic gate's floor", () => {
  const source = sourceById.get(allIds[0])!;
  const midSentenceFake = `${source} using the Zephyr platform for 4242 firms`;

  it("reverts through VERIFY even when the judge is compromised", async () => {
    // Contrast with the sentence-initial case below: a mid-sentence name (and any
    // number) is blocked by the gate itself, so a defeated judge changes nothing.
    const [result] = await verifyBullets(
      [{ id: allIds[0], original: source, text: midSentenceFake }],
      passEverything,
    );
    expect(result.text).toBe(source);
    expect(result.text).not.toContain("Zephyr");
    expect(result.text).not.toContain("4242");
  });
});

describe("sentence-initial fabrication — the JUDGE's responsibility", () => {
  const source = sourceById.get(allIds[0])!;
  // A fabricated proper noun as the opening token; every other token is from source.
  const sentenceInitialFake = `Zephyr ${source}`;

  it("slips the deterministic gate — the opening token is not proper-noun checked", () => {
    expect(isFaithful(source, sentenceInitialFake)).toBe(true);
  });

  it("is caught by a working judge — VERIFY reverts it to the source", async () => {
    const strictJudge: Judge = async (items) =>
      Object.fromEntries(items.map((i) => [i.id, false]));
    const [result] = await verifyBullets(
      [{ id: allIds[0], original: source, text: sentenceInitialFake }],
      strictJudge,
    );
    expect(result.text).toBe(source);
    expect(result.text).not.toContain("Zephyr");
  });

  it("reaches the page only when the judge is ALSO compromised (accepted gap)", async () => {
    const [result] = await verifyBullets(
      [{ id: allIds[0], original: source, text: sentenceInitialFake }],
      passEverything,
    );
    // Both gates defeated: the sentence-initial name survives. This is the
    // deliberate trade documented in ADR 0004, not a regression — the judge is
    // the designated (and here, only) catcher for this one position.
    expect(result.text).toContain("Zephyr");
  });
});
