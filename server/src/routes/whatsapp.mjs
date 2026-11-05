import { Router } from 'express';
import { query, transaction } from '../db.mjs';
import { AMOUNT_MAX, asyncRoute, todayInIndia } from '../http.mjs';
import { countAttempt } from '../rate-limit.mjs';
import { effectivePermissions } from '../settings-store.mjs';
import { removeExpense } from '../expense-store.mjs';
import { addIncome, removeIncome } from '../income-store.mjs';
import { afterResponse } from '../after-response.mjs';
import { HELP_TEXT, parseMessage } from '../whatsapp/parser.mjs';
import { guessCategory, guessIncomeCategory } from '../categories.mjs';
import { matchSplit, splitAmount } from '../split.mjs';
import { listOpenSplits, listSplits } from '../split-store.mjs';
import {
  WHATSAPP_VERIFY_TOKEN,
  extractTextMessages,
  isStale,
  messageAgeMs,
  normaliseNumber,
  sendText,
  verifySignature
} from '../whatsapp/client.mjs';

export const whatsappRouter = Router();

const money = (value) => `₹${Number(value).toLocaleString('en-IN')}`;

/** Meta's one-time subscription handshake. */
whatsappRouter.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && WHATSAPP_VERIFY_TOKEN && token === WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(String(challenge ?? ''));
  }

  res.sendStatus(403);
});

whatsappRouter.post('/webhook', asyncRoute(async (req, res) => {
  const signature = verifySignature(req.rawBody, req.get('x-hub-signature-256'));

  if (!signature.ok) {
    console.warn(`[whatsapp] rejected webhook: ${signature.reason}`);
    return res.sendStatus(403);
  }

  // Acknowledge immediately. Meta retries on any non-2xx, and the work below
  // can outlast its timeout; duplicates are kept out by message id instead.
  res.sendStatus(200);

  /*
   * Meta can batch several messages into one delivery. Taking only the first
   * dropped the rest without a word. They are handled one after another, in
   * the order sent, so "250 coffee" then "undo" still means what it says.
   */
  const fresh = extractTextMessages(req.body).filter(message => {
    /*
     * Meta retries a webhook it could not deliver for days afterwards, and a
     * replayed message carries a new id, so the processed-message table cannot
     * tell it apart from something just sent. Acting on it books a spend the
     * owner made long ago and has usually already recorded by hand.
     */
    if (isStale(message)) {
      console.warn(
        `[whatsapp] ignored a message sent ${Math.round(messageAgeMs(message) / 60_000)} ` +
        `minutes ago (${message.messageId})`
      );
      return false;
    }

    // Logged on every message, so that if one is ever acted on late there is
    // a number in the record rather than a guess.
    console.info(
      `[whatsapp] handling ${message.messageId}, sent ` +
      `${Math.round((messageAgeMs(message) ?? 0) / 1000)}s ago`
    );

    return true;
  });

  if (fresh.length === 0) {
    return;
  }

  /*
   * Not a bare await: once the response is flushed, a serverless instance may
   * be frozen or discarded, and the work would be cut off half-finished. This
   * hands the promise to the platform so the instance is kept until it ends.
   */
  afterResponse(
    fresh.reduce((previous, message) => previous.then(() => handleMessage(message)), Promise.resolve())
  );
}));

/**
 * How many messages an unconnected number gets an answer to, per hour.
 *
 * Every reply is a message Meta bills for past the free thousand a month, and a
 * number that is not connected can be anybody. A few answers are enough to tell
 * a real person how to connect; past that, silence. Link attempts are counted
 * the same way, so the six-character code cannot be guessed at speed.
 */
const UNKNOWN_REPLIES_PER_HOUR = 5;

async function overUnknownLimit(from) {
  try {
    const { count } = await countAttempt(`whatsapp-unknown|${from}`, 60 * 60_000);
    return count > UNKNOWN_REPLIES_PER_HOUR;
  } catch (error) {
    // The counter is housekeeping; a database blip should not silence a reply.
    console.warn('[whatsapp] could not count an unknown sender:', error.message);
    return false;
  }
}

