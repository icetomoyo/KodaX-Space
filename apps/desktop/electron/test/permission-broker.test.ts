// PermissionBroker tests — FEATURE_007
//
// 验收要点：
//   - request() 推 permission.request；resolve() 让等待的 Promise 兑现
//   - cancelSession 让对应 pending 自动 deny + 推 permission.cancelled
//   - 超时自动 deny（用很短的 timeoutMs 验证）
//   - 多 session 并发请求不串：cancel session A 不影响 session B 的 pending

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { permissionBroker } from '../permission/broker.js';
import { setRendererTarget } from '../ipc/push.js';
import { permissionRegistry } from '../permission/registry.js';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
  // 清空已加载的 registry 缓存——避免上次跑测试残留的 rules 让 matches() 短路弹窗。
  // PermissionRegistry 单例在 main 端 import 时构造；测试里不能 new，只能用反射清缓存。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (permissionRegistry as any).cached = [];
  keepalive = setInterval(() => {}, 1000);
});

afterEach(() => {
  setRendererTarget(() => null);
  if (keepalive) { clearInterval(keepalive); keepalive = null; }
});

function lastRequest(): { reqId: string; sessionId: string } {
  const evt = captured.find((c) => c.channel === 'permission.request');
  assert.ok(evt, 'expected at least one permission.request push');
  const payload = evt.payload as { reqId: string; sessionId: string };
  return { reqId: payload.reqId, sessionId: payload.sessionId };
}

test('request → resolve(allow_once) returns decision', async () => {
  // 用中性 tool 名 — 'read' 现在被 broker 视作 READONLY_TOOLS 直接 short-circuit allow，
  // 不会推 permission.request；要验证 ask-and-wait 流程必须用非 edit / 非 readonly 的工具名
  const pending = permissionBroker.request({
    sessionId: 's1',
    toolId: 't1',
    toolName: 'unknown_tool',
    input: { path: 'a' },
  });
  // 让 push 落到 captured
  await new Promise((r) => setImmediate(r));
  const { reqId } = lastRequest();
  assert.equal(permissionBroker.resolve(reqId, 'allow_once'), true);
  const result = await pending;
  assert.equal(result.decision, 'allow_once');
});

test('request danger tool: includes risk=danger in pushed payload', async () => {
  const pending = permissionBroker.request({
    sessionId: 's1',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'rm -rf /' },
  });
  await new Promise((r) => setImmediate(r));
  const evt = captured.find((c) => c.channel === 'permission.request');
  assert.ok(evt);
  const payload = evt.payload as { risk: string; suggestedPattern?: string };
  assert.equal(payload.risk, 'danger');
  // 危险工具不允许 bulk allow → suggestedPattern 应该 undefined
  assert.equal(payload.suggestedPattern, undefined);

  // 收尾：resolve 不让测试挂
  const { reqId } = lastRequest();
  permissionBroker.resolve(reqId, 'deny');
  const result = await pending;
  assert.equal(result.decision, 'deny');
});

test('cancelSession: pending request auto-resolves to deny + pushes permission.cancelled', async () => {
  const pending = permissionBroker.request({
    sessionId: 's-cancel-me',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'sleep 99' },
  });
  await new Promise((r) => setImmediate(r));

  permissionBroker.cancelSession('s-cancel-me', 'session_cancelled');
  const result = await pending;
  assert.equal(result.decision, 'deny');

  const cancelled = captured.find((c) => c.channel === 'permission.cancelled');
  assert.ok(cancelled);
  const cp = cancelled.payload as { reason: string; sessionId: string };
  assert.equal(cp.reason, 'session_cancelled');
  assert.equal(cp.sessionId, 's-cancel-me');
});

test('cancelSession of session A does not affect session B', async () => {
  const pendingA = permissionBroker.request({
    sessionId: 'sA',
    toolId: 'tA',
    toolName: 'bash',
    input: { command: 'echo a' },
  });
  const pendingB = permissionBroker.request({
    sessionId: 'sB',
    toolId: 'tB',
    toolName: 'bash',
    input: { command: 'echo b' },
  });
  await new Promise((r) => setImmediate(r));

  // 取 sB 的 reqId（permission.request push 顺序无保证，按 sessionId 找）
  const reqB = captured.find(
    (c) => c.channel === 'permission.request' && (c.payload as { sessionId: string }).sessionId === 'sB',
  );
  assert.ok(reqB);
  const reqIdB = (reqB.payload as { reqId: string }).reqId;

  permissionBroker.cancelSession('sA', 'session_cancelled');

  // pendingA 应已 deny
  const resA = await pendingA;
  assert.equal(resA.decision, 'deny');

  // pendingB 仍在等——broker 应当还能 resolve 它
  assert.equal(permissionBroker.resolve(reqIdB, 'allow_once'), true);
  const resB = await pendingB;
  assert.equal(resB.decision, 'allow_once');
});

