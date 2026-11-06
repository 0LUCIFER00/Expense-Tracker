-- Monthly budgets.
--
-- A budget is a plan for one calendar month: an optional overall limit and
-- optional limits per expense category. What has been spent against it is never
-- stored here; it is worked out from the expenses every time it is read, so
-- deleting or approving an expense in any month corrects that month at once.
--
-- Additive only: three new tables and two defaulted settings columns. Nothing
-- existing is changed.

create table if not exists monthly_budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid          not null references users (id) on delete cascade,
  -- The first day of the month the budget is for.
  month        date          not null check (extract(day from month) = 1),
  -- Null when only category limits are set.
  total_budget numeric(14, 2) check (total_budget > 0),
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now(),
  -- One budget a month per account; also the index every lookup uses.
  unique (user_id, month)
);

create table if not exists category_budgets (
  id                uuid primary key default gen_random_uuid(),
  monthly_budget_id uuid           not null references monthly_budgets (id) on delete cascade,
  -- An expense category name from the API's fixed list, or 'Uncategorised'.
  category          text           not null check (length(trim(category)) > 0),
  amount            numeric(14, 2) not null check (amount > 0),
  created_at        timestamptz    not null default now(),
  updated_at        timestamptz    not null default now(),
  unique (monthly_budget_id, category)
);

-- Which thresholds have already been announced, so each is announced once.
-- Holds no money of its own beyond the figure that triggered it.
create table if not exists budget_alerts (
  monthly_budget_id uuid           not null references monthly_budgets (id) on delete cascade,
  -- 'overall', or a category name.
  scope             text           not null,
  -- 50, 80 and 100 per cent; 101 stands for "over".
  threshold         smallint       not null check (threshold in (50, 80, 100, 101)),
  spent             numeric(14, 2) not null,
  created_at        timestamptz    not null default now(),
  primary key (monthly_budget_id, scope, threshold)
);

do $$
declare
  t text;
begin
  foreach t in array array['monthly_budgets', 'category_budgets'] loop
    execute format('drop trigger if exists %I on %I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on %I
         for each row execute function set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end
$$;

alter table user_settings
  add column if not exists budget_user_access boolean not null default true;

alter table user_settings
  add column if not exists whatsapp_budget_alerts boolean not null default false;

comment on column user_settings.budget_user_access is
  'Normal user may create, change and remove budgets; seeing them needs nothing';
comment on column user_settings.whatsapp_budget_alerts is
  'Add a budget alert line to the WhatsApp reply after an expense; never a message of its own';
