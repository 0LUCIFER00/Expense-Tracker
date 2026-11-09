import express, { Router } from 'express';
import { Readable } from 'node:stream';
import { requireAuth } from '../auth.mjs';
import { asyncRoute, notFound } from '../http.mjs';
import { effectivePermissions } from '../settings-store.mjs';
import { MAX_BYTES, checkUpload } from '../attachments.mjs';
import {
  addAttachment,
  deleteAttachment,
  listAttachments,
  openAttachment,
  ownsExpense
} from '../attachment-store.mjs';

/**
 * Receipts and invoices on an expense, at /api/expenses/:expenseId/attachments.
 *
 * Every request is checked against the signed-in user: the expense must be
 * theirs, and the attachment must belong to that expense and to them, so an
 * id from someone else's account finds nothing (404). Files are never given
 * out as URLs; they are streamed from private storage here.
 *
 * Attaching a receipt needs only a sign-in that can see the expense, as adding
 * an expense does; removing one needs "Remove entries", as removing an entry
 * does. None of it changes a balance, an expense, income or a budget.
 */
export const attachmentsRouter = Router({ mergeParams: true });

attachmentsRouter.use(requireAuth);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toApi(row) {
  return {
    id: row.id,
    expenseId: row.expense_id,
    fileName: row.file_name,
    contentType: row.content_type,
    size: row.size_bytes,
    createdAt: row.created_at
  };
}

/** Both ids must look like ids, or the request ends here with a 404. */
function ids(req, res) {
  const { expenseId, id } = req.params;

  if (!UUID.test(expenseId) || (id !== undefined && !UUID.test(id))) {
    notFound(res);
    return null;
  }

  return { expenseId, id };
}

function sendError(res, error) {
  if (error.status) {
    return res.status(error.status).json({ error: error.message });
  }

  throw error;
}

/**
 * The raw file bytes, up to MAX_BYTES (plus a little, so an oversized file is
 * refused with our own message rather than a parser error). Only this route
 * reads a body this large.
 */
const rawBody = express.raw({ type: () => true, limit: MAX_BYTES + 1024 });

function readFile(req, res, next) {
  rawBody(req, res, error => {
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Each file can be up to 4 MB.' });
    }

    next(error);
  });
}

attachmentsRouter.get('/', asyncRoute(async (req, res) => {
  const p = ids(req, res);
  if (!p) return;

  if (!await ownsExpense(req.session.userId, p.expenseId)) {
    return notFound(res);
  }

  const rows = await listAttachments(req.session.userId, p.expenseId);
  res.json(rows.map(toApi));
}));

/**
 * One file per request: the bytes as the body, the original name in the
 * X-File-Name header (URL-encoded). The type is read from the bytes.
 */
attachmentsRouter.post('/', readFile, asyncRoute(async (req, res) => {
  const p = ids(req, res);
  if (!p) return;

  const checked = checkUpload(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.get('x-file-name'));

  if (checked.error) {
    return res.status(checked.status).json({ error: checked.error });
  }

  try {
    const row = await addAttachment(req.session.userId, p.expenseId, req.body, checked.value);
    return row ? res.status(201).json(toApi(row)) : notFound(res);
  } catch (error) {
    sendError(res, error);
  }
}));

/**
 * The file itself, for preview (inline) or ?download=1 (saved). Same-origin
 * framing is allowed on this response only, so a PDF can show in the app's
 * own preview; nothing else may frame it.
 */
attachmentsRouter.get('/:id', asyncRoute(async (req, res) => {
  const p = ids(req, res);
  if (!p) return;

  let opened;

  try {
    opened = await openAttachment(req.session.userId, p.expenseId, p.id);
  } catch (error) {
    return sendError(res, error);
  }

  if (!opened) {
    return notFound(res);
  }

  const { row, stream } = opened;
  const disposition = req.query.download ? 'attachment' : 'inline';
  const ascii = row.file_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');

  res.set({
    'Content-Type': row.content_type,
    'Content-Length': String(row.size_bytes),
    'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "frame-ancestors 'self'",
    'Cache-Control': 'private, no-store'
  });

  Readable.fromWeb(stream).on('error', error => {
    console.error('[attachments] stream failed:', error.message);
    res.destroy(error);
  }).pipe(res);
}));

attachmentsRouter.delete('/:id', asyncRoute(async (req, res) => {
  const p = ids(req, res);
  if (!p) return;

  const { canRemove } = await effectivePermissions(req.session);

  if (!canRemove) {
    return res.status(403).json({ error: 'You do not have permission to remove attachments.' });
  }

  const removed = await deleteAttachment(req.session.userId, p.expenseId, p.id);
  return removed ? res.status(204).end() : notFound(res);
}));
