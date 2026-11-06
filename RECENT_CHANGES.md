# Expense Tracker — What Was Implemented in This Round

> **For the reader (ChatGPT or a person):** this describes the work done in the
> latest round on an existing Expense Tracker app: new features, then a full
> security, integrity and performance audit with its fixes. The app is Angular 21
> on the front end, Node.js + Express on the back end, PostgreSQL on Aiven, hosted
> on Vercel, with a WhatsApp Cloud API integration. The project as a whole is
> described in `PROJECT_OVERVIEW.md`; the audit in detail in `AUDIT_REPORT.md`.
>
> **Status:** everything below, plus the upgrade to **Angular 21**, is merged into
> `main` and **live in production** (deployed 2026-11-06). The production checks
> passed: security headers, no-store API responses, database health and the new
> validation rules. Still to do by the owner: a WhatsApp test from the phone, and
> adding the database certificate in Vercel.

---

## Part 1 — New features

### 1.1 Split bills

**Problem:** when you pay ₹1,455 for vegetables for 4 flatmates, the whole ₹1,455
counted as *your* spending, and the ₹364 each friend paid back looked like income.

**What was built:**
- **Add Expense** has a **Split bill** checkbox and a number of people
  (2–50, you included). A live preview shows "Your share ₹363 · ₹364 each from
  the other 3".
- The full amount still leaves your account, but only **your share** counts as
  spending everywhere: Home, Transactions and WhatsApp.
- **Add Income** has a **Split repayment** dropdown listing splits that still have
  money owed. Picking one fills in the amount and description.
- Repayments are recorded as money coming back, **not income**, and are totalled
  separately as "Repaid".
- Paying back more than is still owed is refused, so the same repayment can't be
  recorded twice.
- Clicking a split row on Home or Transactions expands it to show who has paid,
  when, and what's still to come.

**Maths:** done in integer paise. The others each pay the bill divided by the
number of people, rounded to the nearest rupee; the payer absorbs the difference.
A repayment locks the split's database row so two simultaneous repayments can't
overpay.

**WhatsApp:**
- `1455 vegetables hdfc split 4` records a split expense.
- `+364 vegetables share hdfc` records a repayment.
- `splits` lists who still owes you.

**Database:** migration `009_splits.sql`:
- `expenses` gains `split_members`, `split_share` and `personal_share`, with a
  constraint that all three are set or none are.
- `incomes` gains `split_expense_id`.

### 1.2 One Transactions page

- "View Expenses" became **Transactions**, with three tabs: **All**, **Debit**
  (money out) and **Credit** (money in).
- Filters (year, month, category), sorting on every column, and totals: **Debit ₹**
  (your share of spending), **Credit ₹** (real income) and **Repaid ₹**.
- Debit rows have a red stripe and tint, credit rows green, readable in both light
  and dark themes.
- **Export CSV** downloads what the current tab shows.
- Old `/view-expenses` links still land on the Debit tab.

### 1.3 Clearer names everywhere

- **Menu:** Home · Add Expense · **Add Income** (was Add Money) · Transactions ·
  **Cash & Accounts** (was Money Management).
- **Labels:**
  - Debit from, Credit to, Income source, Split bill, Split repayment.
  - Balance after, Add via WhatsApp, Recent income, Spending by category.
  - See all debits, Pending approvals.
  - Account type, Cash in hand, Current balance.
  - Completed / Pending approval / Credit.
- The "admin password" became the **full-access password**.
- Only displayed text changed; stored values and page addresses did not.

### 1.4 Help & Support

- A new section, **Splitting a bill over WhatsApp**, with three numbered steps (pay,
  get paid back, see who still owes).
- Four new FAQ answers.
- Outdated answers corrected.

---

## Part 2 — Security, integrity and performance audit

The whole codebase was reviewed, the live site's headers were checked, and the
database was inspected with **read-only** queries. Nothing was classed Critical.
What was found and fixed:

### 2.1 Security fixes

