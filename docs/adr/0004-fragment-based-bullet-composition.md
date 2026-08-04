# Fragment-based Bullets: compose from an authored subset, and freeze facts not phrasing

## Context

The engine (ADR 0001) tailors a resume by rewording each selected Bullet toward the
HR User's Keywords. In practice the observable output barely shifts across different
target roles — the same Bullet renders almost identically no matter the Keywords, so
the product's core promise (keyword-driven tailoring) is under-delivered.

The cause is not the selector picking the wrong Bullets; it is that a Bullet is a single
authored sentence, and the tailoring stages can only nudge it. Two seams hold it still:
REPHRASE is instructed to move only lowercase connective words and keep the opening word,
and VERIFY's deterministic gate requires every *capitalized* token in a rewrite to already
appear in the source — which freezes the sentence-initial word (and therefore the verb)
along with genuine proper nouns.

We want more variety **without** weakening the truthfulness guarantee that is the whole
point of the tool.

## Decision

Restructure the Bullet and split tailoring into two orthogonal levers, and narrow the
deterministic fidelity check so it freezes *facts*, not *phrasing*.

1. **A Bullet is a flat, ordered `Fragment[]`, not a single string.** Exactly one Fragment
   is the `core` (carries the verb/spine, always rendered); the rest are additive and
   freely omittable. There are **no named dimensions** in the data (`category` / `context`
   / `tech` are authoring scaffolding, never fields).

2. **A Fragment is an independently-omittable true statement.** Removing any Fragment must
   never make a retained Fragment misleading. A qualifier that *bounds* another fact ("for
   an internal admin tool", "as an intern", "for a 3-week spike") is therefore **never its
   own Fragment** — it stays welded into the Fragment it bounds. Honesty is a property of
   how the Owner cuts the Fragments, not a runtime check: distortion by omission is made
   *inexpressible by the cut*, so there is no runtime "additive vs bounding" flag.

3. **SELECT is untouched.** It still ranks Bullets on their concatenated Fragment prose.
   No Fragment is ever fed to SELECT as a tag or match key (see ADR 0001's rejection of
   structured tag-match; the glossary's "no manual tags").

4. **Content variety comes from FACET-SELECT.** For each selected Bullet, choose which
   additive Fragments are Keyword-relevant (the core is always kept). This is a
   ranking/selection task over authored text — it authors nothing, so it introduces no
   fabrication surface. It is folded into the SELECT call (SELECT returns ranked Bullet
   IDs *and* the relevant Fragment IDs per Bullet) so no fourth LLM call is added and the
   two relevance judgments cannot disagree.

5. **Sentence variety comes from REPHRASE, now freed.** REPHRASE assembles the *surfaced
   Fragment subset* into one sentence and MAY change the verb, reorder clauses, and lead
   with any word. The "keep the opening word / move only lowercase glue" instruction is
   removed.

6. **VERIFY freezes facts, not phrasing.** The deterministic gate checks that every
   **number** (at every position) and every **proper noun** in the output is a subset of
   the *surfaced* Fragments' text. Proper nouns are detected by capitalization **excluding
   the sentence-initial token**, so a changed opening verb ("Implemented" → "Engineered")
   passes while a mid-sentence fabricated name ("using Zephyr") is still caught. VERIFY's
   source is the surfaced subset — never the whole Bullet — so a Fragment that FACET-SELECT
   dropped cannot leak back in via a hallucinated token and pass.

7. **VERIFY and JUDGE are single shared gates**, not per-prompt-style pairs. All REPHRASE
   styles converge on one VERIFY and one JUDGE; the rules they enforce are independent of
   phrasing style.

8. **Default Resume stays zero-LLM.** It renders the deterministic full join of every
   Fragment (core first, then additives in authored order). This imposes an authoring
   constraint that only bites on the fallback path: **additive Fragments must read as
   cleanly-appendable clauses.**

This deepens ADR 0001's "truthful by construction" promise rather than reversing it: the
FACET-SELECT lever emits only Owner-authored text (fabrication-free by construction), and
welded bounding qualifiers make scope-inflation-by-omission inexpressible.

## Considered options

- **Named-slot Bullet record (`{action, context, tech, metric}`)** — rejected. The slot
  names guarantee nothing the composer uses, cannot hold an accomplishment with two metrics
  or an odd scope qualifier, and a standing `tech` slot is a permanent temptation to reuse
  as a selection signal — the brittle tag-match ADR 0001 already rejected. The real
  discipline is the Fragment property contract (§2), not field names.

- **Deterministic join instead of an LLM composer (drop REPHRASE + VERIFY + JUDGE)** —
  seriously considered, because if every additive is an appendable clause, a Keyword-selected
  subset joins into grammatical English with fabrication impossible by construction. Rejected
  because it delivers *content* variety only; it cannot tune verb, opening word, or rhythm to
  the Keywords (*sentence* variety), which is half the stated goal. Kept the LLM composer and
  paid for it with VERIFY + JUDGE. (The deterministic join survives as the Default-Resume
  renderer, where no Keywords exist to tune toward.)

- **Runtime "additive vs bounding" typed flags** — rejected. More machinery and a new failure
  point, and it still cannot stop a bounding qualifier the Owner mis-authored as its own
  Fragment. The welding rule pushes the guarantee into the cut, where it is structural.

- **Keep VERIFY airtight-everywhere (freeze every capitalized token, including the opening
  word)** — rejected. This is the status quo and the direct cause of the low sentence
  variety this ADR exists to fix. Freezing the opening verb to keep the deterministic gate
  airtight against sentence-initial fabricated names trades the product's actual value for a
  narrow, judge-coverable edge.

## Consequences

- **A documented weakening of the deterministic fidelity guarantee.** The gate alone is no
  longer airtight against *all* fabrication. It blocks every fabricated **number** (all
  positions) and every fabricated **name except one placed sentence-initially**; a
  sentence-initial fabricated name is caught only by the JUDGE. This is consistent with
  ADR 0001's layered design (cheap deterministic pre-filter + judge for subtler cases), but
  it moves one case's coverage onto the judge. `fabrication.test.ts` must state this boundary
  honestly and pin the judge as the designated catcher with a sentence-initial-injection
  fixture.

- **One accepted soft spot the system does not check: the cut itself.** The entire honesty
  guarantee rests on the Owner welding bounding qualifiers rather than splitting them out. A
  mis-authored bounding qualifier that became its own Fragment could be dropped to mislead,
  and VERIFY/JUDGE would not catch it (no new token is introduced). Accepted as an
  authoring-discipline responsibility, not a runtime check.

- **An authoring constraint that only surfaces on the fallback path:** additive Fragments
  must append grammatically after the core, because the Default Resume joins them with no LLM.
  Easy to violate and only visible when the Default Resume renders.

- **Data migration.** `resume.data.yaml` moves from `text: <string>` per Bullet to
  `fragments: [{ text, core? }]`. An existing single-string Bullet migrates trivially to one
  `core` Fragment.

- **Call count is unchanged from ADR 0003** (SELECT+FACET-SELECT folded into one call;
  REPHRASE; JUDGE), so the spend-control math holds.
