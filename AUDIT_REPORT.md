# Expense Tracker — Security, Integrity and Performance Audit

Date: 2026-11-05 · Audited from `0cbd612` · Fixes in `affaf6d`, `a8441dc`, `014c3fc`

**Status (2026-11-06):** merged into `main` together with the Angular 21 upgrade and
**live in production** (deployment `cua1uzero`, commit `e78a874`). The production
checks in §9 were run and passed, apart from the two steps marked as yours.

How each claim was established: **[code]** read in the source, **[live]** observed
on the production site, **[db]** read-only query, **[unit]** automated test that
ran, **[e2e]** run against the local API and the real database with a temporary
`@localhost.test` account (deleted afterwards), **[ui]** checked in the browser.

---

## 1. Summary

| | Before | After |
|---|---|---|
| Critical findings | 0 | 0 |
| High findings | 5 | 2 open, both needing action outside the code (H4 needs a Vercel variable, H5 a second database) |
| Medium findings | 11 | 3 open (M8 database role, M9 Angular upgrade, M10 pagination), all deferred by choice |
| API tests | 112 | **154**, including 34 that drive the real routes and WhatsApp handler |
| Angular tests | 160 | **166** |
| Production build | OK, 94.34 kB initial transfer | OK, 94.19 kB |
| Data integrity checks | all 0 | all 0, and both real accounts untouched |

**Readiness:** ready for a **preview deployment**, not yet production. Three
things can only be confirmed on Vercel: the page headers, the CSP with the CDN in
front, and WhatsApp through Meta. One setting (`DATABASE_CA_CERT`) is yours to
add. See §8.

---

## 2. Security issues found and fixed

Each entry: what was wrong · why it mattered · what changed · how it was tested.

**H1 — Pages had no CSP or anti-framing headers in production.**
On Vercel only `/api/*` passes through Express; HTML and bundles come straight from
the CDN with only HSTS [live]. Any site could put the app in a hidden iframe and
steer a click onto Delete account or a permission switch, and there was no CSP.
· `vercel.json` now sends the same six headers for every path outside `/api`.
· [unit] `deployment.test.mjs` fails if they differ from Express's list. [e2e/ui]
the production build served under that CSP renders with no console errors.
**Not yet verified on Vercel itself**: check after the preview deploy (§8).

**H2 — Sessions could not be revoked.**
A cookie stayed valid for 7 days after a password or full-access password change
[code]. A leaked full-access password, once changed, still worked on every device
that had used it.
· Migration 010 adds `users.session_version`. Cookies carry `ver`, and
`requireAuth` compares the two in the same query that loads the permission flags,
so this costs no extra round trip. Password change, and setting, changing or
removing the full-access password, raise it and re-issue the current device's
cookie. A cookie with no `ver` counts as 0, so deploying signs nobody out.
· [unit] 9 tests (revoked, deleted account, legacy cookie, `/me`, wrong algorithm,
each revoking action). [e2e] laptop changes password → laptop stays in, phone gets
401; owner changes full-access password → the shared machine's full-access session
gets 401. A deliberately broken version check made 3 tests fail, as it should.

**H3 — WhatsApp `undo` ignored "Remove an expense".**
The website refused deletion; a phone could delete entries one `undo` at a time
[code].
· `undo` checks `canRemove` first and explains why when it refuses.
· [unit] the refusal path runs no delete; the allowed path still deletes. Disabling
the check made the test fail.

**M1 — WhatsApp used UTC dates.** Anything sent between 00:00 and 05:30 IST was filed
under the previous day, and `today` listed the wrong day [code, db: TimeZone=UTC].
· Expenses, income and `today` use `todayInIndia()`. · [unit] the insert carries
the Indian date; `today` queries it; the helper is checked across midnight IST.

**M2 — API responses were cacheable** (`public, max-age=0, must-revalidate`) [live].
· `Cache-Control: no-store` on all of `/api`. · [unit][e2e] signed in and signed out.

**M4 — Login timing revealed registered emails** (one bcrypt comparison for unknown
emails, two for a wrong password) [code].
· Unknown emails do two comparisons against a real-cost dummy hash, embedded
rather than computed at start-up so cold starts are not slowed. · [unit] equal
comparison counts.

**M5 — No per-address login cap across emails.**
· Added 30 attempts per 10 minutes per address, alongside the existing per-address+email
limit. · [unit] the 31st attempt gets 429.

**M6 — Restricted sessions could do more than their switches suggested** (your
decision: close all four).
- Email change now needs a password. [unit][e2e][ui]
- With a full-access password set, only it deletes the account. [unit][e2e][ui]
- Income on another day needs "Change transaction dates": the API refuses it, and
  the date field is fixed to today with a hint. [unit][e2e][ui]
