import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = join(here, '..', '..');
const envPath = join(projectRoot, '.env');

dotenv.config({ path: envPath });

/**
 * The connection string. `aiven_url` is what the project's .env already uses;
 * DATABASE_URL is accepted too so deployments can use the conventional name.
 */
function readDatabaseUrl() {
  const direct = process.env['DATABASE_URL'] || process.env['aiven_url'];

  if (direct) {
    return direct.trim().replace(/^["']|["']$/g, '');
  }

  // dotenv keeps keys verbatim, and a stray space ("aiven_url = ...") would
  // otherwise make the variable unreachable.
  const loose = Object.entries(process.env).find(
    ([key]) => key.trim().toLowerCase() === 'aiven_url'
  );

  return loose ? loose[1].trim().replace(/^["']|["']$/g, '') : undefined;
}

export const DATABASE_URL = readDatabaseUrl();

if (!DATABASE_URL) {
  throw new Error(
    'No database connection string. Set DATABASE_URL (or aiven_url) in .env'
  );
}

/**
 * Sessions are signed with this. A missing secret is written back to .env once
 * so that restarting the server does not sign everyone out during development.
 */
function readOrCreateJwtSecret() {
  const existing = process.env['JWT_SECRET'];

  if (existing && existing.length >= 32) {
    return existing;
  }

  const generated = randomBytes(48).toString('base64url');

  try {
    const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
    const needsNewline = current.length > 0 && !current.endsWith('\n');

    appendFileSync(
      envPath,
      `${needsNewline ? '\n' : ''}\n# Generated automatically; keep this secret.\nJWT_SECRET=${generated}\n`
    );

    console.warn('[env] No JWT_SECRET found — generated one and appended it to .env');
  } catch (error) {
    console.warn(
      `[env] No JWT_SECRET found and .env is not writable (${error.message}). ` +
      'Using an in-memory secret; sessions will not survive a restart.'
    );
  }

  return generated;
}

export const JWT_SECRET = readOrCreateJwtSecret();

export const PORT = Number(process.env['PORT'] || 3000);

export const NODE_ENV = process.env['NODE_ENV'] || 'development';

export const IS_PRODUCTION = NODE_ENV === 'production';
