import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionEventChannel } from '@kodax-space/space-ipc-schema';

test('session.event accepts SDK mid-turn user prompt boundaries', () => {
  assert.equal(
    sessionEventChannel.payload.safeParse({
      kind: 'mid_turn_user_prompt',
      sessionId: 's_1',
      queueId: 'input_1',
      content: 'Please also check the tests.',
    }).success,
    true,
  );
});

test('session.event preserves the Runtime causal barrier on user prompt boundaries', () => {
  for (const payload of [
    {
      kind: 'mid_turn_user_prompt' as const,
      sessionId: 's_1',
      queueId: 'input_1',
      content: 'Interrupt the active run.',
      runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 12 },
    },
    {
      kind: 'queued_user_prompt_started' as const,
      sessionId: 's_1',
      queueId: 'run_2',
      queueMode: 'after-turn' as const,
      content: 'Continue after the current run.',
      runtimeEvent: { runtimeId: 'rt_1', runId: 'run_2', seq: 13 },
    },
  ]) {
    const parsed = sessionEventChannel.payload.safeParse(payload);
    assert.equal(parsed.success, true);
    if (
      parsed.success &&
      (parsed.data.kind === 'mid_turn_user_prompt' ||
        parsed.data.kind === 'queued_user_prompt_started')
    ) {
      assert.deepEqual(parsed.data.runtimeEvent, payload.runtimeEvent);
    }
  }
});

test('session.event accepts queued user prompt started boundaries', () => {
  assert.equal(
    sessionEventChannel.payload.safeParse({
      kind: 'queued_user_prompt_started',
      sessionId: 's_1',
      queueId: 'run_queued_1',
      queueMode: 'after-turn',
      content: 'Please run this after the current turn.',
    }).success,
    true,
  );
});

test('session.event accepts queued interrupt failure boundaries', () => {
  assert.equal(
    sessionEventChannel.payload.safeParse({
      kind: 'queued_user_prompt_failed',
      sessionId: 's_1',
      queueId: 'input_1',
      queueMode: 'interrupt',
      content: 'Please run this before the current turn ends.',
      reason: 'run_completed',
    }).success,
    true,
  );
});

test('session.event accepts SDK 0.7.53 sidecar verifier messages', () => {
  assert.equal(
    sessionEventChannel.payload.safeParse({
      kind: 'sidecar_message',
      sessionId: 's_1',
      message: {
        source: 'sidecar-verifier',
        verdict: 'revise',
        recipient: 'main-agent',
        delivery: 'synthetic-user-message',
        content: 'Please verify the edited file before finishing.',
        suggestedFix: 'Run the relevant test.',
      },
    }).success,
    true,
  );

  assert.equal(
    sessionEventChannel.payload.safeParse({
      kind: 'sidecar_message',
      sessionId: 's_1',
      message: {
        source: 'sidecar-verifier',
        verdict: 'accept',
        recipient: 'main-agent',
        delivery: 'synthetic-user-message',
        content: 'accept verdicts should stay silent',
      },
    }).success,
    false,
  );
});

test('session.event accepts SDK 0.7.53 todo drift warnings', () => {
  assert.equal(
    sessionEventChannel.payload.safeParse({
      kind: 'todo_drift_warning',
      sessionId: 's_1',
      warning: {
        kind: 'work_started_without_claimed_todo',
        toolName: 'write',
        toolCallId: 'tool_1',
        count: 1,
        pendingCount: 2,
        openCount: 2,
        firstPendingTodoId: 'todo_1',
        firstPendingTodoSubject: 'Update tests',
      },
    }).success,
    true,
  );
});
