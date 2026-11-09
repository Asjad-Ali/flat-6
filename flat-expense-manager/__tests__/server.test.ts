/**
 * Runs supabase/schema.sql in a real Postgres (PGlite) with a minimal stand-in for Supabase's
 * auth schema and roles, then checks the permission rules and save functions as different users.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = readFileSync(join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text not null);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.email() returns text language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.email', true), '') $$;
  create publication supabase_realtime;
  grant usage on schema public, auth to anon, authenticated;
`;

const USERS = {
  admin: '00000000-0000-0000-0000-000000000001',
  ali: '00000000-0000-0000-0000-000000000002',
  bilal: '00000000-0000-0000-0000-000000000003',
  stranger: '00000000-0000-0000-0000-000000000009',
} as const;
type User = keyof typeof USERS;

let pg: PGlite;

/** Runs SQL as a logged-in user (or anonymously), like a request from the app would. */
async function as<T = Record<string, unknown>>(user: User | 'anon', sql: string, params: unknown[] = []): Promise<T[]> {
  await pg.exec('reset role');
  if (user === 'anon') {
    await pg.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.email', '', false)`);
    await pg.exec('set role anon');
  } else {
    await pg.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.email', $2, false)`, [
      USERS[user],
      `${user}@flat6.app`,
    ]);
    await pg.exec('set role authenticated');
  }
  try {
    return (await pg.query<T>(sql, params)).rows;
  } finally {
    await pg.exec('reset role');
  }
}

async function expectError(promise: Promise<unknown>, message: RegExp) {
  await expect(promise).rejects.toThrow(message);
}

const splits = (pairs: [number, number][]) => JSON.stringify(pairs.map(([member_id, amount]) => ({ member_id, amount })));
const saveExpense = (user: User, id: number | null, amount: number, paidBy: number, s: [number, number][], date = '2026-11-08') =>
  as<{ id: number }>(user, `select public.save_expense($1, 'Groceries', null, $2, 'Groceries', $3, $4, 'equal', $5::jsonb) as id`, [
    id,
    amount,
    date,
    paidBy,
    splits(s),
  ]).then((r) => Number(r[0].id));

let ids: Record<'admin' | 'ali' | 'bilal' | 'usman', number>;

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(SUPABASE_STUBS);
  await pg.exec(SCHEMA);
  // Supabase grants table privileges to these roles by default; RLS then decides.
  await pg.exec(`grant all on all tables in schema public to anon, authenticated;`);
  await pg.exec(`
    insert into auth.users (id, email) values
      ('${USERS.admin}', 'admin@flat6.app'), ('${USERS.ali}', 'ali@flat6.app'),
      ('${USERS.bilal}', 'bilal@flat6.app'), ('${USERS.stranger}', 'stranger@flat6.app');
    insert into public.members (name, username, is_admin) values
      ('Admin', 'admin', true), ('Ali Khan', 'ali', false), ('Bilal Ahmed', 'bilal', false), ('Usman Tariq', 'usman', false);
  `);
  const rows = (await pg.query<{ id: number; username: string }>('select id, username from public.members')).rows;
  ids = Object.fromEntries(rows.map((r) => [r.username, Number(r.id)])) as typeof ids;
  for (const u of ['admin', 'ali', 'bilal'] as const) await as(u, 'select public.claim_member()');
}, 30000);

afterEach(async () => {
  await pg.close();
});

describe('login and reading', () => {
  it('links a login to its member by username', async () => {
    const [row] = await as<{ id: number }>('ali', 'select public.claim_member() as id');
    expect(Number(row.id)).toBe(ids.ali);
  });

  it('rejects logins that are not flat members', async () => {
    await expectError(as('stranger', 'select public.claim_member()'), /not linked to a flat member.*"stranger"/);
    expect(await as('stranger', 'select * from public.members')).toHaveLength(0);
  });

  it('blocks anonymous access', async () => {
    await expectError(as('anon', 'select public.claim_member()'), /permission denied/);
    expect(await as('anon', 'select * from public.expenses')).toHaveLength(0);
  });

  it('lets members read everything', async () => {
    await saveExpense('ali', null, 30000, ids.ali, [[ids.ali, 15000], [ids.bilal, 15000]]);
    expect(await as('bilal', 'select * from public.expenses')).toHaveLength(1);
    expect(await as('bilal', 'select * from public.expense_splits')).toHaveLength(2);
    expect(await as('bilal', 'select * from public.members')).toHaveLength(4);
  });
});

