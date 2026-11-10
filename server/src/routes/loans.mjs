import { Router } from 'express';
import { requireAuth } from '../auth.mjs';
import { asyncRoute, badRequest, notFound, parseDate, parseText, todayInIndia } from '../http.mjs';
import { effectivePermissions } from '../settings-store.mjs';
import { isUuid } from '../transfers.mjs';
import { interestLabel, loanStatus, readLoan, readRepayment, standing } from '../loans.mjs';
import {
  addRepayment,
  cancelLoan,
  createLoan,
  findLoan,
  listLoans,
  quoteLoan,
  reverseRepayment,
  updateLoan
} from '../loan-store.mjs';

/**
 * Lending and borrowing. Principal moves an account but is never income or an
 * expense; only interest is, and that is filed as an ordinary entry.
 *
 * Seeing these needs what seeing balances needs (they name accounts and show
 * money moving in and out of them); changing them needs what changing a
 * balance needs, as transfers do.
 */
export const loansRouter = Router();

loansRouter.use(requireAuth);

const rupees = paise => paise / 100;
const via = req => (req.session.loginType === 'admin' ? 'admin' : 'user');

function repaymentToApi(r, loan) {
  return {
    id: r.id,
    loanId: r.loan_id,
    direction: loan?.direction ?? null,
    personName: loan?.person_name ?? null,
    amount: rupees(r.amount_paise),
    principal: rupees(r.principal_paise),
    interest: rupees(r.interest_paise),
    date: r.paid_on,
    accountId: r.account_id,
    accountType: r.account_type,
    accountName: r.account_name,
    note: r.note,
    reversed: Boolean(r.reversed_at),
    reversedAt: r.reversed_at,
    reversedReason: r.reversed_reason,
    createdAt: r.created_at
  };
}

/**
 * A record with every figure worked out as of `today`: what has come back,
 * what is still owed, interest built up and paid, and its status.
 */
export function loanToApi(loan, allRepayments, today) {
  const active = allRepayments.filter(r => !r.reversed_at);
  const cancelled = loan.status === 'cancelled';
  const now = cancelled ? null : standing(loan, active, today);
  const zero = { principalOutstanding: 0, principalRepaid: 0, interestAccrued: 0, interestPaid: 0, interestOutstanding: 0, outstanding: 0 };
  const f = now ?? zero;

  // What would be owed on the expected date if nothing more were paid.
  const atDue = !cancelled && loan.due_date && loan.interest_type === 'simple' && loan.due_date > today
    ? standing(loan, active, loan.due_date)
    : null;

  return {
    id: loan.id,
    direction: loan.direction,
    personName: loan.person_name,
    contact: loan.contact,
    principal: rupees(loan.principal_paise),
    date: loan.start_date,
    dueDate: loan.due_date,
    accountId: loan.account_id,
    accountType: loan.account_type,
    accountName: loan.account_name,
    interest: {
      type: loan.interest_type,
      rate: loan.interest_rate_bp === null ? null : loan.interest_rate_bp / 100,
      period: loan.interest_period,
      label: interestLabel(loan)
    },
    notes: loan.notes,
    status: loanStatus(loan, f, active.length, today),
    cancelledAt: loan.cancelled_at,
    cancelReason: loan.cancel_reason,
    principalRepaid: rupees(f.principalRepaid),
    interestAccrued: rupees(f.interestAccrued),
    interestPaid: rupees(f.interestPaid),
    totalRepaid: rupees(f.principalRepaid + f.interestPaid),
    principalOutstanding: rupees(f.principalOutstanding),
    interestOutstanding: rupees(f.interestOutstanding),
    outstanding: rupees(f.outstanding),
    outstandingAtDue: atDue ? rupees(atDue.outstanding) : null,
    repaymentCount: active.length,
    lastPaidOn: active.at(-1)?.paid_on ?? null,
    // The amount, date and interest can change only until money comes back.
    termsEditable: !cancelled && active.length === 0,
    createdAt: loan.created_at
  };
}