/**
 * The processed-message table only exists to recognise a retry, and Meta
 * retries within minutes. A row older than a day cannot match anything, so it
 * is dropped — otherwise the table grows for the life of the deployment.
 *
 * Done here, occasionally, rather than on a schedule: there is no scheduler in
 * this app, and the webhook is the only thing that writes to the table.
 */
async function pruneProcessedMessages() {
  if (Math.random() > 0.02) {
    return;
  }

  try {
    await query(
      "delete from whatsapp_processed_messages where processed_at < now() - interval '1 day'"
    );
  } catch (error) {
    // Housekeeping; never worth failing a message over.
    console.warn('[whatsapp] could not prune processed messages:', error.message);
  }
}

export async function handleMessage(message) {
  // A retry carries the same id, so claim it once and ignore repeats.
  const claim = await query(
    `insert into whatsapp_processed_messages (message_id) values ($1)
     on conflict (message_id) do nothing`,
    [message.messageId]
  );

  if (claim.rowCount === 0) {
    return;
  }

  await pruneProcessedMessages();

  const from = normaliseNumber(message.from);

  const { rows: userRows } = await query(
    'select id, name from users where whatsapp_number = $1',
    [from]
  );

  const user = userRows[0];
  const intent = parseMessage(message.text);

  // Linking is the only thing an unknown number may do.
  if (intent.kind === 'link') {
    if (await overUnknownLimit(from)) {
      return;
    }

    return linkNumber(from, intent.code);
  }

  if (!user) {
    if (await overUnknownLimit(from)) {
      return;
    }

    return sendText(
      from,
      'This number is not connected to an Expense Tracker account yet.\n\n' +
      'Sign in on the website, open Settings → Connect WhatsApp, and send me the ' +
      'code it shows you.'
    );
  }

  const accounts = await loadAccounts(user.id);
  const parsed = parseMessage(message.text, accounts);

  switch (parsed.kind) {
    case 'help':
      return sendText(from, `Hi ${user.name.split(' ')[0]} 👋\n\n${HELP_TEXT}`);

    case 'balance':
      return sendBalances(from, user, accounts);

    case 'list':
      return sendToday(from, user.id);

    case 'splits':
      return sendSplits(from, user.id);

    case 'undo':
      return undoLast(from, user.id);

    case 'expense':
      return addExpense(from, user, parsed, accounts);

    case 'income':
      return addMoneyIn(from, user, parsed);

    default:
      return sendText(
        from,
        `Sorry, I didn't understand that.\n\n${HELP_TEXT}`
      );
  }
}

function loadAccounts(userId) {
  return query(
    `select id, type, category, balance from balances
      where user_id = $1 and saved = true order by created_at`,
    [userId]
  ).then(result => result.rows);
}

async function linkNumber(from, code) {
  /*
   * One transaction: claiming the code, moving the number off any account it
   * was on before, and attaching it here all happen or none do. Separately, a
   * failure part-way left a code spent and the number attached to nobody.
   */
  const linked = await transaction(async client => {
    const { rows } = await client.query(
      `delete from whatsapp_link_codes
        where code = $1 and expires_at > now()
        returning user_id`,
      [code]
    );

    if (!rows[0]) {
      return null;
    }

    const userId = rows[0].user_id;

    // The number may have been attached to a different account before.
    await client.query(
      'update users set whatsapp_number = null where whatsapp_number = $1',
      [from]
    );

    const { rows: userRows } = await client.query(
      'update users set whatsapp_number = $1 where id = $2 returning name',
      [from, userId]
    );

    await client.query('delete from whatsapp_link_codes where user_id = $1', [userId]);

    return { name: userRows[0]?.name ?? null };
  });

  if (!linked) {
    return sendText(
      from,
      'That code is not valid or has expired. Open Settings → Connect WhatsApp ' +
      'on the website for a fresh one.'
    );
  }

  return sendText(
    from,
    `Connected to ${linked.name ?? 'your account'} ✅\n\n${HELP_TEXT}`
  );
}

