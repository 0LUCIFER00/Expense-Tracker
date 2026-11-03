/**
 * A fixed-window rate limiter for the endpoints that take a password.
 *
 * Without one, /auth/login will answer guesses as fast as they arrive: bcrypt
 * makes each attempt slow, but slow is not the same as limited, and an account
 * password only has to be guessed once.
 *
 * Two stores, because where the app runs decides which is correct:
 *
 *   memory    one process owns the count. No round trip, but the count dies
 *             with the process and is not shared, so it only holds when a
 *             single long-lived server answers every request.
 *   postgres  the count lives in a row every instance can see. Costs a write
 *             per attempt, which is affordable on these endpoints alone.
 *
 * Serverless platforms run several instances and recycle them around traffic,
 * so the memory store silently stops being a limit there. VERCEL is set by the
 * platform, which is why the choice needs no configuration.
 */
import { query } from './db.mjs';

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
 * Counts one attempt and reports the result.
 *
 * Synchronous on purpose: it is what keeps the limiter usable without a
 * database, in development and in the tests.
 */
function hitMemory(id, windowMs) {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(id);

  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(id, { count: 1, resetAt });
    return { count: 1, resetAt };
  }

  bucket.count += 1;

  return { count: bucket.count, resetAt: bucket.resetAt };
}

/**
 * The same thing as one statement, so two instances counting the same attempt
 * cannot read, increment and write over each other. The insert claims the
 * bucket; the conflict branch either continues the window or starts a new one
 * when the old has passed.
 */
async function hitPostgres(id, windowMs) {
  const { rows } = await query(
    `insert into rate_limit_buckets (id, count, reset_at)
          values ($1, 1, now() + make_interval(secs => $2))
     on conflict (id) do update
            set count = case
                          when rate_limit_buckets.reset_at <= now() then 1
                          else rate_limit_buckets.count + 1
                        end,
                reset_at = case
                             when rate_limit_buckets.reset_at <= now()
                               then now() + make_interval(secs => $2)
                             else rate_limit_buckets.reset_at
                           end
      returning count, reset_at`,
    [id, windowMs / 1000]
  );

  return { count: rows[0].count, resetAt: new Date(rows[0].reset_at).getTime() };
}

let lastPrune = 0;

/** Clears expired rows now and then, so the table does not only grow. */
function prunePostgres() {
  const now = Date.now();

  if (now - lastPrune < SWEEP_EVERY_MS) {
    return;
  }

  lastPrune = now;

  query('delete from rate_limit_buckets where reset_at <= now()').catch(error => {
    console.warn('[rate-limit] could not prune:', error.message);
  });
}

const USE_POSTGRES = Boolean(process.env['VERCEL']);

/**
 * @param limit    attempts allowed per window
 * @param windowMs length of the window
 * @param key      what to count against; defaults to the caller's IP
 */
export function rateLimit({ limit, windowMs, key }) {
  return function limiter(req, res, next) {
    const id = `${req.method} ${req.baseUrl}${req.path}|${key ? key(req) : req.ip}`;

    const refuse = ({ count, resetAt }) => {
      if (count <= limit) {
        return next();
      }

      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));

      res.set('Retry-After', String(retryAfter));

      res.status(429).json({
        error: `Too many attempts. Try again in ${retryAfter} second(s).`
      });
    };

    if (!USE_POSTGRES) {
      return refuse(hitMemory(id, windowMs));
    }

    prunePostgres();

    hitPostgres(id, windowMs).then(refuse, error => {
      /*
       * The store is the same database the sign-in itself needs, so if this
       * failed the request behind it is about to fail anyway. Letting it
       * through keeps a database blip from locking everybody out, and the
       * attempt still cannot succeed without the users table.
       */
      console.warn('[rate-limit] store unavailable, allowing:', error.message);
      next();
    });
  };
}

/** Test seam: forgets every counted attempt. */
export function resetRateLimits() {
  buckets.clear();
}
