# Expense Tracker — Complete Project Overview

> **For the reader (ChatGPT or a person):** this document describes the whole
> project end to end, as it stands on **12 November 2026**:
> - what it is and who it is for, and every feature, page by page;
> - the money rules, how the pieces fit together, the data model and the API;
> - the WhatsApp integration, security, testing, deployment, and known gaps.
>
> Use it to explain the project, answer questions about it, or present it. Names in
> **bold** are what the user sees on screen; names in `code` are what the source
> code calls them. Amounts are Indian rupees (₹); dates are India time unless noted.

---

## 1. What the project is

A personal **money tracker** for Indian users, built as a web app with a second way
in: **WhatsApp**. A user can record spending and income on the website, or send a
message like `250 coffee` or `+50000 salary hdfc` from their linked phone, without
signing in.

It tracks:

- **Money out (Debit):** expenses, optionally taken from a specific account.
- **Money in (Credit):** income, always credited to an account.
- **Accounts:** cash in hand, wallets (Paytm, Google Pay…) and bank accounts, each
  with a live balance. Money can be **transferred** between them.
- **Split bills:** one person pays for a group; only their share counts as their
  spending, and the others' repayments are tracked against that bill.
- **Budgets:** a monthly limit overall and per category, with alerts at 50%, 80%,
  100% and over.
- **Recurring transactions:** bills and income that repeat; each is added
  automatically on its date.
- **Savings goals:** money set aside towards a target and date (tracking only).
- **Lending & Borrowing:** money given to or received from people, with partial
  repayments and optional simple interest.
- **Receipts:** photos and PDFs attached to expenses.
- **Import** from CSV or Excel, **export** to CSV, and a 30-day **Recently deleted**
  bin.

A second **full-access password** lets the owner hide balances and lock down actions
when using a shared or public computer.

### The problems it solves

- **Recording is too slow, so people stop.** Here it is one WhatsApp message, or a
  quick form.
- **Spending totals are wrong when you pay for a group.** Here a ₹1,455 shop shared
  by 4 people counts as ₹363 of *your* spending. The ₹364 each friend returns is a
  repayment, not income.
- **Moving money between your own accounts, saving towards a goal, or lending to a
  friend shows up as spending or income in most apps.** Here none of them do. Only
  interest on a loan counts, and it counts once.
- **Balances on a shared screen are a privacy risk.** Here a normal sign-in can be
  made to show no amounts at all.

---

## 2. Technology stack

| Layer | Technology |
|---|---|
| Front end | **Angular 21**: standalone components, lazy-loaded routes, `@if`/`@for` control flow, template-driven and reactive forms. TypeScript 5.9 and RxJS |
| Styling | Hand-written CSS with design tokens (CSS custom properties). Full **light and dark theme**. A "fits the screen" mode on desktop pages |
| Back end | **Node.js + Express 4**, ES modules (`.mjs`) |
| Database | **PostgreSQL** on **Aiven** (Singapore), through `pg` (node-postgres) with plain parameterised SQL |
| Auth | bcrypt password hashes (`bcryptjs`, cost 12). The session is a signed **JWT in an httpOnly cookie** (`jsonwebtoken`, `cookie-parser`) |
| File storage | **Vercel Blob**, private, for receipts and invoices |
| Messaging | **WhatsApp Cloud API** (Meta) through a signed webhook |
| Hosting | **Vercel**: static Angular build, one serverless function for the API, region `sin1` (Singapore) beside the database, and a daily **Vercel Cron** job. A `render.yaml` remains as an alternative host |
| Tests | Jasmine + Karma for Angular (**474 tests**). Node's built-in test runner for the API (**434 tests**, using a stand-in database) |
| Dev tooling | `concurrently` runs the API and web together. The Angular dev server proxies `/api` to Express |

---

## 3. Navigation and pages

**Top menu**, left to right:

**Home · Add Expense · Add Income · Transactions · Planning ▾ · Cash & Accounts**

- **Planning ▾** holds **Budgets**, **Recurring** and **Savings Goals**.
  - With a mouse it opens on hover; on touch, or under 1041px wide, it opens on tap.
  - A red count on **Planning** and beside **Recurring** shows recurring entries
    that need attention.
- **Add Income** and **Cash & Accounts** hide when the sign-in may not use them.
- At 1040px wide or less, the links collapse into a ☰ menu.

**Account menu** (the initials button): **My Profile · Lending & Borrowing ·
Settings · Help & Support · Logout**. **Lending & Borrowing** shows only when the
sign-in may see balances.

A sun/moon button switches between the light and dark theme.

| Page | Route | Component folder | Guard |
|---|---|---|---|
| Login | `/login` | `login-page` | none |
| Register | `/register` | `register-page` | none |
| Home | `/home` | `home` (+ `account-strip`, `balances-layout`, `spending-layout`, `budget-summary`, `goals-strip`) | signed in |
| Add Expense | `/add-expense` | `add-expense` | signed in |
| Add Income | `/add-money` | `add-money` | signed in + **Add income** |
| Transactions | `/transactions?tab=out\|in\|deleted` | `expense-list` (+ `transaction-filters`, `transaction-calendar`, `transaction-details`, `transaction-import`, `recently-deleted`) | signed in |
| Budgets | `/budgets?month=YYYY-MM` | `budgets` | signed in |
| Recurring | `/recurring` | `recurring` | signed in |
| Savings goals | `/goals` | `goals` | signed in |
| Cash & Accounts | `/money` (`?account=<id>` outlines one account) | `bal-mnt` (+ `transfer-form`, `transfer-history`) | signed in + **See account balances** |
| Lending & Borrowing | `/loans` | `loans` (+ `loan-editor`, `repayment-form`) | signed in + **See account balances** |
| My Profile | `/profile` | `profile` | signed in |
| Settings | `/settings` | `settings` | signed in |
| Help & Support | `/help_support` | `help-support` | signed in |

Every page is lazy-loaded, so the first download stays small. Old addresses still
work:
- `/view-expenses` goes to Transactions → Debit.
- `/bal-mnt` goes to `/money`.
- Unknown paths go to `/login`.

---

## 4. Features, page by page

### 4.1 Register and Login

**Registering**
- Name (3+ characters), email and password (8+).
- Optionally a second **full-access password**, which must differ from the first.

**Signing in.** Login takes the same email with either password:
- the **normal password** signs in as a *user*, limited by the permission switches;
- the **full-access password** signs in as the *owner*, with every permission.

**Limits.** Sign-in and password endpoints are rate limited (see §10).

### 4.2 Home (dashboard)

Home has **two layouts**, chosen by whether the sign-in may see balances.

