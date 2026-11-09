import {
  addDays,
  addMonths,
  diffDays,
  formatRange,
  isValidISODate,
  monthRange,
  startOfWeek,
} from '../src/domain/dates';
import { formatPKR, paisaToInput, parseAmount } from '../src/domain/money';
import { checkSplit, equalSplit, suggestTransfers } from '../src/domain/split';

describe('money', () => {
  it('formats PKR with grouping and optional decimals', () => {
    expect(formatPKR(0)).toBe('Rs. 0');
    expect(formatPKR(123456700)).toBe('Rs. 1,234,567');
    expect(formatPKR(150)).toBe('Rs. 1.50');
    expect(formatPKR(-2505)).toBe('-Rs. 25.05');
    expect(formatPKR(500, { signed: true })).toBe('+Rs. 5');
  });

  it('parses user input into integer paisa', () => {
    expect(parseAmount('1,250')).toBe(125000);
    expect(parseAmount('Rs. 99.9')).toBe(9990);
    expect(parseAmount('0.01')).toBe(1);
    expect(parseAmount(' 10 ')).toBe(1000);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('1.234')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1.2.3')).toBeNull();
  });

  it('avoids floating point drift (0.1 + 0.2)', () => {
    expect(parseAmount('0.1')! + parseAmount('0.2')!).toBe(parseAmount('0.3'));
  });

  it('round-trips amounts for editing', () => {
    for (const p of [1, 99, 100, 125050, 999999999]) expect(parseAmount(paisaToInput(p))).toBe(p);
  });
});

describe('dates', () => {
  it('validates ISO dates including leap years', () => {
    expect(isValidISODate('2024-02-29')).toBe(true);
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('8/11/2026')).toBe(false);
  });

  it('does date arithmetic across month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-11-02', '2026-11-08')).toBe(6);
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02'); // Sunday -> Monday before
    expect(startOfWeek('2026-11-02')).toBe('2026-11-02');
  });

  it('handles months', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('formats ranges compactly', () => {
    expect(formatRange('2026-11-02', '2026-11-08')).toBe('2 – 8 Nov 2026');
    expect(formatRange('2026-10-28', '2026-11-03')).toBe('28 Oct – 3 Nov 2026');
  });
});

describe('splitting', () => {
  it('splits equally and gives leftover paisa to the first members', () => {
    expect(equalSplit(900, [1, 2, 3]).map((s) => s.amount)).toEqual([300, 300, 300]);
    expect(equalSplit(1000, [1, 2, 3]).map((s) => s.amount)).toEqual([334, 333, 333]);
    expect(equalSplit(1000, [])).toEqual([]);
    const parts = equalSplit(100001, [1, 2, 3, 4, 5, 6, 7]);
    expect(parts.reduce((a, s) => a + s.amount, 0)).toBe(100001);
  });

  it('accepts only exact splits', () => {
    expect(checkSplit(1000, [{ memberId: 1, amount: 700 }, { memberId: 2, amount: 300 }]).isBalanced).toBe(true);
    const under = checkSplit(1000, [{ memberId: 1, amount: 900 }]);
    expect(under.remaining).toBe(100);
    expect(under.isBalanced).toBe(false);
    expect(checkSplit(1000, [{ memberId: 1, amount: 1100 }]).remaining).toBe(-100);
    expect(checkSplit(1000, [{ memberId: 1, amount: -100 }, { memberId: 2, amount: 1100 }]).isBalanced).toBe(false);
    expect(checkSplit(1000, [{ memberId: 1, amount: 500 }, { memberId: 1, amount: 500 }]).isBalanced).toBe(false);
    expect(checkSplit(1000, []).isBalanced).toBe(false);
  });
});

describe('settle up', () => {
  const total = (t: { amount: number }[]) => t.reduce((a, x) => a + x.amount, 0);

  it('suggests who pays whom', () => {
    // Ali +2000, Bilal −550, Usman −1450
    const t = suggestTransfers([
      { memberId: 1, balance: 2000 },
      { memberId: 2, balance: -550 },
      { memberId: 3, balance: -1450 },
    ]);
    expect(t).toEqual([
      { fromId: 3, toId: 1, amount: 1450 },
      { fromId: 2, toId: 1, amount: 550 },
    ]);
  });

  it('settles every balance exactly with at most n−1 payments', () => {
    const balances = [
      { memberId: 1, balance: 5000 },
      { memberId: 2, balance: 1500 },
      { memberId: 3, balance: -2000 },
      { memberId: 4, balance: -3000 },
      { memberId: 5, balance: -1500 },
      { memberId: 6, balance: 0 },
    ];
    const t = suggestTransfers(balances);
    expect(t.length).toBeLessThanOrEqual(5);
    expect(total(t)).toBe(6500);
    const after = new Map(balances.map((b) => [b.memberId, b.balance]));
    for (const x of t) {
      after.set(x.fromId, after.get(x.fromId)! + x.amount);
      after.set(x.toId, after.get(x.toId)! - x.amount);
    }
    expect([...after.values()].every((v) => v === 0)).toBe(true);
  });

  it('returns nothing when everyone is settled', () => {
    expect(suggestTransfers([{ memberId: 1, balance: 0 }])).toEqual([]);
  });
});
