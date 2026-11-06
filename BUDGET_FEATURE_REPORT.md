# Monthly Budget Management — Feature Report

Branch `feat/budgets` · commits `8b7dd4a` (API) and `ecfc21a` (pages) · **not pushed,
not deployed**. Design and decisions: `BUDGET_DESIGN.md` (D1–D6 confirmed).

---

## 1. Features implemented

- **Budgets page** (`/budgets?month=YYYY-MM`, new menu item between Transactions and
  Cash & Accounts):
  - **Month navigation:** previous and next month, "This month", and any month
    reachable by URL.
  - **Overview:** spent of budget, % used with a status word (On track / Near limit /
    Reached / Over), what's left or how far over, categories over, days to go.
  - **By category:** budget, spent, left (negative when over), % used, meter and
    status, most used first. Spending in categories with no budget is listed
    underneath, so the parts add up to the total.
  - **Alerts this month:** every threshold crossed, with its date.
  - **History** (3, 6 or 12 months):
    - budget against spending for each month (months with no budget still show
      what was spent);
    - the change from the previous month;
    - total overspend across the period;
    - categories often over budget (over in at least 2 months, and in at least half
      the months they had a budget).
  - **Create and edit:** an optional overall limit, plus limits for any of the 10
    expense categories or Uncategorised. One limit per category, positive amounts
    only. Shows the total allocated, and warns (without blocking) when categories
    add up to more than the overall limit.
  - **Copy:** fills the form from the latest earlier month that has a budget. You
    can edit the amounts, and saving asks for confirmation. Spending is never copied.
  - **Remove:** clears the month's budget after confirmation. Expenses are untouched.
  - **States:** a loading skeleton, an error message with Try again, an empty month
    that invites a budget, and a view-only note for sign-ins without **Manage
    budgets**.
- **Home:** a **Budget card** at the top of the right-hand column in both layouts.
  - It shows spent of budget, %, left or over, days to go, and the top three
    categories.
  - On desktop screens under 860 px tall, the category rows are hidden so the Recent
    card keeps room to scroll.
  - With no budget it invites you to create one, with the button only when you're
    allowed. If the budget can't load, the card is hidden and the rest of Home is
    unaffected.
- **Settings:**
  - The WhatsApp card moves to the top.
  - New **Budget alerts on WhatsApp** row inside it: off by default, and changing it
    needs full access.
  - New **Manage budgets** row in the permissions: on by default.
- **Alerts:** at 50%, 80%, 100% and over, for the overall budget and for each
  category. Each threshold fires once per month and is shown as a warning toast
  after adding or approving an expense. On WhatsApp it's one extra line on the
  normal reply, only when the switch is on.
- **Help & Support:** one new question, "How do budgets count split bills and
  repayments?"

## 2. Database changes

Migration `server/migrations/011_budgets.sql`. **Additive only; already applied** to
the Aiven database (it's shared by development and production, see the audit's H5).

| Object | Purpose | Safeguards |
|---|---|---|
| `monthly_budgets` | One row per user per month: `month` (first day), `total_budget` (nullable) | `unique (user_id, month)`; `total_budget > 0`; the day must be 1; cascades on user delete |
| `category_budgets` | Category limits for a month | `unique (monthly_budget_id, category)`; `amount > 0`; cascades with its month |
| `budget_alerts` | Thresholds already announced | Primary key `(monthly_budget_id, scope, threshold)`, so each announces once; threshold must be 50, 80, 100 or 101 |
| `user_settings.budget_user_access` | "Manage budgets" | `boolean not null default true` |
| `user_settings.whatsapp_budget_alerts` | WhatsApp alert lines | `boolean not null default false` |

- Money is stored as `numeric(14,2)`, like the expenses.
- **No new index on `expenses`:** month queries use the existing
  `(user_id, spent_on)` index.
- **No existing rows were changed.**

## 3. API

New, all behind sign-in (`requireAuth`):

