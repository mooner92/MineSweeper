import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DB } from '@/db/client';
import { createMigratedDb } from '@/db/migrate';

/**
 * Fresh, migrated database for a test. Uses a unique temp FILE (not ':memory:') so it mirrors
 * the production libsql file mode and supports transactions, which an in-memory libsql DB does
 * not share across the transaction connection.
 */
export function freshDb(): Promise<DB> {
  const dir = mkdtempSync(join(tmpdir(), 'ms-db-'));
  return createMigratedDb(`file:${join(dir, 'test.db')}`);
}
