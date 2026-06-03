import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDb, type DB } from './client';

const MIGRATIONS_FOLDER = './drizzle';

/** Apply all generated migrations to the given Drizzle DB. Reused by tests. */
export async function runMigrations(db: DB, migrationsFolder = MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder });
}

/** Convenience for tests: fresh migrated in-memory DB. */
export async function createMigratedDb(url = ':memory:'): Promise<DB> {
  const db = createDb(url);
  await runMigrations(db);
  return db;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? 'file:./data/minesweeper.db';
  if (url.startsWith('file:')) {
    const filePath = url.slice('file:'.length);
    if (filePath && filePath !== ':memory:') {
      mkdirSync(dirname(filePath) || '.', { recursive: true });
    }
  }
  const db = createDb(url);
  await runMigrations(db);
  // eslint-disable-next-line no-console
  console.log(`✓ migrations applied to ${url}`);
}

// Run when invoked directly via `tsx src/db/migrate.ts`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
