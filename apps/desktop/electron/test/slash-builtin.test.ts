// builtin slash command handlers — FEATURE_031.
//
// 覆盖：
//   /mode + 错误参数 + 未知 session
//   /provider + 未知 providerId
//   /reasoning + 错误参数
//   /clear + 未知 session
//   /help 列出全部命令
//   未注册命令名 → unknown
//   handler throw → 错误信息回 renderer

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SkillLearningProposal, WorkflowLearningHandoff } from '@kodax-ai/kodax/agent';
import { kodaxHost } from '../kodax/host.js';
import { setUserConfigImpl, type KodaxUserConfigImpl } from '../kodax/user-config.js';
import { setRendererTarget } from '../ipc/push.js';
import {
  _resetSlashRegistryForTesting,
  getSlashHandler,
  listSlashCommands,
  registerSlash,
} from '../slash/registry.js';
import { BUILTIN_SLASH_COMMANDS, clearSlashGoalForSession } from '../slash/builtin.js';
import {
  SessionRuntimeStore,
  setSessionRuntimeStoreForTesting,
} from '../kodax/session-runtime-store.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';

let captured: Array<{ channel: string; payload: unknown }>;
let tempProjectRoots: string[];
let originalKodaxHome: string | undefined;
let runtimeDir = '';
let runtimeStore: SessionRuntimeStore;

beforeEach(async () => {
  captured = [];
  tempProjectRoots = [];
  originalKodaxHome = process.env.KODAX_HOME;
  runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'kodax-slash-runtime-'));
  runtimeStore = new SessionRuntimeStore(runtimeDir);
  setSessionRuntimeStoreForTesting(runtimeStore);
  setRendererTarget(
    () =>
      ({
        send: (channel: string, payload: unknown) => captured.push({ channel, payload }),
        isDestroyed: () => false,
      }) as unknown as Electron.WebContents,
  );
  await kodaxHost.disposeAll();
  _resetSlashRegistryForTesting();
  for (const cmd of BUILTIN_SLASH_COMMANDS) {
    registerSlash(cmd);
  }
});

afterEach(async () => {
  setRendererTarget(() => null);
  setUserConfigImpl(null);
  setSessionRuntimeStoreForTesting(null);
  await kodaxHost.disposeAll();
  if (originalKodaxHome === undefined) delete process.env.KODAX_HOME;
  else process.env.KODAX_HOME = originalKodaxHome;
  await Promise.all(tempProjectRoots.map((dir) => rm(dir, { recursive: true, force: true })));
  await rm(runtimeDir, { recursive: true, force: true }).catch(() => {});
  tempProjectRoots = [];
  _resetSlashRegistryForTesting();
});

async function runCmd(name: string, sessionId: string, args: string[] = []) {
  const handler = getSlashHandler(name);
  assert.ok(handler, `handler /${name} should be registered`);
  return handler!.handler({ sessionId, args });
}

function effectiveRuntimeConfig(
  values: Readonly<Record<string, unknown>>,
  source: 'runtime_override' | 'environment' | 'persisted' | 'unset' = 'persisted',
  applied: boolean | Readonly<Record<string, boolean>> = true,
) {
  return {
    schemaVersion: 1 as const,
    capturedAt: '2026-08-29T00:00:00.000Z',
    persistedConfig: { state: 'loaded' as const },
    entries: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        {
          present: true,
          applied: typeof applied === 'boolean' ? applied : (applied[key] ?? true),
          source,
          priority: 1,
          value,
        },
      ]),
    ),
    credentials: {},
  };
}

function mockUserConfig(config: Record<string, unknown>): void {
  const impl: KodaxUserConfigImpl = {
    loadConfig: (() => config) as never,
    registerCustomProviders: (() => undefined) as never,
  };
  setUserConfigImpl(impl);
}

async function createLearningSession(): Promise<{
  readonly sessionId: string;
  readonly projectRoot: string;
}> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'kodax-space-learn-'));
  tempProjectRoots.push(projectRoot);
  process.env.KODAX_HOME = path.join(projectRoot, '.kodax-home');
  const { sessionId } = kodaxHost.createSession({
    projectRoot,
    provider: 'mock',
    surface: 'partner',
  });
  return { sessionId, projectRoot };
}

