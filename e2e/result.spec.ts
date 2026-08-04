import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { GenerateResponse } from "@/lib/engine/generate";

/**
 * A tailored `/api/generate` response, stubbed so the E2E never touches Claude or
 * Redis. The reworded Globex bullet is deliberately distinct from the source data
 * so the assertion proves the *tailored* result rendered, not the default one.
 */
const TAILORED: GenerateResponse = {
  mode: "tailored",
  keywords: "backend go billing",
  dataHash: "e2e-fixture",
  owner: {
    name: "James Kuo",
    headline: "Backend Engineer",
    contact: {
      email: "james@example.com",
      location: "Taipei, Taiwan",
      links: ["https://github.com/jameskuo"],
    },
  },
  positions: [
    {
      company: "Globex",
      title: "Backend Engineer",
      start: "2020-06",
      end: "2022-12",
      location: "Remote",
      bullets: [
        {
          id: "p1b0",
          fragments: [
            {
              id: "p1b0f0",
              text: "Shipped a Go billing pipeline reconciling 500K transactions a day.",
              core: true,
            },
          ],
          text: "Shipped a Go billing pipeline reconciling 500K transactions a day.",
          default: false,
        },
      ],
    },
  ],
};

test("type keywords → tailored result → save-as-PDF", async ({ page }, testInfo) => {
  // Stub the engine so the run is deterministic and key-free.
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({ json: TAILORED });
  });

  // Type keywords on the home page and submit.
  await page.goto("/");
  await page.getByLabel("Keywords").fill("backend go billing");
  await page.getByRole("button", { name: "Tailor" }).click();

  // Lands on /result and renders the tailored resume.
  await expect(page).toHaveURL(/\/result\?keywords=backend/);
  await expect(page.getByText(/Tailored to/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "James Kuo" })).toBeVisible();
  await expect(
    page.getByText("Shipped a Go billing pipeline reconciling 500K transactions a day."),
  ).toBeVisible();

  // Print stylesheet strips the app chrome: the toolbar (banner + button) is
  // hidden under print media, leaving just the resume for the PDF.
  const printButton = page.getByRole("button", { name: "Save as PDF" });
  await expect(printButton).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(printButton).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  // Save-as-PDF path: the browser's print-to-PDF produces a real PDF file.
  const pdfPath = path.join(testInfo.outputDir, "resume.pdf");
  rmSync(pdfPath, { force: true });
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  expect(existsSync(pdfPath)).toBe(true);
  const bytes = readFileSync(pdfPath);
  expect(bytes.byteLength).toBeGreaterThan(1000);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
});

test("rate-limited response shows a friendly, non-technical message", async ({ page }) => {
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({
      status: 429,
      json: { error: "You're sending requests too quickly. Please wait a minute and try again." },
    });
  });

  await page.goto("/result?keywords=backend");
  await expect(page.getByText(/sending requests too quickly/)).toBeVisible();
  // Never leak a raw status or stack to an HR User.
  await expect(page.getByText(/429|HTTP|Error:/)).toHaveCount(0);
});
