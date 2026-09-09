import type { GenerateError, GenerateResponse } from "@/lib/contract";

/**
 * Talking to `POST /api/generate` from the browser, kept out of the page so the
 * paths a real browser rarely takes — a failed response with no usable copy, an
 * unreachable server, a result arriving after a newer request — are reachable
 * from a test. The page keeps render and state.
 */

/** Shown when the server answered but told us nothing usable about why. */
const GENERIC_FAILURE = "Something went wrong while building the resume. Please try again.";

/** Shown when the request never landed, or landed and came back unreadable. */
const UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";

/**
 * Either the resume or a sentence to show instead — never a status code, and
 * never a rejected promise, so callers need no try/catch.
 */
export type TailoredResumeResult =
  | { ok: true; data: GenerateResponse }
  | { ok: false; message: string };

/**
 * Pull a friendly, non-technical message off a failed `/api/generate` response.
 * The route sends HR-appropriate copy for 400, 429 and 500 in an `error` field,
 * so an HR User never sees a raw status code. Anything else — a proxy's HTML
 * error page, a missing or blank field — falls back to {@link GENERIC_FAILURE}.
 */
async function friendlyError(res: Response): Promise<string> {
  try {
    // Untrusted network input — a proxy can answer with HTML, or with `error`
    // of the wrong type — so the body is read with `unknown` values and guarded.
    // Keying off {@link GenerateError} still ties this to the route's contract:
    // renaming the field there breaks this read.
    const body = (await res.json()) as { [K in keyof GenerateError]?: unknown };
    if (typeof body.error === "string" && body.error.trim() !== "") return body.error;
  } catch {
    // fall through to the generic message
  }
  return GENERIC_FAILURE;
}

/**
 * Ask for a Tailored Resume for these Keywords.
 *
 * The request is never aborted. Cancellation is a behaviour change that also
 * alters what reaches the rate limiter, and is deliberately left to be decided
 * separately (issue #13, "Out of Scope"). To drop a result a newer request has
 * superseded, use {@link deliverIfCurrent}.
 *
 * The single `catch` covers both a request that never landed and a 2xx whose body
 * would not parse. Those read the same to an HR User, as they did before this
 * moved out of the page.
 */
export async function requestTailoredResume(keywords: string): Promise<TailoredResumeResult> {
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords }),
    });

    if (!res.ok) return { ok: false, message: await friendlyError(res) };
    return { ok: true, data: (await res.json()) as GenerateResponse };
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
}

/**
 * Apply a pending result only while it is still the one being waited for. Returns
 * the function to call once it is superseded — React's effect cleanup, today.
 *
 * This suppresses a stale state update; it does **not** abort the request, which
 * runs to completion either way. Narrowed to {@link TailoredResumeResult} rather
 * than any promise, because {@link requestTailoredResume} is documented never to
 * reject and nothing here handles a rejection.
 */
export function deliverIfCurrent(
  pending: Promise<TailoredResumeResult>,
  apply: (result: TailoredResumeResult) => void,
): () => void {
  let current = true;
  void pending.then((result) => {
    if (current) apply(result);
  });
  return () => {
    current = false;
  };
}
