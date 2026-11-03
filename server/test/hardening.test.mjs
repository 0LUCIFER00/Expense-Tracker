/**
 * The checks added by the pre-deployment audit: input ceilings, the rate
 * limiter, and the signature header's shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseEmail, parseText } from '../src/http.mjs';
import { rateLimit, resetRateLimits } from '../src/rate-limit.mjs';
import { parseMessage } from '../src/whatsapp/parser.mjs';

// The client reads its config at import time, so the secret is set first.
process.env['WHATSAPP_APP_SECRET'] = 'test-app-secret';

const { verifySignature } = await import('../src/whatsapp/client.mjs');

// ---------------------------------------------------------------- parseText

test('parseText trims and accepts ordinary input', () => {
  assert.deepEqual(parseText('  Coffee  ', { field: 'Description', max: 200 }), {
    value: 'Coffee'
  });
});

test('parseText refuses an empty required field', () => {
  const result = parseText('   ', { field: 'Description', max: 200 });
  assert.equal(result.error, 'Description is required');
});

test('parseText allows an empty optional field', () => {
  assert.deepEqual(parseText('', { field: 'Note', max: 10, required: false }), {
    value: ''
  });
});

test('parseText refuses anything over the ceiling', () => {
  const result = parseText('x'.repeat(201), { field: 'Description', max: 200 });

  assert.equal(result.error, 'Description must be 200 characters or fewer');
  assert.equal(parseText('x'.repeat(200), { field: 'D', max: 200 }).value.length, 200);
});

test('an address longer than the RFC limit is not an address', () => {
  const long = `${'a'.repeat(250)}@example.com`;

  assert.equal(normaliseEmail(long), null);
  assert.equal(normaliseEmail('ada@example.com'), 'ada@example.com');
});

// -------------------------------------------------------------- rate limits

/** A stand-in for the pieces of req/res the limiter touches. */
function call(limiter, { ip = '1.2.3.4', body = {} } = {}) {
  const req = { ip, body, method: 'POST', baseUrl: '/api/auth', path: '/login' };

  let status = null;
  let payload = null;
  let passed = false;

  const res = {
    set: () => res,
    status(code) {
      status = code;
      return res;
    },
    json(value) {
      payload = value;
      return res;
    }
  };

  limiter(req, res, () => {
    passed = true;
  });

  return { passed, status, payload };
}

test('the limiter lets the first attempts through and then stops', () => {
  resetRateLimits();

  const limiter = rateLimit({ limit: 3, windowMs: 60_000 });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assert.equal(call(limiter).passed, true, `attempt ${attempt} should pass`);
  }

  const blocked = call(limiter);

  assert.equal(blocked.passed, false);
  assert.equal(blocked.status, 429);
  assert.match(blocked.payload.error, /Too many attempts/);
});

test('one address being blocked does not block another', () => {
  resetRateLimits();

  const limiter = rateLimit({ limit: 1, windowMs: 60_000 });

  assert.equal(call(limiter, { ip: '1.1.1.1' }).passed, true);
  assert.equal(call(limiter, { ip: '1.1.1.1' }).passed, false);
  assert.equal(call(limiter, { ip: '2.2.2.2' }).passed, true);
});

test('counting by account keeps one target from locking out the rest', () => {
  resetRateLimits();

  const limiter = rateLimit({
    limit: 1,
    windowMs: 60_000,
    key: req => `${req.ip}|${req.body.email}`
  });

  const target = { body: { email: 'owner@example.com' } };

  assert.equal(call(limiter, target).passed, true);
  assert.equal(call(limiter, target).passed, false, 'the guessed account is limited');

  assert.equal(
    call(limiter, { body: { email: 'someone.else@example.com' } }).passed,
    true,
    'a different account is unaffected'
  );
});

test('the window reopens once it has passed', () => {
  resetRateLimits();

  const limiter = rateLimit({ limit: 1, windowMs: 1 });

  assert.equal(call(limiter).passed, true);
  assert.equal(call(limiter).passed, false);

  const resumes = Date.now() + 2;
  while (Date.now() < resumes) {
    // Busy-wait; the window is a millisecond, so a timer would cost more.
  }

  assert.equal(call(limiter).passed, true);
});

// ---------------------------------------------------------- webhook signing

test('a signature that is not hexadecimal is rejected, not thrown on', () => {
  // 64 characters so the length check passes and the hex check is what runs.
  const header = `sha256=${'z'.repeat(64)}`;

  const result = verifySignature(Buffer.from('{}'), header);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'signature is not hexadecimal');
});

test('a missing or malformed header is rejected', () => {
  assert.equal(verifySignature(Buffer.from('{}'), undefined).ok, false);
  assert.equal(verifySignature(Buffer.from('{}'), 'sha1=abc').ok, false);
});

// ------------------------------------------------------------- parser bound

test('a very long message does not become a very long description', () => {
  const parsed = parseMessage(`250 ${'lunch '.repeat(200)}`);

  assert.equal(parsed.kind, 'expense');
  assert.ok(parsed.description.length <= 200, 'description stays within the cap');
  assert.ok(parsed.description.endsWith('…'), 'and says it was cut');
});
