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
