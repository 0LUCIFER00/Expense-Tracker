# Expense Tracker — Complete Project Overview

> **For the reader (ChatGPT or a person):** this document describes the whole
> project end to end: what it is, who it is for, every feature, how the pieces fit
> together, the data model, the API, WhatsApp integration, security, testing and
> deployment. Use it to explain the project, answer questions about it, or present
> it. Names in **bold** are what the user sees on screen; names in `code` are what
> the source code calls them.

---

## 1. What the project is

A personal **expense and income tracker** for Indian users (amounts in ₹), built as
a web app with a second way in: **WhatsApp**. A user can record spending and income
on the website, or simply send a message like `250 coffee` or `+50000 salary hdfc`
from their linked phone, without signing in.

It tracks:

- **Money out (Debit)**: expenses, optionally taken from a specific account.
- **Money in (Credit)**: income, always credited to an account.
- **Accounts**: cash in hand, wallets (Paytm etc.) and bank accounts, each with a
  live balance that moves when money goes in or out.
- **Split bills**: one person pays for a group; only their share counts as their
  spending, and the others' repayments are tracked against that bill.

A second "full-access" password lets the owner hide balances and lock down actions
when using a shared or public computer.

### The problem it solves

- Recording an expense is usually too slow, so people stop. Here it is one WhatsApp
  message.
- Spending totals are wrong when you pay for a group. Here a ₹1,455 shared shop for
  4 people counts as ₹363 of *your* spending, and the ₹364 each friend returns is
  recorded as a repayment, not income.
- Balances shown on a shared screen are a privacy risk. Here a normal sign-in can be
  made to show no amounts at all.

---

## 2. Technology stack

| Layer | Technology |
|---|---|
| Front end | **Angular 21** (standalone components, reactive forms, lazy-loaded routes, `@if`/`@for` control flow), TypeScript 5.9, RxJS |
| Styling | Hand-written CSS with design tokens (CSS custom properties), full **light and dark theme** |
| Back end | **Node.js + Express 4** (ES modules, `.mjs`) |
| Database | **PostgreSQL** (hosted on **Aiven**, Singapore region), accessed with `pg` (node-postgres) using plain SQL |
| Auth | bcrypt password hashes (`bcryptjs`), session as a signed **JWT in an httpOnly cookie** (`jsonwebtoken`, `cookie-parser`) |
| Messaging | **WhatsApp Cloud API** (Meta) via a signed webhook |
| Hosting | **Vercel**: static Angular build plus one serverless function for the API, pinned to region `sin1` (Singapore) to sit beside the database. A `render.yaml` also exists for Render as an alternative |
| Tests | Jasmine + Karma for the Angular app (160 tests); Node's built-in test runner for the API (112 tests) |
| Dev tooling | `concurrently` runs API and web together; Angular dev server proxies `/api` to Express |

---

## 3. Navigation and pages

Top menu (left to right):

**Home · Add Expense · Add Income · Transactions · Cash & Accounts**

Account menu (profile icon): **My Profile · Settings · Help & Support · Logout**.
A sun/moon button switches light and dark theme.

| Page | Route | Component folder |
|---|---|---|
| Login | `/login` | `login-page` |
| Register | `/register` | `register-page` |
| Home | `/home` | `home` (+ `balances-layout`, `spending-layout`) |
| Add Expense | `/add-expense` | `add-expense` |
| Add Income | `/add-money` | `add-money` |
| Transactions | `/transactions?tab=all|out|in` | `expense-list` |
| Cash & Accounts | `/money` | `bal-mnt` |
| My Profile | `/profile` | `profile` |
| Settings | `/settings` | `settings` |
| Help & Support | `/help_support` | `help-support` |

Old addresses still work: `/view-expenses` redirects to Transactions → Debit, and
`/bal-mnt` redirects to `/money`. Every page after login is protected by an auth
guard, and is lazy-loaded so the first download stays small. **Add Income** and
**Cash & Accounts** have their own guards and disappear from the menu when the
signed-in identity is not allowed to use them.

---

## 4. Features, page by page

### 4.1 Register and Login

- Register with name, email and password, and optionally a second **full-access
  password** (must differ from the normal one).
