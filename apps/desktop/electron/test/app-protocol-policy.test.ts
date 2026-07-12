import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  APP_PROTOCOL_INDEX_URL,
  appAssetResponseHeaders,
  mimeTypeForAppAsset,
  resolveAppProtocolPath,
} from '../window/app-protocol-policy.js';

async function fixture(): Promise<{ root: string; outside: string }> {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kodax-app-protocol-'));
  const root = path.join(base, 'renderer');
  const outside = path.join(base, 'outside.txt');
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<!doctype html>');
  await writeFile(path.join(root, 'assets', 'main.js'), 'export {};');
  await writeFile(outside, 'secret');
  return { root, outside };
}

test('app protocol resolves root and regular renderer assets', async () => {
  const { root } = await fixture();
  const index = await resolveAppProtocolPath('app://space/', root);
  const asset = await resolveAppProtocolPath('app://space/assets/main.js', root);

  assert.deepEqual(index, { ok: true, filePath: path.join(root, 'index.html') });
  assert.deepEqual(asset, { ok: true, filePath: path.join(root, 'assets', 'main.js') });
  assert.equal(APP_PROTOCOL_INDEX_URL, 'app://space/index.html');
});

test('app protocol rejects hosts, credentials, ports, query, and fragments', async () => {
  const { root } = await fixture();
  for (const url of [
    'app://other/index.html',
    'app://user@space/index.html',
    'app://space:42/index.html',
    'app://space/index.html?debug=1',
    'app://space/index.html#fragment',
  ]) {
    const result = await resolveAppProtocolPath(url, root);
    assert.equal(result.ok, false, url);
  }
});

test('app protocol rejects traversal, encoded separators, malformed encoding, and non-canonical paths', async () => {
  const { root } = await fixture();
  for (const url of [
    'app://space/../outside.txt',
    'app://space/%2e%2e/outside.txt',
    'app://space/%2E%2E/outside.txt',
    'app://space/assets%2fmain.js',
    'app://space/assets%5cmain.js',
    'app://space/assets\\main.js',
    'app://space/assets//main.js',
    'app://space/%ZZ',
    'app://space/%00index.html',
  ]) {
    const result = await resolveAppProtocolPath(url, root);
    assert.equal(result.ok, false, url);
    if (!result.ok) assert.notEqual(result.status, 404, url);
  }
});

test('app protocol fails closed for directories and missing files', async () => {
  const { root } = await fixture();
  assert.deepEqual(await resolveAppProtocolPath('app://space/assets', root), {
    ok: false,
    status: 403,
    code: 'not-file',
  });
  assert.deepEqual(await resolveAppProtocolPath('app://space/missing.js', root), {
    ok: false,
    status: 404,
    code: 'not-found',
  });
});

test('app protocol rejects symlink escape when the platform permits symlinks', async (t) => {
  const { root, outside } = await fixture();
  const link = path.join(root, 'assets', 'escape.txt');
  try {
    await symlink(outside, link, 'file');
  } catch (error) {
    t.skip(`symlink unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  assert.deepEqual(await resolveAppProtocolPath('app://space/assets/escape.txt', root), {
    ok: false,
    status: 403,
    code: 'root-escape',
  });
});

test('app protocol MIME and response headers are explicit and immutable-safe', () => {
  assert.equal(mimeTypeForAppAsset('index.html'), 'text/html; charset=utf-8');
  assert.equal(mimeTypeForAppAsset('main.js'), 'text/javascript; charset=utf-8');
  assert.equal(mimeTypeForAppAsset('font.woff2'), 'font/woff2');
  assert.equal(mimeTypeForAppAsset('unknown.bin'), 'application/octet-stream');
  assert.deepEqual(appAssetResponseHeaders('index.html'), {
    'content-type': 'text/html; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-cache',
  });
  assert.equal(
    appAssetResponseHeaders('main.js')['cache-control'],
    'public, max-age=31536000, immutable',
  );
});
