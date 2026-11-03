import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth.mjs';
import { balancesRouter } from './routes/balances.mjs';
import { expensesRouter } from './routes/expenses.mjs';
import { incomesRouter } from './routes/incomes.mjs';
import { settingsRouter } from './routes/settings.mjs';
import { whatsappRouter } from './routes/whatsapp.mjs';
import { linkRouter } from './routes/link.mjs';
import { pool } from './db.mjs';
import { projectRoot } from './env.mjs';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    express.json({
      limit: '100kb',
      // The WhatsApp signature is an HMAC over the exact bytes received, so
      // they have to be kept before the body is parsed away.
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('select 1');
      res.json({ status: 'ok', database: 'reachable' });
    } catch (error) {
      res.status(503).json({ status: 'degraded', database: error.message });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/incomes', incomesRouter);
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
    app.use(express.static(browserDist, { index: false, maxAge: '1h' }));

    // Deep links such as /view-expenses are routes inside the SPA, not files.
    app.get('*', (_req, res) => res.sendFile(join(browserDist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars -- Express needs the 4-arg shape.
  app.use((error, _req, res, _next) => {
    // A unique-violation that slipped past the pre-check.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That record already exists.' });
    }

    if (error.code === '22P02') {
      return res.status(400).json({ error: 'Malformed identifier.' });
    }

    console.error('[api]', error);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}