async function sendBalances(from, user, accounts) {
  const { canSeeBalancesOnWhatsapp } = await effectivePermissions({
    userId: user.id,
    loginType: 'user'
  });

  // WhatsApp is linked to the account, not to an admin session, so it answers
  // as the normal user. Without the balance permission it must not read them
  // out either, or the full-access password is bypassable from a phone.
  if (!canSeeBalancesOnWhatsapp) {
    return sendText(
      from,
      'Balances are not shown over WhatsApp for this account. Check them on the ' +
      'website instead.'
    );
  }

  if (accounts.length === 0) {
    return sendText(
      from,
      'You have no saved balance accounts yet. Add them under Balance Management on the website.'
    );
  }

  const lines = accounts.map(
    account => `• ${account.type} – ${account.category}: ${money(account.balance)}`
  );

  const total = accounts.reduce((sum, account) => sum + Number(account.balance), 0);

  return sendText(from, `*Your balances*\n${lines.join('\n')}\n\nTotal: ${money(total)}`);
}

async function sendToday(from, userId) {
  // Today in India, not by the database's UTC clock, which runs five and a
  // half hours behind and showed yesterday's entries until 5:30am.
  const { rows } = await query(
    `select amount, description, status, split_members, personal_share from expenses
      where user_id = $1 and spent_on = $2
      order by created_at`,
    [userId, todayInIndia()]
  );

  if (rows.length === 0) {
    return sendText(from, 'Nothing recorded today.');
  }

  const lines = rows.map(row => {
    const split = row.split_members
      ? ` (split ${row.split_members}, yours ${money(row.personal_share)})`
      : '';
    const pending = row.status === 'pending' ? ' (awaiting admin)' : '';

    return `• ${money(row.amount)} — ${row.description}${split}${pending}`;
  });

  // The owner's own spending: of a split expense, only their share.
  const total = rows
    .filter(row => row.status === 'done')
    .reduce((sum, row) => sum + Number(row.personal_share ?? row.amount), 0);

  return sendText(from, `*Today*\n${lines.join('\n')}\n\nTotal: ${money(total)}`);
}

/** Removes the most recent WhatsApp-added entry, refunding it if it was debited. */
/**
 * Undoes the last thing sent from this phone, expense or money in.
 *
 * Both tables are checked and whichever entry was created later wins, so
 * "undo" means the same thing it looks like it means however the two are
 * interleaved.
 */
async function undoLast(from, userId) {
  /*
   * The same switch as the website's Remove button. Without it, a phone could
   * delete what the website refuses to, one "undo" at a time, back through
   * every entry ever sent from it.
   */
  const { canRemove } = await effectivePermissions({ userId, loginType: 'user' });

  if (!canRemove) {
    return sendText(
      from,
      'Removing entries is switched off for this account, so nothing was undone. ' +
      'Sign in on the website with your full-access password to remove it.'
    );
  }

  try {
    const [lastExpense, lastIncome] = await Promise.all([
      query(
        `select created_at from expenses
          where user_id = $1 and source_channel = 'whatsapp'
          order by created_at desc limit 1`,
        [userId]
      ),
      query(
        `select created_at from incomes
          where user_id = $1 and source_channel = 'whatsapp'
          order by created_at desc limit 1`,
        [userId]
      )
    ]);

    const expenseAt = lastExpense.rows[0]?.created_at ?? null;
    const incomeAt = lastIncome.rows[0]?.created_at ?? null;

    if (incomeAt && (!expenseAt || new Date(incomeAt) > new Date(expenseAt))) {
      return undoIncome(from, userId);
    }

    const removed = await removeExpense(userId, { lastFromChannel: 'whatsapp' });

    if (!removed) {
      return sendText(from, 'Nothing to undo — you have not added anything here yet.');
    }

    const { canSeeBalancesOnWhatsapp } = await effectivePermissions({
      userId,
      loginType: 'user'
    });

    let tail = '';

    if (removed.refunded) {
      tail = canSeeBalancesOnWhatsapp
        ? `
${removed.source_category} now ${money(removed.balanceAfter)}.`
        : `
Put back into ${removed.source_category}.`;
    }

    if (removed.detachedRepayments > 0) {
      tail +=
        `\n${removed.detachedRepayments} repayment(s) made against it stay, ` +
        'as ordinary money in.';
    }

    return sendText(from, `Removed ${money(removed.amount)} — ${removed.description}${tail}`);
  } catch (error) {
    console.error('[whatsapp] undo failed', error);
    return sendText(from, 'Could not undo that, sorry. Try the website.');
  }
}

