# Transaction Import — Report

Branch `feat/transaction-import`, from `main` (`d61b7d1`). Pushed to GitHub
only: **not merged, not deployed**. Export is unchanged.

---

## 1. What was built

On **Transactions**, an **Import** button now sits beside **Export CSV**. It
opens a menu with:

- **Import transactions**
  - **Import CSV**: a .csv file from a bank or a spreadsheet.
  - **Import Excel (.xlsx)**: reads the sheet named *Transactions*, otherwise
    the first visible sheet.
- **Download a sample file**, each in **CSV** and **Excel**:
  - Expense template;
  - Income template;
  - Expense + Income template (with a Type column).
- A line on the accepted date and amount formats.

Choosing a file opens a dialog with four steps (**Columns → Check → Import →
Report**):

1. **Reading.** The file's type and size are checked, then the file is read
   (with a progress bar) and the heading row is found.
2. **Columns.** Shown only when a required column can't be matched by name, or
   when you choose **Change columns**. Each app field gets a drop-down of the
   file's columns, with the first value under it as an example. If there is no
   Type column, you choose: every row is an expense, every row is income, or
   negative amounts are expenses and positive amounts are income.
3. **Check.** Every row with its state:
   - **Ready**, **Duplicate**, **Needs fixing**, **Left out**, **Example** or
     **Imported**;
   - the reasons in plain words, with every reason listed, not just the first.

   It has filter tabs with counts. From here you can:
   - **Fix** a row: edit its type, date, description, amount, category or
     account in place, then **Check again**;
   - **Leave out** or **Bring back** a row;
   - **tick a duplicate** to import it anyway;
   - **File them under Other**: fixes every unknown category at once;
   - set **Rows with no account** to one account (a bank statement has no
     Account column, so this fills them all at once);
   - switch **Update account balances** off (for entries the balances already
     include);
   - go back with **Change columns**.
4. **Confirm.** "Import these transactions?" shows how many expenses and how
   much income, how many wait for approval, and how each account's balance
   changes. Then **Yes, import N**.
5. **Importing.** A progress bar ("Importing 150 of 420…"). The dialog can't
   be closed until it finishes. A chunk that fails on a connection or server
   error is sent again automatically (twice). If it still fails, you can **Try
   again** (safe, see §5) or **Stop here**.
6. **Report.** Six counts: rows in file, ready to import, duplicates, invalid,
   imported, failed. Each row is counted once, and a separate line covers rows
   you left out. The report also lists the failed rows with their reasons and
   any budget alerts. It offers:
   - **Download the failed rows** (a CSV with the original cells and the
     reason);
   - **Fix and try again** (back to Check, with imported rows set aside);
   - **Done**.

Imported entries show their source file in the transaction's details. The
**Notes** and **Payment Method** cells appear there too, since the app has no
field of its own for them.

The design uses the existing colour tokens and button styles, so light and
dark themes both work. On a phone the dialog becomes a full-screen sheet below
the app header, and the rows become cards. The card layout follows the
dialog's own width (a container query), not the window's.

## 2. Supported formats

| | CSV | Excel |
|---|---|---|
| Extension | `.csv` | `.xlsx` (not old `.xls`) |
| Size | up to 5 MB | up to 5 MB |
| Rows | up to 2,000 | up to 2,000 |
| Encoding / sheet | UTF-8 (BOM fine), or Windows-1252 from older Excel | sheet *Transactions*, else the first visible one |
| Delimiter | comma, semicolon or tab (detected) | — |

- **Excel notes:**
  - shared strings, rich text, inline strings and formula results are read;
  - cells formatted as dates become dates, in both the 1900 and 1904 date
    systems;
  - floating-point noise is tidied, so 12.300000000000001 reads as 12.3.
- **Heading row:** found among the first ten rows, so a statement with a title
  line above the headings works. Blank rows are skipped, and each row keeps
  its row number from the file for messages.
