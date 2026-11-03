-- Money coming in.
--
-- Until now the only way to raise a balance was to edit the figure on the
-- Balance Management page, which leaves no record of where the money came from
-- and no way to tell a correction from a salary. This records it the same way
-- an expense is recorded, and credits the account in the same transaction.
--
-- A separate table rather than a signed amount on expenses: the two are asked
-- different questions ("what did I spend on" versus "where did this come from"),
-- the categories do not overlap, and every existing query over expenses would
-- otherwise have to learn to exclude the credits.

create table if not exists incomes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid           not null references users (id) on delete cascade,
  amount          numeric(14, 2) not null check (amount > 0),
  description     text           not null check (length(trim(description)) > 0),
  received_on     date           not null,

  -- Where it came from, from the API's fixed list. Null is allowed so an entry
  -- can be filed without one, as with expenses.
  category        text,

  -- The account it went into. Nullable, and the type and category are copied,
  -- so deleting an account does not blank out the history.
  target_id       uuid references balances (id) on delete set null,
  target_type     text,
  target_category text,

  -- Whether the credit has actually been applied to the balance.
  balance_updated boolean        not null default false,

  -- 'web' or 'whatsapp', so an undo over WhatsApp can find the last one sent.
  source_channel  text           not null default 'web',

  created_at      timestamptz    not null default now()
);

create index if not exists incomes_user_received_on_idx
  on incomes (user_id, received_on desc);

create index if not exists incomes_user_channel_idx
  on incomes (user_id, source_channel, created_at desc);
