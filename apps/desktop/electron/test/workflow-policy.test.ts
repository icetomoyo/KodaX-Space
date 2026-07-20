// F064 — WorkflowPolicyStore: 默认 / normalize+clamp（硬上限）/ 持久化往返。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkflowPolicyStore,
  normalizeWorkflowPolicy,
  buildWorkflowHostPolicy,
  DEFAULT_WORKFLOW_POLICY,
} from '../kodax/workflow-policy.js';

function freshFile(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wf-policy-'));
  return { dir, file: join(dir, 'workflow-policy.json') };
}

test('default policy: conservative caps', () => {
  assert.ok(DEFAULT_WORKFLOW_POLICY.maxAgents <= 64);
  assert.ok(DEFAULT_WORKFLOW_POLICY.maxConcurrency <= 16);
  assert.equal(DEFAULT_WORKFLOW_POLICY.tokenBudget, 0); // 0 = 不限（默认不施加 token cap，对齐 KodaX）
});

test('buildWorkflowHostPolicy forwards tokenBudget unconditionally (0 = unlimited, KodaX 0.7.59)', () => {
  // Single-sourced host policy used by BOTH launch paths (AMA run_workflow in real-session.ts
  // + explicit /workflow in workflow-controller.ts). 0.7.59 treats 0/null/negative as unbounded,
  // so an explicit 0 must be FORWARDED (present), not omitted (the pre-0.7.59 workaround).
  const hp = buildWorkflowHostPolicy(DEFAULT_WORKFLOW_POLICY);
  assert.ok(
    Object.prototype.hasOwnProperty.call(hp, 'tokenBudget'),
    'tokenBudget 0 must be present, not omitted (regression guard for the old omit-when-0 workaround)',
  );
  assert.deepEqual(hp, { maxAgents: 16, maxConcurrency: 8, tokenBudget: 0 });
  // An explicit user cap is forwarded verbatim too.
  assert.equal(
    buildWorkflowHostPolicy({ maxAgents: 4, maxConcurrency: 2, tokenBudget: 50_000 }).tokenBudget,
    50_000,
  );
});

test('normalize clamps caps to hard ceiling and ignores removed autoStart', () => {
  const p = normalizeWorkflowPolicy({
    autoStart: 'bogus' as never,
    maxAgents: 9999,
    maxConcurrency: 9999,
    tokenBudget: 9_999_999,
  } as never);
  assert.equal('autoStart' in p, false);
  assert.equal(p.maxAgents, 64);
  assert.equal(p.maxConcurrency, 16);
  // An explicit user cap is preserved (only clamped at the very high hard ceiling);
  // the default remains 0 = unlimited.
  assert.equal(p.tokenBudget, 9_999_999);
});

test('normalize floors caps at >=1 and ignores non-numeric', () => {
  const p = normalizeWorkflowPolicy({
    maxAgents: 0,
    maxConcurrency: -5,
    tokenBudget: 'x' as never,
  });
  assert.equal(p.maxAgents, 1);
  assert.equal(p.maxConcurrency, 1);
  assert.equal(p.tokenBudget, DEFAULT_WORKFLOW_POLICY.tokenBudget); // 非数字 → 默认
});

test('get returns defaults before load; set persists clamped value', async () => {
  const { dir, file } = freshFile();
  try {
    const store = new WorkflowPolicyStore(file);
    assert.deepEqual(store.get(), DEFAULT_WORKFLOW_POLICY); // 未 load
    const next = await store.set({ autoStart: 'on', maxAgents: 999 } as never);
    assert.equal('autoStart' in next, false);
    assert.equal(next.maxAgents, 64); // clamped
    await store.flush();

    // 新实例同文件 → 读回持久化值
    const store2 = new WorkflowPolicyStore(file);
    const loaded = await store2.load();
    assert.equal('autoStart' in loaded, false);
    assert.equal(loaded.maxAgents, 64);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration: pre-v2 file drops the stale token cap to unlimited, keeps other caps', async () => {
  const { dir, file } = freshFile();
  try {
    // Upgraded install: old file with the pre-v2 fixed token cap (old default 100k)
    // and no schemaVersion, plus a user-chosen concurrency.
    writeFileSync(file, JSON.stringify({ maxAgents: 32, maxConcurrency: 4, tokenBudget: 100_000 }));
    const store = new WorkflowPolicyStore(file);
    const loaded = await store.load();
    assert.equal(loaded.tokenBudget, 0); // stale cap dropped → unlimited (v2 fix reaches upgraders)
    assert.equal(loaded.maxConcurrency, 4); // user's other choices preserved
    assert.equal(loaded.maxAgents, 32);
    await store.flush();

    // Re-persisted with the current schema version → migration runs once, and an
    // intentional new-model cap now survives reload.
    const store2 = new WorkflowPolicyStore(file);
    assert.equal((await store2.load()).tokenBudget, 0);
    await store2.set({ tokenBudget: 50_000 });
    await store2.flush();
    const store3 = new WorkflowPolicyStore(file);
    assert.equal((await store3.load()).tokenBudget, 50_000); // survives — no re-migration
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('set merges partial patch onto current (other fields unchanged)', async () => {
  const { dir, file } = freshFile();
  try {
    const store = new WorkflowPolicyStore(file);
    await store.set({ maxConcurrency: 4 });
    const after = await store.set({ autoStart: 'off' } as never);
    assert.equal('autoStart' in after, false);
    assert.equal(after.maxConcurrency, 4); // 保留上次的
    await store.flush();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
