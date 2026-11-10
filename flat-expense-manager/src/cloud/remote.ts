import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, deleteUser, initializeAuth, signOut } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { AppError } from '../db/client';
import type { PushMessage, PushTarget } from '../domain/notify';
import { EMULATOR_HOST, firebaseConfig, usernameToEmail } from './config';
import type { RemoteExpense, RemoteMember, RemoteSettlement } from './snapshot';

export const OFFLINE_MESSAGE = 'No internet connection. Connect to the internet to save. Nothing was changed.';

const codeOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';

/** True when an error means Firebase could not be reached. */
export function isNetworkError(error: unknown): boolean {
  const code = codeOf(error);
  if (code === 'OFFLINE' || code === 'unavailable' || code === 'auth/network-request-failed' || code === 'deadline-exceeded') return true;
  const text = error instanceof Error ? error.message : String(error);
  return /network request failed|failed to fetch|fetch failed|offline|timed? ?out/i.test(text);
}

/** Turns a Firebase error into a message that is safe to show to the user. */
export function toAppError(error: unknown): AppError {
  const code = codeOf(error);
  if (error instanceof AppError) return error;
  if (isNetworkError(error)) return new AppError('OFFLINE', OFFLINE_MESSAGE);
  switch (code) {
    case 'permission-denied':
      return new AppError('FORBIDDEN', 'You are not allowed to do this. Only the person who added an entry can change or delete it.');
    case 'not-found':
      return new AppError('NOT_FOUND', 'This entry was deleted by someone else.');
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return new AppError('VALIDATION', 'Wrong username or password.');
    case 'auth/user-disabled':
      return new AppError('FORBIDDEN', 'This login has been disabled. Ask the admin.');
    case 'auth/email-already-in-use':
      return new AppError('DUPLICATE', 'That username already has a login. Choose another username.');
    case 'auth/weak-password':
      return new AppError('VALIDATION', 'Password must be at least 6 characters.');
    case 'auth/too-many-requests':
      return new AppError('VALIDATION', 'Too many attempts. Wait a few minutes and try again.');
    case 'auth/operation-not-allowed':
      return new AppError('VALIDATION', 'Email/Password sign-in is not enabled in the Firebase project (Authentication → Sign-in method).');
    default:
      return new AppError('VALIDATION', `Could not complete this: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const run = async <T,>(task: () => Promise<T>): Promise<T> => {
  try {
    return await task();
  } catch (e) {
    throw toAppError(e);
  }
};

const iso = (value: unknown): string => {
  if (value && typeof value === 'object' && 'toDate' in value) return (value as { toDate(): Date }).toDate().toISOString();
  return typeof value === 'string' ? value : new Date(0).toISOString();
};

type Snap = QueryDocumentSnapshot<DocumentData>;
const read = (d: Snap) => d.data({ serverTimestamps: 'estimate' });
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export const toRemoteMember = (d: Snap): RemoteMember => {
  const v = read(d);
  return {
    id: d.id,
    name: String(v.name ?? ''),
    username: String(v.username ?? ''),
    phone: text(v.phone),
    email: text(v.email),
    notes: text(v.notes),
    isAdmin: v.isAdmin === true,
    isActive: v.isActive !== false,
    createdAt: iso(v.createdAt),
  };
};

export const toRemoteExpense = (d: Snap): RemoteExpense => {
  const v = read(d);
  return {
    id: d.id,
    title: String(v.title ?? ''),
    description: text(v.description),
    amount: Number(v.amount ?? 0),
    category: String(v.category ?? 'Other'),
    date: String(v.date ?? ''),
    paidBy: String(v.paidBy ?? ''),
    splitMode: v.splitMode === 'amounts' ? 'amounts' : 'equal',
    splits: Array.isArray(v.splits)
      ? v.splits.map((s: { memberId?: unknown; amount?: unknown }) => ({ memberId: String(s.memberId ?? ''), amount: Number(s.amount ?? 0) }))
      : [],
    createdBy: String(v.createdBy ?? ''),
    createdAt: iso(v.createdAt),
    updatedAt: iso(v.updatedAt),
  };
};

export const toRemoteSettlement = (d: Snap): RemoteSettlement => {
  const v = read(d);
  return {
    id: d.id,
    fromId: String(v.fromId ?? ''),
    toId: String(v.toId ?? ''),
    amount: Number(v.amount ?? 0),
    date: String(v.date ?? ''),
    note: text(v.note),
    createdBy: String(v.createdBy ?? ''),
    createdAt: iso(v.createdAt),
  };
};

export interface ExpenseData {
  title: string;
  description: string | null;
  amount: number;
  category: string;
  date: string;
  paidBy: string;
  splitMode: string;
  splits: { memberId: string; amount: number }[];
}

export interface SettlementData {
  fromId: string;
  toId: string;
  amount: number;
  date: string;
  note: string | null;
}

export interface MemberData {
  name: string;
  username: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

/** Creates a Firebase login without signing the current user out (uses a throw-away app instance). */
async function createLogin(username: string, password: string) {
  const app = initializeApp(firebaseConfig, `account-creator-${Date.now()}`);
  const auth = initializeAuth(app);
  if (EMULATOR_HOST) connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  try {
    const { user } = await createUserWithEmailAndPassword(auth, usernameToEmail(username), password);
    return {
      uid: user.uid,
      /** Keep the new login. */
      done: async () => {
        await signOut(auth).catch(() => {});
        await deleteApp(app).catch(() => {});
      },
      /** Remove the new login again because saving the member failed. */
      discard: async () => {
        await deleteUser(user).catch(() => {});
        await deleteApp(app).catch(() => {});
      },
    };
  } catch (e) {
    await deleteApp(app).catch(() => {});
    throw e;
  }
}

export const remote = {
  /** Fails fast with a clear message when offline, so nothing is queued and saved twice later. */
  ensureOnline: async (db: Firestore): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AppError('OFFLINE', OFFLINE_MESSAGE)), 8000);
    });
    try {
      await Promise.race([getDocFromServer(doc(db, 'meta', 'flat')), timeout]);
    } catch (e) {
      throw isNetworkError(e) ? new AppError('OFFLINE', OFFLINE_MESSAGE) : toAppError(e);
    } finally {
      clearTimeout(timer);
    }
  },

  /** Whether an admin has already set this flat up. Null when it cannot be checked (offline). */
  flatExists: async (db: Firestore): Promise<boolean | null> => {
    try {
      return (await getDocFromServer(doc(db, 'meta', 'flat'))).exists();
    } catch {
      return null;
    }
  },

  /** First-time setup: the signed-in user becomes the flat's admin. Fails if a flat already exists. */
  createFlat: (db: Firestore, uid: string, member: MemberData) =>
    run(async () => {
      const memberRef = doc(collection(db, 'members'));
      const batch = writeBatch(db);
      batch.set(doc(db, 'meta', 'flat'), { adminUid: uid, createdAt: serverTimestamp() });
      batch.set(memberRef, { ...member, isAdmin: true, isActive: true, uid, createdAt: serverTimestamp() });
      batch.set(doc(db, 'users', uid), { memberId: memberRef.id, isAdmin: true, active: true });
      await batch.commit();
      return memberRef.id;
    }),

  saveExpense: (db: Firestore, id: string | undefined, data: ExpenseData, createdBy: string) =>
    run(async () => {
      if (id) {
        await updateDoc(doc(db, 'expenses', id), { ...data, updatedAt: serverTimestamp() });
        return id;
      }
      const ref = doc(collection(db, 'expenses'));
      await setDoc(ref, { ...data, createdBy, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      return ref.id;
    }),

  deleteExpense: (db: Firestore, id: string) => run(() => deleteDoc(doc(db, 'expenses', id))),

  addSettlement: (db: Firestore, data: SettlementData, createdBy: string) =>
    run(async () => {
      const ref = doc(collection(db, 'settlements'));
      await setDoc(ref, { ...data, createdBy, createdAt: serverTimestamp() });
      return ref.id;
    }),

  deleteSettlement: (db: Firestore, id: string) => run(() => deleteDoc(doc(db, 'settlements', id))),

  /** Admin: creates the member and their login (username + password) in one go. */
  createMember: (db: Firestore, member: MemberData, password: string) =>
    run(async () => {
      const login = await createLogin(member.username, password);
      try {
        const memberRef = doc(collection(db, 'members'));
        const batch = writeBatch(db);
        batch.set(memberRef, { ...member, isAdmin: false, isActive: true, uid: login.uid, createdAt: serverTimestamp() });
        batch.set(doc(db, 'users', login.uid), { memberId: memberRef.id, isAdmin: false, active: true });
        await batch.commit();
        await login.done();
        return memberRef.id;
      } catch (e) {
        await login.discard();
        throw e;
      }
    }),

  /** Admin: edits a member's details. The username is tied to the login and never changes. */
  updateMember: (db: Firestore, id: string, member: Omit<MemberData, 'username'>) =>
    run(() => updateDoc(doc(db, 'members', id), { ...member })),

  /** Admin: archives (false) or restores (true) a member. Archived members cannot open the flat. */
  setMemberActive: (db: Firestore, id: string, active: boolean) =>
    run(async () => {
      const member = await getDoc(doc(db, 'members', id));
      if (!member.exists()) throw new AppError('NOT_FOUND', 'Member not found.');
      const uid = member.data().uid as string | undefined;
      const batch = writeBatch(db);
      batch.update(member.ref, { isActive: active });
      if (uid) batch.update(doc(db, 'users', uid), { active });
      await batch.commit();
    }),

  /**
   * Admin: gives a member a new login when they forgot their password. The old login must be
   * deleted in the Firebase console first (Authentication → Users), which frees the username.
   */
  resetMemberLogin: (db: Firestore, id: string, password: string) =>
    run(async () => {
      const member = await getDoc(doc(db, 'members', id));
      if (!member.exists()) throw new AppError('NOT_FOUND', 'Member not found.');
      const { username, uid: oldUid, isAdmin, isActive } = member.data() as { username: string; uid?: string; isAdmin?: boolean; isActive?: boolean };
      let login;
      try {
        login = await createLogin(username, password);
      } catch (e) {
        if (codeOf(e) === 'auth/email-already-in-use') {
          throw new AppError(
            'CONFLICT',
            `The old login still exists. In the Firebase console open Authentication → Users, delete ${usernameToEmail(username)}, then try again.`,
          );
        }
        throw e;
      }
      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'users', login.uid), { memberId: id, isAdmin: isAdmin === true, active: isActive !== false });
        batch.update(member.ref, { uid: login.uid });
        if (oldUid && oldUid !== login.uid) batch.delete(doc(db, 'users', oldUid));
        await batch.commit();
        await login.done();
      } catch (e) {
        await login.discard();
        throw e;
      }
    }),

  /** Remembers this phone so other members' actions can notify it. */
  savePushToken: (db: Firestore, token: string, uid: string, memberId: string) =>
    run(() => setDoc(doc(db, 'pushTokens', token), { uid, memberId, updatedAt: serverTimestamp() })),

  removePushToken: (db: Firestore, token: string) => deleteDoc(doc(db, 'pushTokens', token)).catch(() => {}),

  listPushTargets: async (db: Firestore): Promise<PushTarget[]> =>
    (await getDocs(collection(db, 'pushTokens'))).docs.map((d) => ({ token: d.id, memberId: String(d.data().memberId ?? '') })),
};

/** Sends notifications through Expo's push service. Never throws: a failed notification must not fail a save. */
export async function sendPush(messages: PushMessage[]): Promise<void> {
  try {
    for (let i = 0; i < messages.length; i += 100) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
    }
  } catch {
    // Offline or blocked: the data is saved and will still sync; only the alert is skipped.
  }
}
