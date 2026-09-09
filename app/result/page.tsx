"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { GenerateResponse } from "@/lib/contract";
import ResumeView from "../ResumeView";
import styles from "../page.module.css";
import { deliverIfCurrent, requestTailoredResume } from "./transport";

function Result() {
  const keywords = useSearchParams().get("keywords") ?? "";
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: GenerateResponse }
  >({ status: "loading" });

  useEffect(() => {
    if (keywords.trim() === "") return;
    setState({ status: "loading" });
    // The cleanup drops a result the next Keywords have superseded; the request
    // itself is left to finish (see `deliverIfCurrent`).
    return deliverIfCurrent(requestTailoredResume(keywords), (result) =>
      setState(
        result.ok
          ? { status: "ready", data: result.data }
          : { status: "error", message: result.message },
      ),
    );
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
