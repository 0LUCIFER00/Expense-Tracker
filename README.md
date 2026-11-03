# Expense Tracker

An expense tracker with an Angular 19 front end and an Express + PostgreSQL back end.
All data lives in PostgreSQL (hosted on Aiven); the browser holds nothing but an
httpOnly session cookie.

## What it does

- **Register / login** — one account carries two passwords. The normal password signs you
  in as a *user*; an optional admin password signs the same account in as an *admin*. The
  identity you signed in with decides what you can do.
- **Balance accounts** — set up Hand Cash, Wallet, or Bank Account rows, each with a
  category and an amount. A row has to be saved before an expense can be spent from it.
- **Add expense** — log an amount, description, and date. Choosing a source account lets
  you *Add & Update Balance*, which debits the account (refusing to overdraw it).
  A past or future date needs confirmation: with the update permission you can add it
  directly, otherwise it is filed as **Pending / Waiting Admin**.
- **View expenses** — filter by year and month, sort any column (ascending, descending,
  then back to entry order), approve pending entries, and delete entries. Totals count
  only settled entries.
- **Settings** — create or clear the account's admin password, and toggle five permissions
  independently for the user and admin identities: Balance Management visibility, balance
  update access, past/future date permission, view permission, and remove permission.
  **Only an admin session can see or change the permission matrix** — a normal user sees
  just the "Create admin access" toggle. Clearing the admin password resets every
  permission to granted, since with no admin nobody could unlock them again.

## Getting started

```bash
npm install
```

Copy `.env.example` to `.env` and paste the connection string from your Aiven
service's **Connection information** panel, then create the tables:

```bash
npm run db:migrate
```

Run the API and the web app together:

```bash
npm run dev
```

The app is served at `http://localhost:4200/` and proxies `/api` to the API on
port 3000. `npm start` runs only the front end; `npm run api` only the back end.

### Database commands

| Command | What it does |
| --- | --- |
| `npm run db:check` | Diagnoses the connection — DNS, credentials, existing tables |
| `npm run db:migrate` | Applies any migrations that have not run yet |
| `npm run db:status` | Lists migrations and whether each has been applied |

If `db:check` reports that the host does not resolve, the service is still
provisioning, powered off, or the hostname in `.env` is wrong.

## Tests

```bash
npm run test:ci    # Angular suite, headless Chrome
npm run test:api   # API unit tests (no database needed)
```

`npm test` starts the Angular suite in watch mode with a browser attached.

## Building

```bash
npm run build
```

Output lands in `dist/expense-tracker/`.

## Deploying

The app now needs the API and a reachable database, so the static GitHub Pages
build in `docs/` can no longer run on its own — it will load but every request
will fail. Deploy the Express server somewhere and point the front end at it, or
keep using Pages only for a preview of the UI.

### GitHub Pages (front end only)

`docs/` is the published build and is committed to the repository. Regenerate it with:

```bash
npm run build:pages
```

That builds with the `/Expense-Tracker/` base href and syncs the output into `docs/`,
including a `.nojekyll` marker and a `404.html` copy of `index.html` so deep links reach
the Angular router. Never edit `docs/` by hand — it will drift from `src/`.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/app/app.routes.ts` | Route table; everything past login sits behind `authGuard` |
| `src/app/auth.service.ts` | Session state, cached from `/api/auth/me` |
| `src/app/auth.guard.ts` | Asks the server whether the cookie is still valid |
| `src/app/shared/api.service.ts` | HttpClient wrapper: base path, cookie, error shape |
| `src/app/shared/settings.service.ts` | Permission matrix and what the current identity may do |
| `src/app/shared/expense.service.ts` | Expense calls and the settled-only total |
| `src/app/shared/balance.service.ts` | Balance account calls |
| `server/src/` | Express API — routes, auth, database pool |
| `server/src/rate-limit.mjs` | Fixed-window limiter for the endpoints that take a password |
| `server/migrations/` | SQL migrations |
| `src/app/add-expense/` | Add-expense form and its date-confirmation popup |
| `src/app/expense-list/` | Filtering, sorting, approval, and deletion |
| `src/app/bal-mnt/` | Balance account rows |
| `src/app/settings/` | Admin password and the permission toggles |
| `scripts/publish-docs.mjs` | Syncs a production build into `docs/` |

## Adding expenses over WhatsApp

A user can link their phone once and then record an expense by sending a
message, without signing in:

```
250 coffee                 →  ₹250, "Coffee"
1200 groceries hdfc        →  spends from the HDFC Bank account
80 chai cash               →  spends from Hand Cash
paid 1,250.50 for dinner   →  filler words are ignored
```

Naming a saved balance account debits it, subject to the same permission the
web form uses. Other commands: `balance`, `today`, `undo`, `help`.

### Linking a number

The user opens **Settings → Add expenses over WhatsApp** and taps **Connect
WhatsApp**. If `WHATSAPP_BUSINESS_NUMBER` is set they get an **Open WhatsApp**
button that launches the chat with `link ABC123` already typed — they just press
send. Otherwise the code is shown to copy. Either way the code is single-use and
expires in 15 minutes, which is what proves they control that handset.

### Server setup

Create a Meta app at [developers.facebook.com](https://developers.facebook.com)
and add the WhatsApp product, then fill these into `.env`:

| Variable | Where it comes from |
| --- | --- |
| `WHATSAPP_TOKEN` | WhatsApp → API Setup → temporary or permanent access token |
| `WHATSAPP_PHONE_NUMBER_ID` | API Setup — the numeric **ID**, not the phone number |
| `WHATSAPP_VERIFY_TOKEN` | Any string you invent; paste the same one into Meta |
| `WHATSAPP_APP_SECRET` | App Settings → Basic → App Secret |
| `WHATSAPP_BUSINESS_NUMBER` | Optional — your number, digits only, for the one-tap link |

Point Meta's webhook at `https://<your-host>/api/whatsapp/webhook` and subscribe
to the **messages** field. The endpoint must be public HTTPS — for local work,
tunnel it (`cloudflared tunnel --url http://localhost:3000`) and note that the
quick-tunnel URL changes on every restart.