function makeSkillLearningProposal(proposalId = 'learn-skill-1'): SkillLearningProposal {
  return {
    destination: 'skill_patch',
    proposalId,
    origin: 'background_learning',
    userLabel: 'method_guide',
    skillName: 'demo-skill',
    whyDurable: 'The project repeatedly asks for this checkout guardrail.',
    trigger: 'When changing desktop slash commands, add targeted node:test coverage.',
    changeSummary: 'Document the slash-command coverage pattern for future changes.',
    sourceTraceIds: ['trace-skill'],
    confidence: 0.92,
  };
}

function makeWorkflowLearningProposal(proposalId = 'learn-workflow-1'): WorkflowLearningHandoff {
  return {
    destination: 'workflow_handoff',
    proposalId,
    origin: 'background_learning',
    userLabel: 'runnable_workflow',
    evidenceRunIds: ['run-learning-1'],
    sourceTraceIds: ['trace-workflow'],
    suggestedAction: 'save_from_run',
    whyWorkflowNotSkill: 'The behavior spans planning, implementation, and verification steps.',
    requiredWorkflowEvidence: ['A completed run with tests and docs updates.'],
    risk: 'medium',
    consumerImpact: {
      workflowCapsules: [],
      savedWorkflows: [],
      constructedAgents: [],
      promptReferences: [],
      action: 'none',
    },
    appliedByF224: false,
  };
}

async function seedLearningProposal(
  projectRoot: string,
  proposal: SkillLearningProposal | WorkflowLearningHandoff,
) {
  const sdk = await import('@kodax-ai/kodax/agent');
  const storePath = sdk.resolveLearningProposalStore(projectRoot);
  const entry = await sdk.upsertLearningProposal(storePath, proposal);
  return { storePath, entry };
}

test('listSlashCommands returns all builtin commands in alpha order', () => {
  const cmds = listSlashCommands().map((c) => c.name);
  // 持续随 KodaX SDK 暴露新命令而增长——做集合包含断言，而不锁死完整数量
  // 避免每次加新内置命令都得改这个测试
  const required = new Set([
    'agent-mode',
    'auto',
    'clear',
    'compact',
    'copy',
    'cost',
    'delete',
    'doctor',
    'exit',
    'extensions',
    'fallback',
    'fork',
    'goal',
    'help',
    'history',
    'learn',
    'load',
    'mcp',
    'memory',
    'mode',
    'model',
    'new',
    'paste',
    'provider',
    'reasoning',
    'recover',
    'reload',
    'repointel',
    'review',
    'rewind',
    'save',
    'sessions',
    'skill',
    'skills',
    'stall-log',
    'status',
    'thinking',
    'verifier-log',
    'workflow',
  ]);
  const sorted = cmds.slice().sort();
  for (const r of required) {
    assert.ok(sorted.includes(r), `builtin command /${r} should be registered`);
  }
  // 排序正确性仍校验
  assert.deepEqual(sorted, [...cmds].sort());
});

test('/fallback reads and patches the selected Coder daemon config', async (t) => {
  const originalOverride = process.env.KODAX_FALLBACK_PROVIDERS;
  delete process.env.KODAX_FALLBACK_PROVIDERS;
  const adapter = runtimeHostAdapter as unknown as {
    isRuntimeSelected(): boolean;
    readEffectiveRuntimeConfig(): Promise<unknown>;
    patchRuntimeConfig(patch: Record<string, unknown>): Promise<unknown>;
  };
  const originals = {
    isRuntimeSelected: adapter.isRuntimeSelected,
    readEffectiveRuntimeConfig: adapter.readEffectiveRuntimeConfig,
    patchRuntimeConfig: adapter.patchRuntimeConfig,
  };
  const patches: Record<string, unknown>[] = [];
  adapter.isRuntimeSelected = () => true;
  adapter.readEffectiveRuntimeConfig = async () =>
    effectiveRuntimeConfig({ fallbackProviders: 'old-provider,second-provider' }, 'environment');
  adapter.patchRuntimeConfig = async (patch) => {
    patches.push(patch);
    return {};
  };
  t.after(() => {
    Object.assign(adapter, originals);
    if (originalOverride === undefined) delete process.env.KODAX_FALLBACK_PROVIDERS;
    else process.env.KODAX_FALLBACK_PROVIDERS = originalOverride;
  });

  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'mock',
    surface: 'code',
  });
  const status = await runCmd('fallback', sessionId, ['status']);
  const updated = await runCmd('fallback', sessionId, ['ark-coding,kimi-code']);

  assert.match(status.message ?? '', /old-provider/);
  assert.match(status.message ?? '', /second-provider/);
  assert.match(status.message ?? '', /effective Runtime source: environment/i);
  assert.equal(updated.ok, true);
  assert.deepEqual(patches, [{ fallbackProviders: ['ark-coding', 'kimi-code'] }]);
});

