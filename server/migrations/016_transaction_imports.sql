-- Importing transactions from a CSV or Excel file.
--
-- Each import is a batch; each row the person chose to import is logged
-- against it with what happened. The expense or income itself is created by
-- the same code the Add pages use, so nothing about expenses, incomes or
-- balances changes shape here.
--
-- Two things stop the same rows being imported twice:
--   * the batch id is chosen by the browser before the first request, and
--     (batch_id, row_number) is unique, so a retried request finds the rows it
--     already imported instead of adding them again;
--   * before a row is imported it is compared with the person's existing
--     entries (same kind, date, amount and description), and refused as a
--     duplicate unless they asked for it anyway.
-- file_hash also lets the page warn that a file has been imported before.
--
-- Additive only: two new tables. No existing table or row is changed.

create table if not exists import_batches (
  -- Chosen by the browser, so a retry of the same import is recognised.
  id            uuid primary key,
  user_id       uuid        not null references users (id) on delete cascade,
  -- The name shown back to the person, cleaned of any path.
  file_name     text        not null check (length(file_name) between 1 and 200),
  -- SHA-256 of the file's bytes, as 64 hex characters.
  file_hash     text        not null check (file_hash ~ '^[0-9a-f]{64}$'),
  file_type     text        not null check (file_type in ('csv', 'xlsx')),
  -- Rows in the file, and how many of them have been imported or failed so far.
  total_rows    integer     not null check (total_rows between 0 and 100000),
  imported_rows integer     not null default 0 check (imported_rows >= 0),
  failed_rows   integer     not null default 0 check (failed_rows >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists import_batches_user_hash_idx
  on import_batches (user_id, file_hash);

create table if not exists import_rows (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid        not null references import_batches (id) on delete cascade,
  user_id         uuid        not null references users (id) on delete cascade,
  -- The row's number in the file as the person sees it (the heading is row 1).
  row_number      integer     not null check (row_number between 1 and 1000000),
  kind            text        check (kind in ('expense', 'income')),
  status          text        not null check (status in ('imported', 'failed')),
  error           text,
  -- The entry this row created. Removing that entry later is allowed; the log
  -- then simply no longer points at anything.
  expense_id      uuid        references expenses (id) on delete set null,
  income_id       uuid        references incomes (id) on delete set null,
  -- The two columns the app has no field of its own for, kept with the entry.
  notes           text        check (notes is null or length(notes) <= 300),
  payment_method  text        check (payment_method is null or length(payment_method) <= 60),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- No check that an imported row points at an entry: removing the entry
  -- clears the link (on delete set null), and that must not be refused.
  unique (batch_id, row_number)
);

-- An entry is created by at most one imported row.
create unique index if not exists import_rows_expense_idx
  on import_rows (expense_id) where expense_id is not null;

create unique index if not exists import_rows_income_idx
  on import_rows (income_id) where income_id is not null;

create index if not exists import_rows_user_idx
  on import_rows (user_id);

do $$
declare
  t text;
begin
  foreach t in array array['import_batches', 'import_rows'] loop
    execute format('drop trigger if exists %I on %I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on %I
         for each row execute function set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end
$$;
