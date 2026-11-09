# Savings Goals — Feature Report

Branch `feat/savings-goals`, built on `feat/recurring`, so it includes the live
Budgets work and the Recurring work, which is approved but not yet merged.
Pushed to GitHub only: **not merged, not deployed**.

---

## 1. What was built

- **Savings Goals page** (`/goals`), opened from the **account menu** (the
  initials button), **above Settings**. The top menu was already full.
  - On a laptop (1308×652) it fits the window with no page scroll.
  - **Left column:**
    - the title and **New goal**;
    - four totals: total target, total saved (with %), active goals,
      completed goals;
    - goal cards with an icon, the target date, a progress bar, saved of
      target, the monthly amount needed and a status chip;
    - tabs: Active / Paused / Completed / All.
  - **Right column:** the chosen goal in detail:
    - saved and percentage, target date and months left;
    - "₹X a month to get there";
    - **Add money**, **Withdraw**, Pause/Resume, Mark complete/Reopen and
      Delete;
    - its **history** of additions and withdrawals, each with the total it
      left.
- **New / Edit form** (panel over the page):
  - name, optional description, target amount, target date;
  - optional **already saved**, recorded as the first history entry;
  - one of 10 optional icons;
  - a live guide to the monthly amount.
- **Add money / Withdraw** dialog:
  - amount with quick fills (this month's share, all that's left, or
    everything for a withdrawal), date and optional note;
  - a preview of the new total and percentage.
- **Status labels:** On track, Behind, Date passed, Reached, Paused, Completed.
  - **Reached** offers Mark complete but never completes by itself.
  - Saving past the target is allowed and shows "₹X over".
- **Home:** a compact **Savings goals** strip beside the WhatsApp strip. It
  shows the total saved of the total target and %, and the goal due soonest.
  With no goals it invites you to start one.
- **Settings:** a new **Manage savings goals** switch (on by default) under
  what a normal sign-in can do.
- **Phone:**
  - the totals show 2×2 and the goal cards stack;
  - choosing a goal scrolls to its details;
  - it works in light and dark themes.

## 2. Financial rules

- **Tracking only:** creating a goal, adding money or withdrawing never
  reads or writes balances, expenses, incomes, budgets or recurring schedules.
  The tests check this directly, both mocked and against the real database.
- **Whole paise:**
  - the database stores money as `bigint` paise;
  - input is converted from text straight to paise, never through a
    floating-point sum (0.10 + 0.20 is exactly 0.30, confirmed against the
    database);
  - more than two decimal places is refused.
- **Limits:**
  - target: up to ₹99,99,99,999.99;
  - one entry: up to ₹1,00,00,000;
  - the saved total can never be negative (the check runs in the code under a
    lock, and a database `CHECK` backs it up).
- **Withdrawals** can't take more than the goal holds.
- **Completed goals** take no entries until reopened. Entry dates can't be in
  the future.
- **Editing** changes the name, description, icon, target or date only. The
  saved total and history are never rewritten.
- **Deleting** asks first. It removes the goal and its history (by cascade).
  No transaction anywhere refers to a goal, so nothing else changes.
- **Every write runs in a database transaction.** Entries lock the goal row
  (`FOR UPDATE`), so concurrent requests queue.

## 3. Database migration — `server/migrations/013_savings_goals.sql`

**Additive only. Applied** to the shared Aiven database on 6 Nov 2026, with
the owner's approval. The live site's code ignores it.

| Change | Purpose |
|---|---|
| `savings_goals` | **Columns:** user, name (1–80), description (≤300), icon (one of 10), `target_paise`, `saved_paise`, `target_date`, `status`, `created_on` (India date), `completed_at`. **Checks:** target between 1 paisa and ₹99,99,99,999.99; saved between 0 and the same maximum; status is active, paused or completed. |
| `savings_goal_activity` | **One row per contribution or withdrawal:** kind, `amount_paise > 0`, `on_date`, note (≤200), and `saved_after_paise ≥ 0` (the running total it left). Never updated. |
| `user_settings.goals_user_access` (default true) | The Manage savings goals switch. |

