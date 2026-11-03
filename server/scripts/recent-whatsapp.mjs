/*
 * What has arrived over WhatsApp lately.
 *
 * A script rather than a one-liner because the query has to be quoted, and
 * PowerShell reads a backtick as its own escape character and a double quote
 * as the end of the argument — so the same command that works in bash arrives
 * at node with the SQL mangled.
 *
 *   npm run wa:recent
 */
import { query, closePool } from '../src/db.mjs';

const LIMIT = 10;

function show(title, rows, columns) {
  console.log(`\n${title} (${rows.length})`);

  if (rows.length === 0) {
    console.log('  nothing yet');
    return;
  }

  for (const row of rows) {
    console.log('  ' + columns.map(c => c(row)).join('  '));
  }
}

const when = value => new Date(value).toLocaleString();
const money = value => `₹${Number(value).toLocaleString('en-IN')}`.padStart(10);

try {
  const expenses = await query(
    `select amount, description, category, status, balance_updated, created_at
       from expenses
      where source_channel = 'whatsapp'
      order by created_at desc
      limit $1`,
    [LIMIT]
  );

  show('Expenses', expenses.rows, [
    r => when(r.created_at).padEnd(22),
    r => money(r.amount),
    r => String(r.description).padEnd(24),
    r => String(r.category ?? '—').padEnd(16),
    r => (r.status === 'done' ? 'done' : 'pending').padEnd(8),
    r => (r.balance_updated ? 'balance debited' : 'no account named')
  ]);

  const incomes = await query(
    `select amount, description, category, created_at
       from incomes
      where source_channel = 'whatsapp'
      order by created_at desc
      limit $1`,
    [LIMIT]
  );

  show('Money in', incomes.rows, [
    r => when(r.created_at).padEnd(22),
    r => money(r.amount),
    r => String(r.description).padEnd(24),
    r => String(r.category ?? '—')
  ]);

  const handled = await query(
    'select count(*)::int as n, max(processed_at) as latest from whatsapp_processed_messages'
  );

  const { n, latest } = handled.rows[0];

  console.log(
    `\nInbound messages handled: ${n}${latest ? ` | latest ${when(latest)}` : ''}`
  );

  // Every message is counted here, including balance, today and help, which
  // record nothing — so this being larger than the lists above is normal.
  console.log('Counts every message, including ones that record nothing.\n');
} finally {
  await closePool();
}