- Retyping, creating or deleting an account needs "Debit from an account" as well as
  seeing balances: `canManageBalances`. Cash & Accounts turns view-only with a
  note. [unit][e2e][ui]

**M7 — Weak password minimum.** · 8 characters for new passwords (register, change,
full-access). Signing in still accepts the older 6-character passwords. · [unit][e2e][ui]

**M11 — WhatsApp accepted amounts the website refused.** · The same ₹1,00,000 cap,
with a clear reply. · [unit] for both expense and income.

**L1 — Loose amount parsing.** `true`, `[5]` and `"0x10"` were accepted, and `0.001`
caused a 500. · Only numbers or plain decimal strings; anything that rounds to 0 is
a 400. · [unit][e2e]

**L3** JWT verification pinned to HS256 [unit]. **L4** unconnected WhatsApp numbers
get 5 replies and 5 link attempts per hour [unit]. **L5** linking is one transaction
[unit]. **L6** every text message in a batched webhook is handled [unit]. **L9**
error logs no longer print database `detail` (which quotes row values) [code].
**L10** a revoked or expired session sends the user back to sign-in instead of
leaving every page erroring [unit]. **L11** Transactions rows tracked by key [code].

**Test quality:** `money-permissions.test.mjs` used to test a *copy* of the
permission rule, so it would have passed whatever the server did. It now tests the
real `permissionsFor`, which the server uses.

---

## 3. Remaining risks

| # | Risk | Why it is open | What closes it |
|---|---|---|---|
| H4 | Database certificate not verified | Needs the Aiven CA, which only you can download | Aiven console → service → *CA certificate* → copy → Vercel env `DATABASE_CA_CERT`. The code already reads it; the startup warning disappears when it is right |
| H5 | Development uses the production database | Infrastructure decision (you chose "not now") | A second Aiven database for development and tests |
| M8 | App connects as `avnadmin` (can create roles and databases, bypasses RLS) | Needs a role created in Aiven | A role with select/insert/update/delete on the app tables only; I can write the SQL for you to run |
| ~~M9~~ | ~~Angular 19 advisories~~ **Closed** on branch `chore/angular-21`: upgraded 19 → 20 → 21; `npm audit --omit=dev` reports 0 vulnerabilities | — | Merge that branch |
| M10 | No pagination | Data is 8 rows; filtering is client-side | Move year/month filtering to the API when history grows (thousands of rows) |
| L2 | No explicit CSRF token | SameSite=Lax plus JSON-only bodies already block cross-site writes. An Origin check was **not** added because it can't be verified behind Vercel's proxy without deploying, and a wrong one would block every write | Add after a preview deploy confirms the forwarded host |
| L7 | A WhatsApp message is marked handled before processing, so a crash part-way drops it silently | Deliberate: the alternative is double-booking on retry | The user resends; acceptable |
| — | Logout clears this device only; a copied cookie lives until it expires or a password changes | By design: signing out everywhere on every logout would surprise people | "Sign out everywhere" would be a new feature |
| — | Concurrency is verified by reading the code and by the database's constraints, not by concurrent tests | No safe database to race against (H5) | Once H5 exists: two debits at once, two repayments at once |

---

## 4. Financial integrity (Phase 3)

Verified by reading every money path, by [db] integrity queries, and by [e2e]:

- Expense create, approve and delete, and income create and delete, change the
  balance **in the same transaction** as the record, with the account row locked
  `FOR UPDATE` before the sufficient-funds check. Lock order is the same everywhere
  (split expense, then balance), so these can't deadlock each other.
- A pending expense moves no money until approved, and approval re-checks funds.
- `balance >= 0` is a database constraint, so no path can overdraw even if a check
  in the code were wrong.
- Split maths is integer paise. A repayment locks the split row before summing what
  has been received, so two simultaneous repayments can't both fit under the
  remainder.
- Spending totals use `personal_share` everywhere (Home, Transactions, WhatsApp
  `today`), and repayments are excluded from income.
- [db] 0 splits that don't add up, 0 overpaid splits, 0 cross-user repayments, 0
  pending-but-debited, 0 negative balances. [e2e] a ₹100 income on a ₹1,000 account
  left exactly ₹1,100.

No financial rule was changed. L8 (moving the funds check into the `UPDATE`) was not
done: with the row already locked and the database constraint as a backstop, it
would change nothing observable.

---

## 5. Performance (Phases 4–5)

