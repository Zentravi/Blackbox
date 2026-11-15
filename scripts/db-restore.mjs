import fs from "node:fs";
import pg from "pg";

/**
 * Restore a JSON dump produced by scripts/db-backup.mjs into DATABASE_URL.
 * The target database must already be migrated (npm run db:migrate) — the
 * dump contains data only; schema stays owned by the Prisma migrations.
 *
 * Usage:
 *   DATABASE_URL=postgresql://… node scripts/db-restore.mjs <backup.json>
 */

const TABLES = [
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

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/; // defensive: identifiers come from our own dump

const url = process.env.DATABASE_URL;
const file = process.argv[2];
if (!url || !file) {
  console.error("Usage: DATABASE_URL=… node scripts/db-restore.mjs <backup.json>");
  process.exit(1);
}

const dump = JSON.parse(fs.readFileSync(file, "utf8"));
if (dump?.version !== 1 || typeof dump.tables !== "object") {
  console.error("Not a db-backup.mjs dump (expected version: 1)");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  // Migrations ledger exists (schema applied) — any column works; to_regclass
  // keeps it dialect-safe.
  const { rows } = await client.query("SELECT to_regclass('public._prisma_migrations') AS t");
  if (!rows[0]?.t) throw new Error("not migrated");
} catch {
  console.error("Target database is not migrated — run npm run db:migrate first.");
  await client.end();
  process.exit(1);
}

let restored = 0;
try {
  for (const table of TABLES) {
    const rows = dump.tables[table] ?? [];
    if (!rows.length) continue;

    await client.query(`DELETE FROM "${table}"`);

    const cols = Object.keys(rows[0]).filter((c) => IDENT.test(c));
    if (!cols.length) continue;

    const typeRes = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    const types = Object.fromEntries(typeRes.rows.map((r) => [r.column_name, r.data_type]));

    const colSql = cols.map((c) => `"${c}"`).join(", ");
    const valueSql = cols.map((_, i) => `$${i + 1}`).join(", ");

    for (const row of rows) {
      const values = cols.map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return null;
        const dt = types[c] ?? "";
        if (dt.startsWith("json")) return JSON.stringify(v);
        if (typeof v === "string" && dt.startsWith("timestamp")) return v;
        if (v instanceof Date) return v.toISOString();
        return v;
      });
      // Parameterised inserts — no string interpolation of values.
      await client.query(`INSERT INTO "${table}" (${colSql}) VALUES (${valueSql})`, values);
      restored += 1;
    }
  }
} catch (err) {
  console.error("Restore failed:", err instanceof Error ? err.message : err);
  await client.end();
  process.exit(1);
}

const report = {};
for (const table of TABLES) {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM "${table}"`);
  report[table] = rows[0].n;
}
await client.end();

console.log(`Restored ${restored} rows from ${file}`);
console.log("Row counts after restore:", JSON.stringify(report));
