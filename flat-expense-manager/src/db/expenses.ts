import { isCategory, type Category } from '../domain/categories';
import { isValidISODate, todayISO } from '../domain/dates';
import { MAX_ENTRY_PAISA } from '../domain/money';
import { checkSplit, type SplitEntry, type SplitMode } from '../domain/split';
import { AppError, transaction, type Db, type SqlValue } from './client';

export interface Expense {
  id: number;
  title: string;
  description: string | null;
  amount: number;
  category: Category;
  date: string;
  /** Null only for expenses saved before "Paid by" existed. */
  paidBy: number | null;
  paidByName: string | null;
  splitMode: SplitMode;
  splitCount: number;
  /** Member who entered it (shared mode); null in local mode. */
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseSplit {
  memberId: number;
  memberName: string;
  amount: number;
}

export interface ExpenseDetail extends Expense {
  splits: ExpenseSplit[];
}

export interface ExpenseInput {
  title: string;
  description?: string;
  /** Paisa. */
  amount: number;
  category: string;
  date: string;
  paidBy: number;
  splitMode: SplitMode;
  splits: SplitEntry[];
}

interface ExpenseRow {
  id: number;
  title: string;
  description: string | null;
  amount: number;
  category: Category;
  expense_date: string;
  paid_by: number | null;
  paid_by_name: string | null;
  split_mode: SplitMode;
  split_count: number;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

const toExpense = (r: ExpenseRow): Expense => ({
  id: r.id,
  title: r.title,
  description: r.description,
  amount: r.amount,
  category: r.category,
  date: r.expense_date,
  paidBy: r.paid_by,
  paidByName: r.paid_by_name,
  splitMode: r.split_mode,
  splitCount: r.split_count,
  createdBy: r.created_by,
  createdByName: r.created_by_name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const SELECT = `
  SELECT e.*, m.name AS paid_by_name, c.name AS created_by_name,
    (SELECT COUNT(*) FROM expense_splits s WHERE s.expense_id = e.id AND s.amount > 0) AS split_count
  FROM expenses e LEFT JOIN members m ON m.id = e.paid_by LEFT JOIN members c ON c.id = e.created_by`;

export type ExpenseFieldErrors = Partial<Record<keyof ExpenseInput, string>>;

export function validateExpense(input: ExpenseInput, today = todayISO()): ExpenseFieldErrors {
  const errors: ExpenseFieldErrors = {};
  const title = input.title.trim();
  if (!title) errors.title = 'Enter a title.';
  else if (title.length > 80) errors.title = 'Title must be 80 characters or fewer.';
  if ((input.description?.length ?? 0) > 300) errors.description = 'Description must be 300 characters or fewer.';
  if (!Number.isInteger(input.amount) || input.amount <= 0) errors.amount = 'Enter an amount greater than zero.';
  else if (input.amount > MAX_ENTRY_PAISA) errors.amount = 'Amount is too large. Please check it.';
  if (!isCategory(input.category)) errors.category = 'Choose a category.';
  if (!isValidISODate(input.date)) errors.date = 'Choose a valid date.';
  else if (input.date > today) errors.date = 'Expense date cannot be in the future.';
  if (!Number.isInteger(input.paidBy)) errors.paidBy = 'Choose who paid.';
  if (input.splitMode !== 'equal' && input.splitMode !== 'amounts') errors.splitMode = 'Choose how to split.';
  if (!errors.amount) {
    const check = checkSplit(input.amount, input.splits);
    if (!check.isBalanced) errors.splits = check.errors[0];
  }
  return errors;
}

async function assertValid(db: Db, input: ExpenseInput) {
  const first = Object.values(validateExpense(input))[0];
  if (first) throw new AppError('VALIDATION', first);
  const ids = [...new Set([input.paidBy, ...input.splits.filter((s) => s.amount > 0).map((s) => s.memberId)])];
  const found = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM members WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  if ((found?.n ?? 0) !== ids.length) throw new AppError('NOT_FOUND', 'One of the selected members no longer exists.');
}

export async function findDuplicateExpense(db: Db, input: ExpenseInput, excludeId?: number): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM expenses
     WHERE lower(trim(title)) = lower(?) AND amount = ? AND expense_date = ? AND paid_by IS ? AND id != ?`,
    [input.title.trim(), input.amount, input.date, input.paidBy, excludeId ?? -1],
  );
  return row !== null;
}

async function writeSplits(db: Db, expenseId: number, splits: SplitEntry[]) {
  await db.runAsync('DELETE FROM expense_splits WHERE expense_id = ?', [expenseId]);
  for (const s of splits) {
    if (s.amount <= 0) continue;
    await db.runAsync('INSERT INTO expense_splits (expense_id, member_id, amount) VALUES (?, ?, ?)', [
      expenseId,
      s.memberId,
      s.amount,
    ]);
  }
}

export async function createExpense(db: Db, input: ExpenseInput, opts: { allowDuplicate?: boolean } = {}): Promise<number> {
  await assertValid(db, input);
  if (!opts.allowDuplicate && (await findDuplicateExpense(db, input))) {
    throw new AppError('DUPLICATE', 'An expense with the same title, amount, date and payer already exists. Add it anyway?');
  }
  return transaction(db, async () => {
    const res = await db.runAsync(
      `INSERT INTO expenses (title, description, amount, category, expense_date, paid_by, split_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.title.trim(), input.description?.trim() || null, input.amount, input.category, input.date, input.paidBy, input.splitMode],
    );
    await writeSplits(db, res.lastInsertRowId, input.splits);
    return res.lastInsertRowId;
  });
}

