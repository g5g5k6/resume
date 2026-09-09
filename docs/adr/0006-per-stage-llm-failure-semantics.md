# Fail loudly at the wire, degrade per stage: what happens when an LLM call breaks

## Context

A cache-miss request runs up to three sequential Claude calls — SELECT (+FACET-SELECT),
REPHRASE, JUDGE (ADR 0001, ADR 0003). Until now every stage adapter in `lib/llm.ts`
hand-narrowed the model's response item by item, `continue`-ing past anything malformed.
That made a broken response indistinguishable from a legitimate empty one: a truncated
SELECT and "no Bullet is relevant" both arrived as `[]`, and the second silently serves
the Default Resume. Structured outputs (`output_config: json_schema`) guarantee *shape*
via constrained decoding, but the guarantee is narrower than that code assumed — it does
not cover truncation at `max_tokens`, refusals, picking the wrong content block, or a
parameter change that drops the format config. None of those are schema violations.

Removing the silent coercion forces a question the code had never actually answered:
**what should happen when a stage genuinely fails?** The answer is not uniform, because
the engine already has a well-defined degradation path for two of the three stages.
`verifyBullets` reverts a Bullet to its original text whenever a verdict is not an
explicit `true`, and `rephraseBullets` falls back to the original whenever an id is
missing from the response. A total REPHRASE or JUDGE outage is therefore **not a new
condition** — it is the existing, routine, per-Bullet condition at n=all.

## Decision

1. **`lib/llm.ts` fails loudly.** One `safeParse` of the whole response at the wire
   boundary in `structuredTurn`; it throws on failure. No per-item narrowing. The module
   answers exactly one question — "is this the shape I asked for" — and `selectBullets`
   keeps doing domain validation (ids exist, belong to that Bullet, no duplicates). Two
   layers, one clean boundary each, instead of a weak partial overlap.

2. **Failure semantics are per stage, not uniform:**

   | Stage | On throw |
   |---|---|
   | SELECT | the request fails (500) — nothing was ranked, there is nothing to show |
   | REPHRASE | every Bullet keeps its surfaced original text |
   | JUDGE | every rewrite reverts to its surfaced original |

   REPHRASE and JUDGE are routed into the fallback those modules already implement. This
   is not new tolerance; it is the existing behaviour reached by a different path.

3. **No retry.** A stage failure is not retried before failing or degrading.

4. **Nothing new on the wire.** `mode` stays `"tailored" | "default"` and keeps meaning
   only "did the Keywords clear the relevance floor". Degradation is observable through a
   structured per-request log line: how many Bullets carry LLM-tuned phrasing versus fell
   back, and the cause of each fallback (REPHRASE unavailable / VERIFY rejected /
   deterministic gate).

## Considered options

- **Uniform 500 on any stage failure** — rejected. It discards a truthful, useful resume.
  When REPHRASE dies, FACET-SELECT's work has already happened: `chosenBullets` composed
  the surfaced subsets before the call, so the HR User still gets Keyword-driven *content*
  variety and loses only *sentence* variety. That is ADR 0004's two orthogonal levers
  degrading independently, exactly as designed. A 500 collapses them into nothing.

- **Retry once inside `structuredTurn` before failing** — rejected for now. `recordSpend`
  increments once per cache-miss *request*, before any LLM work (`route.ts`), so a retry
  would turn ADR 0003's stated worst case of `50 × (≤3 calls)` into `50 × (≤6)` while the
  counter still read 50 — falsifying that ADR's bound invisibly. Ship the loud failure and
  watch the logs first. If a retry is ever wanted it should be **SELECT only** (the one
  stage with no graceful fallback and the only one that can truncate), and ADR 0003 must
  be amended in the same change.

- **A third `mode` value, or a diagnostic field on the response** — rejected on two
  counts. It reports at the wrong granularity: it would announce the all-Bullets case
  while staying silent on the 4-of-5 case, which happens routinely today. And it flattens
  two axes ADR 0004 deliberately separated — `mode` answers a relevance-floor question
  (the Tailored/Default distinction in CONTEXT.md); phrasing fidelity is a different axis.
  A counter in the logs distinguishes an outage (0-of-N with a stage cause) from a quiet
  stretch of good originals (N-of-N passing through), which a boolean structurally cannot.

- **Keep the per-item coercion** — rejected. It is worse than no validation, because it
  hides the failure instead of surfacing it.

## Consequences

- **A REPHRASE or JUDGE outage is invisible to the HR User.** The banner still reads
  "Tailored to X", which stays accurate: `mode: "tailored"` means the Keywords cleared the
  relevance floor and selection happened, and that is true. The output remains truthful —
  it is the Owner's own authored wording.

- **The log counter is the only outage detector.** If nobody reads the logs, a REPHRASE
  outage persists silently. This is an accepted trade for a personal tool; the counter is
  also the only thing that would catch the slow drift (5-of-5 tuned → 2-of-5 over weeks)
  that neither a flag nor a 500 would ever surface.

- **SELECT is the stage to watch as the data grows.** It is the only hard failure and the
  only output whose size scales with the Bullet count — a JSON array of every selected id
  plus its `fragment_ids`, bounded by `max_tokens: 1024`. REPHRASE and JUDGE are bounded by
  what SELECT returned. Truncation will appear here first, and as a 500.

- **ADR 0003's spend bound holds only while there is no retry.** Any future retry makes
  that ADR's arithmetic wrong until it is amended.
