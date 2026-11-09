import type { Db } from './client';

/**
 * Ordered migrations. Each entry upgrades the schema by one version (tracked via PRAGMA user_version).
 * Never edit a shipped migration; append a new one instead.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE members (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    phone       TEXT,
    email       TEXT,
    notes       TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE weeks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date  TEXT    NOT NULL UNIQUE,
    end_date    TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    notes       TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    closed_at   TEXT,
    CHECK (end_date >= start_date)
  );

  CREATE TABLE expenses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL CHECK (length(trim(title)) > 0),
    description   TEXT,
    amount        INTEGER NOT NULL CHECK (amount > 0),
    category      TEXT    NOT NULL CHECK (category IN ('Groceries','Milk','Electricity','Gas','Internet','Rent','Other')),
    expense_date  TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_expenses_date ON expenses (expense_date);

  -- A distribution is one manual split of a week's expenses. Editing creates a new
  -- distribution and marks the previous one inactive, so history is never lost.
  CREATE TABLE distributions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    week_id        INTEGER NOT NULL REFERENCES weeks (id) ON DELETE RESTRICT,
    total_amount   INTEGER NOT NULL CHECK (total_amount > 0),
    note           TEXT,
    is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    superseded_at  TEXT
  );
  CREATE UNIQUE INDEX idx_distributions_one_active ON distributions (week_id) WHERE is_active = 1;

  CREATE TABLE distribution_shares (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    distribution_id  INTEGER NOT NULL REFERENCES distributions (id) ON DELETE CASCADE,
    member_id        INTEGER NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
    amount           INTEGER NOT NULL CHECK (amount >= 0),
    UNIQUE (distribution_id, member_id)
  );
  CREATE INDEX idx_shares_member ON distribution_shares (member_id);

  CREATE TABLE payments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id     INTEGER NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
    week_id       INTEGER NOT NULL REFERENCES weeks (id) ON DELETE RESTRICT,
    amount        INTEGER NOT NULL CHECK (amount > 0),
    payment_date  TEXT    NOT NULL,
    note          TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_payments_member ON payments (member_id);
  CREATE INDEX idx_payments_week ON payments (week_id);
  `,

  // v2: Tricount-style model. Each expense records who paid and how it is split;
  // settlements record members paying each other back. The v1 weekly tables above
  // are no longer used by the app but are kept so no saved history is ever lost.
  `
  ALTER TABLE expenses ADD COLUMN paid_by INTEGER REFERENCES members (id);
  ALTER TABLE expenses ADD COLUMN split_mode TEXT NOT NULL DEFAULT 'equal' CHECK (split_mode IN ('equal', 'amounts'));
  CREATE INDEX idx_expenses_paid_by ON expenses (paid_by);

  CREATE TABLE expense_splits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id  INTEGER NOT NULL REFERENCES expenses (id) ON DELETE CASCADE,
    member_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
    amount      INTEGER NOT NULL CHECK (amount >= 0),
    UNIQUE (expense_id, member_id)
  );
  CREATE INDEX idx_expense_splits_member ON expense_splits (member_id);

  CREATE TABLE settlements (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    from_member_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
    to_member_id     INTEGER NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
    amount           INTEGER NOT NULL CHECK (amount > 0),
    settlement_date  TEXT    NOT NULL,
    note             TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (from_member_id != to_member_id)
  );
  CREATE INDEX idx_settlements_from ON settlements (from_member_id);
  CREATE INDEX idx_settlements_to ON settlements (to_member_id);
  `,

  // v3: shared (cloud) mode. Records who added each entry and each member's login username.
  // In cloud mode this database is a read cache of the Supabase data.
  `
  ALTER TABLE members ADD COLUMN username TEXT;
  ALTER TABLE members ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE expenses ADD COLUMN created_by INTEGER;
  ALTER TABLE settlements ADD COLUMN created_by INTEGER;
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;
/** Local-only mode database. */
export const DATABASE_NAME = 'flat-expenses.db';
/** Shared mode: local copy of the Supabase data (a separate file, so local-only data is never touched). */
export const CLOUD_CACHE_DATABASE_NAME = 'flat-cloud-cache.db';

export async function migrate(db: Db): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    const next = version + 1;
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
      await db.execAsync(`PRAGMA user_version = ${next};`);
    });
    version = next;
  }
}

/** Called once by the app when the database is opened. */
export async function initDatabase(db: Db): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await migrate(db);
}
