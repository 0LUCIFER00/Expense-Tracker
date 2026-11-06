# Monthly Budget Management — Phase 1 Analysis and Design

Status: **decisions D1–D6 confirmed as recommended.** Home and Settings designs
(§7a, §7b) are open for UI edits before implementation starts. No budget code has
been written yet.

---

## 1. What exists today (findings)

| Area | What the code does now | Consequence for budgets |
|---|---|---|
| **Spending rule** | `totalOf` / `byCategory` (client, `expense.service.ts`) and WhatsApp `today` count only `status = 'done'` expenses, using `personal_share ?? amount`. Repayments live in `incomes` and never touch spending | Budgets use **exactly this rule**, computed on the server. The client totals and budget totals must agree, and a test checks it |
| **Month** | Home assigns an expense to a month by its date (`spent_on`), not when it was entered | Same here. `spent_on` is a `date` column, so time zones can't shift an entry across months |
| **Categories** | A fixed list in `server/src/categories.mjs`: Food & Drink, Groceries, Travel, Shopping, Bills & Utilities, Health, Entertainment, Education, Family & Gifts, Other. Stored as text on `expenses.category`; `null` shows as "Uncategorised". There is no categories table | Category budgets key on the same names, validated against the same list. No second category system |
| **Pending** | Past or future dates without "Change transaction dates" are `pending` and move no money until approved | Pending expenses are excluded until approved, then counted in their own month |
| **Editing** | Expenses can be **added, approved and deleted**; there is no edit | Budgets update on add, approve and delete. "Editing" in the request maps to delete-and-re-add |
| **Notifications** | None stored. In-app toasts (`success` / `error` only), and WhatsApp replies to messages the user sends | Alerts need a small table for "already alerted", a new `warning` toast kind, and an optional line on WhatsApp replies (never a separate message) |
| **Permissions** | Seven switches for a normal sign-in. Spending (expense amounts) is visible to every sign-in; only **balances** are hidden by "See account balances" | Budgets show spending, not balances, so viewing needs no new rule. **Changing** budgets has no matching switch (◆ D1) |
| **Charts** | No chart library; the 14-day chart and category bars are plain CSS | Budget charts are CSS bars too. No new dependency |
| **Index** | `expenses (user_id, spent_on desc)` exists and has been unused | It serves the per-month query exactly, so no new index on `expenses` |
| **Stack** | The request says Angular 19; the app is now **Angular 21** (`@if`/`@for`) | New components use Angular 21 syntax |

### Conflicts and gaps in the request

1. **Colour bands and alert points don't line up.** Colours turn orange at 70%, but
   the first warning alert is at 80% (with a 50% info alert before it).
   ◆ **D2:** keep both as specified. The colour shows the current state; alerts are
   one-off events. (Alternative: move orange to 80% so they match.)
2. **Expenses with no category.** "Other" is a real category and is budgeted like
   any other; expenses saved with no category at all show as "Uncategorised".
   ◆ **D3:** allow a budget for **Uncategorised** too, so every rupee can be
   budgeted. *(The first version of this document said "Other" did not exist;
   that was wrong and is corrected here.)*
3. **"Respect existing notification preferences":** there are none for alerts, so a
   new switch is needed for WhatsApp (◆ D4).
4. **No overall budget but category budgets set:** the request allows this but
   doesn't say what "Monthly Budget" shows then. ◆ **D5:** show the sum of the
   category budgets, labelled "from categories". Overall alerts fire only when an
   overall budget is set.

---

## 2. Calculation rules (server side, integer paise)

For one user and one month `[first day, first day of next month)`:

```
spent(scope) = Σ over expenses where
                 user_id = me
             and spent_on in the month
             and status  = 'done'                 -- pending excluded, approved included
             and (scope = overall  or  category = scope, null → 'Uncategorised')
             of personal_share ?? amount          -- split: my share only
```

- **Repayments are never read.** Budgets don't query `incomes`, so repayments can't
  reduce spending or count as income.
- **Deleted** expenses are gone from the table, so they drop out automatically.
- **No account** doesn't matter: accounts aren't part of the rule.
- **Future-dated:** an approved (or permitted) future-dated expense counts in *its*
  month, so future-month budgets show it.
