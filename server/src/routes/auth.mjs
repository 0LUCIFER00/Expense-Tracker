import { Router } from 'express';
import { query, transaction } from '../db.mjs';
import {
  clearSession,
  hashPassword,
  issueSession,
  readSession,
  requireAuth,
  verifyPassword
} from '../auth.mjs';
import { asyncRoute, badRequest, normaliseEmail } from '../http.mjs';

export const authRouter = Router();

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    hasAdminPassword: Boolean(row.admin_password_hash)
  };
}

authRouter.post('/register', asyncRoute(async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = normaliseEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const adminPassword = String(req.body?.adminPassword ?? '');

  if (name.length < 3) {
    return badRequest(res, 'Name must be at least 3 characters');
  }

  if (!email) {
    return badRequest(res, 'A valid email is required');
  }

  if (password.length < 6) {
    return badRequest(res, 'Password must be at least 6 characters');
  }

  if (adminPassword && adminPassword === password) {
    return badRequest(res, 'The admin password must differ from the account password');
  }

  const existing = await query('select 1 from users where email = $1', [email]);

  if (existing.rowCount > 0) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = await hashPassword(password);
  const adminHash = adminPassword ? await hashPassword(adminPassword) : null;

  const user = await transaction(async client => {
    const { rows } = await client.query(
      `insert into users (name, email, password_hash, admin_password_hash)
       values ($1, $2, $3, $4)
       returning id, name, email, admin_password_hash`,
      [name, email, passwordHash, adminHash]
    );

    // Every account starts with the full permission matrix granted.
    await client.query(
      'insert into user_settings (user_id) values ($1) on conflict do nothing',
      [rows[0].id]
    );

    return rows[0];
  });

  issueSession(res, { userId: user.id, loginType: 'user' });

  res.status(201).json({ user: publicUser(user), loginType: 'user' });
}));

authRouter.post('/login', asyncRoute(async (req, res) => {
  const email = normaliseEmail(req.body?.email);
  const password = String(req.body?.password ?? '');

  const { rows } = await query(
    `select id, name, email, password_hash, admin_password_hash
       from users where email = $1`,
    [email || '']
  );

  const user = rows[0];

  // One message for both "no such account" and "wrong password", so the
  // response does not reveal which emails are registered.
  const invalid = () => res.status(401).json({ error: 'Invalid email or password' });

  if (!user) {
    await verifyPassword(password, null);
    return invalid();
  }

  let loginType = null;

  if (await verifyPassword(password, user.password_hash)) {
    loginType = 'user';
  } else if (await verifyPassword(password, user.admin_password_hash)) {
    loginType = 'admin';
  }

  if (!loginType) {
    return invalid();
  }

  issueSession(res, { userId: user.id, loginType });

  res.json({ user: publicUser(user), loginType });
}));

authRouter.post('/logout', (req, res) => {
  clearSession(res);
  res.status(204).end();
});

authRouter.get('/me', asyncRoute(async (req, res) => {
  const session = readSession(req);

  if (!session) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  const { rows } = await query(
    'select id, name, email, admin_password_hash from users where id = $1',
    [session.userId]
  );

  if (!rows[0]) {
    clearSession(res);
    return res.status(401).json({ error: 'Not signed in' });
  }

  res.json({ user: publicUser(rows[0]), loginType: session.loginType });
}));

/** Creates or replaces the account's admin password. */
authRouter.put('/admin-password', requireAuth, asyncRoute(async (req, res) => {
  const adminPassword = String(req.body?.adminPassword ?? '');

  if (adminPassword.length < 6) {
    return badRequest(res, 'Admin password must be at least 6 characters');
  }

  const { rows } = await query('select password_hash from users where id = $1', [
    req.session.userId
  ]);

  if (rows[0] && await verifyPassword(adminPassword, rows[0].password_hash)) {
    return badRequest(res, 'The admin password must differ from the account password');
  }

  const hash = await hashPassword(adminPassword);

  await query('update users set admin_password_hash = $1 where id = $2', [
    hash,
    req.session.userId
  ]);

  res.json({ hasAdminPassword: true });
}));

/** Clears it, after confirming the caller knows the current one. */
authRouter.post('/admin-password/remove', requireAuth, asyncRoute(async (req, res) => {
  const currentPassword = String(req.body?.adminPassword ?? '');

  const { rows } = await query(
    'select admin_password_hash from users where id = $1',
    [req.session.userId]
  );

  if (!rows[0] || !await verifyPassword(currentPassword, rows[0].admin_password_hash)) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }

  // With no admin there is nobody who could change the permission matrix
  // again, so leaving it half-restricted would lock the account out of its own
  // features. Removing the admin password resets the flags to all-granted.
  await transaction(async client => {
    await client.query('update users set admin_password_hash = null where id = $1', [
      req.session.userId
    ]);

    await client.query('delete from user_settings where user_id = $1', [
      req.session.userId
    ]);

    await client.query('insert into user_settings (user_id) values ($1)', [
      req.session.userId
    ]);
  });

  res.json({ hasAdminPassword: false, settingsReset: true });
}));
