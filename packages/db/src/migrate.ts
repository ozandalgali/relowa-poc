/**
 * Migration runner for Relowa POC.
 *
 * Two phases:
 *  1. Run Drizzle Kit migrations (auto-generated from schema.ts)
 *  2. Run "raw" SQL migrations (RLS policies, triggers, functions)
 *
 * Drizzle Kit doesn't generate RLS / trigger / function definitions
 * (these are explicitly out of its scope as of 0.30.x), so we keep
 * those in side-car SQL files prefixed with their numeric ordering
 * and apply them in our own runner.
 *
 * The raw runner is idempotent — it tracks which side-car files
 * have been applied in a `_relowa_migrations` table.
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

// Load env from monorepo root (../../../.env from packages/db/src/)
loadEnv({ path: join(__dirname, "../../../.env") });
loadEnv(); // also load local .env if exists, takes precedence

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://relowa:dev_password_change_me@localhost:5433/relowa";

// Files that Drizzle Kit DOES NOT manage — we run them ourselves.
// Convention: anything other than the auto-generated `XXXX_<random>.sql`
// pattern (we recognize them by hand-picked filenames).
const RAW_SQL_FILES = ["0001_rls_helpers_and_policies.sql", "0002_rls_m1_tables.sql", "0003_rls_substrate_seats.sql"];

async function runDrizzleMigrations() {
  console.log("→ phase 1: running drizzle-generated migrations");
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  await client.end();
  console.log("✓ phase 1 complete");
}

async function runRawSqlMigrations() {
  console.log("→ phase 2: running raw SQL side-car migrations");
  const client = postgres(connectionString, { max: 1 });

  // Tracking table
  await client`
    CREATE TABLE IF NOT EXISTS _relowa_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  for (const file of RAW_SQL_FILES) {
    const already = await client`
      SELECT 1 FROM _relowa_migrations WHERE filename = ${file}
    `;
    if (already.length > 0) {
      console.log(`  · skip ${file} (already applied)`);
      continue;
    }
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
    console.log(`  → applying ${file}`);
    await client.unsafe(sqlText);
    await client`
      INSERT INTO _relowa_migrations (filename) VALUES (${file})
    `;
    console.log(`  ✓ applied ${file}`);
  }

  await client.end();
  console.log("✓ phase 2 complete");
}

async function main() {
  const safeUrl = connectionString.replace(/:[^:@]+@/, ":***@");
  console.log(`→ connecting to ${safeUrl}`);
  await runDrizzleMigrations();
  await runRawSqlMigrations();
  console.log("✓ all migrations complete");
}

main().catch((err) => {
  console.error("✗ migration failed:", err);
  process.exit(1);
});