**With balances**
- An **account strip** across the top: one tile per account (name, type, balance),
  largest first, six across on a desktop. Arrows page through the rest.
- A **focus card**:
  - this month's spending, and "₹X more/less than last month";
  - **Add expense**, and a **Last 14 days** bar chart;
  - stats: **Held across accounts**, **Daily average**, **Entries this month**, and
    **On pace for** (from the 4th of the month; before that, **All of last month**).
- **Strips** under the focus card:
  - pending approvals ("N entries are waiting for an admin" → **Pending approvals**);
  - **Connect WhatsApp**, if not linked;
  - the **Savings goals strip**: saved of target, a meter, and the next goal due.
- **Right column:**
  - **Budget · {Month}**: spent of budget, % used, left or over, days to go, and the
    top 3 categories;
  - **Spending by category**: a stacked bar of the top 5, with a legend;
  - **Recent**: the latest 3 expenses. Split rows expand to show who has paid back.
    **See all debits** goes to Transactions.

**Without balances:** the same, but with no account strip, and **Busiest day** in
place of **Held across accounts**.

All spending figures use the user's **own share** of split bills.

### 4.3 Add Expense

**Top line**
- **Amount**.
- **What was it for?**
- **Date** pills: **Today**, **Yesterday**, **Pick a date**.

**Category (optional).** Icon chips:
- Food & Drink, Groceries, Travel, Shopping, Bills & Utilities, Health,
  Entertainment, Education, Family & Gifts, Other.
- None means "Uncategorised".

**Pay from.** Account tiles, each showing its balance or "Balance hidden", plus a
**No account** tile ("Just log it"). With many accounts, only this list scrolls.

**Split bill.** A switch with a −/+ counter of people *including yourself* (2–50).
- The preview reads "Your share ₹363 · ₹364 each from the other 3".
- The full amount still leaves the account.

**Receipts.** An inline picker: drop or choose photos and PDFs. They upload after
the expense is saved.

**Buttons:** **Log only** (no account), or **Add and pay from <account>**.
- Paying from an account needs **Debit from an account**.
- The server refuses to overdraw.

**Dates.**
- Today is normal. Another date asks for confirmation.
- Without **Change transaction dates**, that entry is saved as **Pending approval**,
  and no money moves until the owner approves it.

**Side column:** a "What will be saved" slip.
- It shows "<account> after ₹X → ₹Y", when balances are visible.
- It warns when the expense would overdraw.
- A WhatsApp card shows the equivalent message.

The maximum is ₹1,00,000 per entry.

### 4.4 Add Income

**Top line.** The same as Add Expense: **Amount**, **Where did it come from?**, and
the date pills.
- **Yesterday** and **Pick a date** need **Change transaction dates**.

**Income source (optional).** Salary, Business, Refund, Gift, Interest, Sold
something, Other.

**Is someone paying back a split?**
- A **No, it's income** tile, plus one card per open split ("₹X of ₹Y back", with a
  bar).
- Picking a split makes the entry a **repayment**, not income. Paying back more than
  is still owed is refused.

**Add to.** An account tile (required).

**Button:** **Add ₹X to <account>**, or **Record ₹X paid back**.

**Side column:** the slip with the balance after, **Recent income** (last 3), and
the WhatsApp card.

**Permissions:** needs **Add income** and **Debit from an account**.

### 4.5 Transactions

**One ledger for both directions.** On a desktop it fits the window: a side panel
on the left, the list on the right, and only the rows scroll.

**Side panel**

**Totals** (2 × 2):
- **Debit · your share**: settled expenses, using your share of splits.
- **Credit**: income, excluding repayments.
- **Repaid on splits**.
- **Net**: credit minus debit.
- The totals cover every row matching the filters and search, whatever the tab. A
  total outside the current tab is greyed out.

**Show** tabs: **All · Debit · Credit · Deleted**. A reset icon beside **Show**
clears the tab, every filter and the search.

**Year** (All years, the last 5 years, Older) and **Month** (All months,
January–December), side by side.

**Date range:** All time, Today, This week (Mon–Sun), This month, Last month, This
year, **Custom range**.
- Picking a year or month clears the date range, and the other way round, so the two
  never contradict each other.