- **Refused, each with its own reason:**
  - empty files;
  - files with headings but no rows;
  - files over 5 MB or 2,000 rows;
  - `.xls` and password-protected workbooks;
  - files that aren't really .xlsx;
  - the wrong type for the button chosen.
- **Column names:** each field accepts common alternatives (for example
  Narration, Particulars, Txn Date, Withdrawal Amt and Deposit Amt).
  **Separate Money out / Money in columns** (debit and credit) are supported.
  The amount column says which kind each row is.
- **Exports from this app import back in:** Debit/Credit types, the
  *Uncategorised* label, and the apostrophe the export adds before
  formula-like text are all understood.

**Accepted dates** (day first):

- `2026-11-05` (recommended), also with a time after it;
- `05/11/2026`, `5-11-2026`, `05.11.26`;
- `5 Nov 2026`, `05-Nov-2026`, `November 5, 2026`;
- `2026/11/05`;
- an Excel date serial.

Month-first dates (`11/25/2026`) are refused with a message, rather than being
read as the wrong month. Impossible dates (31/02), dates before 2000 and future
dates are refused.

**Accepted amounts:** a positive number in rupees.

- `₹`, `Rs`, `INR` and `/-` are fine, as are Indian or western commas
  (`1,00,000` or `100,000`).
- At most two decimal places.
- Above zero, and no more than **₹1,00,000** per entry (the app's existing
  limit).
- A decimal comma (`250,50`) is refused, since it would risk a hundredfold
  mistake.
- A negative amount is refused unless the row's type is known (from a Type
  column, or by choosing "negative amounts are expenses").

## 3. Templates

The expense and income templates have the same columns:

`Date, Description, Amount, Category, Account, Notes, Payment Method`

The combined template adds **Type** (Expense / Income) after Date.

- **Example rows.** Each template has three realistic rows dated in the last
  week, using the app's own categories and **your own account names** (a
  cash-like one and a bank-like one, or *Cash* and *Bank* if you have none).
  On import, example rows are recognised by description and amount, and **left
  out unless you tick them**.
- **The Excel templates** have three sheets:
  - **Transactions**: frozen bold headings, real date and amount cells, and
    drop-downs for Category, Account and Type;
  - **Instructions**: the steps, a table of every column (required or not,
    what to write), and the date format, amount format, duplicates, what isn't
    imported, and the size limits;
  - **Lists**: the categories, your accounts and the types, which the
    drop-downs use.
- **The CSV templates** carry the headings and examples. The format help is in
  the Import menu.

## 4. Financial integrity

- **Same code as adding by hand.** Every row is created by `insertExpense` or
  `insertIncome`, the functions the Add pages and the recurring runner use. So
  the sufficient-funds check, the account lock (`for update`), approval and
  remarks are identical. The one change to `insertIncome` is an
  `updateBalance: false` option that records the account without crediting it.
  It defaults to crediting, so existing callers behave as before.
- **Existing permissions apply:**
  - an expense dated another day **waits for approval** without "Change
    transaction dates" (pending, no debit until approved), exactly as Add
    Expense does;
  - income needs "Add money" and balance permission, and an account; for
    another day it needs "Change transaction dates";
  - an expense with an account but no balance permission is listed against the
    account without a debit, and the row says so;
  - when this sign-in may not see balances, the overdraw message leaves the
    amounts out.
- **Integer paise.** Amounts are parsed from text into whole paise, with no
  floating point: `1,250.50` is exactly 125050. All totals and the balance
  play-forward are in paise. Rupees are only formed at the call to the
  existing insert, whose numeric(14,2) columns are unchanged.
- **Balance play-forward.** The preview applies the rows in import order (date,
  then money in before money out on the same day, then row number). A row that
  would overdraw an account is flagged now, with the shortfall, instead of
  failing halfway through.
- **Database transactions.** Each chunk of up to 100 rows (the page sends 50)
  is one transaction, under a per-person advisory lock. Each row has its own
  **savepoint**:
  - a refused row (short of money since the preview, a new duplicate) is
    rolled back alone and logged as failed;
  - anything unexpected rolls back the whole chunk.
