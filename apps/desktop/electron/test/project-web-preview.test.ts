import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  PROJECT_WEB_PREVIEW_RUNTIME_PATH,
  MAX_PROJECT_WEB_PREVIEW_FILE_BYTES,
  ProjectWebPreviewRegistry,
  inferProjectWebPreviewSources,
  injectProjectWebPreviewRuntime,
  isProjectWebPreviewUrl,
  projectWebPreviewCsp,
  projectWebPreviewResponseHeaders,
} from '../window/project-web-preview.js';

async function fixture(): Promise<{ root: string; site: string; outside: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kodax-project-preview-'));
  const site = path.join(root, 'site');
  const outside = path.join(root, 'outside.txt');
  await mkdir(path.join(site, 'assets'), { recursive: true });
  await writeFile(
    path.join(site, 'index.html'),
    '<!doctype html><script type="module" src="./assets/app.js"></script>',
  );
  await writeFile(path.join(site, 'assets', 'app.js'), 'export const ready = true;');
  await writeFile(path.join(site, 'assets', 'style.css'), 'body { color: green; }');
  await writeFile(path.join(site, 'assets', 'data.json'), '{"ok":true}');
  await writeFile(path.join(site, '.env'), 'TOKEN=secret');
  await writeFile(path.join(site, 'private.pem'), 'secret');
  await writeFile(outside, 'outside');
  return { root, site, outside };
}

function registry(nowRef = { value: 1_000 }): ProjectWebPreviewRegistry {
  let token = 0;
  return new ProjectWebPreviewRegistry({
    now: () => nowRef.value,
    tokenFactory: () => (++token).toString(16).padStart(32, '0'),
    idleTtlMs: 5_000,
    maxEntries: 2,
  });
}

test('project preview creates an opaque capability URL and serves only the HTML directory', async () => {
  const { root, site } = await fixture();
  const previews = registry();
  const created = await previews.create({
    projectRoot: root,
    entryPath: 'site/index.html',
    networkAccess: false,
  });

  assert.equal(created.url, 'app://preview-00000000000000000000000000000001/index.html');
  assert.equal(created.networkAccess, false);
  assert.equal(isProjectWebPreviewUrl(created.url), true);
  assert.equal(isProjectWebPreviewUrl('app://space/index.html'), false);

  const script = await previews.resolve(
    new URL('./assets/app.js?rev=2', created.url).toString(),
    'GET',
  );
  assert.equal(script.ok, true);
  if (script.ok && script.kind === 'file') {
    assert.equal(script.filePath, path.join(await realpath(site), 'assets', 'app.js'));
    assert.equal(script.networkAccess, false);
  }

  const rootRelative = await previews.resolve(
    new URL('/assets/style.css', created.url).toString(),
    'GET',
  );
  assert.equal(rootRelative.ok, true);
});

test('project preview rejects methods, credentials, ports, hidden secrets, and unsupported types', async () => {
  const { root } = await fixture();
  const previews = registry();
  const created = await previews.create({
    projectRoot: root,
    entryPath: 'site/index.html',
    networkAccess: false,
  });
  const host = new URL(created.url).host;

  for (const [url, method] of [
    [`app://${host}/index.html`, 'POST'],
    [`app://user@${host}/index.html`, 'GET'],
    [`app://${host}:42/index.html`, 'GET'],
    [`app://${host}/.env`, 'GET'],
    [`app://${host}/private.pem`, 'GET'],
    [`app://${host}/missing.exe`, 'GET'],
  ] as const) {
    const result = await previews.resolve(url, method);
    assert.equal(result.ok, false, `${method} ${url}`);
  }
});

test('project preview bounds assets and reuses existing capabilities without needless eviction', async () => {
  const { root } = await fixture();
  const previews = registry();
  const largeAsset = path.join(root, 'site', 'large.mp4');
  await writeFile(largeAsset, '');
  await truncate(largeAsset, MAX_PROJECT_WEB_PREVIEW_FILE_BYTES + 1);

  const local = await previews.create({
    projectRoot: root,
    entryPath: 'site/index.html',
    networkAccess: false,
  });
  const network = await previews.create({
    projectRoot: root,
    entryPath: 'site/index.html',
    networkAccess: true,
  });
  const localAgain = await previews.create({
    projectRoot: root,
    entryPath: 'site/index.html',
    networkAccess: false,
  });

  assert.equal(localAgain.url, local.url);
  assert.equal((await previews.resolve(network.url, 'GET')).ok, true);
  const tooLarge = await previews.resolve(new URL('/large.mp4', local.url).toString(), 'GET');
  assert.deepEqual(tooLarge, { ok: false, status: 413, code: 'too-large' });
});

