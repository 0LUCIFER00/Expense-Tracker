/**
 * A small fixed-window rate limiter for the endpoints that take a password.
 *
 * Without one, /auth/login will answer guesses as fast as they arrive: bcrypt
 * makes each attempt slow, but slow is not the same as limited, and an account
 * password only has to be guessed once.
 *
 * In memory on purpose. The alternative is a table and a write per attempt,
 * which costs a round trip on the hot path to defend a single-process app; if
 * this is ever run as more than one instance, move the counter to the database
 * or a shared cache, because each instance would otherwise keep its own count.
 */

/** Attempts are forgotten this long after the window opens. */
const SWEEP_EVERY_MS = 60_000;

const buckets = new Map();

let lastSweep = Date.now();

/** Drops expired buckets so a long-running process does not accumulate them. */
function sweep(now) {
  if (now - lastSweep < SWEEP_EVERY_MS) {
    return;
  }

  lastSweep = now;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

/**
 * @param limit  attempts allowed per window
 * @param windowMs length of the window
 * @param key    what to count against; defaults to the caller's IP
 */
export function rateLimit({ limit, windowMs, key }) {
  return function limiter(req, res, next) {
    const now = Date.now();
    sweep(now);

    const id = `${req.method} ${req.baseUrl}${req.path}|${key ? key(req) : req.ip}`;
    const bucket = buckets.get(id);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(id, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;

    if (bucket.count > limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);

      res.set('Retry-After', String(retryAfter));

      return res.status(429).json({
        error: `Too many attempts. Try again in ${retryAfter} second(s).`
      });
    }

    next();
  };
}

/** Test seam: forgets every counted attempt. */
export function resetRateLimits() {
  buckets.clear();
}