/**
 * The same ceiling the website applies. Past it, the numeric column would
 * overflow and the person would only hear "could not save that".
 */
function amountTooLarge(from, parsed) {
  return sendText(
    from,
    `${money(parsed.amount)} is more than one entry can hold — the most is ` +
    `${money(AMOUNT_MAX)}.\n\nNothing was recorded.`
  );
}

async function addExpense(from, user, parsed, accounts) {
  if (parsed.amount > AMOUNT_MAX) {
    return amountTooLarge(from, parsed);
  }

  if (parsed.splitInvalid) {
    return sendText(
      from,
      'Split it between 2 and 50 people, counting yourself, like ' +
      `*${parsed.amount} ${parsed.description} split 4*.\n\nNothing was recorded.`
    );
  }

  const split = parsed.splitMembers ? splitAmount(parsed.amount, parsed.splitMembers) : null;

  // A name shared by several accounts ("bank" with two banks) must not be
  // guessed at — the wrong one would silently debit the wrong balance.
  if (parsed.ambiguousAccounts?.length) {
    const options = parsed.ambiguousAccounts
      .map(account => `• ${account.category}`)
      .join('\n');

    return sendText(
      from,
      `Which account did you mean?\n${options}\n\n` +
      `Send it again with the full name, e.g. *${parsed.amount} ${parsed.description} ` +
      `${parsed.ambiguousAccounts[0].category}*`
    );
  }

  const permissions = await effectivePermissions({ userId: user.id, loginType: 'user' });

  // Naming an account means "spend from it", which needs the same permission
  // the web form requires.
  const wantsDebit = Boolean(parsed.account) && permissions.canUpdateBalance;

  try {
    const result = await transaction(async client => {
      let source = null;

      if (parsed.account) {
        const { rows } = await client.query(
          `select id, type, category, balance from balances
            where id = $1 and user_id = $2 and saved = true
            for update`,
          [parsed.account.id, user.id]
        );

        source = rows[0] ?? null;
      }

      if (wantsDebit && source && Number(source.balance) < parsed.amount) {
        return { insufficient: true, source };
      }

      const debit = wantsDebit && Boolean(source);
      let remaining = null;

      if (debit) {
        // RETURNING gives the balance the database actually holds afterwards.
        // Subtracting in JavaScript from the value read at SELECT time would
        // report a stale figure whenever two messages are handled together.
        const debited = await client.query(
          `update balances set balance = balance - $1
            where id = $2
            returning balance`,
          [parsed.amount, source.id]
        );

        remaining = debited.rows[0]?.balance ?? null;
      }

      const { rows } = await client.query(
        `insert into expenses (
           user_id, amount, description, spent_on, category,
           source_id, source_type, source_category,
           expense_access, update_permission, balance_updated,
           status, remarks, source_channel,
           split_members, split_share, personal_share
         )
         values ($1,$2,$3,$15,$4,$5,$6,$7,$8,$9,$10,'done',$11,'whatsapp',$12,$13,$14)
         returning id, category`,
        [
          user.id, parsed.amount, parsed.description,
          // Nobody types a category from a phone, so it is read out of the
          // description, and left empty when the words do not give it away.
          guessCategory(parsed.description),
          source?.id ?? null, source?.type ?? null, source?.category ?? null,
          wantsDebit, permissions.canBackdate, debit,
          debit ? 'Added via WhatsApp and balance updated' : 'Added via WhatsApp',
          parsed.splitMembers, split?.share ?? null, split?.personal ?? null,
          // The day it is where the sender is, not in the database's UTC.
          todayInIndia()
        ]
      );

      return { id: rows[0].id, category: rows[0].category, debit, source, remaining };
    });

    if (result.insufficient) {
      return sendText(
        from,
        permissions.canSeeBalancesOnWhatsapp
          ? `Not enough in ${result.source.category} — it has ${money(result.source.balance)}, ` +
            `and that expense is ${money(parsed.amount)}.

Nothing was recorded.`
          : `Not enough in ${result.source.category} for ${money(parsed.amount)}.` +
            `

Nothing was recorded.`
      );
    }

    const where = result.source ? ` · ${result.source.category}` : '';
    const filedAs = result.category ? ` · ${result.category}` : '';

    const splitLine = split
      ? `\nSplit ${parsed.splitMembers} ways: your share ${money(split.personal)}, ` +
        `${money(split.share)} each from the other ${parsed.splitMembers - 1}.`
      : '';

    // Naming the account is fine; quoting what is left in it is a balance.
    const after =
      result.debit && permissions.canSeeBalancesOnWhatsapp
        ? `
${result.source.category} now ${money(result.remaining)}`
        : '';

    return sendText(
      from,
      `✅ ${money(parsed.amount)} · ${parsed.description}${where}${filedAs}${splitLine}${after}\n\nSend *undo* to remove it.`
    );
  } catch (error) {
    console.error('[whatsapp] add expense failed', error);
    return sendText(from, 'Could not save that, sorry. Please try again.');
  }
}