- **Arithmetic:** Postgres sums the `numeric` values exactly. Each sum becomes
  integer paise once, and every later comparison is integer arithmetic:
  - Status: `spent·100 ≥ budget·70` is orange, `≥ budget·100` is red.
  - The percentage is display only, rounded to 2 places (`61.67%`).
- **Consistency:** overall spent = Σ category spent + uncategorised. Asserted in a
  test and on every response in development.
- **Not budgeted:** spending in a category with no budget is listed as "Not
  budgeted", so the parts always add up to the total.
- **History** is always recomputed from the expenses, never stored. Deleting a March
  expense in June corrects March's history at once.

The rule lives in one pure function, `summariseSpending(rows)`. SQL only selects the
month and groups by `(month, category, status)`; the function applies the status
rule and the paise conversion. That keeps the rule unit-testable and identical for
the month view, the history and alerts.

---

## 3. Database (migration `011_budgets.sql`, additive only)

```sql
create table monthly_budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid          not null references users (id) on delete cascade,
  month        date          not null check (extract(day from month) = 1),
  total_budget numeric(14,2) check (total_budget > 0),    -- null: categories only
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now(),
  unique (user_id, month)                                 -- one budget a month
);

create table category_budgets (
  id                uuid primary key default gen_random_uuid(),
  monthly_budget_id uuid          not null references monthly_budgets (id) on delete cascade,
  category          text          not null,               -- a name from CATEGORIES, or 'Uncategorised'
  amount            numeric(14,2) not null check (amount > 0),
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now(),
  unique (monthly_budget_id, category)                    -- no duplicate category in a month
);

create table budget_alerts (                              -- "already alerted", nothing else
  monthly_budget_id uuid        not null references monthly_budgets (id) on delete cascade,
  scope             text        not null,                 -- 'overall' or a category name
  threshold         smallint    not null check (threshold in (50, 80, 100, 101)),  -- 101 = over
  spent             numeric(14,2) not null,               -- what triggered it, for the alert list
  created_at        timestamptz not null default now(),
  primary key (monthly_budget_id, scope, threshold)
);

-- updated_at triggers, reusing the existing set_updated_at() function
```

- The unique `(user_id, month)` also serves every month lookup and history range.
- `category_budgets` is always reached through its month row, which is already
  scoped by `user_id`.
- Money is `numeric(14,2)`, the same as `expenses.amount`.
- Deleting an account cascades through all three tables.
- **Plus, if D1 and D4 are approved:** two columns on `user_settings` (with
  defaults), as in migration 006:
  ```sql
  add column budget_user_access   boolean not null default true,   -- may change budgets
  add column whatsapp_budget_alerts boolean not null default false -- see D4
  ```

The migration only creates new tables and adds defaulted columns. It changes no
existing data and is safe on the live database. It would be applied only after you
approve this design.

---

## 4. API (`/api/budgets`, behind `requireAuth`)

| Method | Path | Does | Permission |
|---|---|---|---|
| GET | `/api/budgets/:month` | The month view: budget, spending per category, statuses, unbudgeted spending, this month's alerts | any sign-in |
| PUT | `/api/budgets/:month` | Create or replace the month in **one transaction**: `{ total: number\|null, categories: [{ category, amount }] }`. Categories left out are removed | Manage budgets |
| PUT | `/api/budgets/:month/total` | Set or clear the overall amount | Manage budgets |
| PUT | `/api/budgets/:month/categories/:category` | Add or change one category | Manage budgets |
| DELETE | `/api/budgets/:month/categories/:category` | Remove one category | Manage budgets |
| DELETE | `/api/budgets/:month` | Remove the whole month's budget | Manage budgets |
| GET | `/api/budgets/:month/previous` | The most recent **earlier** month that has a budget, for copying (amounts only, no spending) | any sign-in |
| GET | `/api/budgets/history?end=YYYY-MM&months=6` | Month summaries, the category × month matrix, the categories most often over budget, and comparison with the previous month | any sign-in |

- `:month` is `YYYY-MM`, validated, from 2000-01 to 24 months ahead. A category must
  be in the list (or "Uncategorised"). Amounts use the same `parseAmount` as
  expenses, but up to ₹99,99,99,999.99: a month's budget can exceed one expense's
  ₹1,00,000 cap.
