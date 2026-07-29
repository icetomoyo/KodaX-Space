import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('renderer bootstrap document contains no competing loading surface', async () => {
  const html = await readFile(path.join(desktopRoot, 'index.html'), 'utf8');

  assert.doesNotMatch(html, /boot-splash|boot-spinner|Starting up/);
  assert.match(html, /<div id="root">\s*<\/div>/);
  assert.match(html, /html\.dark\s*\{[^}]*--boot-bg:\s*#18181b/s);
});
