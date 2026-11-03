/**
 * Turns a free-text WhatsApp message into an intent.
 *
 * People type quickly and inconsistently from a phone, so this is deliberately
 * forgiving: "250 coffee paytm", "paid 1,200 for groceries hdfc", "₹80 chai"
 * all work. It is pure — no database, no network — so the whole grammar is
 * testable without a WhatsApp account.
 */

const HELP_WORDS = new Set(['help', 'hi', 'hello', 'hey', 'start', '?']);
const BALANCE_WORDS = new Set(['balance', 'bal', 'balances']);
const UNDO_WORDS = new Set(['undo', 'delete', 'remove', 'cancel', 'oops']);
const LIST_WORDS = new Set(['today', 'list', 'recent']);

/*
 * Words that mark a message as money coming in rather than going out.
 *
 * Deliberately not "add": people say "add 250 coffee" to record an expense at
 * least as often as to record a credit, and guessing wrong moves money the
 * wrong way. A leading "+" is the unambiguous form and the one the help names.
 */
const INCOME_WORDS = new Set([
  'received', 'receive', 'got', 'credit', 'credited', 'income', 'deposit',
  'deposited', 'earned', 'salary', 'refund', 'refunded'
]);

/** Matches the cap the web form enforces, so the two cannot disagree. */
const DESCRIPTION_MAX = 200;

/** Filler that should never end up in the description. */
const NOISE = new Set([
  'rs', 'rs.', 'inr', 'rupees', 'spent', 'paid', 'for', 'on', 'to', 'at',
  'from', 'using', 'via', 'by', 'with', 'of', 'the', 'a', 'an',
  // The verbs that mark money coming in; the direction is kept, not the word.
  'received', 'receive', 'got', 'credit', 'credited', 'deposit', 'deposited',
  'earned', 'into', 'in',
  // Filler in both directions: "add 250 coffee", "added 500 salary".
  'add', 'added'
]);

const LINK_PATTERN = /^link\s+([a-z0-9]{4,10})$/i;

/**
 * First standalone number in the text. Accepts ₹, thousands separators and a
 * decimal part; rejects digits glued to letters so "2kg rice" is not an amount.
 */
const AMOUNT_PATTERN = /(?:^|\s)(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|\d+(?:\.\d+)?)(?=\s|$)/i;

