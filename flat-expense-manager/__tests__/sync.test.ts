/**
 * End-to-end sync check: data saved on the "server" (real Postgres via PGlite, running
 * supabase/schema.sql) is downloaded by another member and stored in that phone's local
 * SQLite copy, where balances, permissions and reports are computed.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getMemberBalances, getSettlementPlan } from '../src/db/balances';
import { getExpense, listExpenses } from '../src/db/expenses';
import { listSettlements } from '../src/db/settlements';
import { isNetworkError, toAppError } from '../src/cloud/remote';
import { applySnapshot, EMPTY_SNAPSHOT, fetchSnapshot, type SnapshotSource } from '../src/cloud/snapshot';
import { createTestDb } from './testDb';

const SCHEMA = readFileSync(join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
const STUBS = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text not null);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email', true), '') $$;
  create publication supabase_realtime;
  grant usage on schema public, auth to anon, authenticated;
`;
const UID = { admin: '00000000-0000-0000-0000-000000000001', ali: '00000000-0000-0000-0000-000000000002', bilal: '00000000-0000-0000-0000-000000000003' };
type User = keyof typeof UID;

let pg: PGlite;

async function as<T>(user: User, sql: string, params: unknown[] = []): Promise<T[]> {
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.email', $2, false)`, [UID[user], `${user}@flat6.app`]);
  await pg.exec('set role authenticated');
  try {
    return (await pg.query<T>(sql, params)).rows;
  } finally {
    await pg.exec('reset role');
  }
}

/** Behaves like supabase.from(table).select().order().range() for a given user, incl. paging. */
function sourceFor(user: User, pageLog?: string[]): SnapshotSource {
  return {
    from: (table) => ({
      select: (columns) => ({
        order: (column) => ({
          range: async (from, to) => {
            pageLog?.push(`${table}:${from}`);
            const rows = await as<Record<string, unknown>>(
              user,
              `select ${columns} from public.${table} order by ${column} offset ${from} limit ${to - from + 1}`,
            );
            // PostgREST sends JSON: bigints as numbers, dates as "YYYY-MM-DD", timestamps as ISO strings.
            const json = rows.map((r) =>
              Object.fromEntries(
                Object.entries(r).map(([k, v]) => [
                  k,
                  typeof v === 'bigint' ? Number(v) : v instanceof Date ? (k.endsWith('_date') ? v.toISOString().slice(0, 10) : v.toISOString()) : v,
                ]),
              ),
            );
            return { data: json, error: null };
          },
        }),
      }),
    }),
  };
}

const save = async (user: User, title: string, amount: number, paidBy: number, splits: [number, number][], date = '2026-11-08') =>
  Number(
    (
      await as<{ id: number }>(user, `select public.save_expense(null, $1, null, $2, 'Groceries', $3, $4, 'equal', $5::jsonb) as id`, [
        title,
        amount,
        date,
        paidBy,
        JSON.stringify(splits.map(([member_id, a]) => ({ member_id, amount: a }))),
      ])
    )[0].id,
  );

let ids: Record<string, number>;

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(STUBS);
  await pg.exec(SCHEMA);
  await pg.exec('grant all on all tables in schema public to anon, authenticated;');
  await pg.exec(`
    insert into auth.users values ('${UID.admin}', 'admin@flat6.app'), ('${UID.ali}', 'ali@flat6.app'), ('${UID.bilal}', 'bilal@flat6.app');
    insert into public.members (name, username, is_admin) values ('Admin', 'admin', true), ('Ali Khan', 'ali', false), ('Bilal Ahmed', 'bilal', false);
  `);
  ids = Object.fromEntries((await pg.query<{ id: number; username: string }>('select id, username from public.members')).rows.map((r) => [r.username, Number(r.id)]));
  for (const u of ['admin', 'ali', 'bilal'] as const) await as(u, 'select public.claim_member()');
}, 30000);

afterEach(async () => {
  await pg.close();
});

