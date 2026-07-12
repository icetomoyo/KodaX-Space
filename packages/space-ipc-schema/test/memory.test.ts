import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INVOKE_CHANNEL_NAMES,
  invokeChannels,
  memoryActionProposalSchema,
  memoryApproveChannel,
  memoryListChannel,
  memoryReadRefChannel,
  memoryRejectChannel,
} from '../src/index.js';

const ref = {
  kind: 'memdir' as const,
  id: 'memdir:MEMORY.md',
  scope: 'project' as const,
  title: 'MEMORY.md',
  owner: 'project' as const,
  lifecycle: 'active' as const,
  authority: 'approved_write' as const,
  visibility: 'prompt_safe' as const,
  sourceRefs: [],
  relatedRefs: [],
  bodyFingerprint: 'sha256:abc',
  storageUri: 'C:/project/.kodax/memory/MEMORY.md',
};

const proposal = {
  id: 'memory:mem-probe-1',
  action: 'write_memdir' as const,
  targetRefs: [ref],
  sourceRefs: [
    {
      ...ref,
      kind: 'learning_proposal' as const,
      id: 'learning_proposal:mem-probe-1',
      authority: 'proposal_only' as const,
    },
  ],
  expectedFingerprints: { 'memdir:MEMORY.md': 'missing' },
  rationale: 'F224 classified this as project memory.',
  risk: 'medium' as const,
  preview: {
    summary: 'Write project memory from learning proposal mem-probe-1.',
    changedRefs: [ref],
    changedPaths: ['C:/project/.kodax/memory/MEMORY.md'],
    beforeFingerprints: { 'memdir:MEMORY.md': 'missing' },
    afterFingerprints: { 'memdir:MEMORY.md': 'sha256:def' },
    diff: '---\nname: test\n---\nbody\n',
    warnings: [],
  },
  requiresApproval: true as const,
  createdAt: '2026-07-07T01:02:03.000Z',
};

test('memory invoke channels are registered', () => {
  for (const name of [
    'memory.list',
    'memory.proposal',
    'memory.approve',
    'memory.reject',
    'memory.readRef',
    'memory.curate',
    'memory.pack',
  ]) {
    assert.ok(invokeChannels[name as keyof typeof invokeChannels], `${name} should be registered`);
    assert.ok(INVOKE_CHANNEL_NAMES.has(name), `${name} should be in invoke set`);
  }
});

test('memory action proposal schema accepts 0.7.62 proposal shape', () => {
  assert.equal(memoryActionProposalSchema.safeParse(proposal).success, true);
});

test('memory.list input and output accept inbox and refs', () => {
  assert.equal(
    memoryListChannel.input.safeParse({ sessionId: 's_1', query: 'typecheck' }).success,
    true,
  );
  assert.equal(
    memoryListChannel.output.safeParse({ inbox: [proposal], refs: [ref], warnings: [] }).success,
    true,
  );
});

test('memory schemas accept 0.7.68 workspace/agent scopes and episode review trigger', () => {
  for (const scope of ['workspace', 'agent'] as const) {
    assert.equal(
      memoryListChannel.output.safeParse({
        inbox: [],
        refs: [{ ...ref, scope }],
        warnings: [],
      }).success,
      true,
    );
  }

  assert.equal(
    memoryRejectChannel.output.safeParse({
      result: {
        proposalId: 'memory:episode-1',
        rejected: true,
        review: {
          trigger: 'episode_completed',
          createdAt: '2026-07-12T12:00:00.000Z',
          sourceRefs: [],
          candidateRefs: [],
          actions: [],
          warnings: [],
        },
        warnings: [],
      },
    }).success,
    true,
  );
});

test('memory.approve output models blocked non-throwing approval', () => {
  const parsed = memoryApproveChannel.output.safeParse({
    result: {
      proposalId: 'memory:mem-probe-1',
      applied: false,
      changedRefs: [],
      changedPaths: [],
      skippedReason: 'approval fingerprints do not cover proposal preview',
      warnings: [],
    },
  });
  assert.equal(parsed.success, true);
});

test('memory.readRef body is capped by schema', () => {
  const ok = memoryReadRefChannel.output.safeParse({
    snapshot: {
      ref,
      body: 'hello',
      bodyFingerprint: 'sha256:abc',
      readAt: '2026-07-07T01:02:03.000Z',
      warnings: [],
    },
  });
  assert.equal(ok.success, true);

  const bad = memoryReadRefChannel.output.safeParse({
    snapshot: {
      ref,
      body: 'x'.repeat(256 * 1024 + 1),
      bodyFingerprint: 'sha256:abc',
      readAt: '2026-07-07T01:02:03.000Z',
      warnings: [],
    },
  });
  assert.equal(bad.success, false);
});