Leaving the variables blank disables the feature; the Settings page then says
WhatsApp is not configured rather than offering a broken button.

### Cost

Inbound messages are free. Each reply counts as a Meta "service message": the
first **1,000 per business number per month are free**, and Meta charges beyond
that (this changed on 1 October 2026 — service messages used to be unlimited).
Add a payment method even if you expect to stay inside the free tier, as Meta
stops delivering once you exceed it without one.

## Database schema

| Table | Holds |
| --- | --- |
| `users` | Accounts. `password_hash` and `admin_password_hash` are bcrypt |
| `balances` | Balance accounts, one set per user |
| `expenses` | Settled and pending entries, `status` is `done` or `pending` |
| `user_settings` | The ten permission flags, one row per account |
| `whatsapp_link_codes` | Short-lived one-time codes for linking a number |
| `whatsapp_processed_messages` | Message ids already handled, so Meta's retries don't double-book |
| `schema_migrations` | Which migrations have been applied |

Migrations live in `server/migrations/` and run in filename order, each in its
own transaction.

## API

All routes are under `/api` and require the session cookie except where noted.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness plus a database ping (no auth) |
| `POST` | `/api/auth/register` | Create an account and sign in (no auth) |
| `POST` | `/api/auth/login` | Sign in as user or admin (no auth) |
| `POST` | `/api/auth/logout` | Clear the session |
| `GET` | `/api/auth/me` | The current session |
| `PUT` | `/api/auth/admin-password` | Set the admin password |
| `POST` | `/api/auth/admin-password/remove` | Clear it, given the current one |
| `GET`/`POST` | `/api/expenses` | List / create |
| `POST` | `/api/expenses/:id/approve` | Settle a pending entry |
| `DELETE` | `/api/expenses/:id` | Remove an entry |
| `GET`/`POST` | `/api/balances` | List / create |
| `PUT`/`DELETE` | `/api/balances/:id` | Update / remove |
| `GET`/`PATCH` | `/api/settings` | Read / partially update the flags |
| `GET`/`POST`/`DELETE` | `/api/whatsapp/link` | Link status / issue a code / unlink |
| `GET`/`POST` | `/api/whatsapp/webhook` | Meta's handshake and inbound messages (signed, no cookie) |

## A note on security

Passwords are hashed with bcrypt on the server and never leave it. The session is a
signed JWT in an httpOnly cookie, so page scripts cannot read or forge it, and every
permission the UI honours is enforced again in the API — the browser is not trusted to
decide what it may do.

Changing an existing admin password needs the current one, or a session already signed
in with it. Without that, anyone holding the ordinary account password could replace the
admin password with their own and grant themselves everything it was hiding.

The endpoints that take a password are rate limited per address and per account, so a
guessing run stops after ten tries in ten minutes rather than continuing indefinitely.

Responses carry a content security policy, `X-Frame-Options: DENY` and friends, so the
site cannot be framed by another page and a successful injection has nowhere to send
anything. Over HTTPS it also sends HSTS.

Because that policy sends `script-src 'self'`, **nothing inline may execute**: not a
`<script>` block in `index.html`, not an `onload=` attribute. Two things fell foul of
that and left the production build unstyled, so both are now arranged around it.

- The theme bootstrap, which sets the dark attribute before the first paint, lives in
  `public/theme-init.js` and is loaded with `src`. Inline, it was refused and dark mode
  flashed light on every load.
- `inlineCritical` is switched off in `angular.json`. With it on, the build inlines
  above-the-fold CSS and defers the real stylesheet behind
  `media="print" onload="this.media='all'"` — an inline handler the policy blocks, so
  the stylesheet stayed on `media="print"` and never applied. Every page then rendered
  from the small inlined fragment alone: light-only, with the dark theme and the shared
  `.et-*` primitives missing. Turning it off costs a render-blocking stylesheet on the
  first visit and keeps the pages looking like themselves.

If a page ever renders as plain unstyled HTML, read the browser console first: a CSP
refusal is the likely cause, and it is silent apart from that line.

`.env` holds the database credentials and is gitignored. Do not commit it.

### Still outstanding

- **The Aiven certificate is not verified.** The connection is encrypted, but without
  the project CA the server at the other end is not authenticated. Download it from the
  Aiven console to `server/certs/ca.pem`, or point `PGSSLROOTCERT` at it, and the
  connection verifies itself — the code already looks for both.
- **Angular 19 has published advisories** that are only fixed in 21. The upgrade is a
  major version step, so it is a deliberate piece of work rather than a patch. See
  `npm audit --omit=dev`.
- **A session outlives a password change.** Changing the password does not invalidate
  cookies issued before it, for up to the seven-day session life. Closing this means
  recording the moment of the change on the user row and comparing it against the
  token's `iat` on every authenticated request — one extra database round trip per
  request, which is why it has not simply been switched on.
