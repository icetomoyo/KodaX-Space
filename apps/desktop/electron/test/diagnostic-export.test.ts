import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { buildDiagnosticBundle } from '../diagnostics/export.js';

test('diagnostic export produces a bounded redacted manifest and reviewed categories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kodax-diagnostic-export-'));
  const logs = path.join(root, 'diagnostics');
  await mkdir(logs, { recursive: true });
  await writeFile(
    path.join(logs, 'space-main.jsonl'),
    `${JSON.stringify({ level: 'error', message: 'Bearer export-secret', prompt: 'private' })}\n`,
  );
  await writeFile(path.join(logs, 'ignore.txt'), 'must not export');

  const bundle = await buildDiagnosticBundle({
    logDirectory: logs,
    spaceVersion: '0.1.31',
    sdkVersion: '0.7.67',
    platform: 'win32',
    categories: ['manifest', 'logs', 'capabilities', 'release', 'degradations'],
    capabilities: { runtime: 'supported', apiKey: 'export-secret' },
    release: { channel: 'dev', updater: 'idle' },
    degradations: [{ code: 'worker-unavailable', detail: 'Bearer export-secret' }],
    secretValues: ['export-secret'],
    now: () => new Date('2026-07-12T00:00:00.000Z'),
  });

  assert.ok(bundle.byteLength > 0);
  assert.ok(bundle.byteLength < 2 * 1024 * 1024);
  const zip = await JSZip.loadAsync(bundle);
  assert.deepEqual(Object.keys(zip.files).sort(), [
    'capabilities.json',
    'known-degradations.json',
    'logs/',
    'logs/space-main.jsonl',
    'manifest.json',
    'release.json',
  ]);
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as Record<
    string,
    unknown
  >;
  assert.equal(manifest.spaceVersion, '0.1.31');
  assert.equal(manifest.generatedAt, '2026-07-12T00:00:00.000Z');
  const allText = await Promise.all(
    Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.async('string')),
  );
  assert.doesNotMatch(allText.join('\n'), /export-secret|private|must not export/);
});

test('diagnostic export includes only selected categories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kodax-diagnostic-export-selected-'));
  const bundle = await buildDiagnosticBundle({
    logDirectory: root,
    spaceVersion: '0.1.31',
    sdkVersion: '0.7.67',
    platform: 'linux',
    categories: ['manifest', 'release'],
    release: { channel: 'stable' },
  });
  const zip = await JSZip.loadAsync(bundle);
  assert.deepEqual(Object.keys(zip.files).sort(), ['manifest.json', 'release.json']);
});

test('diagnostic export prioritizes current logs and caps sanitized output bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kodax-diagnostic-export-bounded-'));
  const current = Array.from({ length: 80 }, (_, index) =>
    JSON.stringify({
      event: `current-${index}`,
      promptText: 'private prompt',
      safe: '\\'.repeat(40),
    }),
  ).join('\n');
  const rotated = Array.from({ length: 80 }, (_, index) =>
    JSON.stringify({ event: `rotated-${index}`, safe: 'x'.repeat(80) }),
  ).join('\n');
  await writeFile(path.join(root, 'space-main.jsonl'), `${current}\n`);
  await writeFile(path.join(root, 'space-main.1.jsonl'), `${rotated}\n`);

  const bundle = await buildDiagnosticBundle({
    logDirectory: root,
    spaceVersion: '0.1.31',
    sdkVersion: '0.7.67',
    platform: 'win32',
    categories: ['manifest', 'logs'],
    maxLogFileBytes: 1024,
    maxTotalLogBytes: 1024,
  });
  const zip = await JSZip.loadAsync(bundle);
  assert.ok(zip.file('logs/space-main.jsonl'));
  const logEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && entry.name.startsWith('logs/'),
  );
  const contents = await Promise.all(logEntries.map((entry) => entry.async('nodebuffer')));
  assert.ok(contents.reduce((total, entry) => total + entry.byteLength, 0) <= 1024);
  assert.doesNotMatch(Buffer.concat(contents).toString('utf8'), /private prompt/);
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as {
    notices: string[];
  };
  assert.ok(manifest.notices.some((notice) => notice.startsWith('log-truncated:space-main')));
});
