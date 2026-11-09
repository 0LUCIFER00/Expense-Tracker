-- Recurring transactions.
--
-- A schedule says "add this expense (or income) every so often". Nothing is
-- created in advance: when a date comes due, the runner adds that one entry,
-- through the same code the website uses, and moves the schedule on.
--
-- Each due date is one occurrence, a row in recurring_runs. Two things make an
-- occurrence impossible to post twice, even with two runners at once:
--   * recurring_runs is unique on (schedule_id, due_on);
--   * an expense or income can point at a given occurrence only once.
--
-- Additive only: two new tables, one new nullable column on expenses and on
-- incomes, and two defaulted settings columns. Nothing existing is changed.

create table if not exists recurring_schedules (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid           not null references users (id) on delete cascade,
  kind           text           not null check (kind in ('expense', 'income')),
  description    text           not null check (length(trim(description)) between 1 and 200),
  amount         numeric(14, 2) not null check (amount > 0),
  category       text,
  -- The account the money comes out of (or goes into). Null for an expense
  -- that is only listed. uses_account remembers that one was chosen, so an
  -- account deleted later makes a run fail visibly instead of quietly not
  -- moving money.
  account_id     uuid           references balances (id) on delete set null,
  uses_account   boolean        not null default false,
  frequency      text           not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  interval_count smallint       not null default 1 check (interval_count between 1 and 99),
  start_on       date           not null,
  -- Dates are counted from the anchor (occurrence number next_seq is due on
  -- anchor + next_seq intervals), so a schedule on the 31st that falls on the
  -- 28th in February goes back to the 31st in March instead of drifting.
  anchor_on      date           not null,
  next_seq       integer        not null default 0 check (next_seq >= 0),
  next_due_on    date,
  end_on         date           check (end_on is null or end_on >= start_on),
  -- Days before the due date to remind; null is off.
  remind_days    smallint       check (remind_days in (0, 1, 3, 7)),
  status         text           not null default 'active'
                                check (status in ('active', 'paused', 'completed')),
  -- The due date a WhatsApp reminder line was last given for, so it is given once.
  reminded_for   date,
  last_run_at    timestamptz,
  created_at     timestamptz    not null default now(),
  updated_at     timestamptz    not null default now(),
  check (status <> 'active' or next_due_on is not null),
  check (kind <> 'income' or uses_account)
);

-- What the runner looks for: active schedules that have come due.
create index if not exists recurring_schedules_due_idx
  on recurring_schedules (next_due_on) where status = 'active';

create index if not exists recurring_schedules_user_idx
  on recurring_schedules (user_id, created_at);

-- One row per occurrence that has come due. The entry's details are copied in
-- when it first comes due, so editing the schedule later never changes what an
-- occurrence (or a retry of it) adds.
create table if not exists recurring_runs (
  id                uuid primary key default gen_random_uuid(),
  schedule_id       uuid           not null references recurring_schedules (id) on delete cascade,
  user_id           uuid           not null references users (id) on delete cascade,
  due_on            date           not null,
  kind              text           not null check (kind in ('expense', 'income')),
  description       text           not null,
  amount            numeric(14, 2) not null check (amount > 0),
  category          text,
  account_id        uuid           references balances (id) on delete set null,
  uses_account      boolean        not null,
  status            text           not null check (status in ('posted', 'failed', 'skipped')),
  attempts          smallint       not null default 1 check (attempts >= 1),
  last_error        text,
  last_attempt_on   date           not null,
  whatsapp_notified boolean        not null default false,
  created_at        timestamptz    not null default now(),
  updated_at        timestamptz    not null default now(),
  unique (schedule_id, due_on)
);

create index if not exists recurring_runs_failed_idx
  on recurring_runs (user_id) where status = 'failed';

create index if not exists recurring_runs_user_idx
  on recurring_runs (user_id, due_on desc);

do $$
declare
  t text;
begin
  foreach t in array array['recurring_schedules', 'recurring_runs'] loop
    execute format('drop trigger if exists %I on %I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on %I
         for each row execute function set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end
$$;

-- The entry an occurrence added. Unique, so the database itself refuses a
-- second entry for the same occurrence. Deleting the entry later is allowed and
-- leaves the occurrence recorded as posted.
alter table expenses
  add column if not exists recurring_run_id uuid references recurring_runs (id) on delete set null;

alter table incomes
  add column if not exists recurring_run_id uuid references recurring_runs (id) on delete set null;

create unique index if not exists expenses_recurring_run_uidx
  on expenses (recurring_run_id) where recurring_run_id is not null;

create unique index if not exists incomes_recurring_run_uidx
  on incomes (recurring_run_id) where recurring_run_id is not null;

alter table user_settings
  add column if not exists recurring_user_access boolean not null default true;

alter table user_settings
  add column if not exists whatsapp_recurring_reminders boolean not null default false;

comment on column user_settings.recurring_user_access is
  'Normal user may create, change, pause and delete recurring schedules; seeing them needs nothing';
comment on column user_settings.whatsapp_recurring_reminders is
  'Add recurring reminder lines to WhatsApp replies; never a message of its own';
