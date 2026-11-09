-- Transfers between a user's own accounts (bank, wallet, cash).
--
-- A transfer moves money from one account to another: the source is debited
-- and the destination credited in the same transaction as this row is
-- written. It is neither income nor an expense, so it lives in its own table
-- and nothing that sums expenses, income or budgets ever reads it.
--
-- Money is whole paise (bigint). The account names are copied in when the
-- transfer is made, so the history reads the same whatever happens later.
--
-- `request_id` is chosen by the browser for each submission; the same id
-- twice (a double click, a retried request) is one transfer, not two.
--
-- Additive only: one new table and its indexes.

create table if not exists account_transfers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid        not null references users (id) on delete cascade,
  request_id      uuid        not null,
  -- No ON DELETE action: an account with transfers cannot be deleted on its
  -- own (the API explains why first). Deleting the whole user still works,
  -- because these rows go with the user in the same statement.
  from_account_id uuid        not null references balances (id),
  to_account_id   uuid        not null references balances (id),
  from_type       text        not null,
  from_name       text        not null,
  to_type         text        not null,
  to_name         text        not null,
  amount_paise    bigint      not null check (amount_paise > 0 and amount_paise <= 999999999999),
  transfer_date   date        not null,
  description     text        check (description is null or length(description) <= 200),
  created_at      timestamptz not null default now(),
  check (from_account_id <> to_account_id),
  unique (user_id, request_id)
);

create index if not exists account_transfers_user_idx
  on account_transfers (user_id, transfer_date desc, created_at desc);

-- For "does this account have transfers?" and for the foreign keys themselves.
create index if not exists account_transfers_from_idx on account_transfers (from_account_id);
create index if not exists account_transfers_to_idx on account_transfers (to_account_id);