- **No ids in URLs.** Every row is found by `(session user, month, category)`, so
  there's no other user's id to guess (no IDOR).
- **Copy** is a read plus a normal save: the page fetches `/previous`, fills the
  form, you edit it, confirm, and it's saved with `PUT /:month`. Nothing is copied
  until you confirm, and spending is never copied.
- Any change to an amount **re-arms** that scope's alerts for thresholds it's now
  under (§6).
- **Spending in responses is always computed on the server.** The client never sends
  spending.
- **Queries:**
  - GET month: 2 queries (budget with categories; spending grouped by category and
    status) plus 1 for alerts.
  - History: 2 queries for the whole range.
  - No N+1, and no transaction outside the requested month(s) is read.

### Hooks into existing endpoints (additive)

- `POST /api/expenses` and `POST /api/expenses/:id/approve`: after the commit, run the
  alert check for that expense's month. Return any **new** alerts as `budgetAlerts`
  (the field is ignored by older clients).
- WhatsApp expense handler: the same check. If D4 is on, add one line to the
  confirmation reply already being sent.
- Deleting an expense needs nothing: totals are computed when read.

---

## 5. Permissions and security

| Who | View budgets | Change budgets | WhatsApp alert lines |
|---|---|---|---|
| Full-access sign-in | ✓ | ✓ | per D4 setting |
| Normal sign-in | ✓ (spending is already visible to it) | only if **Manage budgets** is on (◆ D1, default on) | per D4 setting |

- **◆ D1:** a new switch, **"Manage budgets"**, in Settings beside the other six. It
  follows the existing pattern: default on, changeable only with full access. This
  is the smallest change that lets a restricted sign-in see budgets without
  changing them. (Alternative: no new switch, so any sign-in can change budgets.)
- Budgets reveal **no account balances**, so "See account balances" doesn't gate them.
- Everything else is the existing pattern:
  - Ownership on every query (`user_id = session`).
  - Parameterised SQL; category names validated against the list, never interpolated.
  - The existing cookie session with revocation, `no-store` caching, body limit,
    security headers and rate limits on password endpoints.
  - Budget endpoints take no password, so no new rate limit is needed.

---

## 6. Alerts

**Thresholds:**
- 50% — info, "half used"
- 80% — warning
- 100% — "budget reached"
- over 100% — "over budget"

They apply to the overall budget (if set) and to each category budget.

**When checked:** after an expense is added (website or WhatsApp) or approved. Those
are the only moments spending goes up. The check costs one aggregate query for that
month, and an insert of each newly crossed threshold into `budget_alerts`
(`on conflict do nothing returning`). So two expenses arriving together can't both
alert the same threshold: the primary key decides.

**Policy (◆ D6):**
- Each threshold alerts **once per month per scope** (overall, or each category).
- If spending falls (an expense is deleted) and rises again, it **doesn't**
  re-alert. That stops delete-and-re-add from repeating alerts.
- Changing a budget amount **re-arms** the thresholds that scope is now under, so
  raising Travel from ₹3,000 to ₹5,000 lets 80% alert again at the new level.
- A new month starts clean, because its budget row is new.

**Where alerts appear:**
1. **Website:** a warning toast after saving the expense, e.g. "Travel is at 82% of
   its budget — ₹540 left."
2. **Budgets page and Home:** an "Alerts this month" list read from `budget_alerts`.
   This is the record.
3. **WhatsApp (◆ D4):** one extra line on the reply the user's own message already
   gets, e.g. `⚠️ Travel 82% of budget — ₹540 left of ₹3,000`. It's controlled by a
   new **"Budget alerts on WhatsApp"** switch, **default off**. Unprompted WhatsApp
   messages are never sent: they would be billable, and the app has nothing that
   sends unprompted messages today.

---

## 7. Screens

### Navigation

`Home · Add Expense · Add Income · Transactions · **Budgets** · Cash & Accounts`, plus
`/budgets?month=2026-11`. On phones, "Budgets" sits in the existing hamburger menu.

### Budgets page (`/budgets`)