describe('expenses', () => {
  it('saves an expense with splits and records who added it', async () => {
    const id = await saveExpense('ali', null, 90000, ids.ali, [[ids.ali, 30000], [ids.bilal, 30000], [ids.usman, 30000]]);
    const [e] = await as<{ created_by: number; amount: number }>('ali', 'select * from public.expenses where id = $1', [id]);
    expect(Number(e.created_by)).toBe(ids.ali);
    expect(Number(e.amount)).toBe(90000);
  });

  it('rejects splits that do not add up, zero shares, unknown members and future dates', async () => {
    await expectError(saveExpense('ali', null, 90000, ids.ali, [[ids.ali, 30000]]), /must add up/);
    await expectError(saveExpense('ali', null, 30000, ids.ali, [[ids.ali, 30000], [ids.bilal, 0]]), /greater than zero/);
    await expectError(saveExpense('ali', null, 30000, ids.ali, [[999, 30000]]), /no longer exists/);
    await expectError(saveExpense('ali', null, 30000, ids.ali, [[ids.ali, 30000]], '2099-01-01'), /future/);
    await expectError(saveExpense('ali', null, 30000, ids.ali, []), /at least one/);
    expect(await as('ali', 'select * from public.expenses')).toHaveLength(0);
  });

  it('blocks direct writes that bypass the rules', async () => {
    await expectError(
      as('ali', `insert into public.expenses (title, amount, category, expense_date, paid_by, split_mode, created_by)
                 values ('x', 100, 'Other', '2026-11-08', ${ids.ali}, 'equal', ${ids.bilal})`),
      /row-level security/,
    );
  });

  it('only the member who added it can edit or delete (not even the admin)', async () => {
    const id = await saveExpense('ali', null, 30000, ids.ali, [[ids.ali, 15000], [ids.bilal, 15000]]);
    await expectError(saveExpense('bilal', id, 40000, ids.bilal, [[ids.bilal, 40000]]), /Only Ali Khan can change this/);
    await expectError(as('bilal', 'select public.delete_expense($1)', [id]), /Only Ali Khan can change this/);
    await expectError(saveExpense('admin', id, 50000, ids.ali, [[ids.ali, 50000]]), /Only Ali Khan can change this/);
    await expectError(as('admin', 'select public.delete_expense($1)', [id]), /Only Ali Khan can change this/);

    await saveExpense('ali', id, 40000, ids.ali, [[ids.ali, 20000], [ids.usman, 20000]]);
    const rows = await as<{ member_id: number }>('ali', 'select member_id from public.expense_splits where expense_id = $1 order by member_id', [id]);
    expect(rows.map((r) => Number(r.member_id))).toEqual([ids.ali, ids.usman]);

    await as('ali', 'select public.delete_expense($1)', [id]);
    expect(await as('ali', 'select * from public.expense_splits')).toHaveLength(0);
  });
});

describe('payments between members', () => {
  it('records who added a payment and limits deletion', async () => {
    const [{ id }] = await as<{ id: number }>('bilal', `select public.add_settlement($1, $2, 50000, '2026-11-08', 'cash') as id`, [ids.bilal, ids.ali]);
    const [s] = await as<{ created_by: number }>('ali', 'select created_by from public.settlements');
    expect(Number(s.created_by)).toBe(ids.bilal);
    await expectError(as('ali', 'select public.delete_settlement($1)', [id]), /Only Bilal Ahmed can change this/);
    await expectError(as('admin', 'select public.delete_settlement($1)', [id]), /Only Bilal Ahmed can change this/);
    await as('bilal', 'select public.delete_settlement($1)', [id]);
    expect(await as('ali', 'select * from public.settlements')).toHaveLength(0);
  });

  it('rejects paying yourself and invalid amounts', async () => {
    await expectError(as('ali', `select public.add_settlement($1, $1, 100, '2026-11-08', null)`, [ids.ali]), /cannot pay themselves/);
    await expectError(as('ali', `select public.add_settlement($1, $2, -5, '2026-11-08', null)`, [ids.ali, ids.bilal]), /greater than zero/);
  });
});

describe('members (admin only)', () => {
  it('only the admin can add, edit, archive and restore members', async () => {
    await expectError(as('ali', `select public.admin_save_member(null, 'Shah', 'shah', null, null, null)`), /Only the admin/);
    const [{ id }] = await as<{ id: number }>('admin', `select public.admin_save_member(null, 'Shah', 'Shah', null, null, null) as id`);
    const [m] = await as<{ username: string }>('ali', 'select username from public.members where id = $1', [id]);
    expect(m.username).toBe('shah');
    await expectError(as('admin', `select public.admin_save_member(null, 'Ali Khan', 'ali2', null, null, null)`), /already used/);
    await expectError(as('admin', `select public.admin_set_member_active($1, false)`, [ids.admin]), /cannot remove yourself/);
  });

  it('an archived member loses access but keeps their history', async () => {
    await saveExpense('ali', null, 30000, ids.ali, [[ids.ali, 15000], [ids.bilal, 15000]]);
    await as('admin', 'select public.admin_set_member_active($1, false)', [ids.ali]);
    expect(await as('ali', 'select * from public.expenses')).toHaveLength(0);
    expect(await as('bilal', 'select * from public.expenses')).toHaveLength(1);
    await as('admin', 'select public.admin_set_member_active($1, true)', [ids.ali]);
    expect(await as('ali', 'select * from public.expenses')).toHaveLength(1);
  });
});
