# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/), and the project
adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-28

Initial MVP: an HR user types keywords and gets a resume tailored from the owner's
real experience, with wording that adapts but facts that never do.

### Added
- **Default Resume** rendered from a flat `resume.data.yaml` file, with schema
  validation, load-time Bullet IDs, and reverse-chronological ordering (#2).
- **Keyword tailoring** — `POST /api/generate` runs an LLM SELECT stage that picks
  the relevant Bullets for the given keywords and drops the rest (#3).
- **Rephrase + verify** — chosen Bullets are reworded toward the keywords, then a
  deterministic number/proper-noun check plus an LLM judge guarantee no fabricated
  facts reach the page; anything doubtful falls back to the original wording (#4).
- **Cost & abuse protection** — result cache, per-IP rate limit, and a daily spend
  cap guard the public endpoint (#5).
- **Styled result page** with browser print-to-PDF and friendly loading /
  rate-limited / no-match states (#6).
- **Token-cost hardening** — cache-key normalization so near-duplicate queries
  share one result, a keywords length cap, a 30-day cache TTL, and a tighter 50/day
  spend default (#7).

### Notes
- Requires `ANTHROPIC_API_KEY`; `UPSTASH_REDIS_*` are optional in local dev (an
  in-memory store is used). See `.env.example`.
- Architecture and rationale are recorded in `docs/adr/0001`–`0003` and `CONTEXT.md`.
