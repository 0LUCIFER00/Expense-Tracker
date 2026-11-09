-- Savings goals.
--
-- A goal is money set aside in the owner's head, not in the bank: it tracks
-- what has been put towards something and what has been taken back out. It
-- never moves money between accounts, and nothing here is an expense or income.
--
-- Money is stored as whole paise (bigint), so no sum is ever off by a fraction.
-- `saved_paise` is the running total; every change to it is one row in
-- savings_goal_activity, written in the same transaction under a row lock, so
-- the two always agree.
--
-- Additive only: two new tables and one defaulted settings column.

create table if not exists savings_goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references users (id) on delete cascade,
  name         text        not null check (length(trim(name)) between 1 and 80),
  description  text        check (description is null or length(description) <= 300),
  icon         text        check (icon is null or icon in (
                 'piggy', 'emergency', 'travel', 'home', 'vehicle',
                 'gadget', 'education', 'health', 'gift', 'celebration')),
  -- Up to ₹99,99,99,999.99.
  target_paise bigint      not null check (target_paise > 0 and target_paise <= 999999999999),
  saved_paise  bigint      not null default 0 check (saved_paise >= 0 and saved_paise <= 999999999999),
  target_date  date        not null,
  status       text        not null default 'active' check (status in ('active', 'paused', 'completed')),
  -- The day it was created, in India time: the start of its "on track" line.
  created_on   date        not null,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists savings_goals_user_idx
  on savings_goals (user_id, created_at);

-- Every amount put in or taken out, with the total it left. Never edited:
-- changing a goal's name or target leaves this exactly as it was.
create table if not exists savings_goal_activity (
  id                uuid primary key default gen_random_uuid(),
  goal_id           uuid        not null references savings_goals (id) on delete cascade,
  user_id           uuid        not null references users (id) on delete cascade,
  kind              text        not null check (kind in ('contribution', 'withdrawal')),
  amount_paise      bigint      not null check (amount_paise > 0),
  on_date           date        not null,
  note              text        check (note is null or length(note) <= 200),
  saved_after_paise bigint      not null check (saved_after_paise >= 0),
  created_at        timestamptz not null default now()
);

create index if not exists savings_goal_activity_goal_idx
  on savings_goal_activity (goal_id, on_date desc, created_at desc);

drop trigger if exists savings_goals_set_updated_at on savings_goals;
create trigger savings_goals_set_updated_at
  before update on savings_goals
  for each row execute function set_updated_at();

alter table user_settings
  add column if not exists goals_user_access boolean not null default true;

comment on column user_settings.goals_user_access is
  'Normal user may create, change and delete savings goals and add or withdraw; seeing them needs nothing';
