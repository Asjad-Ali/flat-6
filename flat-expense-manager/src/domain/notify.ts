import { formatPKR } from './money';

/** A phone that should receive notifications, and the member it belongs to. */
export interface PushTarget {
  token: string;
  memberId: string;
}

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: 'default';
  channelId: 'default';
  priority: 'high';
}

const message = (to: string, title: string, body: string, data: Record<string, string>): PushMessage => ({
  to,
  title,
  body,
  data,
  sound: 'default',
  channelId: 'default',
  priority: 'high',
});

/** One notification per phone of every member except the person who added the expense. */
export function expenseAddedMessages(input: {
  targets: readonly PushTarget[];
  actorId: string;
  actorName: string;
  expenseId: string;
  title: string;
  amount: number;
  splits: readonly { memberId: string; amount: number }[];
}): PushMessage[] {
  return input.targets
    .filter((t) => t.memberId !== input.actorId)
    .map((t) => {
      const share = input.splits.find((s) => s.memberId === t.memberId)?.amount ?? 0;
      const body =
        `${input.actorName} added ${input.title} · ${formatPKR(input.amount)}` +
        (share > 0 ? ` · your share ${formatPKR(share)}` : ' · you are not in this split');
      return message(t.token, 'New expense', body, { type: 'expense', expenseId: input.expenseId });
    });
}

/** Tells everyone except the person who recorded it that a payment between members was saved. */
export function paymentRecordedMessages(input: {
  targets: readonly PushTarget[];
  actorId: string;
  fromName: string;
  toName: string;
  amount: number;
}): PushMessage[] {
  return input.targets
    .filter((t) => t.memberId !== input.actorId)
    .map((t) => message(t.token, 'Payment recorded', `${input.fromName} paid ${input.toName} ${formatPKR(input.amount)}`, { type: 'payment' }));
}
