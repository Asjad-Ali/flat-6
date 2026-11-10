import { createContext, useContext } from 'react';

import type { ExpenseInput } from '../db/expenses';
import type { MemberInput } from '../db/members';
import type { SettlementInput } from '../db/settlements';

export interface Me {
  memberId: number;
  name: string;
  username: string;
  isAdmin: boolean;
}

export interface SyncState {
  status: 'idle' | 'syncing' | 'offline' | 'error';
  lastSyncedAt: number | null;
  message?: string;
}

type SaveOpts = { allowDuplicate?: boolean };

/**
 * Every change the screens make goes through the store. Local mode writes to the phone's
 * database; shared mode writes to Firebase, which then updates every phone's copy.
 */
export interface Store {
  mode: 'local' | 'cloud';
  /** The logged-in member (shared mode only). */
  me: Me | null;
  sync: SyncState;
  /** Whether the current user may edit/delete an entry added by `createdBy` (only its creator). */
  canEdit(createdBy: number | null): boolean;
  canManageMembers: boolean;
  saveExpense(id: number | undefined, input: ExpenseInput, opts?: SaveOpts): Promise<number>;
  deleteExpense(id: number): Promise<void>;
  createSettlement(input: SettlementInput, opts?: SaveOpts): Promise<number>;
  deleteSettlement(id: number): Promise<void>;
  saveMember(id: number | undefined, input: MemberInput): Promise<number>;
  removeMember(id: number): Promise<'deleted' | 'archived'>;
  restoreMember(id: number): Promise<void>;
  /** Shared mode, admin only: gives a member who forgot their password a new one. */
  resetMemberLogin?(id: number, password: string): Promise<void>;
  /** Refresh screens from the latest shared data. */
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

export const StoreContext = createContext<Store | null>(null);

/** Increments whenever data changes, so loaded screens reload. */
export const DataVersionContext = createContext(0);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside a store provider');
  return store;
}

export function useDataVersion(): number {
  return useContext(DataVersionContext);
}
