/**
 * The database side of importing transactions.
 *
 * Every entry is created by insertExpense or insertIncome, the code the Add
 * pages use, so the sufficient-funds rule, approval and what is stored are the
 * same as adding the entry by hand.
 */
import { query, transaction } from './db.mjs';
import { insertExpense } from './expense-store.mjs';
import { insertIncome } from './income-store.mjs';
import { checkRow, duplicateKey, importOrder, indexExisting, shortDate } from './import.mjs';

/** Accounts that can be spent from or paid into: the ones the Add pages offer. */
export async function loadAccounts(run, userId) {
  const { rows } = await run(
    `select id, type, category, balance
       from balances
      where user_id = $1 and saved = true
      order by created_at`,
    [userId]
  );

  return rows;
}

/**
 * The person's entries on any of `dates`, indexed for duplicate checks.
 *
 * With `batchId`, entries that batch itself created are left out, so a row
 * the person chose to import twice is not refused by its own twin.
 */
export async function loadExisting(run, userId, dates, batchId = null) {
  if (!dates.length) {
    return new Map();
  }

  const notFromBatch = column => batchId
    ? `and not exists (select 1 from import_rows r where r.batch_id = $3 and r.${column} = t.id)`
    : '';
  const params = batchId ? [userId, dates, batchId] : [userId, dates];

  const [{ rows: expenses }, { rows: incomes }] = await Promise.all([
    run(
      `select t.id, t.spent_on as date, t.amount, t.description
         from expenses t
        where t.user_id = $1 and t.spent_on = any($2::date[]) and t.deleted_at is null ${notFromBatch('expense_id')}`,
      params
    ),
    run(
      `select t.id, t.received_on as date, t.amount, t.description
         from incomes t
        where t.user_id = $1 and t.received_on = any($2::date[]) and t.deleted_at is null ${notFromBatch('income_id')}`,
      params
    )
  ]);

  return indexExisting(expenses, incomes);
}

/** Earlier imports of a file with these exact bytes that imported anything. */
export async function previousImports(userId, fileHash) {
  const { rows } = await query(
    `select id, file_name, imported_rows, created_at
       from import_batches
      where user_id = $1 and file_hash = $2 and imported_rows > 0
      order by created_at desc
      limit 3`,
    [userId, fileHash]
  );

  return rows.map(row => ({
    id: row.id,
    fileName: row.file_name,
    importedRows: row.imported_rows,
    createdAt: row.created_at
  }));
}

