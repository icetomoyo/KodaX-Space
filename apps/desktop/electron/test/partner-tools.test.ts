// F047 — Partner 工具白名单策略（non-bash-subset）单测。
//
// isPartnerToolAllowed 是纯函数：注入 SDK resolveToolCapability 的 tier 结果，便于不加载真 SDK
// 单测策略逻辑。真 SDK tier 的正确性由 e2e/f047-partner-tools.mjs 验。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  _clearPartnerSpaceToolPoliciesForTesting,
  computeToolBlockReason,
  getPartnerSpaceToolPolicy,
  isPartnerToolAllowed,
  listPartnerSpaceToolPolicies,
  PARTNER_NETWORK_ALLOW,
  partnerToolVisibilityPolicy,
  registerPartnerSpaceToolPolicy,
} from '../kodax/partner-tools.js';

test('read-tier tools are allowed (read/grep/glob/repo-intel...)', () => {
  assert.equal(isPartnerToolAllowed('read', 'read'), true);
  assert.equal(isPartnerToolAllowed('grep', 'read'), true);
  assert.equal(isPartnerToolAllowed('glob', 'read'), true);
  assert.equal(isPartnerToolAllowed('repo_overview', 'read'), true);
});

test('mutation / shell / subagent tiers are blocked', () => {
  assert.equal(isPartnerToolAllowed('edit', 'edit'), false);
  assert.equal(isPartnerToolAllowed('write', 'edit'), false);
  assert.equal(isPartnerToolAllowed('bash', 'bash:mutating'), false);
  assert.equal(isPartnerToolAllowed('bash', 'bash:read-only'), false); // Partner 默认无 bash，任何 bash tier 都拦
  assert.equal(isPartnerToolAllowed('bash', 'bash:network'), false);
  assert.equal(isPartnerToolAllowed('some_subagent', 'subagent'), false);
});

test('web research tools are explicitly allowed even when tier is not "read"', () => {
  // web_fetch/web_search 真 SDK tier = 'bash:network'（e2e 实测），但 Partner 研究需要 → 显式放行。
  assert.equal(isPartnerToolAllowed('web_fetch', 'bash:network'), true);
  assert.equal(isPartnerToolAllowed('web_search', 'bash:network'), true);
  // 集合内容锁定
  assert.ok(PARTNER_NETWORK_ALLOW.has('web_fetch'));
  assert.ok(PARTNER_NETWORK_ALLOW.has('web_search'));
});

test('fail-closed: unknown tool (SDK resolves to "subagent") is blocked', () => {
  // SDK resolveToolCapability 对未知/MCP 工具 fail-closed 到 'subagent'；Partner 也拦。
  assert.equal(isPartnerToolAllowed('mystery_mcp_tool', 'subagent'), false);
});

test('registered readonly tools are allowed even when capability resolves to subagent', () => {
  assert.equal(
    isPartnerToolAllowed('partner_source_read', 'subagent', { sideEffect: 'readonly' }),
    true,
  );
});

test('registered reads-network tools are allowed for Partner research', () => {
  assert.equal(
    isPartnerToolAllowed('browser_snapshot', 'subagent', { sideEffect: 'reads-network' }),
    true,
  );
});

test('registered mutating tools remain blocked unless they have Partner policy', () => {
  assert.equal(
    isPartnerToolAllowed('partner_state_write', 'subagent', { sideEffect: 'mutates-state' }),
    false,
  );
});

test('Space Partner tool policy allows scoped state tools', () => {
  _clearPartnerSpaceToolPoliciesForTesting();
  registerPartnerSpaceToolPolicy({
    name: 'write_partner_deliverable',
    scope: 'workspace-delivery',
    sideEffect: 'mutates-state',
    description: 'Write a Partner deliverable inside the session output workspace.',
  });
  assert.equal(
    isPartnerToolAllowed('write_partner_deliverable', 'subagent', {
      sideEffect: 'mutates-state',
    }),
    true,
  );
  assert.equal(getPartnerSpaceToolPolicy('write_partner_deliverable')?.scope, 'workspace-delivery');
  assert.deepEqual(
    listPartnerSpaceToolPolicies().map((p) => p.name),
    ['write_partner_deliverable'],
  );
  _clearPartnerSpaceToolPoliciesForTesting();
});

test('Partner tool visibility policy mirrors the execution whitelist', () => {
  _clearPartnerSpaceToolPoliciesForTesting();
  registerPartnerSpaceToolPolicy({
    name: 'create_artifact',
    scope: 'artifact',
    sideEffect: 'mutates-state',
    description: 'Creates or updates Space artifacts.',
  });
  assert.equal(
    partnerToolVisibilityPolicy({
      name: 'read',
      sideEffect: 'readonly',
      planModeAllowed: true,
    }),
    true,
  );
  assert.equal(
    partnerToolVisibilityPolicy({
      name: 'web_fetch',
      sideEffect: 'reads-network',
      planModeAllowed: false,
    }),
    true,
  );
  assert.equal(
    partnerToolVisibilityPolicy({
      name: 'create_artifact',
      sideEffect: 'mutates-state',
      planModeAllowed: false,
    }),
    true,
  );
  assert.equal(
    partnerToolVisibilityPolicy({
      name: 'create_office_artifact',
      sideEffect: 'mutates-state',
      planModeAllowed: false,
    }),
    true,
  );
  assert.equal(
    partnerToolVisibilityPolicy({
      name: 'bash',
      sideEffect: 'mutates-shell',
      planModeAllowed: false,
    }),
    false,
  );
  _clearPartnerSpaceToolPoliciesForTesting();
});

