import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

export type DB = LibSQLDatabase<typeof schema>;

/**
 * Create a Drizzle client over an embedded libsql database.
 * @param url libsql URL, e.g. "file:./data/minesweeper.db" or ":memory:" (tests).
 */
export function createDb(url: string): DB {
  const client = createClient({ url });
  return drizzle(client, { schema });
}

const defaultUrl = process.env.DATABASE_URL ?? 'file:./data/minesweeper.db';

// Lazy singleton: importing this module must never open a file (matters during `next build`,
// which evaluates server modules). The connection is created on first real use.
let _db: DB | null = null;

export function getDb(): DB {
  if (!_db) _db = createDb(defaultUrl);
  return _db;
}

export { schema };
