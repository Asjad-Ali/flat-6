-- Flat Expense Manager: Supabase database schema.
-- Run once in Supabase → SQL Editor → New query → paste this file → Run.
--
-- Design:
--   * All six phones read and write this one database.
--   * Logged-in flat members can READ everything (RLS select policies).
--   * Nobody writes to tables directly. Every change goes through the functions below,
--     which check the rules: splits must add up, and ONLY the member who added an entry
--     can edit or delete it (nobody else, not even the admin). The admin only manages
--     the member list.
--   * Money is integer paisa (Rs. 1 = 100), exactly like the app.

-- ───────────────────────── Tables ─────────────────────────

create table public.members (
  id          bigint generated always as identity primary key,
  name        text not null check (length(trim(name)) between 2 and 50),
  -- Login username. The Supabase login email is "<username>@flat6.app".
  username    text not null unique check (username ~ '^[a-z0-9_.]{3,30}$'),
  phone       text check (phone is null or length(phone) <= 20),
  email       text check (email is null or length(email) <= 100),
  notes       text check (notes is null or length(notes) <= 200),
  is_admin    boolean not null default false,
  is_active   boolean not null default true,
  user_id     uuid unique references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index members_unique_active_name on public.members (lower(trim(name))) where is_active;

create table public.expenses (
  id            bigint generated always as identity primary key,
  title         text not null check (length(trim(title)) between 1 and 80),
  description   text check (description is null or length(description) <= 300),
  amount        bigint not null check (amount > 0 and amount <= 1000000000),
  category      text not null check (category in ('Groceries','Milk','Electricity','Gas','Internet','Rent','Other')),
  expense_date  date not null,
  paid_by       bigint not null references public.members (id),
  split_mode    text not null check (split_mode in ('equal', 'amounts')),
  created_by    bigint not null references public.members (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index expenses_date on public.expenses (expense_date);

create table public.expense_splits (
  expense_id  bigint not null references public.expenses (id) on delete cascade,
  member_id   bigint not null references public.members (id),
  amount      bigint not null check (amount > 0),
  primary key (expense_id, member_id)
);

create table public.settlements (
  id               bigint generated always as identity primary key,
  from_member_id   bigint not null references public.members (id),
  to_member_id     bigint not null references public.members (id),
  amount           bigint not null check (amount > 0 and amount <= 1000000000),
  settlement_date  date not null,
  note             text check (note is null or length(note) <= 200),
  created_by       bigint not null references public.members (id),
  created_at       timestamptz not null default now(),
  check (from_member_id <> to_member_id)
);

-- ───────────────────────── Who am I? ─────────────────────────

create function public.current_member_id() returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.members where user_id = auth.uid() and is_active
$$;

create function public.current_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.members where user_id = auth.uid() and is_active), false)
$$;

-- Links the logged-in account to its member row (matched by username) on first login.
create function public.claim_member() returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_username text := lower(split_part(coalesce(auth.email(), ''), '@', 1));
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Not logged in.';
  end if;
  select id into v_id from public.members where user_id = auth.uid();
  if v_id is not null then
    return v_id;
  end if;
  update public.members set user_id = auth.uid(), updated_at = now()
    where username = v_username and user_id is null and is_active
    returning id into v_id;
  if v_id is null then
    raise exception 'This login is not linked to a flat member. Ask the admin to add a member with username "%".', v_username;
  end if;
  return v_id;
end $$;

-- ───────────────────────── Read access (RLS) ─────────────────────────

alter table public.members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;

create policy "members can read members" on public.members
  for select to authenticated using (public.current_member_id() is not null);
create policy "members can read expenses" on public.expenses
  for select to authenticated using (public.current_member_id() is not null);
create policy "members can read splits" on public.expense_splits
  for select to authenticated using (public.current_member_id() is not null);
create policy "members can read settlements" on public.settlements
  for select to authenticated using (public.current_member_id() is not null);
-- No insert/update/delete policies: all writes go through the functions below.

-- ───────────────────────── Helpers ─────────────────────────

create function public._require_member() returns bigint
language plpgsql stable security definer set search_path = public as $$
declare v_me bigint := public.current_member_id();
begin
  if v_me is null then
    raise exception 'Please log in as a flat member.';
  end if;
  return v_me;
end $$;

-- Only the member who added an entry may change or delete it.
create function public._require_owner(p_created_by bigint) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_name text;
begin
  if p_created_by = public._require_member() then
    return;
  end if;
  select name into v_name from public.members where id = p_created_by;
  raise exception 'Only % can change this, because they added it.', coalesce(v_name, 'the person who added it');
end $$;

-- ───────────────────────── Expenses ─────────────────────────

-- Creates (p_id null) or updates an expense and its splits in one step.
-- p_splits: [{"member_id": 1, "amount": 50000}, ...] in paisa; must add up to p_amount.
create function public.save_expense(
  p_id bigint,
  p_title text,
  p_description text,
  p_amount bigint,
  p_category text,
  p_date date,
  p_paid_by bigint,
  p_split_mode text,
  p_splits jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me bigint := public._require_member();
  v_id bigint := p_id;
  v_owner bigint;
  v_sum bigint;
  v_count int;
begin
  if p_date > current_date + 1 then  -- +1 tolerates time zones ahead of UTC
    raise exception 'Expense date cannot be in the future.';
  end if;
  if not exists (select 1 from public.members where id = p_paid_by) then
    raise exception 'The member who paid no longer exists.';
  end if;
  if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then
    raise exception 'Choose at least one member to split with.';
  end if;

  select coalesce(sum(amount), 0), count(*), count(distinct member_id)
    into v_sum, v_count
    from jsonb_to_recordset(p_splits) as s(member_id bigint, amount bigint);
  if v_sum <> p_amount then
    raise exception 'Shares (%) must add up to the amount (%).', v_sum, p_amount;
  end if;
  if exists (select 1 from jsonb_to_recordset(p_splits) as s(member_id bigint, amount bigint) where amount is null or amount <= 0) then
    raise exception 'Each share must be greater than zero.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_splits) as s(member_id bigint, amount bigint)
    where not exists (select 1 from public.members m where m.id = s.member_id)
  ) then
    raise exception 'One of the members in the split no longer exists.';
  end if;

  if v_id is null then
    insert into public.expenses (title, description, amount, category, expense_date, paid_by, split_mode, created_by)
    values (trim(p_title), nullif(trim(coalesce(p_description, '')), ''), p_amount, p_category, p_date, p_paid_by, p_split_mode, v_me)
    returning id into v_id;
  else
    select created_by into v_owner from public.expenses where id = v_id for update;
    if v_owner is null then
      raise exception 'This expense was deleted by someone else.';
    end if;
    perform public._require_owner(v_owner);
    update public.expenses set
      title = trim(p_title), description = nullif(trim(coalesce(p_description, '')), ''), amount = p_amount,
      category = p_category, expense_date = p_date, paid_by = p_paid_by, split_mode = p_split_mode, updated_at = now()
    where id = v_id;
    delete from public.expense_splits where expense_id = v_id;
  end if;

  insert into public.expense_splits (expense_id, member_id, amount)
  select v_id, s.member_id, s.amount from jsonb_to_recordset(p_splits) as s(member_id bigint, amount bigint);
  return v_id;
end $$;

create function public.delete_expense(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_owner bigint;
begin
  select created_by into v_owner from public.expenses where id = p_id for update;
  if v_owner is null then
    raise exception 'This expense no longer exists.';
  end if;
  perform public._require_owner(v_owner);
  delete from public.expenses where id = p_id;
end $$;

-- ───────────────────────── Payments between members ─────────────────────────

create function public.add_settlement(p_from bigint, p_to bigint, p_amount bigint, p_date date, p_note text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me bigint := public._require_member();
  v_id bigint;
begin
  if p_from = p_to then
    raise exception 'A member cannot pay themselves.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  if p_date > current_date + 1 then
    raise exception 'Date cannot be in the future.';
  end if;
  if (select count(*) from public.members where id in (p_from, p_to)) <> 2 then
    raise exception 'Member not found.';
  end if;
  insert into public.settlements (from_member_id, to_member_id, amount, settlement_date, note, created_by)
  values (p_from, p_to, p_amount, p_date, nullif(trim(coalesce(p_note, '')), ''), v_me)
  returning id into v_id;
  return v_id;
end $$;

create function public.delete_settlement(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_owner bigint;
begin
  select created_by into v_owner from public.settlements where id = p_id for update;
  if v_owner is null then
    raise exception 'This payment no longer exists.';
  end if;
  perform public._require_owner(v_owner);
  delete from public.settlements where id = p_id;
end $$;

-- ───────────────────────── Members (admin only) ─────────────────────────

create function public.admin_save_member(
  p_id bigint, p_name text, p_username text, p_phone text, p_email text, p_notes text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := p_id;
begin
  perform public._require_member();
  if not public.current_is_admin() then
    raise exception 'Only the admin can add or edit members.';
  end if;
  if v_id is null then
    insert into public.members (name, username, phone, email, notes)
    values (trim(p_name), lower(trim(p_username)), nullif(trim(coalesce(p_phone, '')), ''),
            nullif(trim(coalesce(p_email, '')), ''), nullif(trim(coalesce(p_notes, '')), ''))
    returning id into v_id;
  else
    update public.members set
      name = trim(p_name), username = lower(trim(p_username)), phone = nullif(trim(coalesce(p_phone, '')), ''),
      email = nullif(trim(coalesce(p_email, '')), ''), notes = nullif(trim(coalesce(p_notes, '')), ''), updated_at = now()
    where id = v_id;
    if not found then
      raise exception 'Member not found.';
    end if;
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception 'That name or username is already used by another member.';
end $$;

-- Archives (false) or restores (true) a member. History is never deleted.
create function public.admin_set_member_active(p_id bigint, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_member();
  if not public.current_is_admin() then
    raise exception 'Only the admin can remove or restore members.';
  end if;
  if not p_active and p_id = public.current_member_id() then
    raise exception 'You cannot remove yourself.';
  end if;
  update public.members set is_active = p_active, updated_at = now() where id = p_id;
  if not found then
    raise exception 'Member not found.';
  end if;
exception
  when unique_violation then
    raise exception 'An active member already has this name.';
end $$;

-- ───────────────────────── Permissions ─────────────────────────

revoke all on function public.claim_member, public.save_expense, public.delete_expense, public.add_settlement,
  public.delete_settlement, public.admin_save_member, public.admin_set_member_active,
  public.current_member_id, public.current_is_admin, public._require_member, public._require_owner
  from public, anon;
grant execute on function public.claim_member, public.save_expense, public.delete_expense, public.add_settlement,
  public.delete_settlement, public.admin_save_member, public.admin_set_member_active,
  public.current_member_id, public.current_is_admin
  to authenticated;

-- ───────────────────────── Live updates ─────────────────────────

alter publication supabase_realtime add table public.members, public.expenses, public.expense_splits, public.settlements;