test('timeout: auto-resolves to deny + pushes permission.cancelled(timeout)', async () => {
  const pending = permissionBroker.request({
    sessionId: 's-timeout',
    toolId: 't1',
    toolName: 'unknown_tool',
    input: { path: 'a' },
    timeoutMs: 300, // 见 ask-user-broker 同款理由 — CI 慢机 30ms 偶尔被父 kill
  });
  const result = await pending;
  assert.equal(result.decision, 'deny');

  const cancelled = captured.find(
    (c) => c.channel === 'permission.cancelled' && (c.payload as { reason: string }).reason === 'timeout',
  );
  assert.ok(cancelled);
});

test('resolve with unknown reqId returns false', () => {
  assert.equal(permissionBroker.resolve('does-not-exist', 'allow_once'), false);
});

test('allow_always: cached rule pre-empts second request (same pattern, no push)', async () => {
  // 第一次请求 → resolve allow_always 不直接写规则；我们手工把 rule 塞进 registry
  // 模拟"上次已批准并写入 ~/.kodax/permissions.json"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (permissionRegistry as any).cached = [{ pattern: 'unknown_tool', createdAt: Date.now() }];

  const pending = permissionBroker.request({
    sessionId: 's1',
    toolId: 't1',
    toolName: 'unknown_tool',
    input: { path: 'a' },
  });
  await new Promise((r) => setImmediate(r));

  // 这次不应当推任何 permission.request——直接 allow_once
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 0, 'should not push when rule already covers');

  const result = await pending;
  assert.equal(result.decision, 'allow_once');
});

// READONLY_TOOLS fast-path — accept-edits / auto 模式下 read/glob/grep 等不弹窗
test('READONLY_TOOLS fast-path: read in accept-edits short-circuits to allow_once (no prompt)', async () => {
  captured.length = 0;
  const pending = permissionBroker.request({
    sessionId: 's-readonly',
    toolId: 't1',
    toolName: 'read',
    input: { path: 'README.md' },
    mode: 'accept-edits',
  });
  const result = await pending;
  assert.equal(result.decision, 'allow_once');
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 0, 'readonly tool must not prompt under accept-edits');
});

test('READONLY_TOOLS fast-path: grep in auto-mode short-circuits to allow_once', async () => {
  captured.length = 0;
  const pending = permissionBroker.request({
    sessionId: 's-readonly-auto',
    toolId: 't1',
    toolName: 'grep',
    input: { pattern: 'foo' },
    mode: 'auto',
  });
  const result = await pending;
  assert.equal(result.decision, 'allow_once');
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 0, 'readonly tool must not prompt under auto');
});

test('auto mode: non-dangerous bash short-circuits to allow_once (guardrail F030 接管)', async () => {
  // 用户反馈：auto[LLM] 模式 bash 还弹窗 → 这是 broker 的双闸 bug。
  // auto 模式下 broker 这层放过非 dangerous，让 SDK guardrail 决策；dangerous 仍弹窗。
  captured.length = 0;
  const pending = permissionBroker.request({
    sessionId: 's-bash-auto',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'npx tsc --noEmit' },
    mode: 'auto',
  });
  const result = await pending;
  assert.equal(result.decision, 'allow_once');
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 0, 'non-dangerous bash must not prompt in auto mode');
});

test('auto mode: dangerous bash still prompts (rm -rf etc.)', async () => {
  captured.length = 0;
  const pending = permissionBroker.request({
    sessionId: 's-bash-auto-danger',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'rm -rf /tmp/whatever' },
    mode: 'auto',
  });
  await new Promise((r) => setImmediate(r));
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 1, 'dangerous bash must prompt even in auto mode');
  // 清理 pending 让测试不挂
  const reqId = (reqs[0].payload as { reqId: string }).reqId;
  permissionBroker.resolve(reqId, 'deny');
  await pending;
});

test('full-access bypasses prompts even for dangerous calls', async () => {
  captured.length = 0;
  const result = await permissionBroker.request({
    sessionId: 's-full-access',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'rm -rf /tmp/whatever' },
    mode: 'full-access',
  });
  assert.equal(result.decision, 'allow_once');
  assert.equal(captured.some((entry) => entry.channel === 'permission.request'), false);
});

