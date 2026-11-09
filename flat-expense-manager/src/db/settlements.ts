import { isValidISODate, todayISO } from '../domain/dates';
import { MAX_ENTRY_PAISA } from '../domain/money';
import { AppError, type Db, type SqlValue } from './client';

/** A member paying another member back ("Bilal paid Ali Rs. 500"). */
export interface Settlement {
  id: number;
  fromId: number;
  fromName: string;
  toId: number;
  toName: string;
  amount: number;
  date: string;
  note: string | null;
  /** Member who entered it (shared mode); null in local mode. */
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
}

export interface SettlementInput {
  fromId: number;
  toId: number;
  /** Paisa. */
  amount: number;
  date: string;
  note?: string;
}

interface SettlementRow {
  id: number;
  from_member_id: number;
  from_name: string;
  to_member_id: number;
  to_name: string;
  amount: number;
  settlement_date: string;
  note: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}

const toSettlement = (r: SettlementRow): Settlement => ({
  id: r.id,
  fromId: r.from_member_id,
  fromName: r.from_name,
  toId: r.to_member_id,
  toName: r.to_name,
  amount: r.amount,
  date: r.settlement_date,
  note: r.note,
  createdBy: r.created_by,
  createdByName: r.created_by_name,
  createdAt: r.created_at,
});

const SELECT = `
  SELECT s.*, f.name AS from_name, t.name AS to_name, c.name AS created_by_name
  FROM settlements s
  JOIN members f ON f.id = s.from_member_id
  JOIN members t ON t.id = s.to_member_id
  LEFT JOIN members c ON c.id = s.created_by`;

export type SettlementFieldErrors = Partial<Record<keyof SettlementInput, string>>;

export function validateSettlement(input: SettlementInput, today = todayISO()): SettlementFieldErrors {
  const errors: SettlementFieldErrors = {};
  if (!Number.isInteger(input.fromId)) errors.fromId = 'Choose who paid.';
  if (!Number.isInteger(input.toId)) errors.toId = 'Choose who received the money.';
  else if (input.toId === input.fromId) errors.toId = 'A member cannot pay themselves.';
  if (!Number.isInteger(input.amount) || input.amount <= 0) errors.amount = 'Enter an amount greater than zero.';
  else if (input.amount > MAX_ENTRY_PAISA) errors.amount = 'Amount is too large. Please check it.';
  if (!isValidISODate(input.date)) errors.date = 'Choose a valid date.';
  else if (input.date > today) errors.date = 'Date cannot be in the future.';
  if ((input.note?.length ?? 0) > 200) errors.note = 'Note must be 200 characters or fewer.';
  return errors;
}

/** Throws DUPLICATE if the same payment (people, amount, date) is already recorded. */
export async function assertNoDuplicateSettlement(db: Db, input: SettlementInput): Promise<void> {
  const dup = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM settlements WHERE from_member_id = ? AND to_member_id = ? AND amount = ? AND settlement_date = ?',
    [input.fromId, input.toId, input.amount, input.date],
  );
  if (dup) throw new AppError('DUPLICATE', 'This exact payment is already recorded for that date. Record it again?');
}

export async function createSettlement(
  db: Db,
  input: SettlementInput,
  opts: { allowDuplicate?: boolean } = {},
): Promise<number> {
  const first = Object.values(validateSettlement(input))[0];
  if (first) throw new AppError('VALIDATION', first);
  const found = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM members WHERE id IN (?, ?)', [
    input.fromId,
    input.toId,
  ]);
  if ((found?.n ?? 0) !== 2) throw new AppError('NOT_FOUND', 'Member not found.');
  if (!opts.allowDuplicate) await assertNoDuplicateSettlement(db, input);
  const res = await db.runAsync(
    'INSERT INTO settlements (from_member_id, to_member_id, amount, settlement_date, note) VALUES (?, ?, ?, ?, ?)',
    [input.fromId, input.toId, input.amount, input.date, input.note?.trim() || null],
  );
  return res.lastInsertRowId;
}

export async function deleteSettlement(db: Db, id: number): Promise<void> {
  const res = await db.runAsync('DELETE FROM settlements WHERE id = ?', [id]);
  if (res.changes === 0) throw new AppError('NOT_FOUND', 'Payment not found.');
}

export async function listSettlements(
  db: Db,
  filter: { memberId?: number; from?: string; to?: string; limit?: number } = {},
): Promise<Settlement[]> {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (filter.memberId !== undefined) {
    where.push('(s.from_member_id = ? OR s.to_member_id = ?)');
    params.push(filter.memberId, filter.memberId);
  }
  if (filter.from) {
    where.push('s.settlement_date >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    where.push('s.settlement_date <= ?');
    params.push(filter.to);
  }
  let sql = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.settlement_date DESC, s.id DESC`;
  if (filter.limit) {
    sql += ' LIMIT ?';
    params.push(filter.limit);
  }
  return (await db.getAllAsync<SettlementRow>(sql, params)).map(toSettlement);
}
