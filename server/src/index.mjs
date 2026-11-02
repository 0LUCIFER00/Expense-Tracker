import { createApp } from './app.mjs';
import { PORT, NODE_ENV } from './env.mjs';
import { closePool, pool } from './db.mjs';

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT} (${NODE_ENV})`);
});

// Report an unreachable database at boot rather than on the first request.
pool
  .query('select 1')
  .then(() => console.log('[api] database connection ok'))
  .catch(error => {
    console.error(`[api] database unreachable: ${error.message}`);

    if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      console.error(
        '[api] the host in .env did not resolve — check the Aiven console ' +
        'Connection information panel and that the service is running.'
      );
    }
  });

async function shutdown(signal) {
  console.log(`\n[api] ${signal} received, shutting down`);
  server.close();
  await closePool().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
