import { getMemberBalances, getSettlementPlan, type MemberBalance, type SuggestedPayment } from '../db/balances';
import type { Db } from '../db/client';
import { listExpenses, type Expense } from '../db/expenses';
import { categoryBreakdown, type CategoryTotal } from '../db/reports';
import { listSettlements, type Settlement } from '../db/settlements';

export interface ReportPeriod {
  label: string;
  /** Inclusive ISO dates; both undefined means all time. */
  from?: string;
  to?: string;
}

export interface ReportExpense extends Expense {
  splits: { name: string; amount: number }[];
}

export interface MemberPeriodSummary {
  name: string;
  paid: number;
  share: number;
}

export interface ReportData {
  period: ReportPeriod;
  generatedOn: string;
  total: number;
  expenses: ReportExpense[];
  categories: CategoryTotal[];
  settlements: Settlement[];
  /** Paid vs share within the period. */
  members: MemberPeriodSummary[];
  /** Current (all-time) balances and settle-up plan. */
  balances: MemberBalance[];
  plan: SuggestedPayment[];
}

export async function getReportData(db: Db, period: ReportPeriod, generatedOn: string): Promise<ReportData> {
  const range = { from: period.from, to: period.to };
  const expenses = (await listExpenses(db, range)).reverse(); // oldest first reads like a ledger
  const ids = expenses.map((e) => e.id);
  const splitRows = ids.length
    ? await db.getAllAsync<{ expense_id: number; name: string; amount: number }>(
        `SELECT s.expense_id, m.name, s.amount FROM expense_splits s JOIN members m ON m.id = s.member_id
         WHERE s.expense_id IN (${ids.map(() => '?').join(',')}) AND s.amount > 0
         ORDER BY m.name COLLATE NOCASE`,
        ids,
      )
    : [];

  const withSplits: ReportExpense[] = expenses.map((e) => ({
    ...e,
    splits: splitRows.filter((s) => s.expense_id === e.id).map((s) => ({ name: s.name, amount: s.amount })),
  }));

  const perMember = new Map<string, MemberPeriodSummary>();
  const row = (name: string) => {
    if (!perMember.has(name)) perMember.set(name, { name, paid: 0, share: 0 });
    return perMember.get(name)!;
  };
  for (const e of withSplits) {
    if (!e.paidByName) continue;
    row(e.paidByName).paid += e.amount;
    for (const s of e.splits) row(s.name).share += s.amount;
  }

  return {
    period,
    generatedOn,
    total: expenses.reduce((a, e) => a + e.amount, 0),
    expenses: withSplits,
    categories: await categoryBreakdown(db, period.from ?? '0000-01-01', period.to ?? '9999-12-31'),
    settlements: (await listSettlements(db, range)).reverse(),
    members: [...perMember.values()].sort((a, b) => a.name.localeCompare(b.name)),
    balances: await getMemberBalances(db),
    plan: await getSettlementPlan(db),
  };
}