/** The cards at the top: totals over every record that is not cancelled. */
export function summarise(loans) {
  const live = loans.filter(l => l.status !== 'cancelled');
  const sum = (direction, key) => live
    .filter(l => l.direction === direction)
    .reduce((total, l) => total + Math.round(l[key] * 100), 0) / 100;

  return {
    totalLent: sum('lent', 'principal'),
    totalBorrowed: sum('borrowed', 'principal'),
    toReceive: sum('lent', 'outstanding'),
    toPay: sum('borrowed', 'outstanding'),
    interestReceived: sum('lent', 'interestPaid'),
    interestPaid: sum('borrowed', 'interestPaid'),
    interestExpected: sum('lent', 'interestOutstanding'),
    interestOwed: sum('borrowed', 'interestOutstanding'),
    overdue: live.filter(l => l.status === 'overdue').length,
    open: live.filter(l => l.status !== 'completed').length
  };
}

async function requireView(req, res) {
  const permissions = await effectivePermissions(req.session);

  if (!permissions.canSeeBalances) {
    res.status(403).json({ error: 'Sign in with your full-access password to see lending and borrowing.' });
    return null;
  }

  return permissions;
}

async function requireManage(req, res) {
  const permissions = await effectivePermissions(req.session);

  if (!permissions.canManageBalances) {
    res.status(403).json({ error: 'Sign in with your full-access password to record lending and borrowing.' });
    return null;
  }

  return permissions;
}

function readId(value, res, what = 'record') {
  if (!isUuid(value)) {
    badRequest(res, `That ${what} could not be found.`);
    return null;
  }

  return value;
}

function sendError(res, error) {
  if (error.status) {
    return res.status(error.status).json({ error: error.message });
  }

  throw error;
}

/** Every record with its figures, the repayment history and the totals. */
loansRouter.get('/', asyncRoute(async (req, res) => {
  const permissions = await requireView(req, res);
  if (!permissions) return;

  const today = todayInIndia();
  const { loans, repayments } = await listLoans(req.session.userId);
  const byLoan = new Map(loans.map(l => [l.id, []]));

  for (const r of repayments) {
    byLoan.get(r.loan_id)?.push(r);
  }

  const views = loans.map(l => loanToApi(l, byLoan.get(l.id), today));
  const loanById = new Map(loans.map(l => [l.id, l]));

  res.json({
    today,
    canManage: permissions.canManageBalances,
    canBackdate: permissions.canBackdate,
    loans: views,
    // Newest first, reversed ones included and marked.
    repayments: repayments
      .slice()
      .reverse()
      .map(r => repaymentToApi(r, loanById.get(r.loan_id))),
    summary: summarise(views)
  });
}));

/** Records money given or received, moving the chosen account. */
loansRouter.post('/', asyncRoute(async (req, res) => {
  const permissions = await requireManage(req, res);
  if (!permissions) return;

  const today = todayInIndia();
  const read = readLoan(req.body, { today, canBackdate: permissions.canBackdate, creating: true });

  if (read.error) {
    return res.status(read.status ?? 400).json({ error: read.error });
  }

  try {
    const result = await createLoan(req.session.userId, read.value);

    res.status(result.duplicate ? 200 : 201).json({
      loan: loanToApi(result.loan, [], today),
      balanceAfter: result.balanceAfter,
      duplicate: result.duplicate
    });
  } catch (error) {
    sendError(res, error);
  }
}));

/** What is owed on a date: interest due first, then principal. For the repayment form. */
loansRouter.get('/:id/quote', asyncRoute(async (req, res) => {
  if (!await requireView(req, res)) return;

  const id = readId(req.params.id, res);
  if (!id) return;

  const today = todayInIndia();
  const date = req.query.date ? parseDate(req.query.date) : today;

  if (!date || date > today) {
    return badRequest(res, 'Choose a date that is today or earlier.');
  }

  const quote = await quoteLoan(req.session.userId, id, date);

  if (!quote) {
    return notFound(res, 'That record was not found.');
  }

  res.json({
    date,
    principalDue: rupees(quote.due.principalOutstanding),
    interestDue: rupees(quote.due.interestOutstanding),
    totalDue: rupees(quote.due.outstanding),
    lastPaidOn: quote.lastPaidOn
  });
}));