test('/fallback does not infer shared daemon state from the Electron environment', async (t) => {
  const originalOverride = process.env.KODAX_FALLBACK_PROVIDERS;
  process.env.KODAX_FALLBACK_PROVIDERS = 'env-provider';
  const adapter = runtimeHostAdapter as unknown as {
    isRuntimeSelected(): boolean;
    readEffectiveRuntimeConfig(): Promise<unknown>;
    patchRuntimeConfig(patch: Record<string, unknown>): Promise<unknown>;
  };
  const originals = {
    isRuntimeSelected: adapter.isRuntimeSelected,
    readEffectiveRuntimeConfig: adapter.readEffectiveRuntimeConfig,
    patchRuntimeConfig: adapter.patchRuntimeConfig,
  };
  const patches: Record<string, unknown>[] = [];
  adapter.isRuntimeSelected = () => true;
  adapter.readEffectiveRuntimeConfig = async () =>
    effectiveRuntimeConfig({ fallbackProviders: ['config-provider'] }, 'persisted', false);
  adapter.patchRuntimeConfig = async (patch) => {
    patches.push(patch);
    return {};
  };
  t.after(() => {
    Object.assign(adapter, originals);
    if (originalOverride === undefined) delete process.env.KODAX_FALLBACK_PROVIDERS;
    else process.env.KODAX_FALLBACK_PROVIDERS = originalOverride;
  });

  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'mock',
    surface: 'code',
  });
  const status = await runCmd('fallback', sessionId, ['status']);
  const update = await runCmd('fallback', sessionId, ['ark-coding']);

  assert.doesNotMatch(status.message ?? '', /env-provider/);
  assert.doesNotMatch(status.message ?? '', /config-provider/);
  assert.match(status.message ?? '', /effective Runtime source: persisted \(not applied\)/i);
  assert.equal(update.ok, true);
  assert.match(update.message ?? '', /saved/i);
  assert.deepEqual(patches, [{ fallbackProviders: ['ark-coding'] }]);
});

test('daemon observability slash commands patch Runtime config instead of Electron env', async (t) => {
  const originalVerifierOverride = process.env.KODAX_VERIFIER_LOG;
  const originalStallOverride = process.env.KODAX_STALL_LOG;
  delete process.env.KODAX_VERIFIER_LOG;
  delete process.env.KODAX_STALL_LOG;
  const adapter = runtimeHostAdapter as unknown as {
    isRuntimeSelected(): boolean;
    readEffectiveRuntimeConfig(): Promise<unknown>;
    patchRuntimeConfig(patch: Record<string, unknown>): Promise<unknown>;
  };
  const originals = {
    isRuntimeSelected: adapter.isRuntimeSelected,
    readEffectiveRuntimeConfig: adapter.readEffectiveRuntimeConfig,
    patchRuntimeConfig: adapter.patchRuntimeConfig,
  };
  const patches: Record<string, unknown>[] = [];
  adapter.isRuntimeSelected = () => true;
  adapter.readEffectiveRuntimeConfig = async () =>
    effectiveRuntimeConfig({ verifierLog: true, stallLog: false });
  adapter.patchRuntimeConfig = async (patch) => {
    patches.push(patch);
    return {};
  };
  t.after(() => {
    Object.assign(adapter, originals);
    if (originalVerifierOverride === undefined) delete process.env.KODAX_VERIFIER_LOG;
    else process.env.KODAX_VERIFIER_LOG = originalVerifierOverride;
    if (originalStallOverride === undefined) delete process.env.KODAX_STALL_LOG;
    else process.env.KODAX_STALL_LOG = originalStallOverride;
  });

  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'mock',
    surface: 'code',
  });
  assert.match((await runCmd('verifier-log', sessionId)).message ?? '', /on/);
  assert.match((await runCmd('stall-log', sessionId)).message ?? '', /off/);
  await runCmd('verifier-log', sessionId, ['off']);
  await runCmd('stall-log', sessionId, ['on']);

  assert.deepEqual(patches, [{ verifierLog: false }, { stallLog: true }]);
});

