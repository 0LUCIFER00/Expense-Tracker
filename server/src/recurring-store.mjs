/**
 * Recurring schedules in the database, and the runner that adds what is due.
 *
 * How an occurrence is added, in one database transaction:
 *   1. lock the schedule row (FOR UPDATE SKIP LOCKED: a second runner at the
 *      same moment skips it rather than waiting and repeating the work);
 *   2. check it is active and its next date has come;
 *   3. record the occurrence in recurring_runs, unique on (schedule, date);
 *   4. add the expense or income through the same code the website uses,
 *      linked to that occurrence (also unique);
 *   5. move the schedule on to its next date.
 * Either all of that commits or none of it does. A refusal from step 4 (the
 * account is short, or gone) is rolled back to a savepoint, so no money moves,
 * and the occurrence is kept as failed for a retry; the schedule still moves on.
 * Anything unexpected (the database going away) rolls back everything, and the
 * same date is simply tried again by the next run.
 */
import { query, transaction } from './db.mjs';
import { insertExpense } from './expense-store.mjs';
import { insertIncome } from './income-store.mjs';
import { checkBudgetAlertsSafely } from './budget-store.mjs';
import {
  MAX_ATTEMPTS,
  MAX_CATCH_UP,
  advance,
  failedLine,
  firstSeqOnOrAfter,
  reminderLine
} from './recurring.mjs';

const SCHEDULE_COLUMNS = `
  id, user_id, kind, description, amount, category, account_id, uses_account,
  frequency, interval_count, start_on, anchor_on, next_seq, next_due_on, end_on,
  remind_days, status, last_run_at, created_at, updated_at
`;

const RUN_COLUMNS = `
  id, schedule_id, user_id, due_on, kind, description, amount, category,
  account_id, uses_account, status, attempts, last_error, last_attempt_on, created_at
`;

/** Schedules with the account's name and how many entries each has added. */
export async function listSchedules(userId) {
  const { rows } = await query(
    `select ${SCHEDULE_COLUMNS.replace(/(\w+)/g, 's.$1')},
            b.category as account_name,
            (select count(*)::int from recurring_runs r
              where r.schedule_id = s.id and r.status = 'posted') as posted_count
       from recurring_schedules s
       left join balances b on b.id = s.account_id and b.user_id = s.user_id
      where s.user_id = $1
      order by s.created_at`,
    [userId]
  );

  return rows;
}

export async function findSchedule(userId, id) {
  const { rows } = await query(
    `select ${SCHEDULE_COLUMNS} from recurring_schedules where id = $1 and user_id = $2`,
    [id, userId]
  );

  return rows[0] ?? null;
}

/**
 * Occurrences, newest first: for one schedule, or all of an account's.
 * `failedOnly` lists those that need attention.
 */
export async function listRuns(userId, { scheduleId = null, failedOnly = false, limit = 20 } = {}) {
  const { rows } = await query(
    `select ${RUN_COLUMNS}
       from recurring_runs
      where user_id = $1
        and ($2::uuid is null or schedule_id = $2)
        and (not $3 or status = 'failed')
      order by due_on desc, created_at desc
      limit $4`,
    [userId, scheduleId, failedOnly, limit]
  );

  return rows;
}

/** Throws a 400 unless the account belongs to the user. */
async function checkAccount(client, userId, accountId) {
  if (!accountId) {
    return;
  }

  const { rows } = await client.query(
    'select id from balances where id = $1 and user_id = $2 and saved = true',
    [accountId, userId]
  );

  if (!rows[0]) {
    throw Object.assign(new Error('Please select a valid account.'), { status: 400 });
  }
}

/** Status and next date for a schedule continuing from `from`. */
function placement(shape, from) {
  const ended = shape.end_on && from > shape.end_on;
  return ended
    ? { next_due_on: null, status: 'completed' }
    : { next_due_on: from, status: 'active' };
}

