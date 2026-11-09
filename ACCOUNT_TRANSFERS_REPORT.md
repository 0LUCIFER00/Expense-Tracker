# Account Transfers and Cash & Accounts Update — Report

Branch `feat/account-transfers`, built on `feat/savings-goals`, so it includes
Budgets, Recurring, Savings Goals and the Planning menu. Pushed to GitHub only:
**not merged, not deployed**.

---

## 1. What changed on Cash & Accounts

The page now reads, top to bottom:

1. **Accounts** (at the top, as the owner asked):
   - one card per account with an icon (bank, wallet, cash), the name and
     type, and the balance centred below;
   - a small **×** in each card's top-right corner removes the account (see 3);
   - **Add account** opens a compact form: type, name (with the existing
     "+ Add new" for a custom bank, wallet or cash name) and opening balance
     (zero or more);
   - the **Edit option is gone**: a balance changes by recording what
     happened (an expense, income or a transfer), so there is always a record
     of why.
2. **Transfer money:**
   - **From** and **To** (each showing its balance), a ⇄ swap button,
     **Amount** with an **All** quick-fill, **Date**, an optional
     **Description** and **Transfer**;
   - on a laptop it's one line; on a tablet two; on a phone one field per
     line;
   - a green line confirms what moved and both new balances, also shown as a
     toast; a red line shows any refusal;
   - the account cards update at once.
3. **Transfers (history):**
   - date, a "Transfer" tag, **From → To**, description and amount, newest
     first;
   - filters: an account (either side) and a from–to date range;
   - a count and total of what is shown;
   - styled in the accent colour rather than debit red or credit green, so a
     transfer never reads as income or an expense.

A sign-in that may see balances but not change them sees the cards and the
history only: no transfer form, no ×, no Add account.

## 2. Transfer rules

- **Accounts:** only between two of the user's own **saved** accounts, of any
  type (bank, wallet, cash). The same account on both sides is refused, and
  the form never offers the source as the destination.
- **Amount:** above ₹0, at most two decimal places, converted straight to
  whole paise; no more than an account can hold.
- **Sufficient balance:** checked on the server with the source row locked.
  The whole balance can be moved, leaving exactly zero; one paisa more is
  refused.
- **Dates:**
  - today is always allowed;
  - an earlier date needs **"Change transaction dates"** (the same rule as
    expenses and income), otherwise 403;
  - a future date is refused outright, because money that hasn't moved must
    not move the balances now.
- **Permissions:** making a transfer needs what changing a balance already
  needs, `canManageBalances` (seeing balances and "Debit from an account").
  Seeing the history needs `canSeeBalances`, like the page itself. The
  full-access sign-in always has both.
- **Not income, not an expense, not budget spending:** transfers live in their
  own table, which nothing that sums expenses, income or budgets reads.
- **Editing and deleting transfers are not offered.** They aren't part of the
  existing design, and the brief said to add them only if they can be done
  safely. Reversing a transfer can't be guaranteed once the destination has
  spent the money, so a correction is simply a transfer back.

## 3. Deleting an account

The × first asks the server what deleting would affect, then shows either:
- **Can be deleted:** "It holds nothing and has no history, so nothing is
  lost. This can't be undone." with **Delete account**; or
- **Can't be deleted:** every reason, for example:
  - "It still holds ₹625. Transfer it to another account first."
  - "It has history (22 expenses, 1 income entry, 1 transfer). Deleting it
    would leave those records pointing nowhere."
  - "2 recurring schedules use it. Change or delete them on the Recurring page
    first."

  with only **Close**.

The server enforces the same rules: `DELETE /api/balances/:id` returns 409
with the reasons. The delete itself also requires `balance = 0`, so money
arriving between the check and the delete can't be lost.

**Behaviour change:** before this, deleting an account with history quietly
detached its expenses and income from it. Now it's refused, so financial
history is never cut loose. An account with history stays, by design.

## 4. Database migration — `server/migrations/014_account_transfers.sql`

**Additive only. Applied** to the shared Aiven database on 9 Nov 2026. It adds
one table and three indexes; nothing is dropped or changed, and the live
site's code ignores it.

`account_transfers`:

| Column | Notes |
|---|---|
| `id` | uuid primary key |
| `user_id` | owner; cascades with the user |
| `request_id` | uuid chosen by the browser per submission; **unique per user**, so a double-submit or retry is one transfer |
| `from_account_id`, `to_account_id` | references `balances` with **no ON DELETE action**: an account with transfers can't be deleted on its own, but deleting the whole user still works (verified) |
| `from_type`, `from_name`, `to_type`, `to_name` | the accounts as they were at the time, so history reads the same later |
| `amount_paise` | `bigint`, `> 0` and `≤ 999999999999` |
| `transfer_date` | the day the money moved |
| `description` | optional, ≤ 200 characters |
| `created_at` | timestamp |

It also checks that `from_account_id <> to_account_id`.

**Indexes:**
- `(user_id, transfer_date desc, created_at desc)` for the history;
- one on each of `from_account_id` and `to_account_id`, for usage checks and
  the foreign keys.

## 5. API

| Method & path | Needs | What |
|---|---|---|
| `POST /api/transfers` | `canManageBalances` | `{ fromAccountId, toAccountId, amount, date?, description?, requestId, tzOffset }`. Returns `201` with the transfer and both new balances, or `200 { duplicate: true }` for a request already processed. Refusals: `400` (input, accounts, limit), `403` (permission, backdate), `409` (insufficient balance). |
| `GET /api/transfers?account=&from=&to=` | `canSeeBalances` | The user's transfers, newest first. |
| `GET /api/balances/:id/usage` | `canManageBalances` | `{ name, balance, expenses, incomes, transfers, schedules, deletable, reasons }`. |
| `DELETE /api/balances/:id` | `canManageBalances` | Now `409` with reasons unless the account is empty and has no history. |

