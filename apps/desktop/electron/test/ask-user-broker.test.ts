// AskUserBroker tests — FEATURE_032
//
// 覆盖：
//   1. request → resolve('allow') 返回 verdict
//   2. request → resolve('block') 返回 verdict
//   3. unknown reqId → resolve 返回 false
//   4. timeout 自动 block + 推 askUser.cancelled
//   5. cancelSession deny + 推 cancelled (多 session 并发隔离)
//   6. cancelAll 兜底
//   7. push payload 形状 (sanitize 后字段、signals 透传)

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { askUserBroker } from '../permission/ask-user-broker.js';
import { setRendererTarget } from '../ipc/push.js';

interface Captured { channel: string; payload: unknown }
const captured: Captured[] = [];

// Broker 的 setTimeout 在生产里 unref()——避免悬挂 timer 阻止 app 退出。
// 在 node:test 里如果没有别的 active handle，loop 会直接退出，timer 永不触发，
// 测试报 'Promise resolution is still pending but the event loop has already resolved'。
// 用非 unref 的 interval 兜底 keep-alive。
let keepalive: NodeJS.Timeout | null = null;

beforeEach(() => {
  captured.length = 0;
  setRendererTarget(() => ({
    send: (channel: string, payload: unknown) => captured.push({ channel, payload }),
    isDestroyed: () => false,
  }) as unknown as Electron.WebContents);
  keepalive = setInterval(() => {}, 1000);
});

afterEach(() => {
  askUserBroker.cancelAll('shutdown');
  setRendererTarget(() => null);
  if (keepalive) { clearInterval(keepalive); keepalive = null; }
});

function lastRequest(): { reqId: string; sessionId: string } {
  const evt = captured.find((c) => c.channel === 'askUser.request');
  assert.ok(evt, 'expected at least one askUser.request push');
  const payload = evt.payload as { reqId: string; sessionId: string };
  return { reqId: payload.reqId, sessionId: payload.sessionId };
}

test('request → resolve("allow") returns verdict', async () => {
  const pending = askUserBroker.request({
    sessionId: 's1',
    reason: 'guardrail escalated',
    toolCall: { toolId: 't1', toolName: 'edit', input: { path: 'foo.ts' } },
  });
  await new Promise((r) => setImmediate(r));
  const { reqId } = lastRequest();
  assert.equal(askUserBroker.resolve(reqId, 'allow'), true);
  const result = await pending;
  assert.equal(result, 'allow');
});

test('request → resolve("block") returns verdict', async () => {
  const pending = askUserBroker.request({
    sessionId: 's2',
    reason: 'classifier denial threshold reached',
    toolCall: { toolId: 't2', toolName: 'bash' },
  });
  await new Promise((r) => setImmediate(r));
  const { reqId } = lastRequest();
  assert.equal(askUserBroker.resolve(reqId, 'block'), true);
  const result = await pending;
  assert.equal(result, 'block');
});

test('unknown reqId in resolve returns false', () => {
  assert.equal(askUserBroker.resolve('00000000-0000-0000-0000-000000000000', 'allow'), false);
});

test('timeout fires "block" + pushes cancelled', async () => {
  const pending = askUserBroker.request({
    sessionId: 's_timeout',
    reason: 'will timeout',
    toolCall: { toolId: 't_to', toolName: 'edit' },
    timeoutMs: 300, // 300ms — CI runner scheduling jitter 经常 >100ms,30ms 偶尔被 kill
  });
  const result = await pending;
  assert.equal(result, 'block', 'timeout must auto-block');
  const cancelled = captured.find(
    (c) => c.channel === 'askUser.cancelled'
      && (c.payload as { reason: string }).reason === 'timeout',
  );
  assert.ok(cancelled, 'must push cancelled with reason=timeout');
});

