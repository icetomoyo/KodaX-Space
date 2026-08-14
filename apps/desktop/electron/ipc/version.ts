// space.version handler — main 端的第一个真实 channel。
//
// 返回 main 进程能拿到的版本号 + 平台。renderer 用这个值做自检 UI。

import { app, type App } from 'electron';
import { createRequire } from 'node:module';
import { registerChannel } from './register.js';
import type { SpaceCapability, SpaceVersionOutput } from '@kodax-space/space-ipc-schema';
import { isRepoIntelEntitled } from '../kodax/repo-intel-gate.js';
import { runtimeHostAdapter, type RuntimeHostSnapshot } from '../kodax/runtime-host-adapter.js';
import {
  getExperimentalMemorySdkCapability,
  getSandboxSdkCapability,
  type ExperimentalMemorySdkCapability,
} from '../kodax/kodax-sdk-probe.js';
import { sandboxCommandCapability } from '../kodax/sandbox-capability-row.js';

export { sandboxCommandCapability } from '../kodax/sandbox-capability-row.js';

function readSpaceVersion(electronApp: App): string {
  // app.getVersion() 读 packaged 应用的 package.json；dev 模式下可能不是 0.1.0-alpha.0
  // 而是 Electron CLI 默认值（"33.x"）。dev 下用环境变量兜底，保证自检 UI 不混淆。
  if (!electronApp.isPackaged && process.env.npm_package_version) {
    return process.env.npm_package_version;
  }
  return electronApp.getVersion();
}

function readKodaxSdkVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = typeof require !== 'undefined' ? null : (import.meta as any);
    const req = meta ? createRequire(meta.url) : require;
    const pkg = req('@kodax-ai/kodax/package.json') as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function readKodaxDependencySpec(): string {
  const fromEnv =
    process.env.npm_package_dependencies__kodax_ai_kodax ??
    process.env.npm_package_dependencies_kodax_ai_kodax;
  if (fromEnv) return fromEnv;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = typeof require !== 'undefined' ? null : (import.meta as any);
    const req = meta ? createRequire(meta.url) : require;
    const pkg = req('../../package.json') as { dependencies?: Record<string, unknown> };
    const spec = pkg.dependencies?.['@kodax-ai/kodax'];
    return typeof spec === 'string' && spec.length > 0 ? spec : 'unknown';
  } catch {
    return 'unknown';
  }
}

function runtimeHostCapability(snapshot: RuntimeHostSnapshot): SpaceCapability {
  const ready = snapshot.state === 'ready';
  const legacy = snapshot.state === 'legacy';
  const failed = snapshot.state === 'failed';
  const identity = snapshot.identity;
  const detail = ready
    ? `KodaX Runtime ${identity?.version ?? 'unknown'} ${identity?.mode ?? 'embedded'}/${identity?.isolation ?? 'inline'} owns Coder sessions, exclusive Actor trees, durably bounded managed Runs, Auto[LLM] v4 permission classification, resilient integration loading, structured sandbox observations, Workflow observation/control, Learning Center operations, catalog discovery, MCP tool discovery/reload, and configured External Agent Actor/Turns. Space retains Partner inline execution and the host-provider boundaries for MCP processes/logs, Workflow library/start/admin, Reference Agent execution, and product artifacts.`
    : legacy
      ? 'The internal legacy rollback host is selected before run start. No Runtime-managed run is active.'
      : failed
        ? `The Runtime host failed before run start${snapshot.error ? `: ${snapshot.error}` : '.'} Coder runs are blocked instead of falling back to inline execution; Partner remains available on its inline path.`
        : snapshot.state === 'initializing' || snapshot.state === 'uninitialized'
          ? `The Runtime host is ${snapshot.state}. Coder runs wait for initialization and fail closed if it fails; Partner remains available on its inline path.`
          : 'The Runtime host is closed and cannot accept new runs.';
  return {
    id: 'runtime.hostAdapter',
    label: 'Runtime Host Adapter',
    status: ready ? 'supported' : snapshot.state === 'closed' || failed ? 'blocked' : 'partial',
    detail,
    since: '0.1.31',
  };
}

export function experimentalMemoryCapability(
  capability: ExperimentalMemorySdkCapability,
): SpaceCapability {
  if (capability.status === 'available') {
    return {
      id: 'memory.agent.experimental',
      label: 'KodaX Memory Agent',
      status: 'partial',
      detail:
        `The required KodaX experimental-memory contract is available with policy ${capability.policyVersion}. ` +
        'KodaX managed runs own silent scoped recall and governed outcome/review persistence over F228; Space v0.1.41 preserves compatibility diagnostics while the full F117 Episodes, Activity, correction, and purge UX remains planned.',
      since: '0.1.31',
    };
  }
  return {
    id: 'memory.agent.experimental',
    label: 'KodaX Memory Agent',
    status: 'planned',
    detail:
      'The required /experimental-memory contract has not been probed yet. Existing F228 Memory Governance remains available, and startup will fail closed if the exported contract cannot be verified.',
  };
}

