// PermissionBroker mode-aware policy tests — KodaX canonical four profiles
//
// 对齐 KodaX REPL canonical (ADR-005)：
//   'plan'         → Coder 全 deny（broker 层不区分 tool；plan-mode 拦截在 KodaX 入口
//                    `planModeBlockCheck` → SDK isToolPlanModeAllowed v0.7.42）。
//                    Partner 例外：只有已通过 Partner tool policy 的工具可执行。
//   'accept-edits' → edit/write/multi_edit/insert_after_anchor 自动批；
//                    其他 (bash/web_fetch/...) 走 ask modal；
//                    dangerous (rm -rf 等) 即便是 edit 工具也 ask
//   'auto'         → FEATURE_030 AutoModeToolGuardrail 正常路径不进入 broker；
//                    兼容路径只对 dangerous 调用保留本地确认，避免双 broker。
//   'full-access'  → broker 不弹窗；SDK Exec Policy 仍拥有不可授权边界。
//
// 已删 mode：
//   - 'ask-permissions'    (KodaX 没有)
//   - 'bypass-permissions' (已迁移为 canonical 'full-access')

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { permissionBroker } from '../permission/broker.js';
import { setRendererTarget } from '../ipc/push.js';
import { permissionRegistry } from '../permission/registry.js';

interface Captured {
  channel: string;
  payload: unknown;
}
const captured: Captured[] = [];

beforeEach(() => {
  captured.length = 0;
  setRendererTarget(
    () =>
      ({
        send: (channel: string, payload: unknown) => captured.push({ channel, payload }),
        isDestroyed: () => false,
      }) as unknown as Electron.WebContents,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (permissionRegistry as any).cached = [];
});

afterEach(() => {
  setRendererTarget(() => null);
});

// ---------------------------- plan mode ----------------------------

test('plan denies bash without pushing permission.request', async () => {
  const result = await permissionBroker.request({
    sessionId: 's_plan',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'echo hi' },
    mode: 'plan',
  });
  assert.equal(result.decision, 'deny');
  assert.equal(
    captured.filter((c) => c.channel === 'permission.request').length,
    0,
    'plan mode must not show modal',
  );
});

test('plan denies edit/write/multi_edit/mcp_call - mutating gate', async () => {
  for (const toolName of ['edit', 'write', 'multi_edit', 'mcp_call']) {
    const result = await permissionBroker.request({
      sessionId: 's_plan',
      toolId: `t_${toolName}`,
      toolName,
      input: {},
      mode: 'plan',
    });
    assert.equal(result.decision, 'deny', `plan must deny ${toolName}`);
  }
});

test('plan allows readonly tools without pushing permission.request', async () => {
  for (const toolName of [
    'read',
    'grep',
    'glob',
    'code_search',
    'kodax_manual',
    'mcp_describe',
    'mcp_search',
    'mcp_read_resource',
    'web_fetch',
    'web_search',
  ]) {
    const result = await permissionBroker.request({
      sessionId: 's_plan_readonly',
      toolId: `t_${toolName}`,
      toolName,
      input: { path: 'foo.ts', pattern: 'foo', url: 'https://example.com' },
      mode: 'plan',
    });
    assert.equal(result.decision, 'allow_once', `plan should allow readonly ${toolName}`);
  }
  assert.equal(
    captured.filter((c) => c.channel === 'permission.request').length,
    0,
    'plan readonly tools must not show modal',
  );
});

test('Partner plan allows tools already admitted by Partner policy without modal', async () => {
  const result = await permissionBroker.request({
    sessionId: 's_partner_plan',
    toolId: 't_create_artifact',
    toolName: 'create_artifact',
    input: { kind: 'markdown', title: 'Report' },
    mode: 'plan',
    surface: 'partner',
    partnerToolAllowed: true,
  });
  assert.equal(result.decision, 'allow_once');
  assert.equal(
    captured.filter((c) => c.channel === 'permission.request').length,
    0,
    'Partner policy-admitted tools should not show the generic permission modal',
  );
});

test('Partner plan still denies tools not admitted by Partner policy', async () => {
  const result = await permissionBroker.request({
    sessionId: 's_partner_plan_block',
    toolId: 't_bash',
    toolName: 'bash',
    input: { command: 'echo hi' },
    mode: 'plan',
    surface: 'partner',
    partnerToolAllowed: false,
  });
  assert.equal(result.decision, 'deny');
});

// ---------------------------- accept-edits mode ----------------------------

test('accept-edits auto-allows non-dangerous edit tools (edit/write/multi_edit/insert_after_anchor)', async () => {
  for (const toolName of ['edit', 'write', 'multi_edit', 'insert_after_anchor']) {
    const result = await permissionBroker.request({
      sessionId: 's_ae',
      toolId: `t_${toolName}`,
      toolName,
      input: { path: 'src/foo.ts' },
      mode: 'accept-edits',
    });
    assert.equal(result.decision, 'allow_once', `accept-edits should auto-allow ${toolName}`);
  }
  assert.equal(
    captured.filter((c) => c.channel === 'permission.request').length,
    0,
    'accept-edits non-dangerous edits should not show modal',
  );
});

