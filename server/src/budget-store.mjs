/**
 * Monthly budgets: the queries.
 *
 * Every query is scoped by the signed-in user, and every lookup is by
 * (user, month): no budget id ever comes from a request, so there is no other
 * account's id to guess. What has been spent is read from the expenses each
 * time, never stored, so it cannot drift from them.
 */
import { query, transaction } from './db.mjs';
import {
  OVERALL,
  buildHistory,
  crossings,
  monthOfDate,
  shiftMonth,
  summariseSpending,
  toPaise,
  worstPerScope,
  alertMessage
} from './budget.mjs';

const paiseToText = paise => (paise / 100).toFixed(2);

/**
 * The budget for one month, in paise, or null when there is none.
 *
 * @param run  query function: the pool's, or a transaction client's
 * @param lock FOR UPDATE, when the caller is about to change it
 */
async function loadBudget(run, userId, month, { lock = false } = {}) {
  const { rows } = await run(
    `select id, total_budget from monthly_budgets
      where user_id = $1 and month = $2
      ${lock ? 'for update' : ''}`,
    [userId, month.start]
  );

  if (!rows[0]) {
    return null;
  }

  const { rows: categories } = await run(
    `select category, amount from category_budgets
      where monthly_budget_id = $1
      order by category`,
    [rows[0].id]
  );

  return {
    id: rows[0].id,
    total: rows[0].total_budget === null ? null : toPaise(rows[0].total_budget),
    categories: categories.map(row => ({ category: row.category, amount: toPaise(row.amount) }))
  };
}

/**
 * One month's expenses, grouped by category and status.
 *
 * Only that month's rows are read, through the (user_id, spent_on) index. The
 * sum is the owner's share of each expense; summariseSpending decides which
 * statuses count.
 */
async function loadSpending(run, userId, month) {
  const { rows } = await run(
    `select category, status::text as status,
            sum(coalesce(personal_share, amount)) as spent
       from expenses
      where user_id = $1 and spent_on >= $2 and spent_on < $3 and deleted_at is null
      group by category, status`,
    [userId, month.start, month.end]
  );

  return summariseSpending(rows);
}

async function loadAlerts(budgetId) {
  const { rows } = await query(
    `select scope, threshold, spent, created_at from budget_alerts
      where monthly_budget_id = $1
      order by created_at`,
    [budgetId]
  );

  return rows;
}

/** Everything the month view needs, from three or four small queries. */
export async function loadMonth(userId, month) {
  const [budget, spending] = await Promise.all([
    loadBudget(query, userId, month),
    loadSpending(query, userId, month)
  ]);

  const alerts = budget ? await loadAlerts(budget.id) : [];

  return { budget, spending, alerts };
}

/**
 * The most recent month before this one that has a budget, for copying.
 * Amounts only: what was spent then is not part of a copy.
 */
export async function loadPreviousBudget(userId, month) {
  const { rows } = await query(
    `select month from monthly_budgets
      where user_id = $1 and month < $2
      order by month desc
      limit 1`,
    [userId, month.start]
  );

  if (!rows[0]) {
    return null;
  }

  const from = monthOfDate(rows[0].month);
  const budget = await loadBudget(query, userId, from);

  return budget ? { month: from, budget } : null;
}

/**
 * Re-arms a scope's alerts after its amount changed: everything recorded for it
 * goes, then whatever the spending has already reached at the new amount is
 * recorded again quietly. So raising Travel from ₹3,000 to ₹5,000 lets 80% be
 * announced again at the new level, while lowering it does not suddenly
 * announce thresholds that were passed before the change.
 */
async function rearm(client, budget, spending, scopes) {
  if (scopes.length === 0) {
    return;
  }

  await client.query(
    'delete from budget_alerts where monthly_budget_id = $1 and scope = any($2::text[])',
    [budget.id, scopes]
  );

  const reached = crossings(budget, spending).filter(entry => scopes.includes(entry.scope));

  await insertAlerts(client, budget.id, reached);
}

/** Records crossings, returning only the ones not recorded before. */
async function insertAlerts(run, budgetId, crossed) {
  if (crossed.length === 0) {
    return [];
  }

  const { rows } = await (run.query ? run.query.bind(run) : run)(
    `insert into budget_alerts (monthly_budget_id, scope, threshold, spent)
     select $1, scope, threshold, spent
       from unnest($2::text[], $3::smallint[], $4::numeric[]) as t(scope, threshold, spent)
     on conflict do nothing
     returning scope, threshold`,
    [
      budgetId,
      crossed.map(entry => entry.scope),
      crossed.map(entry => entry.threshold),
      crossed.map(entry => paiseToText(entry.spent))
    ]
  );

  const added = new Set(rows.map(row => `${row.scope}|${row.threshold}`));

  return crossed.filter(entry => added.has(`${entry.scope}|${entry.threshold}`));
}

/**
 * Changes one month's budget in a single transaction.
 *
 * The month's row is created if needed and locked, `change` receives what is
 * there now and returns what should be, and the difference is written. Two
 * edits at once queue on the lock rather than overwriting each other.
 *
 * A month left with neither an overall amount nor any category is removed,
 * along with its alerts.
 *
 * @param change (current: { total, categories } | null) => next | null
 */
