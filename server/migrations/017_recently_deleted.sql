-- Recently deleted transactions.
--
-- Removing an expense or income no longer deletes its row. It is marked
-- deleted (deleted_at), its money is put back exactly as before, and it waits
-- 30 days in Recently deleted, where it can be restored or deleted for good.
-- Everything that totals or lists entries leaves marked rows out.
--
-- Additive only: nullable columns on expenses and incomes (no default, so
-- adding them rewrites nothing and every existing row reads as not deleted),
-- partial indexes, and one small audit table. No existing row is changed.

alter table expenses
  add column if not exists deleted_at       timestamptz,
  -- Who removed it: the account itself (accounts have one owner), and how.
  add column if not exists deleted_by       uuid references users (id) on delete set null,
  add column if not exists deleted_via      text check (deleted_via in ('user', 'admin', 'whatsapp')),
  -- True when removing it put its debit back in the account, so a restore
  -- must take it out again; false when it moved no money (pending, listed only).
  add column if not exists delete_reversed  boolean;

alter table incomes
  add column if not exists deleted_at       timestamptz,
  add column if not exists deleted_by       uuid references users (id) on delete set null,
  add column if not exists deleted_via      text check (deleted_via in ('user', 'admin', 'whatsapp')),
  add column if not exists delete_reversed  boolean;

-- A deleted row always says how it was deleted; a live one carries none of it.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_deleted_shape') then
    alter table expenses add constraint expenses_deleted_shape check (
      (deleted_at is null and deleted_via is null and delete_reversed is null)
      or (deleted_at is not null and deleted_via is not null and delete_reversed is not null)
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'incomes_deleted_shape') then
    alter table incomes add constraint incomes_deleted_shape check (
      (deleted_at is null and deleted_via is null and delete_reversed is null)
      or (deleted_at is not null and deleted_via is not null and delete_reversed is not null)
    );
  end if;
end
$$;

-- The Recently deleted list, per account, newest first.
create index if not exists expenses_deleted_idx
  on expenses (user_id, deleted_at desc) where deleted_at is not null;

create index if not exists incomes_deleted_idx
  on incomes (user_id, deleted_at desc) where deleted_at is not null;

-- The daily clean-up: everything deleted before a cut-off, across accounts.
create index if not exists expenses_deleted_purge_idx
  on expenses (deleted_at) where deleted_at is not null;

create index if not exists incomes_deleted_purge_idx
  on incomes (deleted_at) where deleted_at is not null;

-- One row per entry deleted for good: that it existed and when it went, so
-- the history of the account stays accountable. No description, category or
-- account is kept; the person asked for the entry itself to be gone.
create table if not exists transaction_purges (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references users (id) on delete cascade,
  kind         text        not null check (kind in ('expense', 'income')),
  entry_id     uuid        not null,
  amount_paise bigint      not null check (amount_paise > 0),
  entry_date   date        not null,
  deleted_at   timestamptz not null,
  purged_at    timestamptz not null default now(),
  reason       text        not null check (reason in ('user', 'empty', 'retention')),
  unique (kind, entry_id)
);

create index if not exists transaction_purges_user_idx
  on transaction_purges (user_id, purged_at desc);