```
┌───────────────────────────────────────────────────────────────────────┐
│  Budgets                          ‹  November 2026  ›   [This month]  │
├───────────────────────────────────────────────────────────────────────┤
│  OVERVIEW CARD                                                        │
│  ₹18,500 spent of ₹30,000                         61.67% used         │
│  [██████████████████████████░░░░░░░░░░░░░░░░] green/orange/red        │
│  ₹11,500 left · 1 category over budget · 24 days to go                │
│                                     [Edit budget] [Copy from October] │
├───────────────────────────────────────────────────────────────────────┤
│  BY CATEGORY                                    allocated ₹17,000     │
│  Category       Budget    Spent    Left      Used                      │
│  Travel         ₹3,000    ₹3,500   −₹500  ▕██████████▏117%  Over      │
│  Food & Drink   ₹5,000    ₹3,200   ₹1,800 ▕██████░░░░▏ 64%  On track  │
│  Shopping       ₹4,000    ₹2,000   ₹2,000 ▕█████░░░░░▏ 50%  On track  │
│  Not budgeted: Health ₹600, Uncategorised ₹250                        │
├───────────────────────────────────────────────────────────────────────┤
│  ALERTS THIS MONTH          Travel over budget · 3 Nov                │
│                             Overall 50% used · 12 Nov                 │
├───────────────────────────────────────────────────────────────────────┤
│  HISTORY   [3] [6] [12] months                                        │
│  Jun ▕▓▓▓▓▓▓▓░░▏ ₹22k / ₹30k  73%                                      │
│  Jul ▕▓▓▓▓▓▓▓▓▓▓▓▏ ₹33k / ₹30k 110%  over ₹3,000                       │
│  …    vs last month: ₹1,200 less spent                                │
│  Often over budget: Travel (4 of 6 months), Shopping (2 of 5)         │
└───────────────────────────────────────────────────────────────────────┘
```

- **Phone:** the category table becomes labelled cards (the same pattern as
  Transactions), and the month selector goes full width.
- **Status colour** always comes with a word (On track / Near limit / Over), so it
  isn't conveyed by colour alone. Both themes use the existing `--good`, `--warn`
  and `--bad` tokens.
- **Empty month:** "No budget for November yet." with **Create budget**, and **Copy
  from October** when an earlier budget exists.
- **States:** a skeleton while loading, an error card with Retry, and buttons
  disabled while saving.

### Edit budget (inline panel on the same page)

```
Overall budget   [ ₹ 30,000 ]   (optional)
Categories                                   Allocated ₹17,000 of ₹30,000
  Travel        [ ₹ 3,000 ]  [Remove]
  Food & Drink  [ ₹ 5,000 ]  [Remove]
  [+ Add category ▾]   (only categories not yet budgeted)
  ⚠ Categories add up to more than the overall budget   (warning, not blocked)
[Cancel]                                          [Save budget]
```

- **Remove** and **Delete this month's budget** each ask for confirmation.
- **Copy from October** fills this panel with October's amounts, marked "Copied —
  check before saving". Saving asks "Save November's budget from October's amounts?"
- Validation messages follow the existing forms (positive amount, no duplicate
  category).

### Home: Budget card (both Home layouts)

```
Budget · November                         [See budgets]
₹18,500 of ₹30,000   ▕██████████████░░░░░░▏ 62%
₹11,500 left
Travel 117% · Food & Drink 64% · Shopping 50%     ← top 3 by usage
```

The empty state reads "Set a monthly budget to see how you're tracking." with
**Create budget**. It's its own component with its own styles, because the Home
layout stylesheets are near their 8 kB limit. Nothing else on Home changes.

### 7a. Home page (full)

Everything stays where it is today; the only addition is the **Budget card** at the
top of the right-hand column.

