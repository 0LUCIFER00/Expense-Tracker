import { createHmac, timingSafeEqual } from 'node:crypto';

const GRAPH_VERSION = 'v21.0';

export const WHATSAPP_TOKEN = process.env['WHATSAPP_TOKEN'] ?? '';
export const WHATSAPP_PHONE_NUMBER_ID = process.env['WHATSAPP_PHONE_NUMBER_ID'] ?? '';
export const WHATSAPP_VERIFY_TOKEN = process.env['WHATSAPP_VERIFY_TOKEN'] ?? '';
export const WHATSAPP_APP_SECRET = process.env['WHATSAPP_APP_SECRET'] ?? '';

/**
 * The display number in international form, digits only. Optional: it is only
 * used to build a wa.me link so the user can tap through with the code already
 * typed, instead of finding the number themselves.
 */
export const WHATSAPP_BUSINESS_NUMBER =
  String(process.env['WHATSAPP_BUSINESS_NUMBER'] ?? '').replace(/\D/g, '');

export function isConfigured() {
  return Boolean(WHATSAPP_TOKEN && WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Confirms the request really came from Meta.
 *
 * Without this anyone who learns the URL could post expenses into any linked
 * account, so a missing signature is treated as a failure rather than skipped.
 */
export function verifySignature(rawBody, header) {
  if (!WHATSAPP_APP_SECRET) {
    return { ok: false, reason: 'WHATSAPP_APP_SECRET is not set' };
  }

  if (!header || !header.startsWith('sha256=')) {
    return { ok: false, reason: 'missing signature header' };
  }

  const expected = createHmac('sha256', WHATSAPP_APP_SECRET)
    .update(rawBody ?? Buffer.alloc(0))
    .digest('hex');

  const received = header.slice('sha256='.length);

  if (received.length !== expected.length) {
    return { ok: false, reason: 'signature length mismatch' };
  }

  // Buffer.from(..., 'hex') stops at the first character that is not hex and
  // returns a shorter buffer, which makes timingSafeEqual throw on the length
  // check below — a 500 where this should plainly be a rejection.
  if (!/^[0-9a-f]+$/i.test(received)) {
    return { ok: false, reason: 'signature is not hexadecimal' };
  }

  const same = timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));

  return same ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

/**
 * Pulls the first text message out of a webhook payload.
 * Meta nests it several levels deep and also sends status-only callbacks,
 * which have no message at all.
 */
export function extractTextMessage(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];

  if (!message || message.type !== 'text') {
    return null;
  }

  return {
    messageId: message.id,
    from: message.from,
    text: message.text?.body ?? '',
    contactName: value?.contacts?.[0]?.profile?.name ?? null
  };
}

/** Sends a plain text reply. Failures are logged, never thrown at the webhook. */
export async function sendText(to, body) {
  if (!isConfigured()) {
    console.warn('[whatsapp] not configured; would have replied:', body);
    return false;
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body, preview_url: false }
        })
      }
    );

    if (!response.ok) {
      console.error('[whatsapp] send failed', response.status, await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error('[whatsapp] send error', error.message);
    return false;
  }
}

/** E.164 digits, as Meta reports them — no plus, no spaces. */
export function normaliseNumber(value) {
  return String(value ?? '').replace(/\D/g, '');
}
