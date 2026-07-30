import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import type { ConversationMessage } from '../../renderer/src/features/session/composeMessages.js';
import { patchComposedStreamTail } from '../../renderer/src/shell/conversationStreamIncremental.js';

test('cumulative live text patches only the open tail and preserves historical row identity', () => {
  const historical: ConversationMessage = {
    kind: 'assistant_text',
    id: 'history',
    text: 'stable history',
    thinking: 'large retained thinking',
    completed: true,
  };
  const live: ConversationMessage = {
    kind: 'assistant_text',
    id: 'live',
    text: 'hel',
  };
  const previousEvents: SessionEvent[] = [
    {
      kind: 'text_delta',
      sessionId: 's_1',
      text: 'hel',
      runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 3 },
    },
  ];
  const nextEvents: SessionEvent[] = [
    {
      ...previousEvents[0]!,
      kind: 'text_delta',
      text: 'hello',
      runtimeEvent: { runtimeId: 'rt_1', runId: 'run_1', seq: 5 },
    },
  ];

  const patched = patchComposedStreamTail(previousEvents, [historical, live], nextEvents);

  assert.ok(patched);
  assert.equal(patched[0], historical);
  assert.notEqual(patched[1], live);
  assert.equal(patched[1]?.kind === 'assistant_text' ? patched[1].text : undefined, 'hello');
});

test('cumulative thinking patches the existing assistant row without rescanning history', () => {
  const live: ConversationMessage = {
    kind: 'assistant_text',
    id: 'live',
    text: '',
    thinking: 'abc',
  };
  const previousEvents: SessionEvent[] = [
    { kind: 'thinking_delta', sessionId: 's_1', text: 'abc' },
  ];
  const nextEvents: SessionEvent[] = [{ kind: 'thinking_delta', sessionId: 's_1', text: 'abcdef' }];

  const patched = patchComposedStreamTail(previousEvents, [live], nextEvents);

  assert.equal(patched?.[0]?.kind === 'assistant_text' ? patched[0].thinking : undefined, 'abcdef');
});

test('non-tail or structural changes fall back to the canonical full composer', () => {
  const first: SessionEvent = { kind: 'text_delta', sessionId: 's_1', text: 'a' };
  const changedFirst: SessionEvent = { kind: 'text_delta', sessionId: 's_1', text: 'A' };
  const last: SessionEvent = { kind: 'text_delta', sessionId: 's_1', text: 'b' };
  const nextLast: SessionEvent = { kind: 'text_delta', sessionId: 's_1', text: 'bc' };
  const messages: ConversationMessage[] = [{ kind: 'assistant_text', id: 'live', text: 'ab' }];

  assert.equal(
    patchComposedStreamTail([first, last], messages, [changedFirst, nextLast]),
    undefined,
  );
  assert.equal(
    patchComposedStreamTail([last], messages, [{ kind: 'session_complete', sessionId: 's_1' }]),
    undefined,
  );
});
