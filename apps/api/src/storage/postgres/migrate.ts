import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";

const MIGRATION_LOCK = 7_609_040_026;

export async function migrateDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const directory = join(__dirname, "migrations");
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) await applyMigration(client, file, await readFile(join(directory, file), "utf8"));
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}

async function applyMigration(client: PoolClient, name: string, sql: string): Promise<void> {
  const applied = await client.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1) AS exists", [name]);
  if (applied.rows[0]?.exists) return;
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrateDatabase(pool);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Database migration failed"}\n`);
    process.exitCode = 1;
  });
}