test('daemon observability commands do not infer shared daemon state from Electron env', async (t) => {
  const originalVerifierOverride = process.env.KODAX_VERIFIER_LOG;
  const originalStallOverride = process.env.KODAX_STALL_LOG;
  process.env.KODAX_VERIFIER_LOG = '1';
  process.env.KODAX_STALL_LOG = '0';
  const adapter = runtimeHostAdapter as unknown as {
    isRuntimeSelected(): boolean;
    readEffectiveRuntimeConfig(): Promise<unknown>;
    patchRuntimeConfig(patch: Record<string, unknown>): Promise<unknown>;
  };
  const originals = {
    isRuntimeSelected: adapter.isRuntimeSelected,
    readEffectiveRuntimeConfig: adapter.readEffectiveRuntimeConfig,
    patchRuntimeConfig: adapter.patchRuntimeConfig,
  };
  const patches: Record<string, unknown>[] = [];
  adapter.isRuntimeSelected = () => true;
  adapter.readEffectiveRuntimeConfig = async () =>
    effectiveRuntimeConfig({ verifierLog: '1', stallLog: '1' }, 'environment', {
      verifierLog: false,
      stallLog: true,
    });
  adapter.patchRuntimeConfig = async (patch) => {
    patches.push(patch);
    return {};
  };
  t.after(() => {
    Object.assign(adapter, originals);
    if (originalVerifierOverride === undefined) delete process.env.KODAX_VERIFIER_LOG;
    else process.env.KODAX_VERIFIER_LOG = originalVerifierOverride;
    if (originalStallOverride === undefined) delete process.env.KODAX_STALL_LOG;
    else process.env.KODAX_STALL_LOG = originalStallOverride;
  });

  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'mock',
    surface: 'code',
  });
  assert.match((await runCmd('verifier-log', sessionId)).message ?? '', /log: off/i);
  assert.match((await runCmd('stall-log', sessionId)).message ?? '', /log: on/i);
  assert.match(
    (await runCmd('verifier-log', sessionId)).message ?? '',
    /effective Runtime source: environment \(not applied\)/i,
  );
  assert.equal((await runCmd('verifier-log', sessionId, ['off'])).ok, true);
  assert.equal((await runCmd('stall-log', sessionId, ['on'])).ok, true);
  assert.deepEqual(patches, [{ verifierLog: false }, { stallLog: true }]);
});

test('Partner config commands stay on the embedded process when Runtime is selected', async (t) => {
  const originalFallback = process.env.KODAX_FALLBACK_PROVIDERS;
  const originalVerifier = process.env.KODAX_VERIFIER_LOG;
  const originalStall = process.env.KODAX_STALL_LOG;
  process.env.KODAX_FALLBACK_PROVIDERS = 'partner-old';
  process.env.KODAX_VERIFIER_LOG = '0';
  process.env.KODAX_STALL_LOG = '1';
  const adapter = runtimeHostAdapter as unknown as {
    isRuntimeSelected(): boolean;
    readEffectiveRuntimeConfig(): Promise<unknown>;
    patchRuntimeConfig(patch: Record<string, unknown>): Promise<unknown>;
  };
  const originals = {
    isRuntimeSelected: adapter.isRuntimeSelected,
    readEffectiveRuntimeConfig: adapter.readEffectiveRuntimeConfig,
    patchRuntimeConfig: adapter.patchRuntimeConfig,
  };
  adapter.isRuntimeSelected = () => true;
  adapter.readEffectiveRuntimeConfig = async () => {
    throw new Error('Partner command must not read Runtime config');
  };
  adapter.patchRuntimeConfig = async () => {
    throw new Error('Partner command must not patch Runtime config');
  };
  t.after(() => {
    Object.assign(adapter, originals);
    if (originalFallback === undefined) delete process.env.KODAX_FALLBACK_PROVIDERS;
    else process.env.KODAX_FALLBACK_PROVIDERS = originalFallback;
    if (originalVerifier === undefined) delete process.env.KODAX_VERIFIER_LOG;
    else process.env.KODAX_VERIFIER_LOG = originalVerifier;
    if (originalStall === undefined) delete process.env.KODAX_STALL_LOG;
    else process.env.KODAX_STALL_LOG = originalStall;
  });
  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'mock',
    surface: 'partner',
  });

  const fallbackStatus = await runCmd('fallback', sessionId, ['status']);
  const fallbackUpdate = await runCmd('fallback', sessionId, ['partner-new']);
  const verifierUpdate = await runCmd('verifier-log', sessionId, ['on']);
  const stallUpdate = await runCmd('stall-log', sessionId, ['off']);

  assert.match(fallbackStatus.message ?? '', /partner-old/);
  assert.match(fallbackUpdate.message ?? '', /current Space process/i);
  assert.equal(verifierUpdate.ok, true);
  assert.equal(stallUpdate.ok, true);
  assert.equal(process.env.KODAX_FALLBACK_PROVIDERS, 'partner-new');
  assert.equal(process.env.KODAX_VERIFIER_LOG, '1');
  assert.equal(process.env.KODAX_STALL_LOG, undefined);
});

