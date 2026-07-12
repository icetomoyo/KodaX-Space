import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RendererActionBroker } from '../space-control/renderer-broker.js';
import { SpaceControlService } from '../space-control/service.js';
import type { PushPayload, SpaceControlResultT } from '@kodax-space/space-ipc-schema';

function harness() {
  let lastRequest: PushPayload<'spaceControl.requested'> | null = null;
  const broker = new RendererActionBroker({
    requestId: () => '11111111-1111-4111-8111-111111111111',
    timeoutMs: 1000,
    push: (request) => {
      lastRequest = request;
      queueMicrotask(() => {
        const current = request.operation === 'inspect' ? 'light' : request.args!.value;
        broker.resolve({
          requestId: request.requestId,
          actionId: request.actionId,
          status: request.operation === 'inspect' ? 'available' : 'applied',
          revision: request.operation === 'inspect' ? 4 : 5,
          rendererInstanceId: '33333333-3333-4333-8333-333333333333',
          safeState: current,
          summaryKey:
            request.operation === 'inspect' ? 'spaceControl.available' : 'spaceControl.applied',
        });
      });
    },
  });
  let now = 1000;
  const service = new SpaceControlService({
    broker,
    now: () => now,
    token: () => 'precondition-token',
    tokenTtlMs: 1000,
  });
  return { service, broker, lastRequest: () => lastRequest, advance: (ms: number) => (now += ms) };
}

const codeContext = {
  sessionId: 's-1',
  surface: 'code' as const,
  projectRoot: '/workspace',
  toolCallId: 'tool-apply',
  taskSurface: 'repl' as const,
};

test('space control inspect issues an argument-bound precondition', async () => {
  const { service } = harness();
  const inspected = (await service.inspect(
    { actionId: 'ui.theme.set', args: { value: 'dark' } },
    codeContext,
  )) as { actions: Array<Record<string, unknown>> };

  assert.equal(inspected.actions.length, 1);
  assert.equal(inspected.actions[0].available, true);
  assert.equal(inspected.actions[0].revision, 4);
  assert.equal(inspected.actions[0].preconditionToken, 'precondition-token');
});

test('space control apply validates precondition and exact retry is idempotent', async () => {
  const { service } = harness();
  await service.inspect({ actionId: 'ui.theme.set', args: { value: 'dark' } }, codeContext);
  const input = {
    actionId: 'ui.theme.set' as const,
    args: { value: 'dark' },
    expectedRevision: 4,
    preconditionToken: 'precondition-token',
  };
  const first = await service.apply(input, codeContext);
  const retry = await service.apply(input, codeContext);
  assert.deepEqual(first, {
    actionId: 'ui.theme.set',
    status: 'applied',
    revision: 5,
    safeState: 'dark',
    summaryKey: 'spaceControl.applied',
  });
  assert.deepEqual(retry, first);
  assert.equal(
    (
      await service.apply(
        { ...input, expectedRevision: 5, preconditionToken: 'different-token-value' },
        codeContext,
      )
    ).reasonCode,
    'tool-call-reused',
  );
});

test('space control apply denies stale, mismatched, plan-mode, and missing tool-call contexts', async () => {
  const { service, advance } = harness();
  await service.inspect({ actionId: 'ui.theme.set', args: { value: 'dark' } }, codeContext);
  advance(1001);
  assert.equal(
    (
      await service.apply(
        {
          actionId: 'ui.theme.set',
          args: { value: 'dark' },
          expectedRevision: 4,
          preconditionToken: 'precondition-token',
        },
        codeContext,
      )
    ).reasonCode,
    'invalid-precondition',
  );

  const planContext = {
    ...codeContext,
    toolCallId: 'tool-plan',
    taskSurface: 'repl' as const,
    permissionMode: 'plan' as const,
  };
  const planInspection = (await service.inspect(
    { actionId: 'settings.reasoningMode.setDefault', args: { value: 'deep' } },
    planContext,
  )) as { actions: Array<Record<string, unknown>> };
  assert.equal(planInspection.actions[0].available, false);
  assert.equal(planInspection.actions[0].reasonCode, 'plan-mode-denied');
  assert.equal(planInspection.actions[0].preconditionToken, undefined);
  assert.equal(
    (
      await service.apply(
        {
          actionId: 'settings.reasoningMode.setDefault',
          args: { value: 'deep' },
          expectedRevision: 4,
          preconditionToken: 'precondition-token',
        },
        planContext,
      )
    ).reasonCode,
    'plan-mode-denied',
  );

  assert.equal(
    (
      await service.apply(
        {
          actionId: 'ui.theme.set',
          args: { value: 'dark' },
          expectedRevision: 0,
          preconditionToken: 'missing',
        },
        { ...codeContext, toolCallId: undefined },
      )
    ).reasonCode,
    'missing-tool-call-id',
  );
});

