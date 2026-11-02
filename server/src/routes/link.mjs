import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { query } from '../db.mjs';
import { requireAuth } from '../auth.mjs';
import { asyncRoute } from '../http.mjs';
import { WHATSAPP_BUSINESS_NUMBER, isConfigured } from '../whatsapp/client.mjs';

export const linkRouter = Router();

linkRouter.use(requireAuth);

const CODE_TTL_MINUTES = 15;

// No I/O/0/1 — these get read off a screen and typed into a phone.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  let code = '';

  for (let i = 0; i < 6; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }

  return code;
}

/** Masks all but the last four digits, so the UI never shows a full number. */
function maskNumber(number) {
  if (!number) {
    return null;
  }

  return `••••• ${String(number).slice(-4)}`;
}

linkRouter.get('/', asyncRoute(async (req, res) => {
  const { rows } = await query('select whatsapp_number from users where id = $1', [
    req.session.userId
  ]);

  res.json({
    available: isConfigured(),
    connected: Boolean(rows[0]?.whatsapp_number),
    number: maskNumber(rows[0]?.whatsapp_number),
    businessNumber: WHATSAPP_BUSINESS_NUMBER || null
  });
}));

/** Issues a fresh single-use code; any previous one for this account is dropped. */
linkRouter.post('/code', asyncRoute(async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({
      error: 'WhatsApp is not configured on this server.'
    });
  }

  await query('delete from whatsapp_link_codes where user_id = $1', [req.session.userId]);

  // Retry on the vanishingly rare collision with another account's live code.
  let code = generateCode();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inserted = await query(
      `insert into whatsapp_link_codes (code, user_id, expires_at)
       values ($1, $2, now() + ($3 || ' minutes')::interval)
       on conflict (code) do nothing
       returning code`,
      [code, req.session.userId, String(CODE_TTL_MINUTES)]
    );

    if (inserted.rowCount > 0) {
      return res.json({
        code,
        expiresInMinutes: CODE_TTL_MINUTES,
        businessNumber: WHATSAPP_BUSINESS_NUMBER || null,
        // Opens WhatsApp with the message already composed.
        chatUrl: WHATSAPP_BUSINESS_NUMBER
          ? `https://wa.me/${WHATSAPP_BUSINESS_NUMBER}?text=${encodeURIComponent(`link ${code}`)}`
          : null
      });
    }

    code = generateCode();
  }

  res.status(500).json({ error: 'Could not generate a code, please try again.' });
}));

linkRouter.delete('/', asyncRoute(async (req, res) => {
  await query('update users set whatsapp_number = null where id = $1', [req.session.userId]);
  await query('delete from whatsapp_link_codes where user_id = $1', [req.session.userId]);

  res.status(204).end();
}));
