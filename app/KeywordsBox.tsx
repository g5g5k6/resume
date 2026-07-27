"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./page.module.css";

/**
 * Keywords box: on submit, navigates to `/result?keywords=…`, where the Tailored
 * Resume is fetched from `/api/generate` and rendered.
 */
export default function KeywordsBox() {
  const router = useRouter();
  const [keywords, setKeywords] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = keywords.trim();
    if (trimmed === "") return;
    router.push(`/result?keywords=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form className={styles.keywordsBox} onSubmit={onSubmit}>
      <input
        type="text"
        name="keywords"
        className={styles.keywordsInput}
        placeholder="Describe the role — e.g. backend, Go, billing"
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        aria-label="Keywords"
      />
      <button type="submit" className={styles.keywordsButton}>
        Tailor
      </button>
    </form>
  );
}
