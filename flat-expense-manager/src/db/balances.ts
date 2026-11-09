import { suggestTransfers } from '../domain/split';
import type { Db } from './client';

export interface MemberBalance {
  memberId: number;
  name: string;
  isActive: boolean;
  /** Total of expenses this member paid for the group. */
  paid: number;
  /** This member's share of all expenses. */
  share: number;
  /** Money this member paid back to others. */
  sent: number;
  /** Money this member received back from others. */
  received: number;
  /** paid + sent − share − received. Positive = gets back, negative = owes. */
  balance: number;
}

/** Every member's balance. Former members are included only while their balance is not zero. */
export async function getMemberBalances(db: Db, opts: { includeInactive?: boolean } = {}): Promise<MemberBalance[]> {
  const rows = await db.getAllAsync<{
    id: number;
    name: string;
    is_active: number;
    paid: number;
    share: number;
    sent: number;
    received: number;
  }>(
    `SELECT m.id, m.name, m.is_active,
       COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.paid_by = m.id), 0) AS paid,
       COALESCE((SELECT SUM(s.amount) FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
                 WHERE s.member_id = m.id AND e.paid_by IS NOT NULL), 0) AS share,
       COALESCE((SELECT SUM(amount) FROM settlements WHERE from_member_id = m.id), 0) AS sent,
       COALESCE((SELECT SUM(amount) FROM settlements WHERE to_member_id = m.id), 0) AS received
     FROM members m
     ORDER BY m.is_active DESC, m.name COLLATE NOCASE`,
    [],
  );
  return rows
    .map((r) => ({
      memberId: r.id,
      name: r.name,
      isActive: r.is_active === 1,
      paid: r.paid,
      share: r.share,
      sent: r.sent,
      received: r.received,
      balance: r.paid + r.sent - r.share - r.received,
    }))
    .filter((b) => b.isActive || opts.includeInactive || b.balance !== 0);
}

export async function getMemberBalance(db: Db, memberId: number): Promise<MemberBalance | null> {
  const all = await getMemberBalances(db, { includeInactive: true });
  return all.find((b) => b.memberId === memberId) ?? null;
}

export interface SuggestedPayment {
  fromId: number;
  fromName: string;
  toId: number;
  toName: string;
  amount: number;
}

/** "Who pays whom" to settle everyone up, with as few payments as practical. */
export async function getSettlementPlan(db: Db): Promise<SuggestedPayment[]> {
  const balances = await getMemberBalances(db, { includeInactive: true });
  const names = new Map(balances.map((b) => [b.memberId, b.name]));
  return suggestTransfers(balances).map((t) => ({
    ...t,
    fromName: names.get(t.fromId) ?? '?',
    toName: names.get(t.toId) ?? '?',
  }));
}