test('/mode full-access switches to the canonical direct-host profile', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('mode', sessionId, ['full-access']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.permissionMode, 'full-access');
  assert.equal((await runtimeStore.read(sessionId))?.permissionMode, 'full-access');
});

test('/mode rolls back the in-memory change when runtime metadata cannot be persisted', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: '/r',
    provider: 'mock',
  });
  const runtimePath = path.join(runtimeDir, `${sessionId}.json`);
  const malformed = Buffer.from('{preserve malformed runtime state', 'utf-8');
  await writeFile(runtimePath, malformed);

  const result = await runCmd('mode', sessionId, ['plan']);

  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /could not be persisted; change was rolled back/);
  assert.equal(kodaxHost.get(sessionId)?.permissionMode, 'accept-edits');
  assert.deepEqual(await readFile(runtimePath), malformed);
});

test('/mode with no args returns usage', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('mode', sessionId);
  assert.equal(result.ok, true);
  assert.ok(result.message?.includes('Usage:'));
});

test('/mode with unknown enum value returns valid-list message', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('mode', sessionId, ['turbo']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('plan'));
  assert.ok(result.message?.includes('accept-edits'));
  assert.ok(result.message?.includes('auto'));
  assert.ok(result.message?.includes('full-access'));
});

test('/mode on unknown session returns false', async () => {
  const result = await runCmd('mode', 's_nope', ['plan']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('session not found'));
});

test('/reasoning quick switches reasoning mode', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('reasoning', sessionId, ['quick']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.reasoningMode, 'quick');
});

test('/reasoning canonicalizes an SDK/provider effort token', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('reasoning', sessionId, [' ULTRA ']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.reasoningMode, 'ultra');
  assert.equal((await runtimeStore.read(sessionId))?.reasoningMode, 'ultra');
  assert.match(result.message ?? '', /reasoning -> ultra/);
});

test('/provider with unknown id rejects (catalog gate)', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('provider', sessionId, ['nonsense-provider']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('unknown'));
});

test('/provider mock accepted', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('provider', sessionId, ['mock']);
  assert.equal(result.ok, true);
});

test('/provider accepts custom provider from KodaX config.json', async () => {
  mockUserConfig({
    customProviders: [
      {
        name: 'newapi-anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://llm.example.com/v1',
        apiKeyEnv: 'NEWAPI_API_KEY',
        model: 'claude-sonnet-4-6',
      },
    ],
  });
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });

  const result = await runCmd('provider', sessionId, ['newapi-anthropic']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.provider, 'newapi-anthropic');
  assert.equal(kodaxHost.get(sessionId)?.model, 'claude-sonnet-4-6');
  assert.equal((await runtimeStore.read(sessionId))?.model, 'claude-sonnet-4-6');
});

test('/clear returns echo=true + clearStream=true for renderer-side reset', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('clear', sessionId);
  assert.equal(result.ok, true);
  assert.equal(result.echo, true);
  assert.equal(result.clearStream, true);
});

