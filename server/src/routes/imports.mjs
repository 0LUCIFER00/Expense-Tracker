import express, { Router } from 'express';
import { requireAuth } from '../auth.mjs';
import { query } from '../db.mjs';
import { asyncRoute, badRequest, callerToday } from '../http.mjs';
import { effectivePermissions } from '../settings-store.mjs';
import { checkBudgetAlertsSafely } from '../budget-store.mjs';
import { isUuid } from '../transfers.mjs';
import {
  CATEGORY_LISTS,
  COMMIT_CHUNK_MAX,
  IMPORT_MAX_ROWS,
  previewRows,
  readRawRow,
  rowForApi,
  summarise
} from '../import.mjs';
import { importChunk, loadAccounts, loadExisting, previousImports } from '../import-store.mjs';

export const importsRouter = Router();

/*
 * A preview carries the whole file's cells: up to 2,000 rows, each a few
 * hundred bytes. The rest of the API keeps its 100kb cap; app.mjs leaves this
 * path to the parser here.
 */
importsRouter.use(express.json({ limit: '2mb' }));
importsRouter.use(requireAuth);

const KINDS = new Set(['expense', 'income', 'sign']);
const FILE_TYPES = new Set(['csv', 'xlsx']);

/** The parts of a request every import call shares, or { error }. */
function readRequest(body, maxRows) {
  const rows = body?.rows;

  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: 'There are no rows to check.' };
  }

  if (rows.length > maxRows) {
    return { error: `Send at most ${maxRows.toLocaleString('en-IN')} rows at a time.` };
  }

  const raw = rows.map(readRawRow);
  const numbers = new Set();

  for (const row of raw) {
    if (!Number.isInteger(row.row) || row.row < 1 || row.row > 1_000_000 || numbers.has(row.row)) {
      return { error: 'Every row needs its own row number.' };
    }

    numbers.add(row.row);
  }

  const defaultKind = KINDS.has(body?.defaultKind) ? body.defaultKind : 'expense';

  return {
    raw,
    defaultKind,
    updateBalances: body?.updateBalances !== false,
    today: callerToday(body?.tzOffset)
  };
}

/** The file's name without any folder, or null. */
function readFileName(value) {
  const name = String(value ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();

  return name && name.length <= 200 ? name : null;
}

/**
 * Checks a file's rows without importing anything: what each row means, which
 * are duplicates or invalid and why, and what importing them would do.
 */
importsRouter.post('/preview', asyncRoute(async (req, res) => {
  const request = readRequest(req.body, IMPORT_MAX_ROWS);

  if (request.error) {
    return badRequest(res, request.error);
  }

  const fileHash = /^[0-9a-f]{64}$/.test(req.body?.fileHash ?? '') ? req.body.fileHash : null;
  const userId = req.session.userId;
  const permissions = await effectivePermissions(req.session);
  const accounts = await loadAccounts(query, userId);
  const context = { ...request, accounts, permissions };

  // Dates are only needed to narrow the duplicate lookup, so a cheap first
  // pass finds them; the real check runs in previewRows.
  const dates = [...new Set(previewRows(request.raw, context, new Map())
    .map(row => row.date).filter(Boolean))];
  const existing = await loadExisting(query, userId, dates);
  const rows = previewRows(request.raw, context, existing);

  res.json({
    rows: rows.map(rowForApi),
    summary: summarise(rows),
    previousImports: fileHash ? await previousImports(userId, fileHash) : [],
    options: {
      expenseCategories: CATEGORY_LISTS.expense,
      incomeCategories: CATEGORY_LISTS.income,
      accounts: accounts.map(account => ({ id: account.id, name: account.category, type: account.type }))
    },
    canSeeBalances: permissions.canSeeBalances
  });
}));

/**
 * Imports one chunk of rows under an import the page has named. Sending the
 * same chunk again is safe: rows already imported under this id are reported
 * as imported and not added again.
 */
importsRouter.post('/:batchId/rows', asyncRoute(async (req, res) => {
  if (!isUuid(req.params.batchId)) {
    return badRequest(res, 'Malformed import id.');
  }

  const request = readRequest(req.body, COMMIT_CHUNK_MAX);

  if (request.error) {
    return badRequest(res, request.error);
  }

  const fileName = readFileName(req.body?.fileName);
  const fileHash = /^[0-9a-f]{64}$/.test(req.body?.fileHash ?? '') ? req.body.fileHash : null;
  const fileType = FILE_TYPES.has(req.body?.fileType) ? req.body.fileType : null;
  const totalRows = Number(req.body?.totalRows);

  if (!fileName || !fileHash || !fileType) {
    return badRequest(res, 'Say which file these rows came from.');
  }

  if (!Number.isInteger(totalRows) || totalRows < 1 || totalRows > IMPORT_MAX_ROWS) {
    return badRequest(res, 'The file has too many rows, or none.');
  }

  // Rows the page meant to leave out are never sent; one marked so is refused
  // rather than imported.
  if (request.raw.some(row => row.skip)) {
    return badRequest(res, 'Leave excluded rows out of the import.');
  }

  const userId = req.session.userId;
  const permissions = await effectivePermissions(req.session);

  try {
    const outcome = await importChunk(
      userId,
      { id: req.params.batchId, fileName, fileHash, fileType, totalRows },
      request.raw,
      { ...request, permissions }
    );

    // After the commit, as when adding one by hand: thresholds this month's
    // imported spending has carried a budget past.
    const budgetAlerts = outcome.touchedThisMonth
      ? await checkBudgetAlertsSafely(userId, request.today)
      : [];

    res.json({
      results: outcome.results,
      batch: outcome.batch,
      budgetAlerts: budgetAlerts.map(alert => ({
        scope: alert.scope,
        threshold: alert.threshold,
        message: alert.message
      }))
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    throw error;
  }
}));