function tokenise(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function normalise(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Every way a user might name one of their accounts.
 *
 * People type the short form — "hdfc", not "HDFC Bank" — so each individual
 * word of the category is an alias too. An alias that several accounts share
 * ("bank" when both Indian Bank and HDFC Bank exist) is deliberately kept
 * pointing at all of them, so the caller can ask instead of guessing.
 */
function buildAliases(accounts) {
  const aliases = new Map();

  const add = (text, account) => {
    const key = normalise(text);

    if (key.length < 3) {
      return;
    }

    if (!aliases.has(key)) {
      aliases.set(key, { words: String(text).trim().split(/\s+/).length, accounts: new Set() });
    }

    aliases.get(key).accounts.add(account);
  };

  for (const account of accounts) {
    add(account.category, account);
    add(account.type, account);

    for (const word of String(account.category ?? '').split(/\s+/)) {
      add(word, account);
    }

    // "cash" is how people refer to a Hand Cash account.
    if (/hand cash/i.test(account.type ?? '')) {
      add('cash', account);
    }
  }

  return aliases;
}

/**
 * Finds which of the user's balance accounts a message refers to.
 *
 * Looks at every run of 1-3 adjacent words, longest first, so "hdfc bank"
 * wins over "hdfc" and "bank". Returns the matched account and the words it
 * consumed so the caller can strip them from the description, or the list of
 * candidates when the name was ambiguous.
 */
export function matchAccount(text, accounts = []) {
  const aliases = buildAliases(accounts);
  const tokens = tokenise(text);

  // Longest spans first; among equal spans, earliest in the message.
  for (let span = Math.min(3, tokens.length); span >= 1; span -= 1) {
    for (let i = 0; i + span <= tokens.length; i += 1) {
      const phrase = tokens.slice(i, i + span).join(' ');
      const entry = aliases.get(normalise(phrase));

      if (!entry) {
        continue;
      }

      const matched = [...entry.accounts];

      if (matched.length === 1) {
        return { account: matched[0], matchedTokens: tokens.slice(i, i + span) };
      }

      // Shared between accounts — let the caller ask which one.
      return { account: null, ambiguous: matched, matchedTokens: tokens.slice(i, i + span) };
    }
  }

  return null;
}

function cleanDescription(words) {
  const kept = words.filter(word => {
    const bare = word.replace(/[^\w₹.]/g, '').toLowerCase();
    return bare && !NOISE.has(bare);
  });

  const text = kept
    .join(' ')
    .replace(/\s+/g, ' ')
    // Separators left behind once the amount and account are removed, e.g.
    // "150 sunday food, hdfc" -> "sunday food,".
    .replace(/^[\s,.;:\-–—]+|[\s,.;:\-–—]+$/g, '')
    .trim();

  if (!text) {
    return '';
  }

  const sentence = text.charAt(0).toUpperCase() + text.slice(1);

  // The same ceiling the web form is held to. Meta allows 4096 characters in a
  // message, and an entry that long breaks every table and reply that shows it.
  return sentence.length > DESCRIPTION_MAX
    ? sentence.slice(0, DESCRIPTION_MAX - 1).trimEnd() + '…'
    : sentence;
}

/**
 * @param {string} raw        the message body
 * @param {Array}  accounts   the user's saved balance accounts
 */
export function parseMessage(raw, accounts = []) {
  const text = String(raw ?? '').trim();

  if (!text) {
    return { kind: 'unknown' };
  }

  const lower = text.toLowerCase();
  const single = tokenise(lower);

  const linkMatch = text.match(LINK_PATTERN);

  if (linkMatch) {
    return { kind: 'link', code: linkMatch[1].toUpperCase() };
  }

  if (single.length === 1) {
    const word = single[0].replace(/[^\w?]/g, '');

    if (HELP_WORDS.has(word)) {
      return { kind: 'help' };
    }

    if (BALANCE_WORDS.has(word)) {
      return { kind: 'balance' };
    }

    if (UNDO_WORDS.has(word)) {
      return { kind: 'undo' };
    }

    if (LIST_WORDS.has(word)) {
      return { kind: 'list' };
    }
  }

  /*
   * A leading "+" means money in. It is stripped before the amount is matched,
   * because the amount pattern would otherwise not recognise "+5000".
   */
  const plusMarked = /^\+\s*/.test(text);
  const body = plusMarked ? text.replace(/^\+\s*/, '') : text;

  const firstWord = normalise(tokenise(body)[0] ?? '');
  const incoming = plusMarked || INCOME_WORDS.has(firstWord);

  const amountMatch = body.match(AMOUNT_PATTERN);

  if (!amountMatch) {
    return { kind: 'unknown' };
  }

  const amount = Number(amountMatch[1].replace(/,/g, ''));

  if (!Number.isFinite(amount) || amount <= 0) {
    return { kind: 'unknown' };
  }

  // Remove the amount (and any currency marker in front of it) from the text.
  const withoutAmount =
    body.slice(0, amountMatch.index) + ' ' + body.slice(amountMatch.index + amountMatch[0].length);

  const accountMatch = matchAccount(withoutAmount, accounts);

  // Drop the words that named the account so they do not land in the
  // description. Matching is on the normalised form, so compare that way.
  let words = tokenise(withoutAmount);

  if (accountMatch) {
    const consumed = accountMatch.matchedTokens.map(normalise);
    let cursor = 0;

    words = words.filter(word => {
      if (cursor < consumed.length && normalise(word) === consumed[cursor]) {
        cursor += 1;
        return false;
      }
      return true;
    });
  }

  return {
    kind: incoming ? 'income' : 'expense',
    amount: Math.round(amount * 100) / 100,
    description: cleanDescription(words) || (incoming ? 'Money in' : 'Expense'),
    account: accountMatch?.account ?? null,
    ambiguousAccounts: accountMatch?.ambiguous ?? null
  };
}

export const HELP_TEXT = [
  'Send an expense like:',
  '',
  '  *250 coffee*',
  '  *1200 groceries hdfc*',
  '  *80 chai cash*',
  '',
  'Add the account name (paytm, hdfc, cash…) to spend from it and update that balance.',
  '',
  'Money coming in starts with a *+*:',
  '',
  '  *+50000 salary hdfc*',
  '  *+300 refund paytm*',
  '',
  'Other commands:',
  '  *balance* — show your accounts',
  '  *today* — today’s expenses',
  '  *undo* — remove the last one you sent'
].join('\n');
