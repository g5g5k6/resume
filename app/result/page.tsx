"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { GenerateError, GenerateResponse } from "@/lib/contract";
import ResumeView from "../ResumeView";
import styles from "../page.module.css";

/**
 * Pull a friendly, non-technical message off a failed `/api/generate` response.
 * The route already sends HR-appropriate copy for 429 (rate-limited and daily
 * cap) and 500 in an `error` field, so an HR User never sees a raw status code.
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
  return "Something went wrong while building the resume. Please try again.";
}

function Result() {
  const keywords = useSearchParams().get("keywords") ?? "";
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: GenerateResponse }
  >({ status: "loading" });

  useEffect(() => {
    if (keywords.trim() === "") return;
    let active = true;
    setState({ status: "loading" });
    fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const message = await friendlyError(res);
          if (active) setState({ status: "error", message });
          return;
        }
        const data = (await res.json()) as GenerateResponse;
        if (active) setState({ status: "ready", data });
      })
      .catch(() => {
        if (active)
          setState({
            status: "error",
            message: "Couldn't reach the server. Check your connection and try again.",
          });
      });
    return () => {
      active = false;
    };
  }, [keywords]);

  if (keywords.trim() === "") {
    return (
      <p className={styles.defaultNote}>
        No keywords given. <Link href="/">Go back</Link> and describe the role.
      </p>
    );
  }

  if (state.status === "loading") {
    return (
      <div className={styles.status} role="status" aria-live="polite">
        <span className={styles.spinner} aria-hidden="true" />
        <p className={styles.statusText}>Tailoring the resume to “{keywords}”…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={styles.status} role="alert">
        <p className={styles.statusText}>{state.message}</p>
        <p className={styles.defaultNote}>
          <Link href="/">Start over</Link>
        </p>
      </div>
    );
  }

  const banner =
    state.data.mode === "tailored"
      ? `Tailored to “${keywords}”.`
      : `No strong matches for “${keywords}” — showing the default resume.`;

  return (
    <>
      <div className={styles.toolbar}>
        <p className={styles.banner}>
          {banner} <Link href="/">Start over</Link>
        </p>
        <button
          type="button"
          className={styles.printButton}
          onClick={() => window.print()}
        >
          Save as PDF
        </button>
      </div>
      <ResumeView owner={state.data.owner} positions={state.data.positions} />
    </>
  );
}

export default function ResultPage() {
  return (
    <main className={styles.page}>
      <Suspense fallback={<p className={styles.defaultNote}>Loading…</p>}>
        <Result />
      </Suspense>
    </main>
  );
}