test('C2-sec: broker.peek returns trustedPattern from pending entry', async () => {
  const pending = permissionBroker.request({
    sessionId: 's1',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'npm install' },
  });
  await new Promise((r) => setImmediate(r));
  const { reqId } = lastRequest();
  const meta = permissionBroker.peek(reqId);
  assert.ok(meta);
  assert.equal(meta.trustedPattern, 'bash:npm');

  permissionBroker.resolve(reqId, 'deny');
  await pending; // 收尾
});

test('C2-sec: broker.peek returns undefined trustedPattern for danger commands', async () => {
  const pending = permissionBroker.request({
    sessionId: 's1',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'rm -rf /' },
  });
  await new Promise((r) => setImmediate(r));
  const { reqId } = lastRequest();
  const meta = permissionBroker.peek(reqId);
  assert.ok(meta);
  assert.equal(meta.trustedPattern, undefined);

  permissionBroker.resolve(reqId, 'deny');
  await pending;
});

test('C2-sec: resolve with allow_always uses trustedPattern (renderer cannot influence)', async () => {
  const pending = permissionBroker.request({
    sessionId: 's1',
    toolId: 't1',
    toolName: 'custom_tool',
    input: { path: 'a' },
  });
  await new Promise((r) => setImmediate(r));
  const { reqId } = lastRequest();
  permissionBroker.resolve(reqId, 'allow_always');
  const result = await pending;
  assert.equal(result.decision, 'allow_always');
  assert.equal(result.pattern, 'custom_tool'); // 取自 broker 生成的 suggestedPattern
});

test('M2-sec: cancelAll pushes permission.cancelled for each pending', async () => {
  const p1 = permissionBroker.request({
    sessionId: 's1',
    toolId: 't1',
    toolName: 'custom_tool',
    input: { path: 'a' },
  });
  const p2 = permissionBroker.request({
    sessionId: 's2',
    toolId: 't2',
    toolName: 'custom_tool',
    input: { path: 'b' },
  });
  await new Promise((r) => setImmediate(r));
  captured.length = 0; // 清掉 .request 推送，只看 cancelled

  permissionBroker.cancelAll('shutdown');
  const r1 = await p1;
  const r2 = await p2;
  assert.equal(r1.decision, 'deny');
  assert.equal(r2.decision, 'deny');

  const cancelled = captured.filter((c) => c.channel === 'permission.cancelled');
  assert.equal(cancelled.length, 2);
  for (const c of cancelled) {
    const p = c.payload as { reason: string };
    assert.equal(p.reason, 'shutdown');
  }
});

test('H3-sec: pushed permission.request has sanitized toolName (RTL stripped)', async () => {
  // 用非 readonly / 非 edit 的中性工具名，确保 broker 走 push 路径（READONLY_TOOLS short-circuit
  // 不 push，会让 lastRequest() 找不到 evt）
  const pending = permissionBroker.request({
    sessionId: 's1',
    toolId: 't1',
    toolName: '‮foo_tool', // RTL override + 非内置名
    input: { path: 'normal.txt' },
  });
  await new Promise((r) => setImmediate(r));
  const evt = captured.find((c) => c.channel === 'permission.request');
  assert.ok(evt);
  const p = evt.payload as { toolCall: { toolName: string } };
  // RTL 必须被剥掉
  assert.equal(p.toolCall.toolName, 'foo_tool');

  const { reqId } = lastRequest();
  permissionBroker.resolve(reqId, 'deny');
  await pending;
});

test('H3-sec: pushed input strings are sanitized', async () => {
  const pending = permissionBroker.request({
    sessionId: 's1',
    toolId: 't1',
    toolName: 'unknown_tool',
    input: { path: '‮src/main.ts', mode: 'r\x00w' },
  });
  await new Promise((r) => setImmediate(r));
  const evt = captured.find((c) => c.channel === 'permission.request');
  assert.ok(evt);
  const p = evt.payload as { toolCall: { input?: Record<string, unknown> } };
  assert.equal(p.toolCall.input?.path, 'src/main.ts');
  assert.equal(p.toolCall.input?.mode, 'rw');

  const { reqId } = lastRequest();
  permissionBroker.resolve(reqId, 'deny');
  await pending;
});

test('danger overrides rule: even with bash rule cached, rm -rf still pops modal', async () => {
  // 用户曾经批准过 "bash:rm" 这种规则（极不该有，但假设有）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (permissionRegistry as any).cached = [{ pattern: 'bash', createdAt: Date.now() }];

  const pending = permissionBroker.request({
    sessionId: 's1',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'rm -rf /' },
  });
  await new Promise((r) => setImmediate(r));

  // danger 必须弹窗
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 1, 'danger commands must always prompt even with cached rules');

  const { reqId } = lastRequest();
  permissionBroker.resolve(reqId, 'deny');
  const result = await pending;
  assert.equal(result.decision, 'deny');
});