function refusal(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

/** Adds one checked row through the shared insert, inside the caller's savepoint. */
async function insertRow(client, userId, row, permissions) {
  if (row.kind === 'income') {
    const created = await insertIncome(client, userId, {
      amount: row.amountPaise / 100,
      description: row.description,
      receivedOn: row.date,
      category: row.category,
      targetId: row.account.id,
      updateBalance: row.moves === 'credit',
      channel: 'web'
    });

    return { incomeId: created.id };
  }

  const debit = row.moves === 'debit';
  const created = await insertExpense(client, userId, {
    amount: row.amountPaise / 100,
    description: row.description,
    date: row.date,
    category: row.category,
    sourceId: row.account?.id ?? null,
    updateBalance: debit,
    canBackdate: permissions.canBackdate,
    status: row.settle,
    // A pending entry keeps the wording approval looks for.
    remarks: row.settle === 'done' ? (debit ? 'Imported; balance updated' : 'Imported') : undefined
  });

  if (debit && !created.debited) {
    throw new Error('Imported expense was not debited');
  }

  return { expenseId: created.id, settledThisMonth: created.status === 'done' };
}

/**
 * Imports one chunk of a file, all of it in one transaction.
 *
 * Each row gets its own savepoint: a row refused here (an account short of
 * money since the preview, a duplicate that appeared since) is rolled back on
 * its own and reported as failed, and the rest of the chunk still goes in.
 * Anything unexpected rolls the whole chunk back and is thrown, and the page
 * can send the same chunk again: rows already imported under this batch are
 * recognised by (batch, row number) and reported, never added a second time.
 *
 * One import per person at a time (an advisory lock), so two tabs importing
 * the same file cannot both pass the duplicate check.
 *
 * @param batch { id, fileName, fileHash, fileType, totalRows }
 * @param rawRows readRawRow() results, in the order to import them
 * @param context as checkRow, minus accounts (loaded here, under the lock)
 * @returns { results: [{ row, status: 'imported'|'failed', kind, error?, already? }],
 *   batch: { importedRows, failedRows }, touchedThisMonth }
 */
export function importChunk(userId, batch, rawRows, context) {
  return transaction(async client => {
    const run = (text, params) => client.query(text, params);

    await run('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`import:${userId}`]);

    const created = await run(
      `insert into import_batches (id, user_id, file_name, file_hash, file_type, total_rows)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do nothing
       returning id`,
      [batch.id, userId, batch.fileName, batch.fileHash, batch.fileType, batch.totalRows]
    );

    if (!created.rows.length) {
      const { rows } = await run('select user_id from import_batches where id = $1', [batch.id]);

      if (rows[0]?.user_id !== userId) {
        throw refusal('That import was not found.', 404);
      }
    }

    const { rows: logged } = await run(
      `select row_number, status, kind
         from import_rows
        where batch_id = $1 and row_number = any($2::int[])`,
      [batch.id, rawRows.map(raw => raw.row)]
    );
    const already = new Map(logged.filter(entry => entry.status === 'imported')
      .map(entry => [entry.row_number, entry]));

    const accounts = await loadAccounts(run, userId);
    const fullContext = { ...context, accounts };
    const checked = rawRows.map(raw => ({ ...checkRow(raw, fullContext), raw }));
    const dates = [...new Set(checked.map(row => row.date).filter(Boolean))];
    const existing = await loadExisting(run, userId, dates, batch.id);

    const results = [];
    let touchedThisMonth = false;
    const thisMonth = context.today.slice(0, 7);

    const log = (row, status, ids = {}, error = null) => run(
      `insert into import_rows (
         batch_id, user_id, row_number, kind, status, error,
         expense_id, income_id, notes, payment_method
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (batch_id, row_number) do update
         set kind = excluded.kind, status = excluded.status, error = excluded.error,
             expense_id = excluded.expense_id, income_id = excluded.income_id,
             notes = excluded.notes, payment_method = excluded.payment_method`,
      [
        batch.id, userId, row.row, row.kind, status, error,
        ids.expenseId ?? null, ids.incomeId ?? null,
        row.notes || null, row.paymentMethod || null
      ]
    );

    // The order the preview played the balances forward in.
    for (const row of [...checked].sort(importOrder)) {
      if (already.has(row.row)) {
        results.push({ row: row.row, status: 'imported', kind: already.get(row.row).kind, already: true });
        continue;
      }

      if (row.errors.length) {
        await log(row, 'failed', {}, row.errors.join(' '));
        results.push({ row: row.row, status: 'failed', kind: row.kind, error: row.errors.join(' ') });
        continue;
      }

      const twin = existing.get(duplicateKey(row.kind, row.date, row.amountPaise, row.description));

      if (twin && !row.raw.allowDuplicate) {
        const error = `Already in Transactions: ${twin.description}, ${shortDate(twin.date)}.`;

        await log(row, 'failed', {}, error);
        results.push({ row: row.row, status: 'failed', kind: row.kind, error });
        continue;
      }

      await run('savepoint import_row');

      try {
        const ids = await insertRow(client, userId, row, context.permissions);

        await run('release savepoint import_row');
        await log(row, 'imported', ids);
        results.push({ row: row.row, status: 'imported', kind: row.kind });

        if (ids.settledThisMonth && row.date.slice(0, 7) === thisMonth) {
          touchedThisMonth = true;
        }
      } catch (error) {
        if (!error.status) {
          throw error;
        }

        await run('rollback to savepoint import_row');
        await log(row, 'failed', {}, error.message);
        results.push({ row: row.row, status: 'failed', kind: row.kind, error: error.message });
      }
    }

    const { rows: counts } = await run(
      `update import_batches b
          set imported_rows = (select count(*) from import_rows r where r.batch_id = b.id and r.status = 'imported'),
              failed_rows = (select count(*) from import_rows r where r.batch_id = b.id and r.status = 'failed')
        where b.id = $1
        returning imported_rows, failed_rows`,
      [batch.id]
    );

    return {
      results,
      batch: {
        importedRows: Number(counts[0]?.imported_rows ?? 0),
        failedRows: Number(counts[0]?.failed_rows ?? 0)
      },
      touchedThisMonth
    };
  });
}
