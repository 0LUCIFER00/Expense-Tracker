# Recently Deleted (Recycle Bin) — Report

Branch `feat/recycle-bin`, from `feat/transactions-side-panel`. That branch is
the released `main` plus Transaction Import and the side-panel Transactions
layout, so it has everything built so far. Pushed to GitHub only: **not
merged, not deployed**.

---

## 1. What changed

- **Removing an entry no longer deletes it.** On the website, the details
  drawer's **Remove entry** and WhatsApp's **undo** both still put the money
  back exactly as before. But the expense or income now moves to **Recently
  deleted** for 30 days, where it can be restored or deleted for good.
- **Recently deleted is a tab on Transactions.** It is **Deleted**, the fourth
  tab after All / Debit / Credit in the side panel; there is no new menu. Choosing it shows the bin in
  the list's place:
  - **Columns:** description (with Pending, Split, Repays… and receipt tags),
    Expense / Income, amount, account, the entry's own date, the date it was
    removed, and the days left (amber in the last 3);
  - **Actions:** **Restore** and **Delete for good** on each entry;
  - **Tools:** an **Expenses / Income** filter, a description search, and
    **Empty**.
- **Every action asks first, and says what will happen:**
  - restoring: "₹900 is taken out of HDFC Bank again", "It is still waiting
    for approval", "It counts as paying back Dinner again";
  - deleting for good: "This cannot be undone. Its 2 receipts are deleted
    too";
  - emptying: "All 5 entries are deleted for good".

  A refusal (not enough money, split in the bin, account gone) stays in the
  dialog with the server's reason.
