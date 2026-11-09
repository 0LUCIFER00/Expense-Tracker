# Receipt & Invoice Attachments — Report

Branch `feat/receipts`, built on `feat/account-transfers`, so it includes
Budgets, Recurring, Savings Goals, the Planning menu, the account strip and
Transfers. Pushed to GitHub only: **not merged, not deployed**.

---

## 1. What was built

- **Add Expense:**
  - a compact **Attach receipt** box (drag and drop, or click to choose,
    several files at once);
  - each chosen file shows a thumbnail (or a PDF tile), its size, a ✕ to take
    it out, and "attached when you save";
  - after the expense is saved, files upload one by one with a progress bar,
    then a toast ("2 receipts attached");
  - a file that fails is marked in red with the reason and stays listed. The
    expense is saved either way, and the file can be attached later from
    Transactions.
- **Transactions:**
  - a 📎 with the count beside any expense that has attachments;
  - a new **receipts button** (document icon) in each expense row's Actions
    opens **expense details**: amount, share, account, status, and **Receipts
    & Invoices**;
  - **Receipts & Invoices** has image thumbnails and PDF tiles, each with
    **Download** and **Remove** (Remove needs "Remove entries"), a click to
    **preview** (images full size, PDFs in the browser's own viewer), and the
    same Attach receipt box to add more (up to 10 per expense);
  - removing asks first: "Only this file is removed. The expense, its amount
    and your balances stay exactly as they are."
- **Phones, light and dark:** the panel fits a phone screen, and everything
  uses the app's colour tokens.

**Expense editing is not added.** The app has no edit screen or API, so files
are attached on Add Expense or later from the details panel, which covers
"attach to an existing expense" without changing how expenses work.

## 2. Storage setup

- **Provider: Vercel Blob, a private store**:
  - name `expense-tracker-receipts`;
  - region `sin1`, next to the API;
  - created on the project's **Hobby** plan, which has no overage billing (it
    caps usage instead), so it can't create a charge.
- **Connected to:** Production and Development.
- **Environment variable:** `BLOB_READ_WRITE_TOKEN`.
  - **Production:** set on Vercel automatically when the store was connected.
    Nothing to add by hand.
  - **Local:** in `.env.local`, written by `vercel env pull` or the store
    connection. It is ignored by git (`.gitignore` `.env*`). `server/src/env.mjs`
    now loads it after `.env`, never overriding it, and skips it under
    `node --test`, so tests never reach real storage.
- **No public URLs.** Files are written with `access: 'private'`. The browser
  only ever sees this site's own API addresses
  (`/api/expenses/:id/attachments/:aid`), which check the session and
  ownership, then stream the file from storage.
- **SDK:** `@vercel/blob@2.8.2`. Its config-loading dependency pulled in an
  old `zod` with a high-severity advisory (GHSA-mrhx-c7xc-m3w5, memory
  exhaustion). A narrow `overrides` entry in `package.json` lifts that one copy
  to `zod@^4.6.7`. `npm audit --omit=dev` is back to **0 vulnerabilities**.

## 3. Database migration — `server/migrations/015_receipt_attachments.sql`

**Additive only. Applied** to the shared Aiven database on 9 Nov 2026, with
approval. It adds two tables, one function and one trigger. Existing
financial tables aren't altered; the expense list query only reads a count
from the new table.

| Object | Purpose |
|---|---|
| `receipt_attachments` | `user_id`; `expense_id` (cascades with the expense); `storage_key` (unique, server-generated); `file_name` (1–120 characters, cleaned); `content_type` (one of the four allowed); `size_bytes` (1 byte to 4 MB); `created_at`. Indexes on `(expense_id, created_at)` and `(user_id)`. |
| `attachment_cleanup` | Files waiting to be deleted from storage: `storage_key` (primary key), `queued_at`, `attempts`, `last_error`. |
| `queue_attachment_cleanup()` + trigger | Every deleted attachment row, however it goes (removed on its own, deleted with its expense, deleted with the account), queues its file for deletion. |

## 4. API

