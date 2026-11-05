import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { IS_PRODUCTION, JWT_SECRET } from './env.mjs';

const COOKIE_NAME = 'et_session';
const SESSION_DAYS = 7;
const BCRYPT_ROUNDS = 12;

export function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  if (!hash) {
    // Still burn a comparison so a missing full-access password is not detectably
    // faster than a wrong one.
    return bcrypt.compare(plain, '$2a$12$' + 'x'.repeat(53)).then(() => false);
  }

  return bcrypt.compare(plain, hash);
}

/**
 * The session lives in an httpOnly cookie rather than localStorage, so page
 * scripts cannot read it.
 */
export function issueSession(res, { userId, loginType }) {
  const token = jwt.sign({ sub: userId, loginType }, JWT_SECRET, {
    expiresIn: `${SESSION_DAYS}d`
  });

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function readSession(req) {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { userId: payload.sub, loginType: payload.loginType };
  } catch {
    return null;
  }
}

/** Rejects the request unless it carries a valid session. */
export function requireAuth(req, res, next) {
  const session = readSession(req);

  if (!session) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  req.session = session;
  next();
}
