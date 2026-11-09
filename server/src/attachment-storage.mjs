/**
 * The file store for receipts: private Vercel Blob.
 *
 * Only the server talks to it, with BLOB_READ_WRITE_TOKEN (set by connecting
 * the Blob store to the Vercel project; pulled into .env.local for local
 * runs). Files are written private, at keys the server made, and never handed
 * out as URLs: the API streams them to the signed-in owner.
 *
 * Kept to three calls behind one small module so the tests can swap it out.
 */
import { del, get, put } from '@vercel/blob';

function token() {
  const value = process.env['BLOB_READ_WRITE_TOKEN'];

  if (!value) {
    throw Object.assign(new Error('Receipt storage is not set up on this server.'), { status: 503 });
  }

  return value;
}

export async function putFile(key, buffer, contentType) {
  await put(key, buffer, {
    access: 'private',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: false,
    token: token()
  });
}

/** A readable web stream of the file, or null when storage has no such file. */
export async function getFile(key) {
  const result = await get(key, { access: 'private', token: token() });
  return result?.stream ?? null;
}

export async function deleteFile(key) {
  await del(key, { token: token() });
}

export function isConfigured() {
  return Boolean(process.env['BLOB_READ_WRITE_TOKEN']);
}