/** Changes a record; see updateLoan for what may change when. */
loansRouter.put('/:id', asyncRoute(async (req, res) => {
  const permissions = await requireManage(req, res);
  if (!permissions) return;

  const id = readId(req.params.id, res);
  if (!id) return;

  const found = await findLoan(req.session.userId, id);

  if (!found) {
    return notFound(res, 'That record was not found.');
  }

  const today = todayInIndia();
  const read = readLoan(req.body, {
    today,
    canBackdate: permissions.canBackdate,
    creating: false,
    currentDate: found.loan.start_date
  });

  if (read.error) {
    return res.status(read.status ?? 400).json({ error: read.error });
  }

  try {
    const result = await updateLoan(req.session.userId, id, read.value);
    const after = await findLoan(req.session.userId, id);

    res.json({ loan: loanToApi(result.loan, after?.repayments ?? [], today), balanceAfter: result.balanceAfter });
  } catch (error) {
    sendError(res, error);
  }
}));

/** Records a repayment, into or out of the account chosen for it. */
loansRouter.post('/:id/repayments', asyncRoute(async (req, res) => {
  const permissions = await requireManage(req, res);
  if (!permissions) return;

  const id = readId(req.params.id, res);
  if (!id) return;

  const today = todayInIndia();
  const read = readRepayment(req.body, { today, canBackdate: permissions.canBackdate });

  if (read.error) {
    return res.status(read.status ?? 400).json({ error: read.error });
  }

  try {
    const result = await addRepayment(req.session.userId, id, read.value, { canBackdate: permissions.canBackdate });
    const after = await findLoan(req.session.userId, id);

    res.status(result.duplicate ? 200 : 201).json({
      repayment: repaymentToApi(result.repayment, after?.loan),
      loan: after ? loanToApi(after.loan, after.repayments, today) : null,
      balanceAfter: result.balanceAfter,
      duplicate: result.duplicate
    });
  } catch (error) {
    sendError(res, error);
  }
}));

/** Reverses the latest repayment, putting its money back. */
loansRouter.post('/:id/repayments/:repaymentId/reverse', asyncRoute(async (req, res) => {
  if (!await requireManage(req, res)) return;

  const id = readId(req.params.id, res);
  if (!id) return;
  const repaymentId = readId(req.params.repaymentId, res, 'repayment');
  if (!repaymentId) return;

  try {
    const result = await reverseRepayment(req.session.userId, id, repaymentId, { via: via(req) });
    const after = await findLoan(req.session.userId, id);

    res.json({
      repayment: repaymentToApi(result.repayment, after?.loan),
      loan: after ? loanToApi(after.loan, after.repayments, todayInIndia()) : null,
      balanceAfter: result.balanceAfter
    });
  } catch (error) {
    sendError(res, error);
  }
}));

/**
 * Cancels a record, reversing every balance change it made. The page asks
 * first; `confirm: true` is required so nothing cancels by accident.
 */
loansRouter.post('/:id/cancel', asyncRoute(async (req, res) => {
  if (!await requireManage(req, res)) return;

  const id = readId(req.params.id, res);
  if (!id) return;

  if (req.body?.confirm !== true) {
    return badRequest(res, 'Confirm the cancellation first.');
  }

  const reason = parseText(req.body?.reason, { field: 'Reason', max: 200, required: false });

  if (reason.error) {
    return badRequest(res, reason.error);
  }

  try {
    const result = await cancelLoan(req.session.userId, id, { via: via(req), reason: reason.value || null });

    res.json({
      loan: loanToApi(result.loan, [], todayInIndia()),
      reversedRepayments: result.reversed,
      balances: result.balances
    });
  } catch (error) {
    sendError(res, error);
  }
}));