```
┌ Header: Home · Add Expense · Add Income · Transactions · Budgets · Cash & Accounts ┐
├ Account tiles (only when balances may be seen)                                     ┤
│  [HDFC Bank ₹58,909]  [Personal ₹2,000]                                            │
├──────────────────────────────────────────┬─────────────────────────────────────────┤
│ FOCUS CARD (unchanged)                   │ BUDGET CARD                       (new) │
│  Friday, 6 November                      │  Budget · November      See budgets ›   │
│  ₹18,500 spent in November               │  ₹18,500 of ₹30,000              62%    │
│  ₹1,200 less than October  [+ Add exp.]  │  ▕████████████░░░░░░░▏                  │
│  Last 14 days  ▁▃▁▅▂ ▄▂▇▁▃▄▃█            │  ₹11,500 left · 24 days to go           │
│  Held · Daily avg · Entries · On pace    │  Travel   ▕██████████▏ 117%             │
│                                          │  Shopping ▕███████░░░▏  75%             │
│                                          │  Food     ▕██████░░░░▏  64%             │
│                                          ├─────────────────────────────────────────┤
│                                          │ SPENDING BY CATEGORY (unchanged)        │
│                                          ├─────────────────────────────────────────┤
│                                          │ RECENT (unchanged; scrolls)             │
├──────────────────────────────────────────┴─────────────────────────────────────────┤
│ Strips (unchanged): waiting for approval · Connect WhatsApp                        │
└────────────────────────────────────────────────────────────────────────────────────┘
```

| Detail | Behaviour |
|---|---|
| Placement | First card in the right column, in **both** Home layouts (with and without balances). On a phone (one column) it sits directly under the focus card |
| Figures | Spent of budget, %, left (or "₹X over"), days to go in the month |
| Top three | The three budgeted categories with the highest % used, each with a bar and % |
| Colours | Green under 70%, orange 70–99%, red 100%+, always with the % in text |
| No overall budget (D5) | "₹X of ₹Y from categories" |
| No budget this month | "Set a monthly limit to see how your spending is tracking." + **Create budget** (or "Copy from October" when one exists). A sign-in without Manage budgets gets the text without the button |
| Over budget | Red bar, "₹2,400 over · 3 categories over" |
| Loading / error | The card waits with the rest of Home; if only the budget request fails, the card hides rather than breaking Home |
| Links | Card title and "See budgets" open `/budgets` for the current month |
| Height | Fixed, compact (about 190px), so the Recent card below keeps its scroll area on desktop |

### 7b. Settings page (full)

Signed in with full access:

```
Settings                                   [Signed in with full access]
┌ Full access ─────────────────────────────────────────────── [on] ┐
│ Normal user                                                      │
│ See account balances ………………………………………………………………… [on]  │
│ Add income …………………………………………………………………………………… [on]  │
│ See balances over WhatsApp ……………………………………………………… [on]  │
│ Debit from an account ………………………………………………………………… [on]  │
│ Change transaction dates ……………………………………………………… [off] │
│ See which account was used ……………………………………………… [on]  │
│ Remove an expense …………………………………………………………………… [on]  │
│ Manage budgets (new) ……………………………………………………………… [on]  │
│   Create, change and remove monthly budgets. Without it, budgets │
│   and progress can still be seen, not changed.                   │
└──────────────────────────────────────────────────────────────────┘
┌ Add expenses over WhatsApp                         [Connected] ┐
│ Messages from ••••• 4821 are added to this account.              │
│ [Disconnect] [What else can I send?]                             │
│ Budget alerts on WhatsApp (new) ……………………………………………… [off] │
│   Adds one line to the reply after an expense when a budget      │
│   passes 50%, 80%, 100% or goes over. Never sends a message on   │
│   its own.  e.g. "Travel 82% of budget, ₹540 left of ₹3,000"     │
└──────────────────────────────────────────────────────────────────┘
```

| Detail | Behaviour |
|---|---|
| Manage budgets | A row in the existing permission list, same switch and wording style; default **on**; saved like the others (`PATCH /api/settings`, full access only) |
| Budget alerts on WhatsApp | Lives in the WhatsApp card, because it is about WhatsApp replies; default **off**; shown only when WhatsApp is configured. Saved through the same settings endpoint, so changing it needs full access |
| Normal sign-in | Sees the alerts row with its current state and "Changing it needs your full-access password"; the permission list stays hidden as today |
| Budgets page without Manage budgets | Everything visible; Edit, Copy and Delete hidden, with the note "View only on this sign-in" |

### Help & Support

One FAQ entry: "How do budgets count split bills and repayments?"

---

## 8. Files

