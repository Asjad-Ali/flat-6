import type { SupabaseClient } from '@supabase/supabase-js';

import { AppError } from '../db/client';
import type { ExpenseInput } from '../db/expenses';
import type { MemberInput } from '../db/members';
import type { SettlementInput } from '../db/settlements';

export const OFFLINE_MESSAGE = 'No internet connection. Connect to the internet to save. Nothing was changed.';

/** True when an error means the server could not be reached. */
export function isNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : String(error);
  return /network request failed|failed to fetch|fetch failed|network ?error|timed? ?out|load failed/i.test(message);
}

/** Turns a Supabase/Postgres error into a message safe to show to the user. */
export function toAppError(error: { message: string; code?: string }): AppError {
  if (isNetworkError(error)) return new AppError('OFFLINE', OFFLINE_MESSAGE);
  // Our database functions raise plain-language messages (code P0001).
  if (error.code === 'P0001') {
    const forbidden = /^Only |log in|not linked/i.test(error.message);
    return new AppError(forbidden ? 'FORBIDDEN' : 'VALIDATION', error.message);
  }
  if (error.code === '23505') return new AppError('DUPLICATE', 'This already exists.');
  return new AppError('VALIDATION', `The server rejected this change: ${error.message}`);
}

async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  let result;
  try {
    result = await sb.rpc(fn, args);
  } catch (e) {
    if (isNetworkError(e)) throw new AppError('OFFLINE', OFFLINE_MESSAGE);
    throw e;
  }
  if (result.error) throw toAppError(result.error);
  return result.data as T;
}

export const remote = {
  claimMember: (sb: SupabaseClient) => rpc<number>(sb, 'claim_member', {}),

  saveExpense: (sb: SupabaseClient, id: number | undefined, input: ExpenseInput) =>
    rpc<number>(sb, 'save_expense', {
      p_id: id ?? null,
      p_title: input.title.trim(),
      p_description: input.description?.trim() || null,
      p_amount: input.amount,
      p_category: input.category,
      p_date: input.date,
      p_paid_by: input.paidBy,
      p_split_mode: input.splitMode,
      p_splits: input.splits.filter((s) => s.amount > 0).map((s) => ({ member_id: s.memberId, amount: s.amount })),
    }),

  deleteExpense: (sb: SupabaseClient, id: number) => rpc<void>(sb, 'delete_expense', { p_id: id }),

  addSettlement: (sb: SupabaseClient, input: SettlementInput) =>
    rpc<number>(sb, 'add_settlement', {
      p_from: input.fromId,
      p_to: input.toId,
      p_amount: input.amount,
      p_date: input.date,
      p_note: input.note?.trim() || null,
    }),

  deleteSettlement: (sb: SupabaseClient, id: number) => rpc<void>(sb, 'delete_settlement', { p_id: id }),

  saveMember: (sb: SupabaseClient, id: number | undefined, input: MemberInput) =>
    rpc<number>(sb, 'admin_save_member', {
      p_id: id ?? null,
      p_name: input.name.trim(),
      p_username: (input.username ?? '').trim().toLowerCase(),
      p_phone: input.phone?.trim() || null,
      p_email: input.email?.trim() || null,
      p_notes: input.notes?.trim() || null,
    }),

  setMemberActive: (sb: SupabaseClient, id: number, active: boolean) =>
    rpc<void>(sb, 'admin_set_member_active', { p_id: id, p_active: active }),
};
