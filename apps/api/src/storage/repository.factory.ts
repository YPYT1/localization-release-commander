import { Pool } from "pg";
import type { ReleaseRepository } from "../domain/repository.js";
import { InMemoryReleaseRepository } from "./in-memory.repository.js";
import { migrateDatabase } from "./postgres/migrate.js";
import { PostgresReleaseRepository } from "./postgres/postgres.repository.js";

export async function createReleaseRepository(databaseUrl?: string): Promise<ReleaseRepository> {
  if (!databaseUrl) return new InMemoryReleaseRepository();
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  try {
    await migrateDatabase(pool);
    return new PostgresReleaseRepository(pool, true);
  } catch (error) {
    await pool.end();
    throw error;
  }
}
