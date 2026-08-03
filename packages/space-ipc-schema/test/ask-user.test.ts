// Schema tests for askUser.* channels — FEATURE_032.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  invokeChannels,
  pushChannels,
  INVOKE_CHANNEL_NAMES,
  PUSH_CHANNEL_NAMES,
  askUserRequestChannel,
  askUserReplyChannel,
  askUserCancelledChannel,
} from '../src/index.js';

test('askUser channels registered in invoke/push maps', () => {
  assert.ok(invokeChannels['askUser.reply']);
  assert.ok(INVOKE_CHANNEL_NAMES.has('askUser.reply'));
  assert.ok(pushChannels['askUser.request']);
  assert.ok(pushChannels['askUser.cancelled']);
  assert.ok(PUSH_CHANNEL_NAMES.has('askUser.request'));
  assert.ok(PUSH_CHANNEL_NAMES.has('askUser.cancelled'));
});

test('askUser.request payload accepts minimal valid shape', () => {
  const result = askUserRequestChannel.payload.safeParse({
    reqId: 'req-1',
    sessionId: 's_1',
    reason: 'classifier escalated',
    toolCall: { toolId: 't_1', toolName: 'edit' },
  });
  assert.equal(result.success, true);
});

test('askUser.request payload accepts signals array', () => {
  const result = askUserRequestChannel.payload.safeParse({
    reqId: 'req-2',
    sessionId: 's_1',
    reason: 'why',
    toolCall: { toolId: 't_1', toolName: 'bash', input: { command: 'ls' } },
    signals: [
      { type: 'protected-path', severity: 'warning', message: 'targets ~/.kodax' },
      { type: 'safe-read', severity: 'info', message: 'read-only' },
    ],
  });
  assert.equal(result.success, true);
});

test('askUser.request carries bounded Auto[LLM] diagnostics for guardrail prompts', () => {
  const result = askUserRequestChannel.payload.safeParse({
    kind: 'guardrail',
    reqId: 'req-diagnostics',
    sessionId: 's_1',
    reason: 'LLM requested confirmation',
    toolCall: { toolId: 't_1', toolName: 'bash', input: { command: 'npm test' } },
    autoModeDiagnostics: {
      source: 'classifier_confirm',
      classifierAttempts: [
        {
          attempt: 1,
          outcome: 'confirm',
          observedProtocol: 'structured_v2',
          outputWarnings: ['missing_hazard', 'missing_reason'],
        },
      ],
    },
  });
  assert.equal(result.success, true);
});