export function createSchedule(userId, v) {
  return transaction(async client => {
    await checkAccount(client, userId, v.accountId);

    const { rows } = await client.query(
      `insert into recurring_schedules (
         user_id, kind, description, amount, category, account_id, uses_account,
         frequency, interval_count, start_on, anchor_on, next_seq, next_due_on, end_on,
         remind_days, status
       )
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,0,$10,$11,$12,'active')
       returning ${SCHEDULE_COLUMNS}`,
      [
        userId, v.kind, v.description, v.amount, v.category, v.accountId, Boolean(v.accountId),
        v.frequency, v.interval, v.from, v.endOn, v.remindDays
      ]
    );

    return rows[0];
  });
}

/**
 * Changes a schedule from its next date on. Entries already added, and
 * occurrences already recorded, are separate rows and are not touched.
 *
 * When the timing changes (how often, or the next date) the schedule is
 * re-anchored on the new next date; otherwise it keeps counting from its anchor.
 */
export function updateSchedule(userId, id, v) {
  return transaction(async client => {
    const { rows: [current] } = await client.query(
      `select ${SCHEDULE_COLUMNS} from recurring_schedules
        where id = $1 and user_id = $2 for update`,
      [id, userId]
    );

    if (!current) {
      return null;
    }

    await checkAccount(client, userId, v.accountId);

    const retimed =
      current.frequency !== v.frequency ||
      current.interval_count !== v.interval ||
      current.next_due_on !== v.from;

    const anchor = retimed ? v.from : current.anchor_on;
    const seq = retimed ? 0 : current.next_seq;
    const where = placement({ end_on: v.endOn }, v.from);

    // A paused schedule stays paused; a completed one comes back when the new
    // dates give it something left to do.
    const status = current.status === 'paused' && where.status === 'active' ? 'paused' : where.status;

    const { rows } = await client.query(
      `update recurring_schedules
          set description = $3, amount = $4, category = $5, account_id = $6, uses_account = $7,
              frequency = $8, interval_count = $9, anchor_on = $10, next_seq = $11,
              next_due_on = $12, end_on = $13, remind_days = $14, status = $15,
              reminded_for = null,
              start_on = least(start_on, $10)
        where id = $1 and user_id = $2
        returning ${SCHEDULE_COLUMNS}`,
      [
        id, userId, v.description, v.amount, v.category, v.accountId, Boolean(v.accountId),
        v.frequency, v.interval, anchor, seq,
        where.next_due_on, v.endOn, v.remindDays, status
      ]
    );

    return rows[0];
  });
}

/** Pausing keeps the next date for show; nothing is added while paused. */
export async function pauseSchedule(userId, id) {
  const { rows } = await query(
    `update recurring_schedules set status = 'paused'
      where id = $1 and user_id = $2 and status = 'active'
      returning ${SCHEDULE_COLUMNS}`,
    [id, userId]
  );

  return rows[0] ?? (await findSchedule(userId, id));
}

/**
 * Resuming carries on from the first date on or after today. Dates missed
 * while paused are not added afterwards: pausing means "not these".
 */
export function resumeSchedule(userId, id, today) {
  return transaction(async client => {
    const { rows: [s] } = await client.query(
      `select ${SCHEDULE_COLUMNS} from recurring_schedules
        where id = $1 and user_id = $2 for update`,
      [id, userId]
    );

    if (!s || s.status !== 'paused') {
      return s ?? null;
    }

    const seq = Math.max(s.next_seq, firstSeqOnOrAfter(s, today));
    const due = advance(s, seq - 1);

    const { rows } = await client.query(
      `update recurring_schedules
          set status = $3, next_seq = $4, next_due_on = $5, reminded_for = null
        where id = $1 and user_id = $2
        returning ${SCHEDULE_COLUMNS}`,
      [id, userId, due.status, due.next_seq, due.next_due_on]
    );

    return rows[0];
  });
}

/**
 * Deletes a schedule and its occurrence log. The expenses and income it added
 * stay exactly as they are; their link to the occurrence is cleared.
 */
export async function deleteSchedule(userId, id) {
  const { rowCount } = await query(
    'delete from recurring_schedules where id = $1 and user_id = $2',
    [id, userId]
  );

  return rowCount > 0;
}

