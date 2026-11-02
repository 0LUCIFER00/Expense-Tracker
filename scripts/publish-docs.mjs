// Syncs the production build into docs/, which is what GitHub Pages serves.
// Run via `npm run build:pages` so docs/ never drifts from src/ by hand.
import { cp, mkdir, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BUILD_DIR = join('dist', 'expense-tracker', 'browser');
const DOCS_DIR = 'docs';

if (!existsSync(BUILD_DIR)) {
  console.error(`No build found at ${BUILD_DIR}. Run "ng build" first.`);
  process.exit(1);
}

// Clear docs/ so hashed bundles from previous builds do not pile up.
if (existsSync(DOCS_DIR)) {
  for (const entry of await readdir(DOCS_DIR)) {
    await rm(join(DOCS_DIR, entry), { recursive: true, force: true });
  }
} else {
  await mkdir(DOCS_DIR, { recursive: true });
}

await cp(BUILD_DIR, DOCS_DIR, { recursive: true });

// Stop Pages running the output through Jekyll, which would drop _-prefixed files.
await writeFile(join(DOCS_DIR, '.nojekyll'), '');

// Pages has no rewrite rule, so a deep link like /Expense-Tracker/home would 404.
// Serving index.html as the 404 page hands the route back to the Angular router.
await copyFile(join(DOCS_DIR, 'index.html'), join(DOCS_DIR, '404.html'));

console.log(`Published ${BUILD_DIR} -> ${DOCS_DIR}/ (with .nojekyll and 404.html)`);
