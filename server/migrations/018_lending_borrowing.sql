-- Lending and borrowing.
--
-- Money given to someone, or received from someone, that is to come back.
-- The principal moves a real account (lending debits it, borrowing credits it)
-- in the same transaction as the record is written, but it is neither an
-- expense nor income: it lives in its own tables, which nothing that totals
-- expenses, income or budgets ever reads.
--
-- Interest is the exception. Interest received on a loan is income and
-- interest paid on a debt is an expense, so the interest part of a repayment
-- is filed as an ordinary income or expense entry (category Interest / Other)
-- and linked back to the repayment. Every existing total then counts it once,
-- and principal is never counted at all.
--
-- Money is whole paise (bigint). Account names are copied in when each record
-- is made, so the history reads the same whatever happens to the account.
--
-- `request_id` is chosen by the browser for each submission; the same id
-- twice (a double click, a retried request) is one record, not two.
--
-- Additive only: two new tables, their indexes, and one nullable column (with
-- a partial unique index) on expenses and on incomes. No existing row changes.

create table if not exists loans (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid        not null references users (id) on delete cascade,
  request_id         uuid        not null,
  -- 'lent': the user gave money and is owed. 'borrowed': the user owes.
  direction          text        not null check (direction in ('lent', 'borrowed')),
  person_name        text        not null check (length(trim(person_name)) between 1 and 80),
  contact            text        check (contact is null or length(contact) <= 120),
  principal_paise    bigint      not null check (principal_paise > 0 and principal_paise <= 999999999999),
  start_date         date        not null,
  due_date           date        check (due_date is null or due_date >= start_date),
  -- The account the principal left (lent) or arrived in (borrowed). No ON
  -- DELETE action: an account with loans cannot be deleted on its own (the API
  -- explains why first); deleting the whole user still works.
  account_id         uuid        not null references balances (id),
  account_type       text        not null,
  account_name       text        not null,
  -- Simple interest only, never compounded: a rate in hundredths of a percent
  -- (150 is 1.50%) per month or per year, counted by the day.
  interest_type      text        not null default 'none' check (interest_type in ('none', 'simple')),
  interest_rate_bp   integer     check (interest_rate_bp is null or interest_rate_bp between 1 and 10000),
  interest_period    text        check (interest_period is null or interest_period in ('month', 'year')),
  notes              text        check (notes is null or length(notes) <= 300),
  -- Active, or cancelled with every balance change it made reversed. Paid,
  -- partly paid and overdue are worked out from the repayments and dates.
  status             text        not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_at       timestamptz,
  cancel_reason      text        check (cancel_reason is null or length(cancel_reason) <= 200),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (
    (interest_type = 'none' and interest_rate_bp is null and interest_period is null)
    or (interest_type = 'simple' and interest_rate_bp is not null and interest_period is not null)
  ),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  unique (user_id, request_id)
);

create index if not exists loans_user_idx on loans (user_id, start_date desc, created_at desc);
create index if not exists loans_account_idx on loans (account_id);

drop trigger if exists loans_set_updated_at on loans;
create trigger loans_set_updated_at
  before update on loans
  for each row execute function set_updated_at();

-- Each repayment, with its own account: money back on a loan can arrive in a
-- different account from the one it left. The amount is split once, when it is
-- recorded, into interest (paid first) and principal; the split never changes.
-- A reversal marks the row and puts the money back; the row itself stays.
create table if not exists loan_repayments (
  id               uuid primary key default gen_random_uuid(),
  loan_id          uuid        not null references loans (id) on delete cascade,
  user_id          uuid        not null references users (id) on delete cascade,
  request_id       uuid        not null,
  amount_paise     bigint      not null check (amount_paise > 0 and amount_paise <= 999999999999),
  principal_paise  bigint      not null check (principal_paise >= 0),
  interest_paise   bigint      not null check (interest_paise >= 0),
  paid_on          date        not null,
  account_id       uuid        not null references balances (id),
  account_type     text        not null,
  account_name     text        not null,
  note             text        check (note is null or length(note) <= 200),
  reversed_at      timestamptz,
  reversed_reason  text        check (reversed_reason is null or reversed_reason in ('reversed', 'cancelled')),
  created_at       timestamptz not null default now(),
  check (principal_paise + interest_paise = amount_paise),
  check ((reversed_at is null) = (reversed_reason is null)),
  unique (user_id, request_id)
);

create index if not exists loan_repayments_loan_idx on loan_repayments (loan_id, paid_on, created_at);
create index if not exists loan_repayments_user_idx on loan_repayments (user_id, paid_on desc, created_at desc);
create index if not exists loan_repayments_account_idx on loan_repayments (account_id);

-- The income (interest received) or expense (interest paid) entry a
-- repayment's interest was filed as. Unique, so one repayment can never be
-- counted twice. The Transactions page refuses to remove these on their own:
-- reversing the repayment is what undoes them.
alter table incomes
  add column if not exists loan_repayment_id uuid references loan_repayments (id);

alter table expenses
  add column if not exists loan_repayment_id uuid references loan_repayments (id);

create unique index if not exists incomes_loan_repayment_uidx
  on incomes (loan_repayment_id) where loan_repayment_id is not null;

create unique index if not exists expenses_loan_repayment_uidx
  on expenses (loan_repayment_id) where loan_repayment_id is not null;
