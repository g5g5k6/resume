# Hybrid engine: LLM selects real Bullets, then LLM rephrases them

## Context

The product's entire value is a resume tailored to an HR User's Keywords that is
**truthful about the Owner by construction**. A full-LLM "write me a resume from this
data" approach maximises flexibility but can invent or embellish facts — the one thing
this tool must never do. A pure structured/keyword approach is truthful but too brittle
to handle free-form HR Keywords (synonyms, jargon).

## Decision

A **hybrid, two-stage pipeline**, both stages LLM calls, with facts held constant:

1. **Select** — one LLM call receives all Bullets (plain text) + the Keywords and
   returns ranked Bullet IDs. It can only *choose* from real Bullets; verified that
   returned IDs exist. Bullets carry no manual tags — the selector infers relevance
   from the prose.
2. **Rephrase** — one LLM call receives the chosen Bullets *together* (for coherence)
   and must return exactly one rewrite per input, keyed to its source ID (strict 1:1).
3. **Verify** — each rewrite is checked against its source. A cheap deterministic
   pre-filter first rejects any rewrite introducing a number or proper noun absent from
   the source; survivors go to an **LLM judge** that flags subtler distortions
   (e.g. `led → founded`). Any failure falls back to the Owner's original Bullet text.
4. **Order** — surviving Bullets are grouped by Position (reverse-chronological),
   relevance-ordered within each Position; empty Positions dropped.
5. **Fallback** — if too few Bullets clear a relevance floor, return the **Default
   Resume** (Owner-marked general Bullets) rather than a thin or empty page.

## Considered options

- **Full LLM generation** — rejected: highest hallucination risk against the core promise.
- **Structured selection, no AI (exact/semantic tag match)** — rejected: too brittle for
  free-form Keywords; embeddings add a vector store to maintain for one Owner's data.
- **Single combined call (select + author in one)** — rejected: tangles selection and
  authoring so fidelity can't be verified at a seam; hard to test the halves.
- **Deterministic-only fidelity check** — rejected as *sole* guard: misses non-numeric
  distortions. Kept as a cheap pre-filter ahead of the judge.

## Consequences

- Truthfulness is checkable at seams: selection output is just IDs; rephrase output maps
  1:1 to sources; fabrication is rejected before shipping.
- Costs up to three LLM calls per request (select, rephrase, judge) — acceptable for a
  low-traffic personal tool; the deterministic pre-filter reduces judge calls.
- The app is not static: a server/API route is required at request time to hold the LLM
  key and run the pipeline, even though the Owner's data lives in a flat file in the repo.