function business(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

/**
 * Adds the entry for one occurrence inside the caller's transaction.
 *
 * A refusal (a status-carrying error from the shared insert, or an account that
 * has since been deleted) is rolled back to the savepoint, so it has written
 * nothing, and is reported as failed. Any other error is thrown, and the whole
 * transaction rolls back.
 */
async function postOccurrence(client, runId, snap) {
  await client.query('savepoint occurrence');

  try {
    if (snap.uses_account && !snap.account_id) {
      throw business('The account it used was deleted.', 400);
    }

    if (snap.kind === 'income') {
      await insertIncome(client, snap.user_id, {
        amount: Number(snap.amount),
        description: snap.description,
        receivedOn: snap.due_on,
        category: snap.category,
        targetId: snap.account_id,
        channel: 'web',
        recurringRunId: runId
      });
    } else {
      const entry = await insertExpense(client, snap.user_id, {
        amount: Number(snap.amount),
        description: snap.description,
        date: snap.due_on,
        category: snap.category,
        sourceId: snap.account_id,
        updateBalance: snap.uses_account,
        canBackdate: true,
        status: 'done',
        remarks: snap.uses_account
          ? 'Added by a recurring schedule; balance updated'
          : 'Added by a recurring schedule',
        recurringRunId: runId
      });

      if (snap.uses_account && !entry.debited) {
        throw new Error('Recurring expense was not debited');
      }
    }

    await client.query('release savepoint occurrence');
    return { status: 'posted' };
  } catch (error) {
    if (!error.status) {
      throw error;
    }

    await client.query('rollback to savepoint occurrence');
    return { status: 'failed', error: error.message };
  }
}

/**
 * Adds the next due occurrence of one schedule, if it has one.
 *
 * @returns the outcome, or null when there was nothing to do (not due, not
 *   active, or another runner holds it right now).
 */
export function runNextOccurrence(scheduleId, today) {
  return transaction(async client => {
    const { rows: [s] } = await client.query(
      `select ${SCHEDULE_COLUMNS} from recurring_schedules
        where id = $1
        for update skip locked`,
      [scheduleId]
    );

    if (!s || s.status !== 'active' || !s.next_due_on || s.next_due_on > today) {
      return null;
    }

    const snap = { ...s, due_on: s.next_due_on };

    const { rows: [run] } = await client.query(
      `insert into recurring_runs (
         schedule_id, user_id, due_on, kind, description, amount, category,
         account_id, uses_account, status, attempts, last_attempt_on
       )
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'posted',1,$10)
       on conflict (schedule_id, due_on) do nothing
       returning id`,
      [
        s.id, s.user_id, snap.due_on, s.kind, s.description, s.amount, s.category,
        s.account_id, s.uses_account, today
      ]
    );

    // Already recorded (only possible if the schedule was moved back over a
    // date it had passed): never add it again, just move on.
    let outcome = { status: 'exists' };

    if (run) {
      outcome = await postOccurrence(client, run.id, snap);

      if (outcome.status === 'failed') {
        await client.query(
          `update recurring_runs set status = 'failed', last_error = $2 where id = $1`,
          [run.id, outcome.error]
        );
      }
    }

    const next = advance(s, s.next_seq);

    await client.query(
      `update recurring_schedules
          set next_seq = $2, next_due_on = $3, status = $4, last_run_at = now()
        where id = $1`,
      [s.id, next.next_seq, next.next_due_on, next.status]
    );

    return {
      ...outcome,
      runId: run?.id ?? null,
      scheduleId: s.id,
      userId: s.user_id,
      kind: s.kind,
      description: s.description,
      amount: Number(s.amount),
      dueOn: snap.due_on
    };
  });
}

/**
 * Tries a failed occurrence again, with the details it was recorded with.
 *
 * @returns the outcome, or null when it is not this user's or not failed.
 */
export function retryRun(runId, today, { userId = null } = {}) {
  return transaction(async client => {
    const { rows: [run] } = await client.query(
      `select ${RUN_COLUMNS} from recurring_runs
        where id = $1 and ($2::uuid is null or user_id = $2)
        for update`,
      [runId, userId]
    );

    if (!run || run.status !== 'failed') {
      return null;
    }

    const outcome = await postOccurrence(client, run.id, run);

    await client.query(
      `update recurring_runs
          set status = $2, attempts = attempts + 1, last_error = $3, last_attempt_on = $4
        where id = $1`,
      [run.id, outcome.status, outcome.error ?? null, today]
    );

    return {
      ...outcome,
      runId: run.id,
      scheduleId: run.schedule_id,
      userId: run.user_id,
      kind: run.kind,
      description: run.description,
      amount: Number(run.amount),
      dueOn: run.due_on
    };
  });
}

/** Gives up on a failed occurrence: nothing is added for it. */
export async function skipRun(userId, runId) {
  const { rows } = await query(
    `update recurring_runs set status = 'skipped'
      where id = $1 and user_id = $2 and status = 'failed'
      returning ${RUN_COLUMNS}`,
    [runId, userId]
  );

  return rows[0] ?? null;
}

/**
 * Adds everything that has come due: for one account (when the app is opened)
 * or for everyone (the daily job). Also retries, once a day, occurrences that
 * failed fewer than MAX_ATTEMPTS times.
 *
 * Stops starting new work after `deadline` (ms since epoch); whatever is left
 * is picked up by the next run, because nothing is marked done until it is.
 */
export async function runDue({ today, userId = null, deadline = Infinity }) {
  const results = [];

  const { rows: due } = await query(
    `select id from recurring_schedules
      where status = 'active' and next_due_on <= $1
        and ($2::uuid is null or user_id = $2)
      order by next_due_on
      limit 500`,
    [today, userId]
  );

  for (const { id } of due) {
    for (let i = 0; i < MAX_CATCH_UP && Date.now() < deadline; i += 1) {
      const outcome = await runNextOccurrence(id, today);

      if (!outcome) {
        break;
      }

      results.push(outcome);
    }
  }

  const { rows: retries } = await query(
    `select id from recurring_runs
      where status = 'failed' and attempts < $2 and last_attempt_on < $1
        and ($3::uuid is null or user_id = $3)
      order by due_on
      limit 500`,
    [today, MAX_ATTEMPTS, userId]
  );

  for (const { id } of retries) {
    if (Date.now() >= deadline) {
      break;
    }

    const outcome = await retryRun(id, today);

    if (outcome) {
      results.push({ ...outcome, retried: true });
    }
  }

  // After every commit, so no alert check ever holds an account lock.
  const budgetAlerts = [];
  const checked = new Set();

  for (const r of results) {
    const key = `${r.userId}:${r.dueOn.slice(0, 7)}`;

    if (r.status === 'posted' && r.kind === 'expense' && !checked.has(key)) {
      checked.add(key);
      budgetAlerts.push(...await checkBudgetAlertsSafely(r.userId, r.dueOn));
    }
  }

  return { results, budgetAlerts };
}

/**
 * Lines for the WhatsApp reply: reminders whose window has opened, and
 * occurrences that could not be added. Each is given once, and only to an
 * account that switched "Recurring reminders on WhatsApp" on.
 */
export async function whatsappReminderLines(userId, today) {
  const { rows: due } = await query(
    `update recurring_schedules
        set reminded_for = next_due_on
      where user_id = $1 and status = 'active' and remind_days is not null
        and next_due_on >= $2 and next_due_on - remind_days <= $2
        and reminded_for is distinct from next_due_on
      returning kind, description, amount, next_due_on`,
    [userId, today]
  );

  const { rows: failed } = await query(
    `update recurring_runs
        set whatsapp_notified = true
      where user_id = $1 and status = 'failed' and not whatsapp_notified
      returning description, amount, due_on, last_error`,
    [userId]
  );

  return [
    ...failed.map(failedLine),
    ...due.map(schedule => reminderLine(schedule, today))
  ];
}

/** As whatsappReminderLines, but never lets a failure spoil the reply. */
export async function whatsappReminderLinesSafely(userId, today) {
  try {
    return await whatsappReminderLines(userId, today);
  } catch (error) {
    console.error('[recurring] reminder lines failed', error.message);
    return [];
  }
}
