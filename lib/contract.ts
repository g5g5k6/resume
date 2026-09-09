import type { Owner, Position } from "@/lib/data";

/**
 * The wire contract for `POST /api/generate`: the one place the route and the
 * browser agree on what crosses the network, rather than agreeing by convention.
 *
 * This module is **types only** — it must never import or export a value, so it
 * compiles away to nothing. Client modules import their response types from here
 * instead of from `@/lib/data`, which reads the Owner's experience file off disk.
 * With `verbatimModuleSyntax` enabled (see `tsconfig.json`), writing one of these
 * imports as a value import is a compile error rather than a silent pull of the
 * loader's dependency graph toward the browser bundle.
 *
 * Honest limitation: {@link GenerateResponse} embeds `Owner` and `Position`,
 * which still live alongside the loader in `@/lib/data`. Type-only import chains
 * are erased, so nothing server-side reaches the bundle — but the guarantee is
 * the compiler flag plus this rule, not a module boundary. Splitting the data
 * module was considered and declined (issue #13, "Out of Scope").
 */

/** Re-exported so client modules never name `@/lib/data` themselves. */
export type { Owner, Position };

/** A successful (2xx) `POST /api/generate` body. */
export interface GenerateResponse {
  /** `"tailored"` when Keywords cleared the relevance floor, else `"default"`. */
  mode: "tailored" | "default";
  keywords: string;
  owner: Owner;
  /** Positions to render, already ordered and grouped. */
  positions: Position[];
  dataHash: string;
}

/**
 * Every non-2xx `POST /api/generate` body. `error` is HR-appropriate copy the
 * page can render verbatim, so an HR User never sees a raw status code.
 */
export interface GenerateError {
  error: string;
}