test('renderer broker rejects mismatched and late results and returns truthful timeout', async () => {
  let pushed: PushPayload<'spaceControl.requested'> | null = null;
  const broker = new RendererActionBroker({
    timeoutMs: 20,
    requestId: () => '22222222-2222-4222-8222-222222222222',
    push: (request) => {
      pushed = request;
    },
  });
  const pending = broker.inspect('ui.theme.set');
  const mismatched: SpaceControlResultT = {
    requestId: '22222222-2222-4222-8222-222222222222',
    actionId: 'ui.language.set',
    status: 'available',
    revision: 0,
    rendererInstanceId: '33333333-3333-4333-8333-333333333333',
    summaryKey: 'spaceControl.available',
  };
  assert.equal(broker.resolve(mismatched), false);
  const result = await pending;
  assert.equal(result.status, 'unknown');
  assert.equal(result.reasonCode, 'renderer-timeout');
  assert.ok(pushed);
  assert.equal(broker.resolve({ ...mismatched, actionId: 'ui.theme.set' }), false);
});

test('renderer instance-change denial is idempotent after consuming a precondition', async () => {
  let applyRequests = 0;
  const broker = new RendererActionBroker({
    requestId: () => '44444444-4444-4444-8444-444444444444',
    timeoutMs: 1000,
    push: (request) => {
      if (request.operation === 'apply') applyRequests += 1;
      queueMicrotask(() => {
        broker.resolve({
          requestId: request.requestId,
          actionId: request.actionId,
          status: request.operation === 'inspect' ? 'available' : 'denied',
          revision: 2,
          rendererInstanceId:
            request.operation === 'inspect'
              ? '55555555-5555-4555-8555-555555555555'
              : '66666666-6666-4666-8666-666666666666',
          safeState: 'light',
          summaryKey:
            request.operation === 'inspect' ? 'spaceControl.available' : 'spaceControl.denied',
          ...(request.operation === 'apply' ? { reasonCode: 'renderer-instance-changed' } : {}),
        });
      });
    },
  });
  const service = new SpaceControlService({
    broker,
    token: () => 'instance-bound-token',
  });
  await service.inspect({ actionId: 'ui.theme.set', args: { value: 'dark' } }, codeContext);
  const input = {
    actionId: 'ui.theme.set' as const,
    args: { value: 'dark' },
    expectedRevision: 2,
    preconditionToken: 'instance-bound-token',
  };

  const first = await service.apply(input, codeContext);
  const retry = await service.apply(input, codeContext);
  assert.equal(first.reasonCode, 'renderer-instance-changed');
  assert.deepEqual(retry, first);
  assert.equal(applyRequests, 1);
});

test('renderer dispatch failures return a stable failed receipt', async () => {
  let failApply = false;
  const broker = new RendererActionBroker({
    requestId: () => '77777777-7777-4777-8777-777777777777',
    timeoutMs: 1000,
    push: (request) => {
      if (request.operation === 'apply' && failApply) throw new Error('renderer unavailable');
      queueMicrotask(() => {
        broker.resolve({
          requestId: request.requestId,
          actionId: request.actionId,
          status: 'available',
          revision: 3,
          rendererInstanceId: '88888888-8888-4888-8888-888888888888',
          safeState: 'light',
          summaryKey: 'spaceControl.available',
        });
      });
    },
  });
  const service = new SpaceControlService({ broker, token: () => 'dispatch-failure-token' });
  await service.inspect({ actionId: 'ui.theme.set', args: { value: 'dark' } }, codeContext);
  failApply = true;
  const input = {
    actionId: 'ui.theme.set' as const,
    args: { value: 'dark' },
    expectedRevision: 3,
    preconditionToken: 'dispatch-failure-token',
  };

  const first = await service.apply(input, codeContext);
  assert.deepEqual(first, {
    actionId: 'ui.theme.set',
    status: 'failed',
    revision: 3,
    summaryKey: 'spaceControl.failed',
    reasonCode: 'renderer-unavailable',
  });
  assert.deepEqual(await service.apply(input, codeContext), first);
});