| Method | Path | Needs |
|---|---|---|
| GET | `/api/budgets/categories` | — |
| GET | `/api/budgets/:month` | — |
| GET | `/api/budgets/:month/previous` | — |
| GET | `/api/budgets/history?end=YYYY-MM&months=2..12` | — |
| PUT | `/api/budgets/:month` (whole month) | Manage budgets |
| PUT | `/api/budgets/:month/total` | Manage budgets |
| PUT | `/api/budgets/:month/categories/:category` | Manage budgets |
| DELETE | `/api/budgets/:month/categories/:category` | Manage budgets |
| DELETE | `/api/budgets/:month` | Manage budgets |

Changed (additive):
- `POST /api/expenses` and `POST /api/expenses/:id/approve` now also return
  `budgetAlerts`, listing the thresholds that save just crossed.
- The WhatsApp expense reply gets an alert line when "Budget alerts on WhatsApp" is
  on.
- `GET/PATCH /api/settings` include the two new flags.

## 4. Frontend

| New | Changed |
|---|---|
| `budgets/budgets.component.*` | `app.routes.ts`, `header.component.html` (route, menu item) |
| `budgets/budget-editor/*` | `home.component.ts`, `shared/dashboard.ts`, both Home layouts (load and place the card) |
| `budgets/budget-history/*` | `settings.component.*` (WhatsApp card first, two rows) |
| `home/budget-summary/*` | `settings.service.ts`, `models.ts` (flags, types) |
| `shared/budget.service.ts` (+ month helpers) | `toast.service.ts`, `toast-host.*` (a `warning` kind) |
| shared `.et-meter` / `.et-status` styles in `styles.css` | `add-expense`, `expense-list` (show alerts); `help-support` (FAQ) |

## 5. Calculation rules

All of them live in one tested module, `server/src/budget.mjs`. The SQL only selects
the month and groups by category and status.

1. **What counts:**
   - Only **approved** (`done`) expenses. Pending ones count once approved, in the
     month of their date.
   - The month is the expense's **date** (`spent_on`), not when it was entered.
2. **Split bills:** the owner's share only (`personal_share`, otherwise `amount`),
   the same as Home and Transactions.
3. **Repayments** are income and are never read. They can't lower spending or count
   as spending.
4. **No category or no account:** an expense with no category counts under
   **Uncategorised**. An expense with no account counts normally.
5. **Deletions:** deleted expenses disappear from the sum straight away. Spending is
   never stored, so every month, past ones included, is recomputed on each read.
6. **Arithmetic:**
   - Postgres sums the exact `numeric` values. Each sum becomes integer paise once,
     and every comparison after that is in whole paise.
   - **Status:** under 70% is on track, 70% to under 100% is near, 100% and over is
     red. A line shows "Reached" at exactly 100% and "Over" above it.
   - **Thresholds:** `spent × 100 ≥ budget × t` for 50, 80 and 100, and
     `spent > budget` for over.
7. **No overall limit:** the category limits together stand for the month, labelled
   "from categories", and there are no overall alerts (D5).
8. **Alert policy (D6):**
   - Each threshold is announced once per month for each scope (overall, or each
     category).
   - When one save crosses several thresholds, only the highest is shown.
   - Spending falling and rising again doesn't re-announce.
   - Changing a scope's amount re-arms it. Thresholds still reached at the new amount
     are recorded quietly; the ones not yet reached can fire again.

**Verified against the real database:** the budget's spending equals the app's own
total for the same month.

## 6. Permissions and security

- **Seeing budgets needs no switch.** Restricted sign-ins can already see spending.
  Budgets show no account balances.
- **Changing budgets** needs **Manage budgets** (default on) or full access. The API
  enforces this on every write and returns 403 otherwise; the page hides the buttons.
- **Budget alerts on WhatsApp:** saved like the other switches, so only full access
  changes it. A normal sign-in sees its state and a note saying so.
- **No ids in requests:** every query is keyed by `(session user, month[, category])`,
  so there's no other user's id to guess (no IDOR). A test checks that every budget
  and spending query passes the session user.
