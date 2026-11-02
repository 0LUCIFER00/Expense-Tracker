/**
 * Applies every .sql file in server/migrations that has not run yet, in
 * filename order, each inside its own transaction. Safe to re-run.
 *
 *   npm run db:migrate
 *   npm run db:migrate -- --status   # list without applying
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { closePool, pool } from '../src/db.mjs';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const TRACKING_TABLE = `
  create table if not exists schema_migrations (
    version    text primary key,
    applied_at timestamptz not null default now()
  )
`;

function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .sort();
}

async function appliedVersions(client) {
  const { rows } = await client.query('select version from schema_migrations');
  return new Set(rows.map(row => row.version));
}

async function main() {
  const statusOnly = process.argv.includes('--status');
  const client = await pool.connect();

  try {
    await client.query(TRACKING_TABLE);

    const applied = await appliedVersions(client);
    const files = migrationFiles();
    const pending = files.filter(file => !applied.has(file));

    if (statusOnly) {
      for (const file of files) {
        console.log(`${applied.has(file) ? 'applied' : 'pending'}  ${file}`);
      }
      return;
    }

    if (pending.length === 0) {
      console.log(`Database is up to date (${applied.size} migration(s) applied).`);
      return;
    }

    for (const file of pending) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');

      process.stdout.write(`Applying ${file} ... `);

      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (version) values ($1)', [file]);
        await client.query('commit');
        console.log('ok');
      } catch (error) {
        await client.query('rollback').catch(() => {});
        console.log('failed');
        throw error;
      }
    }

    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    client.release();
    await closePool();
  }
}

main().catch(error => {
  console.error(`\nMigration failed: ${error.message}`);

  if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
    console.error(
      'The database host could not be resolved. Check the connection string ' +
      'in .env against the Connection information panel in the Aiven console, ' +
      'and that the service is running.'
    );
  }

  process.exitCode = 1;
});