/**
 * Money coming in, from a message starting with "+" or an income verb.
 *
 * Unlike an expense it always needs an account: recording that money arrived
 * without saying where it went would leave the balances wrong, which is the
 * problem this feature exists to fix.
 */
async function addMoneyIn(from, user, parsed) {
  if (parsed.amount > AMOUNT_MAX) {
    return amountTooLarge(from, parsed);
  }

  if (parsed.ambiguousAccounts?.length) {
    const options = parsed.ambiguousAccounts
      .map(account => `• ${account.category}`)
      .join('\n');

    return sendText(
      from,
      `Which account did it go into?\n\n${options}\n\nSend it again with the fuller name.`
    );
  }

  if (!parsed.account) {
    return sendText(
      from,
      'Name the account the money went into, like *+50000 salary hdfc*, so the ' +
      'balance can be updated.'
    );
  }

  const permissions = await effectivePermissions({ userId: user.id, loginType: 'user' });

  /*
   * The same switch that hides the Add Money page. A phone is another way into
   * the same action, so leaving it open here would make the setting mean "hide
   * the page" rather than "may not add money" — and the website already refuses
   * the equivalent request with a 403.
   */
  if (!permissions.canAddMoney) {
    return sendText(
      from,
      'Adding money is switched off for this account. Sign in on the website ' +
      'with your full-access password to turn it back on.'
    );
  }

  if (!permissions.canUpdateBalance) {
    return sendText(
      from,
      'This account may not change balances. Sign in on the website with your ' +
      'full-access password.'
    );
  }

  /*
   * "share" marks someone paying back their part of a split expense. Which one
   * is read from the rest of the words. When that is unclear it asks rather
   * than guesses: a repayment filed against the wrong split leaves two splits
   * wrong, where asking costs one more message.
   */
  let splitExpenseId = null;
  let noSplitNote = '';

  if (parsed.repayment) {
    const match = matchSplit(parsed.description, await listOpenSplits(user.id));

    if (match.ambiguous) {
      const options = match.ambiguous
        .slice(0, 5)
        .map(split => `• ${split.description} — ${money(split.remaining)} still to come`)
        .join('\n');

      const example = String(match.ambiguous[0].description).split(/\s+/).pop().toLowerCase();
      const account = String(parsed.account.category).split(/\s+/)[0].toLowerCase();

      return sendText(
        from,
        `Which split is this for?\n\n${options}\n\n` +
        `Send it again with a word from its name, like *+${parsed.amount} ${example} share ${account}*.` +
        '\n\nNothing was recorded.'
      );
    }

    if (match.split) {
      splitExpenseId = match.split.id;
    } else {
      // Nothing is owed on any split, so "share" can only be part of the name.
      noSplitNote = '\nNo split is waiting to be paid back, so this is ordinary money in.';
    }
  }

  try {
    const created = await addIncome(user.id, {
      amount: parsed.amount,
      description: parsed.description,
      // The day it is where the sender is; toISOString() gave the UTC date.
      receivedOn: todayInIndia(),
      // Nobody types a category from a phone, so it is read out of the words.
      category: guessIncomeCategory(parsed.description),
      targetId: parsed.account.id,
      splitExpenseId,
      channel: 'whatsapp'
    });

    const filedAs = created.category ? ` · ${created.category}` : '';

    const towards = created.split
      ? `\nTowards ${created.split.description}: ` +
        (created.split.remaining > 0
          ? `${money(created.split.received)} of ${money(created.split.owed)} back, ` +
            `${money(created.split.remaining)} still to come.`
          : `all ${money(created.split.owed)} back ✅`)
      : noSplitNote;

    // Naming the account is fine; quoting what is in it is a balance.
    const after = permissions.canSeeBalancesOnWhatsapp
      ? `\n${parsed.account.category} now ${money(created.balanceAfter)}`
      : '';

    return sendText(
      from,
      `➕ ${money(parsed.amount)} into ${parsed.account.category} · ` +
      `${parsed.description}${filedAs}${towards}${after}\n\nSend *undo* to remove it.`
    );
  } catch (error) {
    // The store's own refusals — already fully paid back, more than is owed —
    // are written for the person, so they go out as they are.
    if (error.status) {
      return sendText(
        from,
        `${error.message}\n\nNothing was recorded. Not paying back a split? ` +
        'Send it again without the word *share*.'
      );
    }

    console.error('[whatsapp] add money failed', error);
    return sendText(from, 'Could not save that, sorry. Please try again.');
  }
}