test('askUser.request rejects unknown or overflowing Auto[LLM] warning codes', () => {
  const base = {
    kind: 'guardrail',
    reqId: 'req-diagnostics-invalid',
    sessionId: 's_1',
    reason: 'LLM requested confirmation',
    toolCall: { toolId: 't_1', toolName: 'bash' },
  } as const;
  assert.equal(
    askUserRequestChannel.payload.safeParse({
      ...base,
      autoModeDiagnostics: {
        source: 'classifier_confirm',
        classifierAttempts: [
          { attempt: 1, outcome: 'confirm', outputWarnings: ['raw_model_output'] },
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    askUserRequestChannel.payload.safeParse({
      ...base,
      autoModeDiagnostics: {
        source: 'classifier_confirm',
        classifierAttempts: [
          {
            attempt: 1,
            outcome: 'confirm',
            outputWarnings: Array.from({ length: 17 }, () => 'missing_hazard'),
          },
        ],
      },
    }).success,
    false,
  );
});

test('askUser.request payload rejects signals over 20 (DoS guard)', () => {
  const signals = Array.from({ length: 21 }).map((_, i) => ({
    type: `t${i}`,
    severity: 'info' as const,
    message: 'm',
  }));
  const result = askUserRequestChannel.payload.safeParse({
    reqId: 'req-3',
    sessionId: 's_1',
    reason: 'why',
    toolCall: { toolId: 't_1', toolName: 'edit' },
    signals,
  });
  assert.equal(result.success, false);
});

test('askUser.request payload rejects unknown severity', () => {
  const result = askUserRequestChannel.payload.safeParse({
    reqId: 'req-4',
    sessionId: 's_1',
    reason: 'why',
    toolCall: { toolId: 't_1', toolName: 'edit' },
    signals: [{ type: 't', severity: 'critical', message: 'm' }],
  });
  assert.equal(result.success, false);
});

test('askUser.reply input accepts allow/block; rejects other verdicts', () => {
  for (const verdict of ['allow', 'block'] as const) {
    const r = askUserReplyChannel.input.safeParse({ reqId: 'r', verdict });
    assert.equal(r.success, true, `accept ${verdict}`);
  }
  for (const verdict of ['yes', 'no', 'deny', '']) {
    const r = askUserReplyChannel.input.safeParse({ reqId: 'r', verdict });
    assert.equal(r.success, false, `reject ${verdict}`);
  }
});

test('askUser.cancelled payload accepts all 4 reason enum values', () => {
  for (const reason of ['session_cancelled', 'session_disposed', 'shutdown', 'timeout'] as const) {
    const r = askUserCancelledChannel.payload.safeParse({
      reqId: 'r',
      sessionId: 's',
      reason,
    });
    assert.equal(r.success, true, `reason=${reason}`);
  }
});

test('askUser.request payload rejects oversized reason (2KB+)', () => {
  const reason = 'x'.repeat(2049);
  const result = askUserRequestChannel.payload.safeParse({
    reqId: 'req',
    sessionId: 's',
    reason,
    toolCall: { toolId: 't', toolName: 'edit' },
  });
  assert.equal(result.success, false);
});

test('askUser.request payload accepts select and input question shapes', () => {
  const selectResult = askUserRequestChannel.payload.safeParse({
    kind: 'select',
    reqId: 'req-select',
    sessionId: 's_1',
    question: 'Pick one',
    options: [
      { label: 'A', value: 'a' },
      { label: 'B', description: 'second', value: 'b' },
    ],
    multiSelect: true,
    minSelections: 1,
    maxSelections: 2,
    allowCustomInput: true,
    customInputLabel: 'Other',
    customInputPrompt: 'Type another answer',
    customInputDefault: 'custom',
  });
  assert.equal(selectResult.success, true);

  const inputResult = askUserRequestChannel.payload.safeParse({
    kind: 'input',
    reqId: 'req-input',
    sessionId: 's_1',
    question: 'Type value',
    default: 'hello',
  });
  assert.equal(inputResult.success, true);
});

test('askUser.request payload rejects select questions without options', () => {
  const result = askUserRequestChannel.payload.safeParse({
    kind: 'select',
    reqId: 'req-select-empty',
    sessionId: 's_1',
    question: 'Pick one',
  });
  assert.equal(result.success, false);
});

test('askUser.request payload rejects invalid selection bounds', () => {
  const result = askUserRequestChannel.payload.safeParse({
    kind: 'select',
    reqId: 'req-select-bounds',
    sessionId: 's_1',
    question: 'Pick one',
    options: [{ label: 'A', value: 'a' }],
    multiSelect: true,
    minSelections: 2,
    maxSelections: 1,
  });
  assert.equal(result.success, false);
});

test('askUser.reply input accepts value and cancelled replies', () => {
  assert.equal(askUserReplyChannel.input.safeParse({ reqId: 'r', value: 'answer' }).success, true);
  assert.equal(askUserReplyChannel.input.safeParse({ reqId: 'r', value: ['a', 'b'] }).success, true);
  assert.equal(
    askUserReplyChannel.input.safeParse({
      reqId: 'r',
      value: { kind: 'customInput', value: 'something else' },
    }).success,
    true,
  );
  assert.equal(
    askUserReplyChannel.input.safeParse({
      reqId: 'r',
      value: ['a', { kind: 'customInput', value: 'something else' }],
    }).success,
    true,
  );
  assert.equal(askUserReplyChannel.input.safeParse({ reqId: 'r', cancelled: true }).success, true);
  assert.equal(askUserReplyChannel.input.safeParse({ reqId: 'r', cancelled: false }).success, false);
});

test('askUser channels carry one bounded multi-question request and record answer', () => {
  assert.equal(
    askUserRequestChannel.payload.safeParse({
      kind: 'multi',
      reqId: 'req-multi',
      sessionId: 's_1',
      questions: [
        {
          question: 'Choose an implementation',
          header: 'Implementation',
          options: [{ label: 'Safe', value: 'safe' }],
        },
        {
          question: 'Choose checks',
          options: [{ label: 'Unit tests', value: 'unit' }],
          multiSelect: true,
        },
      ],
    }).success,
    true,
  );
  assert.equal(
    askUserReplyChannel.input.safeParse({
      reqId: 'req-multi',
      value: {
        'Choose an implementation': 'safe',
        'Choose checks': ['unit'],
      },
    }).success,
    true,
  );
});