function buildCapabilityLedger(
  entitled: boolean,
  runtimeSnapshot: RuntimeHostSnapshot,
): SpaceCapability[] {
  return [
    runtimeHostCapability(runtimeSnapshot),
    experimentalMemoryCapability(getExperimentalMemorySdkCapability()),
    sandboxCommandCapability(getSandboxSdkCapability()),
    {
      id: 'repointel.trace',
      label: 'Repointel trace',
      // Repo-intelligence is a licensed capability — 'blocked' on community/unlicensed
      // builds so the panel matches the runtime gate (real-session forces the engine
      // off) and the chip's locked state.
      status: entitled ? 'supported' : 'blocked',
      detail: entitled
        ? 'KodaX SDK session trace events are mapped into Space session events and shown in the chip and /repointel trace view.'
        : 'Repo-intelligence is a licensed capability — activate a license to enable repo-intel and its trace events. Without a license Space forces the engine off and the chip shows a locked state.',
      since: '0.1.19',
    },
    {
      id: 'repointel.status',
      label: 'Repointel local status',
      status: entitled ? 'supported' : 'blocked',
      detail: entitled
        ? 'Space exposes KodaX 0.7.57 built-in repo-intelligence inspection for project, git root, trace source, worker/cache health, and best-effort warm support.'
        : 'Repo-intelligence is a licensed capability. /repointel status still inspects project/git/entitlement, but warm and repo-aware assistance require an active license.',
    },
    {
      id: 'quickAsk.tempSession',
      label: 'Quick Ask temporary session',
      status: 'supported',
      detail:
        'Quick Ask uses a plan-mode temporary KodaX session, captures events locally, cleans up on close, and can promote the persisted session into Coder.',
      since: '0.1.19',
    },
    {
      id: 'quickAsk.sideQuery',
      label: 'Quick Ask side query',
      status: 'partial',
      detail:
        'KodaX exposes sideQuery through @kodax-ai/kodax/llm; Space still uses temporary sessions until Quick Ask promotion/history semantics are matched.',
    },
    {
      id: 'reasoning.effortV2',
      label: 'Reasoning effort v2',
      status: 'supported',
      detail:
        'Space maps its five existing effort choices to KodaX 0.7.57 canonical effort values at SDK boundaries and reads the new KodaX config effort default with legacy reasoning fallback.',
    },
    {
      id: 'handoff.receive',
      label: 'Handoff receiver',
      status: 'supported',
      detail:
        'Space watches ~/.kodax/handoffs, lists valid/invalid/stale handoffs, and can accept or dismiss receiver-side handoff files.',
    },
    {
      id: 'composer.imageArtifacts',
      label: 'Composer image artifacts',
      status: 'supported',
      detail:
        'Space sends PNG/JPEG/WEBP image artifacts through KodaX inputArtifacts, preserves KodaX 0.7.56 source provenance for clipboard and drag-drop inputs, supports native clipboard-image fallback, and preflights image artifacts against the selected provider/model before send.',
      since: '0.1.24',
    },
    {
      id: 'composer.mediaHelpers',
      label: 'SDK media helpers',
      status: 'partial',
      detail:
        'Space now uses KodaX 0.7.56 media helpers for native clipboard normalization, sandboxed image artifact construction, and provider/model validation. GIF direct-path handling, structured file artifacts, and video follow-ups remain planned.',
      since: '0.1.24',
    },
    {
      id: 'externalAgents.reference',
      label: 'Reference External Agent executor',
      status: 'supported',
      detail:
        'KodaX 0.7.72 Runtime-configured External Agents use the daemon Actor/Turn control plane for Coder discovery, preflight, tasks, events, input, interruption, and reconciliation. Space Reference Agents remain a host-provider path with durable Task Dock behavior; MCP Tasks and governed HTTP remain gated until their adapters ship.',
      since: '0.1.30',
    },
  ];
}

export function registerVersionChannel(): void {
  registerChannel('space.version', async (): Promise<SpaceVersionOutput> => {
    const platform = process.platform;
    if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
      throw new Error(`unsupported platform: ${platform}`);
    }
    // Repo-intelligence rows are licensed — reflect entitlement so the capability panel
    // matches the runtime gate + chip lock (community build → 'blocked'). Fail-closed
    // (see repo-intel-gate.ts).
    const entitled = await isRepoIntelEntitled();
    return {
      spaceVersion: readSpaceVersion(app),
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      platform,
      kodaxSdkVersion: readKodaxSdkVersion(),
      kodaxDependencySpec: readKodaxDependencySpec(),
      capabilityContract: 'space-v0.1.41',
      capabilities: buildCapabilityLedger(entitled, runtimeHostAdapter.snapshot()),
    };
  });
}