test('project preview rejects symlink escape and expired or evicted capabilities', async (t) => {
  const nowRef = { value: 1_000 };
  const { root, site, outside } = await fixture();
  const previews = registry(nowRef);
  const first = await previews.create({
    projectRoot: root,
    entryPath: 'site/index.html',
    networkAccess: false,
  });

  const escape = path.join(site, 'assets', 'escape.js');
  try {
    await symlink(outside, escape, 'file');
  } catch (error) {
    t.diagnostic(`symlink unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (await realpath(escape).catch(() => null)) {
    const escaped = await previews.resolve(
      new URL('./assets/escape.js', first.url).toString(),
      'GET',
    );
    assert.equal(escaped.ok, false);
  }

  nowRef.value += 5_001;
  assert.equal((await previews.resolve(first.url, 'GET')).ok, false);

  nowRef.value += 1;
  const local = await previews.create({
    projectRoot: root,
    entryPath: 'site/index.html',
    networkAccess: false,
  });
  const network = await previews.create({
    projectRoot: root,
    entryPath: 'site/index.html',
    networkAccess: true,
  });
  await mkdir(path.join(root, 'other'), { recursive: true });
  await writeFile(path.join(root, 'other', 'index.html'), '<!doctype html>other');
  await previews.create({
    projectRoot: root,
    entryPath: 'other/index.html',
    networkAccess: false,
  });
  assert.equal((await previews.resolve(local.url, 'GET')).ok, false);
  assert.equal((await previews.resolve(network.url, 'GET')).ok, true);
});

test('project preview exposes a fixed diagnostics runtime and mode-specific CSP', async () => {
  const { root } = await fixture();
  const previews = registry();
  const local = await previews.create({
    projectRoot: root,
    entryPath: 'site/index.html',
    networkAccess: false,
  });
  const runtime = await previews.resolve(
    new URL(PROJECT_WEB_PREVIEW_RUNTIME_PATH, local.url).toString(),
    'GET',
  );
  assert.equal(runtime.ok, true);
  if (runtime.ok) assert.equal(runtime.kind, 'runtime');

  const localCsp = projectWebPreviewCsp(false);
  const networkCsp = projectWebPreviewCsp(true);
  assert.match(localCsp, /connect-src 'self'/);
  assert.doesNotMatch(localCsp, /connect-src[^;]*https:/);
  assert.match(networkCsp, /connect-src[^;]*https: wss:/);
  assert.match(localCsp, /frame-src 'none'/);
  assert.match(localCsp, /object-src 'none'/);

  const headers = projectWebPreviewResponseHeaders('index.html', false);
  assert.equal(headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(headers['content-security-policy'], localCsp);
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['cache-control'], 'no-store');
  assert.equal(headers['access-control-allow-origin'], '*');

  const injected = injectProjectWebPreviewRuntime(
    '<!doctype html><html><head><title>Preview</title></head><body></body></html>',
  );
  assert.ok(injected.indexOf(PROJECT_WEB_PREVIEW_RUNTIME_PATH) < injected.indexOf('<title>'));
  assert.equal(
    injectProjectWebPreviewRuntime(injected).match(/data-kodax-preview-runtime/g)?.length,
    1,
  );
});

test('local-only preview loads authored display dependencies without opening data connections', () => {
  const sources = inferProjectWebPreviewSources(`
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
    <script type="module" src="https://scripts.example.com/app.js"></script>
    <img src="https://images.example.com/hero.png">
    <style>@import url('https://theme.example.com/base.css')</style>
  `);
  assert.deepEqual(sources, {
    script: ['https://scripts.example.com'],
    style: ['https://fonts.googleapis.com', 'https://theme.example.com'],
    img: ['https://images.example.com'],
    font: ['https://fonts.gstatic.com'],
    media: [],
  });

  const csp = projectWebPreviewCsp(false, sources);
  assert.match(csp, /script-src[^;]*https:\/\/scripts\.example\.com/);
  assert.match(csp, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(csp, /style-src[^;]*https:\/\/theme\.example\.com/);
  assert.match(csp, /font-src[^;]*https:\/\/fonts\.gstatic\.com/);
  assert.match(csp, /img-src[^;]*https:\/\/images\.example\.com/);
  assert.match(csp, /connect-src 'self'/);
  assert.doesNotMatch(csp, /connect-src[^;]*https:/);
});
