import { transaction, type Db, type SqlValue } from '../db/client';

/** Shared data as stored in Firebase. Ids are Firebase document ids; money is integer paisa. */
export interface RemoteMember {
  id: string;
  name: string;
  username: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isAdmin: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface RemoteExpense {
  id: string;
  title: string;
  description: string | null;
  amount: number;
  category: string;
  date: string;
  paidBy: string;
  splitMode: string;
  splits: { memberId: string; amount: number }[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteSettlement {
  id: string;
  fromId: string;
  toId: string;
  amount: number;
  date: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Snapshot {
  members: RemoteMember[];
  expenses: RemoteExpense[];
  settlements: RemoteSettlement[];
}

export const EMPTY_SNAPSHOT: Snapshot = { members: [], expenses: [], settlements: [] };

const byCreated = <T extends { createdAt: string; id: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

async function idMap(db: Db, table: 'members' | 'expenses' | 'settlements'): Promise<Map<string, number>> {
  const rows = await db.getAllAsync<{ id: number; remote_id: string }>(
    `SELECT id, remote_id FROM ${table} WHERE remote_id IS NOT NULL`,
    [],
  );
  return new Map(rows.map((r) => [r.remote_id, r.id]));
}

async function deleteMissing(db: Db, table: 'members' | 'expenses' | 'settlements', keep: Set<string>) {
  const existing = await idMap(db, table);
  for (const [remoteId, id] of existing) {
    if (keep.has(remoteId)) continue;
    if (table === 'expenses') await db.runAsync('DELETE FROM expense_splits WHERE expense_id = ?', [id]);
    await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);
  }
}

/**
 * Makes this phone's copy match the shared data, in one transaction so screens never see a
 * half-updated state. Rows keep their local id across syncs (matched by Firebase id), so a
 * screen that is open on an expense stays valid; unchanged expenses are skipped.
 */
export async function applySnapshot(db: Db, snap: Snapshot): Promise<void> {
  await transaction(db, async () => {
    // 1. Members first, because expenses and payments point at them.
    const memberIds = await idMap(db, 'members');
    for (const m of byCreated(snap.members)) {
      const values: SqlValue[] = [m.name, m.username, m.phone, m.email, m.notes, m.isAdmin ? 1 : 0, m.isActive ? 1 : 0, m.createdAt];
      const localId = memberIds.get(m.id);
      if (localId === undefined) {
        const res = await db.runAsync(
          `INSERT INTO members (name, username, phone, email, notes, is_admin, is_active, created_at, remote_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...values, m.id],
        );
        memberIds.set(m.id, res.lastInsertRowId);
      } else {
        await db.runAsync(
          `UPDATE members SET name = ?, username = ?, phone = ?, email = ?, notes = ?, is_admin = ?, is_active = ?, created_at = ?
           WHERE id = ?`,
          [...values, localId],
        );
      }
    }
    const member = (remoteId: string) => memberIds.get(remoteId) ?? null;

    // 2. Remove entries that were deleted by their owner.
    await deleteMissing(db, 'expenses', new Set(snap.expenses.map((e) => e.id)));
    await deleteMissing(db, 'settlements', new Set(snap.settlements.map((s) => s.id)));

    // 3. Expenses: insert new ones, rewrite changed ones.
    const known = new Map(
      (
        await db.getAllAsync<{ id: number; remote_id: string; updated_at: string }>(
          'SELECT id, remote_id, updated_at FROM expenses WHERE remote_id IS NOT NULL',
          [],
        )
      ).map((r) => [r.remote_id, r]),
    );
    for (const e of byCreated(snap.expenses)) {
      const existing = known.get(e.id);
      if (existing && existing.updated_at === e.updatedAt) continue;
      const values: SqlValue[] = [e.title, e.description, e.amount, e.category, e.date, member(e.paidBy), e.splitMode, member(e.createdBy), e.createdAt, e.updatedAt];
      let localId: number;
      if (existing) {
        localId = existing.id;
        await db.runAsync(
          `UPDATE expenses SET title = ?, description = ?, amount = ?, category = ?, expense_date = ?, paid_by = ?,
             split_mode = ?, created_by = ?, created_at = ?, updated_at = ? WHERE id = ?`,
          [...values, localId],
        );
        await db.runAsync('DELETE FROM expense_splits WHERE expense_id = ?', [localId]);
      } else {
        const res = await db.runAsync(
          `INSERT INTO expenses (title, description, amount, category, expense_date, paid_by, split_mode, created_by, created_at, updated_at, remote_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...values, e.id],
        );
        localId = res.lastInsertRowId;
      }
      for (const s of e.splits) {
        const memberId = member(s.memberId);
        if (memberId === null || s.amount <= 0) continue;
        await db.runAsync('INSERT INTO expense_splits (expense_id, member_id, amount) VALUES (?, ?, ?)', [localId, memberId, s.amount]);
      }
    }

    // 4. Payments between members never change after they are saved, so only new ones are added.
    const settlementIds = await idMap(db, 'settlements');
    for (const s of byCreated(snap.settlements)) {
      if (settlementIds.has(s.id)) continue;
      const from = member(s.fromId);
      const to = member(s.toId);
      if (from === null || to === null) continue;
      await db.runAsync(
        `INSERT INTO settlements (from_member_id, to_member_id, amount, settlement_date, note, created_by, created_at, remote_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [from, to, s.amount, s.date, s.note, member(s.createdBy), s.createdAt, s.id],
      );
    }

    // 5. Members are only ever removed when the phone's copy is cleared on log-out.
    await deleteMissing(db, 'members', new Set(snap.members.map((m) => m.id)));
  });
}

/** Looks up the Firebase ids the server needs for a change made on this phone. */
export async function remoteIdOf(db: Db, table: 'members' | 'expenses' | 'settlements', localId: number): Promise<string | null> {
  const row = await db.getFirstAsync<{ remote_id: string | null }>(`SELECT remote_id FROM ${table} WHERE id = ?`, [localId]);
  return row?.remote_id ?? null;
}

export async function localIdOf(db: Db, table: 'members' | 'expenses' | 'settlements', remoteId: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ id: number }>(`SELECT id FROM ${table} WHERE remote_id = ?`, [remoteId]);
  return row?.id ?? null;
}