- **Indexes:** `savings_goals (user_id, created_at)` and
  `savings_goal_activity (goal_id, on_date desc, created_at desc)`.
- **Trigger:** `updated_at` on goals.
- **Cascades:** deleting a user removes their goals and history; deleting a
  goal removes its history.

## 4. API — `/api/goals` (all need a sign-in)

| Method & path | Needs | What |
|---|---|---|
| `GET /` | sign-in | Every goal with its figures, the totals, `canManage` |
| `GET /:id/activity` | sign-in | The goal's history, newest entry first |
| `POST /` | Manage savings goals | Create (optional `initialSaved`) |
| `PUT /:id` | Manage savings goals | Edit name, description, icon, target, date |
| `POST /:id/pause` · `/resume` · `/complete` · `/reopen` | Manage savings goals | Status changes; anything else is refused with 409 |
| `DELETE /:id` | Manage savings goals | Delete the goal and its history |
| `POST /:id/contributions` · `/withdrawals` | Manage savings goals | Add or take money: `{ amount, date?, note? }` |

**Every figure is worked out on the server** from the stored paise: saved,
remaining, over, % (whole, floored), months left, the monthly amount and the
status. The browser's figures are never trusted.

**Months left:** whole months to the target date, rounded up, at least 1
(6 Nov → 31 Mar is 5); 0 once the date has passed. **Monthly amount:** what's
left ÷ months left, rounded **up** to the paisa so it's never short.

**Behind:** saved ÷ target is less than the share of time used since the goal
was created. This is compared with integers, never by dividing.

## 5. Permissions and security

- **Manage savings goals** (`goals_user_access`, on by default) is needed for
  every write.
  - The full-access sign-in can always manage goals.
  - Seeing goals needs only a sign-in; they show no balances.
- **Ownership:** every query is keyed by the session user.
  - Ids must be UUIDs, otherwise 404 without touching the database.
  - Another user's goal is 404 for every endpoint, and nothing is written.
- **Validation:** names, lengths, icon list, amounts, dates (target today or
  later; an edit may keep a date that has passed; entries no later than
  today), and status changes. SQL is parameterised throughout.

## 6. Tests

| Suite | Result |
|---|---|
| API: `npm run test:api` | **263 / 263** pass, twice (235 before; +28) |
| Angular: `npm run test:ci` | **237 / 237** pass (220 before; +17) |
| `ng build` | Clean, no budget warnings. Goals page chunk 10 kB. Initial transfer 103.6 kB (100.8 kB before; Home now loads the goals strip). |
| `npm audit --omit=dev` | 0 vulnerabilities |
| End to end against the real database | **37 / 37** checks pass. Both temporary `@localhost.test` accounts deleted; 0 left. |

**New API tests:**
- **`goals.test.mjs` (10):**
  - rupees to paise, including edge cases;
  - months left, including month ends and leap years;
  - the monthly amount rounding up;
  - every status;
  - over the target;
  - goal and entry validation;
  - keeping a passed date on edit.
- **`goals-routes.test.mjs` (18):**
  - sign-in required; server-side figures and totals;
  - 403 on all nine write endpoints without the permission; full access
    allowed;
  - create stores paise under the user, with "already saved" as the first
    entry;
  - bad input refused with nothing written;
  - another user's goal is 404 for six endpoints, with nothing written;
  - a malformed id is 404;
  - contributions lock the goal and record the total left;
  - withdrawals, including one past the total (409, nothing written) and
    exactly to zero;
  - a completed goal refuses entries; a future date is refused;
  - every status change, allowed and refused;
  - editing never touches history; deleting removes only the goal;
  - **no balance, expense, income, budget or recurring table is ever queried.**

