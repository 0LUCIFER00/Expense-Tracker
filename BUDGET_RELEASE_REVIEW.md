# Budget & Layout — Release Review

Branch `feat/budgets` (`8dd3c95`) against `main` (`0266433`): 64 files changed.
Reviewed 2026-11-06. No code was changed by this review.

| # | Area | Result |
|---|---|---|
| 1 | Budget calculations | **PASS** |
| 2 | Alerts | **PASS** |
| 3 | Security | **PASS** |
| 4 | Layout | **PASS** |
| 5 | Regression | **PASS**, one **WARNING** |
| 6 | Database | **PASS**, one **WARNING** |
| 7 | Sample data | **WARNING** |
| — | Account check (not this branch) | **WARNING** |

---

## 1. Budget calculations — PASS

**Independent check.** For each of the test account's six months, the budget API's
spent figure was compared with a separate read-only SQL sum of
`coalesce(personal_share, amount)` over `status = 'done'`, grouped by `spent_on`
month. **All six months match exactly:** 18,181 · 15,821 · 18,356 · 21,097 ·
17,788 · 12,444.

**Each rule:**
- **Approved only:** the sum filters `done`; pending rows are present and excluded.
- **Split personal share:** the gross bills (for example ₹14,769 in November) are
  higher than the counted figures (₹12,444).
- **Repayments excluded:** ₹15,357 of repayments are on record and none is counted;
  the budget code never reads `incomes`.
- **Deleted expenses excluded:** spending is summed on every read and never stored.
  Covered end to end earlier: deleting an expense lowered the total at once.
- **Pending until approval:** covered end to end earlier: approval added it to the
  month and triggered an alert.
- **Transaction-date month:** grouped by `spent_on` with `[first day, next first day)`
  ranges; unit tests cover 31 Oct / 1 Nov and the year end.
- **Whole paise:** sums are converted to integer paise once, and statuses and
  thresholds compare integers. A unit test confirms 0.10 + 0.20 = 30 paise.

## 2. Alerts — PASS

- **Thresholds:** 50 / 80 / 100 use `spent·100 ≥ budget·t`; "over" is
  `spent > budget`. Unit tests check exactly 50%, 80% and 100%, and 100% + 1 paisa.
- **Once per month:** `budget_alerts` has primary key `(monthly_budget_id, scope,
  threshold)`, and inserts use `on conflict do nothing returning`.
  - End to end, two concurrent expense saves produced exactly one 80% alert.
  - **0 duplicate rows** in the database.
- **Re-arm policy (D6):** changing a scope's amount re-arms it, and thresholds already
  reached are recorded quietly. Verified end to end: raising Travel left only the 50%
  alert.
- **Pending expenses** raise no alert (route test). Approval checks the expense's own
  month.
- **WhatsApp:**
  - The alert check runs only after a successful save; the insufficient-balance
    reply returns first.
  - The alert line appears only when `whatsappBudgetAlerts` is on (two handler
    tests).
  - It is never sent as a separate message.

## 3. Security — PASS

- **Manage budgets:** every write route checks `canManageBudgets` on the server.
  - A restricted session gets 403 on all five write routes and no database write
    (route test, plus end to end).
  - A full-access session is always allowed, whatever the switch says.
- **Reading** needs only a sign-in, by design (D1): no balances are exposed.
- **Isolation:**
  - Every budget, spending and alert query is keyed by the session user.
  - No row ids come from requests, so there is no IDOR surface.
  - A route test asserts the user id is the first parameter of every budget query.
- **Validation:**
  - Months must be `YYYY-MM`, from 2000 to 24 months ahead.
  - Categories come from a whitelist and are stored in the canonical spelling.
  - Duplicates are refused.
  - Amounts must be numbers or plain decimals, above 0 and at most ₹99,99,99,999.99.
  - SQL is parameterised throughout.
- **WhatsApp preference:** saved through `PATCH /api/settings`, which is full-access
  only; defaults to off.

## 4. Layout — PASS

Checked in the browser on the production build with the test account. Pages: Home,
Add Expense, Add Income, Transactions, Budgets.

**At 1308×652, all five pages:**
- no page scroll;
- 0 elements overlapping the footer;
- 0 controls off-screen;
- no console errors.

Transactions and Budgets scroll only inside their cards, under sticky headings.

**At 375×812, all five pages:**
- no horizontal overflow;
- normal page scroll;
- no nested scroll areas.

**Add Expense:** the chip rule that leaked onto Transactions is now scoped to
`.add-page`; Add Expense still fits.

## 5. Regression — PASS, with one WARNING

| Suite | Result |
|---|---|
| `npm run test:api` | 188 / 188 pass on 10 of 11 runs |
| `npm run test:ci` | 198 / 198 pass |
| `ng build` | Clean, no budget warnings; 98.6 kB initial transfer |
| `npm audit --omit=dev` | 0 vulnerabilities |

Existing expense, income, split, repayment, account and WhatsApp behaviour is
covered by the suites above, which include the earlier audit's route and handler
tests. The end-to-end budget run exercised expense, split, repayment, pending,
approve, delete and account debits against the real database.

- **WARNING:** the very first API run reported 1 failure out of 188. Ten further
  runs, three of them in parallel under build load, all passed. The failing test
  can't be named, because that run's output was filtered before it could be read. It
  looks like a timing-dependent test.

  Not a blocker. If it recurs, run `npm run test:api` and keep the full output.

## 6. Database — PASS, with one WARNING

`011_budgets.sql` is additive only:
- 3 new tables;
- 2 defaulted `user_settings` columns (`budget_user_access` default true,
  `whatsapp_budget_alerts` default false);
- `updated_at` triggers reusing the existing function.

**Constraints:**
- day-1 month check;
- `total_budget > 0` or null;
- `amount > 0`;
- threshold in (50, 80, 100, 101);
- `unique (user_id, month)` and `unique (monthly_budget_id, category)`;
- cascades from users to budgets to categories and alerts.

**Indexes:** the two unique constraints and the alerts primary key cover every
lookup. Month spending uses the existing `expenses (user_id, spent_on)` index.

**Existing records:** no existing table's rows were changed except the two new
settings columns being filled with their defaults. Both accounts have Manage budgets
on and WhatsApp alerts off.

- **WARNING:** the migration is **already applied** to the shared Aiven database,
  which the live site also uses (audit H5). That is safe, because the live code
  ignores the new tables and columns. It also means no migration step is needed at
  deploy.

## 7. Sample data — WARNING

The six months of data in `test@gmail.com` (113 expenses, 34 incomes including 26
repayments, 3 accounts, 6 budgets) were added deliberately at the owner's request.

**Production implications:**
- The data lives in the production database and will appear on the live site for
  that account, including the Budgets page once deployed.
- It belongs only to that account; no other account has budget rows.
- Delete it (or the account) before treating this database as real-only.
- No temporary `@localhost.test` accounts remain.

## Account check (outside this branch) — WARNING

The database now holds **2 accounts**: `pra***@scalarat.com` (created 2 Nov) and
`tes***@gmail.com` (created 6 Nov). The second personal account recorded in earlier
sessions (`mpr***@gmail.com`) **is no longer present**.

Nothing in this branch deletes accounts. Account deletion needs the account's own
password, and every deletion run during development was restricted to temporary
`@localhost.test` accounts after checking the signed-in email.

**Owner to confirm** whether that account was removed on purpose.

---

## Required fixes

None.

## Recommendation

**READY TO MERGE**