test('non-clear builtins do NOT set clearStream', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const help = await runCmd('help', sessionId);
  assert.equal(help.clearStream, undefined, '/help should not request clearStream');
  const mode = await runCmd('mode', sessionId, ['plan']);
  assert.equal(mode.clearStream, undefined, '/mode should not request clearStream');
});

test('/clear on unknown session returns false', async () => {
  const result = await runCmd('clear', 's_nope');
  assert.equal(result.ok, false);
});

test('/help returns echo=true with command list', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('help', sessionId);
  assert.equal(result.ok, true);
  assert.equal(result.echo, true);
  assert.ok(result.message?.includes('/mode'));
  assert.ok(result.message?.includes('/auto'));
});

test('/help supports command topics and aliases', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('help', sessionId, ['model']);
  assert.equal(result.ok, true);
  assert.equal(result.echo, true);
  assert.ok(result.message?.includes('/model'));
  assert.ok(result.message?.includes('/m'));
});

test('KodaX-compatible aliases resolve to canonical handlers', () => {
  const aliases: Array<[string, string]> = [
    ['m', 'model'],
    ['am', 'agent-mode'],
    ['a', 'auto'],
    ['reason', 'reasoning'],
    ['think', 'thinking'],
    ['t', 'thinking'],
    ['h', 'help'],
    ['?', 'help'],
    ['ri', 'repointel'],
    ['resume', 'load'],
    ['ls', 'sessions'],
    ['list', 'sessions'],
    ['rm', 'delete'],
    ['del', 'delete'],
    ['ext', 'extensions'],
    ['q', 'exit'],
    ['bye', 'exit'],
  ];
  for (const [alias, canonical] of aliases) {
    assert.equal(
      getSlashHandler(alias)?.name,
      canonical,
      `/${alias} should resolve to /${canonical}`,
    );
  }
});

test('/model sets model override on session (v0.7.42 SDK wired)', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('model', sessionId, ['claude-opus-4-7']);
  assert.equal(result.ok, true);
  assert.ok(result.message?.includes('claude-opus-4-7'));
  assert.equal(kodaxHost.get(sessionId)?.model, 'claude-opus-4-7');
});

test('/model default clears the override', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  await runCmd('model', sessionId, ['claude-opus-4-7']);
  assert.equal((await runtimeStore.read(sessionId))?.model, 'claude-opus-4-7');
  const result = await runCmd('model', sessionId, ['default']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.model, undefined);
  assert.equal((await runtimeStore.read(sessionId))?.model, undefined);
});

test('/model default materializes a real provider default for Runtime side services', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'anthropic',
    model: 'claude-opus-4-7',
  });
  const result = await runCmd('model', sessionId, ['default']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.model, 'claude-sonnet-4-6');
  assert.equal((await runtimeStore.read(sessionId))?.model, 'claude-sonnet-4-6');
});

test('/model without arg returns usage', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('model', sessionId, []);
  assert.equal(result.ok, true);
  assert.ok(result.message?.includes('Usage'));
});

test('/auto alias switches permission mode to auto', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('a', sessionId);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.permissionMode, 'auto');
});

test('/goal creates and reports an in-session goal', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const created = await runCmd('goal', sessionId, ['ship', 'workflow', '--tokens', '100']);
  assert.equal(created.ok, true);
  assert.ok(created.message?.includes('ship workflow'));
  assert.ok(created.message?.includes('100'));

  const status = await runCmd('goal', sessionId, ['status']);
  assert.equal(status.ok, true);
  assert.ok(status.message?.includes('ship workflow'));
});

test('clearSlashGoalForSession drops per-session goal state', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const created = await runCmd('goal', sessionId, ['ship', 'workflow']);
  assert.equal(created.ok, true);

  clearSlashGoalForSession(sessionId);
  const status = await runCmd('goal', sessionId, ['status']);
  assert.equal(status.ok, true);
  assert.ok(status.message?.includes('No goal set'));
});

