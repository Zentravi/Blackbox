#!/usr/bin/env node
/**
 * Prisma CLI wrapper.
 *
 * The Prisma CLI tries to download `schema-engine` from binaries.prisma.sh on
 * startup, which is unreachable from restricted build environments. Commands
 * that BLACKBOX uses (generate, format, validate) never actually invoke the
 * engine — so we point PRISMA_SCHEMA_ENGINE_BINARY at a harmless stub unless
 * the caller already set it. Migrations are applied by scripts/migrate.mjs,
 * which does not need the engine at all.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const env = { ...process.env };
if (!env.PRISMA_SCHEMA_ENGINE_BINARY) {
  env.PRISMA_SCHEMA_ENGINE_BINARY = process.execPath; // node itself — never a real engine
}

const result = spawnSync("npx", ["prisma", ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