**New Angular tests:**
- **page:** totals and order, history with running totals, tabs, no controls
  without permission, add money, delete confirmation, empty state;
- **form:** the draft, the monthly guide, validation, editing with a passed
  date;
- **dialog:** quick amounts, paise-exact preview, withdrawals past the total
  refused, future date refused;
- **Home:** the strip on both layouts, the empty state, hidden when goals
  can't load.

**Existing tests updated** (extended, not weakened):
- the Settings count, 9 → 10 rows, plus a check for "Manage savings goals";
- the Home spec answers the new `/api/goals` request.

**End to end** (local API, real Postgres):
- **Create:** "already saved" becomes the first entry.
- **Exact paise:** 0.10 + 0.20 is stored as exactly 30 paise.
- **Concurrency:**
  - **20 concurrent contributions all count**, with 20 distinct running
    totals (no lost update);
  - **10 concurrent ₹500 withdrawals from ₹2,000: exactly 4 succeed and 6 are
    refused, ending at exactly 0.**
- **Withdrawals:** past the total refused; a normal withdrawal lowers the
  total.
- **Editing:** changes the target but not the saved total or history.
- **Status rules:** pause, pause again (refused), add while paused, complete,
  add while completed (refused), reopen.
- **Past the target:** reached, ₹200 over, no monthly figure.
- **Validation:** future entry, past target date and three decimals all
  refused.
- **Restricted sign-in:** can see but not add or delete.
- **Another account:** an empty list, and 404 on history, contribute and
  delete.
- **Delete:** removes the goal's history.
- **Nothing else changed:** after all of this, the account's balances,
  expenses, incomes, budgets and recurring schedules are **byte-for-byte
  unchanged**.

**Layout**, checked in the browser:
- **1308×652, light and dark:** the Goals page fits with no page scroll, Add
  money works end to end, and Home fits with the goals strip beside WhatsApp.
- **375×812:** cards stack and nothing overflows.
- **Account menu:** "Savings Goals" sits above Settings.

**Fixed along the way:**
- A missing space ("₹7,500of ₹10,000"): Angular drops whitespace between
  elements.
- The Home strips: they were stacked, so a third strip squeezed the chart.
  They now sit side by side, each on one line, in both Home layouts.

## 7. Sample data

The test account (`test@gmail.com`) has six sample goals, added through the
API:
- Emergency fund, with five history entries including a withdrawal;
- Goa trip;
- New laptop;
- Diwali gifts;
- Bike down payment (completed);
- Wedding gift (paused).

It totals ₹2,19,600 saved of ₹3,60,000, including one ₹11,600 contribution
made while testing the dialog. Goals don't affect balances or transactions.
The data is in the shared (production) database, like the other sample data.

## 8. Deployment steps

1. **Database:** migration 013 is **already applied**. Every request reads the
   new settings column, so don't deploy this code to a database without it.
2. **No new environment variables.** (`CRON_SECRET`, for Recurring, is already
   set in Vercel production.)
3. **When approved,** merge `feat/recurring` and then `feat/savings-goals` into
   `main`, or just `feat/savings-goals`, which contains both. Pushing `main`
   deploys production automatically.
4. **Check on the live site:**
   - Account menu → Savings Goals;
   - create a goal, add and withdraw;
   - confirm Cash & Accounts balances don't change;
   - check the Home strip.
5. **Rollback:** promote the previous production deployment. The new tables
   and column can stay; the previous code ignores them.

## 9. Limitations

- **Tracking only:** a goal doesn't move money between accounts or reserve
  part of a balance. That was by design, per the brief.
- **Backdated entries:** an entry may be dated in the past, but its "saved
  after" figure is the running total at the moment it was entered. History is
  therefore listed in the order entries were made, so each running total reads
  correctly.
- **Deleting is permanent:** it removes the goal's history. There is no
  archive; Mark complete keeps a goal and its history.
- **No reminders:** there are no notifications for goals (none were
  requested).
