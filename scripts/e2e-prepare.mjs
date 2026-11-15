#!/usr/bin/env node
/**
 * Prepare the local Chromium used for E2E tests in restricted environments.
 *
 * Playwright's browser CDN is unreachable from this sandbox, so we launch the
 * Chromium binary shipped inside the `@sparticuz/chromium` npm package
 * (extracted to /tmp/chromium) together with the NSS libraries bundled in its
 * al2023 archive. In CI (process.env.CI) Playwright's own browsers are used
 * instead and this script is a no-op.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createBrotliDecompress } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";

if (process.env.CI) {
  console.log("CI environment — using Playwright-managed browsers.");
  process.exit(0);
}

const libDir = "/tmp/chromium-libs/lib";
if (!fs.existsSync(path.join(libDir, "libnss3.so"))) {
  const archive = path.resolve("node_modules/@sparticuz/chromium/bin/al2023.tar.br");
  if (!fs.existsSync(archive)) {
    console.error(`Missing ${archive} — run npm install first.`);
    process.exit(1);
  }
  fs.mkdirSync(libDir, { recursive: true });
  await pipeline(fs.createReadStream(archive), createBrotliDecompress(), fs.createWriteStream("/tmp/al2023.tar"));
  execFileSync("tar", ["xf", "/tmp/al2023.tar", "-C", "/tmp/chromium-libs"]);
  console.log("Extracted NSS libraries to /tmp/chromium-libs.");
}

const { default: chromium } = await import("@sparticuz/chromium");
const exe = await chromium.executablePath();
console.log(`Local Chromium ready at ${exe}`);
