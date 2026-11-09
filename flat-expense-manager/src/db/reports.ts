import type { Category } from '../domain/categories';
import { addDays, diffDays, formatRange, monthRange, startOfWeek, todayISO } from '../domain/dates';
import { getMemberBalances, getSettlementPlan, type SuggestedPayment } from './balances';
import type { Db } from './client';
import { countExpensesWithoutPayer, listExpenses, type Expense } from './expenses';

export interface CategoryTotal {
  category: Category;
  total: number;
  count: number;
}

export interface DayTotal {
  date: string;
  total: number;
  count: number;
}

export interface Transaction {
  kind: 'expense' | 'settlement';
  id: number;
  label: string;
  /** "Paid by Ali" for expenses, "Bilal → Ali" for settlements. */
  detail: string;
  category: Category | null;
  amount: number;
  date: string;
}

export interface Dashboard {
  totalExpenses: number;
  period: { from: string; to: string; label: string };
  periodExpenses: number;
  memberCount: number;
  /** Total still owed across the group (sum of positive balances). */
  toSettle: number;
  plan: SuggestedPayment[];
  expensesWithoutPayer: number;
  recent: Transaction[];
}

export async function categoryBreakdown(db: Db, from: string, to: string): Promise<CategoryTotal[]> {
  return db.getAllAsync<CategoryTotal>(
    `SELECT category, SUM(amount) AS total, COUNT(*) AS count
     FROM expenses WHERE expense_date BETWEEN ? AND ?
     GROUP BY category ORDER BY total DESC`,
    [from, to],
  );
}

export async function dailyTotals(db: Db, from: string, to: string): Promise<DayTotal[]> {
  return db.getAllAsync<DayTotal>(
    `SELECT expense_date AS date, SUM(amount) AS total, COUNT(*) AS count
     FROM expenses WHERE expense_date BETWEEN ? AND ?
     GROUP BY expense_date ORDER BY expense_date DESC`,
    [from, to],
  );
}

export async function listRecentTransactions(db: Db, limit = 8): Promise<Transaction[]> {
  return db.getAllAsync<Transaction>(
    `SELECT kind, id, label, detail, category, amount, date FROM (
       SELECT 'expense' AS kind, e.id, e.title AS label,
              CASE WHEN m.name IS NULL THEN 'Paid by: not set' ELSE 'Paid by ' || m.name END AS detail,
              e.category, e.amount, e.expense_date AS date, e.created_at
       FROM expenses e LEFT JOIN members m ON m.id = e.paid_by
       UNION ALL
       SELECT 'settlement' AS kind, s.id, f.name || ' paid ' || t.name AS label, 'Payment' AS detail,
              NULL AS category, s.amount, s.settlement_date AS date, s.created_at
       FROM settlements s JOIN members f ON f.id = s.from_member_id JOIN members t ON t.id = s.to_member_id
     ) ORDER BY date DESC, created_at DESC, id DESC LIMIT ?`,
    [limit],
  );
}

export async function getDashboard(db: Db, today = todayISO()): Promise<Dashboard> {
  const from = startOfWeek(today);
  const to = addDays(from, 6);
  const totals = await db.getFirstAsync<{ total: number; week: number; members: number }>(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0) FROM expenses) AS total,
       (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE expense_date BETWEEN ? AND ?) AS week,
       (SELECT COUNT(*) FROM members WHERE is_active = 1) AS members`,
    [from, to],
  );
  const balances = await getMemberBalances(db, { includeInactive: true });
  return {
    totalExpenses: totals?.total ?? 0,
    period: { from, to, label: formatRange(from, to) },
    periodExpenses: totals?.week ?? 0,
    memberCount: totals?.members ?? 0,
    toSettle: balances.reduce((acc, b) => acc + Math.max(b.balance, 0), 0),
    plan: await getSettlementPlan(db),
    expensesWithoutPayer: await countExpensesWithoutPayer(db),
    recent: await listRecentTransactions(db),
  };
}

export interface DailyReport {
  date: string;
  total: number;
  expenses: Expense[];
  categories: CategoryTotal[];
}

export async function getDailyReport(db: Db, date: string): Promise<DailyReport> {
  const expenses = await listExpenses(db, { from: date, to: date });
  return {
    date,
    total: expenses.reduce((acc, e) => acc + e.amount, 0),
    expenses,
    categories: await categoryBreakdown(db, date, date),
  };
}

export interface WeekTotal {
  from: string;
  to: string;
  total: number;
  count: number;
}

/** Expenses grouped by calendar week (Monday–Sunday), newest first. */
export async function getWeeklyReport(db: Db): Promise<WeekTotal[]> {
  const days = await db.getAllAsync<DayTotal>(
    'SELECT expense_date AS date, SUM(amount) AS total, COUNT(*) AS count FROM expenses GROUP BY expense_date',
    [],
  );
  const weeks = new Map<string, WeekTotal>();
  for (const d of days) {
    const from = startOfWeek(d.date);
    const w = weeks.get(from) ?? { from, to: addDays(from, 6), total: 0, count: 0 };
    w.total += d.total;
    w.count += d.count;
    weeks.set(from, w);
  }
  return [...weeks.values()].sort((a, b) => b.from.localeCompare(a.from));
}

export interface MonthlyReport {
  from: string;
  to: string;
  total: number;
  count: number;
  averagePerDay: number;
  settled: number;
  categories: CategoryTotal[];
  days: DayTotal[];
}

export async function getMonthlyReport(db: Db, month: string, today = todayISO()): Promise<MonthlyReport> {
  const { from, to } = monthRange(month);
  const categories = await categoryBreakdown(db, from, to);
  const days = await dailyTotals(db, from, to);
  const total = categories.reduce((acc, c) => acc + c.total, 0);
  const count = categories.reduce((acc, c) => acc + c.count, 0);
  const settledRow = await db.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM settlements WHERE settlement_date BETWEEN ? AND ?',
    [from, to],
  );
  // Average over elapsed days for the current month, the whole month otherwise.
  const lastDay = to < today ? to : today < from ? from : today;
  const elapsed = diffDays(from, lastDay) + 1;
  return {
    from,
    to,
    total,
    count,
    averagePerDay: Math.round(total / elapsed),
    settled: settledRow?.total ?? 0,
    categories,
    days,
  };
}