- **Nothing is skipped silently.** Every row sent is either imported or logged
  as failed with its reasons. Invalid rows the browser sends anyway are
  refused and logged, and a request carrying excluded rows is refused
  outright.
- **No existing transaction is changed.** The import only inserts. A test
  checks that no `update` or `delete` of expenses or incomes is ever run.
- **No split bills or repayments.** "Repayment" is refused as a category with a
  pointer to Add Income. The import never sets split members or
  `split_expense_id`.
- **Transactions, Home and Budgets.** Imported entries are ordinary expenses
  and income, so they appear everywhere entries do. After an import, the list
  reloads. If any settled expense lands in the current month, budget alerts are
  checked once, as when adding by hand.

## 5. Duplicate detection

1. **Against your existing entries:** same kind, same date, same amount
   (paise) and the same description, ignoring case and spacing. The row says
   which entry: *"Already in Transactions: Coffee, 10 Nov 2026."*
2. **Within the file:** a later identical row says *"Same as row 3 in this
   file."*
3. **The same file again:** the file's SHA-256 is compared with earlier imports
   that imported anything. A banner says *"You imported this exact file on
   10 Nov 2026 (5 rows)"*, and its rows show up as duplicates through check 1.

Duplicates are **left out by default**. Ticking one imports it anyway, which
covers two genuine coffees on the same day.

**Retries can't double-import.** The browser chooses the import's id before
the first request, and `import_rows` is unique on (import, row number). A chunk
sent again (an automatic retry, **Try again**, or a double click) finds its
rows already imported and reports them, without adding them again.

Duplicates are checked again at import time, inside the lock. So a duplicate
that appears between the preview and the import (another tab, WhatsApp) is
caught and logged as failed.

## 6. Database: `server/migrations/016_transaction_imports.sql`

The migration is additive only: two new tables. No existing table, column or
row changes.

- **`import_batches`**: one row per import.
  - Columns: id (chosen by the browser), user, file name (no folder), SHA-256,
    csv/xlsx, total rows, and imported and failed counts.
  - Index on (user, file hash).
- **`import_rows`**: one row per imported or failed row.
  - Columns: row number, kind, status, error, the expense or income it
    created, notes and payment method.
  - Unique on (batch, row number), and unique on each entry id.
  - The entry links use `on delete set null`, so removing an imported entry
    later works as usual.
- Both tables cascade on account deletion and have the usual `updated_at`
  trigger.

The Transactions list queries now also return `imported` (file name, notes,
payment method) for each entry, through a subquery on these tables.

**Status: applied.** It was applied to the database on 10 Nov 2026
(`npm run db:migrate`), as with 012–015. The live site's code doesn't use the
new tables until this branch is deployed. It **must** be applied before this
code goes live, since the Transactions list queries read the new tables.

## 7. API

Both routes need a session, like everything else.

**`POST /api/imports/preview`** checks rows and imports nothing.

- **Request:**
  - `rows`: 1 to 2,000, each `{ row, date, description, amount, type,
    category, account, notes, paymentMethod, skip?, allowDuplicate? }` as raw
    cell text;
  - `defaultKind`: `expense`, `income` or `sign`;
  - `updateBalances`;
  - `fileHash`;
  - `tzOffset`.
- **Response:**
  - `rows`: status `ready`, `duplicate` or `invalid`, with the parsed values,
    `errors[]`, `info[]` and `duplicateOf`;
  - `summary`: counts, the totals to import, pending, and each account's
    change in paise;
  - `previousImports`;
  - `options`: categories and accounts, for the correction menus.

**`POST /api/imports/:batchId/rows`** imports one chunk (1 to 100 rows) under
that import id.

- **Request:** the preview's fields plus `fileName`, `fileHash`, `fileType` and
  `totalRows`.
- **Response:**
  - `results`: per row, `imported` or `failed`, with an `error`, and `already`
    when it was imported by an earlier request;
  - the batch totals;
  - `budgetAlerts`.