test('/load, /delete, /mcp return renderer actions where appropriate', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  assert.equal((await runCmd('load', sessionId)).message, '__action__:list-sessions');
  assert.equal((await runCmd('load', sessionId, ['s_123'])).message, '__action__:load-session');
  assert.equal((await runCmd('delete', sessionId, ['s_123'])).message, '__action__:delete-session');
  assert.equal((await runCmd('mcp', sessionId, ['refresh'])).message, '__action__:show-mcp');
  assert.equal((await runCmd('mcp', sessionId, ['wat'])).ok, false);
});

test('/thinking on sets thinking=true on session', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('thinking', sessionId, ['on']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.thinking, true);
  assert.equal((await runtimeStore.read(sessionId))?.thinking, true);
});

test('/thinking off sets thinking=false on session', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('thinking', sessionId, ['off']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.thinking, false);
});

test('/thinking accepts and canonicalizes custom SDK efforts', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('thinking', sessionId, ['ULTRA']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.reasoningMode, 'ultra');
  assert.match(result.message ?? '', /reasoning -> ultra/);
});

test('/agent-mode rejects retired AMAW inputs with a migration hint', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('agent-mode', sessionId, ['amaw']);
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /retired.*0\.7\.72.*use AMA/i);
  assert.equal(kodaxHost.get(sessionId)?.agentMode, 'ama');

  const alias = await runCmd('agent-mode', sessionId, ['ama-workflow']);
  assert.equal(alias.ok, false);
  assert.match(alias.message ?? '', /retired.*0\.7\.72.*use AMA/i);
  assert.equal(kodaxHost.get(sessionId)?.agentMode, 'ama');
});

test('/agent-mode toggle cycles AMA -> SA', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  assert.equal(kodaxHost.get(sessionId)?.agentMode, 'ama');
  assert.equal((await runCmd('agent-mode', sessionId, ['toggle'])).ok, true);
  assert.equal(kodaxHost.get(sessionId)?.agentMode, 'sa');
  assert.equal((await runCmd('agent-mode', sessionId, ['toggle'])).ok, true);
  assert.equal(kodaxHost.get(sessionId)?.agentMode, 'ama');
});

test('/learn pending lists SDK learning proposals', async () => {
  const { sessionId, projectRoot } = await createLearningSession();
  await seedLearningProposal(projectRoot, makeSkillLearningProposal());

  const result = await runCmd('learn', sessionId, ['pending']);

  assert.equal(result.ok, true);
  assert.equal(result.echo, true);
  assert.ok(result.message?.includes('learn-skill-1'));
  assert.ok(result.message?.includes('demo-skill'));
});

test('/learn diff and reject operate on SDK learning proposals', async () => {
  const { sessionId, projectRoot } = await createLearningSession();
  const { storePath } = await seedLearningProposal(
    projectRoot,
    makeSkillLearningProposal('learn-reject-1'),
  );

  const diff = await runCmd('learn', sessionId, ['diff', 'learn-reject-1']);
  assert.equal(diff.ok, true);
  assert.ok(diff.message?.includes('learn-reject-1'));
  assert.ok(diff.message?.includes('No direct apply plan'));

  const rejected = await runCmd('learn', sessionId, ['reject', 'learn-reject-1', 'not', 'durable']);
  assert.equal(rejected.ok, true);
  assert.ok(rejected.message?.includes('Rejected learn-reject-1'));

  const sdk = await import('@kodax-ai/kodax/agent');
  const store = await sdk.readLearningProposalStore(storePath);
  const entry = store.proposals.find((proposal) => proposal.proposalId === 'learn-reject-1');
  assert.equal(entry?.status, 'rejected');
  assert.equal(entry?.rejectedReason, 'not durable');
});

test('/learn keeps Runtime review/trust controls separate from Partner proposal approval', async () => {
  const { sessionId } = await createLearningSession();
  for (const action of ['review', 'trust', 'disable', 'rollback']) {
    const result = await runCmd('learn', sessionId, [action, 'learned-skill']);
    assert.equal(result.ok, false);
    assert.match(result.message ?? '', /only for Coder Runtime learned capabilities/);
  }
});

