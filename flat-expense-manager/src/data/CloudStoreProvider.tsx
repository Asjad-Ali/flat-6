import { router } from 'expo-router';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { collection, onSnapshot, type DocumentData, type QuerySnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';

import { emailToUsername, usernameToEmail } from '../cloud/config';
import { getFirebase } from '../cloud/firebase';
import { onNotificationTap, registerForPush } from '../cloud/push';
import { isNetworkError, remote, sendPush, toAppError, toRemoteExpense, toRemoteMember, toRemoteSettlement } from '../cloud/remote';
import { applySnapshot, EMPTY_SNAPSHOT, localIdOf, remoteIdOf } from '../cloud/snapshot';
import { AppError, type Db } from '../db/client';
import { findDuplicateExpense, validateExpense } from '../db/expenses';
import { USERNAME_PATTERN, validateMember } from '../db/members';
import { assertNoDuplicateSettlement, validateSettlement } from '../db/settlements';
import { expenseAddedMessages, paymentRecordedMessages } from '../domain/notify';
import { useDb } from '../hooks/data';
import { DataVersionContext, StoreContext, type Me, type Store, type SyncState } from './context';

/** The logged-in member, including their Firebase member id. */
interface CloudMe extends Me {
  remoteId: string;
}

function assertNoFieldErrors(errors: Record<string, string | undefined>) {
  const first = Object.values(errors).find(Boolean);
  if (first) throw new AppError('VALIDATION', first);
}

/** Finds the logged-in member in this phone's copy, so it also works offline. */
async function findMe(db: Db, user: User | null): Promise<CloudMe | null> {
  if (!user) return null;
  const username = emailToUsername(user.email);
  const row = await db.getFirstAsync<{ id: number; name: string; is_admin: number; remote_id: string }>(
    'SELECT id, name, is_admin, remote_id FROM members WHERE username = ? AND is_active = 1 AND remote_id IS NOT NULL',
    [username],
  );
  return row ? { memberId: row.id, name: row.name, username, isAdmin: row.is_admin === 1, remoteId: row.remote_id } : null;
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
  /** False until an admin has set the flat up; null while unknown (e.g. offline). */
  flatExists: boolean | null;
  signIn(username: string, password: string): Promise<void>;
  /** First-time setup: creates the admin's login and the flat. */
  setUp(name: string, username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  retry(): Promise<void>;
}

type Listened = { members?: QuerySnapshot<DocumentData>; expenses?: QuerySnapshot<DocumentData>; settlements?: QuerySnapshot<DocumentData> };

/**
 * Shared mode. Firebase is the source of truth; this phone keeps a full copy in SQLite for
 * fast screens and offline viewing. Live listeners update the copy within a moment of anyone
 * changing anything.
 */
export function CloudStoreProvider({ children, Gate }: {
  children: ReactNode;
  /** Shown instead of the app while loading or not logged in. */
  Gate: ComponentType<{ auth: CloudAuth }>;
}) {
  const db = useDb();
  const { auth, db: firestore } = getFirebase();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [me, setMe] = useState<CloudMe | null>(null);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busyAuth, setBusyAuth] = useState(false);
  const [flatExists, setFlatExists] = useState<boolean | null>(null);
  const [sync, setSync] = useState<SyncState>({ status: 'syncing', lastSyncedAt: null });
  const [version, setVersion] = useState(0);

  const userRef = useRef<User | null>(null);
  const latest = useRef<Listened>({});
  const chain = useRef<Promise<void>>(Promise.resolve());
  const pushToken = useRef<string | null>(null);

  /** Copies the newest listener data into SQLite. Calls run one after another, never overlapping. */
  const applyLatest = useCallback((): Promise<void> => {
    chain.current = chain.current
      .then(async () => {
        const current = userRef.current;
        const { members, expenses, settlements } = latest.current;
        if (!current || !members || !expenses || !settlements) return;
        // Data served from memory while offline may be incomplete: keep the saved copy instead.
        const offline = members.metadata.fromCache || expenses.metadata.fromCache || settlements.metadata.fromCache;
        if (offline) {
          setSync((s) => ({ ...s, status: 'offline', message: 'Offline · showing saved data' }));
        } else {
          await applySnapshot(db, {
            members: members.docs.map(toRemoteMember),
            expenses: expenses.docs.map(toRemoteExpense),
            settlements: settlements.docs.map(toRemoteSettlement),
          });
          setSync({ status: 'idle', lastSyncedAt: Date.now() });
        }
        setMe(await findMe(db, current));
        setVersion((v) => v + 1);
        setReady(true);
      })
      .catch((e) => setSync((s) => ({ ...s, status: 'error', message: e instanceof Error ? e.message : String(e) })));
    return chain.current;
  }, [db]);

  // Follow the login state.
  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        userRef.current = u;
        setUser(u);
        if (!u) {
          setMe(null);
          setReady(false);
          setDenied(false);
        }
      }),
    [auth],
  );

  // Before login, find out whether the flat has been set up (decides login vs first-time setup).
  useEffect(() => {
    if (user === null) void remote.flatExists(firestore).then(setFlatExists);
  }, [user, firestore]);

  // While logged in, listen to the shared data.
  const uid = user?.uid;
  useEffect(() => {
    if (!uid || busyAuth) return;
    latest.current = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void applyLatest(), 120);
    };
    const onError = (e: unknown) => {
      if ((e as { code?: string }).code === 'permission-denied') {
        setDenied(true);
        setReady(true);
      } else {
        setSync((s) => ({ ...s, status: isNetworkError(e) ? 'offline' : 'error', message: e instanceof Error ? e.message : String(e) }));
      }
    };
    const listen = (name: keyof Listened) =>
      onSnapshot(
        collection(firestore, name),
        { includeMetadataChanges: true },
        (snap) => {
          latest.current[name] = snap;
          schedule();
        },
        onError,
      );
    const stop = [listen('members'), listen('expenses'), listen('settlements')];
    // No answer yet (slow or no internet): open with the saved copy instead of waiting.
    const fallback = setTimeout(async () => {
      setMe(await findMe(db, userRef.current));
      setReady(true);
      setSync((s) => (s.status === 'syncing' ? { ...s, status: 'offline', message: 'Offline · showing saved data' } : s));
    }, 6000);
    return () => {
      clearTimeout(timer);
      clearTimeout(fallback);
      stop.forEach((unsubscribe) => unsubscribe());
    };
  }, [uid, busyAuth, firestore, db, applyLatest]);

  // Register this phone for notifications once we know who is logged in.
  const myRemoteId = me?.remoteId;
  useEffect(() => {
    if (!uid || !myRemoteId) return;
    let cancelled = false;
    void registerForPush().then((token) => {
      if (!token || cancelled) return;
      pushToken.current = token;
      remote.savePushToken(firestore, token, uid, myRemoteId).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [uid, myRemoteId, firestore]);

  // Tapping a notification opens the expense it is about.
  useEffect(() => {
    let stop = () => {};
    void onNotificationTap(async (data) => {
      try {
        const localId = typeof data.expenseId === 'string' ? await localIdOf(db, 'expenses', data.expenseId) : null;
        if (localId) router.push(`/expense/form?id=${localId}`);
        else router.push('/balances');
      } catch {
        // Navigation is not ready yet; the user simply lands on Home.
      }
    }).then((unsubscribe) => {
      stop = unsubscribe;
    });
    return () => stop();
  }, [db]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const u = username.trim().toLowerCase();
      if (!u || !password) throw new AppError('VALIDATION', 'Enter your username and password.');
      setBusyAuth(true);
      try {
        await signInWithEmailAndPassword(auth, usernameToEmail(u), password);
      } catch (e) {
        throw isNetworkError(e) ? new AppError('OFFLINE', 'No internet connection. Connect to log in.') : toAppError(e);
      } finally {
        setBusyAuth(false);
      }
    },
    [auth],
  );

  const setUp = useCallback(
    async (name: string, username: string, password: string) => {
      const u = username.trim().toLowerCase();
      if (name.trim().length < 2) throw new AppError('VALIDATION', 'Enter your name.');
      if (!USERNAME_PATTERN.test(u)) throw new AppError('VALIDATION', 'Username: 3–30 lowercase letters, numbers, _ or . (e.g. admin).');
      if (password.length < 6) throw new AppError('VALIDATION', 'Password must be at least 6 characters.');
      setBusyAuth(true);
      try {
        let created;
        try {
          created = await createUserWithEmailAndPassword(auth, usernameToEmail(u), password);
        } catch (e) {
          throw isNetworkError(e) ? new AppError('OFFLINE', 'No internet connection. Connect to set up the flat.') : toAppError(e);
        }
        try {
          await remote.createFlat(firestore, created.user.uid, { name: name.trim(), username: u, phone: null, email: null, notes: null });
          setFlatExists(true);
        } catch (e) {
          // Someone already set this flat up: remove the login we just made.
          await deleteUser(created.user).catch(() => {});
          await firebaseSignOut(auth).catch(() => {});
          setFlatExists(await remote.flatExists(firestore));
          throw (e as AppError).code === 'FORBIDDEN'
            ? new AppError('FORBIDDEN', 'This flat is already set up. Ask the admin for your username and password.')
            : e;
        }
      } finally {
        setBusyAuth(false);
      }
    },
    [auth, firestore],
  );

  const signOut = useCallback(async () => {
    if (pushToken.current) await remote.removePushToken(firestore, pushToken.current);
    pushToken.current = null;
    await firebaseSignOut(auth).catch(() => {});
    userRef.current = null;
    // Remove the shared data from this phone when logging out.
    chain.current = chain.current.then(() => applySnapshot(db, EMPTY_SNAPSHOT)).catch(() => {});
    await chain.current;
    setMe(null);
    setReady(false);
    setSync({ status: 'syncing', lastSyncedAt: null });
    setVersion((v) => v + 1);
  }, [auth, db, firestore]);

  const authState: AuthState =
    user === undefined
      ? { status: 'loading' }
      : user === null || busyAuth
        ? { status: 'signedOut' }
        : denied
          ? { status: 'notMember', message: `The login "${emailToUsername(user.email)}" is not an active member of this flat. Ask the admin.` }
          : me
            ? { status: 'ready' }
            : !ready
              ? { status: 'loading' }
              : {
                  status: 'notMember',
                  message:
                    sync.status === 'offline'
                      ? 'You are offline and this phone has no saved data yet. Connect to the internet and try again.'
                      : `The login "${emailToUsername(user.email)}" is not an active member of this flat. Ask the admin.`,
                };

  const store = useMemo<Store>(() => {
    /** Checks the connection, runs a server change, then updates this phone's copy. */
    const write = async <T,>(task: () => Promise<T>): Promise<T> => {
      await remote.ensureOnline(firestore);
      const result = await task();
      await applyLatest();
      return result;
    };
    const requireMe = (): CloudMe => {
      if (!me) throw new AppError('FORBIDDEN', 'Please log in again.');
      return me;
    };
    const requireAdmin = () => {
      if (!requireMe().isAdmin) throw new AppError('FORBIDDEN', 'Only the admin can manage members.');
    };
    const remoteId = async (table: 'members' | 'expenses' | 'settlements', localId: number) => {
      const id = await remoteIdOf(db, table, localId);
      if (!id) throw new AppError('NOT_FOUND', 'This entry is not synced yet. Wait a moment and try again.');
      return id;
    };
    /** Alerts the other members' phones. Runs in the background; never blocks or fails a save. */
    const notify = (build: (targets: Awaited<ReturnType<typeof remote.listPushTargets>>) => ReturnType<typeof expenseAddedMessages>) => {
      void remote
        .listPushTargets(firestore)
        .then((targets) => sendPush(build(targets)))
        .catch(() => {});
    };

    return {
      mode: 'cloud',
      me,
      sync,
      // Only the member who added an entry can change it (the admin has no override).
      canEdit: (createdBy) => !!me && createdBy !== null && createdBy === me.memberId,
      canManageMembers: !!me?.isAdmin,

      saveExpense: async (id, input, opts = {}) => {
        const actor = requireMe();
        assertNoFieldErrors(validateExpense(input));
        if (!opts.allowDuplicate && (await findDuplicateExpense(db, input, id))) {
          throw new AppError('DUPLICATE', 'An expense with the same title, amount, date and payer already exists. Add it anyway?');
        }
        const data = {
          title: input.title.trim(),
          description: input.description?.trim() || null,
          amount: input.amount,
          category: input.category,
          date: input.date,
          paidBy: await remoteId('members', input.paidBy),
          splitMode: input.splitMode,
          splits: await Promise.all(
            input.splits.filter((s) => s.amount > 0).map(async (s) => ({ memberId: await remoteId('members', s.memberId), amount: s.amount })),
          ),
        };
        const existing = id ? await remoteId('expenses', id) : undefined;
        const savedId = await write(() => remote.saveExpense(firestore, existing, data, actor.remoteId));
        if (!existing) {
          notify((targets) =>
            expenseAddedMessages({ targets, actorId: actor.remoteId, actorName: actor.name, expenseId: savedId, title: data.title, amount: data.amount, splits: data.splits }),
          );
        }
        return (await localIdOf(db, 'expenses', savedId)) ?? 0;
      },

      deleteExpense: async (id) => {
        const target = await remoteId('expenses', id);
        await write(() => remote.deleteExpense(firestore, target));
      },

      createSettlement: async (input, opts = {}) => {
        const actor = requireMe();
        assertNoFieldErrors(validateSettlement(input));
        if (!opts.allowDuplicate) await assertNoDuplicateSettlement(db, input);
        const data = {
          fromId: await remoteId('members', input.fromId),
          toId: await remoteId('members', input.toId),
          amount: input.amount,
          date: input.date,
          note: input.note?.trim() || null,
        };
        const savedId = await write(() => remote.addSettlement(firestore, data, actor.remoteId));
        const names = await db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM members WHERE id IN (?, ?)', [input.fromId, input.toId]);
        const nameOf = (localId: number) => names.find((n) => n.id === localId)?.name ?? 'Someone';
        notify((targets) =>
          paymentRecordedMessages({ targets, actorId: actor.remoteId, fromName: nameOf(input.fromId), toName: nameOf(input.toId), amount: input.amount }),
        );
        return (await localIdOf(db, 'settlements', savedId)) ?? 0;
      },

      deleteSettlement: async (id) => {
        const target = await remoteId('settlements', id);
        await write(() => remote.deleteSettlement(firestore, target));
      },

      saveMember: async (id, input) => {
        requireAdmin();
        assertNoFieldErrors(validateMember(input, { requireUsername: !id, requirePassword: !id }));
        const clash = await db.getFirstAsync<{ id: number }>(
          'SELECT id FROM members WHERE is_active = 1 AND lower(trim(name)) = lower(?) AND id != ?',
          [input.name.trim(), id ?? -1],
        );
        if (clash) throw new AppError('DUPLICATE', `A member named "${input.name.trim()}" already exists.`);
        const details = {
          name: input.name.trim(),
          phone: input.phone?.trim() || null,
          email: input.email?.trim() || null,
          notes: input.notes?.trim() || null,
        };
        if (id) {
          const target = await remoteId('members', id);
          await write(() => remote.updateMember(firestore, target, details));
          return id;
        }
        const username = (input.username ?? '').trim().toLowerCase();
        const savedId = await write(() => remote.createMember(firestore, { ...details, username }, input.password ?? ''));
        return (await localIdOf(db, 'members', savedId)) ?? 0;
      },

      removeMember: async (id) => {
        requireAdmin();
        if (id === me?.memberId) throw new AppError('VALIDATION', 'You cannot remove yourself.');
        const target = await remoteId('members', id);
        await write(() => remote.setMemberActive(firestore, target, false));
        return 'archived';
      },

      restoreMember: async (id) => {
        requireAdmin();
        const target = await remoteId('members', id);
        await write(() => remote.setMemberActive(firestore, target, true));
      },

      resetMemberLogin: async (id, password) => {
        requireAdmin();
        if (password.length < 6) throw new AppError('VALIDATION', 'Password must be at least 6 characters.');
        const target = await remoteId('members', id);
        await write(() => remote.resetMemberLogin(firestore, target, password));
      },

      refresh: applyLatest,
      signOut,
    };
  }, [applyLatest, db, firestore, me, signOut, sync]);

  const cloudAuth = useMemo<CloudAuth>(
    () => ({ state: authState, sync, flatExists, signIn, setUp, signOut, retry: applyLatest }),
    // authState is derived from the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, busyAuth, denied, me, ready, sync, flatExists, signIn, setUp, signOut, applyLatest],
  );

  if (authState.status !== 'ready') return <Gate auth={cloudAuth} />;

  return (
    <StoreContext.Provider value={store}>
      <DataVersionContext.Provider value={version}>{children}</DataVersionContext.Provider>
    </StoreContext.Provider>
  );
}
