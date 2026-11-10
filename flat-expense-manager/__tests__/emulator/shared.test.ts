/**
 * Runs the real app code against the Firebase emulator (auth + Firestore with firestore.rules):
 * setup, logins, permissions, and syncing into a phone's SQLite copy.
 * Run with:  npm run test:firebase
 */
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, initializeAuth, signInWithEmailAndPassword, signOut, type Auth } from 'firebase/auth';
import { collection, connectFirestoreEmulator, doc, getDocs, getFirestore, setDoc, setLogLevel, updateDoc, type Firestore } from 'firebase/firestore';

import { firebaseConfig, usernameToEmail } from '../../src/cloud/config';
import { remote, toRemoteExpense, toRemoteMember, toRemoteSettlement } from '../../src/cloud/remote';
import { applySnapshot, type Snapshot } from '../../src/cloud/snapshot';
import { getMemberBalances, getSettlementPlan } from '../../src/db/balances';
import { getExpense, listExpenses } from '../../src/db/expenses';
import { listMembers } from '../../src/db/members';
import { listSettlements } from '../../src/db/settlements';
import { createTestDb } from '../testDb';

// Denied requests are expected in these tests; keep the output readable.
setLogLevel('silent');

const PROJECT = firebaseConfig.projectId;
const apps: FirebaseApp[] = [];

/** A separate "phone": its own Firebase app, so its own login. */
function phone(): { auth: Auth; db: Firestore } {
  const app = initializeApp(firebaseConfig, `phone-${apps.length}-${Date.now()}`);
  apps.push(app);
  const auth = initializeAuth(app);
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, 'localhost', 8080);
  return { auth, db };
}

async function download(db: Firestore): Promise<Snapshot> {
  const [members, expenses, settlements] = await Promise.all([
    getDocs(collection(db, 'members')),
    getDocs(collection(db, 'expenses')),
    getDocs(collection(db, 'settlements')),
  ]);
  return { members: members.docs.map(toRemoteMember), expenses: expenses.docs.map(toRemoteExpense), settlements: settlements.docs.map(toRemoteSettlement) };
}

const denied = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'FORBIDDEN' });
const rawDenied = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'permission-denied' });

const expense = (paidBy: string, splits: [string, number][], amount: number, title = 'Groceries') => ({
  title,
  description: null,
  amount,
  category: 'Groceries',
  date: '2026-11-08',
  paidBy,
  splitMode: 'equal',
  splits: splits.map(([memberId, a]) => ({ memberId, amount: a })),
});

let admin: ReturnType<typeof phone>;
let ali: ReturnType<typeof phone>;
let bilal: ReturnType<typeof phone>;
let adminId: string;
let aliId: string;
let bilalId: string;

