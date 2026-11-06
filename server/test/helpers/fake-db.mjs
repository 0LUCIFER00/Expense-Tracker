/**
 * A stand-in for server/src/db.mjs, so routes can be exercised end to end
 * without a database.
 *
 * Each test says which SQL it expects and what comes back, by pattern. A query
 * nobody expected throws, naming the SQL, so a test cannot pass by accident
 * against a statement it did not anticipate. Every call is recorded, so a test
 * can also assert that something was NOT run (a delete, an insert).
 *
 * What this cannot show is how Postgres itself behaves: locking, constraint
 * checks, concurrent transactions. Those need a real database; see the report.
 */
export function createFakeDb() {
  const handlers = [];
  const calls = [];

  /**
   * @param pattern RegExp matched against the SQL text
   * @param reply   (params, text) => rows | { rows, rowCount }
   *
   * Later registrations win, so a test can override a default.
   */
  function on(pattern, reply) {
    handlers.push({ pattern, reply });
  }

  async function query(text, params = []) {
    calls.push({ text, params });

    for (let i = handlers.length - 1; i >= 0; i -= 1) {
      const handler = handlers[i];

      if (handler.pattern.test(text)) {
        const result = await handler.reply(params, text);
        const rows = Array.isArray(result) ? result : result?.rows ?? [];

        return { rows, rowCount: result?.rowCount ?? rows.length };
      }
    }

    throw new Error(`Unexpected query: ${text.replace(/\s+/g, ' ').trim().slice(0, 140)}`);
  }

  async function transaction(fn) {
    return fn({ query });
  }

  /** Calls whose SQL matches `pattern`. */
  function ran(pattern) {
    return calls.filter(call => pattern.test(call.text));
  }

  function reset() {
    handlers.length = 0;
    calls.length = 0;
  }

  const pool = {
    query,
    connect: async () => ({ query, release() {} }),
    on() {},
    end: async () => {}
  };

  return { query, transaction, on, ran, calls, reset, pool, closePool: async () => {} };
}

/** The flags column by column, all granted unless overridden. */
export function settingsRow(overrides = {}) {
  return {
    balance_user_access: true,
    add_money_user_access: true,
    whatsapp_balance_user_access: true,
    expense_user_access: true,
    update_permission_user: true,
    view_permission_user: true,
    remove_permission_user: true,
    budget_user_access: true,
    whatsapp_budget_alerts: false,
    ...overrides
  };
}