export async function updateExpense(
  db: Db,
  id: number,
  input: ExpenseInput,
  opts: { allowDuplicate?: boolean } = {},
): Promise<void> {
  if (!(await getExpense(db, id))) throw new AppError('NOT_FOUND', 'Expense not found.');
  await assertValid(db, input);
  if (!opts.allowDuplicate && (await findDuplicateExpense(db, input, id))) {
    throw new AppError('DUPLICATE', 'Another expense with the same title, amount, date and payer already exists. Save anyway?');
  }
  await transaction(db, async () => {
    await db.runAsync(
      `UPDATE expenses SET title = ?, description = ?, amount = ?, category = ?, expense_date = ?,
         paid_by = ?, split_mode = ?, updated_at = datetime('now') WHERE id = ?`,
      [input.title.trim(), input.description?.trim() || null, input.amount, input.category, input.date, input.paidBy, input.splitMode, id],
    );
    await writeSplits(db, id, input.splits);
  });
}

export async function deleteExpense(db: Db, id: number): Promise<void> {
  if (!(await getExpense(db, id))) throw new AppError('NOT_FOUND', 'Expense not found.');
  await transaction(db, async () => {
    await db.runAsync('DELETE FROM expense_splits WHERE expense_id = ?', [id]);
    await db.runAsync('DELETE FROM expenses WHERE id = ?', [id]);
  });
}

export async function getExpense(db: Db, id: number): Promise<ExpenseDetail | null> {
  const row = await db.getFirstAsync<ExpenseRow>(`${SELECT} WHERE e.id = ?`, [id]);
  if (!row) return null;
  const splits = await db.getAllAsync<{ member_id: number; name: string; amount: number }>(
    `SELECT s.member_id, m.name, s.amount FROM expense_splits s JOIN members m ON m.id = s.member_id
     WHERE s.expense_id = ? ORDER BY m.name COLLATE NOCASE`,
    [id],
  );
  return { ...toExpense(row), splits: splits.map((s) => ({ memberId: s.member_id, memberName: s.name, amount: s.amount })) };
}

export interface ExpenseFilter {
  from?: string;
  to?: string;
  category?: Category;
  search?: string;
  limit?: number;
}

export async function listExpenses(db: Db, filter: ExpenseFilter = {}): Promise<Expense[]> {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (filter.from) {
    where.push('e.expense_date >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    where.push('e.expense_date <= ?');
    params.push(filter.to);
  }
  if (filter.category) {
    where.push('e.category = ?');
    params.push(filter.category);
  }
  const search = filter.search?.trim();
  if (search) {
    where.push("(e.title LIKE ? ESCAPE '\\' OR e.description LIKE ? ESCAPE '\\' OR m.name LIKE ? ESCAPE '\\')");
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
  }
  let sql = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.expense_date DESC, e.id DESC`;
  if (filter.limit) {
    sql += ' LIMIT ?';
    params.push(filter.limit);
  }
  return (await db.getAllAsync<ExpenseRow>(sql, params)).map(toExpense);
}

export interface MemberExpense extends Expense {
  /** This member's share of the expense (0 if they paid but were not part of the split). */
  myShare: number;
}

/** Expenses a member paid for or shares in, newest first. */
export async function listExpensesForMember(db: Db, memberId: number): Promise<MemberExpense[]> {
  const rows = await db.getAllAsync<ExpenseRow & { my_share: number | null }>(
    `SELECT e.*, m.name AS paid_by_name, c.name AS created_by_name,
       (SELECT COUNT(*) FROM expense_splits s WHERE s.expense_id = e.id AND s.amount > 0) AS split_count,
       (SELECT x.amount FROM expense_splits x WHERE x.expense_id = e.id AND x.member_id = ?) AS my_share
     FROM expenses e LEFT JOIN members m ON m.id = e.paid_by LEFT JOIN members c ON c.id = e.created_by
     WHERE e.paid_by = ? OR EXISTS (SELECT 1 FROM expense_splits s WHERE s.expense_id = e.id AND s.member_id = ?)
     ORDER BY e.expense_date DESC, e.id DESC`,
    [memberId, memberId, memberId],
  );
  return rows.map((r) => ({ ...toExpense(r), myShare: r.my_share ?? 0 }));
}

export async function countExpensesWithoutPayer(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM expenses WHERE paid_by IS NULL', []);
  return row?.n ?? 0;
}
