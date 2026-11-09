import { transaction, type Db, type SqlValue } from '../db/client';

/** Rows exactly as Supabase returns them. Money is integer paisa. */
export interface RemoteMember {
  id: number;
  name: string;
  username: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
}

export interface RemoteExpense {
  id: number;
  title: string;
  description: string | null;
  amount: number;
  category: string;
  expense_date: string;
  paid_by: number;
  split_mode: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface RemoteSplit {
  expense_id: number;
  member_id: number;
  amount: number;
}

export interface RemoteSettlement {
  id: number;
  from_member_id: number;
  to_member_id: number;
  amount: number;
  settlement_date: string;
  note: string | null;
  created_by: number;
  created_at: string;
}

export interface Snapshot {
  members: RemoteMember[];
  expenses: RemoteExpense[];
  splits: RemoteSplit[];
  settlements: RemoteSettlement[];
}

/** Minimal shape of the Supabase query builder used here (keeps this file testable). */
export interface SnapshotSource {
  from(table: string): {
    select(columns: string): {
      order(column: string, opts: { ascending: boolean }): {
        range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
}

const PAGE = 1000;

async function fetchAll<T>(source: SnapshotSource, table: string, columns: string, orderBy: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await source.from(table).select(columns).order(orderBy, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Downloads everything the logged-in member is allowed to read. */
export async function fetchSnapshot(source: SnapshotSource): Promise<Snapshot> {
  const [members, expenses, splits, settlements] = await Promise.all([
    fetchAll<RemoteMember>(source, 'members', 'id,name,username,phone,email,notes,is_admin,is_active,created_at', 'id'),
    fetchAll<RemoteExpense>(
      source,
      'expenses',
      'id,title,description,amount,category,expense_date,paid_by,split_mode,created_by,created_at,updated_at',
      'id',
    ),
    fetchAll<RemoteSplit>(source, 'expense_splits', 'expense_id,member_id,amount', 'expense_id'),
    fetchAll<RemoteSettlement>(
      source,
      'settlements',
      'id,from_member_id,to_member_id,amount,settlement_date,note,created_by,created_at',
      'id',
    ),
  ]);
  return { members, expenses, splits, settlements };
}

/** Inserts rows in batches (one statement per batch) so large histories sync quickly. */
async function insertMany(db: Db, table: string, columns: string[], rows: SqlValue[][]) {
  const BATCH = 100;
  const placeholder = `(${columns.map(() => '?').join(',')})`;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await db.runAsync(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${chunk.map(() => placeholder).join(',')}`,
      chunk.flat(),
    );
  }
}

/**
 * Replaces the local copy with the downloaded data in one transaction, so screens never
 * see a half-updated state. Remote ids are kept, so links between rows stay intact.
 */
export async function applySnapshot(db: Db, snap: Snapshot): Promise<void> {
  await transaction(db, async () => {
    await db.runAsync('DELETE FROM expense_splits', []);
    await db.runAsync('DELETE FROM settlements', []);
    await db.runAsync('DELETE FROM expenses', []);
    await db.runAsync('DELETE FROM members', []);

    await insertMany(
      db,
      'members',
      ['id', 'name', 'username', 'phone', 'email', 'notes', 'is_admin', 'is_active', 'created_at'],
      snap.members.map((m) => [m.id, m.name, m.username, m.phone, m.email, m.notes, m.is_admin ? 1 : 0, m.is_active ? 1 : 0, m.created_at]),
    );
    await insertMany(
      db,
      'expenses',
      ['id', 'title', 'description', 'amount', 'category', 'expense_date', 'paid_by', 'split_mode', 'created_by', 'created_at', 'updated_at'],
      snap.expenses.map((e) => [
        e.id,
        e.title,
        e.description,
        Number(e.amount),
        e.category,
        e.expense_date,
        e.paid_by,
        e.split_mode,
        e.created_by,
        e.created_at,
        e.updated_at,
      ]),
    );
    await insertMany(
      db,
      'expense_splits',
      ['expense_id', 'member_id', 'amount'],
      snap.splits.map((s) => [s.expense_id, s.member_id, Number(s.amount)]),
    );
    await insertMany(
      db,
      'settlements',
      ['id', 'from_member_id', 'to_member_id', 'amount', 'settlement_date', 'note', 'created_by', 'created_at'],
      snap.settlements.map((s) => [
        s.id,
        s.from_member_id,
        s.to_member_id,
        Number(s.amount),
        s.settlement_date,
        s.note,
        s.created_by,
        s.created_at,
      ]),
    );
  });
}

export const EMPTY_SNAPSHOT: Snapshot = { members: [], expenses: [], splits: [], settlements: [] };
