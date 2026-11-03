/**
 * Work that carries on after the response has been sent.
 *
 * The WhatsApp webhook answers Meta straight away and then does the real work,
 * because Meta retries anything that is not a prompt 2xx. On a server that
 * stays up, letting the promise run on its own is enough.
 *
 * On a serverless platform it is not. The instance may be frozen or discarded
 * as soon as the response is flushed, so the work is killed part-way — which
 * showed up as "Connection terminated unexpectedly" from the database driver,
 * a webhook that answered 200 and recorded nothing, and no reply ever sent.
 * waitUntil is how the platform is told to keep the instance alive until the
 * promise settles.
 *
 * Imported dynamically so the package is only needed where it is used.
 */
let waitUntil = null;

if (process.env['VERCEL']) {
  try {
    ({ waitUntil } = await import('@vercel/functions'));
  } catch (error) {
    console.warn('[after-response] waitUntil unavailable:', error.message);
  }
}

/**
 * Keeps `promise` alive past the response, and swallows its rejection: the
 * caller has already replied, so there is nothing left to fail.
 */
export function afterResponse(promise) {
  const settled = promise.catch(error => {
    console.error('[after-response] background work failed', error);
  });

  if (waitUntil) {
    waitUntil(settled);
  }

  return settled;
}
