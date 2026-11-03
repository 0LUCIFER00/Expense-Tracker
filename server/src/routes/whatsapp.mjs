import { Router } from 'express';
import { query, transaction } from '../db.mjs';
import { asyncRoute } from '../http.mjs';
import { effectivePermissions } from '../settings-store.mjs';
import { removeExpense } from '../expense-store.mjs';
import { addIncome, removeIncome } from '../income-store.mjs';
import { HELP_TEXT, parseMessage } from '../whatsapp/parser.mjs';
import { guessCategory, guessIncomeCategory } from '../categories.mjs';
import {
  WHATSAPP_VERIFY_TOKEN,
  extractTextMessage,
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

  const message = extractTextMessage(req.body);

  if (!message) {
    return;
  }

  try {
    await handleMessage(message);
  } catch (error) {
    console.error('[whatsapp] handler failed', error);
  }
}));

async function handleMessage(message) {
  // A retry carries the same id, so claim it once and ignore repeats.
  const claim = await query(
    `insert into whatsapp_processed_messages (message_id) values ($1)
     on conflict (message_id) do nothing`,
    [message.messageId]
  );

  if (claim.rowCount === 0) {
    return;
  }

  const from = normaliseNumber(message.from);

  const { rows: userRows } = await query(
    'select id, name from users where whatsapp_number = $1',
    [from]
  );

  const user = userRows[0];
  const intent = parseMessage(message.text);

  // Linking is the only thing an unknown number may do.
  if (intent.kind === 'link') {
    return linkNumber(from, intent.code);
  }

  if (!user) {
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
  const { rows } = await query(
    `delete from whatsapp_link_codes
      where code = $1 and expires_at > now()
      returning user_id`,
    [code]
  );

  if (!rows[0]) {
    return sendText(
      from,
      'That code is not valid or has expired. Open Settings → Connect WhatsApp ' +
      'on the website for a fresh one.'
    );
  }

  const userId = rows[0].user_id;

  // The number may have been attached to a different account before.
  await query('update users set whatsapp_number = null where whatsapp_number = $1', [from]);
  await query('update users set whatsapp_number = $1 where id = $2', [from, userId]);
  await query('delete from whatsapp_link_codes where user_id = $1', [userId]);

  const { rows: userRows } = await query('select name from users where id = $1', [userId]);

  return sendText(
    from,
    `Connected to ${userRows[0]?.name ?? 'your account'} ✅\n\n${HELP_TEXT}`
  );
}

async function sendBalances(from, user, accounts) {
  const { canSeeBalances } = await effectivePermissions({
    userId: user.id,
    loginType: 'user'
  });

  // WhatsApp is linked to the account, not to an admin session, so it answers
  // as the normal user. Without the balance permission it must not read them
  // out either, or the admin password is bypassable from a phone.
  if (!canSeeBalances) {
    return sendText(
      from,
      'Balances are hidden for this account. Sign in on the website with your ' +
      'admin password to see them.'
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
  const { rows } = await query(
    `select amount, description, status from expenses
      where user_id = $1 and spent_on = current_date
      order by created_at`,
    [userId]
  );

  if (rows.length === 0) {
    return sendText(from, 'Nothing recorded today.');
  }

  const lines = rows.map(
    row => `• ${money(row.amount)} — ${row.description}${row.status === 'pending' ? ' (awaiting admin)' : ''}`
  );

  const total = rows
    .filter(row => row.status === 'done')
    .reduce((sum, row) => sum + Number(row.amount), 0);

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

    const { canSeeBalances } = await effectivePermissions({ userId, loginType: 'user' });

    let tail = '';

    if (removed.refunded) {
      tail = canSeeBalances
        ? `
${removed.source_category} now ${money(removed.balanceAfter)}.`
        : `
Put back into ${removed.source_category}.`;
    }

    return sendText(from, `Removed ${money(removed.amount)} — ${removed.description}${tail}`);
  } catch (error) {
    console.error('[whatsapp] undo failed', error);
    return sendText(from, 'Could not undo that, sorry. Try the website.');
  }
}

async function addExpense(from, user, parsed, accounts) {
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
           status, remarks, source_channel
         )
         values ($1,$2,$3,current_date,$4,$5,$6,$7,$8,$9,$10,'done',$11,'whatsapp')
         returning id, category`,
        [
          user.id, parsed.amount, parsed.description,
          // Nobody types a category from a phone, so it is read out of the
          // description, and left empty when the words do not give it away.
          guessCategory(parsed.description),
          source?.id ?? null, source?.type ?? null, source?.category ?? null,
          wantsDebit, permissions.canBackdate, debit,
          debit ? 'Added via WhatsApp and balance updated' : 'Added via WhatsApp'
        ]
      );

      return { id: rows[0].id, category: rows[0].category, debit, source, remaining };
    });

    if (result.insufficient) {
      return sendText(
        from,
        permissions.canSeeBalances
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

    // Naming the account is fine; quoting what is left in it is a balance.
    const after =
      result.debit && permissions.canSeeBalances
        ? `
${result.source.category} now ${money(result.remaining)}`
        : '';

    return sendText(
      from,
      `✅ ${money(parsed.amount)} · ${parsed.description}${where}${filedAs}${after}\n\nSend *undo* to remove it.`
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

  if (!permissions.canUpdateBalance) {
    return sendText(
      from,
      'This account may not change balances. Sign in on the website with your ' +
      'admin password.'
    );
  }

  try {
    const created = await addIncome(user.id, {
      amount: parsed.amount,
      description: parsed.description,
      receivedOn: new Date().toISOString().slice(0, 10),
      // Nobody types a category from a phone, so it is read out of the words.
      category: guessIncomeCategory(parsed.description),
      targetId: parsed.account.id,
      channel: 'whatsapp'
    });

    const filedAs = created.category ? ` · ${created.category}` : '';

    // Naming the account is fine; quoting what is in it is a balance.
    const after = permissions.canSeeBalances
      ? `\n${parsed.account.category} now ${money(created.balanceAfter)}`
      : '';

    return sendText(
      from,
      `➕ ${money(parsed.amount)} into ${parsed.account.category} · ` +
      `${parsed.description}${filedAs}${after}\n\nSend *undo* to remove it.`
    );
  } catch (error) {
    console.error('[whatsapp] add money failed', error);
    return sendText(from, 'Could not save that, sorry. Please try again.');
  }
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

  const { canSeeBalances } = await effectivePermissions({ userId, loginType: 'user' });

  let tail = '';

  if (removed.reversed) {
    tail = canSeeBalances
      ? `\n${removed.target_category} now ${money(removed.balanceAfter)}.`
      : `\nTaken back out of ${removed.target_category}.`;
  }

  return sendText(
    from,
    `Removed ${money(removed.amount)} in — ${removed.description}${tail}`
  );
}