| Problem | Why it mattered | Fix |
|---|---|---|
| **Live pages had no security headers.** On Vercel, the HTML comes from the CDN and skips the Express server that set them | Any website could load the app in a hidden frame and trick a click onto "Delete account" (clickjacking); no content security policy | `vercel.json` now sends the same headers (CSP, `X-Frame-Options: DENY`, etc.) for every page; a test keeps it in sync with the server |
| **Logins couldn't be revoked.** A login cookie stayed valid for 7 days even after a password change | A leaked password, once changed, still worked on every device that had used it | New `users.session_version` column (migration 010). Each cookie carries the version, and every request checks it. Changing the password or full-access password signs out all other devices and keeps the current one signed in |
| **WhatsApp `undo` ignored the "Remove an expense" switch** | A phone could delete what the website refused to | `undo` now checks the same permission |
| **WhatsApp used UTC dates** | Messages sent between midnight and 5:30 am IST were filed under the previous day | WhatsApp uses the Indian date |
| **Login timing revealed which emails were registered** | An attacker could list accounts | Unknown emails now take the same time as wrong passwords |
| **No limit per address across many emails** | Leaked-password lists could be tried freely | Capped at 30 attempts per 10 minutes per address |
| **API responses were cacheable** | Financial data could be kept by browsers or proxies | `Cache-Control: no-store` on all API responses |
| **Weak password minimum (6)** | Easy to guess | 8 characters for new passwords; existing ones still work |
| **WhatsApp allowed amounts the website refuses** | Inconsistent rules, confusing errors | Same ₹1,00,000 limit with a clear reply |
| **Loose amount parsing** (`true` counted as ₹1; ₹0.001 caused a server error) | Bad data or crashes | Only real numbers accepted; clear error otherwise |
| **Unknown WhatsApp numbers got unlimited replies and link attempts** | Link codes could be guessed; each reply costs money | 5 replies and 5 link attempts per hour per unknown number |
| **Error logs included personal data** from database errors | Emails in hosting logs | Only the message and code are logged |

### 2.2 Restricted-login gaps closed (owner's decisions)

The app has two passwords. The **normal** one gives a restricted login, controlled
by permission switches; the **full-access** one gives everything. Four things a
restricted login could do despite its switches are now closed:

1. **Changing the sign-in email** needs the current password.
2. **Deleting the account** needs the full-access password when one exists.
3. **Income on another date** needs the "Change transaction dates" permission, as
   expenses already did. On screen, the date stays on today with a hint.
4. **Editing balances** on Cash & Accounts needs "Debit from an account" as well as
   seeing balances. Without it, the page becomes view-only with a note.

### 2.3 Financial integrity (verified, no rules changed)

- Every expense, income, approval and deletion changes the balance **in the same
  database transaction** as its record, with the account row locked.
- Pending expenses move no money until approved.
- The database forbids negative balances.
- Database checks found **zero** inconsistencies:
  - no splits that don't add up;
  - no overpaid splits;
  - no repayments crossing users;
  - no pending entries that already debited;
  - no negative balances.

### 2.4 Performance

- Every API request used to **write** to the settings table just to check
  permissions. Now it reads them, in the same query that checks the login.
- Content-hashed JavaScript and CSS files are cached for a year by the CDN.
- The Transactions list reuses rows instead of rebuilding after each change.
- Database queries take under a millisecond at current size. No index changes were
  justified yet.

### 2.5 Front end

- If a login is revoked or expires while a page is open, the app now sends you back
  to sign in with "Your session has ended", instead of every page showing errors.
- The pages show the new rules: Cash & Accounts view-only, the Add Income date
  locked, Profile asking for the password when the email changes, and "At least 8
  characters" hints.

---

## Part 3 — Testing

| Check | Result |
|---|---|
| API tests | **154 pass** (was 112). New tests run the real routes and WhatsApp handler against a stand-in database |
| Angular tests | **166 pass** (was 160) |
| Production build | Clean, about 94 kB initial download |
| End-to-end run on the local server with the real database and a temporary test account | **24 of 24 checks pass**; the test account was deleted |
| Browser checks of the changed screens, running under the new security headers | Correct, with no console errors |
| "Do the tests catch mistakes?" | Breaking two of the fixes on purpose made the tests fail, as they should |

The owner's real accounts were never touched.

---

## Part 4 — Still open

| Item | Why | What's needed |
|---|---|---|
| Database certificate not verified (connection is encrypted, but the server isn't authenticated) | Needs the certificate from Aiven | Owner adds it to Vercel as `DATABASE_CA_CERT`; the code already supports it |
| Development uses the live database | Needs a second database | Create a separate Aiven database for development and tests |
| App connects as the database admin user | Needs a restricted role | Create a limited role (SQL can be provided) |
| No pagination | Only about 8 rows of data now | Add when history grows |
| WhatsApp not yet tested through Meta after the deploy | Needs the owner's phone | Send `help`, `today`, `10 test cash`, `undo` |
| Preview deployments cannot run the API | Environment variables are set for Production only | Add them for Preview too, if previews should be testable |

**Angular 21 upgrade (also live):** Angular went 19 → 20 → 21. Templates now use the
built-in `@if` / `@for` syntax, every list tracks a stable key, and `npm audit`
reports **0 vulnerabilities** (it was 7).
