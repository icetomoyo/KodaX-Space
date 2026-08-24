import assert from 'node:assert/strict';
import test from 'node:test';

import { invokeChannels } from '@kodax-space/space-ipc-schema';
import { buildComposerSessionSendPayload } from '../../renderer/src/shell/composerInvoke.js';

test('explicit Skill execution preserves one authoritative raw session.send input', () => {
  const payload = buildComposerSessionSendPayload({
    sessionId: 'session-skill',
    rawPrompt: '/skill:code-review "src/a b.ts"  --strict',
    queueMode: 'interrupt',
    expectedProjectRoot: 'C:\\repo',
    expectedSurface: 'code',
    partnerPromptOverlay: 'trusted Partner context',
    attachmentPaths: [{ kind: 'file', path: 'C:\\repo\\src\\a b.ts' }],
    artifacts: [
      {
        kind: 'image',
        path: 'C:\\profile\\attachments\\screen.png',
        mediaType: 'image/png',
        source: 'clipboard',
      },
    ],
  });

  assert.deepEqual(payload, {
    sessionId: 'session-skill',
    prompt: '/skill:code-review "src/a b.ts"  --strict',
    queueMode: 'interrupt',
    expectedProjectRoot: 'C:\\repo',
    expectedSurface: 'code',
    partnerPromptOverlay: 'trusted Partner context',
    attachmentPaths: [{ kind: 'file', path: 'C:\\repo\\src\\a b.ts' }],
    artifacts: [
      {
        kind: 'image',
        path: 'C:\\profile\\attachments\\screen.png',
        mediaType: 'image/png',
        source: 'clipboard',
      },
    ],
  });
  assert.equal(invokeChannels['session.send'].input.safeParse(payload).success, true);
  assert.equal('skillInvocation' in payload, false);
});

test('session.send exposes factual pre-admission Skill rejection reasons', () => {
  const output = invokeChannels['session.send'].output;
  for (const reason of [
    'skill_requires_idle',
    'skill_not_found',
    'skill_multiple_references',
    'skill_fork_unsupported',
    'skill_blocked',
    'skill_preparation_failed',
  ] as const) {
    assert.equal(
      output.safeParse({ accepted: false, reason, queueMode: 'interrupt' }).success,
      true,
      reason,
    );
  }
});
