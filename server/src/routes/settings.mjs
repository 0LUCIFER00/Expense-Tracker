import { Router } from 'express';
import { query } from '../db.mjs';
import { requireAuth } from '../auth.mjs';
import { asyncRoute } from '../http.mjs';
import { COLUMNS, FLAGS, loadSettings, toApi } from '../settings-store.mjs';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

settingsRouter.get('/', asyncRoute(async (req, res) => {
  res.json(await loadSettings(req.session.userId));
}));

/**
 * Accepts a partial set of flags and leaves the rest untouched, so the UI can
 * send a single toggle without overwriting the others.
 *
 * Only an admin session may change them. The UI hides the controls from a
 * normal user, but that is presentation — this is the part that enforces it.
 */
settingsRouter.patch('/', asyncRoute(async (req, res) => {
  if (req.session.loginType !== 'admin') {
    return res.status(403).json({
      error: 'Sign in with your admin password to change permissions.'
    });
  }

  const assignments = [];
  const values = [req.session.userId];

  for (const [name, column] of Object.entries(FLAGS)) {
    const value = req.body?.[name];

    if (typeof value === 'boolean') {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    }
  }

  await loadSettings(req.session.userId);

  if (assignments.length === 0) {
    return res.json(await loadSettings(req.session.userId));
  }

  const { rows } = await query(
    `update user_settings set ${assignments.join(', ')}
      where user_id = $1
      returning ${COLUMNS}`,
    values
  );

  res.json(toApi(rows[0]));
}));
