import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAskUserInteractionKey } from '../../renderer/src/features/ask-user/ask-user-state.js';

test('semantically identical question projections keep the same interaction key', () => {
  const first = {
    requestId: 'req_1',
    kind: 'select' as const,
    multiQuestionIndex: 0,
    question: {
      question: 'Choose a direction',
      default: 'a',
      options: [
        { label: 'A', value: 'a', description: 'First direction' },
        { label: 'B', value: 'b', description: 'Second direction' },
      ],
    },
  };
  const refreshedProjection = JSON.parse(JSON.stringify(first)) as typeof first;

  assert.equal(buildAskUserInteractionKey(first), buildAskUserInteractionKey(refreshedProjection));
  assert.notEqual(
    buildAskUserInteractionKey(first),
    buildAskUserInteractionKey({
      ...refreshedProjection,
      question: {
        ...refreshedProjection.question,
        options: [{ label: 'C', value: 'c' }],
      },
    }),
  );
});