test('cancelSession blocks all pending for that session + pushes cancelled', async () => {
  const p1 = askUserBroker.request({
    sessionId: 's_a',
    reason: 'A1',
    toolCall: { toolId: 'tA1', toolName: 'edit' },
  });
  const p2 = askUserBroker.request({
    sessionId: 's_a',
    reason: 'A2',
    toolCall: { toolId: 'tA2', toolName: 'write' },
  });
  const p3 = askUserBroker.request({
    sessionId: 's_b',
    reason: 'B1',
    toolCall: { toolId: 'tB1', toolName: 'bash' },
  });
  await new Promise((r) => setImmediate(r));
  // 取消 session 'a'，期望 p1/p2 立即 block；p3 (session 'b') 不受影响
  askUserBroker.cancelSession('s_a', 'session_cancelled');
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, 'block');
  assert.equal(r2, 'block');
  // p3 仍 pending
  const sBCancelled = captured.filter(
    (c) => c.channel === 'askUser.cancelled'
      && (c.payload as { sessionId: string }).sessionId === 's_b',
  );
  assert.equal(sBCancelled.length, 0, 's_b should not have been cancelled');
  // 清理 p3 让测试不挂
  askUserBroker.cancelSession('s_b', 'session_cancelled');
  await p3;
});

test('cancelAll blocks all pending (shutdown)', async () => {
  const p1 = askUserBroker.request({
    sessionId: 's_x',
    reason: 'X',
    toolCall: { toolId: 'tx', toolName: 'edit' },
  });
  const p2 = askUserBroker.request({
    sessionId: 's_y',
    reason: 'Y',
    toolCall: { toolId: 'ty', toolName: 'write' },
  });
  await new Promise((r) => setImmediate(r));
  askUserBroker.cancelAll('shutdown');
  assert.equal(await p1, 'block');
  assert.equal(await p2, 'block');
  const shutdownEvents = captured.filter(
    (c) => c.channel === 'askUser.cancelled'
      && (c.payload as { reason: string }).reason === 'shutdown',
  );
  assert.equal(shutdownEvents.length, 2, 'both should get shutdown cancelled push');
});

test('push payload contains reason / toolCall / signals when provided', async () => {
  const pending = askUserBroker.request({
    sessionId: 's_signals',
    reason: 'why',
    toolCall: { toolId: 'ts', toolName: 'bash', input: { command: 'echo' } },
    signals: [
      { type: 'protected-path', severity: 'warning', message: 'targets ~/.kodax' },
      { type: 'outside-cwd', severity: 'info', message: 'writes to /tmp' },
    ],
  });
  await new Promise((r) => setImmediate(r));
  const evt = captured.find((c) => c.channel === 'askUser.request');
  assert.ok(evt);
  const payload = evt!.payload as {
    reason: string;
    toolCall: { toolName: string; input?: Record<string, unknown> };
    signals?: Array<{ type: string; severity: string; message: string }>;
  };
  assert.equal(payload.reason, 'why');
  assert.equal(payload.toolCall.toolName, 'bash');
  assert.ok(payload.signals);
  assert.equal(payload.signals!.length, 2);
  assert.equal(payload.signals![0].type, 'protected-path');

  // 清理
  askUserBroker.resolve((evt!.payload as { reqId: string }).reqId, 'block');
  await pending;
});