| Change | Effect |
|---|---|
| Settings read instead of upserted on each request (M3) | Each API call used to write a row and a WAL record just to check permissions. Now one read, and it comes with the session check, so requests make the same number of queries but none of them write |
| `/api` responses `no-store` | Correctness rather than speed: private data isn't kept |
| Content-hashed bundles cached for a year on Vercel | Repeat visits skip re-downloading ~94 kB of unchanged JavaScript (Express already did this; the CDN didn't). Verify after deploy |
| Transactions `trackBy` | A reload after approve or delete reuses row DOM instead of rebuilding the list |

Measurements: queries run in 0.05–0.2 ms (EXPLAIN ANALYZE) and `/api/health` takes
about 274 ms from India, which is network-dominated. The initial bundle is 94.19 kB
transferred, against 94.34 kB before. **No before/after latency was measured** for M3:
at 2 users the difference is below the network noise, and the gain is fewer writes,
not faster reads.

**Indexes:** none added or dropped. At 6–8 rows the planner sequential-scans
everything, so index statistics say nothing yet. When history grows, the first
candidate is `expenses (user_id, created_at)` for the list order. The pool (2 per
instance on Vercel, 19 of 100 connections in use) and region (`sin1`, beside the
database) are right as they are.

---

## 6. Files changed (since `0cbd612`)

**API:** `server/src/{app,auth,db,http,rate-limit,settings-store}.mjs`,
`server/src/routes/{auth,balances,expenses,incomes,whatsapp}.mjs`,
`server/src/whatsapp/client.mjs`, `vercel.json`, `package.json` (test flag).
**Migration:** `server/migrations/010_session_version.sql`.
**Front end:** `src/app/{auth.service,shared/api.service,shared/settings.service,shared/models}.ts`,
`bal-mnt`, `add-money`, `profile`, `register-page`, `settings`, `expense-list`
(component files).
**Tests:** `server/test/{routes,whatsapp-handler,deployment}.test.mjs`,
`server/test/helpers/fake-db.mjs`, updated `http` and `money-permissions` tests,
`auth.service.spec.ts`, `settings.service.spec.ts`.
**Docs:** `README.md`, `PROJECT_OVERVIEW.md`, this report.

## 7. Database migrations

`010_session_version.sql`: `alter table users add column if not exists
session_version integer not null default 0`. Additive. **Already applied** to the
shared Aiven database, with your approval. The deployed code doesn't read it, so
production is unaffected until this code is deployed. Nothing else in the database
was changed.

## 8. Tests executed (actual results)

| Suite | Result |
|---|---|
| `npm run test:api` | 154 / 154 pass (Node 22.17, module mocks; no database) |
| `npm run test:ci` | 166 / 166 pass (headless Chrome) |
| `ng build` (production) | OK, no budget warnings |
| `npm run db:status` / `db:migrate` | 010 pending → applied |
| End-to-end security script, local API + real database | 24 / 24 pass, test account deleted |
| Browser checks on the built app under the CSP | Cash & Accounts view-only, Add Income date fixed, Profile email password, full-access deletion label, 8-character hints; no console errors |
| Mutation checks | Breaking the session check failed 3 tests; removing the undo check failed 1 |

**Not executed:** anything on Vercel; WhatsApp through Meta (the handler was tested
directly, not via a real phone); concurrent transactions against Postgres; tablet
and dark-mode passes on the changed screens (they reuse existing styles).
`npm run wa:check` wasn't run, because it calls Meta with the production token.

## 9. Deployment checklist

| Step | Result |
|---|---|
| Push the branches | Done: `feat/postgres-whatsapp-responsive` and `chore/angular-21`, then `main` |
| Preview deployment | Built. Pages carry the CSP and `X-Frame-Options: DENY`; bundles are `immutable`. The preview **API could not start**: the project's environment variables are set for Production only. Not a code fault |
| Production deployment (`vercel deploy --prod`) | Done. Previous production deployment `9dd3sq841` kept for rollback |
| Live: page headers | CSP and `X-Frame-Options: DENY` on `/`, `/login` and the API |
| Live: `/api/auth/me` | `401`, `Cache-Control: no-store` |
| Live: `/api/health` | `{"status":"ok","database":"reachable"}`, about 0.2 s |
| Live: validation | 7-character password refused; unknown email gets the standard answer; unsigned webhook `403` |
| Live: function region | `sin1` (Singapore), beside the database; requests enter at `bom1` |
| **Yours:** WhatsApp from your phone | `help`, `today`, `10 test cash`, `undo` |
| **Yours:** `DATABASE_CA_CERT` | Add in Vercel, redeploy, confirm health still says `reachable` |

To let future previews run the API, the environment variables would also need to be
set for Preview. They would then use the live database (see H5).

## 10. Production readiness

**Live in production.** The code-side security findings are closed, tested and
confirmed on the live site. Financial integrity was verified with no rule changes.
The Angular 21 upgrade closed the dependency advisories. What remains is either a
setting only you can make (CA certificate, database role, separate dev database) or
a deliberate later project (pagination).