- **While the bin is showing**, the year, month and category filters are
  disabled (they don't apply to it), the panel's totals are dimmed, and Export
  has nothing to export.
- **Wording:** the remove note and toasts now say "Moved to Recently deleted …
  you can restore it for 30 days". WhatsApp's undo reply adds where to restore
  it.
- **The transaction list has a search too**, beside its heading. It matches
  description, category or account, and the totals and Export follow it. The
  panel's reset button clears it.
- **Layout:** compact at laptop size (checked at 1260×620, fits with no
  scrolling), cards on a phone, in light and dark themes.

## 2. Database: `server/migrations/017_recently_deleted.sql`

The migration is additive only. No existing row is changed.

- **`expenses` and `incomes`** each gain nullable columns:
  - `deleted_at` (when);
  - `deleted_by` (the account's user id);
  - `deleted_via` (`user`, `admin` for the full-access sign-in, or
    `whatsapp`);
  - `delete_reversed` (whether removing it moved money back, so a restore
    moves it again).

  The columns have no default, so adding them rewrites nothing, and every
  existing row reads as not deleted. A check keeps the four consistent: all
  empty, or all set.
- **Partial indexes** cover the bin list (`user_id, deleted_at desc`) and the
  clean-up (`deleted_at`), on deleted rows only.
- **`transaction_purges`**, a new audit table: one row per entry deleted for
  good.
  - **What it keeps:** kind, entry id, amount in paise, the entry's date, when
    it was removed, when it was purged, and why (`user`, `empty` or
    `retention`).
  - **What it doesn't keep:** the description, category or account.
  - It cascades when the account itself is deleted.

The original financial rows are kept in place, with no copies, so
relationships survive: receipts, repayments of a split, the import log and
recurring occurrences.

**Status: applied** to the database on 10 Nov 2026, as with 012–016. The live
site's current code ignores the new columns. **Before this code goes live it
must be applied**, since every list now filters on `deleted_at`.

**One caution for the future:** once this is deployed and people remove
entries, rolling the site back to older code would show binned entries in the
lists again, because older code doesn't know the column. Roll forward instead,
or empty the bins first.

## 3. Financial integrity

The existing deletion, balance, budget, split and attachment code was read
before any change; §5 lists every query touched.

| Concern | How it is handled |
|---|---|
| Money moves exactly once | Removing locks the row (`for update … and deleted_at is null`), refunds or reverses as before, and records `delete_reversed`. Restoring locks the row, checks it's still deleted, re-applies only what `delete_reversed` says, and clears the mark, in one transaction. A second or simultaneous restore finds it already live: **409**. A second removal finds nothing: **404**. |
| Balance rules | A restore that would take an account below zero is refused (409) with the shortfall, naming amounts only if this sign-in may see balances. A restore whose account has since been deleted is refused. Removing income the account no longer holds is refused, as before. |
| Integer paise | Restore checks compare paise. The bin API returns `amountPaise`, and the audit table stores paise. Stored amounts keep their existing numeric(14,2) columns. |
| Excluded everywhere | Expense and income lists, pending approval, the split list and repayment sums, the split lock, budget spending and budget history, import duplicate checks, WhatsApp "today" and undo, and receipt upload and viewing all filter `deleted_at is null`. Home and Budgets read these, so binned entries never count. |
| Budgets | A binned expense leaves its month's spending. A restored settled one counts again, and alerts are re-checked. A test fails if the budget query ever forgets the filter (checked by removing the filter: the test failed). |
| Pending approval | A pending expense is removed and restored with no money moved and comes back pending. Approving it later debits once. |
| Splits | A removed split keeps its repayments linked, still shown as repayments. Restoring it brings the split back whole, and the personal share counts once. While a split is in the bin it isn't offered for new repayments. |
| Repayments | A binned repayment stops counting as paid back. Restoring one needs its split live (otherwise: "Restore Dinner first") and still owed at least that much (otherwise refused with how much is owed). If the split was deleted for good, the repayment restores as ordinary money in. |
| Lock order | A repayment restore locks the split before the income, the order every repayment path uses, so it can't deadlock with a removal. |
| Receipts | They stay with a binned expense, and new uploads to it are refused. Deleting for good removes the rows by cascade; the existing trigger queues the files, which are deleted from storage straight after and by the daily job. |
| Accounts | Account deletion still counts binned entries as history, so an account can't be deleted while its entries are restorable. |
| Ownership and permissions | Every query is scoped to the signed-in account; another account's ids are **404**. The list needs only a session. Restore, delete for good and Empty need "Remove entries" (**403** without), the same switch as removing. Empty also needs `{"confirm":"empty"}` in the body. |

## 4. APIs

All four routes need a session.

| Method and path | What it does |
|---|---|
| `GET /api/recycle-bin?kind=expense\|income&q=text` | Lists the bin: `retentionDays`, `canManage`, and `entries`. Each entry has kind, id, description, amountPaise, date, category, account (hidden without "see source"), pending, deletedAt, deletedVia, expiresAt, daysLeft, movedMoney, splitMembers, repays and attachmentCount. |
| `POST /api/recycle-bin/:kind/:id/restore` | Restores one entry. Returns what moved and any budget alerts. 409 with a reason when it can't be done safely. |
| `DELETE /api/recycle-bin/:kind/:id` | Deletes one binned entry for good, with an audit row. 409 if the entry isn't in the bin. |
| `POST /api/recycle-bin/empty` with `{"confirm":"empty"}` | Deletes everything in this account's bin for good. |

**Changed:** `DELETE /api/expenses/:id` and `DELETE /api/incomes/:id` now
soft-delete. They return the same fields plus `recentlyDeleted: true`. For an
expense, `linkedRepayments` replaces `detachedRepayments`, because repayments
now stay linked.

**Code:**

- `server/src/recycle-store.mjs` lists, restores, deletes for good, empties,
  and runs the clean-up;
- `server/src/routes/recycle-bin.mjs` holds the routes;
- the soft delete is in the existing `removeExpense` / `removeIncome`.

## 5. Retention clean-up

- **When it runs:** on the existing **daily Vercel Cron** (`/api/recurring/cron`,
  `35 18 * * *`, protected by `CRON_SECRET`), with no in-memory timers.
- **What it does:** deletes for good everything removed more than 30 days ago,
  across all accounts, in batches of 500 per table, with audit reason
  `retention`. The receipt-file sweep then runs straight after, so purged
  expenses' files go the same day. A clean-up failure is logged and retried
  the next day; it never stops the recurring run.
- **Safe to repeat:** a restored row is no longer marked, so it never matches.
  A row being restored at that moment is skipped (`for update skip locked`).
- **Clock:** the cut-off and "days left" both use the **database's clock**,
  the one that stamped `deleted_at`. The end-to-end run caught the API
  server's clock disagreeing with it ("31 days left"), and that was fixed.
- **The cron response** gains `purged` (a count only).

## 6. Tests

| Suite | Before | Now |
|---|---|---|
| API (`npm run test:api`) | 361 | **388 passing** |
| Angular (`npm run test:ci`) | 366 | **380 passing** |

The production build has no warnings.

**New API tests, `recycle-bin-routes.test.mjs` (27):**

- **Removing:**
  - removing keeps the row, refunds once, and records who and how (normal or
    full-access sign-in);
  - a pending expense is removed and restored with no money moved;
  - income is reversed, or refused when the account is short;
  - an entry already binned can't be removed again.
- **Listing:**
  - the list shows days left, expiry, receipts and paise;
  - the expense and income lists filter deleted rows;
  - kind filter and search;
  - the account is hidden without permission.
- **Restoring:**
  - an expense debits exactly once, and a second restore is refused;
  - an overdraw is refused with the amounts, or without them when balances are
    hidden;
  - an expense whose account is gone can't be restored with its payment;
  - income is credited once.
- **Splits and repayments:**
  - a removed split keeps its repayments linked and comes back whole;
  - a repayment waits for its binned split;
  - a repayment is refused when the split doesn't owe enough;
  - deleting a split for good turns its repayments into ordinary money in.
- **Deleting for good:**
  - only the binned entry goes, its receipt with it, with an audit row;
  - a live entry gets 409, a missing one 404;
  - Empty needs the confirmation and deletes only binned rows.
- **Permissions and ownership:**
  - without "Remove entries", the list is readable but the actions get 403;
  - another account's entry gets 404;
  - malformed ids and kinds get 400;
  - every route needs a session.
- **Retention:**
  - the clean-up purges only entries over 30 days, can run again, uses SKIP
    LOCKED and the database clock;
  - the days-left countdown.
- **Budgets:** spending drops on removal and returns on restore. This test
  fails if the filter is removed.

**Updated existing tests** (behaviour that deliberately changed, made
stricter, not weaker):

- **WhatsApp undo:** now checks that the entry is *marked* deleted via
  `whatsapp`, never deleted outright, and that the reply says where to restore
  it. The "refused" test also checks that nothing is marked.
- **Cron:** checks the new `purged` count, and that the clean-up runs with a
  30-day database-clock cut-off.
- **Wording:** the three tests on the remove note now expect the new sentence.

**New Angular tests (11):**

- the list shows every column and the days-left warning;
- the kind filter and search;
- the empty state;
- restore asks first, says where the money goes, restores, and asks the page
  to reload;
- a refusal stays visible and changes nothing;
- pending and repayment explanations;
- delete for good asks, warns, names the receipts and sends DELETE;
- Empty asks, counts, and sends the confirmation;
- Cancel sends nothing;
- without permission, no actions are offered;
- the page's Recently deleted tab swaps the list for the bin, disables the
  filters and dims the totals.

**End to end against the real database** (a script driving the local API, with
a temporary `@localhost.test` account deleted afterwards). All **44 checks
passed**:

- **Set-up and removing:**
  - set-up balances and budget;
  - a receipt attached;
  - removing lunch refunded HDFC, left the list and the budget, and kept the
    row with who and how;
  - the receipt stayed;
  - the bin showed 30 days and ₹250 in paise.
- **Concurrency against real Postgres:**
  - **two restores at once:** one 200, one 409, debited once;
  - **two removals at once:** one 200, one 404, refunded once;
  - **a restore racing a permanent delete:** exactly one won, and the money
    matched.
- **Income:** reversed, restored once, and a second restore refused.
- **Splits:**
  - the repayment and its split were removed;
  - the split left the open-splits list;
  - the repayment was refused until the split came back;
  - the split's received total and personal share were counted once.
- **Overdraw:** restoring a ₹1,500 taxi when Cash held ₹100 was refused, and
  nothing moved.
- **Pending:** an older expense on the normal sign-in was pending; it was
  removed and restored without money moving, and approving it later debited
  once.
- **Deleting for good:**
  - the expense row and its receipt row went;
  - **the file was removed from storage**;
  - the audit row was kept;
  - no balance moved.
- **Retention:**
  - before running it, I checked that **no real account had anything in
    Recently deleted**;
  - an entry backdated 31 days was purged, and a second run found nothing.
- **Empty:** deleted only binned entries.
- **Clean-up:** the temporary account was deleted, with nothing left.

**In the browser,** with another temporary account, also deleted:

- Recently deleted at 1260×620 (fits, no sideways scroll) in dark mode, and on
  a phone (cards);
- the restore dialog and toast, HDFC moving ₹5,000 → ₹4,100, and the panel's
  Debit total updating;
- the delete-for-good dialog.

Afterwards the database held **0** test accounts, **0** binned rows and **0**
audit rows.

**One intermittent existing test:** "the window reopens once it has passed"
(`hardening.test.mjs`) uses a 1 ms rate-limit window and fails now and then on
a busy machine. It passed in four reruns. It's unrelated to this feature and
was not changed.

## 7. Deployment

1. **Database:** migration 017 is **already applied**. If it's ever deployed to
   another database, run `npm run db:migrate` there **before** the code.
2. **When approved,** merge `feat/recycle-bin` into `main`. It contains
   Transaction Import and the side-panel layout as well.
3. **Deploy:**
   - Pushing `main` didn't deploy automatically last time. Check `vercel ls`.
   - If no new deployment appears, deploy from a clean `git archive main`
     export.
4. **No new environment variables or cron entries:** the clean-up rides the
   existing daily cron and `CRON_SECRET`.
5. **Check on the live site:**
   - `GET /api/recycle-bin` without a session answers 401, not 404;
   - signed in, remove a test entry, find it in Recently deleted, restore it,
     and check the balance;
   - remove it again and delete it for good.
