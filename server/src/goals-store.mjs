/**
 * Savings goals in the database.
 *
 * Nothing here touches balances, expenses, incomes, budgets or recurring
 * schedules: a goal only tracks money set aside. Every change to a goal's saved
 * total happens in one transaction with the goal row locked (FOR UPDATE), and
 * writes one history row with the total it left, so two contributions at the
 * same moment are added one after the other and a withdrawal can never take
 * the total below zero.
 */
import { query, transaction } from './db.mjs';
import { TARGET_MAX_PAISE, TRANSITIONS } from './goals.mjs';

const GOAL_COLUMNS = `
  id, user_id, name, description, icon, target_paise, saved_paise, target_date,
  status, created_on, completed_at, created_at, updated_at
`;

const ACTIVITY_COLUMNS = `
  id, goal_id, kind, amount_paise, on_date, note, saved_after_paise, created_at
`;

function refuse(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

/** node-postgres returns bigint as text; every amount here fits a safe integer. */
function goalRow(row) {
  return row && {
    ...row,
    target_paise: Number(row.target_paise),
    saved_paise: Number(row.saved_paise)
  };
}

function activityRow(row) {
  return {
    ...row,
    amount_paise: Number(row.amount_paise),
    saved_after_paise: Number(row.saved_after_paise)
  };
}

export async function listGoals(userId) {
  const { rows } = await query(
    `select ${GOAL_COLUMNS} from savings_goals where user_id = $1 order by created_at`,
    [userId]
  );

  return rows.map(goalRow);
}

export async function findGoal(userId, id) {
  const { rows } = await query(
    `select ${GOAL_COLUMNS} from savings_goals where id = $1 and user_id = $2`,
    [id, userId]
  );

  return goalRow(rows[0] ?? null);
}

/**
 * A goal's history, newest entry first, in the order entries were made: each
 * row's "saved after" is the running total at that moment, so this order
 * always reads correctly even when an entry is dated in the past.
 */
export async function listActivity(userId, goalId, limit = 200) {
  const { rows } = await query(
    `select ${ACTIVITY_COLUMNS} from savings_goal_activity
      where goal_id = $1 and user_id = $2
      order by created_at desc
      limit $3`,
    [goalId, userId, limit]
  );

  return rows.map(activityRow);
}

/** Creates a goal; an "already saved" amount becomes its first history entry. */
export function createGoal(userId, v, today) {
  return transaction(async client => {
    const { rows: [goal] } = await client.query(
      `insert into savings_goals (
         user_id, name, description, icon, target_paise, saved_paise, target_date, status, created_on
       )
       values ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
       returning ${GOAL_COLUMNS}`,
      [userId, v.name, v.description, v.icon, v.targetPaise, v.initialPaise, v.targetDate, today]
    );

    if (v.initialPaise > 0) {
      await client.query(
        `insert into savings_goal_activity (
           goal_id, user_id, kind, amount_paise, on_date, note, saved_after_paise
         )
         values ($1, $2, 'contribution', $3, $4, $5, $3)`,
        [goal.id, userId, v.initialPaise, today, 'Already saved when the goal was created']
      );
    }

    return goalRow(goal);
  });
}

/**
 * Changes a goal's details. Its saved total and history are not touched:
 * a new target changes the percentage, never what was put in.
 */
export async function updateGoal(userId, id, v) {
  const { rows } = await query(
    `update savings_goals
        set name = $3, description = $4, icon = $5, target_paise = $6, target_date = $7
      where id = $1 and user_id = $2
      returning ${GOAL_COLUMNS}`,
    [id, userId, v.name, v.description, v.icon, v.targetPaise, v.targetDate]
  );

  return goalRow(rows[0] ?? null);
}

/**
 * Pause, resume, complete or reopen. Refuses (409) a change that does not
 * apply to the goal's current status, so two clicks cannot do it twice.
 */
export function changeStatus(userId, id, action) {
  const rule = TRANSITIONS[action];

  return transaction(async client => {
    const { rows: [goal] } = await client.query(
      `select ${GOAL_COLUMNS} from savings_goals where id = $1 and user_id = $2 for update`,
      [id, userId]
    );

    if (!goal) {
      return null;
    }

    if (!rule.from.includes(goal.status)) {
      throw refuse(`This goal is ${goal.status}, so it cannot be ${rule.to === 'active' ? 'resumed' : rule.to} now.`);
    }

    const { rows } = await client.query(
      `update savings_goals
          set status = $3,
              completed_at = case when $3 = 'completed' then now() else null end
        where id = $1 and user_id = $2
        returning ${GOAL_COLUMNS}`,
      [id, userId, rule.to]
    );

    return goalRow(rows[0]);
  });
}

/** Deletes a goal and its history. No transaction elsewhere refers to either. */
export async function deleteGoal(userId, id) {
  const { rowCount } = await query(
    'delete from savings_goals where id = $1 and user_id = $2',
    [id, userId]
  );

  return rowCount > 0;
}

/**
 * Puts money towards a goal (`contribution`) or takes it back (`withdrawal`).
 *
 * The goal row is locked first, so concurrent entries queue: each reads the
 * total the previous one left. A withdrawal larger than the total is refused,
 * as is any entry on a completed goal.
 *
 * @returns { goal, entry } or null when the goal is not this user's
 */
export function addEntry(userId, id, kind, v) {
  return transaction(async client => {
    const { rows: [locked] } = await client.query(
      `select ${GOAL_COLUMNS} from savings_goals where id = $1 and user_id = $2 for update`,
      [id, userId]
    );

    const goal = goalRow(locked ?? null);

    if (!goal) {
      return null;
    }

    if (goal.status === 'completed') {
      throw refuse('This goal is completed. Reopen it to add or withdraw.');
    }

    const delta = kind === 'withdrawal' ? -v.amountPaise : v.amountPaise;
    const after = goal.saved_paise + delta;

    if (after < 0) {
      throw refuse(
        `Only ₹${(goal.saved_paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} ` +
        'is saved in this goal, so you cannot withdraw more than that.'
      );
    }

    if (after > TARGET_MAX_PAISE) {
      throw refuse('That would take this goal past ₹99,99,99,999.99.', 400);
    }

    const { rows: [updated] } = await client.query(
      `update savings_goals set saved_paise = $3
        where id = $1 and user_id = $2
        returning ${GOAL_COLUMNS}`,
      [id, userId, after]
    );

    const { rows: [entry] } = await client.query(
      `insert into savings_goal_activity (
         goal_id, user_id, kind, amount_paise, on_date, note, saved_after_paise
       )
       values ($1, $2, $3, $4, $5, $6, $7)
       returning ${ACTIVITY_COLUMNS}`,
      [id, userId, kind, v.amountPaise, v.onDate, v.note, after]
    );

    return { goal: goalRow(updated), entry: activityRow(entry) };
  });
}
