# Recurring Transactions — Feature Report

Branch `feat/recurring`, from `main` at `23c8c28`, which already includes Budgets.
Not committed, pushed, merged or deployed.

---

## 1. Features implemented

- **Recurring page** (`/recurring`), in the menu between Budgets and Cash &
  Accounts. On a laptop (1308×652) it fits the window with no page scroll; on a
  phone the rows become cards. The title, **New recurring** button, summary
  strip and table make the left column; the right column has Needs attention,
  Coming up and Recent runs from the top.
  - **Summary strip:** active schedules, due in the next 7 days, needs
    attention, and roughly how much goes out and comes in each month.
  - **Schedules table:**
    - columns: description, Debit/Credit, amount, repeats, next date, account
      and status (Active / Paused / Ended / Needs attention);
    - actions: edit, pause/resume and delete;
    - tabs: All / Debit / Credit / Paused & ended.
  - **Needs attention:** occurrences that could not be added, with **Try
    again** and **Skip this one**.
  - **Coming up · next 7 days**, with each schedule's reminder.
  - **Recent runs:** recent occurrences, whether added, not added or skipped.
- **New / Edit form**, in a panel over the page:
  - Fields:
    - Expense/Income;
    - description, amount, category;
    - account ("No account" is allowed for an expense);
    - Daily / Weekly / Monthly / Yearly / Custom (every N days, weeks, months
      or years);
    - start date (next date when editing);
    - optional end date;
    - reminder (off, on the day, or 1, 3 or 7 days before).
  - A **next dates preview** shows what happens at month ends.
  - Edit adds an Active switch, a short history and Delete.
  - Deleting asks first and says the entries stay.
- **Statuses:** active, paused and completed. A schedule completes by itself
  after its end date.
- **Menu count:** a number on "Recurring" shows how many occurrences need
  attention.
- **Settings:**
  - **Manage recurring** (on by default) under what a normal sign-in can do;
  - **Recurring reminders on WhatsApp** (off by default) in the WhatsApp card.
- **Reminders:**
  - **In the app:** opening any page adds what has come due. A toast reports
    what was added, anything that needs attention, and reminders whose window
    is open.
  - **On WhatsApp,** only when switched on: one line on the reply to an expense
    or income message, given once per due date. It is never a separate
    message.

## 2. Database migration — `server/migrations/012_recurring.sql`

**Additive only. Applied** to the shared Aiven database on 6 Nov 2026, with
the owner's approval. The live site's code ignores everything it adds.

| Change | Purpose |
|---|---|
| `recurring_schedules` | One row per schedule. Checks: kind, frequency, `interval_count` 1–99, `amount > 0`, `end_on >= start_on`, `remind_days` in (0,1,3,7), status; an active schedule must have a next date; income must use an account. |
| `recurring_runs` | One row per occurrence (due date); its `id` is the occurrence identifier. **Unique `(schedule_id, due_on)`.** Holds a copy of the entry's details, the status (posted/failed/skipped), the number of attempts, the last error and the last attempt date. |
| `expenses.recurring_run_id`, `incomes.recurring_run_id` | Nullable link to the occurrence. **Partial unique index** on each table, so the database itself refuses a second entry for an occurrence. `on delete set null`. |
| `user_settings.recurring_user_access` (default true), `user_settings.whatsapp_recurring_reminders` (default false) | The two switches. |

**Indexes:**
- partial `(next_due_on) where status = 'active'`, used by the runner;
- `(user_id, created_at)` on schedules;
- `(user_id) where status = 'failed'` and `(user_id, due_on desc)` on runs.

**Cascades:**
- deleting a user removes their schedules and runs;
- deleting a schedule removes its runs, and the entries' link is set to null.
  **The entries themselves stay.**

## 3. API changes — `/api/recurring`