- Login uses the same email with either password:
  - the **normal password** signs in as a *user*, limited by the permission switches;
  - the **full-access password** signs in as the *owner* with every permission.
- Password endpoints are rate limited (about ten attempts per ten minutes per
  address and per account).

### 4.2 Home (dashboard)

Home has **two layouts**, chosen by whether the identity may see balances:

- **With balances:** total "Held across accounts", each account's balance, plus the
  spending view below.
- **Without balances:** a spending-only layout with no amounts held anywhere.

Both show:

- A **Last 14 days** bar chart of daily spending (always fourteen slots, so it reads
  as a chart even with little data).
- Stats: **Entries this month**, **Daily average**, **Busiest day**, **On pace for**
  (projected month total).
- **Spending by category** breakdown.
- **Recent** entries. A split expense opens in place to show who has paid back.
  **See all debits** goes to Transactions → Debit.
- A strip when entries are **waiting for an admin**, with a **Pending approvals**
  button.
- A **Connect WhatsApp** card if the phone is not linked yet.

All spending figures use the user's **own share** of split bills, not the full bill.

### 4.3 Add Expense

Fields: **Amount**, **Description**, **Category** (dropdown), **Split bill**
(checkbox + number of people), **Debit from** (an account, or **Don't debit any
account**), **Date**.

- **Categories:** Food & Drink, Groceries, Travel, Shopping, Bills & Utilities,
  Health, Entertainment, Education, Family & Gifts, or none ("Uncategorised").
- **Debit from:** taking it from an account lowers that account's balance; the
  server refuses to overdraw. Leaving it out just records the expense.
- **Split bill:** tick it and enter the number of people *including yourself*
  (2–50). A live preview shows, for ₹1,455 split 4 ways:
  "Your share ₹363 · ₹364 each from the other 3".
  The full ₹1,455 still leaves the account; only ₹363 counts as your spending.
- **Dates:** today is normal. A past or future date asks for confirmation. Without
  the "Change transaction dates" permission it is saved as **Pending approval** and
  no money moves until the owner approves it.
- Side cards: **Balance after** (what the account will hold) and **Add via
  WhatsApp** (the exact message that would do the same thing).

### 4.4 Add Income

Fields: **Amount**, **Description**, **Income source** (dropdown), **Split
repayment** (dropdown), **Credit to** (account, required), **Date**.

- **Income sources:** Salary, Business, Refund, Gift, Interest, Sold something, or
  none.
- **Split repayment:** lists split bills that still have money owed (e.g.
  "October Month Vegetables — ₹728 owed"). Choosing one fills in the amount and
  description and locks the source. If nothing is owed it says **Nothing to pay
  back yet** and explains how to start a split.
- Paying back more than is still owed is refused, so the same repayment cannot be
  recorded twice.
- Side cards: **Balance after**, **Add via WhatsApp**, and **Recent income** with a
  **See all credits** link.
- A repayment is **not counted as income**. It is money you fronted coming back.

### 4.5 Transactions

One ledger for both directions, with three tabs:

| Tab | Shows |
|---|---|
| **All** | Every debit and credit, in date order |
| **Debit** | Expenses only (this was the old "View Expenses" page) |
| **Credit** | Income and repayments |

- **Filters:** Year, Month, Category (or **Source** on the Credit tab).
- **Sorting:** click any column (Date, Amount, Description, Category, Account,
  Status) to sort ascending, descending, then back to entry order.
- **Totals:** **Debit ₹** (your share of spending), **Credit ₹** (real income,
  excluding repayments) and **Repaid ₹** (what came back from splits).
- **Colour coding:** debit rows have a red stripe and tint, credit rows green, in
  both light and dark themes. Credit amounts show as `+₹`.
- **Status chips:** Completed, Pending approval, Credit.
- **Splits:** a split expense shows a tag "Split 4 · yours ₹363"; clicking the row
  expands its history (who paid, when, how much is still to come). A repayment
  shows "Repayment for …" and opens the split it belongs to.
- **Actions:** approve a pending expense; remove an expense (money goes back to its
  account; a split's repayments stay as ordinary income); remove an income (money
  comes back out of its account).
- **Export CSV:** downloads exactly what the current tab shows, with columns suited
  to that tab (Debit, Credit, or a combined file with a Type column).

### 4.6 Cash & Accounts