test('guardrail push projects Auto[LLM] diagnostics without raw classifier content', async () => {
  const pending = askUserBroker.request({
    sessionId: 's_diagnostics',
    reason: 'classifier requested confirmation',
    toolCall: { toolId: 't_diag', toolName: 'bash', input: { command: 'npm test' } },
    autoModeDiagnostics: {
      source: 'classifier_confirm',
      classifierAttempts: [
        {
          attempt: 1,
          outcome: 'confirm',
          observedProtocol: 'structured_v2',
          outputWarnings: ['missing_hazard', 'unknown_future_warning'],
          rawResponse: '<decision>ask</decision>',
          diagnostics: {
            provider: 'api_key=TOP_SECRET',
            model: 'fast\u202emodel',
            timeoutMs: 12_000,
            elapsedMs: 90,
            promptBytes: 512,
            retryCount: 0,
            retryWaitMs: 0,
            terminalPhase: 'completed',
            rawResponse: 'never forward',
          },
        },
      ],
      rawResponse: 'never forward',
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const evt = captured.find((candidate) => candidate.channel === 'askUser.request');
  assert.ok(evt);
  const payload = evt.payload as {
    reqId: string;
    autoModeDiagnostics?: unknown;
  };
  assert.deepEqual(payload.autoModeDiagnostics, {
    source: 'classifier_confirm',
    classifierAttempts: [
      {
        attempt: 1,
        outcome: 'confirm',
        observedProtocol: 'structured_v2',
        outputWarnings: ['missing_hazard'],
        diagnostics: {
          provider: 'api_key=[REDACTED]',
          model: 'fastmodel',
          timeoutMs: 12_000,
          elapsedMs: 90,
          promptBytes: 512,
          retryCount: 0,
          retryWaitMs: 0,
          terminalPhase: 'completed',
        },
      },
    ],
  });
  assert.equal(JSON.stringify(payload).includes('<decision>'), false);
  assert.equal(askUserBroker.resolve(payload.reqId, 'block'), true);
  await pending;
});

test('C8: guardrail signals[] are clamped to the push schema max (20)', async () => {
  // >20 signals would fail the askUser.request zod validation on push → the prompt never reaches
  // the renderer and silently times out. The broker must clamp so the push always validates.
  const pending = askUserBroker.request({
    sessionId: 's_signals_clamp',
    reason: 'many signals',
    toolCall: { toolId: 't', toolName: 'bash', input: { command: 'echo' } },
    signals: Array.from({ length: 25 }, (_, i) => ({
      type: `sig-${i}`,
      severity: 'info' as const,
      message: `signal ${i}`,
    })),
  });
  await new Promise((r) => setImmediate(r));
  const evt = captured.find((c) => c.channel === 'askUser.request');
  assert.ok(evt, 'expected a guardrail push');
  const signals = (evt!.payload as { signals?: unknown[] }).signals ?? [];
  assert.ok(signals.length <= 20, `signals must be clamped to <=20, got ${signals.length}`);
  askUserBroker.resolve((evt!.payload as { reqId: string }).reqId, 'block');
  await pending;
});

test('C8: select options[] are clamped to the push schema max (20)', async () => {
  const pending = askUserBroker.requestQuestion({
    sessionId: 's_options_clamp',
    kind: 'select',
    question: 'pick one',
    options: Array.from({ length: 25 }, (_, i) => ({ label: `opt ${i}`, value: `v${i}` })),
  });
  await new Promise((r) => setImmediate(r));
  const evt = captured.find((c) => c.channel === 'askUser.request');
  assert.ok(evt, 'expected a question push');
  const options = (evt!.payload as { options?: unknown[] }).options ?? [];
  assert.ok(options.length <= 20, `options must be clamped to <=20, got ${options.length}`);
  askUserBroker.cancelAll('shutdown');
  await pending;
});

test('pendingCount reflects in-flight requests', async () => {
  // 测试前状态可能有残留——先 cancelAll 清空
  askUserBroker.cancelAll('shutdown');
  await new Promise((r) => setImmediate(r));
  const baseline = askUserBroker.pendingCount();

  const p1 = askUserBroker.request({
    sessionId: 's_pc',
    reason: 'r',
    toolCall: { toolId: 't1', toolName: 'edit' },
  });
  assert.equal(askUserBroker.pendingCount(), baseline + 1);

  await new Promise((r) => setImmediate(r));
  const reqId = (captured.find((c) => c.channel === 'askUser.request')!.payload as { reqId: string }).reqId;
  askUserBroker.resolve(reqId, 'allow');
  await p1;
  assert.equal(askUserBroker.pendingCount(), baseline);
});

test('requestQuestion select resolves renderer value', async () => {
  const pending = askUserBroker.requestQuestion({
    sessionId: 's_question',
    kind: 'select',
    question: 'Pick one',
    options: [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ],
    multiSelect: true,
    minSelections: 1,
    maxSelections: 2,
    allowCustomInput: true,
    customInputLabel: 'Other',
    customInputPrompt: 'Type another answer',
    customInputDefault: 'draft',
  });
  await new Promise((r) => setImmediate(r));
  const evt = captured.find((c) => c.channel === 'askUser.request');
  assert.ok(evt);
  const payload = evt.payload as {
    reqId: string;
    kind: string;
    question: string;
    options?: unknown[];
    multiSelect?: boolean;
    minSelections?: number;
    maxSelections?: number;
    allowCustomInput?: boolean;
    customInputLabel?: string;
    customInputPrompt?: string;
    customInputDefault?: string;
  };
  assert.equal(payload.kind, 'select');
  assert.equal(payload.question, 'Pick one');
  assert.equal(payload.options?.length, 2);
  assert.equal(payload.multiSelect, true);
  assert.equal(payload.minSelections, 1);
  assert.equal(payload.maxSelections, 2);
  assert.equal(payload.allowCustomInput, true);
  assert.equal(payload.customInputLabel, 'Other');
  assert.equal(payload.customInputPrompt, 'Type another answer');
  assert.equal(payload.customInputDefault, 'draft');

  assert.equal(askUserBroker.resolve(payload.reqId, { reqId: payload.reqId, value: 'b' }), true);
  assert.equal(await pending, 'b');
});

test('requestQuestion resolves custom input answer object', async () => {
  const pending = askUserBroker.requestQuestion({
    sessionId: 's_question_custom',
    kind: 'select',
    question: 'Pick one',
    options: [{ label: 'A', value: 'a' }],
  });
  await new Promise((r) => setImmediate(r));
  const evt = captured.find((c) => c.channel === 'askUser.request');
  assert.ok(evt);
  const payload = evt.payload as { reqId: string };
  const customAnswer = { kind: 'customInput' as const, value: 'another answer' };

  assert.equal(
    askUserBroker.resolve(payload.reqId, { reqId: payload.reqId, value: customAnswer }),
    true,
  );
  assert.deepEqual(await pending, customAnswer);
});

test('requestQuestion multi-select resolves renderer array value', async () => {
  const pending = askUserBroker.requestQuestion({
    sessionId: 's_question_multi',
    kind: 'select',
    question: 'Pick up to two',
    options: [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
      { label: 'C', value: 'c' },
    ],
    multiSelect: true,
  });
  await new Promise((r) => setImmediate(r));
  const evt = captured.find((c) => c.channel === 'askUser.request');
  assert.ok(evt);
  const payload = evt.payload as { reqId: string };

  assert.equal(
    askUserBroker.resolve(payload.reqId, { reqId: payload.reqId, value: ['a', 'c'] }),
    true,
  );
  assert.deepEqual(await pending, ['a', 'c']);
});

test('requestQuestion drops inverted max selection bound before push validation', async () => {
  const pending = askUserBroker.requestQuestion({
    sessionId: 's_question_bounds',
    kind: 'select',
    question: 'Pick many',
    options: [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ],
    multiSelect: true,
    minSelections: 2,
    maxSelections: 1,
  });
  await new Promise((r) => setImmediate(r));
  const evt = captured.find((c) => c.channel === 'askUser.request');
  assert.ok(evt);
  const payload = evt.payload as { reqId: string; minSelections?: number; maxSelections?: number };
  assert.equal(payload.minSelections, 2);
  assert.equal(payload.maxSelections, undefined);

  assert.equal(askUserBroker.resolve(payload.reqId, { reqId: payload.reqId, value: ['a', 'b'] }), true);
  assert.deepEqual(await pending, ['a', 'b']);
});

test('requestQuestion select without options cancels without pending push', async () => {
  const before = askUserBroker.pendingCount();
  const result = await askUserBroker.requestQuestion({
    sessionId: 's_empty_select',
    kind: 'select',
    question: 'Pick one',
  });

  assert.equal(result, undefined);
  assert.equal(askUserBroker.pendingCount(), before);
  assert.equal(captured.some((c) => c.channel === 'askUser.request'), false);
});

test('requestQuestion input resolves undefined when cancelled', async () => {
  const pending = askUserBroker.requestQuestion({
    sessionId: 's_input_cancel',
    kind: 'input',
    question: 'Type something',
  });
  await new Promise((r) => setImmediate(r));
  askUserBroker.cancelSession('s_input_cancel', 'session_cancelled');
  assert.equal(await pending, undefined);
});

test('requestQuestion remains pending past the former timeout until the user answers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = askUserBroker.requestQuestion({
    sessionId: 's_question_timeout',
    kind: 'input',
    question: 'wait for an explicit answer',
  });
  const { reqId } = lastRequest();
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  t.mock.timers.tick(60_001);
  await Promise.resolve();

  assert.equal(settled, false);
  assert.equal(
    captured.some(
      (event) =>
        event.channel === 'askUser.cancelled' &&
        (event.payload as { reason: string }).reason === 'timeout',
    ),
    false,
  );

  assert.equal(
    askUserBroker.resolve(reqId, { reqId, value: 'explicit answer' }),
    true,
  );
  assert.equal(await pending, 'explicit answer');
});
