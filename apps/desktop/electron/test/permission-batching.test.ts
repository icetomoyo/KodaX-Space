// KX-I-05 selectPermissionBatch unit tests — pure function, no React deps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PermissionRequestPayload, PermissionRisk } from '@kodax-space/space-ipc-schema';
import { selectPermissionBatch } from '../../renderer/src/features/permission/permissionBatching.js';

function makeReq(
  reqId: string,
  sessionId: string,
  risk: PermissionRisk,
): PermissionRequestPayload {
  return {
    reqId,
    sessionId,
    risk,
    reason: `mock-${reqId}`,
    toolCall: { toolName: 'mock', input: {} },
    // suggestedPattern / askedBefore / askedTimes 等可选字段省略
  } as PermissionRequestPayload;
}

test('empty queue → single mode with head=null', () => {
  const result = selectPermissionBatch([]);
  assert.deepEqual(result, { mode: 'single', head: null });
});

test('single item → single mode with that head', () => {
  const items = [makeReq('r1', 'sess-A', 'low')];
  const result = selectPermissionBatch(items);
  assert.equal(result.mode, 'single');
  if (result.mode === 'single') {
    assert.equal(result.head?.reqId, 'r1');
  }
});

test('head is danger → always single, never batched', () => {
  const items = [
    makeReq('r1', 'sess-A', 'danger'),
    makeReq('r2', 'sess-A', 'low'),
    makeReq('r3', 'sess-A', 'low'),
  ];
  const result = selectPermissionBatch(items);
  assert.equal(result.mode, 'single');
  if (result.mode === 'single') {
    assert.equal(result.head?.reqId, 'r1');
  }
});

test('two same-session non-danger → batch of 2', () => {
  const items = [
    makeReq('r1', 'sess-A', 'low'),
    makeReq('r2', 'sess-A', 'medium'),
  ];
  const result = selectPermissionBatch(items);
  assert.equal(result.mode, 'batch');
  if (result.mode === 'batch') {
    assert.equal(result.items.length, 2);
    assert.equal(result.sessionId, 'sess-A');
    assert.deepEqual(
      result.items.map((i) => i.reqId),
      ['r1', 'r2'],
    );
  }
});

test('three same-session non-danger → batch of 3', () => {
  const items = [
    makeReq('r1', 'sess-A', 'low'),
    makeReq('r2', 'sess-A', 'low'),
    makeReq('r3', 'sess-A', 'low'),
  ];
  const result = selectPermissionBatch(items);
  assert.equal(result.mode, 'batch');
  if (result.mode === 'batch') {
    assert.equal(result.items.length, 3);
  }
});

test('danger in middle of run → batch stops at it', () => {
  const items = [
    makeReq('r1', 'sess-A', 'low'),
    makeReq('r2', 'sess-A', 'low'),
    makeReq('r3', 'sess-A', 'danger'),
    makeReq('r4', 'sess-A', 'low'),
  ];
  const result = selectPermissionBatch(items);
  assert.equal(result.mode, 'batch');
  if (result.mode === 'batch') {
    assert.equal(result.items.length, 2);
    assert.deepEqual(
      result.items.map((i) => i.reqId),
      ['r1', 'r2'],
    );
  }
});

test('different sessionId → batch stops at switch', () => {
  const items = [
    makeReq('r1', 'sess-A', 'low'),
    makeReq('r2', 'sess-A', 'low'),
    makeReq('r3', 'sess-B', 'low'),
  ];
  const result = selectPermissionBatch(items);
  assert.equal(result.mode, 'batch');
  if (result.mode === 'batch') {
    assert.equal(result.items.length, 2);
    assert.equal(result.sessionId, 'sess-A');
  }
});

test('first two same-session, third danger same-session → batch of first 2', () => {
  const items = [
    makeReq('r1', 'sess-A', 'high'),
    makeReq('r2', 'sess-A', 'high'),
    makeReq('r3', 'sess-A', 'danger'),
  ];
  const result = selectPermissionBatch(items);
  assert.equal(result.mode, 'batch');
  if (result.mode === 'batch') {
    assert.equal(result.items.length, 2);
  }
});

test('only one non-danger of session-A followed by session-B → single mode (not enough to batch)', () => {
  const items = [
    makeReq('r1', 'sess-A', 'low'),
    makeReq('r2', 'sess-B', 'low'),
  ];
  const result = selectPermissionBatch(items);
  assert.equal(result.mode, 'single');
  if (result.mode === 'single') {
    assert.equal(result.head?.reqId, 'r1');
  }
});

test('high risk batches fine — only danger blocks batching', () => {
  const items = [
    makeReq('r1', 'sess-A', 'high'),
    makeReq('r2', 'sess-A', 'high'),
  ];
  const result = selectPermissionBatch(items);
  assert.equal(result.mode, 'batch');
});

test('Auto[LLM] diagnostics keep the head request individually reviewable', () => {
  const head = {
    ...makeReq('r1', 'sess-A', 'low'),
    autoModeDiagnostics: {
      source: 'classifier_confirm' as const,
      classifierAttempts: [{ attempt: 1, outcome: 'confirm' as const }],
    },
  };
  const result = selectPermissionBatch([head, makeReq('r2', 'sess-A', 'low')]);
  assert.equal(result.mode, 'single');
  if (result.mode === 'single') assert.equal(result.head?.reqId, 'r1');
});

test('Auto[LLM] diagnostics stop a later request from being hidden in a batch', () => {
  const diagnosticRequest = {
    ...makeReq('r2', 'sess-A', 'low'),
    autoModeDiagnostics: { source: 'classifier_failure' as const },
  };
  const result = selectPermissionBatch([
    makeReq('r1', 'sess-A', 'low'),
    diagnosticRequest,
    makeReq('r3', 'sess-A', 'low'),
  ]);
  assert.equal(result.mode, 'single');
  if (result.mode === 'single') assert.equal(result.head?.reqId, 'r1');
});
