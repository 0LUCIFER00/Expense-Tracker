-- Initial schema for the Expense Tracker.
--
-- Mirrors what the app previously kept in localStorage, with the parts that a
-- real database can enforce: one account per email, balances and expenses that
-- belong to a user, money as numeric rather than float, and a status that can
-- only hold the two values the app understands.

create table if not exists users (
  id                  uuid primary key default gen_random_uuid(),
  name                text        not null check (length(trim(name)) > 0),
  -- Stored lower-cased by the API so the unique constraint is case-insensitive.
  email               text        not null unique,
  password_hash       text        not null,
  -- Null when the account has no second, admin-level password.
  admin_password_hash text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists balances (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid           not null references users (id) on delete cascade,
  type       text           not null,
  category   text           not null,
  balance    numeric(14, 2) not null default 0 check (balance >= 0),
  -- A row is only spendable once the user has explicitly saved it.
  saved      boolean        not null default false,
  created_at timestamptz    not null default now(),
  updated_at timestamptz    not null default now()
);

create index if not exists balances_user_idx on balances (user_id);

-- 'pending' is the app's "Pending / Waiting Admin".
do $$
begin
  if not exists (select 1 from pg_type where typname = 'expense_status') then
    create type expense_status as enum ('done', 'pending');
  end if;
end
$$;

create table if not exists expenses (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid           not null references users (id) on delete cascade,
  amount            numeric(14, 2) not null check (amount > 0),
  description       text           not null check (length(trim(description)) > 0),
  spent_on          date           not null,

  -- The balance account the money came from. Kept nullable, and the type and
  -- category are copied so a deleted account does not blank out history.
  source_id         uuid references balances (id) on delete set null,
  source_type       text,
  source_category   text,

  -- Whether the entry was filed as "also update the balance".
  expense_access    boolean        not null default false,
  update_permission boolean        not null default false,
  -- Whether the debit has actually been applied to the balance.
  balance_updated   boolean        not null default false,

  status            expense_status not null,
  remarks           text,
  created_at        timestamptz    not null default now()
);

create index if not exists expenses_user_spent_on_idx on expenses (user_id, spent_on desc);
create index if not exists expenses_user_status_idx on expenses (user_id, status);

-- The ten permission flags, one row per account.
create table if not exists user_settings (
  user_id                  uuid primary key references users (id) on delete cascade,
  balance_user_access      boolean     not null default true,
  balance_admin_access     boolean     not null default true,
  expense_user_access      boolean     not null default true,
  expense_admin_access     boolean     not null default true,
  update_permission_user   boolean     not null default true,
  update_permission_admin  boolean     not null default true,
  view_permission_user     boolean     not null default true,
  view_permission_admin    boolean     not null default true,
  remove_permission_user   boolean     not null default true,
  remove_permission_admin  boolean     not null default true,
  updated_at               timestamptz not null default now()
);

-- Keeps updated_at honest without the API having to remember.
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  foreach t in array array['users', 'balances', 'user_settings'] loop
    execute format(
      'drop trigger if exists %I on %I', t || '_set_updated_at', t
    );
    execute format(
      'create trigger %I before update on %I
         for each row execute function set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end
$$;
