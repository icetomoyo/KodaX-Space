import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createScopedRuntimeCredentialBroker } from '../providers/runtime-credential-broker.js';

test('scoped Runtime credential broker applies shared lease, Session, Provider, and policy fences', async () => {
  const reads: string[] = [];
  const leaseBinding: { leaseId?: string } = { leaseId: 'lease-1' };
  const broker = createScopedRuntimeCredentialBroker({
    leaseBinding,
    providers: ['anthropic'],
    sessionId: 'session-1',
    authorize: (request) => request.purpose === 'compaction',
    readCredential: async (provider) => {
      reads.push(provider);
      return 'secret';
    },
  });
  const request = {
    requestId: 'request-1',
    leaseId: 'lease-1',
    provider: 'anthropic',
    sessionId: 'session-1',
    purpose: 'compaction' as const,
    target: {
      kind: 'operation' as const,
      operationId: 'operation-1',
      operation: 'session.compact' as const,
    },
  };

  assert.equal(await broker(request), 'secret');
  assert.equal(await broker({ ...request, leaseId: 'other' }), undefined);
  assert.equal(await broker({ ...request, sessionId: 'other' }), undefined);
  assert.equal(await broker({ ...request, provider: 'openai' }), undefined);
  assert.equal(await broker({ ...request, purpose: 'sidecar' }), undefined);
  assert.deepEqual(reads, ['anthropic']);
});