Unchanged: listing and adding accounts. `PUT /api/balances/:id` still exists
on the server, but the page no longer offers editing.

## 6. Financial integrity

In **one database transaction** (`server/src/transfer-store.mjs`):

1. **Lock both account rows** with `SELECT … FOR UPDATE`, always in id order,
   so two transfers between the same pair in opposite directions can't
   deadlock.
2. Check both are this user's saved accounts.
3. **Check the request id after taking the locks.** A second copy of the same
   request waits for the first to commit, then finds it and moves nothing.
4. Compare the source balance with the amount in whole paise.
5. **Debit the source and credit the destination** (`balance ∓ paise/100`, in
   SQL numeric), then insert the transfer row.

Any failure rolls back all of it. The `balance >= 0` constraint on `balances`
is a final safety net. No expense, income, budget, recurring or goal row is
written; the route tests assert this.

## 7. Tests

| Suite | Result |
|---|---|
| API: `npm run test:api` | **289 / 289** pass, twice (263 before; +26) |
| Angular: `npm run test:ci` | **269 / 269** pass (256 before; +13) |
| `ng build` | Clean, no budget warnings. Cash & Accounts chunk 8.5 kB. |
| `npm audit --omit=dev` | 0 vulnerabilities |
| End to end against the real database | **42 / 42** checks pass. Both temporary `@localhost.test` accounts deleted; 0 left, 0 orphaned transfers. |

**New API tests:**
- **`transfers.test.mjs` (9):**
  - paise conversion;
  - same account; malformed accounts;
  - amount limits; future dates; backdating permission; invalid dates and
    descriptions;
  - the request id; formatting.
- **`transfers-routes.test.mjs` (17):**
  - sign-in required;
  - the locks taken in id order, the debit and credit amounts, both new
    balances;
  - every pair of account types;
  - insufficient balance (nothing moves); moving exactly the whole balance;
  - a duplicate request moves nothing;
  - validation before the database;
  - backdating without the permission; restricted sign-ins; full access;
  - another user's or an unsaved account;
  - history scoping and filters; history needs balance visibility;
  - deletion allowed only when empty with no history;
  - deletion refused with each reason (money, expenses, income, transfers,
    recurring);
  - the usage endpoint; another user's account is 404;
  - **no expense, income, budget, recurring or goal write.**

**New Angular tests:**
- **page:** order (accounts, transfer, history), no Edit, the ×, the blocked
  delete explained, a clean delete, adding with a zero balance, balances
  updated after a transfer, the view-only sign-in;
- **form:** the source never offered as the destination; insufficient, bad
  amount and future date caught before sending; the request id, and a new one
  after success; the same id kept after a network failure; the server's
  refusal shown; the date locked without the permission.

**End-to-end highlights** (local API, real Postgres):
- **All pairs:** all six account-type pairs transfer, with exact balances
  after (paise included), and the total across accounts is unchanged.
- **Refusals:** insufficient, same account, zero/negative/three-decimal and
  future date are all refused, and nothing moves. Moving the whole balance
  leaves exactly 0.
- **Backdating:** full access may backdate; a normal sign-in without the
  permission gets 403 for yesterday and 201 for today; without "Debit from an
  account" it gets 403.
- **Concurrency:**
  - **10 concurrent ₹1,000 transfers from ₹5,000: exactly 5 succeed and 5 are
    refused, ending at ₹0;**
  - **16 concurrent transfers in opposite directions between the same two
    accounts: all complete (no deadlock), total unchanged;**
  - **5 copies of one request at once: 1 created, 4 answered as duplicates,
    money moved once, one row.**
- **History:** complete, newest first; the account filter covers either side;
  the date filter works.
- **Separation:** budget spending, the expense list and the income list are
  unchanged by any transfer.
- **Deletion:** an account with transfer history and one holding money are
  both refused with reasons; a fresh empty account can be deleted.
- **Another user** can't move from or into these accounts, sees an empty
  history, and gets 404 on their usage and delete.
- **Cleanup:** deleting the test users (with their transfers) works, with no
  orphans.

**In the browser** (1308×652, light and dark, and phone):
- the page order is accounts, transfer, history;
- a real ₹500 transfer, HDFC Bank → Paytm, on the test account: success
  message, both cards updated, total unchanged, the history row tagged
  "Transfer";
- the × on Paytm lists all three reasons and offers only Close;
- on a phone, fields go full width and nothing overflows the page.

## 8. Deployment

1. **Database:** migration 014 is **already applied**. It's additive, and the
   live code ignores it.
2. **No new environment variables.**
3. **When approved,** merge `feat/account-transfers` into `main`. It contains
   all the earlier unmerged work: Recurring, Savings Goals, the Planning menu
   and the account strip. Pushing `main` deploys production.
4. **Check on the live site:**
   - on Cash & Accounts, transfer a small amount and confirm both balances,
     the total and the history;
   - press × on an account with history and confirm it's refused with
     reasons;
   - confirm Transactions and Budgets don't show the transfer.
5. **Rollback:** promote the previous production deployment. The new table
   can stay.

## 9. Notes and limitations

- **Accounts can't be edited** (by request). A wrong opening balance is
  corrected with a transfer, income or expense, or, for an account with no
  history, by deleting and re-adding it.
- **Accounts with history can't be deleted.** This is intentional, to keep
  every record attached to its account.
- **Transfers can't be edited or deleted;** a mistaken transfer is corrected
  by a transfer back.
- **Sample data:** the test account (`test@gmail.com`) now has one transfer,
  ₹500 HDFC Bank → Paytm, "Wallet top up", made through the page while
  testing.