/** What people still owe, split by split. */
async function sendSplits(from, userId) {
  const splits = await listSplits(userId);
  const open = splits.filter(split => split.remaining > 0);

  if (open.length === 0) {
    return sendText(
      from,
      splits.length === 0
        ? 'Nothing has been split yet. Add *split* and how many people to an ' +
          'expense, like *1455 vegetables hdfc split 4*.'
        : 'Everyone has paid you back ✅'
    );
  }

  const lines = open.slice(0, 10).map(split =>
    `• *${split.description}* — ${money(split.amount)} ÷ ${split.members}\n` +
    `  ${money(split.share)} each · ${money(split.received)} of ${money(split.owed)} back · ` +
    `*${money(split.remaining)}* to come`
  );

  const total = open.reduce((sum, split) => sum + split.remaining, 0);

  return sendText(
    from,
    `*Still owed to you*\n${lines.join('\n')}\n\nTotal: ${money(total)}\n\n` +
    `When someone pays, send *+${money(open[0].share).slice(1)} ` +
    `${String(open[0].description).split(/\s+/).pop().toLowerCase()} share* and the account.`
  );
}

/** The money-in half of "undo". */
async function undoIncome(from, userId) {
  const removed = await removeIncome(userId, { lastFromChannel: 'whatsapp' });

  if (!removed) {
    return sendText(from, 'Nothing to undo — you have not added anything here yet.');
  }

  if (removed.shortfall) {
    return sendText(
      from,
      `${removed.target_category} no longer holds that much, so it cannot be ` +
      'taken back. Remove what it was spent on first.'
    );
  }

  const { canSeeBalancesOnWhatsapp } = await effectivePermissions({
    userId,
    loginType: 'user'
  });

  let tail = '';

  if (removed.reversed) {
    tail = canSeeBalancesOnWhatsapp
      ? `\n${removed.target_category} now ${money(removed.balanceAfter)}.`
      : `\nTaken back out of ${removed.target_category}.`;
  }

  return sendText(
    from,
    `Removed ${money(removed.amount)} in — ${removed.description}${tail}`
  );
}