All routes use the existing `requireAuth`, and every query is keyed by the
signed-in user.

| Method & path | Needs | What |
|---|---|---|
| `GET /api/expenses/:id/attachments` | sign-in, own expense | Metadata list |
| `POST /api/expenses/:id/attachments` | sign-in, own expense | One file per request: the raw bytes as the body, its name in `X-File-Name` (URL-encoded). `201` with metadata. Refusals: `400` empty, `404` not yours, `409` already 10, `413` over 4 MB, `415` wrong or damaged type, `502` storage failed, `503` storage not configured. |
| `GET /api/expenses/:id/attachments/:aid` | sign-in, own expense and attachment | Streams the file inline; `?download=1` for a download. Headers: the stored type, `nosniff`, `no-store`; same-origin framing allowed only here, so PDFs preview in the app. |
| `DELETE /api/expenses/:id/attachments/:aid` | `canRemove` (or full access) | Removes that file only (`204`). |
| `GET /api/expenses` | unchanged | Each expense now carries `attachmentCount`. |

**Why 4 MB per file:** Vercel caps a request (and a response) at 4.5 MB.
Uploading through our server means every file is fully checked *before* it's
stored. Large photos are shrunk in the browser (longest side 2560 px, JPEG
quality 0.85), so ordinary phone receipts fit easily.

## 5. Security

- **Validation on the server,** whatever the browser says:
  - **real type from the bytes:** JPEG `FF D8 FF`, PNG signature, WebP
    `RIFF…WEBP`, PDF `%PDF-`;
  - **damaged or cut-off files refused:** the JPEG end marker, the PNG `IEND`
    chunk, the WebP RIFF length and the PDF `%%EOF` are all checked;
  - an HTML page or program renamed `.jpg` is refused (415), as is GIF;
  - size is 1 byte to 4 MB (413 above, with our own message).
- **Names and keys:**
  - display names lose folders (`../../`, `C:\…`), control and reserved
    characters, are capped at 120 characters, and get the extension of the
    real type;
  - storage keys are `receipts/<userId>/<expenseId>/<random uuid>.<ext>`,
    built only from the server's own ids. The uploaded name is never used in a
    path.
- **Ownership (no IDOR):**
  - every list, upload, preview, download and delete matches the user, the
    expense *and* the attachment;
  - another user's ids, an attachment under a different expense, or a
    malformed id all give 404 without reading storage;
  - signed out gives 401.
- **Limit:** 10 per expense, checked again under a row lock
  (`FOR NO KEY UPDATE` on the expense), so concurrent uploads take turns.
  Found and fixed during end-to-end testing: the first version used
  `FOR KEY SHARE`, and 5 racing uploads reached 11.
- **No financial effect:** nothing writes to expenses, incomes, balances,
  budgets, transfers or goals. The route tests check every query for this.

## 6. Consistency between the database and storage

| Situation | What happens |
|---|---|
| Upload; storage fails | Nothing is recorded (502). |
| Upload stored; row can't be written (limit, expense gone, database error) | The stored file is deleted immediately; if that fails too, it's queued. |
| Remove one attachment | The row is deleted (trigger queues the file), then the file is deleted and the queue entry cleared. If storage fails, the row is still gone, and the file stays queued for the daily job. |
| Delete the expense, or the whole account | Rows go by cascade and the trigger queues every file. After an expense delete, the queue is swept in the background (`waitUntil` on Vercel). |
| Anything still queued | The existing daily cron (`/api/recurring/cron`, 00:05 India time) now also sweeps up to 500 queued files. |

A row never points at a deleted file, and a file without a row is only ever a
queued deletion.

## 7. Tests

| Suite | Result |
|---|---|
| API: `npm run test:api` | **314 / 314** pass, twice (289 before; +25) |
| Angular: `npm run test:ci` | **285 / 285** pass (269 before; +16) |
| `ng build` | Clean, no budget warnings |
| `npm audit --omit=dev` | 0 vulnerabilities |
| End to end (local API, real Postgres, **real private Blob store**) | **38 / 38** checks pass. Temporary accounts and all their files deleted; nothing left queued. |