- **Errors:**
  - 400 for a malformed id or file details, too many rows, duplicate row
    numbers, or rows marked `skip`;
  - 404 for an import id that belongs to someone else.

**Body size.** The rest of the API keeps its 100 kB JSON cap. Only
`/api/imports/*` parses its own body, with a 2 MB cap: a 2,000-row preview is
about 0.5 MB. A test checks that other routes still refuse a 150 kB body.

**Code layout:**

- **Rules:** `server/src/import.mjs` holds the pure rules (dates, amounts,
  kinds, categories, accounts, permissions, duplicates, the play-forward and
  the summary).
- **Database:** `server/src/import-store.mjs` holds the database side.
- **Routes:** `server/src/routes/imports.mjs` holds the routes.
- **Browser:** the browser only reads files and maps columns, in:
  - `src/app/shared/import/import-file.ts`: CSV, headings, mapping and example
    rows;
  - `xlsx.ts` and `zip.ts`: an .xlsx reader and writer with no new
    dependencies, inflating with the browser's own `DecompressionStream`;
  - `templates.ts`.

  Every decision about what a cell means is made on the server, once, for both
  the preview and the import. The Excel and template code loads only when it's
  used.

## 8. Tests

| Suite | Before | Now |
|---|---|---|
| API (`npm run test:api`) | 314 | **361 passing** |
| Angular (`npm run test:ci`) | 302 | **362 passing** |

Production build: clean, no budget warnings.

**API, rules (27 tests).** Every accepted and refused date and amount form,
including exact paise. Type words; categories, aliases and wrong-kind
categories; repayments refused; account matching by name or name with type,
unknown and ambiguous names. The payment-method fallback. Every permission
rule. Pending without backdating; balances left alone. Every reason listed.
Duplicates against entries and within the file, with kind mattering. The
play-forward catching an overdraw in date order, and the hidden-balance
message. Excluded and kept duplicates in the play-forward. The summary and the
import order.

**API, routes (20 tests).**

- **Covered:**
  - a session is needed;
  - the preview writes nothing;
  - empty, oversized and badly numbered requests;
  - 2,000 rows fit while other routes keep 100 kB;
  - an expense debits its account and logs notes and payment method, storing
    no folder in the file name;
  - income credits its account;
  - balances can be left alone;
  - **partial failure**: the middle row fails, is rolled back alone, and the
    rest import;
  - invalid rows logged with every reason;
  - a duplicate refused unless kept;
  - **retry of the same chunk imports nothing twice**;
  - a failed row retried after fixing;
  - **another person's import id is a 404**, and nothing is imported;
  - income refused without "Add money";
  - pending without backdating, while full access can backdate;
  - budget check only for this month;
  - request validation;
  - oldest first, whatever order the rows were sent in;
  - the lists return the import info.
- **The stand-in database:** these tests use a small in-memory ledger, so
  balances, entries and the log are checked as values.
- **Never run:** a test checks that no statement ever updates or deletes an
  existing expense or income.

**Angular (60 new tests).**

- **CSV parsing:** quotes, line breaks in cells, BOM, semicolon and tab files,
  Windows-1252.
- **File checks:** type, `.xls`, wrong button, empty, too big.
- **Headings:** a heading row below a title; blank rows; empty, headings-only
  and over 2,000 rows.
- **Column matching:** template, reordered and bank-statement headings; this
  app's own exports.
- **Debit and credit columns** becoming kinds.
- **Example rows** recognised.
- **XLSX reading:** a deflated workbook with shared strings, rich text, date
  styles and numbers.
- **XLSX sheet choice:** Transactions preferred, hidden sheets skipped.
- **XLSX refusals and round trip:** `.xls`, password-protected and non-xlsx
  files refused; a write/read round trip; 1904 dates; the ZIP CRC.
- **Templates:** headings, examples, your accounts, categories, reading back
  as CSV and Excel, and the Instructions and Lists sheets with drop-downs.
