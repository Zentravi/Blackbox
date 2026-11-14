#!/usr/bin/env node
/**
 * Start a local PostgreSQL for development without a system install.
 * Uses the `embedded-postgres` devDependency (real PostgreSQL binaries
 * shipped via npm) and creates the `blackbox` database.
 *
 *   npm run db:up     # prints DATABASE_URL, keeps running until Ctrl+C
 */
import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";
import process from "node:process";

const port = Number(process.env.BLACKBOX_PG_PORT ?? 54329);
const databaseDir = path.resolve(".blackbox-pg");
const user = process.env.BLACKBOX_PG_USER ?? "postgres";
const password = process.env.BLACKBOX_PG_PASSWORD ?? "blackbox";

const pg = new EmbeddedPostgres({
  databaseDir,
  user,
  password,
  port,
  persistent: true,
});

try {
  await pg.initialise();
} catch {
  // Directory already initialised — start instead.
}
await pg.start();

const dbName = "blackbox";
try {
  await pg.createDatabase(dbName);
  console.log(`Created database "${dbName}".`);
} catch {
  // Already exists.
}

const url = `postgresql://${user}:${password}@127.0.0.1:${port}/${dbName}?schema=public`;
console.log(`\nDATABASE_URL=${url}`);
console.log("Press Ctrl+C to stop.\n");

const stop = async () => {
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
