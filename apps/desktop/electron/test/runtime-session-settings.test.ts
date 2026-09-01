import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionMeta, SpaceSessionLiveProjectionT } from '@kodax-space/space-ipc-schema';
import { mergeRuntimeSettingsIntoSessions } from '../../renderer/src/store/runtimeSessionSettings.js';

const session: SessionMeta = {
  sessionId: 's_code',
  projectRoot: 'C:\\repo',
  provider: 'anthropic',
  reasoningMode: 'quick',
  permissionMode: 'accept-edits',
  agentMode: 'sa',
  surface: 'code',
  createdAt: 1,
  lastActivityAt: 1,
  model: 'old-model',
};

function projection(
  value: NonNullable<SpaceSessionLiveProjectionT['settings']>['value'],
): SpaceSessionLiveProjectionT {
  return {
    sessionId: 's_code',
    projectionRevision: 1,
    cursor: { runtimeId: 'rt', seq: 1 },
    transcriptRevision: 'rev-1',
    queuedRuns: [],
    activeTools: [],
    todos: [],
    queuedInputs: [],
    interactions: [],
    settings: { revision: 2, value },
  };
}

test('renderer converges all Space-visible shared daemon settings', () => {
  const [updated] = mergeRuntimeSettingsIntoSessions(
    [session],
    projection({
      provider: 'openai',
      model: 'gpt-next',
      reasoningMode: 'deep',
      permissionMode: 'plan',
      agentMode: 'ama',
    }),
  );

  assert.deepEqual(updated, {
    ...session,
    provider: 'openai',
    model: 'gpt-next',
    reasoningMode: 'max',
    permissionMode: 'plan',
    agentMode: 'ama',
  });
});

test('renderer maps daemon effort-only updates without erasing the effective model', () => {
  const [updated] = mergeRuntimeSettingsIntoSessions([session], projection({ effort: 'high' }));
  assert.equal(updated?.reasoningMode, 'high');
  assert.equal(updated?.model, 'old-model');
});

test('renderer keeps daemon xhigh and max effort updates distinct', () => {
  const [xhigh] = mergeRuntimeSettingsIntoSessions([session], projection({ effort: 'xhigh' }));
  const [max] = mergeRuntimeSettingsIntoSessions([session], projection({ effort: 'max' }));
  assert.equal(xhigh?.reasoningMode, 'xhigh');
  assert.equal(max?.reasoningMode, 'max');
});

test('renderer drops the previous provider model when a daemon provider change omits model', () => {
  const [updated] = mergeRuntimeSettingsIntoSessions([session], projection({ provider: 'openai' }));
  assert.equal(updated?.provider, 'openai');
  assert.equal(updated?.model, undefined);
});

test('renderer never applies Coder daemon settings to Partner sessions', () => {
  const partner = { ...session, surface: 'partner' as const };
  const result = mergeRuntimeSettingsIntoSessions([partner], projection({ provider: 'openai' }));
  assert.equal(result[0], partner);
});
