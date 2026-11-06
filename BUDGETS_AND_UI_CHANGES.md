# Expense Tracker — Monthly Budgets and Layout Redesign

> **For the reader (ChatGPT or a person):** this describes the latest round of work on
> an existing Expense Tracker app: a new **Monthly Budget Management** feature, and a
> redesign of several pages so they fit a laptop screen without scrolling. The app is
> Angular 21 on the front end, Node.js + Express on the back end, PostgreSQL on Aiven,
> hosted on Vercel, with WhatsApp integration. Earlier work is described in
> `PROJECT_OVERVIEW.md` and `RECENT_CHANGES.md`. Full details of the budget feature
> are in `BUDGET_DESIGN.md` and `BUDGET_FEATURE_REPORT.md`.
>
> **Status:** on the branch `feat/budgets`, pushed to GitHub, **not merged into `main`
> and not deployed**. The live site still runs the previous version. The database
> change (new tables) is already applied; the live version ignores it.

---

## Part 1 — Monthly budgets

### What it does

- **Set a budget for any month:**
  - An optional overall limit (for example ₹30,000).
  - Optional limits per expense category (Food & Drink, Travel, Shopping, and the
    rest, plus "Uncategorised").
- **See how you're tracking:** spent against budget, % used, what's left (or how far
  over), days to go, and how many categories are over their limit.
- **Status colours:**
  - **green** under 70%;
  - **amber** from 70%;
  - **red** at 100% and over.

  Each always comes with a word (On track / Near limit / Reached / Over), so colour
  is never the only signal.
- **Copy from an earlier month:** fills the form with the latest earlier budget's
  amounts. You can edit them, and saving asks for confirmation. Spending is never
  copied.
- **History:** 3, 6 or 12 months side by side, showing:
  - budget against spending for each month;
  - the change from the month before;
  - total overspend;
  - "often over budget" categories (for example "Travel, 4 of 6 months").
- **Alerts:**
  - At 50%, 80%, 100% and when going over, for the overall budget and for each
    category.
  - Each fires once per month.
  - They appear as an amber pop-up message after adding or approving an expense, and
    in an "Alerts this month" list.
- **WhatsApp alerts (optional, off by default):** a line added to the normal reply
  after an expense, for example "Travel is at 82% of its ₹3,000 budget — ₹540
  left." It never sends a separate message.

### How spending is calculated (the important part)

Budgets use exactly the same rule as the rest of the app, calculated on the server in
whole paise (no floating-point errors):

- Only **approved** expenses count. A pending one counts from when it's approved.
- A **split bill** counts only **your share** (₹1,455 split four ways counts ₹363).
- **Repayments** from friends are never counted as spending or as income.
- An expense counts in the **month of its date**, not when it was entered.
- Spending is **never stored**: it's recalculated from the expenses every time, so
  deleting an old expense corrects that month straight away.
- An end-to-end test confirmed that budget spending equals the app's own spending
  total for the same month.

### Where it appears

- **Budgets page** (new menu item between Transactions and Cash & Accounts), laid out
  as a one-screen dashboard (see Part 2).
- **Home:** a **Budget card** in the right-hand column. It shows this month's
  figure, the bar, what's left, and the three categories closest to (or over) their
  limit. If there's no budget yet, it invites you to create one.
- **Settings:**
  - The WhatsApp card moves to the top and gains **Budget alerts on WhatsApp**.
  - The permission list gains **Manage budgets**.

### Permissions and security

- **Seeing** budgets needs no special permission. Spending is already visible to
  every sign-in, and budgets show no account balances.
- **Changing** budgets needs the new **Manage budgets** switch (on by default) or the
  full-access password. The server enforces this, not just the page.
- Every lookup is by "your account + month", so there are no IDs in requests for
  someone to guess.
- All inputs are validated on the server:
  - months must be real and at most two years ahead;
  - categories must come from the list;
  - amounts must be positive and sensible;
  - the same category can't be added twice.

### Technical summary

- **Database** (migration `011_budgets.sql`, additive only):
  - `monthly_budgets`, one per user per month;
  - `category_budgets`, one per category per month;
  - `budget_alerts`, remembering which thresholds were already announced so each
    fires once, even when two expenses are saved at the same moment;
  - two new settings columns.
