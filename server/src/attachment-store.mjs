/**
 * Receipt attachments: the database rows and their files, kept in step.
 *
 * Upload: the file goes to storage first, then its row is written in a
 * transaction that also checks the expense is the user's and has room. If the
 * row cannot be written, the stored file is deleted again, so no file is left
 * without a row.
 *
 * Removal: deleting a row (on its own, with its expense, or with the account)
 * queues its file in attachment_cleanup by trigger; the file is then deleted
 * from storage and the queue entry cleared. A storage failure leaves the entry
 * queued for the daily job, so no row ever points at a missing file and no
 * file outlives its row for long.
 *
 * Nothing here reads or writes balances, expenses' amounts, incomes or
 * budgets; an expense row is only locked (FOR NO KEY UPDATE, never changed)
 * while its attachment is added, so uploads to it take turns.
 */
import { query, transaction } from './db.mjs';
import { MAX_PER_EXPENSE, storageKey } from './attachments.mjs';
import { deleteFile, getFile, putFile } from './attachment-storage.mjs';

const COLUMNS = 'id, expense_id, file_name, content_type, size_bytes, created_at';

function refuse(message, status) {
  return Object.assign(new Error(message), { status });
}

/** The expense, if it is this user's. */
export async function ownsExpense(userId, expenseId) {
  const { rows } = await query(
    'select id from expenses where id = $1 and user_id = $2',
    [expenseId, userId]
  );

  return Boolean(rows[0]);
}

export async function listAttachments(userId, expenseId) {
  const { rows } = await query(
    `select ${COLUMNS} from receipt_attachments
      where expense_id = $1 and user_id = $2
      order by created_at`,
    [expenseId, userId]
  );

  return rows;
}

/** One attachment of the user's on that expense, with its storage key. */
export async function findAttachment(userId, expenseId, id) {
  const { rows } = await query(
    `select ${COLUMNS}, storage_key from receipt_attachments
      where id = $1 and expense_id = $2 and user_id = $3`,
    [id, expenseId, userId]
  );

  return rows[0] ?? null;
}

/**
 * Stores a checked file and records it.
 *
 * @param file { type, name, size } from checkUpload
 * @returns the new row
 */
export async function addAttachment(userId, expenseId, buffer, file) {
  // Cheap checks before any upload.
  if (!await ownsExpense(userId, expenseId)) {
    return null;
  }

  const { rows: [{ count }] } = await query(
    'select count(*)::int as count from receipt_attachments where expense_id = $1 and user_id = $2',
    [expenseId, userId]
  );

  if (count >= MAX_PER_EXPENSE) {
    throw refuse(`An expense can have up to ${MAX_PER_EXPENSE} attachments.`, 409);
  }

  const key = storageKey(userId, expenseId, file.type);

  try {
    await putFile(key, buffer, file.type);
  } catch (error) {
    console.error('[attachments] storage upload failed:', error.message);
    throw refuse(error.status === 503 ? error.message : 'The file could not be stored. Please try again.', error.status === 503 ? 503 : 502);
  }

  try {
    return await transaction(async client => {
      // The expense must still be the user's and must not vanish meanwhile;
      // NO KEY UPDATE (not KEY SHARE, which uploads could all hold at once)
      // makes uploads to the same expense take turns, so the count below is
      // exact. Reads of the expense, and foreign-key checks, are not blocked.
      const { rows: [expense] } = await client.query(
        'select id from expenses where id = $1 and user_id = $2 for no key update',
        [expenseId, userId]
      );

      if (!expense) {
        throw refuse('That expense was not found.', 404);
      }

      // Counted again under the lock: two uploads at once cannot pass the limit.
      const { rows: [{ count: now }] } = await client.query(
        'select count(*)::int as count from receipt_attachments where expense_id = $1',
        [expenseId]
      );

      if (now >= MAX_PER_EXPENSE) {
        throw refuse(`An expense can have up to ${MAX_PER_EXPENSE} attachments.`, 409);
      }

      const { rows: [row] } = await client.query(
        `insert into receipt_attachments (user_id, expense_id, storage_key, file_name, content_type, size_bytes)
         values ($1, $2, $3, $4, $5, $6)
         returning ${COLUMNS}`,
        [userId, expenseId, key, file.name, file.type, file.size]
      );

      return row;
    });
  } catch (error) {
    // No row, so the stored file must go too.
    await removeFileNow(key, { queueOnFailure: true });
    throw error;
  }
}

/** The file's stream, for an attachment the user owns; null when not found. */
export async function openAttachment(userId, expenseId, id) {
  const row = await findAttachment(userId, expenseId, id);

  if (!row) {
    return null;
  }

  const stream = await getFile(row.storage_key);

  if (!stream) {
    throw refuse('That file is missing from storage.', 410);
  }

  return { row, stream };
}

/**
 * Removes one attachment: the row (which queues the file), then the file.
 * The expense and every other attachment are untouched.
 */
export async function deleteAttachment(userId, expenseId, id) {
  const { rows: [row] } = await query(
    `delete from receipt_attachments
      where id = $1 and expense_id = $2 and user_id = $3
      returning storage_key`,
    [id, expenseId, userId]
  );

  if (!row) {
    return false;
  }

  await removeFileNow(row.storage_key);
  return true;
}

/**
 * Deletes a stored file and clears its cleanup entry. A storage failure is
 * logged and left queued (or queued, for a file that never got a row).
 */
async function removeFileNow(key, { queueOnFailure = false } = {}) {
  try {
    await deleteFile(key);
    await query('delete from attachment_cleanup where storage_key = $1', [key]);
  } catch (error) {
    console.error('[attachments] storage delete failed, left for the daily job:', error.message);

    const sql = queueOnFailure
      ? `insert into attachment_cleanup (storage_key, attempts, last_error) values ($1, 1, $2)
         on conflict (storage_key) do update set attempts = attachment_cleanup.attempts + 1, last_error = $2`
      : 'update attachment_cleanup set attempts = attempts + 1, last_error = $2 where storage_key = $1';

    await query(sql, [key, String(error.message).slice(0, 300)]).catch(() => {});
  }
}

/**
 * Deletes every file still queued: files of rows removed with an expense or an
 * account, and earlier deletions that failed. Run by the daily job and after
 * an expense is deleted. Stops after `limit` files.
 *
 * @returns { removed, failed }
 */
export async function sweepCleanup({ limit = 200 } = {}) {
  const { rows } = await query(
    'select storage_key from attachment_cleanup order by queued_at limit $1',
    [limit]
  );

  let removed = 0;
  let failed = 0;

  for (const { storage_key: key } of rows) {
    try {
      await deleteFile(key);
      await query('delete from attachment_cleanup where storage_key = $1', [key]);
      removed += 1;
    } catch (error) {
      failed += 1;
      await query(
        'update attachment_cleanup set attempts = attempts + 1, last_error = $2 where storage_key = $1',
        [key, String(error.message).slice(0, 300)]
      ).catch(() => {});
    }
  }

  return { removed, failed };
}

/** How many attachments each of the user's expenses has, for the paperclip. */
export async function countsByExpense(userId) {
  const { rows } = await query(
    `select expense_id, count(*)::int as count from receipt_attachments
      where user_id = $1 group by expense_id`,
    [userId]
  );

  return Object.fromEntries(rows.map(r => [r.expense_id, r.count]));
}
