/*
 * Runs before the app renders, to avoid a flash of the light theme.
 *
 * This lives in its own file rather than inline in index.html because the
 * server sends `script-src 'self'`, which blocks inline scripts. Inline, it
 * was silently refused and the flash came back.
 */
try {
  if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
} catch (e) {
  /* Private mode, or storage switched off: light is the right fallback. */
}
