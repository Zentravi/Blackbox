import fs from "node:fs";
import path from "node:path";

/**
 * Ensure the local Chromium binary + NSS libraries exist before workers
 * launch browsers (no-op in CI where Playwright manages its own browsers).
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.CI) return;

  const { default: chromium } = await import("@sparticuz/chromium");
  await chromium.executablePath(); // extracts to /tmp/chromium

  const libDir = "/tmp/chromium-libs/lib";
  if (!fs.existsSync(path.join(libDir, "libnss3.so"))) {
    throw new Error(
      "NSS libraries missing — run `node scripts/e2e-prepare.mjs` before `playwright test`.",
    );
  }

  process.env.LD_LIBRARY_PATH = `${libDir}:${process.env.LD_LIBRARY_PATH ?? ""}`;
}
