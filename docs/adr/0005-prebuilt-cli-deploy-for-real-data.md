# Deploy via prebuilt Vercel CLI to serve real data kept out of git

## Context

The app reads the Owner's experience data from a file on disk at request time
(`loadResumeData` → `readFileSync`, see `lib/data.ts`). The real data lives in
`resume.data.local.yaml`, which is **gitignored** on purpose (commit `32c5415`,
"keep real resume data out of git"): the committed `resume.data.yaml` holds only
sample data, and `resolveDataPath` prefers the local override when it exists.

We want the deployed site to serve the Owner's **real** resume, but the file must
stay out of the git history. Vercel's default GitHub integration only deploys
committed files, so it would silently fall back to the sample data. This ADR
records how the deploy bridges that gap without weakening the "real data out of
git" invariant, and without changing the data-loading code.

## Decision

**Deploy from the Owner's machine with the Vercel CLI, prebuilt:**

```bash
vercel build --prod && vercel deploy --prebuilt --prod
```

- `vercel build` runs the Next.js build locally, where `resume.data.local.yaml`
  is present on disk. Next.js file-tracing already lists both YAML files in the
  `/api/generate` route trace (`route.js.nft.json`), so the real data file is
  copied into `.vercel/output` as part of the function bundle.
- `vercel deploy --prebuilt` uploads `.vercel/output` — the prebuilt bundle —
  rather than the source tree. The real data ships **inside the function**, so
  source-tree ignore rules (`.gitignore` / `.vercelignore`) are irrelevant and no
  `.vercelignore` is needed.
- The real data therefore reaches Vercel through the same trust boundary as the
  API key (build artifact / platform), never through git.

## Considered options

- **ngrok tunnel to the local dev server** — rejected. Contradicts ADR 0002
  (Vercel is the single deploy target), ties the URL to the laptop being awake,
  and gives a throwaway URL. See the grill that produced this ADR.
- **GitHub auto-deploy with data in an env var** — read the YAML from a
  `RESUME_DATA` env var so auto-deploy-on-push works. Rejected for now: it needs
  a code change to the data-loading path plus pasting a ~10 KB blob into an env
  var, to buy auto-deploy this low-traffic personal tool does not need. Revisit
  if deploys become frequent.
- **Commit real data into `resume.data.yaml`** — rejected. Directly undoes the
  "real data out of git" design (commit `32c5415`).

## Consequences

- Deploys are **manual** (run the two commands from the Owner's machine). Fine for
  a personal tool; there is no CI deploy.
- **Do not connect GitHub auto-deploy** without first moving the real data to an
  env var (the option above). A Git-based deployment sees only committed files and
  would **silently serve the sample `resume.data.yaml`** — a quiet regression with
  no error. This is the main footgun and the reason this ADR exists.
- The deploy depends on Next.js file-tracing continuing to bundle the data file.
  If a future change reads the data through an indirection that tracing cannot
  follow, add `outputFileTracingIncludes` for `resume.data*.yaml` to keep the file
  in the bundle.
- Real data lives on a public, unauthenticated URL; it is kept out of search
  results by the `X-Robots-Tag: noindex` header (`next.config.mjs`), and spend is
  bounded by the ADR 0003 guards.