- **Custom range** puts **From**/**To** fields in the Year/Month row, so the panel
  keeps its height.

**Import** and **Export** at the foot (see below).

**List header**

**Search** ("Search name, amount, notes…"):
- Every word must match, in any of these:
  - description, category, account and status;
  - notes and payment method (imported entries) and the file name;
  - remarks, and the split a repayment belongs to.
- Amounts match with or without ₹ and commas. A split also matches your share.

**Filter** menu: multi-select checkboxes, applied with **Apply filters**.
- **Category**, **Status** (Approved / Pending), **Account** (and "No account"),
  **Payment method** (if any imported entry has one).
- **Amount** min and max.
- A count badge shows how many are on.

**List / Calendar** switch. The filters carry across.

**Chips** above the table. One removable chip per active filter or search, plus
**Clear all**.

**Table**

- **Columns:** Date, Amount, Description, Category (**Source** on Credit), Account
  (with permission), Status.
- **Sorting:** click a column for ascending, descending, then back to newest first.
- **Rows:**
  - debits have a red stripe, credits a green one, and credit amounts show as `+₹`;
  - status chips: **Completed**, **Pending approval**, **Credit**;
  - a paperclip shows the receipt count;
  - "Split 4 · yours ₹363" marks a split, and "Repayment for …" a repayment.
- **50 rows per page**, with a pager showing "1–50 of N". Below 760px wide, rows
  become labelled cards.

**Calendar view** (a month grid, Monday first)

- **Summary:** Income, Expenses · your share, Net, Transactions.
- **Each day** shows −₹ spent, +₹ income and the number of entries. Today is
  highlighted. On a phone, amounts shorten (₹1.4k) with dots.
- **High** marks a day whose spending is more than twice the month's average
  spending day (at least 3 spending days are needed).
- **Choosing a day** lists its entries, with the day's spent, in and repaid figures;
  each entry opens the details drawer. Arrow keys move between days.
- **Month navigation** (‹ month ›, **Today**) replaces the title. The Year, Month and
  Date range controls are set aside while the calendar is showing.

**Details drawer** (any row: click, Enter or Space)

- **Header:** amount and status.
- **Account**: **Paid from** or **Added to**.
- **Your share** and the number of people, for a split. The time it was added, and
  remarks.
- **For imported entries:** the file name, payment method and notes.
- **For a split:** **Paid back** ("₹X of ₹Y", each repayment, still to come).
- **For a repayment:** a link to the split it pays back.
- **Receipts & invoices** (expenses):
  - up to 10 files, previewed in place (images, and PDFs in a frame);
  - download, remove, and attach more.
- **Footer:**
  - **Approve**, for a pending entry; needs **Change transaction dates**.
  - **Remove entry**, with an inline confirmation. It goes to Recently deleted, and
    its money goes back.
  - Interest filed by Lending & Borrowing shows "reverse that repayment there"
    instead of Remove, with a link.

**Deleted tab: Recently deleted**

- **Filters:** **All / Expenses / Income**, and a search.
- **Columns:** Description (with tags), Type, Amount, Account, Date · deleted, and
  **Left** (days until it is deleted for good).
- **Actions:**
  - **Restore**: re-applies the money. It is refused if the account is short or has
    been deleted.
  - **Delete for good**.
  - **Empty**: everything.
- Every action asks first and says what happens to the money.

**Import (CSV or Excel)**

- **Menu:** **Import CSV**, **Import Excel (.xlsx)**, and sample templates (Expense,
  Income, Expense + Income) as CSV or Excel.
- **Template columns:** `Date, Description, Amount, Category, Account, Notes, Payment Method`.
  The combined template adds `Type`. Many bank headings are recognised (Narration,
  Withdrawal / Deposit, Dr / Cr…).
- **Steps:** **Columns → Check → Import → Report**.
  - **Columns:** map any heading that wasn't recognised.
  - **Check:** filter tabs (All, Ready, Duplicates, Need fixing, Left out); fix or
    edit rows in place; file unknown categories under Other; set an account for rows
    with none.
  - **Confirm:** shows the totals and the balances that will change.
  - **Report:** shows the counts, with **Download the failed rows**.
- **Rules:**
  - up to 5 MB and 2,000 rows; day-first dates; no future dates;
  - amounts up to ₹1,00,000, with ₹, Rs or brackets allowed;
  - categories and accounts must exist.
- **Duplicates:** the same kind, date, amount and description as an existing entry,
  or an earlier row in the file, is left out unless you keep it. Importing the exact
  same file again shows a warning.
- **Safety:**
  - rows go in chunks of 50, each row on its own;
  - a retry never double-imports;
  - every row goes through the same code as Add Expense and Add Income;
  - **Update account balances** can be switched off, for entries the balances
    already include.

**Export CSV**

- Exports every matching row (all pages, current sort). With filters on, the button
  reads **Export N**.
- **File names:**
  - `transactions-YYYY-MM-DD.csv`, `expenses-…` or `money-in-…`, with `filtered-`
    added when narrowed;
  - the columns suit the tab.

### 4.6 Cash & Accounts (with transfers)

**Accounts.** One card per account (icon, name, type, balance) and a total
("₹X across N accounts").
- **Add account:** type (**Bank Account**, **Wallet**, **Cash in hand**), a name
  (presets or **+ Add new**), and an **opening balance**.
- Accounts are not edited. A figure changes only by recording what happened, so there
  is always a reason.
- **× deletes** an account only when it holds ₹0 and nothing points at it:
  - expenses or income, including entries in Recently deleted;
  - transfers;
  - lending records;
  - recurring schedules that are still running.
- Otherwise the dialog lists the reasons.

**Transfer money**

- **Fields:** **From**, **To**, a swap button, **Amount** (**All** fills the whole
  balance), **Date** (today, or earlier with **Change transaction dates**), and
  **Description**.
- **What happens:** the source is debited and the destination credited, in one
  transaction.
- **Rules:**
  - it is refused if the source is short; moving the whole balance to ₹0 is fine;
  - a double click or retry is recorded once.
- **Never** income, an expense or budget spending.

**Transfers history.** Date, From → To, Description, Amount, with filters by account
and dates.

**Links in.** `?account=<id>` (used from Lending & Borrowing) outlines one account
and scrolls to it.

**Permissions.** A sign-in that may see balances but not change them gets a
read-only page.

### 4.7 Budgets (Planning ▸ Budgets)

**Month and overview**

- **Header:** pick a month with ‹ ›, and **This month**.
- **Overview:** "₹spent of ₹total", **N% used**, then "₹X left" or "₹X over budget",
  categories over, and days to go.
- **Buttons:** **Create budget** / **Edit budget**, **Copy from {last budgeted month}**,
  **Remove**.

**By category.** A table of Category, Budget, Spent, Left and Used ("On track", "Near
limit", "Reached", "Over"). "Not budgeted" lists spending in categories with no
limit.

**History.** 3, 6 or 12 months of meters, with:
- the change from the previous month;
- the total over budget;
- "Often over budget: **Travel** (4 of 6 months)".

**Alerts this month.** Each threshold crossed, with its date.

**Editor.** An optional **Overall budget**, plus per-category amounts.
- It warns when the categories add up to more than the overall.
- An overall budget, a category, or both is required.

**Rules**

- **What counts:** settled, live expenses, at your share of splits, in the month of
  their date.
  - Income, repayments, transfers, loan principal and goals never count.
  - Loan interest paid does count, under **Other**.
- **With no overall amount,** the categories' sum stands in as the total.
- **Status:** green under 70%, amber from 70%, red at 100% and over.
- **Alerts** at **50%, 80%, 100% and over**:
  - each fires once per month per scope (overall, or a category);
  - changing a scope's amount re-arms it.
- **When alerts are checked:** after an expense is added, an approval, a restore, a
  recurring entry, an import, and WhatsApp expenses.
- **Where alerts appear:** as a warning toast on the website, and on WhatsApp if
  switched on.
- **Months allowed:** from 2000 to 24 months ahead.
- **Who can change budgets:** viewing is open to every sign-in; changing needs
  **Manage budgets**.

### 4.8 Recurring (Planning ▸ Recurring)

**Page**

- **Summary:** **Active**, **Due in the next 7 days**, **Needs attention**, and
  "Each month, about ₹X out · ₹Y in".
- **Schedules table:** tabs **All / Debit / Credit / Paused & ended**.
  - **Columns:** description, type, amount, **Repeats** ("Monthly on the 31st",
    "Every 2 weeks on Friday"), **Next**, account, status.
  - **Row actions:** Edit, Pause/Resume and Delete.
- **Right column:**
  - **Needs attention:** failed runs, with **Try again** / **Skip this one**;
  - **Coming up · next 7 days**;
  - **Recent runs**.

**Editor**

- **Type:** **Expense (debit)** or **Income (credit)**.
- **Description, amount** (up to ₹1,00,000) **and category**.
- **Account:**
  - an expense may have none ("just list it");
  - income must have one.
- **Repeats:**
  - Daily, Weekly, Monthly, Yearly, or **Custom** (every 1–99 days, weeks, months or
    years);
  - a preview of the next 4 dates.
- **Starts on.** Earlier than today needs **Change transaction dates**.
- **Ends:** never, or on a date.
- **Remind me:** off, on the day, or 1, 3 or 7 days before.

**Rules**

- **Nothing is created in advance.** Each occurrence becomes a real expense or income
  entry on its date:
  - from the **daily cron** (00:05 India time, for every user);
  - when the user opens the app (sync).
- **Dates count from an anchor.** "Monthly on the 31st" falls on 28/29 February, then
  goes back to the 31st.
- **Each occurrence is recorded once.** A unique (schedule, date) pair, and a unique
  link from the entry, mean it can never post twice.
- **A refused occurrence** (not enough money, account deleted) moves no money and is
  kept as **failed**, with the reason.
  - It is retried automatically up to 3 times, once a day.
  - Or the user can **Try again** or **Skip**.
- **Catch-up** adds up to 31 missed dates per schedule, each on its own date.
  **Pause** stops posting, and **Resume** continues from today, with no back-fill.
- **Edits** apply from the next date. **Deleting** a schedule keeps the entries it
  already added.
- **Reminders:** toasts when the app opens, and optional lines in WhatsApp replies.
- **Permissions:** changing needs **Manage recurring**, plus the money permissions.

### 4.9 Savings goals (Planning ▸ Savings Goals)

**Tracking only. Account balances never change here.**

**Page**

- **Totals:** **Total target**, **Total saved** (%), **Active goals**, **Completed goals**.
- **Goal cards:** tabs **Active / Paused / Completed / All**.
  - **Each card:** icon, name, date, state chip, bar, "₹saved of ₹target", and a note
    such as "₹X a month".
- **Detail panel:**
  - **Target date** and **To get there** ("₹X a month for N months");
  - **Add money** / **Withdraw**;
  - **Pause**, **Resume**, **Mark complete**, **Reopen** and **Delete**;
  - a **History** of every addition and withdrawal, with the total each left.

**Editor**

- Name, description, target amount and target date.
- **Already saved** (on creation only).
- One of 10 icons.
- A live "about ₹X a month" guide.

**Rules**

- **Arithmetic:** all in paise.
- **Monthly amount:** what's left ÷ months left, rounded up.
- **States:** **on track**, **behind**, **date passed**, **reached** (a goal never
  completes by itself), **paused** and **completed**.
- **Withdrawing:** you can't take out more than is saved.
- **Permissions:** changing needs **Manage savings goals**.

### 4.10 Lending & Borrowing (account menu, above Settings)

**Money given and money received, kept apart from spending and income.**

**Summary cards**

- **Money lent**, **Money borrowed**.
- **To receive** and **Left to pay**, each with the interest included.
- **Interest received**: counted as income.
- **Interest paid**: counted as expenses.

**Tabs:** **Money given**, **Money received**, **Repayment history**.

**Filters:** person, status, account and dates.

**Each record shows:**
- the person (with initials), the account used and the dates;
- a repaid bar, the status chip, and what is still owed.
- **Statuses:** **Active**, **Partially paid**, **Completed**, **Overdue** (past the
  expected date with money still owed) and **Cancelled**.

**Detail panel**

- What is owed, split into principal and interest.
- Principal, Repaid, and **Given from** / **Received into** with **Open account**.
- Dates.
- **Interest:** e.g. "12% a year, simple · built up ₹240 · received ₹0 · ₹X owed by
  the expected date if nothing more is paid".
- Notes.
- **Record money back** / **Record a payment**, and **Cancel record**.
- Every repayment, each with its own account.

**Recording money given or received**

- **Fields:**
  - **I gave money** / **I received money**;
  - the person's name and optional contact;
  - amount and date;
  - **Given from** / **Received into** (a saved account);
  - optional **Expected repayment** date;
  - **I charge / I pay interest**, with a rate and **per Month / Year**;
  - notes.
- **What it does to accounts:**
  - money given **debits** the account, and is refused if it holds too little;
  - money received **credits** it.
- **The principal is never an expense or income.**

**Repayments**

- **Many partial repayments, each into or out of the account chosen for it,** which
  need not be the original.
  - The form shows the principal owed, the interest due, and the total owed on the
    chosen date.
  - Quick amounts: **Everything** and **Interest only**.
  - A preview shows the split, e.g. "₹5,000 principal + ₹240 interest".
- **Rules:**
  - more than is owed is refused;
  - paying back a debt needs the account to hold the whole amount;
  - repayments are recorded in date order.

**Interest (simple, never compounded)**

- **Per day:** principal still owed × rate ÷ 365. A monthly rate counts 12 times a
  year.
- **Rounding:** once, over the whole period, half up.
- **Unpaid interest** earns nothing, and interest stops once the principal is repaid.
- **A repayment pays the interest due first, then principal.** The split is fixed
  when it is recorded.
- **Interest received** is filed as an ordinary **Interest** income entry ("Interest
  from Asha").
- **Interest paid** is filed as an ordinary expense under **Other** ("Interest paid
  to Ravi").
- Both are linked to the repayment, so every total counts them exactly once.
  Transactions won't remove them on their own.

**Reverse and cancel**

- **Reverse** the latest repayment: its money goes back, and its interest leaves
  income or expenses. The repayment stays in the history, marked.
- **Cancel record:**
  - asks for confirmation, with an optional reason;
  - reverses every repayment, newest first, then the principal, all in one go;
  - if any account can't cover its part, none of it happens;
  - nothing is deleted: the record stays, marked **Cancelled**.

**Editing**

- The name, contact, expected date and notes can always change.
- The amount, date and interest can change only until money comes back. A changed
  amount moves the original account by the difference.
- The account can never change.

**Permissions:** seeing it needs **See account balances**; recording needs
**Debit from an account** too (the same as transfers).

### 4.11 Settings

- **Header chip:** **Signed in as admin** or **Signed in as user**.
- **Add expenses over WhatsApp:** connect or disconnect the phone (see §5).
  - Two **preferences**, both off by default, that add lines to replies the user is
    already getting (never a message of their own):
    - **Budget alerts on WhatsApp**;
    - **Recurring reminders on WhatsApp**.
- **Full access:** create, change or remove the full-access password.
  - Removing it restores every permission, and turns both preferences off.
- **Permission switches.** They apply to the normal sign-in; the owner always has
  all of them. Only a full-access sign-in can change them.

| Switch | What it controls |
|---|---|
| See account balances | Every amount held: Home balances, Cash & Accounts, Lending & Borrowing, WhatsApp balance replies |
| Add income | The Add Income page and `+` messages over WhatsApp |
| See balances over WhatsApp | Whether WhatsApp replies quote balances (needs the switch above too) |
| Debit from an account | Whether spending may lower a balance; also needed to add income, transfer, or manage accounts and lending |
| Change transaction dates | Other dates without approval; approving pending entries |
| See which account was used | The Account column, account details and the account filter |
| Remove an expense | Remove, `undo`, and the Recently deleted actions |
| Manage budgets | Creating and changing budgets |
| Manage recurring | Creating, changing, pausing and deleting schedules |
| Manage savings goals | Creating goals, adding and withdrawing |

Every switch is enforced again on the server, not just hidden in the page.

### 4.12 My Profile

- **Your details:** name and email. Changing the email needs a password.
- **Your password:** change it. This needs the current one and signs out other
  devices.
- **Linked WhatsApp:** a masked number (`••••• 1234`).
- **Your data:** **Download my data** as CSV.
- **Delete this account:** permanent and needs the password. Everything goes with
  it.

### 4.13 Help & Support

- Every WhatsApp command and what it does.
- Splitting a bill over WhatsApp, in three steps.
- An FAQ covering:
  - balances, ambiguous account names, pending entries, deleting, splitting and
    repayments;
  - budgets and how they count splits;
  - the full-access password, "Uncategorised", WhatsApp, income and CSV export.
- **Your setup:** WhatsApp, full access, and the number of accounts.
- **Contact support**.

---

## 5. WhatsApp integration

### Linking a phone

1. Go to **Settings → Add expenses over WhatsApp → Connect WhatsApp**.
2. The server issues a single-use **6-character code**, valid for **15 minutes**, with
   no confusable characters.
3. **Open WhatsApp** opens the chat with `link ABC123` already typed; the user
   presses send.
4. From then on, messages from that number are recorded for that account.

An unlinked number gets only a "not connected" reply, at most 5 per hour.

### What you can send

| Message | Result |
|---|---|
| `250 coffee` | Records ₹250 "Coffee"; no account named, so no balance changes |
| `1200 groceries hdfc` | Records it and debits HDFC Bank (needs **Debit from an account**; refused if short) |
| `80 chai cash` | Debits the cash-in-hand account |
| `paid 1,250.50 for dinner` | Filler words ignored; commas and decimals understood |
| `+50000 salary hdfc` | **Income** (the leading `+`, or words like *received*, *salary*, *refund*), credited to HDFC, source Salary |
| `1455 vegetables hdfc split 4` | Split expense: ₹1,455 leaves HDFC, your share ₹363, others ₹364 each (`split by 4`, `split 4 ways` also work; 2–50 people) |
| `+364 vegetables share hdfc` | A **repayment** towards the vegetables split |
| `splits` | What people still owe you, per split |
| `balance` | Every account and its balance (needs both balance switches) |
| `today` | Today's entries and total, at your share for splits |
| `undo` | Moves the last WhatsApp entry (expense or income) to **Recently deleted**, putting its money back |
| `help` | The command list |

### Reply format

```
✅ ₹1,200 · Groceries · HDFC Bank · Groceries
HDFC Bank now ₹8,800              (only if balances may be shown)
⚠️ Groceries is at 82% of its ₹3,000 budget — ₹540 left.   (budget alerts on)
🔔 Rent ₹15,000 is due tomorrow.  (recurring reminders on)
Send *undo* to remove it.
```

Income replies start with ➕ and can carry recurring lines, but not budget lines.

### How messages are understood (`server/src/whatsapp/parser.mjs`)

- **Amount:** the first standalone number; the rest is the description.
- **Account matching:** a word that matches one of the user's saved accounts.
  - If two accounts match, it asks which one rather than guessing.
- **Category:** guessed from keywords. If the description is unclear, the entry is
  left uncategorised.
- **Repayments:** with `share`, a word from the expense's name picks the split.
  - With only one split open, no name is needed.
  - If the split is ambiguous, it asks.
- **Permissions:** WhatsApp always acts with the **normal user's** permissions.

### Reliability and safety

- **Signatures:** Meta signs every webhook call; the server verifies the HMAC
  signature.
- **Duplicates:** each message id is stored, so retries never double-record.
- **Late messages:** a message sent more than **15 minutes** before it arrives is
  ignored.
- **Timing:** the webhook answers Meta at once, and does the work after the response
  (Vercel `waitUntil`).
- **Diagnostics:** `npm run wa:check` and `npm run wa:recent`.

---

## 6. The money rules (what counts as what)

| Event | Account balance | Counted as spending | Counted as income |
|---|---|---|---|
| Expense paid from an account | − amount | Yes (your share if split) | — |
| Expense logged with no account | unchanged | Yes | — |
| Pending expense (other date, no permission) | unchanged until approved | Only once approved | — |
| Income | + amount | — | Yes |
| Split repayment | + amount | — | **No** (shown as **Repaid**) |
| Transfer between your accounts | − one, + the other | No | No |
| Savings goal addition/withdrawal | unchanged | No | No |
| Money lent / borrowed (principal) | − / + | No | No |
| Principal repaid (either way) | + / − | No | No |
| Interest received on a loan | + | — | **Yes** (Interest) |
| Interest paid on a debt | − | **Yes** (Other) | — |
| Removing an entry | money put back | No longer | No longer |

### Split bills

- **Rounding:** each of the others pays the bill ÷ the number of people, rounded to
  the nearest rupee, and the payer absorbs the remainder. For example, ₹1,455 ÷ 4
  gives the others ₹364 each and the payer ₹363.
- **Storage:** the expense stores `split_members`, `split_share` and
  `personal_share`. A constraint keeps all three set or none.
- **Repayments** are income rows linked by `split_expense_id`. They are refused
  beyond what is still owed, under a row lock.
- **Totals:** every spending total uses `personal_share` when it is present.

### Precision

- **Money:** amounts are `numeric(14,2)` in the original tables and whole **paise**
  (`bigint`) in the newer ones (goals, transfers, lending). Arithmetic happens in
  paise, so totals never drift.
- **Dates:** "today" is India's date (`Asia/Kolkata`) on both the server and the
  page.

---

## 7. Architecture

```
Browser (Angular SPA)
   │  HTTPS, httpOnly session cookie
   ▼
/api/*  ──►  Express app (server/src/app.mjs)
              ├── routes/auth.mjs          register, login, profile, passwords, delete account
              ├── routes/balances.mjs      accounts, usage check before delete
              ├── routes/transfers.mjs     transfers between accounts
              ├── routes/expenses.mjs      expenses, approve, remove, splits
              ├── routes/attachments.mjs   receipts on an expense (Vercel Blob)
              ├── routes/incomes.mjs       income and repayments
              ├── routes/imports.mjs       CSV/Excel preview and import
              ├── routes/recycle-bin.mjs   Recently deleted
              ├── routes/budgets.mjs       budgets, history, alerts
              ├── routes/recurring.mjs     schedules, runs, sync, daily cron
              ├── routes/goals.mjs         savings goals
              ├── routes/loans.mjs         lending & borrowing
              ├── routes/settings.mjs      permission switches
              ├── routes/link.mjs          WhatsApp link codes
              └── routes/whatsapp.mjs      Meta webhook (signed, no cookie)
                     │
                     ▼
              PostgreSQL (Aiven)  ◄── plain SQL through a small pool (db.mjs)

WhatsApp user ──► Meta Cloud API ──► POST /api/whatsapp/webhook ──► same stores
Vercel Cron (00:05 IST) ──► GET /api/recurring/cron ──► recurring + bin clean-up + file sweep
```

**Shared stores.** `expense-store`, `income-store`, `split-store`, `budget-store`,
`recurring-store`, `transfer-store`, `goals-store`, `loan-store`, `recycle-store` and
`import-store` hold the logic. Website routes, the WhatsApp handler, the recurring
runner, import and lending all go through them.
- `insertExpense` and `insertIncome` are the single place an entry is created and its
  account moved.

**Atomic balance changes.** Balances change in the same database transaction as the
record that causes them, under `FOR UPDATE` row locks.
- When several accounts are involved, they are locked in id order.
- Loans and splits are locked before their accounts.

**Idempotency.** Request ids on transfers, loans and repayments. Unique keys on
recurring runs, import rows and loan interest entries.

**Entry points.**
- On Vercel, `api/index.mjs` exports the Express app as one serverless function.
- Locally, `server/src/index.mjs` runs it on a port.

### Front-end structure (`src/app`)

**Services** (`shared/`):
- `api.service.ts`: HttpClient wrapper (base path, cookie, error shape; a 401 means
  the session is lost).
- One per resource:
  - `expense`, `income`, `balance` (also transfers), `budget`, `recurring`, `goals`;
  - `loans`, `import`, `recycle-bin`, `attachment`;
  - `settings` (the permission getters), `whatsapp`.

**Components and directive** (`shared/`):
- `split-history/` and `spend-chart/`;
- `attachment-picker/` and `toast-host/`;
- the `fits-screen` directive.

**Helpers** (`shared/`):
- `csv.ts`, `date-utils.ts` (India's date), `split.ts` (the split preview mirror) and
  `category-icons.ts`;
- `import/` (the CSV, XLSX and zip readers and writers, and the templates);
- `models.ts` (every API shape).

**Elsewhere in `src/app`:**
- `auth.service.ts` and the guards (`auth`, `balance`, `add-money`);
- `theme.service.ts` and `toast.service.ts`.

---

## 8. Database

### Tables

| Table | Holds |
|---|---|
| `users` | name, email (unique), bcrypt `password_hash`, optional `admin_password_hash`, `whatsapp_number`, `session_version` |
| `balances` | the user's accounts: `type`, `category` (the name), `balance` ≥ 0, `saved` |
| `expenses` | amount, description, `spent_on`, category, account (`source_*`), status `done`/`pending`, `source_channel`, split columns, `recurring_run_id`, `loan_repayment_id`, soft-delete columns |
| `incomes` | amount, description, `received_on`, category, account (`target_*`), `split_expense_id`, `recurring_run_id`, `loan_repayment_id`, soft-delete columns |
| `user_settings` | one row per user: the 10 permission switches and 2 WhatsApp preferences |
| `whatsapp_link_codes`, `whatsapp_processed_messages` | link codes; message ids already handled |
| `rate_limit_buckets` | shared rate-limit counters |
| `monthly_budgets`, `category_budgets`, `budget_alerts` | a month's overall amount; per-category amounts; thresholds announced (50/80/100/101 = over) |
| `recurring_schedules`, `recurring_runs` | schedules (frequency, interval, anchor, next date, end, reminder, status); one row per occurrence (posted/failed/skipped, attempts, error) |
| `savings_goals`, `savings_goal_activity` | goals in paise; every addition and withdrawal with the total it left |
| `account_transfers` | from/to accounts (names copied), `amount_paise`, date, description, `request_id` |
| `receipt_attachments`, `attachment_cleanup` | file metadata (storage key, name, type, size); a queue of storage files to delete |
| `import_batches`, `import_rows` | each import (file name, SHA-256, counts); each row's result, notes and payment method |
| `transaction_purges` | one line per entry deleted for good (no description kept) |
| `loans` | direction, person, contact, `principal_paise`, dates, account (name copied), interest (type, rate in hundredths of a %, period), notes, status, `request_id` |
| `loan_repayments` | amount, principal and interest parts (paise), date, its own account, note, `reversed_at`/reason, `request_id` |
| `schema_migrations` | which migrations have run |

### Migrations (`server/migrations/`, each in its own transaction, `npm run db:migrate`)

**Original schema**
1. `001_init.sql`: users, balances, expenses and settings.
2. `002_whatsapp.sql`: WhatsApp linking and processed messages.
3. `003_user_only_permissions.sql`: permissions apply to the normal user only.
4. `004_expense_categories.sql`: expense categories.
5. `005_money_in.sql`: the incomes table.
6. `006_money_permissions.sql`: the balance-visibility and add-income switches.
7. `007_housekeeping.sql`: indexes for undo and pruning.
8. `008_shared_rate_limits.sql`: rate limits stored in Postgres.
9. `009_splits.sql`: the split columns, and `split_expense_id`.
10. `010_session_version.sql`: revocable sessions.

**Feature migrations**
11. `011_budgets.sql`: budgets and alerts, plus their switches.
12. `012_recurring.sql`: schedules and runs, `recurring_run_id`, plus their switches.
13. `013_savings_goals.sql`: goals and activity, plus their switch.
14. `014_account_transfers.sql`: transfers.
15. `015_receipt_attachments.sql`: receipts and the clean-up queue.
16. `016_transaction_imports.sql`: import batches and rows.
17. `017_recently_deleted.sql`: soft-delete columns and `transaction_purges`.
18. `018_lending_borrowing.sql`: loans, repayments and `loan_repayment_id`.

**From 011 on, every migration is additive only:** new tables, nullable columns and
indexes. No existing row is ever changed.

---

## 9. API reference

All routes are under `/api` and need the session cookie unless noted.
- **Bodies:** JSON, capped at 100 KB (2 MB for imports).
- **Errors:** `{ error }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness and database ping (public) |
| POST | `/auth/register`, `/auth/login` | Create account / sign in (public, rate limited) |
| POST | `/auth/logout` · GET `/auth/me` | End session · current user and sign-in type |
| PATCH | `/auth/profile` | Name and email |
| PUT | `/auth/password`, `/auth/admin-password` | Change the password / set or change full access (signs out other devices) |
| POST | `/auth/admin-password/remove` | Remove full access |
| DELETE | `/auth/account` | Delete the account |
| GET / POST | `/balances` | List accounts (amounts hidden without permission) / create |
| GET | `/balances/:id/usage` | Whether an account can be deleted, and why not |
| DELETE | `/balances/:id` | Delete an account (409 with reasons) |
| GET / POST | `/transfers` | Transfer history (filters) / make a transfer (idempotent) |
| GET / POST | `/expenses` | List / create (optional `splitMembers`; returns `budgetAlerts`) |
| GET | `/expenses/categories`, `/expenses/splits` | Categories · every split with its repayments |
| POST | `/expenses/:id/approve` | Approve a pending expense (moves the money) |
| DELETE | `/expenses/:id` | Move to Recently deleted, refunding the account |
| GET / POST | `/expenses/:id/attachments` | List / upload a receipt (raw bytes, `X-File-Name`) |
| GET / DELETE | `/expenses/:id/attachments/:fileId` | View or download (`?download=1`) / remove |
| GET / POST | `/incomes` | List / create (optional `splitExpenseId`) |
| DELETE | `/incomes/:id` | Move to Recently deleted, reversing the credit |
| POST | `/imports/preview` · `/imports/:batchId/rows` | Check up to 2,000 rows · import one chunk |
| GET | `/recycle-bin` | Recently deleted |
| POST | `/recycle-bin/:kind/:id/restore` · `/recycle-bin/empty` | Restore · empty (body `{confirm:"empty"}`) |
| DELETE | `/recycle-bin/:kind/:id` | Delete one for good |
| GET | `/budgets/:month`, `/budgets/history`, `/budgets/:month/previous` | Month view · history · latest earlier budget |
| PUT / DELETE | `/budgets/:month` | Save (overall + categories) / remove a month |
| GET | `/recurring`, `/recurring/upcoming`, `/recurring/runs` | Page data · upcoming · run history |
| POST | `/recurring/sync` | Post what is due for this user |
| POST / PUT / DELETE | `/recurring`, `/recurring/:id` | Create / edit / delete a schedule |
| POST | `/recurring/:id/pause` · `/resume` · `/runs/:runId/retry` · `/skip` | Schedule and run actions |
| GET | `/recurring/cron` | Daily job (Bearer `CRON_SECRET`, no cookie) |
| GET / POST | `/goals` | Goals with totals / create |
| PUT / DELETE | `/goals/:id` | Edit / delete |
| POST | `/goals/:id/pause` · `/resume` · `/complete` · `/reopen` · `/contributions` · `/withdrawals` | Goal actions |
| GET / POST | `/loans` | Records, repayment history and totals / record money given or received |
| GET | `/loans/:id/quote?date=` | What is owed on a date (interest first) |
| PUT | `/loans/:id` | Edit |
| POST | `/loans/:id/repayments` | Record a repayment |
| POST | `/loans/:id/repayments/:repaymentId/reverse` | Reverse the latest repayment |
| POST | `/loans/:id/cancel` | Cancel, reversing everything (body `{confirm:true}`) |
| GET / PATCH | `/settings` | Read / change switches (full access only for changes) |
| GET / POST / DELETE | `/whatsapp/link`, `/whatsapp/link/code` | Link status / issue code / unlink |
| GET / POST | `/whatsapp/webhook` | Meta verification / inbound messages (signature-checked) |

There are 84 route handlers in all. Some smaller budget-editing routes exist that
the page doesn't use.

---

## 10. Security

**Passwords**
- Hashed with **bcrypt** (cost 12), and never sent back.
- An unknown email takes as long as a wrong password.

**Sessions**
- A **signed JWT in an httpOnly, SameSite=Lax cookie**, Secure in production, valid
  for 7 days.
- Production refuses to start without a `JWT_SECRET` of 32+ characters.
- **Revocable:** changing a password, or setting, changing or removing full access,
  signs out every other device (`session_version`).

**Permissions** are enforced on the server for every route. The page only hides
things for convenience.

**Rate limiting**, counted in Postgres so it holds across serverless instances:
- login: 10 per 10 min per IP + email, and 30 per IP;
- registration: 5 per hour;
- password actions: 10 per 10 min per user;
- unlinked WhatsApp numbers: 5 per hour.

**Headers** (identical on the API and the static pages):
- a strict CSP (`script-src 'self'`, no inline scripts, `frame-ancestors 'none'`);
- `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`, `COOP`;
- a Permissions-Policy that turns off the camera, microphone, location and payment;
- HSTS in production;
- API responses are never cached.

**Receipts**
- Stored **privately** and streamed only to their owner.
- The type is checked from the file's own bytes; files over 4 MB, or of any other
  type, are refused.

**WhatsApp and cron**
- WhatsApp: a signature-verified webhook, duplicate-message protection, stale-message
  rejection, and a masked number in the page.
- The cron endpoint uses a timing-safe secret check, and stays closed without one.

**Data safety**
- Parameterised SQL everywhere.
- Row locks and single transactions for every money movement.
- Request ids against double submission.
- Soft delete with a 30-day restore window.

**Secrets** live in `.env` locally and in Vercel environment variables in
production. `.env` is never committed.

### Known outstanding items (from AUDIT_REPORT.md, checked against the code)

- The Aiven CA certificate is not verified until `DATABASE_CA_CERT` is set (the
  connection is encrypted, but the certificate is unchecked).
- Development shares the production database. Every migration since 011 has been
  additive, and testing uses temporary `@localhost.test` accounts, deleted afterwards.
- No Origin/CSRF check beyond the SameSite cookie.
- No "sign out everywhere" button.
- `PATCH /auth/profile` checks a password but has no rate limit.
- The expense and income lists are paged in the browser, but the API returns every
  row.

---

## 11. Design and UX

- **Themes:** light and dark, switched from the header and remembered. The theme is
  set before first paint, so there is no flash.
- **Design tokens:** `--ink`, `--surface`, `--accent`, `--good`, `--bad`, `--warn`
  and others, in `src/styles.css`. Every component works in both themes.
- **Fits the screen:** on a desktop or laptop (≥ 900 × 560), dashboards such as
  Transactions, Budgets, Recurring, Goals, Lending and the Add pages fill the window.
  Only their lists scroll.
- **Responsive:**
  - on phones, tables become labelled cards and the menu collapses to ☰;
  - side panels stack, and dialogs become sheets;
  - no page scrolls sideways at 375px.
- **Accessible:**
  - keyboard-reachable rows and calendar days (arrow keys);
  - ARIA roles on tabs, dialogs and menus;
  - visible focus;
  - reduced motion respected;
  - colour is never the only signal (chips always carry a word).
- **Consistent vocabulary:** Debit / Credit, Add Income, Cash & Accounts, Split
  bill, Repaid, Recently deleted, Money given / Money received, Full access.

---

## 12. Running, testing and deploying

```bash
npm install
npm run db:migrate      # create/upgrade tables (needs DATABASE_URL in .env)
npm run dev             # API (watch mode) + Angular dev server together
```

**Running locally**
- The web app runs on the Angular dev server, which proxies `/api` to the Express
  API (port 3001).

**Testing**
- `npm run test:ci`: Angular tests (474, headless Chrome).
- `npm run test:api`: API tests (434, no database needed; routes run against a
  stand-in database that keeps state).

**Building and diagnostics**
- `npm run build`: production build into `dist/expense-tracker/`. Each component
  stylesheet has a 6 kB budget.
- `npm run db:check` / `db:status`: database diagnostics.
- `npm run wa:check` / `wa:recent`: WhatsApp diagnostics.

**Deployment (Vercel)**
- **Pushing `main` deploys production.** `feat/*` branches never deploy.
- **What gets served:** `vercel.json` serves the Angular build as static files, with
  hashed files cached for a year. It rewrites `/api/*` to `api/index.mjs`.
- **Region:** pinned to `sin1` (Singapore), beside the database.
- **Cron:** one daily job, `/api/recurring/cron` at 18:35 UTC (00:05 India time). It:
  - posts due recurring entries;
  - deletes for good anything in Recently deleted for 30 days (up to 500 per kind
    per run);
  - sweeps orphaned receipt files.
- **Migrations** are run manually, before the code that needs them. They are not run
  on deploy.

**Environment variables** (names only):
- Database: `DATABASE_URL`, `DATABASE_CA_CERT` (or `PGSSLROOTCERT`).
- App: `JWT_SECRET`, `CRON_SECRET` (16+ characters), `BLOB_READ_WRITE_TOKEN`.
- WhatsApp: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`,
  `WHATSAPP_APP_SECRET`, `WHATSAPP_BUSINESS_NUMBER` (optional; enables the one-tap
  link button).
- Platform: `NODE_ENV`, `PORT`. `VERCEL` is set by the platform.

**WhatsApp cost:** incoming messages are free. Replies are Meta "service messages",
and the first 1,000 a month are free.

---

## 13. Current status

**Everything in this document is live on Vercel.** The latest release was deployed on
**10 November 2026** (`main` at `b85eff2`). Release order:

| When | Release |
|---|---|
| to 6 Nov | Accounts, expenses, income, splits and repayments (web and WhatsApp), permissions and full access, security audit fixes, Angular 21 |
| by 9 Nov | Budgets; recurring transactions; savings goals; the Planning menu; transfers and the new Cash & Accounts; receipt attachments; the redesigned Add pages and details drawer |
| 10 Nov | CSV/Excel import with templates; the Transactions redesign (side panel, totals, 50 per page); Recently deleted; search; the Filter menu; the calendar view; Year/Month and Date range; **Lending & Borrowing** |

The database has migrations 001–018 applied.

### Known gaps and ideas

- **Budget alerts** aren't checked when loan interest is paid, though that interest
  counts towards the **Other** budget.
- **Interest paid** is filed under **Other**; the expense categories have no Interest
  category.
- **Recurring schedules** made earlier keep posting even if a permission is switched
  off later; permissions are checked only when a schedule is created or edited.
- **Receipts:** a receipt on an expense in Recently deleted can still be opened or
  removed by its direct link. The list hides it.
- **Export file names** use the UTC date, so between midnight and 05:30 India time
  they carry yesterday's date.
- **Lending:**
  - repayments must be in date order, and only the latest can be reversed;
  - the amount, date and interest are fixed once anything is repaid.

---

## 14. A worked example, end to end

1. **Setting up.** Prajwal registers, sets a full-access password, and signs in with
   it. On **Cash & Accounts** they add *HDFC Bank* with ₹25,000 and *Cash* with
   ₹2,000.
2. **WhatsApp.** In **Settings** they connect WhatsApp by sending `link K7QM2X`, and
   switch on **Budget alerts on WhatsApp**.
3. **A budget.** Under **Planning ▸ Budgets** they set November: overall ₹20,000,
   Groceries ₹3,000.
4. **A split bill.** They pay ₹1,455 for vegetables for 4 flatmates:
   `1455 vegetables hdfc split 4`. The reply says HDFC is now ₹23,545, their share is
   ₹363, and the others owe ₹364 each. Groceries shows ₹363 spent (12%).
5. **A repayment.** A flatmate pays back: `+364 vegetables share hdfc`. That's ₹364
   of ₹1,092 back. It is not income.
6. **Recurring rent.** Under **Recurring** they add rent, ₹15,000 monthly on the
   1st from HDFC, with a reminder 3 days before. On the 1st it is added by itself
   overnight.
7. **A savings goal.** Under **Savings Goals** they start *Goa trip*, ₹30,000 by
   March: about ₹7,500 a month. Their accounts don't change.
8. **Topping up cash.** They move ₹1,000 from HDFC to Cash with **Transfer money**.
   It isn't spending.
9. **Lending.** They lend Asha ₹10,000 from HDFC at 12% a year, due in two months
   (**Lending & Borrowing → Money given**). HDFC drops ₹10,000; spending is
   unchanged. 73 days later Asha returns ₹5,240 into Cash. The repayment form splits
   it into ₹240 interest (filed as **Interest** income) and ₹5,000 principal. Asha
   still owes ₹5,000.
10. **Transactions.** It shows Debit ₹363 (their real spending), Credit ₹240 (the
    interest) and Repaid ₹364. The **Calendar** view shows each day's in and out.
    **Export** downloads exactly what is filtered.
11. **Undo and restore.** A mistaken entry is removed. It waits in **Recently
    deleted** for 30 days, with its money already back, and can be restored.
12. **Another computer.** On an office computer they sign in with the **normal**
    password. No balances appear anywhere, Lending & Borrowing and Cash & Accounts
    are hidden, and only the actions the switches allow are available.
