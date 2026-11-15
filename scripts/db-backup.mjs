import fs from "node:fs";
import pg from "pg";

/**
 * Logical backup of every BLACKBOX table to a single JSON file.
 *
 * Standard deployments should prefer `pg_dump --format=custom` (see
 * docs/database.md). This script exists for environments where the pg
 * client tools are not installed (e.g. the bundled embedded PostgreSQL,
 * which ships only the server binaries).
 *
 * Usage:
 *   DATABASE_URL=postgresql://… node scripts/db-backup.mjs [outfile.json]
 */

// FK-safe insert order (mirrors prisma/migrations/…/migration.sql CREATE order).
export const TABLES = [
  "Service",
  "Dependency",
  "Incident",
  "IncidentService",
  "TimelineEvent",
  "MetricSample",
  "LogEntry",
  "Trace",
  "Span",
  "RecoveryAction",
  "WorkspaceSetting",
  "SimulationState",
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const outfile = process.argv[2] ?? `blackbox-backup-${new Date().toISOString().slice(0, 10)}.json`;

const client = new pg.Client({ connectionString: url });
await client.connect();
const tables = {};
const counts = {};
let total = 0;
for (const table of TABLES) {
  // Table names are compile-time constants above — never user input.
  const res = await client.query(`SELECT * FROM "${table}"`);
  tables[table] = res.rows;
  counts[table] = res.rows.length;
  total += res.rows.length;
}
await client.end();

fs.writeFileSync(
  outfile,
  JSON.stringify({ version: 1, dumpedAt: new Date().toISOString(), counts, tables }),
);
console.log(`Backed up ${total} rows across ${TABLES.length} tables → ${outfile}`);