- **API:** `/api/budgets/...`. It returns a month's view, saves a whole month or one
  part of it in a single transaction, offers the latest earlier budget for copying,
  and returns history. Adding or approving an expense now also returns any budget
  alerts it triggered.
- **Tests:**
  - API tests: 154 → **188**.
  - Angular tests: 170 → **198**.
  - An end-to-end run against the real database with a temporary account: **26 of 26
    checks passed**. It covered split share, repayment ignored, pending excluded then
    counted on approval, delete correcting the total, alerts firing once even when
    two saves happen together, copy, history and restricted access.

---

## Part 2 — Layout redesign for laptop screens

The owner uses a laptop at 125% display scaling, which leaves the browser about
1308×652 pixels. Several pages were cut off or needed scrolling. Each was measured at
that size, changed, and measured again.

### Header

- **Shorter:** 54 px instead of 62.
- **Active page marked like a tab:** a white bar sits on the header's bottom edge
  under the current page's name, and the other links are slightly dimmed. On phones
  the bar runs down the left of the item in the menu.
- Clicking a link no longer leaves a box around it; keyboard users still get a clear
  focus ring.

### Footer

- Slimmer on every page: 49 px to **31 px**, with smaller text.

### Home

- **Account cards** (HDFC Bank, Paytm, Cash) are one line each: name and type on the
  left, amount on the right. They're slim but readable, 45 px tall.
- **The WhatsApp "Connect" box** moved from a full-width row at the bottom to under
  the main spending card, on the left half only. The right-hand column now runs the
  full height.
- **Recent** shows the latest **3** expenses, so the Budget card above it can show
  its three categories on a laptop. "See all debits" opens the full list.
- The Budget card and Spending by category card tighten their spacing on shorter
  screens.
- **Result:** everything fits one laptop screen with no page scrolling.

### Transactions

- **Fits the window:** the page itself no longer scrolls. Only the rows scroll, under
  a column-heading row that stays in place.
- **One control line:** the All/Debit/Credit tabs, the Year/Month/Category filters,
  Export CSV and the Debit/Credit/Repaid totals all sit in a single 40 px row. The
  filters read "All years / All months / All categories".
- **Compact rows:** 40 px instead of 59, with every cell vertically centred.
  - About **8 rows** show on a laptop instead of 4.
  - This also fixed a bug where Add Expense's chip styling was stretching the
    Category and Status chips into tall pills with their text at the top.
- The note under the table is smaller.

### Add Income

- Fixed an overlap where the "Recent income" list ran underneath the footer. It now
  shows the latest 3 entries and scrolls inside its own card if needed.

### Budgets page (dashboard layout)

- **Fits one laptop screen** with no page scrolling.
- **Left column:**
  - A compact two-row **month strip**:
    - row one: the figure, % used, and Edit / Copy / Remove;
    - row two: the progress bar with "₹17,556 left · 1 category over · 25 days to
      go".
  - **By category** below it shows all categories without scrolling on a laptop.
- **Right column:**
  - **History** at the top.
  - **Alerts this month** below it, scrolling if there are more alerts than fit. With
    12 months of history, History scrolls inside its own card so Alerts keeps room.
- **Editing** opens as a panel over the page, so the dashboard behind it never moves.
- **On phones** the cards stack and the page scrolls normally.

---

## Part 3 — Sample data

The owner's test account was filled with six months (June–November 2026) of realistic
sample data through the app's own API. Balances, splits and alerts all follow the
real rules. It includes:

- 3 accounts;
- 113 expenses across all categories;
- 11 split bills with 26 repayments from friends;
- a monthly salary plus a refund and a freelance payment;
- a ₹30,000 budget each month, with Travel over budget in 4 of 6 months.

---

## What's next

- **Review** the `feat/budgets` branch on a local run (`npm run dev`).
- **When approved,** merge it into `main`, which deploys to production automatically
  on Vercel.
- **After deploying, check:**
  - create a budget and see it on Home;
  - add an expense that crosses 50% and see the alert;
  - with "Budget alerts on WhatsApp" switched on, send a WhatsApp expense and look for
    the extra line.
- **Still open from the earlier audit:**
  - add the database certificate to Vercel (`DATABASE_CA_CERT`);
  - set up a separate development database;
  - create a restricted database user for the app.