| Method & path | Who | What |
|---|---|---|
| `GET /` | signed in | Schedules, upcoming (7 days), overdue, recent runs, summary, `canManage` |
| `GET /upcoming?days=0..60` | signed in | Upcoming and overdue only |
| `GET /runs` · `GET /:id/runs` | signed in | Occurrence history (all, or one schedule's) |
| `POST /sync` | signed in | Adds this account's due occurrences now; returns what was added or failed, open reminders and budget alerts |
| `POST /` · `PUT /:id` | Manage recurring | Create; edit (applies from the next date) |
| `POST /:id/pause` · `POST /:id/resume` | Manage recurring | Pause; resume from the first date on or after today |
| `DELETE /:id` | Manage recurring | Delete the schedule; entries stay |
| `POST /runs/:runId/retry` · `POST /runs/:runId/skip` | Manage recurring | Retry or skip a failed occurrence |
| `GET /cron` | `Authorization: Bearer CRON_SECRET` | The daily job; returns counts only |

**Changes outside the new route:**
- **Expenses:** the expense insert was moved out of `routes/expenses.mjs` into
  `insertExpense()` in `expense-store.mjs`. The SQL and the rules are the same,
  plus the new nullable `recurring_run_id`. Add Expense and the recurring
  runner now share it.
- **Income:** `addIncome()` now calls a new `insertIncome(client, …)`, so the
  runner can use it inside its own transaction.
- **WhatsApp:** the reminder line is added to the expense and income replies
  in `routes/whatsapp.mjs`.
- **Header:**
  - The account button shows the person's initials instead of a person icon:
    "T" for Test, "PM" for Prajwal M (`shared/initials.ts`).
  - With nine menu items, the links fold into the ☰ menu below 1100px (it was
    860px), so they never wrap onto a second row.
- **Vercel:** `vercel.json` sets `git.deploymentEnabled` to `{ "feat/*": false }`.
  Pushing a `feat/…` branch no longer builds a preview. Nothing reaches Vercel
  until a change is merged into `main`, as the owner asked.

## 4. Scheduling mechanism and configuration

The hosting is Vercel serverless (Express in `api/index.mjs`, region `sin1`).
Nothing stays running between requests, so there are no timers or
`setInterval`. Two things trigger runs, and both call the same idempotent
`runDue()`:

1. **A Vercel Cron Job**, added to `vercel.json`:
   `{ "path": "/api/recurring/cron", "schedule": "35 18 * * *" }`. That is
   18:35 UTC, which is **00:05 India time** daily.
   - The endpoint needs `Authorization: Bearer <CRON_SECRET>`. Without
     `CRON_SECRET` it stays closed (401), and the comparison is timing-safe.
   - It stops starting new work after 240 s, inside the 300 s function limit.
     Anything left is picked up next time.
   - On the Hobby plan, a cron job runs at most once a day and may fire at any
     point within its hour. That is fine here.
2. **Catch-up on use:**
   - The first signed-in page of a visit calls `POST /api/recurring/sync`, and
     so does opening the Recurring page.
   - It adds what has come due for that account only.
   - So entries appear on their day even if the cron run is late or missed.

**Dates:**
- Every date is a calendar date in **Asia/Kolkata** (`todayInIndia()`).
- Months and years are counted from an **anchor**, never from the previous
  date. A schedule on the 31st falls on 28/29 February and returns to the
  31st in March; one on 29 February falls on 28 February in other years.
- Editing the timing re-anchors the schedule on the new next date.

**Nothing is created in advance:** an occurrence is only written once its date
is today or earlier.

## 5. Idempotency and failure handling

Each occurrence is added in **one database transaction**:

1. `SELECT … FOR UPDATE SKIP LOCKED` on the schedule. A second runner at the
   same moment skips it instead of repeating it.
2. Re-check that it is active and its date has come.
3. `INSERT` the occurrence into `recurring_runs`, `ON CONFLICT (schedule_id,
   due_on) DO NOTHING`.
4. `SAVEPOINT`, then add the expense or income through the **shared insert**,
   linked by `recurring_run_id`, which is unique.
5. Move the schedule to its next date, or mark it completed.

**What happens when something goes wrong:**
- **Refused (insufficient balance, or the account was deleted):**
  - it is rolled back to the savepoint, so **no money moves and no entry is
    written**;
  - the occurrence is kept as **failed** with the reason;
  - the schedule still moves on.
- **Unexpected error (database lost):** the whole transaction rolls back, and
  the same date is tried again on the next run.
- **Retries:**
  - **automatic,** once a day, up to 3 attempts in all (runs tried before
    today with `attempts < 3`);
  - **manual,** from Try again, at any time;
  - a retry uses the details recorded with the occurrence, and the date it was
    due.
- **Skip** marks the occurrence skipped; nothing is added.
- **Catch-up:** one pass adds at most 31 missed dates per schedule, each dated
  its own due date, oldest first.
- **Pause / resume:** while a schedule is paused nothing is added. Resuming
  carries on from the first date on or after today; dates missed while paused
  are not added.

**Never twice.** These protections stack:
- the row lock with SKIP LOCKED;
- the schedule moving on in the same transaction;
- the unique `(schedule_id, due_on)`;
- the unique `recurring_run_id` on expenses and incomes;
- for retries, a `FOR UPDATE` lock on the occurrence and a check that it is
  still `failed`.

## 6. Financial integrity and security

- **Same rules as one-off entries:**
  - Expenses go through `insertExpense`: the account row is locked, the
    sufficient-funds check runs, and the debit is made in the same
    transaction. **Negative-balance protection is not bypassed.**
  - Income goes through `insertIncome`, which credits its account.
- **Money:**
  - amounts are `numeric(14,2)`;
  - input goes through the app's `parseAmount`: above ₹0, at most ₹1,00,000,
    rounded to paise;
  - monthly figures are worked out in whole paise.
- **Approval rules:**
  - an occurrence is added as settled on its due date;
  - starting a schedule in the past needs **"Change transaction dates"**
    (otherwise 403), so a schedule cannot be used to backdate entries.
- **Permissions:**
  - **Manage recurring** is needed to create, edit, pause, resume, delete,
    retry or skip;
  - an expense that uses an account also needs the balance permission;
  - income needs Add Income and the balance permission, as on the website;
  - seeing schedules needs only a sign-in: they show amounts and account
    names, never balances;
  - the full-access sign-in can always manage schedules.
- **Isolation (no IDOR):**
  - every query is keyed by the session's user;
  - ids must be UUIDs, otherwise 404 without touching the database;
  - another user's schedule or run gives 404;
  - another user's account gives 400.
- **Validation:**
  - kind, description (1–200), amount, category (from the expense or income
    list), frequency, interval 1–99, dates (no more than two years ahead), an
    end date on or after the first date, and the reminder choice;
  - all SQL is parameterised.
- **Split bills and repayments** cannot be scheduled.
- **History is never rewritten:**
  - editing changes only the schedule;
  - pausing or deleting never deletes or changes an expense, income or
    balance.
- **Budgets:** after an expense occurrence commits, budget alerts are checked,
  outside any account lock.
- **WhatsApp:** reminders are opt-in, a line on a reply that was being sent
  anyway, and never a separate message. Nothing was changed in Meta.

## 7. Test results

| Suite | Result |
|---|---|
| API: `npm run test:api` | **235 / 235** pass, three runs in a row (188 before; +47 new) |
| Angular: `npm run test:ci` | **217 / 217** pass (198 before; +19 new) |
| Production build: `ng build` | Clean, no budget warnings. Initial transfer 100.8 kB (98.6 kB before; the header now runs the catch-up). Recurring page chunk 10.7 kB. |
| `npm audit --omit=dev` | 0 vulnerabilities |
| End to end against the real database | **42 / 42** checks pass. Both temporary `@localhost.test` accounts deleted; 0 left. |

**New tests:**
- **`server/test/recurring.test.mjs` (22):**
  - daily, every 3 days, weekly, fortnightly, monthly, every 3 months and
    yearly;
  - the 31st and 30th across short months; 29 February in leap and other
    years;
  - first date on or after a day, for every frequency;
  - end dates and completion;
  - the reminder window and line;
  - monthly figures in whole paise;
  - the **IST day boundary** (18:29:59Z vs 18:30Z, and year end);
  - validation, including backdating.
- **`server/test/recurring-routes.test.mjs` (25):**
  - sign-in required;
  - the cron secret (missing or wrong gives 401 and runs nothing);
  - Manage recurring off gives 403 on all seven write endpoints;
  - full access always allowed;
  - money-permission rules;
  - restricted backdating refused;
  - another user's account or schedule gives 400 or 404 and nothing changes;
  - editing and deleting never touch expenses, incomes or balances;
  - the runner:
    - posts with a debit, dated its due date, and linked;
    - insufficient balance rolls back to the savepoint, nothing is debited,
      the run is marked failed and the schedule moves on;
    - a locked schedule is skipped;
    - an already-recorded occurrence is not added again;
    - paused, completed or not-due schedules add nothing;
    - income credits its account;
    - a deleted account fails visibly;
    - a retry posts with the recorded details;
    - the automatic retry limit;
  - sync is scoped to the user.
- **Angular (19):**
  - the date helpers match the server's;
  - the page syncs before loading, shows Needs attention, filters by tab,
    hides controls without permission, pauses, and asks before deleting;
  - the editor sends `startOn` or `nextDueOn`, handles custom intervals,
    refuses a past date and a bad amount, previews month ends, and keeps the
    kind when editing.
- **Existing tests updated** (extended, not weakened): the settings count went
  from 8 to 9 rows and now also checks "Manage recurring"; the defaults test
  now also expects the new WhatsApp preference to start off.

**End-to-end checks** (real Postgres, local API):
- **Basics:**
  - nothing is created in advance;
  - a schedule due today is added once, and a second sync adds nothing;
  - the entry is dated today, settled and linked.
- **Duplicates and concurrency:**
  - **8 concurrent runs (6 HTTP syncs + 2 direct runners) post exactly once**,
    and the balance moves once;
  - **the unique index refuses** a hand-inserted second entry for the same
    occurrence.
- **Failure and retry:**
  - with the account short: failed, balance untouched, schedule moved on;
  - retry while still short: still failed;
  - after a top-up the retry posts and debits; it cannot be retried again;
  - attempts tracked (3).
- **Income** is credited to its account.
- **Editing:** the amount changes and the entry already added keeps its
  ₹15,000.
- **Pause / resume:** resume carries on from today or later.
- **Deleting:** the schedule's expense stays, with its link cleared.
- **Catch-up:** three days of missed dates plus today, each dated its own day,
  in order.
- **Dates:** 31 Jan → 28 Feb → 31 Mar; 29 Feb → 28 Feb.
- **Restricted sign-in:** can see but not create or delete; cannot backdate.
- **Another account:** gets 404 on runs, delete and retry; its list is empty;
  using the first account's bank is refused.

**Layout**, checked in the browser:
- **1308×652:** no page scroll, no sideways table scroll, all actions visible,
  no console errors. The form opens below the header and scrolls inside.
- **375×812:** no horizontal overflow; rows show as cards.
- Creating a schedule through the form works.

**Not caused by this feature:** the intermittent API failure from the
Budgets review is now identified. It is `hardening.test.mjs` › "the window
reopens once it has passed", which uses a 1 ms window. A separate fix was
suggested and is running in its own session.

## 8. Deployment instructions

1. **Database:** migration 012 is **already applied** to the shared database.
   No migration step is needed at deploy.
   - Don't deploy this code to a database without it: every request reads the
     two new settings columns.
2. **Add `CRON_SECRET`** to Vercel → Settings → Environment Variables →
   **Production**:
   - a random value of 16 or more characters, e.g. from
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;
   - Vercel sends it to the cron job automatically;
   - **this needs your approval**; it has not been done.
3. **Merge** `feat/recurring` into `main` and push. Vercel deploys production
   automatically and registers the cron job from `vercel.json`. Cron jobs run
   only on production deployments.
4. **Check after deploying:**
   - `GET /api/recurring/cron` without the header gives **401**;
   - in the Vercel dashboard → Cron Jobs, run it once by hand and check the
     log line `[recurring] YYYY-MM-DD: N added, M failed`;
   - on the live site, open Recurring, create a schedule for today and confirm
     it is added and the balance changes.
5. **Rollback:** promote the previous production deployment. The new tables
   and columns can stay; the previous code ignores them.

## 9. Remaining limitations

- **Timing:**
  - On the Hobby plan the daily job runs once, at some point between 00:00
    and 00:59 India time.
  - Before it runs, an entry due today is added when the app is opened.
  - Entries never appear early.
- **WhatsApp:**
  - reminders are lines on replies, so someone who doesn't message the bot
    gets no WhatsApp reminder;
  - a separate reminder message would need Meta-approved templates and a Meta
    configuration change, which were not done.
- **No notification centre:** the in-app reminders are toasts, the menu count
  and the Recurring page.
- **Not supported:** split bills and repayments.
- **Pending approval:** schedules are pre-approved by whoever set them up. A
  schedule whose entries should wait for approval is not supported.
- **Catch-up limit:** a backlog longer than 31 dates for one schedule (a daily
  schedule started months back) is added over several runs.
- **Sample data:** `test@gmail.com` now has 9 schedules:
  - 7 active, 1 paused (Netflix) and 1 ending in April (Laptop EMI);
  - Milk was added for today (₹60, HDFC Bank);
  - Car insurance is under Needs attention because Paytm is short.

  This data is in the shared (production) database, like the earlier sample
  data.
