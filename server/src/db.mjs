import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { DATABASE_URL, projectRoot } from './env.mjs';

const { Pool, types } = pg;

// node-postgres hands back numeric/decimal as strings to avoid precision loss.
// Money here is well inside the safe range, and the whole app treats amounts as
// numbers, so parse them at the boundary instead of sprinkling Number() about.
types.setTypeParser(types.builtins.NUMERIC, value =>
  value === null ? null : Number(value)
);

// DATE likewise: keep the plain YYYY-MM-DD the API and UI exchange, rather than
// a Date that would shift across timezones.
types.setTypeParser(types.builtins.DATE, value => value);

/**
 * Aiven presents a certificate signed by its own project CA, which is not in
 * the public trust store. Put that CA at server/certs/ca.pem (downloadable from
 * the Aiven console) or point PGSSLROOTCERT at it, and the connection is fully
 * verified. Without it we still encrypt, but cannot authenticate the server.
 */
function resolveCa() {
  const configured = process.env['PGSSLROOTCERT'];
  const candidates = [configured, join(projectRoot, 'server', 'certs', 'ca.pem')];

  for (const path of candidates) {
    if (path && existsSync(path)) {
      return { ca: readFileSync(path, 'utf8'), path };
    }
  }

  return null;
}

function buildSslConfig(url) {
  const sslRequested =
    url.searchParams.get('sslmode') !== 'disable' &&
    (url.searchParams.has('sslmode') || /aivencloud\.com$/.test(url.hostname));

  if (!sslRequested) {
    return { ssl: false };
  }

  const ca = resolveCa();

  if (ca) {
    return { ssl: { ca: ca.ca, rejectUnauthorized: true }, caPath: ca.path };
  }

  return { ssl: { rejectUnauthorized: false }, caPath: null };
}

const url = new URL(DATABASE_URL);

// pg now derives its TLS behaviour from sslmode in the connection string, which
// would override the ssl object below. Strip it and configure TLS in one place.
url.searchParams.delete('sslmode');

const { ssl, caPath } = buildSslConfig(new URL(DATABASE_URL));

if (ssl && !caPath) {
  console.warn(
    '[db] TLS is on but the server certificate is not verified. Download your ' +
    "Aiven CA to server/certs/ca.pem (or set PGSSLROOTCERT) to verify it."
  );
}

export const pool = new Pool({
  connectionString: url.toString(),
  ssl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000
});

pool.on('error', error => {
  console.error('[db] idle client error', error.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export async function transaction(fn) {
  const client = await pool.connect();

  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
