# Stack: Next.js on Vercel, Claude for the engine, Upstash Redis for state

## Context

The engine (ADR 0001) needs a server-side execution point to hold the LLM API key
and run up to three model calls per request, so a purely static site is out. The app
is a single public page for one Owner, low traffic, no login. We want one deploy
target, a large ecosystem for a solo build, and a cheap way to hold ephemeral state
(cache, rate-limit counters, spend cap) on stateless serverless functions.

## Decision

- **Framework: Next.js (App Router).** One project serves both the HR-facing UI and
  the `/api/generate` route that holds `ANTHROPIC_API_KEY` and runs the pipeline.
- **Hosting: Vercel.** Native Next.js target, free tier fits the traffic, serverless
  functions hold the key server-side.
- **LLM: Claude (Anthropic).** Fast model (`claude-haiku-4-5`) for select + judge,
  mid model (`claude-sonnet-5`) for rephrase. Exact models and pricing confirmed at
  implementation.
- **State: Upstash Redis (free tier).** Holds the result cache, per-IP rate-limit
  counters, and the daily spend counter. Required because Vercel functions are
  stateless, so in-memory counters do not survive across invocations.

## Considered options

- **SvelteKit / plain Node+Express** — rejected for a solo build: smaller ecosystem
  (Svelte) or more hand-built plumbing (Express) than Next.js gives for free.
- **OpenAI / local Ollama** — OpenAI is a fine equivalent; Claude chosen for
  instruction-following on the strict 1:1 and fidelity constraints. Ollama deferred:
  weaker strict-format output and a public site cannot reach a local model without
  extra hosting.
- **In-memory rate-limit / no cache** — rejected: does not survive serverless cold
  starts, and duplicate queries would each pay for LLM calls.

## Consequences

- Two external accounts to provision: Anthropic (API key) and Upstash (Redis URL),
  both env vars, never committed.
- Cost is bounded by cache + per-IP rate-limit + hard daily spend cap.
- Swapping hosting later (e.g. to Cloudflare) means porting the serverless route and
  the Redis client; the engine code stays put.
