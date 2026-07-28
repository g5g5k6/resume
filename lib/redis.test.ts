import { afterEach, describe, expect, it, vi } from "vitest";

// getStore memoizes a module-level singleton, so each case resets modules and
// controls the env it observes.
const ENV_KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "NODE_ENV"] as const;

function withEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("getStore", () => {
  it("throws in production when Upstash env vars are missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    withEnv({ UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined });
    const { getStore } = await import("./redis");
    expect(() => getStore()).toThrow(/required in production/);
  });

  it("falls back to an in-memory store outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    withEnv({ UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getStore } = await import("./redis");
    const s = getStore();
    // A working store that round-trips, proving the fallback is usable.
    await s.set("k", "v");
    expect(await s.get("k")).toBe("v");
    warn.mockRestore();
  });
});
