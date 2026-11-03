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
import { asyncRoute, badRequest, normaliseEmail, parseText } from '../http.mjs';
import { rateLimit } from '../rate-limit.mjs';

export const authRouter = Router();

/** Longer than any real name, short enough to render in the header. */
const NAME_MAX = 80;

/**
 * Guessing a password is counted per account as well as per address, so one
 * attacker cannot lock every account out by hammering a single one, and a
 * household behind one address is not punished for a flatmate's typing.
 */
const loginLimit = rateLimit({
  limit: 10,
  windowMs: 10 * 60_000,
  key: req => `${req.ip}|${normaliseEmail(req.body?.email) ?? ''}`
});

/** Account creation is slower still: nobody opens six accounts in an hour. */
const registerLimit = rateLimit({ limit: 5, windowMs: 60 * 60_000 });

/**
 * The endpoints that check a password the caller is supposed to already know.
 * Counted per session rather than per address, since they all require one.
 */
const passwordLimit = rateLimit({
  limit: 10,
  windowMs: 10 * 60_000,
  key: req => readSession(req)?.userId ?? req.ip
});

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    hasAdminPassword: Boolean(row.admin_password_hash),
    // "Member since" on the profile page. Absent from the rows that only
    // needed enough to issue a session, hence the guard.
    createdAt: row.created_at ?? null
  };
}

authRouter.post('/register', registerLimit, asyncRoute(async (req, res) => {
  const name = parseText(req.body?.name, { field: 'Name', max: NAME_MAX });
  const email = normaliseEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const adminPassword = String(req.body?.adminPassword ?? '');

  if (name.error) {
    return badRequest(res, name.error);
  }

  if (name.value.length < 3) {
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
       returning id, name, email, admin_password_hash, created_at`,
      [name.value, email, passwordHash, adminHash]
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

authRouter.post('/login', loginLimit, asyncRoute(async (req, res) => {
  const email = normaliseEmail(req.body?.email);
  const password = String(req.body?.password ?? '');

  const { rows } = await query(
    `select id, name, email, password_hash, admin_password_hash, created_at
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
    'select id, name, email, admin_password_hash, created_at from users where id = $1',
    [session.userId]
  );

  if (!rows[0]) {
    clearSession(res);
    return res.status(401).json({ error: 'Not signed in' });
  }

  res.json({ user: publicUser(rows[0]), loginType: session.loginType });
}));

/**
 * Renames the account, and changes the email it signs in with.
 *
 * The email is the identity, so changing it changes the sign-in: it has to stay
 * unique, and the check is case-insensitive like the column.
 */
authRouter.patch('/profile', requireAuth, asyncRoute(async (req, res) => {
  const name = parseText(req.body?.name, { field: 'Name', max: NAME_MAX });
  const email = normaliseEmail(req.body?.email);

  if (name.error) {
    return badRequest(res, name.error);
  }

  if (name.value.length < 3) {
    return badRequest(res, 'Name must be at least 3 characters');
  }

  if (req.body?.email !== undefined && !email) {
    return badRequest(res, 'A valid email is required');
  }

  if (email) {
    const taken = await query('select 1 from users where email = $1 and id <> $2', [
      email,
      req.session.userId
    ]);

    if (taken.rowCount > 0) {
      return res.status(409).json({ error: 'Another account already uses that email.' });
    }
  }

  const { rows } = await query(
    `update users
        set name = $1,
            email = coalesce($2, email)
      where id = $3
      returning id, name, email, admin_password_hash, created_at`,
    [name.value, email, req.session.userId]
  );

  res.json({ user: publicUser(rows[0]) });
}));

/**
 * Closes the account.
 *
 * Everything belonging to it goes with it: the expenses, the balance accounts,
 * the permission flags and any linked phone all cascade from this row. The
 * password is required because the session alone would let a borrowed browser
 * destroy the lot.
 */
authRouter.delete('/account', requireAuth, passwordLimit, asyncRoute(async (req, res) => {
  const password = String(req.body?.password ?? '');

  const { rows } = await query('select password_hash from users where id = $1', [
    req.session.userId
  ]);

  if (!rows[0] || !await verifyPassword(password, rows[0].password_hash)) {
    return res.status(403).json({ error: 'Your password is not correct' });
  }

  await query('delete from users where id = $1', [req.session.userId]);

  clearSession(res);

  res.json({ deleted: true });
}));

/**
 * Changes the account password.
 *
 * The current one is required even though the caller already holds a session:
 * a borrowed, unlocked browser should not be enough to lock the owner out.
 */
authRouter.put('/password', requireAuth, passwordLimit, asyncRoute(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');

  if (newPassword.length < 6) {
    return badRequest(res, 'New password must be at least 6 characters');
  }

  const { rows } = await query(
    'select password_hash, admin_password_hash from users where id = $1',
    [req.session.userId]
  );

  if (!rows[0] || !await verifyPassword(currentPassword, rows[0].password_hash)) {
    return res.status(403).json({ error: 'Your current password is not correct' });
  }

  if (currentPassword === newPassword) {
    return badRequest(res, 'The new password must be different');
  }

  // The two passwords are what tell a normal session from an admin one, so
  // they must not become the same value.
  if (await verifyPassword(newPassword, rows[0].admin_password_hash)) {
    return badRequest(res, 'That is your admin password — pick a different one');
  }

  await query('update users set password_hash = $1 where id = $2', [
    await hashPassword(newPassword),
    req.session.userId
  ]);

  res.json({ changed: true });
}));

/**
 * Creates the account's admin password, or replaces an existing one.
 *
 * Creating the first one needs nothing beyond a session: with no admin password
 * yet, the normal user already has every permission, so there is nothing to
 * climb past.
 *
 * Replacing one is different. The admin password is what the permission matrix
 * is enforced against, so a normal user who could overwrite it could set one of
 * their own, sign in with it and grant themselves everything the owner had
 * switched off — balances, Add Money, approvals, deletions. Changing it
 * therefore needs proof of the current admin: either a session already signed
 * in with it, or the existing password in the body.
 */
authRouter.put('/admin-password', requireAuth, passwordLimit, asyncRoute(async (req, res) => {
  const adminPassword = String(req.body?.adminPassword ?? '');
  const currentAdminPassword = String(req.body?.currentAdminPassword ?? '');

  if (adminPassword.length < 6) {
    return badRequest(res, 'Admin password must be at least 6 characters');
  }

  const { rows } = await query(
    'select password_hash, admin_password_hash from users where id = $1',
    [req.session.userId]
  );

  const existingAdminHash = rows[0]?.admin_password_hash ?? null;

  if (existingAdminHash && req.session.loginType !== 'admin') {
    const proven = await verifyPassword(currentAdminPassword, existingAdminHash);

    if (!proven) {
      return res.status(403).json({
        error: 'Enter the current admin password to change it.'
      });
    }
  }

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
authRouter.post('/admin-password/remove', requireAuth, passwordLimit, asyncRoute(async (req, res) => {
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
