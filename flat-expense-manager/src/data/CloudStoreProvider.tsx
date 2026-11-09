import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { getSupabase } from '../cloud/client';
import { emailToUsername, usernameToEmail } from '../cloud/config';
import { isNetworkError, OFFLINE_MESSAGE, remote } from '../cloud/remote';
import { applySnapshot, EMPTY_SNAPSHOT, fetchSnapshot, type SnapshotSource } from '../cloud/snapshot';
import { AppError, type Db } from '../db/client';
import { findDuplicateExpense, validateExpense } from '../db/expenses';
import { validateMember } from '../db/members';
import { assertNoDuplicateSettlement, validateSettlement } from '../db/settlements';
import { useDb } from '../hooks/data';
import { DataVersionContext, StoreContext, type Me, type Store, type SyncState } from './context';

function assertNoFieldErrors(errors: Record<string, string | undefined>) {
  const first = Object.values(errors).find(Boolean);
  if (first) throw new AppError('VALIDATION', first);
}

/** Finds the logged-in member in the local copy, so it also works offline. */
async function findMe(db: Db, session: Session | null): Promise<Me | null> {
  if (!session) return null;
  const username = emailToUsername(session.user.email);
  const row = await db.getFirstAsync<{ id: number; name: string; is_admin: number }>(
    'SELECT id, name, is_admin FROM members WHERE username = ? AND is_active = 1',
    [username],
  );
  return row ? { memberId: row.id, name: row.name, username, isAdmin: row.is_admin === 1 } : null;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  /** Logged in, but this login is not (or no longer) a flat member. */
  | { status: 'notMember'; message: string }
  | { status: 'ready' };

export interface CloudAuth {
  state: AuthState;
  sync: SyncState;
  signIn(username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  retry(): Promise<void>;
}

/**
 * Shared mode. Supabase is the source of truth; this phone keeps a full local copy for
 * fast screens and offline viewing. The copy refreshes on start, when the app returns to
 * the foreground, after every save, and whenever anyone changes data (live updates).
 */
export function CloudStoreProvider({ children, renderGate }: {
  children: ReactNode;
  /** Shown instead of the app while not logged in / loading. */
  renderGate: (auth: CloudAuth) => ReactNode;
}) {
  const db = useDb();
  const sb = getSupabase();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const [firstSyncDone, setFirstSyncDone] = useState(false);
  const [sync, setSync] = useState<SyncState>({ status: 'idle', lastSyncedAt: null });
  const [version, setVersion] = useState(0);
  const [signingIn, setSigningIn] = useState(false);

  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session ?? null;

  // Refreshes never overlap; a request made during a refresh runs once more afterwards.
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      again.current = true;
      return inFlight.current;
    }
    const run = async () => {
      do {
        again.current = false;
        setSync((s) => ({ ...s, status: 'syncing' }));
        try {
          const snapshot = await fetchSnapshot(sb as unknown as SnapshotSource);
          await applySnapshot(db, snapshot);
          setSync({ status: 'idle', lastSyncedAt: Date.now() });
        } catch (e) {
          const offline = isNetworkError(e);
          setSync((s) => ({
            ...s,
            status: offline ? 'offline' : 'error',
            message: offline ? 'Offline · showing saved data' : e instanceof Error ? e.message : String(e),
          }));
        }
        setMe(await findMe(db, sessionRef.current));
        setVersion((v) => v + 1);
      } while (again.current);
      setFirstSyncDone(true);
    };
    inFlight.current = run().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [db, sb]);

  // Follow login state.
  useEffect(() => {
    void sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  // While logged in: sync now, on live changes, and when the app comes back to the foreground.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 400);
    };
    const channel = sb
      .channel('flat-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, schedule)
      .subscribe();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        sb.auth.startAutoRefresh();
        schedule();
      } else {
        sb.auth.stopAutoRefresh();
      }
    });
    return () => {
      clearTimeout(timer);
      void sb.removeChannel(channel);
      appState.remove();
    };
  }, [userId, refresh, sb]);

  const signOut = useCallback(async () => {
    await sb.auth.signOut().catch(() => {});
    // Remove the shared data from this phone when logging out.
    await applySnapshot(db, EMPTY_SNAPSHOT);
    setMe(null);
    setFirstSyncDone(false);
    setVersion((v) => v + 1);
  }, [db, sb]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const u = username.trim().toLowerCase();
      if (!u || !password) throw new AppError('VALIDATION', 'Enter your username and password.');
      // Keep the login screen up until the account is linked and the first sync is done.
      setSigningIn(true);
      try {
        let result;
        try {
          result = await sb.auth.signInWithPassword({ email: usernameToEmail(u), password });
        } catch (e) {
          throw isNetworkError(e) ? new AppError('OFFLINE', 'No internet connection. Connect to log in.') : e;
        }
        if (result.error) {
          if (isNetworkError(result.error)) throw new AppError('OFFLINE', 'No internet connection. Connect to log in.');
          throw new AppError('VALIDATION', 'Wrong username or password.');
        }
        try {
          await remote.claimMember(sb);
        } catch (e) {
          await sb.auth.signOut().catch(() => {});
          throw e;
        }
        await refresh();
      } finally {
        setSigningIn(false);
      }
    },
    [refresh, sb],
  );

  const authState: AuthState =
    session === undefined
      ? { status: 'loading' }
      : session === null || signingIn
        ? { status: 'signedOut' }
        : me
          ? { status: 'ready' }
          : !firstSyncDone
            ? { status: 'loading' }
            : {
                status: 'notMember',
                message:
                  sync.status === 'offline'
                    ? 'You are offline and this phone has no saved data yet. Connect to the internet and try again.'
                    : `The login "${emailToUsername(session.user.email)}" is not an active flat member. Ask the admin.`,
              };

  const store = useMemo<Store>(() => {
    /** Runs a server change, then refreshes the local copy. */
    const write = async <T,>(task: () => Promise<T>): Promise<T> => {
      const result = await task();
      await refresh();
      return result;
    };
    const requireAdmin = () => {
      if (!me?.isAdmin) throw new AppError('FORBIDDEN', 'Only the admin can manage members.');
    };
    return {
      mode: 'cloud',
      me,
      sync,
      // Only the member who added an entry can change it (the admin has no override).
      canEdit: (createdBy) => !!me && createdBy !== null && createdBy === me.memberId,
      canManageMembers: !!me?.isAdmin,
      saveExpense: async (id, input, opts = {}) => {
        assertNoFieldErrors(validateExpense(input));
        if (!opts.allowDuplicate && (await findDuplicateExpense(db, input, id))) {
          throw new AppError('DUPLICATE', 'An expense with the same title, amount, date and payer already exists. Add it anyway?');
        }
        return write(() => remote.saveExpense(sb, id, input));
      },
      deleteExpense: (id) => write(() => remote.deleteExpense(sb, id)),
      createSettlement: async (input, opts = {}) => {
        assertNoFieldErrors(validateSettlement(input));
        if (!opts.allowDuplicate) await assertNoDuplicateSettlement(db, input);
        return write(() => remote.addSettlement(sb, input));
      },
      deleteSettlement: (id) => write(() => remote.deleteSettlement(sb, id)),
      saveMember: async (id, input) => {
        requireAdmin();
        assertNoFieldErrors(validateMember(input, { requireUsername: true }));
        return write(() => remote.saveMember(sb, id, input));
      },
      removeMember: async (id) => {
        requireAdmin();
        await write(() => remote.setMemberActive(sb, id, false));
        return 'archived';
      },
      restoreMember: async (id) => {
        requireAdmin();
        await write(() => remote.setMemberActive(sb, id, true));
      },
      refresh,
      signOut,
    };
  }, [db, me, refresh, sb, signOut, sync]);

  const auth = useMemo<CloudAuth>(
    () => ({ state: authState, sync, signIn, signOut, retry: refresh }),
    // authState is derived from these values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, signingIn, me, firstSyncDone, sync, signIn, signOut, refresh],
  );

  if (authState.status !== 'ready') return <>{renderGate(auth)}</>;

  return (
    <StoreContext.Provider value={store}>
      <DataVersionContext.Provider value={version}>{children}</DataVersionContext.Provider>
    </StoreContext.Provider>
  );
}

export { OFFLINE_MESSAGE };
