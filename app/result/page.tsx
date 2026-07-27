"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { GenerateResponse } from "@/lib/engine/generate";
import ResumeView from "../ResumeView";
import styles from "../page.module.css";

function Result() {
  const keywords = useSearchParams().get("keywords") ?? "";
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "ready"; data: GenerateResponse }
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
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<GenerateResponse>;
      })
      .then((data) => {
        if (active) setState({ status: "ready", data });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
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
    return <p className={styles.defaultNote}>Tailoring the resume to “{keywords}”…</p>;
  }

  if (state.status === "error") {
    return (
      <p className={styles.defaultNote}>
        Something went wrong. <Link href="/">Try again</Link>.
      </p>
    );
  }

  const banner =
    state.data.mode === "tailored"
      ? `Tailored to “${keywords}”.`
      : `No strong matches for “${keywords}” — showing the default resume.`;

  return (
    <>
      <p className={styles.banner}>
        {banner} <Link href="/">Start over</Link>
      </p>
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