export function saveBudget(userId, month, change) {
  return transaction(async client => {
    await client.query(
      `insert into monthly_budgets (user_id, month) values ($1, $2)
       on conflict (user_id, month) do nothing`,
      [userId, month.start]
    );

    const locked = await loadBudget(client.query.bind(client), userId, month, { lock: true });

    // A row that only exists because of the insert above counts as no budget.
    const current = locked.total === null && locked.categories.length === 0 ? null : locked;
    const next = change(current);

    if (!next || (next.total === null && next.categories.length === 0)) {
      await client.query('delete from monthly_budgets where id = $1', [locked.id]);
      return null;
    }

    await client.query('update monthly_budgets set total_budget = $1 where id = $2', [
      next.total === null ? null : paiseToText(next.total),
      locked.id
    ]);

    const keep = next.categories.map(entry => entry.category);

    await client.query(
      `delete from category_budgets
        where monthly_budget_id = $1 and not (category = any($2::text[]))`,
      [locked.id, keep]
    );

    if (next.categories.length) {
      await client.query(
        `insert into category_budgets (monthly_budget_id, category, amount)
         select $1, category, amount
           from unnest($2::text[], $3::numeric[]) as t(category, amount)
         on conflict (monthly_budget_id, category) do update set amount = excluded.amount
         where category_budgets.amount is distinct from excluded.amount`,
        [locked.id, keep, next.categories.map(entry => paiseToText(entry.amount))]
      );
    }

    // Scopes whose amount changed, appeared or went: their alerts re-arm.
    const before = new Map((current?.categories ?? []).map(entry => [entry.category, entry.amount]));
    const after = new Map(next.categories.map(entry => [entry.category, entry.amount]));
    const changed = [...new Set([...before.keys(), ...after.keys()])]
      .filter(category => before.get(category) !== after.get(category));

    if ((current?.total ?? null) !== next.total) {
      changed.push(OVERALL);
    }

    const saved = { id: locked.id, total: next.total, categories: next.categories };

    if (changed.length) {
      const spending = await loadSpending(client.query.bind(client), userId, month);
      await rearm(client, saved, spending, changed);
    }

    return saved;
  });
}

/**
 * Records and returns the thresholds an expense on `date` has just carried a
 * budget past.
 *
 * Called after the expense is committed, never inside its transaction, so it
 * never holds the account lock. The primary key on budget_alerts is what makes
 * each threshold announce once: two expenses saved at the same moment both
 * try, and only one insert returns the row.
 *
 * @returns [{ scope, threshold, spent, budget, message }] — the most severe per
 *   scope, ready to show
 */
export async function checkBudgetAlerts(userId, date) {
  const month = monthOfDate(date);
  const budget = await loadBudget(query, userId, month);

  if (!budget) {
    return [];
  }

  const spending = await loadSpending(query, userId, month);
  const added = await insertAlerts(query, budget.id, crossings(budget, spending));

  return worstPerScope(added).map(entry => ({ ...entry, message: alertMessage(entry) }));
}

/** The same, but a failure is logged rather than thrown: the expense is saved. */
export async function checkBudgetAlertsSafely(userId, date) {
  try {
    return await checkBudgetAlerts(userId, date);
  } catch (error) {
    console.error('[budgets] alert check failed:', error.message);
    return [];
  }
}

/**
 * Up to twelve months ending with `end`, in two queries: every budget in the
 * range with its categories, and every expense grouped by month, category and
 * status.
 */
export async function loadHistory(userId, end, count) {
  const months = Array.from({ length: count }, (_, i) => shiftMonth(end, i - count + 1));
  const from = months[0].start;
  const to = end.end;

  const [{ rows: budgetRows }, { rows: spendingRows }] = await Promise.all([
    query(
      `select b.month, b.total_budget, c.category, c.amount
         from monthly_budgets b
         left join category_budgets c on c.monthly_budget_id = b.id
        where b.user_id = $1 and b.month >= $2 and b.month < $3`,
      [userId, from, to]
    ),
    query(
      `select to_char(spent_on, 'YYYY-MM') as month, category, status::text as status,
              sum(coalesce(personal_share, amount)) as spent
         from expenses
        where user_id = $1 and spent_on >= $2 and spent_on < $3 and deleted_at is null
        group by 1, 2, 3`,
      [userId, from, to]
    )
  ]);

  const budgets = new Map();

  for (const row of budgetRows) {
    const key = monthOfDate(row.month).key;

    if (!budgets.has(key)) {
      budgets.set(key, {
        total: row.total_budget === null ? null : toPaise(row.total_budget),
        categories: []
      });
    }

    if (row.category) {
      budgets.get(key).categories.push({ category: row.category, amount: toPaise(row.amount) });
    }
  }

  const grouped = new Map();

  for (const row of spendingRows) {
    if (!grouped.has(row.month)) {
      grouped.set(row.month, []);
    }

    grouped.get(row.month).push(row);
  }

  const spending = new Map([...grouped].map(([key, rows]) => [key, summariseSpending(rows)]));

  return buildHistory({ months, budgets, spending });
}
