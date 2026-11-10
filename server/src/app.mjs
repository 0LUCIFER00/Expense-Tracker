import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth.mjs';
import { balancesRouter } from './routes/balances.mjs';
import { expensesRouter } from './routes/expenses.mjs';
import { incomesRouter } from './routes/incomes.mjs';
import { budgetsRouter } from './routes/budgets.mjs';
import { recurringRouter } from './routes/recurring.mjs';
import { goalsRouter } from './routes/goals.mjs';
import { transfersRouter } from './routes/transfers.mjs';
import { attachmentsRouter } from './routes/attachments.mjs';
import { importsRouter } from './routes/imports.mjs';
import { settingsRouter } from './routes/settings.mjs';
import { whatsappRouter } from './routes/whatsapp.mjs';
import { linkRouter } from './routes/link.mjs';
import { pool } from './db.mjs';
import { IS_PRODUCTION, projectRoot } from './env.mjs';

/**
 * The headers a browser needs to be told, since nothing else sets them.
 *
 * frame-ancestors is the one that matters most here: without it another site
 * can put this one in an invisible iframe over its own buttons, and a click
 * meant for that page lands on "Remove" or "Delete account" in this one. The
 * connect/img/script rules keep a successful injection from phoning anywhere.
 */
export const CSP = [
  "default-src 'self'",
  // Angular's styles are injected inline, and Google Fonts serves the typeface.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "script-src 'self'",
  "img-src 'self' data:",
  // The API is same-origin in a deployment; nothing else should be reachable.
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join('; ');

/**
 * Sent on every response. vercel.json repeats them for the pages the CDN serves
 * without passing through here; a test keeps the two lists identical.
 */
export const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  // Belt and braces for browsers that predate frame-ancestors.
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
};

function securityHeaders(_req, res, next) {
  res.set(SECURITY_HEADERS);

  // Only meaningful over HTTPS, and only safe once the site is HTTPS-only.
  if (IS_PRODUCTION) {
    res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  next();
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  /*
   * Render (and any other platform) puts a proxy in front, so req.ip would
   * otherwise be the proxy's address for everyone — which would make the
   * per-address rate limits count the whole internet as one caller. One hop is
   * all that is trusted; trusting more would let a client forge the header.
   */
  if (IS_PRODUCTION) {
    app.set('trust proxy', 1);
  }

  app.use(securityHeaders);

  /*
   * The bundles are text, and text compresses to roughly a third. Without this
   * a first visit downloads about 340kB where 96kB would do, which is most of
   * the wait on a phone. It skips anything already compressed, and honours a
   * client that asks for identity.
   */
  app.use(compression());

  const json = express.json({
    limit: '100kb',
    // The WhatsApp signature is an HMAC over the exact bytes received, so
    // they have to be kept before the body is parsed away.
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  });

  // An import preview carries a whole file's rows; its router parses its own
  // body with a larger cap. Everything else keeps this one.
  app.use((req, res, next) => (req.path.startsWith('/api/imports/') ? next() : json(req, res, next)));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('select 1');
      res.json({ status: 'ok', database: 'reachable' });
    } catch (error) {
      /*
       * The reason stays in the log. A connection failure quotes the host,
       * port and user it tried, and this endpoint needs no cookie — so saying
       * why out loud hands a stranger the shape of the infrastructure.
       */
      console.error('[health] database unreachable:', error.message);

      res.status(503).json({ status: 'degraded', database: 'unreachable' });
    }
  });

  /*
   * Every API answer is someone's money, so none of it is kept: not by the
   * browser's disk cache, not by anything in between. Without this the
   * platform default was "public, max-age=0, must-revalidate", which permits
   * storing it.
   */
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/auth', authRouter);
  // Before the expenses router, so /api/expenses/:id/attachments is never taken for an expense route.
  app.use('/api/expenses/:expenseId/attachments', attachmentsRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/incomes', incomesRouter);
  app.use('/api/budgets', budgetsRouter);
  app.use('/api/recurring', recurringRouter);
  app.use('/api/goals', goalsRouter);
  app.use('/api/transfers', transfersRouter);
  app.use('/api/imports', importsRouter);
  app.use('/api/balances', balancesRouter);
  app.use('/api/settings', settingsRouter);
  // The more specific path first: /api/whatsapp would otherwise shadow it.
  app.use('/api/whatsapp/link', linkRouter);
  app.use('/api/whatsapp', whatsappRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

  /*
   * In a deployment the built Angular app is served by this same process, so
   * the whole thing lives behind one URL: no CORS, no dev proxy, and one
   * stable address to register with Meta. Skipped when the build is absent,
   * which is the normal case in development where `ng serve` handles it.
   */
  const browserDist = join(projectRoot, 'dist', 'expense-tracker', 'browser');

  if (existsSync(browserDist)) {
    app.use(
      express.static(browserDist, {
        index: false,
        setHeaders(res, path) {
          /*
           * A built bundle carries a content hash in its name, so a given file
           * never changes: it can be cached for as long as the browser likes,
           * and a new deploy is a new filename rather than a stale copy. An
           * hour, as this was, meant re-downloading the whole app every hour
           * for no reason. Everything else keeps the conservative default.
           */
          if (/-[A-Z0-9]{8,}\.(js|css)$/.test(path)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=3600');
          }
        }
      })
    );

    // Deep links such as /view-expenses are routes inside the SPA, not files.
    // Never cached: it is what points at the current bundle names.
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(browserDist, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars -- Express needs the 4-arg shape.
  app.use((error, _req, res, _next) => {
    /*
     * A body express.json() could not parse. The caller sent it, so it is a 400
     * and not worth a stack trace in the log — left alone it reports as a
     * server fault and buries real 500s in noise.
     */
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed request body.' });
    }

    // A body over the 100kb cap.
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'That request is too large.' });
    }

    // A unique-violation that slipped past the pre-check.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That record already exists.' });
    }

    if (error.code === '22P02') {
      return res.status(400).json({ error: 'Malformed identifier.' });
    }

    /*
     * Not the whole error: a database error's `detail` quotes the row it
     * tripped over ("Key (email)=(someone@example.com) already exists"), which
     * puts personal data in the platform's logs. The message, the code and
     * where it was thrown are enough to find it.
     */
    console.error('[api]', {
      message: error.message,
      code: error.code,
      constraint: error.constraint,
      stack: error.stack?.split('\n').slice(0, 4).join('\n')
    });
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}
