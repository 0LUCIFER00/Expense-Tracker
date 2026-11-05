/**
 * The deployment configuration.
 *
 * On Vercel the pages come from the CDN, not from Express, so the security
 * headers Express sets never reached them: the site could be framed by any
 * other page (clickjacking) and had no content security policy. vercel.json
 * now sends the same headers, and this keeps the two from drifting apart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env['JWT_SECRET'] ??= 'test-secret-that-is-at-least-thirty-two-characters-long';
process.env['DATABASE_URL'] ??= 'postgres://nobody@127.0.0.1:1/never';

const { SECURITY_HEADERS } = await import('../src/app.mjs');

const vercel = JSON.parse(
  readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')
);

function headersFor(source) {
  const rule = vercel.headers?.find(entry => entry.source === source);
  return Object.fromEntries((rule?.headers ?? []).map(header => [header.key, header.value]));
}

test('every page the CDN serves carries the same security headers as the API', () => {
  assert.deepEqual(headersFor('/((?!api/).*)'), SECURITY_HEADERS);
});

test('the page may not be framed by anyone', () => {
  const headers = headersFor('/((?!api/).*)');

  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(headers['Content-Security-Policy'], /script-src 'self'(;|$)/);
});

test('only content-hashed bundles are cached for good', () => {
  const rule = vercel.headers.find(entry => /immutable/.test(JSON.stringify(entry.headers)));

  // index.html must never match: it names the current bundles.
  const pattern = new RegExp(`^${rule.source.replace(/\(\.\*\)/g, '.*')}$`);

  assert.ok(pattern.test('/chunk-AEELCOKP.js'));
  assert.ok(pattern.test('/main-FM7MQBL4.js'));
  assert.ok(pattern.test('/styles-IYXDF7CT.css'));
  assert.ok(!pattern.test('/index.html'));
  assert.ok(!pattern.test('/theme-init.js'));
  assert.ok(!pattern.test('/api/expenses'));
});

test('the API and database stay in the same region', () => {
  assert.deepEqual(vercel.regions, ['sin1']);
});
