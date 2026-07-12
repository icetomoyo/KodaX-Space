import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StructuredLogger } from '../diagnostics/logger.js';
import { isDiagnosticFileSinkEnabled } from '../diagnostics/runtime.js';

test('diagnostic file-sink rollback gate is explicit and defaults on', () => {
  assert.equal(isDiagnosticFileSinkEnabled({}), true);
  assert.equal(isDiagnosticFileSinkEnabled({ SPACE_DISABLE_DIAGNOSTIC_FILE_SINK: '0' }), true);
  assert.equal(isDiagnosticFileSinkEnabled({ SPACE_DISABLE_DIAGNOSTIC_FILE_SINK: '1' }), false);
});

test('structured logger writes deterministic redacted JSONL records', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kodax-logger-'));
  const logger = new StructuredLogger({
    directory: dir,
    version: '0.1.31',
    sdkVersion: '0.7.67',
    platform: 'test',
    secretValues: ['fixture-secret'],
  });
  logger.info('runtime', 'run.started', 'Bearer fixture-secret', {
    sessionId: 's-1',
    prompt: 'do not persist me',
  });
  await logger.flush();

  const content = await readFile(path.join(dir, 'space-main.jsonl'), 'utf8');
  const record = JSON.parse(content.trim()) as Record<string, unknown>;
  assert.equal(record.level, 'info');
  assert.equal(record.component, 'runtime');
  assert.equal(record.event, 'run.started');
  assert.equal(record.version, '0.1.31');
  assert.equal(record.sdkVersion, '0.7.67');
  assert.equal(record.message, 'Bearer [REDACTED]');
  assert.deepEqual(record.data, { sessionId: 's-1', prompt: '[CONTENT_REDACTED]' });
  assert.doesNotMatch(content, /fixture-secret|do not persist me/);
});

test('structured logger rotates by size and enforces retention', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kodax-logger-rotate-'));
  const logger = new StructuredLogger({
    directory: dir,
    version: '0.1.31',
    sdkVersion: '0.7.67',
    platform: 'test',
    maxFileBytes: 420,
    retentionFiles: 2,
  });

  for (let index = 0; index < 12; index += 1) {
    logger.info('test', 'rotation.fixture', `record-${index}-${'x'.repeat(80)}`);
  }
  await logger.flush();

  const files = (await readdir(dir)).filter((file) => file.startsWith('space-main'));
  assert.deepEqual(files.sort(), ['space-main.1.jsonl', 'space-main.2.jsonl', 'space-main.jsonl']);
  for (const file of files) {
    const content = await readFile(path.join(dir, file), 'utf8');
    assert.ok(content.length > 0);
  }
});

test('structured logger bounds individual records and survives non-serializable data', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kodax-logger-bound-'));
  const logger = new StructuredLogger({
    directory: dir,
    version: '0.1.31',
    sdkVersion: '0.7.67',
    platform: 'test',
    maxRecordBytes: 1024,
  });
  const circular: Record<string, unknown> = { fn: () => undefined };
  circular.self = circular;
  logger.error('test', 'bounded.fixture', 'x'.repeat(10_000), circular);
  await logger.flush();

  const content = await readFile(path.join(dir, 'space-main.jsonl'));
  assert.ok(content.byteLength <= 1025);
  assert.doesNotThrow(() => JSON.parse(content.toString('utf8').trim()));
});

test('structured logger refreshes secrets injected after initialization', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kodax-logger-refresh-'));
  const logger = new StructuredLogger({
    directory: dir,
    version: '0.1.31',
    sdkVersion: '0.7.67',
    platform: 'test',
  });
  logger.updateRedactionOptions({ secretValues: ['late-provider-secret'] });
  logger.info('provider', 'late-secret', 'loaded late-provider-secret');
  await logger.flush();

  const content = await readFile(path.join(dir, 'space-main.jsonl'), 'utf8');
  assert.doesNotMatch(content, /late-provider-secret/);
  assert.match(content, /loaded \[REDACTED\]/);
});
