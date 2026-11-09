/**
 * Tricount-style splitting and settling. All amounts are integer paisa.
 *
 * Balance convention: balance = what a member paid − their share.
 *   positive → the group owes them (they "get back")
 *   negative → they owe the group
 * All balances always add up to zero.
 */

export type SplitMode = 'equal' | 'amounts';

export interface SplitEntry {
  memberId: number;
  amount: number;
}

/**
 * Splits `total` equally between members. Leftover paisa from rounding go one each
 * to the first members, so the parts always add up to exactly `total`.
 */
export function equalSplit(total: number, memberIds: readonly number[]): SplitEntry[] {
  const n = memberIds.length;
  if (n === 0 || !Number.isInteger(total) || total <= 0) return memberIds.map((memberId) => ({ memberId, amount: 0 }));
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return memberIds.map((memberId, i) => ({ memberId, amount: base + (i < extra ? 1 : 0) }));
}

export interface SplitCheck {
  allocated: number;
  /** total − allocated. Positive = still to assign, negative = over-assigned. */
  remaining: number;
  isBalanced: boolean;
  errors: string[];
}

/** Validates that shares are non-negative, unique per member and add up exactly to the total. */
export function checkSplit(total: number, splits: readonly SplitEntry[]): SplitCheck {
  const errors: string[] = [];
  const allocated = splits.reduce((acc, s) => acc + s.amount, 0);
  const remaining = total - allocated;

  if (!Number.isInteger(total) || total <= 0) errors.push('Enter the expense amount first.');
  if (splits.some((s) => !Number.isInteger(s.amount) || s.amount < 0)) errors.push('Shares must be zero or positive amounts.');
  const ids = new Set<number>();
  for (const s of splits) {
    if (ids.has(s.memberId)) errors.push('A member appears more than once.');
    ids.add(s.memberId);
  }
  if (!splits.some((s) => s.amount > 0)) errors.push('Choose at least one member to split with.');
  if (remaining > 0) errors.push('Shares are less than the total amount.');
  if (remaining < 0) errors.push('Shares are more than the total amount.');

  return { allocated, remaining, isBalanced: remaining === 0 && errors.length === 0, errors };
}

export interface Transfer {
  fromId: number;
  toId: number;
  amount: number;
}

/**
 * Suggests the payments that settle all balances, using as few transfers as practical:
 * the biggest debtor repeatedly pays the biggest creditor. Ties break by id so the
 * suggestion is stable.
 */
export function suggestTransfers(balances: readonly { memberId: number; balance: number }[]): Transfer[] {
  const creditors = balances
    .filter((b) => b.balance > 0)
    .map((b) => ({ id: b.memberId, left: b.balance }))
    .sort((a, b) => b.left - a.left || a.id - b.id);
  const debtors = balances
    .filter((b) => b.balance < 0)
    .map((b) => ({ id: b.memberId, left: -b.balance }))
    .sort((a, b) => b.left - a.left || a.id - b.id);

  const transfers: Transfer[] = [];
  let c = 0;
  let d = 0;
  while (c < creditors.length && d < debtors.length) {
    const amount = Math.min(creditors[c].left, debtors[d].left);
    if (amount > 0) transfers.push({ fromId: debtors[d].id, toId: creditors[c].id, amount });
    creditors[c].left -= amount;
    debtors[d].left -= amount;
    if (creditors[c].left === 0) c++;
    if (debtors[d].left === 0) d++;
  }
  return transfers;
}
