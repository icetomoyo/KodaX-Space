import assert from 'node:assert/strict';
import test from 'node:test';

import { countAttentionSessions } from './appBadgeModel.js';

test('attention badge counts unique unread and action-required Sessions', () => {
  assert.equal(
    countAttentionSessions({
      sessionFlags: {
        read: { unread: false },
        unread: { unread: true },
        overlap: { unread: true },
      },
      permissionRequests: [{ sessionId: 'permission' }, { sessionId: 'overlap' }],
      askUserRequests: [{ sessionId: 'question' }, { sessionId: 'overlap' }],
    }),
    4,
  );
});

test('attention badge ignores unrelated flags and repeated requests in one Session', () => {
  assert.equal(
    countAttentionSessions({
      sessionFlags: {
        pinned: { pinned: true },
        archived: { archived: true },
      },
      permissionRequests: [{ sessionId: 'same' }, { sessionId: 'same' }],
      askUserRequests: [{ sessionId: 'same' }],
    }),
    1,
  );
});
