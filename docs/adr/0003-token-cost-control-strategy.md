# Token cost / spend-control strategy

## Context

`/api/generate` is a public endpoint where every cache miss can fire up to three
paid Claude calls (SELECT + REPHRASE + JUDGE). For a personal, low-traffic tool the
goal is to make repeat and off-target traffic free, bound worst-case spend, and keep
input cost from being unbounded — without weakening the product's truthfulness
guarantee. This ADR records the deliberate cost decisions; the pipeline itself is in
ADR 0001 and the stack in ADR 0002.

## Decision

Layered guards, cheapest first, so nothing pays until it must:

1. **Per-IP rate limit** — 5 requests / 60s (free, runs first).
2. **Result cache** — stores the final resume JSON; a hit returns with zero Claude
   calls. Two deliberate settings:
   - **Aggressive key normalization**: the cache key lowercases, strips punctuation,
     splits into words, de-duplicates, and sorts the tokens, so every phrasing of one
     intent (`"Backend, Go"`, `"go backend"`, `"BACKEND  go"`) maps to one entry. The
     original phrasing is still sent to the LLM on a miss — normalization affects the
     key only.
   - **30-day TTL**. Editing `resume.data.yaml` changes `dataHash` and invalidates
     entries instantly, so a long TTL is a hit-rate knob, not a staleness risk.
3. **Daily spend cap** — 50 paying (cache-miss) requests per UTC day, then a friendly
   "try tomorrow". Counted only on misses; over-cap requests never reach the LLM.
   Configurable via `DAILY_REQUEST_CAP`.
4. **Input length cap** — keywords over ~200 characters are rejected with a 400 before
   any LLM call, closing the unbounded-input-token hole (200 chars is generous for a
   role description, tiny for an attacker).

Inside a paid request, calls are avoided by: the relevance floor (fewer than 3
relevant Bullets → Default Resume, skipping REPHRASE + JUDGE), the free deterministic
fidelity check that gates the judge (judge skipped when no rewrite survives), and
model tiering (Haiku for SELECT + JUDGE, Sonnet only for REPHRASE, thinking disabled,
bounded `max_tokens`).

## Considered options — the two "why nots"

- **Drop the JUDGE to save the third call** — rejected. It is the cheap Haiku model,
  runs only on cache-miss full-path requests with survivors, and with cache
  normalization fires roughly once per unique query. Dropping it saves an already-rare,
  cheap call while removing the only guard against subtle distortions the deterministic
  check misses (`led → founded`, quiet overstatement) — the exact promise the product
  sells. Keeping it is worth the near-zero amortized cost.
- **Add Anthropic prompt caching** — rejected for now. It discounts input tokens only
  when the same prompt prefix recurs within a short (~5 min) window, and only on calls
  we still make. This tool's traffic is sparse and spread over days, so the prefix
  window would rarely hit. The result cache (which removes the whole call) is the real
  win. Revisit if traffic ever bursts.

## Consequences

- Worst-case day is bounded to 50 × (≤3 cheap calls); most repeat and near-duplicate
  traffic resolves as 0-call cache hits.
- The values (rate limit, TTL, daily cap, input cap) are config knobs, easy to retune
  as real traffic appears; the layering and the two "why nots" are the durable part.
