import { getMemberBalances, getSettlementPlan } from '../src/db/balances';
import { isAppError, type Db } from '../src/db/client';
import {
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  listExpensesForMember,
  updateExpense,
  type ExpenseInput,
} from '../src/db/expenses';
import { createMember, listMembers, removeMember, restoreMember, updateMember } from '../src/db/members';
import { getDailyReport, getDashboard, getMonthlyReport, getWeeklyReport } from '../src/db/reports';
import { migrate } from '../src/db/schema';
import { createSettlement, deleteSettlement, listSettlements } from '../src/db/settlements';
import { equalSplit } from '../src/domain/split';
import { getReportData } from '../src/report/data';
import { buildReportHtml } from '../src/report/html';
import { createTestDb } from './testDb';

const TODAY = '2026-11-15';
const rs = (rupees: number) => rupees * 100;

async function expectAppError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (e) {
    expect(isAppError(e)).toBe(true);
    expect((e as { code: string }).code).toBe(code);
    return;
  }
  throw new Error(`Expected AppError ${code}`);
}

describe('Tricount-style workflow', () => {
  let db: Db;
  let ali: number;
  let bilal: number;
  let usman: number;

  /** Expense paid by `paidBy`, split equally between `between`. */
  const equal = (title: string, rupees: number, paidBy: number, between: number[], date = '2026-11-10'): ExpenseInput => ({
    title,
    amount: rs(rupees),
    category: 'Groceries',
    date,
    paidBy,
    splitMode: 'equal',
    splits: equalSplit(rs(rupees), between),
  });

  const balanceOf = async (id: number) => (await getMemberBalances(db, { includeInactive: true })).find((b) => b.memberId === id)!;

  beforeAll(() => {
    jest.useFakeTimers({ now: new Date(2026, 10, 15, 12) });
  });
  afterAll(() => jest.useRealTimers());

  beforeEach(async () => {
    db = await createTestDb();
    ali = await createMember(db, { name: 'Ali', phone: '0300-1234567' });
    bilal = await createMember(db, { name: 'Bilal' });
    usman = await createMember(db, { name: 'Usman', email: 'usman@example.com' });
  });

  it('migrations are idempotent', async () => {
    await migrate(db);
    expect((await listMembers(db)).length).toBe(3);
  });

  describe('members', () => {
    it('validates and prevents duplicate names', async () => {
      await expectAppError(createMember(db, { name: ' ali ' }), 'DUPLICATE');
      await expectAppError(createMember(db, { name: 'X' }), 'VALIDATION');
      await expectAppError(createMember(db, { name: 'Zain', phone: 'abc' }), 'VALIDATION');
      await expectAppError(updateMember(db, bilal, { name: 'Ali' }), 'DUPLICATE');
    });

    it('deletes members without history, archives members with history', async () => {
      const temp = await createMember(db, { name: 'Temp' });
      expect(await removeMember(db, temp)).toBe('deleted');

      await createExpense(db, equal('Milk', 300, ali, [ali, usman]));
      expect(await removeMember(db, usman)).toBe('archived');
      expect((await listMembers(db)).map((m) => m.name)).toEqual(['Ali', 'Bilal']);
      // Their debt is still visible and still part of settling up.
      expect((await getMemberBalances(db)).find((b) => b.memberId === usman)?.balance).toBe(-rs(150));
      expect(await getSettlementPlan(db)).toEqual([
        { fromId: usman, fromName: 'Usman', toId: ali, toName: 'Ali', amount: rs(150) },
      ]);
      await restoreMember(db, usman);
      expect((await listMembers(db)).length).toBe(3);
    });
  });

  describe('expenses', () => {
    it('stores who paid and how it is split', async () => {
      const id = await createExpense(db, equal('Groceries', 1000, ali, [ali, bilal, usman]));
      const e = (await getExpense(db, id))!;
      expect(e.paidByName).toBe('Ali');
      expect(e.splitCount).toBe(3);
      expect(e.splits.map((s) => s.amount)).toEqual([33334, 33333, 33333]);
    });

    it('supports unequal manual splits', async () => {
      const id = await createExpense(db, {
        title: 'Rent',
        amount: rs(30000),
        category: 'Rent',
        date: '2026-11-01',
        paidBy: bilal,
        splitMode: 'amounts',
        splits: [
          { memberId: ali, amount: rs(12000) },
          { memberId: bilal, amount: rs(10000) },
          { memberId: usman, amount: rs(8000) },
        ],
      });
      expect((await getExpense(db, id))!.splitMode).toBe('amounts');
      expect((await balanceOf(bilal)).balance).toBe(rs(20000));
      expect((await balanceOf(ali)).balance).toBe(-rs(12000));
    });

    it('rejects invalid input', async () => {
      const base = equal('Groceries', 900, ali, [ali, bilal]);
      await expectAppError(createExpense(db, { ...base, amount: 0 }), 'VALIDATION');
      await expectAppError(createExpense(db, { ...base, category: 'Fun' }), 'VALIDATION');
      await expectAppError(createExpense(db, { ...base, date: '2026-11-16' }), 'VALIDATION');
      await expectAppError(createExpense(db, { ...base, paidBy: NaN }), 'VALIDATION');
      await expectAppError(createExpense(db, { ...base, splits: [] }), 'VALIDATION');
      await expectAppError(createExpense(db, { ...base, splits: [{ memberId: ali, amount: rs(800) }] }), 'VALIDATION');
      await expectAppError(createExpense(db, { ...base, paidBy: 999 }), 'NOT_FOUND');
      expect(await listExpenses(db)).toHaveLength(0);
    });

    it('flags duplicates but allows them after confirmation', async () => {
      const base = equal('Milk', 250, ali, [ali, bilal]);
      await createExpense(db, base);
      await expectAppError(createExpense(db, base), 'DUPLICATE');
      await createExpense(db, base, { allowDuplicate: true });
      // Same expense paid by someone else is not a duplicate.
      await createExpense(db, { ...base, paidBy: bilal });
      expect(await listExpenses(db)).toHaveLength(3);
    });

    it('updates and deletes, keeping balances consistent', async () => {
      const id = await createExpense(db, equal('Gas', 900, ali, [ali, bilal, usman]));
      expect((await balanceOf(ali)).balance).toBe(rs(600));
      await updateExpense(db, id, equal('Gas', 900, bilal, [ali, bilal]));
      expect((await balanceOf(bilal)).balance).toBe(rs(450));
      expect((await balanceOf(usman)).balance).toBe(0);
      await deleteExpense(db, id);
      expect((await getMemberBalances(db)).every((b) => b.balance === 0)).toBe(true);
    });

    it('searches by title or payer and lists a member’s expenses', async () => {
      await createExpense(db, equal('Milk 5L', 1000, ali, [ali, bilal]));
      await createExpense(db, equal('Internet bill', 3000, bilal, [bilal, usman]));
      expect(await listExpenses(db, { search: 'milk' })).toHaveLength(1);
      expect(await listExpenses(db, { search: 'bilal' })).toHaveLength(1);
      expect(await listExpenses(db, { search: '100%' })).toHaveLength(0);
      const mine = await listExpensesForMember(db, bilal);
      expect(mine.map((e) => [e.title, e.myShare])).toEqual([
        ['Internet bill', rs(1500)],
        ['Milk 5L', rs(500)],
      ]);
    });
  });

  describe('balances and settling up', () => {
    it('works out who owes whom and settles to zero', async () => {
      // Ali pays 3000 for all three; Bilal pays 900 for Bilal and Usman.
      await createExpense(db, equal('Groceries', 3000, ali, [ali, bilal, usman]));
      await createExpense(db, equal('Milk', 900, bilal, [bilal, usman]));

      const balances = await getMemberBalances(db);
      expect(balances.map((b) => [b.name, b.paid, b.share, b.balance])).toEqual([
        ['Ali', rs(3000), rs(1000), rs(2000)],
        ['Bilal', rs(900), rs(1450), -rs(550)],
        ['Usman', 0, rs(1450), -rs(1450)],
      ]);
      expect(balances.reduce((a, b) => a + b.balance, 0)).toBe(0);

      const plan = await getSettlementPlan(db);
      expect(plan.map((p) => `${p.fromName}->${p.toName}:${p.amount}`)).toEqual(['Usman->Ali:145000', 'Bilal->Ali:55000']);

      // Partial payment first, then the rest.
      await createSettlement(db, { fromId: usman, toId: ali, amount: rs(1000), date: TODAY });
      expect((await balanceOf(usman)).balance).toBe(-rs(450));
      expect((await getSettlementPlan(db)).map((p) => p.amount)).toEqual([rs(550), rs(450)]);

      for (const p of await getSettlementPlan(db)) {
        await createSettlement(db, { fromId: p.fromId, toId: p.toId, amount: p.amount, date: TODAY });
      }
      expect((await getMemberBalances(db)).every((b) => b.balance === 0)).toBe(true);
      expect(await getSettlementPlan(db)).toEqual([]);
      expect(await listSettlements(db, { memberId: ali })).toHaveLength(3);
    });

    it('treats overpayment as the receiver now owing the payer', async () => {
      await createExpense(db, equal('Gas', 1000, ali, [ali, bilal]));
      await createSettlement(db, { fromId: bilal, toId: ali, amount: rs(800), date: TODAY });
      expect((await balanceOf(bilal)).balance).toBe(rs(300));
      expect(await getSettlementPlan(db)).toEqual([{ fromId: ali, fromName: 'Ali', toId: bilal, toName: 'Bilal', amount: rs(300) }]);
    });

    it('validates payments, flags duplicates, and can undo one', async () => {
      const p = { fromId: bilal, toId: ali, amount: rs(500), date: TODAY };
      const id = await createSettlement(db, p);
      await expectAppError(createSettlement(db, p), 'DUPLICATE');
      await expectAppError(createSettlement(db, { ...p, toId: bilal }), 'VALIDATION');
      await expectAppError(createSettlement(db, { ...p, amount: -1 }), 'VALIDATION');
      await expectAppError(createSettlement(db, { ...p, date: '2026-12-01' }), 'VALIDATION');
      await expectAppError(createSettlement(db, { ...p, toId: 999 }), 'NOT_FOUND');
      await deleteSettlement(db, id);
      expect(await listSettlements(db)).toHaveLength(0);
    });
  });

  describe('dashboard and reports', () => {
    it('summarises the group', async () => {
      await createExpense(db, equal('Groceries', 3000, ali, [ali, bilal, usman], '2026-11-10'));
      await createExpense(db, equal('Old rent', 600, bilal, [ali, bilal, usman], '2026-11-02'));
      await createSettlement(db, { fromId: usman, toId: ali, amount: rs(500), date: TODAY });

      const dash = await getDashboard(db, TODAY);
      expect(dash.totalExpenses).toBe(rs(3600));
      expect(dash.periodExpenses).toBe(rs(3000)); // week of 9–15 Nov
      expect(dash.memberCount).toBe(3);
      // Ali +2000−200−500 = 1300, Bilal −1000+400 = −600, Usman −1200+500 = −700
      expect(dash.toSettle).toBe(rs(1300));
      expect(dash.plan).toHaveLength(2);
      expect(dash.recent[0]).toMatchObject({ kind: 'settlement', label: 'Usman paid Ali' });
      expect(dash.recent[1]).toMatchObject({ kind: 'expense', detail: 'Paid by Ali' });
    });

    it('produces daily, weekly and monthly totals', async () => {
      await createExpense(db, equal('Milk', 250, ali, [ali, bilal], '2026-11-10'));
      await createExpense(db, { ...equal('Bread', 150, bilal, [ali, bilal], '2026-11-10'), category: 'Other' });
      await createExpense(db, { ...equal('Rent', 30000, usman, [ali, bilal, usman], '2026-11-01'), category: 'Rent' });
      await createExpense(db, equal('Oct gas', 999, ali, [ali], '2026-10-31'));
      await createSettlement(db, { fromId: ali, toId: usman, amount: rs(1000), date: '2026-11-11' });

      const daily = await getDailyReport(db, '2026-11-10');
      expect(daily.total).toBe(rs(400));
      expect(daily.categories).toHaveLength(2);

      const monthly = await getMonthlyReport(db, '2026-11', TODAY);
      expect(monthly.total).toBe(rs(30400));
      expect(monthly.categories[0]).toMatchObject({ category: 'Rent', total: rs(30000) });
      expect(monthly.settled).toBe(rs(1000));
      expect(monthly.averagePerDay).toBe(Math.round(rs(30400) / 15));

      const weekly = await getWeeklyReport(db);
      expect(weekly.map((w) => [w.from, w.total])).toEqual([
        ['2026-11-09', rs(400)],
        ['2026-10-26', rs(30000 + 999)],
      ]);
    });
  });

  describe('PDF report', () => {
    it('includes dated expenses, splits, balances and who pays whom for the period', async () => {
      await createExpense(db, equal('Roti', 600, ali, [ali, bilal, usman], '2026-11-08'));
      await createExpense(db, {
        ...equal('Ghee <b>', 1200, bilal, [ali, bilal], '2026-11-09'),
        splitMode: 'amounts',
        splits: [
          { memberId: ali, amount: rs(700) },
          { memberId: bilal, amount: rs(500) },
        ],
      });
      await createExpense(db, equal('October milk', 300, usman, [usman], '2026-10-30'));
      await createSettlement(db, { fromId: usman, toId: ali, amount: rs(100), date: '2026-11-10' });

      const data = await getReportData(db, { label: 'November 2026', from: '2026-11-01', to: '2026-11-30' }, TODAY);
      expect(data.total).toBe(rs(1800));
      expect(data.expenses.map((e) => e.title)).toEqual(['Roti', 'Ghee <b>']);
      expect(data.members).toEqual([
        { name: 'Ali', paid: rs(600), share: rs(900) },
        { name: 'Bilal', paid: rs(1200), share: rs(700) },
        { name: 'Usman', paid: 0, share: rs(200) },
      ]);

      const html = buildReportHtml(data);
      expect(html).toContain('November 2026');
      expect(html).toContain('8 Nov 2026');
      expect(html).toContain('Equally: Ali, Bilal, Usman');
      expect(html).toContain('Ali Rs. 700, Bilal Rs. 500');
      expect(html).toContain('Ghee &lt;b&gt;'); // user text is escaped
      expect(html).not.toContain('Ghee <b>');
      expect(html).toContain('<b>Ali</b> pays <b>Bilal</b>');
      expect(html).toContain('Usman → Ali');
      expect(html).not.toContain('October milk');
    });

    it('renders an empty report without errors', async () => {
      const html = buildReportHtml(await getReportData(db, { label: 'All time' }, TODAY));
      expect(html).toContain('No expenses in this period.');
      expect(html).toContain('Everyone is settled up.');
    });
  });
});
