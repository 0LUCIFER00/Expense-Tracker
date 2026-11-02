/**
 * Checks the WhatsApp setup without sending anything.
 *
 *   npm run wa:check
 *
 * Tells you which of the four values are missing, whether the token and phone
 * number ID actually work against Meta, and what to put in the webhook form.
 */
import '../src/env.mjs';
import {
  WHATSAPP_APP_SECRET,
  WHATSAPP_BUSINESS_NUMBER,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_TOKEN,
  WHATSAPP_VERIFY_TOKEN
} from '../src/whatsapp/client.mjs';

const tick = (ok) => (ok ? 'ok     ' : 'MISSING');

const checks = [
  ['WHATSAPP_TOKEN', WHATSAPP_TOKEN, 'WhatsApp → API Setup → access token'],
  ['WHATSAPP_PHONE_NUMBER_ID', WHATSAPP_PHONE_NUMBER_ID, 'API Setup → the numeric Phone number ID'],
  ['WHATSAPP_APP_SECRET', WHATSAPP_APP_SECRET, 'App Settings → Basic → App secret'],
  ['WHATSAPP_VERIFY_TOKEN', WHATSAPP_VERIFY_TOKEN, 'any string you invent'],
  ['WHATSAPP_BUSINESS_NUMBER', WHATSAPP_BUSINESS_NUMBER, 'optional — enables the one-tap link']
];

console.log('Configuration in .env\n');

for (const [name, value, hint] of checks) {
  const optional = name === 'WHATSAPP_BUSINESS_NUMBER';
  const status = value ? tick(true) : optional ? 'skipped' : tick(false);
  console.log(`  ${status}  ${name}`);

  if (!value) {
    console.log(`           ↳ ${hint}`);
  }
}

console.log('');

if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
  console.log('Fill in the token and phone number ID, then run this again.');
  process.exit(1);
}

// Reading the number back is the cheapest way to prove the pair is valid.
const url =
  `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}` +
  '?fields=display_phone_number,verified_name,quality_rating';

try {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
  });

  const body = await response.json();

  if (!response.ok) {
    const error = body?.error ?? {};
    console.log(`Meta rejected the request (HTTP ${response.status})`);
    console.log(`  ${error.message ?? 'unknown error'}`);

    if (error.code === 190) {
      console.log('\n  The token is invalid or has expired. Tokens from API Setup last');
      console.log('  about 24 hours — create a System User token for anything lasting.');
    } else if (error.code === 100) {
      console.log('\n  Check WHATSAPP_PHONE_NUMBER_ID: it must be the numeric *ID* from');
      console.log('  API Setup, not the phone number itself.');
    }

    process.exit(1);
  }

  console.log('Meta says');
  console.log(`  number         ${body.display_phone_number}`);
  console.log(`  name           ${body.verified_name}`);
  console.log(`  quality        ${body.quality_rating ?? 'n/a'}`);

  const digits = String(body.display_phone_number ?? '').replace(/\D/g, '');

  if (digits && WHATSAPP_BUSINESS_NUMBER && digits !== WHATSAPP_BUSINESS_NUMBER) {
    console.log(
      `\n  Note: WHATSAPP_BUSINESS_NUMBER is ${WHATSAPP_BUSINESS_NUMBER}, but this ` +
      `number is ${digits}. The one-tap link will open the wrong chat.`
    );
  }

  if (digits && !WHATSAPP_BUSINESS_NUMBER) {
    console.log(`\n  Tip: set WHATSAPP_BUSINESS_NUMBER=${digits} for the one-tap link.`);
  }
} catch (error) {
  console.log(`Could not reach Meta: ${error.message}`);
  process.exit(1);
}

console.log('\nWebhook form (WhatsApp → Configuration → Edit)');
console.log('  Callback URL   https://<your-public-host>/api/whatsapp/webhook');
console.log(`  Verify token   ${WHATSAPP_VERIFY_TOKEN || '(set WHATSAPP_VERIFY_TOKEN first)'}`);
console.log('  Then subscribe to the "messages" field.');