beforeEach(async () => {
  await fetch(`http://localhost:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://localhost:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });

  admin = phone();
  const { user } = await createUserWithEmailAndPassword(admin.auth, usernameToEmail('admin'), 'Admin123');
  adminId = await remote.createFlat(admin.db, user.uid, { name: 'Asjad', username: 'admin', phone: null, email: null, notes: null });
  aliId = await remote.createMember(admin.db, { name: 'Ali Khan', username: 'ali', phone: '0300-1111111', email: null, notes: null }, 'ali12345');
  bilalId = await remote.createMember(admin.db, { name: 'Bilal Ahmed', username: 'bilal', phone: null, email: null, notes: null }, 'bilal123');

  ali = phone();
  await signInWithEmailAndPassword(ali.auth, usernameToEmail('ali'), 'ali12345');
  bilal = phone();
  await signInWithEmailAndPassword(bilal.auth, usernameToEmail('bilal'), 'bilal123');
}, 30000);

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => deleteApp(a).catch(() => {})));
});

describe('setup and logins', () => {
  it('the first person becomes admin; nobody else can set the flat up again or join by themselves', async () => {
    expect(await remote.flatExists(admin.db)).toBe(true);
    const stranger = phone();
    const { user } = await createUserWithEmailAndPassword(stranger.auth, usernameToEmail('stranger'), 'secret12');
    await denied(remote.createFlat(stranger.db, user.uid, { name: 'Stranger', username: 'stranger', phone: null, email: null, notes: null }));
    await rawDenied(setDoc(doc(stranger.db, 'users', user.uid), { memberId: aliId, isAdmin: true, active: true }));
    await rawDenied(getDocs(collection(stranger.db, 'expenses')));
    await rawDenied(getDocs(collection(stranger.db, 'members')));
  });

  it('creating a member keeps the admin logged in and gives the member a working login', async () => {
    expect(admin.auth.currentUser?.email).toBe('admin@flat6.app');
    expect(ali.auth.currentUser?.email).toBe('ali@flat6.app');
    const members = (await download(ali.db)).members;
    expect(members.map((m) => [m.name, m.username, m.isAdmin]).sort()).toEqual([
      ['Ali Khan', 'ali', false],
      ['Asjad', 'admin', true],
      ['Bilal Ahmed', 'bilal', false],
    ]);
  });

  it('rejects a duplicate username and a short password', async () => {
    await expect(remote.createMember(admin.db, { name: 'Ali 2', username: 'ali', phone: null, email: null, notes: null }, 'whatever1')).rejects.toMatchObject({ code: 'DUPLICATE' });
    await expect(remote.createMember(admin.db, { name: 'Zed', username: 'zed', phone: null, email: null, notes: null }, '123')).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await download(admin.db)).members).toHaveLength(3);
  });

  it('only the admin manages members; a removed member loses access and can be restored', async () => {
    await denied(remote.createMember(ali.db, { name: 'Hack', username: 'hack', phone: null, email: null, notes: null }, 'hack1234'));
    await denied(remote.updateMember(ali.db, bilalId, { name: 'Renamed', phone: null, email: null, notes: null }));
    await denied(remote.setMemberActive(ali.db, bilalId, false));
    await rawDenied(updateDoc(doc(ali.db, 'users', ali.auth.currentUser!.uid), { isAdmin: true }));

    await remote.updateMember(admin.db, aliId, { name: 'Ali K.', phone: null, email: null, notes: 'Room 2' });
    await remote.setMemberActive(admin.db, bilalId, false);
    await rawDenied(getDocs(collection(bilal.db, 'expenses')));
    await remote.setMemberActive(admin.db, bilalId, true);
    expect((await getDocs(collection(bilal.db, 'members'))).size).toBe(3);
  });

  it('wrong password is rejected with a clear message', async () => {
    const p = phone();
    await expect(signInWithEmailAndPassword(p.auth, usernameToEmail('ali'), 'wrong-pass')).rejects.toMatchObject({ code: expect.stringMatching(/^auth\//) });
  });
});

describe('expenses and payments: only the person who added it can change it', () => {
  it('anyone can add; others (including the admin) cannot edit or delete', async () => {
    const id = await remote.saveExpense(ali.db, undefined, expense(aliId, [[aliId, 100000], [bilalId, 100000], [adminId, 100000]], 300000), aliId);

    await denied(remote.saveExpense(bilal.db, id, expense(bilalId, [[bilalId, 300000]], 300000), bilalId));
    await denied(remote.deleteExpense(bilal.db, id));
    await denied(remote.saveExpense(admin.db, id, expense(aliId, [[aliId, 300000]], 300000), adminId));
    await denied(remote.deleteExpense(admin.db, id));

    await remote.saveExpense(ali.db, id, expense(aliId, [[aliId, 200000], [bilalId, 200000]], 400000, 'Groceries (fixed)'), aliId);
    expect((await download(bilal.db)).expenses[0]).toMatchObject({ title: 'Groceries (fixed)', amount: 400000, createdBy: aliId });
    await remote.deleteExpense(ali.db, id);
    expect((await download(bilal.db)).expenses).toHaveLength(0);
  });

  it('nobody can add an entry in someone else’s name or take ownership of one', async () => {
    await denied(remote.saveExpense(bilal.db, undefined, expense(aliId, [[aliId, 1000]], 1000), aliId));
    const id = await remote.saveExpense(ali.db, undefined, expense(aliId, [[aliId, 1000]], 1000), aliId);
    await rawDenied(updateDoc(doc(bilal.db, 'expenses', id), { createdBy: bilalId }));
    await rawDenied(updateDoc(doc(ali.db, 'expenses', id), { createdBy: bilalId }));
  });

  it('rejects invalid amounts, categories and dates on the server', async () => {
    await denied(remote.saveExpense(ali.db, undefined, { ...expense(aliId, [[aliId, 1000]], 0) }, aliId));
    await denied(remote.saveExpense(ali.db, undefined, { ...expense(aliId, [[aliId, 1000]], 1000), category: 'Fun' }, aliId));
    await denied(remote.saveExpense(ali.db, undefined, { ...expense(aliId, [[aliId, 1000]], 1000), date: '8/11/2026' }, aliId));
    await denied(remote.saveExpense(ali.db, undefined, { ...expense(aliId, [], 1000) }, aliId));
  });

  it('payments: anyone can record; only the recorder can delete; none can be edited', async () => {
    const id = await remote.addSettlement(bilal.db, { fromId: bilalId, toId: aliId, amount: 50000, date: '2026-11-09', note: 'cash' }, bilalId);
    await denied(remote.deleteSettlement(ali.db, id));
    await denied(remote.deleteSettlement(admin.db, id));
    await rawDenied(updateDoc(doc(bilal.db, 'settlements', id), { amount: 1 }));
    await denied(remote.addSettlement(bilal.db, { fromId: bilalId, toId: bilalId, amount: 100, date: '2026-11-09', note: null }, bilalId));
    await remote.deleteSettlement(bilal.db, id);
    expect((await download(ali.db)).settlements).toHaveLength(0);
  });
});

describe('sync into a phone', () => {
  it('what Ali adds shows on Bilal’s phone with correct balances and “added by”, and stays in step', async () => {
    const expenseId = await remote.saveExpense(ali.db, undefined, expense(aliId, [[aliId, 150000], [bilalId, 150000]], 300000), aliId);
    await remote.addSettlement(bilal.db, { fromId: bilalId, toId: aliId, amount: 50000, date: '2026-11-09', note: 'cash' }, bilalId);

    const bilalPhone = await createTestDb();
    await applySnapshot(bilalPhone, await download(bilal.db));

    const [saved] = await listExpenses(bilalPhone);
    const detail = (await getExpense(bilalPhone, saved.id))!;
    expect(detail).toMatchObject({ title: 'Groceries', amount: 300000, date: '2026-11-08', paidByName: 'Ali Khan', createdByName: 'Ali Khan' });
    expect(detail.splits.map((s) => [s.memberName, s.amount])).toEqual([['Ali Khan', 150000], ['Bilal Ahmed', 150000]]);
    expect((await getMemberBalances(bilalPhone)).map((b) => [b.name, b.balance])).toEqual([['Ali Khan', 100000], ['Asjad', 0], ['Bilal Ahmed', -100000]]);
    expect((await getSettlementPlan(bilalPhone)).map((p) => `${p.fromName}->${p.toName}:${p.amount}`)).toEqual(['Bilal Ahmed->Ali Khan:100000']);
    expect((await listSettlements(bilalPhone))[0]).toMatchObject({ createdByName: 'Bilal Ahmed', note: 'cash' });

    // Ali edits the expense and adds another; Bilal's copy follows and keeps the same local id.
    await remote.saveExpense(ali.db, expenseId, expense(aliId, [[aliId, 100000], [bilalId, 100000], [adminId, 100000]], 300000, 'Groceries + milk'), aliId);
    await remote.saveExpense(ali.db, undefined, expense(adminId, [[aliId, 30000], [bilalId, 30000]], 60000, 'Gas'), aliId);
    await applySnapshot(bilalPhone, await download(bilal.db));
    const after = await listExpenses(bilalPhone);
    expect(after.map((e) => e.title).sort()).toEqual(['Gas', 'Groceries + milk']);
    expect(after.find((e) => e.title === 'Groceries + milk')?.id).toBe(saved.id);
    expect((await getExpense(bilalPhone, saved.id))!.splits).toHaveLength(3);

    // Ali deletes it; it disappears from Bilal's phone too.
    await remote.deleteExpense(ali.db, expenseId);
    await applySnapshot(bilalPhone, await download(bilal.db));
    expect((await listExpenses(bilalPhone)).map((e) => e.title)).toEqual(['Gas']);
    expect((await listMembers(bilalPhone)).length).toBe(3);
  });

  it('push tokens: a member registers their own phone only', async () => {
    const uid = ali.auth.currentUser!.uid;
    await remote.savePushToken(ali.db, 'ExponentPushToken[ali-phone]', uid, aliId);
    await denied(remote.savePushToken(bilal.db, 'ExponentPushToken[fake]', uid, aliId));
    expect(await remote.listPushTargets(bilal.db)).toEqual([{ token: 'ExponentPushToken[ali-phone]', memberId: aliId }]);
    await signOut(bilal.auth);
    await expect(remote.listPushTargets(bilal.db)).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