- **Input validation:**
  - Months must be `YYYY-MM`, from 2000 to 24 months ahead.
  - Categories must be on the list, matched case-insensitively and stored with the
    list's spelling. Duplicates are refused.
  - Amounts must be numbers above ₹0 and at most ₹99,99,99,999.99. Booleans, hex,
    exponents and sub-paisa values are refused.
- **The usual protections apply:**
  - SQL is parameterised; categories are never interpolated.
  - Session revocation, `no-store` caching, security headers and the body limit all
    apply.
  - The budget tables hold no passwords or tokens.

## 7. Tests executed (actual results)

| Suite | Result |
|---|---|
| API (`npm run test:api`) | **188 / 188** pass (was 154). New: 18 rule tests (`budget.test.mjs`), 14 route tests (`budgets-routes.test.mjs`), 2 WhatsApp alert-line tests |
| Angular (`npm run test:ci`) | **198 / 198** pass (was 170). New: helpers, Budgets page (12), editor (7), history (3), Home card (4) |
| Production build | Clean, no budget warnings. Initial bundle 97.6 kB transferred; the Budgets page loads on demand (8.2 kB) |
| End to end, local API + real database, temporary account | **26 / 26** checks plus cleanup |
| Browser, production build | Budgets: empty state, copy-edit-confirm-save, figures, statuses, unbudgeted list. Home card at 768 px and taller. Settings order and the new switches. Restricted sign-in is view-only. Dark mode at phone width with no sideways scroll. All existing pages render with no console errors |

The end-to-end checks covered:
- split share, repayment ignored, pending excluded and then counted on approval;
- delete lowers spending, duplicate category refused;
- 50% announced once, and two simultaneous saves announce 80% once;
- re-arm on raising a limit;
- the copy source, history, restricted 403, and month removal.

The temporary accounts were deleted afterwards. A read-only check confirms 0 test
accounts remain and your 2 real accounts are untouched.

**Two existing tests were updated, not weakened:**
- The settings defaults test now checks that every *permission* defaults on, and
  that the new WhatsApp alert *preference* defaults off.
- The permission matrix test now expects 8 rows instead of 7.

**Not executed:**
- WhatsApp through Meta: the handler was tested directly.
- Anything on Vercel.

## 8. Performance

- **Month view:** 3–4 small queries on unique and indexed keys; only that month's
  expenses are read.
- **History:** 2 queries for up to 12 months. No N+1.
- **Alert check:** 2–3 queries after the expense commits, so it never holds the
  account lock. If it fails, the failure is logged and the save still succeeds.
- **Home:** one extra request, made in parallel with the existing ones.
- **No polling, background jobs or new dependencies.**

## 9. Known limitations

- The Budgets page is behind sign-in like everything else, but a restricted sign-in
  can see budgets. That's intended (D1), because spending is already visible to it.
- The Home card hides its category rows on desktop screens under 860 px tall; the
  Budgets page always shows them.
- Alerts are only checked when spending goes up (add or approve). Lowering a budget
  below what's already spent doesn't announce anything; the page simply shows red.
- Only expenses are budgeted; income targets aren't part of this feature.
- The development database is still the production one (audit H5). The end-to-end
  tests used their own temporary accounts.

## 10. Deployment and migration

1. Migration 011 is **already applied** to the database. If a different database is
   ever used, run `npm run db:migrate` **before** deploying this code: the new code
   reads the two new settings columns on every request.
2. Push `feat/budgets` and check the Vercel preview. Preview API calls need the
   environment variables set for Preview; see the audit report.
3. Merge into `main` and deploy, with your approval. Pushing `main` deploys
   production automatically.
4. After deploying:
   - Open **Budgets**, create a budget, and check that the Home card shows it.
   - With **Budget alerts on WhatsApp** on, send an expense that crosses 50% and check
     the reply has one alert line.
5. **Rollback:** promote the previous production deployment in Vercel. The new tables
   are ignored by the older code, so there's nothing to undo in the database.
