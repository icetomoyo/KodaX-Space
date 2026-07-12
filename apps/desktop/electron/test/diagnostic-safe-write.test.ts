import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  replaceFilePreservingExisting,
  type SafeReplaceOperations,
} from '../diagnostics/safe-write.js';

test('diagnostic safe write replaces an existing export', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kodax-diagnostic-safe-write-'));
  const temporary = path.join(root, 'export.tmp');
  const destination = path.join(root, 'export.zip');
  await writeFile(temporary, 'new export');
  await writeFile(destination, 'old export');

  await replaceFilePreservingExisting(temporary, destination);

  assert.equal(await readFile(destination, 'utf8'), 'new export');
});

test('diagnostic safe write restores the old export when replacement fails', async () => {
  const calls: Array<[string, string]> = [];
  let targetPresent = true;
  let backupPath = '';
  const expected = Object.assign(new Error('target exists'), { code: 'EEXIST' });
  const replacementFailure = Object.assign(new Error('replacement failed'), { code: 'EIO' });
  const operations: SafeReplaceOperations = {
    async rename(from, to) {
      calls.push([String(from), String(to)]);
      if (calls.length === 1) throw expected;
      if (calls.length === 2) {
        targetPresent = false;
        backupPath = String(to);
        return;
      }
      if (calls.length === 3) throw replacementFailure;
      assert.equal(String(from), backupPath);
      targetPresent = true;
    },
    async rm() {
      return undefined;
    },
    async stat() {
      if (!targetPresent) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return {};
    },
  };

  await assert.rejects(
    replaceFilePreservingExisting('export.tmp', 'export.zip', operations),
    replacementFailure,
  );
  assert.equal(targetPresent, true);
  assert.equal(calls.length, 4);
});