test('accept-edits auto-allows expanded readonly tools without modal', async () => {
  for (const toolName of [
    'code_search',
    'kodax_manual',
    'mcp_describe',
    'mcp_read_resource',
    'web_fetch',
  ]) {
    const result = await permissionBroker.request({
      sessionId: 's_ae_readonly',
      toolId: `t_${toolName}`,
      toolName,
      input: { query: 'permission mode', url: 'https://example.com' },
      mode: 'accept-edits',
    });
    assert.equal(result.decision, 'allow_once', `accept-edits should auto-allow ${toolName}`);
  }
  assert.equal(
    captured.filter((c) => c.channel === 'permission.request').length,
    0,
    'accept-edits readonly tools should not show modal',
  );
});

test('accept-edits does NOT short-circuit non-edit tools (bash) — goes through ask', async () => {
  const pending = permissionBroker.request({
    sessionId: 's_ae2',
    toolId: 't_bash',
    toolName: 'bash',
    input: { command: 'echo hi' },
    mode: 'accept-edits',
  });
  await new Promise((r) => setImmediate(r));
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 1, 'accept-edits + non-edit tool should still show modal');
  const { reqId } = reqs[0].payload as { reqId: string };
  permissionBroker.resolve(reqId, 'allow_once');
  const result = await pending;
  assert.equal(result.decision, 'allow_once');
});

test('accept-edits + dangerous bash still goes through ask (not auto-allowed)', async () => {
  const pending = permissionBroker.request({
    sessionId: 's_ae3',
    toolId: 't_rm',
    toolName: 'bash',
    input: { command: 'rm -rf /tmp/foo' },
    mode: 'accept-edits',
  });
  await new Promise((r) => setImmediate(r));
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 1, 'dangerous tool in accept-edits must still show modal');
  const { reqId } = reqs[0].payload as { reqId: string };
  permissionBroker.resolve(reqId, 'deny');
  const result = await pending;
  assert.equal(result.decision, 'deny');
});

// ---------------------------- auto mode (pre-F030 fallback) ----------------------------

test('auto mode (pre-F030 fallback) auto-allows edits like accept-edits', async () => {
  // FEATURE_030 wire AutoModeToolGuardrail 前，broker fallback 到 accept-edits 行为，
  // 保证 'auto' 至少跟 'accept-edits' 一样严，**绝不更松**。
  for (const toolName of ['edit', 'write', 'multi_edit']) {
    const result = await permissionBroker.request({
      sessionId: 's_auto',
      toolId: `t_${toolName}`,
      toolName,
      input: { path: 'src/x.ts' },
      mode: 'auto',
    });
    assert.equal(result.decision, 'allow_once', `auto fallback should allow edit ${toolName}`);
  }
});

test('auto compatibility path does not re-prompt for ordinary bash', async () => {
  // SDK guardrail 正常路径不会调用 broker；兼容调用者若仍转发到这里，broker 不能
  // 对已裁决调用再弹一次 modal。危险调用仍由下面的用例验证为 fail-closed。
  const result = await permissionBroker.request({
    sessionId: 's_auto2',
    toolId: 't_bash',
    toolName: 'bash',
    input: { command: 'echo hi' },
    mode: 'auto',
  });
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(result.decision, 'allow_once');
  assert.equal(reqs.length, 0, 'ordinary bash in Auto must not use a second broker modal');
});

test('auto bootstrap fallback still asks for dangerous bash', async () => {
  const pending = permissionBroker.request({
    sessionId: 's_auto3',
    toolId: 't_rm',
    toolName: 'bash',
    input: { command: 'rm -rf /tmp/foo' },
    mode: 'auto',
  });
  await new Promise((r) => setImmediate(r));
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 1, 'dangerous bash in auto fallback must show modal');
  const { reqId } = reqs[0].payload as { reqId: string };
  permissionBroker.resolve(reqId, 'deny');
  const result = await pending;
  assert.equal(result.decision, 'deny');
});

// ---------------------------- default mode ----------------------------

test('default mode (undefined) behaves as accept-edits — canonical default', async () => {
  // schema 缺省 'accept-edits' (FEATURE_029)。broker req.mode === undefined 应当
  // fallback 到同一缺省，否则双语义不一致。
  const result = await permissionBroker.request({
    sessionId: 's_default',
    toolId: 't_edit',
    toolName: 'edit',
    input: { path: 'foo.ts' },
    // mode 不传 — broker fallback 应当 'accept-edits'
  });
  assert.equal(result.decision, 'allow_once', 'undefined mode should auto-allow edit');
  assert.equal(
    captured.filter((c) => c.channel === 'permission.request').length,
    0,
    'undefined mode = accept-edits fallback should not show modal for edit',
  );
});