| New | Purpose |
|---|---|
| `server/migrations/011_budgets.sql` | Tables, triggers, settings columns |
| `server/src/budget.mjs` | Pure: month parsing, `summariseSpending`, status, threshold crossings |
| `server/src/budget-store.mjs` | Queries: load month, save, history, alert check |
| `server/src/routes/budgets.mjs` | The endpoints |
| `src/app/budgets/budgets.component.*` | Page: month selector, overview, categories, alerts |
| `src/app/budgets/budget-editor/` | Create / edit / copy panel |
| `src/app/budgets/budget-history/` | History bars, comparison, often-over list |
| `src/app/home/budget-summary/` | Home card |
| `src/app/shared/budget.service.ts`, `budget-status.ts` | API calls; thresholds and status, shared by all budget screens |

| Changed (small, additive) | Change |
|---|---|
| `app.mjs`, `app.routes.ts`, `header.component.html` | Route and menu item |
| `routes/expenses.mjs`, `routes/whatsapp.mjs` | Run the alert check after add/approve; return `budgetAlerts` / one reply line |
| `settings-store.mjs`, `settings` page, `settings.service.ts`, `models.ts` | Two flags (D1, D4) |
| `toast.service.ts` | A `warning` kind |
| `add-expense`, `expense-list` | Show returned alerts as toasts |
| `balances-layout`, `spending-layout` | Place the Home card |

---

## 9. Tests

**API (`node:test`)**
- Pure unit tests:
  - the spending rule (pending excluded, approved included, split personal share,
    uncategorised, month boundaries 30/31 and 1 Nov, future months, paise sums like
    0.1 + 0.2);
  - status bands at exactly 69.99 / 70 / 99.99 / 100%;
  - threshold crossing and re-arm policy.
- Route tests with the stand-in database:
  - validation (month, category, amounts, duplicates);
  - auth required;
  - Manage budgets enforced, full access allowed;
  - no cross-user reach (every query carries the session user);
  - copy;
  - `budgetAlerts` returned once.

**End to end** on the local API and real database, with a temporary
`@localhost.test` account, deleted afterwards:
- real SQL for a split + repayment + pending + approved + deleted mix across two
  months;
- budget totals equal the Transactions "Debit" figure;
- two concurrent expenses produce one alert.

**Angular:**
- budget status util;
- service;
- page rendering, month navigation, create/edit/copy/remove with confirmations;
- empty, loading and error states;
- Home card with and without a budget.

**Regression:** all 154 API and 166 Angular tests, the production build, and a
browser pass of every existing page in both themes and at phone width.

## 10. Performance

- **Month view:** 3 small queries on the existing `(user_id, spent_on)` index and the
  new unique keys.
- **History (12 months):** 2 queries.
- **Alert check:** 1 aggregate and 1 insert per expense save, after the commit, so it
  never holds the balance lock.
- **Home:** one extra request (the month view) alongside the existing ones.
- No background jobs and no new dependencies.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Development shares the live database (H5) | Additive migration only; the end-to-end test uses its own account and deletes it; real accounts are checked untouched afterwards |
| Alert check after commit fails | It's best effort: the expense is already saved, the failure is logged, and it retries on the next save |
| Budget totals disagree with Home | One server rule, plus a test comparing it with the client's `totalOf` on the same data |
| Menu gets crowded (6 items) | Fits at desktop width (checked at 800 px); phones use the existing menu |

## 12. Delivery

1. A new branch, `feat/budgets`, off `main`.
2. Phase 2: migration, server and tests.
3. Phase 3: pages.
4. Phase 4: alerts.
5. Phase 5: full regression.
6. Phase 6: `BUDGET_FEATURE_REPORT.md`.

**Nothing is pushed to `main` or deployed without your approval.** The migration is
applied to the database only after you confirm this design.

---

## Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D1 | Who may change budgets? | New **Manage budgets** switch, default on, full access always |
| D2 | Colour bands (70 / 100) vs alerts (50 / 80 / 100 / over) | Keep both as you specified |
| D3 | Budget for expenses with no category? | Yes, as **Uncategorised** |
| D4 | WhatsApp budget alerts? | One line on existing replies only; switch **default off** |
| D5 | No overall budget, only categories | Show the category sum as the monthly figure; no overall alerts |
| D6 | Re-alerting policy | Once per threshold per month; re-armed only when that budget amount changes |