Where the user sets up the places their money sits:

- **Account type:** Cash in hand, Wallet, Bank Account.
- A name per type (e.g. Personal/General for cash, Paytm for wallets, HDFC Bank for
  banks), or **+ Add New** for a custom one.
- **Current balance**, saved per row with a tick button; rows can be removed.
- The page recommends using **Add Income** to put money in, rather than editing the
  figure, so there is a record of where it came from.
- Hidden entirely when the identity may not see balances.

### 4.7 Settings

- **Full access:** create, change or remove the full-access password. Removing it
  restores every permission, since nobody could unlock them otherwise.
- **Permission switches** (apply to the normal sign-in; the owner always has all):

| Switch | What it controls |
|---|---|
| See account balances | Every amount held: Home balances, Cash & Accounts, WhatsApp balance replies |
| Add income | The Add Income page and `+` messages over WhatsApp |
| See balances over WhatsApp | Whether WhatsApp replies quote balances (needs the switch above too) |
| Debit from an account | Whether spending may lower an account balance |
| Change transaction dates | Past/future dates without approval |
| See which account was used | The Account column and account details |
| Remove an expense | Delete buttons, and `undo` |

- **Add expenses over WhatsApp:** connect or disconnect the phone (see §5).
- A normal sign-in sees only "Create full access"; the switches appear after
  signing in with the full-access password. Every switch is enforced again on the
  server, not just hidden in the page.

### 4.8 My Profile

- **Your details:** name and email.
- **Your password:** change it (needs the current one).
- **Linked WhatsApp:** masked number (`••••• 1234`) with a link to Settings.
- **Your data:** **Download my data** as CSV.
- **Delete this account:** permanent, needs the password.

### 4.9 Help & Support

- Every WhatsApp command with what it does.
- **Splitting a bill over WhatsApp**: three numbered steps (pay, get paid back, see
  who still owes).
- An FAQ accordion covering balances not changing, ambiguous account names, pending
  entries, deleting, splitting, repayments, the full-access password,
  "Uncategorised", WhatsApp replies stopping, recording income and CSV export.
- **Your setup:** WhatsApp connected or not, full access on or off, number of
  accounts.
- **Contact support** button.

---

## 5. WhatsApp integration

### Linking a phone

1. **Settings → Add expenses over WhatsApp → Connect WhatsApp**.
2. The server issues a **single-use 6-character code** (no confusable characters
   like O/0/I/1) valid for **15 minutes**.
3. An **Open WhatsApp** button opens the chat with `link ABC123` pre-typed; the
   user presses send. Receiving the code from that number proves they own it.
4. From then on, messages from that number are recorded for that account.

### What you can send

| Message | Result |
|---|---|
| `250 coffee` | Records ₹250 "Coffee"; no account named, so no balance changes |
| `1200 groceries hdfc` | Records it and debits HDFC Bank |
| `80 chai cash` | Debits the cash-in-hand account |
| `paid 1,250.50 for dinner` | Filler words ignored, commas and decimals understood |
| `+50000 salary hdfc` | **Income** (the leading `+`), credited to HDFC Bank, source Salary |
| `+300 refund paytm` | Income into the Paytm wallet |
| `1455 vegetables hdfc split 4` | Split expense: ₹1,455 leaves HDFC, your share ₹363, others owe ₹364 each. `split by 4` and `split 4 ways` also work |
| `+364 vegetables share hdfc` | A **repayment** towards the vegetables split. `+364 Kalai vegetables share hdfc` records who paid |
| `splits` | What people still owe you, per split |
| `balance` | Every account and its balance (if allowed) |
| `today` | Today's entries and total (your share for splits) |
| `undo` | Removes the last thing you sent, debit or credit, and restores the balance |
| `help` | The command list |

### How messages are understood (`server/src/whatsapp/parser.mjs`)

- The amount is the first number; the rest becomes the description.
- **Account matching:** a word that matches one of the user's saved accounts
  (`hdfc` → "HDFC Bank", `cash` → cash in hand). If a word matches two accounts
  ("bank" with both Indian Bank and HDFC Bank) the reply asks which one, rather
  than guessing.
