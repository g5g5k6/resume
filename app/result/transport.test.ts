import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerateResponse } from "@/lib/contract";
import { deliverIfCurrent, requestTailoredResume, type TailoredResumeResult } from "./transport";

const TAILORED: GenerateResponse = {
  mode: "tailored",
  keywords: "go",
  owner: { name: "X", headline: "Y", contact: { email: "a@b.c", location: "Z", links: [] } },
  positions: [],
  dataHash: "hash",
};

/** Stand in for the browser's `fetch`; the transport has no injection point. */
function stubFetch(impl: () => Promise<Response>) {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(impl);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestTailoredResume", () => {
  it("posts the Keywords and returns the parsed resume on success", async () => {
    const fetch = stubFetch(async () => jsonResponse(TAILORED));
    const result = await requestTailoredResume("go");

    expect(result).toEqual({ ok: true, data: TAILORED });
    // Deep equality on the init, so it also pins the absence of a `signal`: no
    // AbortController, because cancelling would change what reaches the rate limiter.
    expect(fetch).toHaveBeenCalledWith("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: "go" }),
    });
  });

  it("surfaces the route's own error copy on a failed response", async () => {
    stubFetch(async () => jsonResponse({ error: "We've hit today's request limit." }, 429));
    expect(await requestTailoredResume("go")).toEqual({
      ok: false,
      message: "We've hit today's request limit.",
    });
  });

  it("falls back to generic copy when a failed response has no readable body", async () => {
    // What a proxy or gateway returns: not JSON at all.
    stubFetch(async () => new Response("<html>502</html>", { status: 502 }));
    expect(await requestTailoredResume("go")).toEqual({
      ok: false,
      message: "Something went wrong while building the resume. Please try again.",
    });
  });

  it("falls back to generic copy when a failed response carries no error field", async () => {
    stubFetch(async () => jsonResponse({ detail: "nope" }, 500));
    expect(await requestTailoredResume("go")).toEqual({
      ok: false,
      message: "Something went wrong while building the resume. Please try again.",
    });
  });

  it("falls back to generic copy when the error field is blank", async () => {
    stubFetch(async () => jsonResponse({ error: "   " }, 500));
    expect(await requestTailoredResume("go")).toEqual({
      ok: false,
      message: "Something went wrong while building the resume. Please try again.",
    });
  });

  it("reports a connection problem when the request never lands", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await requestTailoredResume("go")).toEqual({
      ok: false,
      message: "Couldn't reach the server. Check your connection and try again.",
    });
  });

  it("reports a connection problem when a successful body is unreadable", async () => {
    // Reached the server, but the 200 body is not JSON. Same copy as an
    // unreachable server — preserved from the pre-extraction page.
    stubFetch(async () => new Response("not json", { status: 200 }));
    expect(await requestTailoredResume("go")).toEqual({
      ok: false,
      message: "Couldn't reach the server. Check your connection and try again.",
    });
  });
});

describe("deliverIfCurrent", () => {
  const NEWER: TailoredResumeResult = { ok: false, message: "newer" };
  const STALE: TailoredResumeResult = { ok: false, message: "stale" };

  it("delivers a result that is still the one being awaited", async () => {
    const applied: TailoredResumeResult[] = [];
    deliverIfCurrent(Promise.resolve({ ok: true, data: TAILORED }), (r) => applied.push(r));
    await vi.waitFor(() => expect(applied).toEqual([{ ok: true, data: TAILORED }]));
  });

  it("drops a superseded result so it cannot overwrite newer state", async () => {
    const applied: TailoredResumeResult[] = [];
    let settleStale: (r: TailoredResumeResult) => void = () => {};
    const stale = new Promise<TailoredResumeResult>((resolve) => {
      settleStale = resolve;
    });

    const supersede = deliverIfCurrent(stale, (r) => applied.push(r));
    supersede(); // newer Keywords arrived — this is React's effect cleanup
    deliverIfCurrent(Promise.resolve(NEWER), (r) => applied.push(r));
    settleStale(STALE);

    await vi.waitFor(() => expect(applied).toEqual([NEWER]));
  });
});
