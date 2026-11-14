#!/usr/bin/env node
/**
 * Apply every prisma/migrations/<id>/migration.sql to DATABASE_URL using
 * node-postgres.
 *
 * Why not `prisma migrate deploy`? The Prisma CLI requires the Rust
 * `schema-engine` binary (downloaded from binaries.prisma.sh) for every
 * command; that CDN is unreachable from this build environment. This runner
 * keeps the standard Prisma migration layout and records applied migrations
 * in the same `_prisma_migrations` table, so `prisma migrate deploy` remains
 * compatible in environments where the engine is available.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — export it first (see .env.example).");
  process.exit(1);
}

const migrationsDir = path.resolve("prisma/migrations");
const dirs = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

if (dirs.length === 0) {
  console.error(`No migration directories found in ${migrationsDir}`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id              TEXT PRIMARY KEY,
    checksum        TEXT NOT NULL,
    finished_at     TIMESTAMPTZ,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_steps   INTEGER NOT NULL DEFAULT 0
  )
`);

const { rows } = await client.query(`SELECT id, checksum FROM "_prisma_migrations"`);
const applied = new Map(rows.map((r) => [r.id, r.checksum]));

let appliedCount = 0;
for (const dir of dirs) {
  const file = path.join(migrationsDir, dir, "migration.sql");
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file}`);
    await client.end();
    process.exit(1);
  }
  const sql = fs.readFileSync(file, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");

  if (applied.has(dir)) {
    if (applied.get(dir) !== checksum) {
      console.error(
        `Checksum mismatch for ${dir} — the migration file changed after it was applied.`,
      );
      await client.end();
      process.exit(1);
    }
    continue;
  }

  console.log(`Applying ${dir} ...`);
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, applied_steps)
       VALUES ($1, $2, now(), 1)`,
      [dir, checksum],
    );
    await client.query("COMMIT");
    appliedCount += 1;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`Migration ${dir} failed:`, err.message);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log(
  appliedCount === 0
    ? "Database is up to date — no migrations to apply."
    : `Applied ${appliedCount} migration(s).`,
);
