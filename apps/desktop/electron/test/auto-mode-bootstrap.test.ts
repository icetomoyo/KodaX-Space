import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootstrapAutoMode } from '../kodax/auto-mode-bootstrap.js';

let tmpProject: string;

before(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'space-auto-mode-bootstrap-'));
});

after(() => {
  fs.rmSync(tmpProject, { recursive: true, force: true });
});

function bootstrap(projectRoot = tmpProject) {
  return bootstrapAutoMode({
    projectRoot,
    getCurrentProviderName: () => 'mock',
    getCurrentModel: () => 'mock-model',
  });
}

test('bootstrapAutoMode exposes the fixed Auto[LLM] guardrail', async () => {
  const result = await bootstrap();
  assert.equal(typeof result.getGuardrail, 'function');
  assert.ok(result.getGuardrail());
});

test('getGuardrail returns the same SDK-owned guardrail instance', async () => {
  const result = await bootstrap();
  assert.strictEqual(result.getGuardrail(), result.getGuardrail());
});

test('relative project roots are accepted', async () => {
  const result = await bootstrap('.');
  assert.ok(result.getGuardrail());
});