// ---- computeToolBlockReason: Partner 白名单 + plan-mode 交互（review HIGH）----

const cap = (c: string) => () => c;
const planAllowed = (b: boolean) => () => b;

test('Partner: read tool allowed regardless of permissionMode (incl. plan)', () => {
  for (const mode of ['accept-edits', 'auto', 'plan'] as const) {
    assert.equal(
      computeToolBlockReason({
        surface: 'partner',
        permissionMode: mode,
        tool: 'read',
        resolveCapability: cap('read'),
        isPlanModeAllowed: planAllowed(false),
      }),
      null,
      `read 应放行 (mode=${mode})`,
    );
  }
});

test('Partner: web tools allowed even in plan mode (HIGH fix — plan-mode 不再二次裁剪 Partner)', () => {
  // 关键回归：旧逻辑会 fall-through 到 plan-mode → web_fetch 被 [plan] 拦。修复后 Partner-allowed
  // 直接放行。注意：即便 isPlanModeAllowed=false（plan-mode 本会拦 web），Partner 下仍放行。
  const r = computeToolBlockReason({
    surface: 'partner',
    permissionMode: 'plan',
    tool: 'web_fetch',
    resolveCapability: cap('bash:network'),
    isPlanModeAllowed: planAllowed(false),
  });
  assert.equal(r, null, 'Partner+plan-mode 下 web_fetch 必须仍可用');
});

test('Partner: registered readonly custom tool is allowed in plan mode', () => {
  const r = computeToolBlockReason({
    surface: 'partner',
    permissionMode: 'plan',
    tool: 'partner_source_read',
    resolveCapability: cap('subagent'),
    resolveRegisteredTool: () => ({ sideEffect: 'readonly' }),
    isPlanModeAllowed: planAllowed(false),
  });
  assert.equal(r, null);
});

test('Partner: non-whitelisted tool blocked with [partner] reason', () => {
  const r = computeToolBlockReason({
    surface: 'partner',
    permissionMode: 'accept-edits',
    tool: 'bash',
    resolveCapability: cap('bash:mutating'),
    isPlanModeAllowed: planAllowed(false),
  });
  assert.ok(r?.startsWith('[partner]'), 'bash 在 Partner 应得 [partner] block reason');
});

test('Coder: accept-edits does not apply plan-mode blocking', () => {
  assert.equal(
    computeToolBlockReason({
      surface: 'code',
      permissionMode: 'accept-edits',
      tool: 'edit',
      resolveCapability: cap('edit'),
      isPlanModeAllowed: planAllowed(false),
    }),
    null,
  );
});

test('Coder: plan allows SDK plan-allowed tools', () => {
  assert.equal(
    computeToolBlockReason({
      surface: 'code',
      permissionMode: 'plan',
      tool: 'read',
      resolveCapability: cap('read'),
      isPlanModeAllowed: planAllowed(true),
    }),
    null,
  );
});

test('Coder: plan fallback allows readonly metadata and read capability tools', () => {
  assert.equal(
    computeToolBlockReason({
      surface: 'code',
      permissionMode: 'plan',
      tool: 'mcp_describe',
      resolveCapability: cap('bash:network'),
      resolveRegisteredTool: () => ({ sideEffect: 'readonly' }),
      isPlanModeAllowed: planAllowed(false),
    }),
    null,
  );
  assert.equal(
    computeToolBlockReason({
      surface: 'code',
      permissionMode: 'plan',
      tool: 'custom_reader',
      resolveCapability: cap('read'),
      isPlanModeAllowed: planAllowed(false),
    }),
    null,
  );
});

test('Coder: plan fallback explicitly allows web_fetch as read-only research', () => {
  assert.equal(
    computeToolBlockReason({
      surface: 'code',
      permissionMode: 'plan',
      tool: 'web_fetch',
      resolveCapability: cap('bash:network'),
      resolveRegisteredTool: () => ({ sideEffect: 'mutates-network' }),
      isPlanModeAllowed: planAllowed(false),
    }),
    null,
  );
});

test('Coder: plan still blocks mutating tools', () => {
  const r = computeToolBlockReason({
    surface: 'code',
    permissionMode: 'plan',
    tool: 'write',
    resolveCapability: cap('edit'),
    isPlanModeAllowed: planAllowed(false),
  });
  assert.ok(r?.startsWith('[plan]'), 'Coder plan-mode should block write');
});