it('an expense added by Ali appears on Bilal’s phone with correct balances and “added by”', async () => {
  // Ali pays Rs. 3,000 split between Ali and Bilal; Bilal pays Ali back Rs. 500.
  const expenseId = await save('ali', 'Groceries', 300000, ids.ali, [[ids.ali, 150000], [ids.bilal, 150000]]);
  await as('bilal', `select public.add_settlement($1, $2, 50000, '2026-11-09', 'cash')`, [ids.bilal, ids.ali]);

  const bilalPhone = await createTestDb();
  await applySnapshot(bilalPhone, await fetchSnapshot(sourceFor('bilal')));

  const expense = (await getExpense(bilalPhone, expenseId))!;
  expect(expense).toMatchObject({ title: 'Groceries', amount: 300000, date: '2026-11-08', paidByName: 'Ali Khan', createdBy: ids.ali, createdByName: 'Ali Khan' });
  expect(expense.splits.map((s) => [s.memberName, s.amount])).toEqual([['Ali Khan', 150000], ['Bilal Ahmed', 150000]]);

  const balances = await getMemberBalances(bilalPhone);
  expect(balances.map((b) => [b.name, b.balance])).toEqual([['Admin', 0], ['Ali Khan', 100000], ['Bilal Ahmed', -100000]]);
  expect(await getSettlementPlan(bilalPhone)).toEqual([
    { fromId: ids.bilal, fromName: 'Bilal Ahmed', toId: ids.ali, toName: 'Ali Khan', amount: 100000 },
  ]);
  const [payment] = await listSettlements(bilalPhone);
  expect(payment).toMatchObject({ createdByName: 'Bilal Ahmed', date: '2026-11-09', note: 'cash' });
});

it('a later sync replaces the local copy: edits and deletions on the server show up', async () => {
  const first = await save('ali', 'Milk', 90000, ids.ali, [[ids.ali, 45000], [ids.bilal, 45000]]);
  const phone = await createTestDb();
  await applySnapshot(phone, await fetchSnapshot(sourceFor('bilal')));
  expect(await listExpenses(phone)).toHaveLength(1);

  await as('ali', 'select public.delete_expense($1)', [first]);
  await save('admin', 'Gas', 60000, ids.admin, [[ids.admin, 20000], [ids.ali, 20000], [ids.bilal, 20000]]);
  await applySnapshot(phone, await fetchSnapshot(sourceFor('bilal')));
  expect((await listExpenses(phone)).map((e) => e.title)).toEqual(['Gas']);
  expect((await getMemberBalances(phone)).find((b) => b.name === 'Admin')?.balance).toBe(40000);
});

it('downloads large histories page by page', async () => {
  for (let i = 0; i < 1005; i++) {
    await pg.query(
      `insert into public.expenses (title, amount, category, expense_date, paid_by, split_mode, created_by)
       values ($1, 100, 'Other', '2026-11-01', $2, 'equal', $2)`,
      [`e${i}`, ids.ali],
    );
  }
  const pages: string[] = [];
  const snap = await fetchSnapshot(sourceFor('bilal', pages));
  expect(snap.expenses).toHaveLength(1005);
  expect(pages.filter((p) => p.startsWith('expenses'))).toEqual(['expenses:0', 'expenses:1000']);
  const phone = await createTestDb();
  await applySnapshot(phone, snap);
  expect(await listExpenses(phone)).toHaveLength(1005);
}, 60000);

it('logging out clears the shared data from the phone', async () => {
  await save('ali', 'Rent', 100000, ids.ali, [[ids.ali, 100000]]);
  const phone = await createTestDb();
  await applySnapshot(phone, await fetchSnapshot(sourceFor('ali')));
  await applySnapshot(phone, EMPTY_SNAPSHOT);
  expect(await listExpenses(phone)).toHaveLength(0);
  expect(await getMemberBalances(phone, { includeInactive: true })).toHaveLength(0);
});

it('turns server errors into clear messages', () => {
  expect(toAppError({ code: 'P0001', message: 'Only Ali Khan can change this, because they added it.' })).toMatchObject({ code: 'FORBIDDEN' });
  expect(toAppError({ code: 'P0001', message: 'Shares (1) must add up to the amount (2).' })).toMatchObject({ code: 'VALIDATION' });
  expect(toAppError({ message: 'TypeError: Network request failed' })).toMatchObject({ code: 'OFFLINE' });
  expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  expect(isNetworkError(new Error('Only Ali can change this'))).toBe(false);
});
