/**
 * Diagnoses the database connection without touching any data.
 *
 *   npm run db:check
 *
 * Separates "the hostname does not resolve" from "the credentials are wrong"
 * from "the service is not accepting connections yet", because those have very
 * different fixes.
 */
import { lookup } from 'node:dns/promises';
import { URL } from 'node:url';
import { DATABASE_URL } from '../src/env.mjs';
import { closePool, pool } from '../src/db.mjs';

const url = new URL(DATABASE_URL);

console.log('Connection target');
console.log(`  host     ${url.hostname}`);
console.log(`  port     ${url.port}`);
console.log(`  database ${url.pathname.replace('/', '')}`);
console.log(`  user     ${url.username}`);
console.log(`  password ${'*'.repeat(8)} (${url.password.length} chars)`);
console.log(`  ssl      ${url.searchParams.get('sslmode') ?? 'not specified'}`);
console.log('');

let resolved = false;

try {
  const { address } = await lookup(url.hostname);
  console.log(`DNS      ok — ${url.hostname} -> ${address}`);
  resolved = true;
} catch (error) {
  console.error(`DNS      FAILED — ${url.hostname} does not resolve (${error.code})`);
  console.error('');
  console.error('  The hostname is wrong, or the Aiven service is still being');
  console.error('  created, powered off, or deleted. Compare the string in .env');
  console.error('  with the Connection information panel in the Aiven console.');
}

if (resolved) {
  try {
    const { rows } = await pool.query(
      'select version() as version, current_database() as db, current_user as "user"'
    );
    console.log(`Connect  ok — ${rows[0].user}@${rows[0].db}`);
    console.log(`Server   ${rows[0].version.split(',')[0]}`);

    const tables = await pool.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`
    );

    console.log('');
    console.log(
      tables.rowCount === 0
        ? 'Tables   none yet — run: npm run db:migrate'
        : `Tables   ${tables.rows.map(r => r.table_name).join(', ')}`
    );
  } catch (error) {
    console.error(`Connect  FAILED — ${error.message}`);

    if (error.code === '28P01') {
      console.error('  The password in .env is not accepted by the server.');
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      console.error('  The host resolved but refused the connection. Check the');
      console.error('  port, and whether your IP is allowed in the Aiven firewall.');
    }

    process.exitCode = 1;
  }
} else {
  process.exitCode = 1;
}

await closePool().catch(() => {});
