-- Splitting an expense between several people, and recording them paying back.
--
-- The whole amount still leaves the account: if ₹1,455 of vegetables were paid
-- from HDFC, HDFC really is ₹1,455 lighter, and the expense row and its debit
-- stay exactly as they are. What changes is how much of it is yours. Without
-- this the dashboard reports ₹1,455 of groceries when the owner's own cost was
-- ₹363, and the three repayments that follow look like ₹1,092 of income.
--
-- People are counted, not named. The owner pays the shop and collects from
-- whoever was in on it; the app only needs to know how many ways it was split
-- and how much has come back.
--
--   split_members    how many people it was split between, the owner included
--   split_share      what each of the others owes
--   personal_share   what is left for the owner
--
-- The shares are worked out once, when the expense is recorded, and stored. A
-- rule for rounding can change later without rewriting what people were told
-- they owed. All three are null for an ordinary expense, and the check keeps
-- them from being half set.

alter table expenses
  add column if not exists split_members  integer
    check (split_members between 2 and 50),
  add column if not exists split_share    numeric(14,2)
    check (split_share >= 0),
  add column if not exists personal_share numeric(14,2)
    check (personal_share >= 0);

alter table expenses
  drop constraint if exists expenses_split_complete;

alter table expenses
  add constraint expenses_split_complete check (
    (split_members is null and split_share is null and personal_share is null)
    or (split_members is not null and split_share is not null and personal_share is not null)
  );

-- A repayment is money in, but not income: it is someone returning their part
-- of an expense. It stays in incomes because it is a real credit to a real
-- account, and the link is what tells the two apart.
--
-- On delete set null: removing the expense leaves the money that came back
-- where it is, since it did arrive, and it becomes ordinary money in.
alter table incomes
  add column if not exists split_expense_id uuid
    references expenses (id) on delete set null;

create index if not exists incomes_split_expense_idx
  on incomes (split_expense_id)
  where split_expense_id is not null;