- **The component:**
  - the menu and keyboard;
  - template download;
  - wrong, empty and headings-only files;
  - the columns step;
  - an Excel file;
  - review states and reasons;
  - examples left out until ticked;
  - a duplicate imported only when ticked;
  - fix and check again;
  - leave out and bring back;
  - "File them under Other";
  - the fallback account;
  - balances switch;
  - the confirmation before anything is sent;
  - 230 rows in 50-row chunks, oldest first, under one id, with a failure
    reported;
  - a retry after a 503 under the same id;
  - stop on a refusal, with the rest counted as not attempted;
  - every row counted once in the report;
  - fix-and-retry with imported rows set aside;
  - can't close while importing.
- **Transactions page:** Import sits beside an unchanged Export, and an import
  reloads the list and totals.
- **Details drawer:** shows the file, notes and payment method.

The existing Export tests are unchanged and pass.

**End to end in the browser**, against the real database, with a temporary
`@localhost.test` account. The account had HDFC Bank ₹5,000 and Cash ₹500,
plus one expense added by hand.

1. **A 9-row CSV with reordered headings.**
   - **How each row came out:**
     - Lunch was ready;
     - Coffee was a duplicate;
     - Electricity bill was an example row;
     - Fuel was an unknown category;
     - `abc` was not an amount;
     - `11/25/2026` was refused as month first;
     - groceries had no account;
     - New phone was ready;
     - Headphones would have overdrawn HDFC: "needs ₹900, would have ₹750".
   - **Fixes:** "File them under Other" fixed Petrol, and Bus pass got a
     corrected date.
   - **Result:** the confirmation showed 5 expenses (₹5,249), HDFC −₹4,250 and
     Cash −₹300. **Imported 5, failed 0.**
   - **Balances afterwards:** HDFC **₹750**, Cash **₹200**, exactly.
2. **The same file again.**
   - The banner said "You imported this exact file on 10 Nov 2026 (5 rows)".
   - All four rows imported earlier showed as duplicates and were left out.
3. **The Excel combined template, made by the menu and read back in.**
   - The three example rows were recognised, kept and imported: 1 income,
     2 expenses.
   - **Balances afterwards:** HDFC ₹750 + ₹45,000 − ₹1,450.50 = **₹44,299.50**,
     and Cash **₹20**.
4. **Details drawer:** showed "From november-expenses.csv", Payment method
   Card and Notes "Friday lunch".
5. **Home:** November spending ₹6,820.50, with the October import counted in
   October; the category breakdown and balances were updated.
6. **Budgets:** ₹6,820.50 spent of a ₹10,000 test budget.
7. **A bank statement.**
   - A title line above the headings, and Withdrawal and Deposit columns.
   - **Rows with no account → HDFC Bank** made all three rows ready.
8. **Layout and themes:** checked at 1200×700, 800×600 (cards) and on a phone
   (375×812) in dark mode.
9. **Clean-up:** the test account was deleted afterwards. The database then
   held **0** import batches, **0** import rows and **0** test users.

## 9. Deployment

1. **Database:** migration 016 is **already applied**. If it's ever deployed to
   a different database, run `npm run db:migrate` there **before** the code.
2. **When approved,** merge `feat/transaction-import` into `main`.
3. **Deploy:**
   - Pushing `main` didn't trigger Vercel last time. Check `vercel ls` for a
     new Production deployment.
   - If none appears, deploy from a clean `git archive main` export, never
     from the working folder.
   - `.vercelignore` doesn't exclude `.env*`; adding it is still recommended.
4. **Check on the live site:**
   - `/api/health` is OK;
   - `POST /api/imports/preview` without a session answers 401, not 404;
   - signed in, download each template, import the expense template with its
     examples kept, then remove those entries and check the balances return.
5. **No new environment variables, packages or storage** are needed.

## 10. Not included

- **Editing an existing transaction from a file** (the import only adds).
- **Importing split bills or repayments.**
- **OCR of statements** (PDF/image).
- **Old `.xls` files.**
- **Undoing a whole import in one click.** Entries can be removed one by one,
  and each removal puts its money back as usual. The import log links every
  entry to its import, so a bulk undo could be added later.
