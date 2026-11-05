import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { IS_PRODUCTION, JWT_SECRET } from './env.mjs';
import { query } from './db.mjs';
import { loadAccount } from './settings-store.mjs';

const COOKIE_NAME = 'et_session';
const SESSION_DAYS = 7;
const BCRYPT_ROUNDS = 12;

/** The only algorithm a session is signed with, so the only one accepted. */
const JWT_ALGORITHM = 'HS256';

/** The shortest password accepted when one is set or changed. */
export const PASSWORD_MIN = 8;

/**
 * A real cost-12 bcrypt hash of 32 random bytes nobody kept, so comparing
 * against it costs exactly what a real comparison costs and matches nothing.
 * A malformed stand-in returns early, which made "no such account" measurably
 * faster than "wrong password". Fixed rather than generated at start-up,
 * because hashing at cost 12 would add a quarter of a second to every cold
 * start.
 */
const DUMMY_HASH = '$2a$12$Y2i3W31qbQprSUJwrKt4h.qsBNfe3WgsFm6YfBI/halm93oBO1z6y';

export function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  if (!hash) {
    // Still burn a full comparison, so a missing hash (no account, no
    // full-access password) is not detectably faster than a wrong password.
    return bcrypt.compare(String(plain), DUMMY_HASH).then(() => false);
  }

  return bcrypt.compare(String(plain), hash);
}

/**
 * The session lives in an httpOnly cookie rather than localStorage, so page
 * scripts cannot read it.
 *
 * `version` is the account's session_version when the cookie is issued. Raising
 * that column revokes every cookie carrying an older one.
 */
export function issueSession(res, { userId, loginType, version = 0 }) {
  const token = jwt.sign({ sub: userId, loginType, ver: version }, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
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

/**
 * What the cookie claims, checked for signature and expiry only.
 *
 * Not proof the session is still good — the account may have revoked it. Use
 * authenticate() for that; this is for keying rate limits.
 */
export function readSession(req) {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });

    return {
      userId: payload.sub,
      loginType: payload.loginType === 'admin' ? 'admin' : 'user',
      // Cookies issued before versions existed carry none, which means 0.
      version: Number.isInteger(payload.ver) ? payload.ver : 0
    };
  } catch {
    return null;
  }
}

/**
 * The session, if the cookie is valid AND the account still honours it.
 *
 * One query: the account's session version, and its permission flags, which
 * are attached to the session so the route does not fetch them again.
 *
 * @returns the session, or null when there is none, the account is gone, or the
 *   session has been revoked.
 */
export async function authenticate(req) {
  const claimed = readSession(req);

  if (!claimed) {
    return null;
  }

  const account = await loadAccount(claimed.userId);

  if (!account || account.sessionVersion !== claimed.version) {
    return null;
  }

  return { ...claimed, settings: account.settings };
}

/** Rejects the request unless it carries a valid, unrevoked session. */
export function requireAuth(req, res, next) {
  authenticate(req).then(session => {
    if (!session) {
      clearSession(res);
      return res.status(401).json({ error: 'Not signed in' });
    }

    req.session = session;
    next();
  }, next);
}

/**
 * Revokes every session the account has, and signs the current device back in
 * so the person making the change is not thrown out by it.
 *
 * @param client a transaction client, when the change is part of one
 */
export async function revokeOtherSessions(res, session, client = null) {
  const run = client ? client.query.bind(client) : query;

  const { rows } = await run(
    `update users set session_version = session_version + 1
      where id = $1
      returning session_version`,
    [session.userId]
  );

  if (rows[0]) {
    issueSession(res, {
      userId: session.userId,
      loginType: session.loginType,
      version: rows[0].session_version
    });
  }
}