**New API tests:**
- **`attachments.test.mjs` (7):** each type from its bytes; truncated
  JPEG/PNG/WebP/PDF; GIF, HTML-as-JPEG and an executable refused; empty and 4
  MB limits; disguised files; name cleaning; storage keys.
- **`attachments-routes.test.mjs` (18), with storage replaced by a recording
  fake:**
  - sign-in required; a private, server-keyed upload; all four types;
  - refusals before storage; over 4 MB; another user's expense; the 10-file
    limit;
  - **a database failure deletes the stored file**; storage down records
    nothing;
  - listing by owner; inline preview headers; download;
  - cross-user and cross-expense access is 404 with storage never read;
  - **removing one deletes only that row and file;** a storage failure on
    remove stays queued; removing needs "Remove entries";
  - another user can't remove; the list carries `attachmentCount`;
  - **no financial writes.**

**New Angular tests:**
- **file preparation:** a small photo and a PDF pass unchanged; a 3200 px
  image becomes a JPEG; other types and an oversized PDF are refused;
- **picker:** multiple files and the accept list; files wait, then upload
  with progress; the server's refusal is shown against the file; a file can be
  taken out; the room limit; immediate upload on an existing expense;
- **details:** an image thumbnail and a PDF tile from the site's own API;
  image and PDF preview; download links; removing one after confirming (the
  other stays, the count updates); no Remove without permission;
- **Transactions:** the paperclip only when there are attachments; the
  receipts button opens the details.

**End-to-end highlights:**
- **Uploads:** JPEG, PNG, WebP and PDF are all stored; names are cleaned and
  the type read from the bytes. The **four files were really present in the
  private store** under server-made keys.
- **Refusals:** GIF, HTML renamed `.jpg`, a cut-off JPEG, a damaged PDF and a
  file over 4 MB were all refused, with **nothing stored**.
- **Preview and download** returned the exact bytes with the right headers,
  and the list showed the count.
- **Another user** got 404 on list, preview, download, delete and upload; an
  attachment id under the wrong expense got 404; signed out got 401.
- **Removing one:** the row and the file are gone (checked in storage), the
  other files and the expense are untouched, and nothing is left queued.
- **The 10-file limit held under racing uploads,** and rejected racers left no
  files.
- **No financial effect:** balances, budget spending and income were
  unchanged by any of it.
- **Deleting the expense** refunded the money as before, removed its rows,
  and **its files left storage**. Deleting the accounts left **no files** and
  **an empty queue**.

**In the browser** (laptop 1308×652, phone, dark mode):
- Add Expense still fits without scrolling, with the receipt box.
- Attaching through the real file input on Transactions: thumbnails load, the
  image previews, the **PDF opens in Chrome's viewer inside the app**, and
  removing the PDF left the photo.
- The Add Expense flow end to end: the file waited, uploaded after "Log only",
  and the toast said "1 receipt attached".
- Deleting that test expense removed its file from storage automatically.

## 8. Deployment

1. **Storage:** done. The private store is connected and
   `BLOB_READ_WRITE_TOKEN` is set on Production.
2. **Database:** migration 015 is **already applied**. The live site ignores
   the new tables until this code is deployed.
3. **When approved,** merge `feat/receipts` into `main`. It contains every
   earlier unmerged feature. Pushing `main` deploys production.
4. **Check on the live site:**
   - add an expense with a phone photo and a PDF;
   - open Transactions → the receipts button: preview both, download one,
     remove one;
   - confirm balances and budgets haven't changed.
5. **Rollback:** promote the previous deployment. The tables and stored files
   can stay; the old code ignores them.

## 9. Limitations

- **4 MB per file.** This is Vercel's request cap; photos are shrunk
  automatically, and a PDF over 4 MB has to be compressed first.
- **Expenses only.** Income can't carry attachments, and there's no expense
  editing (neither exists today).
- **No OCR**, as asked.
- **Sample data:** the test account's latest "Milk" expense has one sample
  receipt image (`milk-receipt.png`). It is the only file in the store.