test('/skill pending and /workflow pending filter learning proposals', async () => {
  const { sessionId, projectRoot } = await createLearningSession();
  await seedLearningProposal(projectRoot, makeSkillLearningProposal('learn-skill-filter'));
  await seedLearningProposal(projectRoot, makeWorkflowLearningProposal('learn-workflow-filter'));

  const skillPending = await runCmd('skill', sessionId, ['pending']);
  assert.equal(skillPending.ok, true);
  assert.ok(skillPending.message?.includes('learn-skill-filter'));
  assert.equal(skillPending.message?.includes('learn-workflow-filter'), false);

  const workflowPending = await runCmd('workflow', sessionId, ['pending']);
  assert.equal(workflowPending.ok, true);
  assert.ok(workflowPending.message?.includes('learn-workflow-filter'));
  assert.equal(workflowPending.message?.includes('learn-skill-filter'), false);
});

test('/learn ledger and /skill ledger read SDK skill ledgers', async () => {
  const { sessionId, projectRoot } = await createLearningSession();
  const sdk = await import('@kodax-ai/kodax/agent');
  await sdk.recordSkillUsage(sdk.resolveSkillUsageLedger(projectRoot), {
    skillName: 'demo-skill',
    source: 'project',
    event: 'invoke',
  });
  const trusted = await sdk.updateSkillTrustLedger(sdk.resolveSkillTrustLedger(projectRoot), {
    skillName: 'demo-skill',
    source: 'project',
    ownership: 'background_created',
    origin: 'background_learning',
    state: 'trusted',
    reason: 'approved in slash test',
  });
  assert.equal(trusted.updated, true);

  const result = await runCmd('learn', sessionId, ['ledger']);
  assert.equal(result.ok, true);
  assert.ok(result.message?.includes('Skill learning ledgers'));
  assert.ok(result.message?.includes('demo-skill'));
  assert.ok(result.message?.includes('invokes=1'));
  assert.ok(result.message?.includes('trusted'));

  const alias = await runCmd('skill', sessionId, ['ledger']);
  assert.equal(alias.ok, true);
  assert.ok(alias.message?.includes('demo-skill'));
});

test('/extensions sdk reports SDK extension discovery without loading by default', async () => {
  const { sessionId } = await createLearningSession();

  const result = await runCmd('extensions', sessionId, ['sdk']);

  assert.equal(result.ok, true);
  assert.equal(result.echo, true);
  assert.ok(result.message?.includes('SDK extension discovery'));
  assert.ok(result.message?.includes('Runtime: inactive'));
});

test('/recover candidate uses SDK recovery classifier', async () => {
  const { sessionId } = await createLearningSession();

  const result = await runCmd('recover', sessionId, ['candidate', '8', 'context length exceeded']);

  assert.equal(result.ok, true);
  assert.equal(result.echo, true);
  assert.ok(result.message?.includes('Recovery candidate:'));
});
test('/workflow runs works before workflow manager init', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('workflow', sessionId, ['runs']);
  assert.equal(result.ok, true);
  assert.equal(result.echo, true);
  assert.ok(result.message?.includes('No workflow runs'));
});

test('/workflow help lists full workflow subcommands', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('workflow', sessionId, ['help']);
  assert.equal(result.ok, true);
  assert.ok(result.message?.includes('/workflow delete'));
  assert.ok(result.message?.includes('/workflow prune'));
  assert.ok(result.message?.includes('/workflow rerun'));
  assert.ok(result.message?.includes('/workflow revise'));
  assert.ok(result.message?.includes('/workflow create'));
});

test('/workflow prune --dry-run works before lifecycle init', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('workflow', sessionId, ['prune', '--dry-run']);
  assert.equal(result.ok, true);
  assert.equal(result.echo, true);
  assert.ok(result.message?.includes('Workflow prune preview'));
});

test('/workflow create without request returns usage', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('workflow', sessionId, ['create']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('Usage: /workflow create'));
});

test('/model on unknown session returns session_not_found', async () => {
  const result = await runCmd('model', 's_does_not_exist', ['some-model']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('session not found'));
});

test('/thinking on unknown session returns session_not_found', async () => {
  const result = await runCmd('thinking', 's_does_not_exist', ['on']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('session not found'));
});

test('/thinking with an unsafe effort token returns Usage', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('thinking', sessionId, ['../max']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('SDK effort'));
});

test('unknown command name → getSlashHandler returns undefined', () => {
  const handler = getSlashHandler('nonexistent');
  assert.equal(handler, undefined);
});
