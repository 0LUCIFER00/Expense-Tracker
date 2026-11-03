/*
 * Vercel entrypoint.
 *
 * server/src/index.mjs owns the process: it listens on a port, pings the
 * database at boot and drains the pool on SIGTERM. None of that applies here,
 * where the platform owns the lifecycle and hands the app one request at a
 * time, so this exports the app itself and nothing else.
 *
 * vercel.json routes every /api/* path here; the built Angular app is served
 * as static files by the CDN rather than by express.static.
 */
import { createApp } from '../server/src/app.mjs';

export default createApp();
