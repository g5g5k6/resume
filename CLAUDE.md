# CLAUDE.md

## Editing `resume.data.yaml`

The format and all authoring rules live in **one** place — the single source of
truth: **[docs/resume-data-format.md](docs/resume-data-format.md)**. Read it
before touching the data. The machine-checked contract is the Zod schema in
`lib/data.ts`; domain vocabulary is in [CONTEXT.md](CONTEXT.md).

If a feature changes the data format, update `docs/resume-data-format.md` — this
file only points there, so nothing here goes stale.

Validate after editing: `npm run typecheck && npm run test`.