- **Category guessing:** keywords map to categories (e.g. "salary", "payday" →
  Salary; "refund", "cashback" → Refund; grocery and food words → their expense
  categories). If unclear, it is left uncategorised.
- **Split detection:** the `split N` clause is removed before reading the amount.
  `split 1` or `split 99` is rejected with a clear message.
- **Repayment matching:** with `share`, a word from the expense's name picks the
  split. If only one split is open, no name is needed. If two match equally, it
  asks. If none match, it records ordinary income and says so.

### Reliability and safety

- Meta signs every webhook call; the server **verifies the signature** with the app
  secret and rejects anything unsigned.
- Each message id is stored (`whatsapp_processed_messages`), so Meta's retries never
  double-record.
- A message **sent more than 15 minutes before it arrived is ignored**. Meta retries
  undelivered webhooks for days, and a late replay would record a spend that was
  probably entered by hand meanwhile.
- The webhook answers Meta immediately, then does the work afterwards (using
  Vercel's `waitUntil`), so Meta never times out and retries.
- WhatsApp obeys the same permissions as the website (hidden balances, Add Income
  switched off, account debits not allowed, etc.).
- Diagnostic scripts: `npm run wa:check` (configuration and what Meta reports) and
  `npm run wa:recent` (what has actually arrived).

---

## 6. How split bills work (the maths)

- All maths is done in **paise** (integers) to avoid rounding errors.
- The others each pay the bill divided by the number of people, **rounded to the
  nearest rupee**; the payer absorbs the remainder.
  Example: ₹1,455 ÷ 4 → others ₹364 each (₹1,092), payer's share ₹363.
- If rounding would make the others owe more than the bill, it falls back to paise.
- The expense stores `split_members`, `split_share` (each other person's part) and
  `personal_share` (yours). A database constraint says all three are set or none.
- Repayments are income rows linked to the expense by `split_expense_id`. The split
  shows **received** and **remaining**, and is "fully paid back" when remaining is 0.
- Recording a repayment **locks the split row** in a transaction so two repayments
  arriving at once cannot both slip past the "not more than owed" check.
- **Every spending total** (Home, Transactions, WhatsApp `today`) uses
  `personal_share` when present, else the full amount.
- Deleting a split expense keeps its repayments as ordinary income and says how
  many were detached.

The client has a mirror of the split function (`src/app/shared/split.ts`) for the
live preview; the server's (`server/src/split.mjs`) is the one that counts.

---

## 7. Architecture

```
Browser (Angular SPA)
   │  HTTPS, httpOnly session cookie
   ▼
/api/*  ──►  Express app (server/src/app.mjs)
              ├── routes/auth.mjs       register, login, logout, me, passwords, delete account
              ├── routes/balances.mjs   accounts
              ├── routes/expenses.mjs   expenses, approve, delete, splits
              ├── routes/incomes.mjs    income and repayments
              ├── routes/settings.mjs   permission switches
              ├── routes/link.mjs       WhatsApp link codes
              └── routes/whatsapp.mjs   Meta webhook (signed, no cookie)
                     │
                     ▼
              PostgreSQL (Aiven)  ◄── plain SQL through a small pool (db.mjs)

WhatsApp user ──► Meta Cloud API ──► POST /api/whatsapp/webhook ──► same stores
                                 ◄── reply via Graph API (whatsapp/client.mjs)
```

- **Stores** (`expense-store.mjs`, `income-store.mjs`, `split-store.mjs`,
  `settings-store.mjs`) hold the logic shared by the website routes and the
  WhatsApp handler, so both behave identically.
- **Balance changes happen in the same database transaction** as the expense or
  income that causes them, so a balance can never drift from its records.
- **Lock order** is consistent (split expense first, then balance) to avoid
  deadlocks.
- On Vercel, `api/index.mjs` exports the same Express app as a serverless function.
  Locally, `server/src/index.mjs` runs it on a port.

### Front-end structure (`src/app`)

- `shared/api.service.ts`: HttpClient wrapper (base path, cookie, error shape).
- `shared/expense.service.ts`, `income.service.ts`, `balance.service.ts`,
  `settings.service.ts`, `whatsapp.service.ts`: one service per resource.
- `shared/models.ts`: TypeScript interfaces for every API shape.
- `shared/split-history/`: the expandable "who has paid back" panel, used on Home
  and Transactions.
- `shared/spend-chart/`: the 14-day bar chart.
- `shared/csv.ts`: CSV building and download.
- `shared/theme.service.ts`: light/dark theme, remembered per browser.
- `shared/toast.service.ts`: success and error toasts.
- `auth.service.ts` / `auth.guard.ts`: session state and route protection.

---

## 8. Database

Tables (PostgreSQL):

| Table | Holds |
|---|---|
| `users` | Accounts: name, email, bcrypt `password_hash`, optional `admin_password_hash` (the full-access password), linked `whatsapp_number` |
| `balances` | The user's accounts: type, name, current balance |
| `expenses` | Amount, description, category, account, date, status (`done` / `pending`), and split columns `split_members`, `split_share`, `personal_share` |
| `incomes` | Money in: amount, description, source category, account, date, and `split_expense_id` when it is a repayment |
| `user_settings` | One row per user with the permission switches |
| `whatsapp_link_codes` | Short-lived single-use link codes |
| `whatsapp_processed_messages` | Message ids already handled |
| rate-limit table | Shared counters for rate limiting (works across serverless instances) |
| `schema_migrations` | Which migrations have run |

Migrations (`server/migrations/`, applied in order, each in a transaction with
`npm run db:migrate`):

1. `001_init.sql`: users, balances, expenses, settings
2. `002_whatsapp.sql`: WhatsApp linking and processed messages
3. `003_user_only_permissions.sql`: permissions apply to the normal user only
4. `004_expense_categories.sql`: expense categories
5. `005_money_in.sql`: the incomes table
6. `006_money_permissions.sql`: balance-visibility and add-income switches
7. `007_housekeeping.sql`: clean-ups
8. `008_shared_rate_limits.sql`: rate limits stored in Postgres
9. `009_splits.sql`: split columns on expenses, `split_expense_id` on incomes
10. `010_session_version.sql`: `users.session_version`, which lets sessions be revoked

---

## 9. API reference

All routes are under `/api` and need the session cookie unless noted.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness and database ping (public) |
| POST | `/auth/register` | Create account and sign in (public) |
| POST | `/auth/login` | Sign in with normal or full-access password (public) |
| POST | `/auth/logout` | End the session |
| GET | `/auth/me` | Current user and sign-in type |
| PUT | `/auth/password` | Change the normal password |
| PUT | `/auth/admin-password` | Set or change the full-access password |
| POST | `/auth/admin-password/remove` | Remove it |
| DELETE | `/auth/account` | Delete the account (needs password) |
| GET / POST | `/balances` | List / create accounts |
| PUT / DELETE | `/balances/:id` | Update / remove an account |
| GET / POST | `/expenses` | List / create (with optional `splitMembers`) |
| GET | `/expenses/splits` | Every split with its repayments |
| POST | `/expenses/:id/approve` | Approve a pending expense (moves the money) |
| DELETE | `/expenses/:id` | Remove an expense, restoring the balance |
| GET / POST | `/incomes` | List / create (with optional `splitExpenseId`) |
| DELETE | `/incomes/:id` | Remove income, reversing the credit |
| GET / PATCH | `/settings` | Read / change permission switches (full access only for changes) |
| GET / POST / DELETE | `/whatsapp/link`, `/whatsapp/link/code` | Link status / issue code / unlink |
| GET / POST | `/whatsapp/webhook` | Meta verification handshake / inbound messages (signature-checked) |

---

## 10. Security

- Passwords hashed with **bcrypt**; never sent back to the browser.
- Session is a **signed JWT in an httpOnly cookie**: page scripts cannot read or
  forge it. The server refuses to start in production without a strong signing
  secret (`JWT_SECRET`, 32+ characters).
- **Every permission is enforced on the server.** The UI hides things for
  convenience, but the API refuses them regardless.
- Changing the full-access password needs the current one, so someone with only the
  normal password cannot take over.
- **Rate limiting** on password endpoints, counted in Postgres so it holds across
  serverless instances.
- **Security headers:** strict Content Security Policy (`script-src 'self'`, so no
  inline scripts), `X-Frame-Options: DENY`, HSTS over HTTPS.
- **WhatsApp:** signature-verified webhook, duplicate-message protection, stale
  message rejection, phone number masked in the UI.
- Secrets (database URL, JWT secret, WhatsApp tokens) live in `.env` locally and in
  Vercel environment variables in production; `.env` is never committed.

- **Sessions are revocable:** changing the password or the full-access password signs
  out every other device. New passwords need 8 characters.
- The pages served by Vercel's CDN carry the same security headers as the API
  (content security policy, no framing), and API responses are never cached.

Known outstanding items (see AUDIT_REPORT.md): the Aiven CA certificate is not yet
verified until `DATABASE_CA_CERT` is set; development shares the production
database; the app connects as Aiven's admin user. (The Angular advisories were closed
by upgrading to Angular 21; `npm audit` reports none.)

---

## 11. Design and UX

- **Light and dark themes**, switched from the header and remembered; set before
  first paint so there is no flash.
- **Design tokens** (`--ink`, `--surface`, `--accent`, `--good`, `--bad`, etc.) in
  `src/styles.css`, so every component works in both themes.
- **Responsive:** on phones the Transactions table becomes labelled cards, the menu
  collapses to a hamburger, and tabs go full width.
- **Accessible:** keyboard-reachable expandable rows (Enter opens), ARIA roles on
  tabs, visible focus, reduced-motion respected.
- **Consistent vocabulary:** Debit / Credit, Add Income, Cash & Accounts, Split
  bill, Split repayment, Repaid, Full access.

---

## 12. Running, testing and deploying

```bash
npm install
npm run db:migrate      # create/upgrade tables (needs DATABASE_URL in .env)
npm run dev             # API (watch mode) + Angular dev server together
```

- Web app: `http://localhost:4200`, proxying `/api` to the Express API.
- `npm run test:ci`: Angular tests (160, headless Chrome).
- `npm run test:api`: API tests (112, no database needed).
- `npm run build`: production build into `dist/expense-tracker/`.
- `npm run db:check` / `db:status`: database diagnostics.

**Deployment (Vercel):** `vercel.json` serves the Angular build as static files and
rewrites `/api/*` to the serverless function in `api/index.mjs`. The region is pinned
to `sin1` (Singapore) next to the Aiven database, which cut request time from about
650 ms to normal. On Vercel the database pool is capped at 2 connections per
instance, rate limits are stored in Postgres, and post-response work uses
`waitUntil`. Migrations are run manually, not on deploy.

Environment variables: `DATABASE_URL`, `JWT_SECRET`, `WHATSAPP_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`,
`WHATSAPP_BUSINESS_NUMBER` (optional, enables the one-tap link button).

WhatsApp cost: incoming messages are free; replies are Meta "service messages", the
first 1,000 per month free.

---

## 13. Current status

- **Live on Vercel:** accounts, expenses, income, permissions, the full-access
  password, and WhatsApp recording of expenses and income.
- **Built and tested locally, not yet deployed:** split bills (website and
  WhatsApp), the combined Transactions page with All/Debit/Credit tabs, debit/credit
  row colours, the Add Income layout with split repayment, the Help & Support split
  guide, and the renamed menu and labels.

---

## 14. A worked example, end to end

1. Prajwal registers, sets a full-access password, and signs in with it.
2. On **Cash & Accounts** they add *HDFC Bank* with ₹10,000 and *Cash in hand* with
   ₹2,000.
3. In **Settings** they connect WhatsApp by sending `link K7QM2X`.
4. They pay ₹1,455 for vegetables for 4 flatmates and send
   `1455 vegetables hdfc split 4`. Reply: HDFC now ₹8,545; your share ₹363; ₹364
   each from the other 3.
5. A flatmate pays back by UPI. Prajwal sends `+364 Kalai vegetables share hdfc`.
   Reply: ₹364 of ₹1,092 back, ₹728 still to come. HDFC is ₹8,909.
6. Salary arrives: `+50000 salary hdfc` is recorded as Credit, source Salary.
7. On **Transactions**: Debit ₹363 (their real spending), Credit ₹50,000 (real
   income), Repaid ₹364. Clicking the vegetables row shows who paid and who still
   owes.
8. `splits` on WhatsApp lists the ₹728 still owed.
9. On an office computer they sign in with the **normal** password: no balances
   appear anywhere, and only the actions the switches allow are available.
