-- What an expense was *for*, as opposed to where the money came from.
--
-- The expenses table already carried source_type and source_category, but those
-- describe the account ("Bank Account", "HDFC Bank"). Nothing recorded whether
-- ₹250 went on lunch or on a bus fare, so the totals could never be broken
-- down. This adds that, from a fixed list the API validates.
--
-- Nullable on purpose: entries made before this migration genuinely have no
-- category, and the app shows them as "Uncategorised" rather than guessing.

alter table expenses add column if not exists category text;

comment on column expenses.category is
  'What the money was spent on, from the API''s fixed list; null for entries made before categories existed';

-- The dashboard groups a single account's spending by category and month.
create index if not exists expenses_user_category_idx
  on expenses (user_id, category);
