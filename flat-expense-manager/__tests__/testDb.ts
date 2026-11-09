import { DatabaseSync } from 'node:sqlite';

import type { Db, SqlValue } from '../src/db/client';
import { migrate } from '../src/db/schema';

/** Adapts Node's built-in SQLite to the app's Db interface so repository SQL runs for real in tests. */
export async function createTestDb(): Promise<Db> {
  const sqlite = new DatabaseSync(':memory:');
  const db: Db = {
    async execAsync(source) {
      sqlite.exec(source);
    },
    async runAsync(source, params: SqlValue[]) {
      const res = sqlite.prepare(source).run(...params);
      return { lastInsertRowId: Number(res.lastInsertRowid), changes: Number(res.changes) };
    },
    async getAllAsync<T>(source: string, params: SqlValue[]) {
      return sqlite.prepare(source).all(...params) as T[];
    },
    async getFirstAsync<T>(source: string, params: SqlValue[]) {
      return (sqlite.prepare(source).get(...params) as T | undefined) ?? null;
    },
    async withTransactionAsync(task) {
      sqlite.exec('BEGIN');
      try {
        await task();
        sqlite.exec('COMMIT');
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  await migrate(db);
  return db;
}
