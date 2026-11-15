import fs from "node:fs";
import { defineConfig } from "@playwright/test";
import chromium from "@sparticuz/chromium";

/**
 * E2E configuration.
 *
 * - Local (restricted) environments: launches the Chromium bundled in the
 *   @sparticuz/chromium npm package (prepared by scripts/e2e-prepare.mjs).
 * - CI: uses Playwright's own managed browsers (`npx playwright install chromium`).
 */
const isCI = Boolean(process.env.CI);
const localChromium = !isCI && fs.existsSync("/tmp/chromium");

if (localChromium) {
  const libDir = "/tmp/chromium-libs/lib";
  process.env.LD_LIBRARY_PATH = `${libDir}:${process.env.LD_LIBRARY_PATH ?? ""}`;
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  // CI runners are slower — one retry absorbs timing flakes; failures then
  // surface as GitHub annotations via the "github" reporter (readable in PRs).
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3210",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: localChromium
      ? {
          executablePath: "/tmp/chromium",
          // sparticuz targets AWS Lambda: its args include --single-process /
          // --no-zygote, which crash between contexts outside Lambda — filter them.
          args: [
            ...chromium.args.filter(
              (a) => a !== "--single-process" && a !== "--no-zygote",
            ),
            "--no-sandbox",
          ],
        }
      : {},
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run build && npx next start -p 3210",
        url: "http://localhost:3210",
        reuseExistingServer: !isCI,
        timeout: 300_000,
      },
});
