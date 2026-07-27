import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Playwright specs live in e2e/ and run via `npm run test:e2e`, not Vitest.
    exclude: ["node_modules", "e2e/**"],
  },
});
