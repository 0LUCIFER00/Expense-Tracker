import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

// The module reads its config at import time.
process.env['WHATSAPP_APP_SECRET'] = 'test-app-secret';

const { verifySignature, extractTextMessage, normaliseNumber } =
  await import('../src/whatsapp/client.mjs');

function sign(body, secret = 'test-app-secret') {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

test('accepts a correctly signed body', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));

  assert.equal(verifySignature(body, sign(body)).ok, true);
});

test('rejects a body that was tampered with', () => {
  const body = Buffer.from(JSON.stringify({ amount: 1 }));
  const signature = sign(body);
  const tampered = Buffer.from(JSON.stringify({ amount: 99999 }));

  assert.equal(verifySignature(tampered, signature).ok, false);
});

test('rejects a signature made with the wrong secret', () => {
  const body = Buffer.from('{}');

  assert.equal(verifySignature(body, sign(body, 'not-the-secret')).ok, false);
});

test('rejects a missing or malformed header', () => {
  const body = Buffer.from('{}');

  assert.equal(verifySignature(body, undefined).ok, false);
  assert.equal(verifySignature(body, '').ok, false);
  assert.equal(verifySignature(body, 'md5=abc').ok, false);
  assert.equal(verifySignature(body, 'sha256=short').ok, false);
});

test('extracts a text message from a webhook payload', () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ profile: { name: 'Ada' } }],
              messages: [
                { id: 'wamid.123', from: '919876543210', type: 'text', text: { body: '250 coffee' } }
              ]
            }
          }
        ]
      }
    ]
  };

  const message = extractTextMessage(payload);

  assert.equal(message.messageId, 'wamid.123');
  assert.equal(message.from, '919876543210');
  assert.equal(message.text, '250 coffee');
  assert.equal(message.contactName, 'Ada');
});

test('ignores delivery-status callbacks and non-text messages', () => {
  assert.equal(extractTextMessage({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }), null);

  assert.equal(
    extractTextMessage({
      entry: [{ changes: [{ value: { messages: [{ id: 'x', type: 'image' }] } }] }]
    }),
    null
  );

  assert.equal(extractTextMessage({}), null);
  assert.equal(extractTextMessage(null), null);
});

test('normaliseNumber keeps only digits', () => {
  assert.equal(normaliseNumber('+91 98765-43210'), '919876543210');
  assert.equal(normaliseNumber('919876543210'), '919876543210');
  assert.equal(normaliseNumber(null), '');
});

/*
 * Meta keeps a webhook it could not deliver and retries it for days. One that
 * arrives a day late records a spend the owner made long ago — in the case
 * that found this, one they had already entered by hand in the meantime, so
 * the ledger showed it twice. The replay carries a new message id, so the
 * processed-message table cannot recognise it; the only thing that separates
 * it from a live message is when it was sent.
 */
const { isStale, messageAgeMs } = await import('../src/whatsapp/client.mjs');

function envelope(secondsAgo) {
  return {
    entry: [{ changes: [{ value: {
      messages: [{
        id: 'wamid.test',
        from: '918148412199',
        type: 'text',
        text: { body: '150 sunday food hdfc' },
        timestamp: String(Math.floor(Date.now() / 1000) - secondsAgo)
      }]
    } }] }]
  };
}

test('reads when the message was sent', () => {
  const message = extractTextMessage(envelope(0));

  assert.ok(message.sentAt, 'sentAt is carried through');
  assert.ok(messageAgeMs(message) < 2000, 'a message just sent reads as new');
});

test('a message just sent is acted on', () => {
  assert.equal(isStale(extractTextMessage(envelope(5))), false);
});

test('a slow but genuine retry is still acted on', () => {
  assert.equal(isStale(extractTextMessage(envelope(120))), false);
});

test('a message replayed a day later is ignored', () => {
  assert.equal(isStale(extractTextMessage(envelope(24 * 60 * 60))), true);
});

test('a message with no timestamp is acted on rather than dropped', () => {
  const message = extractTextMessage({
    entry: [{ changes: [{ value: {
      messages: [{ id: 'wamid.x', from: '91', type: 'text', text: { body: 'help' } }]
    } }] }]
  });

  assert.equal(messageAgeMs(message), null);
  assert.equal(isStale(message), false, 'absence of a timestamp is not evidence of staleness');
});
