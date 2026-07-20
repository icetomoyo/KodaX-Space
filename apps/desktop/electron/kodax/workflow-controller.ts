// WorkflowController (F060) — Space main 侧的工作流进程事件管线。
//
// 对标 KodaX SDK FEATURE_229(0.7.50):工作流进度是可订阅的一等进程。本控制器:
//   1. 订阅 SDK 进程级 run manager 的 WorkflowProcessEvent 流(getDefaultWorkflowRunManager)
//   2. 给每个 snapshot 附上 host 归属(runId → {sessionId, surface})
//   3. 转发到 renderer(pushToRenderer('workflow.event', ...))
//   4. 给 IPC handler 提供 list/get(切 session 时播种)
//
// **Space 零编排**:只搬运 SDK 的 snapshot,绝不折叠底层 WorkflowEvent、绝不自己跑工作流。
//
// 归属 interim(SDK 缺口,已开需求):snapshot 不带 host 归属字段,Space 在 main 侧维护一张
// 自持久化的 runId→{sessionId,surface} 映射(F063/F064 启动时 registerOrigin)。落
// ~/.kodax/space/workflow-origins.json,进程重启仍可归属。SDK 补 origin 字段后此映射可下线。

import { promises as fs, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { WorkflowRunT, WorkflowEventPayload } from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from './data-paths.js';
import { pushToRenderer } from '../ipc/push.js';
import { artifactStore } from '../artifact/store.js';
import { detectArtifactKind } from '../artifact/workflow-artifact-bridge.js';
import { resolveWireEffort, type ReasoningProfileLike } from './reasoning-effort.js';
import { workflowPolicyStore, buildWorkflowHostPolicy } from './workflow-policy.js';
import { externalAgentGateway } from './external-agent-gateway.js';
import { repoIntelContextFields } from './repo-intel-gate.js';
import { replaceFileWithoutFollowingAliases } from './atomic-file.js';

// ---- SDK 形状(只取本控制器用到的子集,避免硬依赖 SDK 类型导出) ----
interface SdkProcessSnapshot {
  readonly runId: string;
  readonly hostMetadata?: Record<string, string>;
  readonly [k: string]: unknown;
}
type SdkProcessEvent = {
  readonly type: 'workflow_started' | 'workflow_updated' | 'workflow_finished';
  readonly snapshot: SdkProcessSnapshot;
  readonly message?: string;
};
export interface WorkflowRunManagerLike {
  subscribeWorkflowProcess(listener: (event: SdkProcessEvent) => void): () => void;
  getWorkflowProcessSnapshot(runId: string): SdkProcessSnapshot | undefined;
  listWorkflowProcessSnapshots(options?: {
    activeOnly?: boolean;
    limit?: number;
  }): readonly SdkProcessSnapshot[];
  /** F063 启动:把已解析的 module + options 提交到进程管理器,事件经订阅回流。可能异步。 */
  startFromOptions(input: Record<string, unknown>): unknown | Promise<unknown>;
}

// ---- F063 库 / 启动 类型 ----
export interface WorkflowMetaLite {
  readonly name: string;
  readonly description: string;
  readonly plannedAgents?: number;
  readonly maxAgents?: number;
  readonly readOnly?: boolean;
  // mutable array：与 IPC 出参 schema 推断的 string[] 对齐（SDK 给 readonly，cast 时收敛）。
  readonly phases?: string[];
}
export interface SavedWorkflowLite {
  readonly name: string;
  readonly path: string;
  readonly source?: string;
  readonly execution?: string;
}
export interface WorkflowPatternLite {
  readonly name: string;
  readonly pattern: string;
  readonly description: string;
}
export interface WorkflowLibrary {
  readonly builtin: WorkflowMetaLite[];
  readonly patterns: WorkflowPatternLite[];
  readonly saved: SavedWorkflowLite[];
}
export interface WorkflowPreflight {
  readonly ok: boolean;
  readonly issues: { readonly severity?: string; readonly message: string }[];
}
/** 发起方 session 的精简字段——足够给 workflow 子 agent 建 KodaXOptions。 */
export interface LaunchSession {
  readonly sessionId: string;
  readonly surface: 'code' | 'partner';
  readonly provider: string;
  readonly model?: string;
  readonly reasoningMode: string;
  readonly agentMode: string;
  readonly projectRoot: string;
}
export interface LaunchInput {
  /** built-in name 或 saved 文件路径。 */
  readonly target: string;
  readonly source: 'builtin' | 'saved';
  readonly args?: unknown;
  readonly agentTarget?: {
    readonly agentId: string;
    readonly expectedConfigurationRevision?: string;
  };
  readonly session: LaunchSession;
}
export type WorkflowStartResult = { readonly runId: string } | { readonly error: string };
export type WorkflowSavedResult =
  | { readonly name: string; readonly path: string; readonly previousPath?: string }
  | { readonly error: string };

type WorkflowAgentTargetLite = NonNullable<LaunchInput['agentTarget']>;

/**
 * Apply a launcher-selected default target without rewriting saved workflow source.
 * Explicit targets authored by the workflow keep precedence; only ordinary local
 * child spawns are projected through the selected catalog entry.
 */
export function withDefaultWorkflowAgentTarget(
  module: unknown,
  target: WorkflowAgentTargetLite | undefined,
): unknown {
  if (!target || !module || typeof module !== 'object') return module;
  const workflowModule = module as {
    readonly run?: (workflow: object, args: unknown) => unknown;
    readonly [key: string]: unknown;
  };
  if (typeof workflowModule.run !== 'function') return module;
  return {
    ...workflowModule,
    run(workflow: object, args: unknown): unknown {
      const routed = new Proxy(workflow, {
        get(source, property, receiver) {
          const value = Reflect.get(source, property, receiver) as unknown;
          if (
            (property === 'spawnAgent' || property === 'runAgent') &&
            typeof value === 'function'
          ) {
            return (input: Record<string, unknown>) =>
              (value as (next: Record<string, unknown>) => unknown).call(source, {
                ...input,
                ...(input.target === undefined ? { target } : {}),
              });
          }
          return typeof value === 'function' ? value.bind(source) : value;
        },
      });
      return workflowModule.run?.(routed, args);
    },
  };
}

// F062 run 生命周期控制——SDK createWorkflowLifecycleController 的子集(只取本控制器用到的)。
export interface WorkflowRetentionResult {
  readonly deleted: number;
  readonly protectedRuns: number;
  readonly candidates: readonly string[];
  readonly dryRun: boolean;
}
export interface WorkflowLifecycleLike {
  stopWorkflow(runId: string, reason?: string): Promise<boolean>;
  pauseWorkflow(runId: string): Promise<boolean>;
  resumeWorkflow(runId: string): Promise<boolean>;
  renameWorkflowRun(runId: string, displayName: string): Promise<boolean>;
  deleteWorkflowRun(runId: string, options?: { force?: boolean }): Promise<boolean>;
  pruneWorkflowRuns(options: {
    keep?: number;
    olderThanDays?: number;
    dryRun?: boolean;
  }): Promise<WorkflowRetentionResult>;
  // F066 结果 / artifact 读取。
  readWorkflowResult(runId: string): Promise<string | undefined>;
  readWorkflowArtifact(runId: string, name: string): Promise<unknown | undefined>;
}

export interface WorkflowOrigin {
  readonly sessionId?: string;
  readonly surface?: 'code' | 'partner';
  readonly projectRoot?: string;
}

type PushFn = (payload: WorkflowEventPayload) => void;

// 映射上限——防止长跑进程里 origins 无界增长(终态 run 的归属不再变,留最近 N 条即可)。
const MAX_ORIGINS = 500;
// Path-safety guard for a durable run-dir name / renderer-supplied runId: it must be a single
// filename token (no separators, no `.`/`..`) so path.join(runBaseDir, runId) can't escape the
// base dir. It is NOT an "is this a Space-generated id" check — it MUST accept both Space's own
// `wf_<uuid>` ids and the SDK's model-owned run_workflow ids of the form `run-<...>`.
//
// Regression fix: the old `^wf_...` form silently excluded every model-owned `run-...` run from the
// durable disk scan (listDurableWorkflowSnapshots) and the get()/result path resolver — so after
// a restart those runs, and all their transcript notices + left/right-sidebar UI, disappeared,
// even though their run.json and hostMetadata.sessionId were correctly persisted on disk. The
// conversation was unaffected (separate SDK transcript), which is exactly the reported symptom.
const SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const IPC_SHORT_MAX = 256;
const IPC_MSG_MAX = 8192;
const IPC_PATH_MAX = 4096;
const IPC_MAX_ITEMS = 4096;
const IPC_MAX_ARTIFACTS = 512;
const IPC_MAX_PATTERNS = 16;
const HOST_METADATA_PATTERNS_KEY = 'workflowPatterns';

const SNAPSHOT_SHORT_FIELDS = [
  'workflowName',
  'displayName',
  'savedWorkflowName',
  'sourceRunId',
  'sourceWorkflowName',
  'revisionOf',
  'activePhaseId',
  'startedAt',
  'updatedAt',
] as const;
const SNAPSHOT_MSG_FIELDS = ['goal', 'latestMessage', 'resultSummary', 'error'] as const;
const ITEM_SHORT_FIELDS = [
  'id',
  'title',
  'phaseId',
  'parentId',
  'agentId',
  'childAgentId',
  'provider',
  'model',
  'startedAt',
  'endedAt',
] as const;
const ITEM_MSG_FIELDS = ['summary', 'error'] as const;

function nonnegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function clampPlainText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

function clampHumanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length <= max) return value;
  const suffix = '\n[truncated]';
  if (max <= suffix.length) return value.slice(0, max);
  return `${value.slice(0, max - suffix.length)}${suffix}`;
}

function clampStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const safeValue = clampHumanText(rawValue, IPC_MSG_MAX);
    if (safeValue !== undefined) out[key] = safeValue;
  }
  return out;
}

function normalizeWorkflowPatterns(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    const pattern = clampPlainText(item, IPC_SHORT_MAX)?.trim();
    if (!pattern || out.includes(pattern)) continue;
    out.push(pattern);
    if (out.length >= IPC_MAX_PATTERNS) break;
  }
  return out.length > 0 ? out : undefined;
}

function parseWorkflowPatternsFromHostMetadata(
  hostMetadata: Record<string, string> | undefined,
): string[] | undefined {
  const raw = hostMetadata?.[HOST_METADATA_PATTERNS_KEY] ?? hostMetadata?.patterns;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    const patterns = normalizeWorkflowPatterns(parsed);
    if (patterns) return patterns;
  } catch {
    // Older/debug snapshots may store a comma-separated list.
  }
  return normalizeWorkflowPatterns(raw.split(',').map((p) => p.trim()));
}

function normalizeWorkflowItem(item: unknown): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const raw = item as Record<string, unknown>;
  const next: Record<string, unknown> = { ...raw };
  for (const key of ITEM_SHORT_FIELDS) {
    const value = clampPlainText(raw[key], IPC_SHORT_MAX);
    if (value !== undefined) next[key] = value;
  }
  for (const key of ITEM_MSG_FIELDS) {
    const value = clampHumanText(raw[key], IPC_MSG_MAX);
    if (value !== undefined) next[key] = value;
  }
  return next;
}

function normalizeWorkflowArtifact(artifact: unknown): unknown {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return artifact;
  const raw = artifact as Record<string, unknown>;
  const next: Record<string, unknown> = { ...raw };
  const name = clampPlainText(raw.name, IPC_SHORT_MAX);
  const artifactPath = clampPlainText(raw.path, IPC_PATH_MAX);
  const description = clampHumanText(raw.description, IPC_MSG_MAX);
  if (name !== undefined) next.name = name;
  if (artifactPath !== undefined) next.path = artifactPath;
  if (description !== undefined) next.description = description;
  return next;
}

function normalizeWorkflowProcessSource(value: unknown): WorkflowRunT['source'] | undefined {
  // KodaX 0.7.72 retired AMAW. Historical records remain readable, but their
  // provenance is exposed through the canonical explicit-command source.
  if (value === 'amaw') return 'command';
  if (
    value === 'command' ||
    value === 'review' ||
    value === 'sdk' ||
    value === 'capsule' ||
    value === 'extension' ||
    value === 'automation'
  ) {
    return value;
  }
  return undefined;
}

function normalizeWorkflowSnapshot(
  snapshot: SdkProcessSnapshot,
  extraPatterns?: readonly string[],
): WorkflowRunT {
  const raw = snapshot as Record<string, unknown>;
  const next: Record<string, unknown> = { ...raw };
  const source = normalizeWorkflowProcessSource(raw.source);
  if (source === undefined) delete next.source;
  else next.source = source;
  for (const key of SNAPSHOT_SHORT_FIELDS) {
    const value = clampPlainText(raw[key], IPC_SHORT_MAX);
    if (value !== undefined) next[key] = value;
  }
  for (const key of SNAPSHOT_MSG_FIELDS) {
    const value = clampHumanText(raw[key], IPC_MSG_MAX);
    if (value !== undefined) next[key] = value;
  }
  const hostMetadata = clampStringRecord(raw.hostMetadata);
  if (hostMetadata !== undefined) next.hostMetadata = hostMetadata;
  const patterns =
    normalizeWorkflowPatterns(raw.patterns) ??
    normalizeWorkflowPatterns(extraPatterns) ??
    parseWorkflowPatternsFromHostMetadata(hostMetadata);
  if (patterns !== undefined) next.patterns = patterns;
  if (Array.isArray(raw.items)) {
    next.items = raw.items.slice(0, IPC_MAX_ITEMS).map(normalizeWorkflowItem);
  }
  if (Array.isArray(raw.artifacts)) {
    next.artifacts = raw.artifacts.slice(0, IPC_MAX_ARTIFACTS).map(normalizeWorkflowArtifact);
  }
  return next as unknown as WorkflowRunT;
}

function readWorkflowManifestPatterns(
  manifestPath: unknown,
  runId: string,
  runBaseDir: string,
): string[] | undefined {
  const candidates: string[] = [];
  if (
    typeof manifestPath === 'string' &&
    manifestPath.length > 0 &&
    manifestPath.length <= IPC_PATH_MAX
  ) {
    candidates.push(manifestPath);
  }
  const runDir = generatedRunDir(runBaseDir, runId);
  if (runDir !== null) candidates.push(path.join(runDir, 'manifest.json'));

  const base = path.resolve(runBaseDir);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const relative = path.relative(base, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    try {
      const parsed = JSON.parse(readFileSync(resolved, 'utf8')) as { patterns?: unknown };
      const patterns = normalizeWorkflowPatterns(parsed.patterns);
      if (patterns) return patterns;
    } catch {
      // Missing or invalid manifest should not break progress rendering.
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readJsonLines(filePath: string): Record<string, unknown>[] {
  try {
    return readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .flatMap((line) => {
        const trimmed = line.trim();
        if (!trimmed) return [];
        try {
          const parsed = JSON.parse(trimmed);
          return isRecord(parsed) ? [parsed] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function isoTimestamp(value: unknown, fallback?: string): string {
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value.slice(0, IPC_SHORT_MAX);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return fallback ?? new Date(0).toISOString();
}

function workflowStatus(value: unknown): WorkflowRunT['status'] {
  return value === 'running' ||
    value === 'paused' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
    ? value
    : 'completed';
}

function workflowItemStatus(value: unknown, fallback: WorkflowRunT['items'][number]['status']) {
  return value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'skipped'
    ? value
    : fallback;
}

function durableWorkflowName(raw: Record<string, unknown>, runId: string): string {
  return (
    clampPlainText(raw.workflowName, IPC_SHORT_MAX) ??
    clampPlainText(raw.workflow, IPC_SHORT_MAX) ??
    clampPlainText(raw.displayName, IPC_SHORT_MAX) ??
    runId
  );
}

function durableGoal(raw: Record<string, unknown>): string | undefined {
  const direct = clampHumanText(raw.goal, IPC_MSG_MAX);
  if (direct !== undefined) return direct;
  const args = raw.args;
  if (!isRecord(args)) return undefined;
  return clampHumanText(args.request, IPC_MSG_MAX);
}

function durableArtifacts(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, IPC_MAX_ARTIFACTS).flatMap((item) => {
    if (typeof item === 'string') return [{ name: item }];
    if (isRecord(item)) return [item];
    return [];
  });
}

function readWorkflowManifest(runDir: string): Record<string, unknown> | null {
  return readJsonObject(path.join(runDir, 'manifest.json'));
}

function manifestPhaseTitles(manifest: Record<string, unknown> | null): string[] {
  const phases = manifest?.phases;
  if (!Array.isArray(phases)) return [];
  return phases.flatMap((phase) => {
    const title = clampPlainText(phase, IPC_SHORT_MAX);
    return title ? [title] : [];
  });
}

function artifactNamesFromDir(runDir: string): string[] {
  try {
    return readdirSync(path.join(runDir, 'artifacts'), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .flatMap((entry) => {
        const name = entry.name.endsWith('.json')
          ? entry.name.slice(0, -'.json'.length)
          : entry.name;
        return safeArtifactName(name) ? [name] : [];
      })
      .slice(0, IPC_MAX_ARTIFACTS);
  } catch {
    return [];
  }
}

function durableArtifactList(
  rawArtifacts: unknown,
  runDir: string,
  events: readonly Record<string, unknown>[],
): unknown[] {
  const names = new Map<string, unknown>();
  for (const artifact of durableArtifacts(rawArtifacts)) {
    if (!isRecord(artifact)) continue;
    const name = clampPlainText(artifact.name, IPC_SHORT_MAX);
    if (name) names.set(name, artifact);
  }
  for (const event of events) {
    if (event.type !== 'artifact_written') continue;
    const data = isRecord(event.data) ? event.data : {};
    const name = clampPlainText(data.name, IPC_SHORT_MAX);
    if (name && !names.has(name)) names.set(name, { name });
  }
  for (const name of artifactNamesFromDir(runDir)) {
    if (!names.has(name)) names.set(name, { name });
  }
  return [...names.values()].slice(0, IPC_MAX_ARTIFACTS);
}

function countDurableItems(items: readonly unknown[]): WorkflowRunT['counts'] {
  const counts: WorkflowRunT['counts'] = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
  };
  for (const item of items) {
    if (!isRecord(item)) continue;
    const status = item.status;
    if (
      status === 'pending' ||
      status === 'running' ||
      status === 'completed' ||
      status === 'failed' ||
      status === 'cancelled' ||
      status === 'skipped'
    ) {
      counts[status] += 1;
    }
  }
  return counts;
}

function summaryStatusFromKind(value: unknown): WorkflowRunT['items'][number]['summaryStatus'] {
  if (value === 'notice') return 'notice';
  if (value === 'pending') return 'pending';
  if (value === 'unavailable') return 'unavailable';
  return 'result';
}

function durableItemsFromEvents(
  runDir: string,
  terminalStatus: WorkflowRunT['status'],
  events: readonly Record<string, unknown>[] = readJsonLines(path.join(runDir, 'events.jsonl')),
  manifestPhases = manifestPhaseTitles(readWorkflowManifest(runDir)),
): unknown[] {
  if (events.length === 0) return [];

  const items: WorkflowRunT['items'] = [];
  const phases = new Map<string, WorkflowRunT['items'][number]>();
  const agents = new Map<string, WorkflowRunT['items'][number]>();
  let currentPhaseId: string | undefined;
  let phaseIndex = 0;

  const pushItem = (item: WorkflowRunT['items'][number]) => {
    if (items.length >= IPC_MAX_ITEMS) return;
    items.push(item);
  };
  const phaseKey = (value: string | undefined) => value?.trim().toLowerCase() ?? '';
  const phaseById = (id: string | undefined) => items.find((item) => item.id === id);
  const ensurePhase = (title: string, startedAt?: string): WorkflowRunT['items'][number] => {
    const key = phaseKey(title);
    const existing = phases.get(key);
    if (existing) {
      if (startedAt && existing.status === 'pending') {
        existing.status = 'running';
        existing.startedAt = startedAt;
      }
      return existing;
    }
    phaseIndex += 1;
    const item: WorkflowRunT['items'][number] = {
      id: `phase-${phaseIndex}`,
      title,
      kind: 'phase',
      status: startedAt ? 'running' : 'pending',
      ...(startedAt ? { startedAt } : {}),
    };
    phases.set(key, item);
    pushItem(item);
    return item;
  };
  // Only an EXACT phase-name match pins an agent at reconstruction time. Fuzzy matching and
  // the stable "parallel" bucket for everything else are handled uniformly in the renderer's
  // buildWorkflowGraph. Deliberately NO running/last-phase fallback here — that was the
  // durable-path twin of the frontier bug: on a completed run it lifted every unmatched
  // agent into the LAST phase (e.g. an orphan analysis agent showing under `synthesis`).
  const findEventPhaseId = (title?: string): string | undefined => phases.get(phaseKey(title))?.id;

  for (const title of manifestPhases) {
    ensurePhase(title);
  }

  for (const event of events) {
    const type = clampPlainText(event.type, IPC_SHORT_MAX);
    const data = isRecord(event.data) ? event.data : {};
    const ts = isoTimestamp(event.ts);
    if (type === 'phase_started') {
      const title = clampPlainText(data.name, IPC_SHORT_MAX) ?? `Phase ${phaseIndex}`;
      const item = ensurePhase(title, ts);
      currentPhaseId = item.id;
      continue;
    }
    if (type === 'phase_finished') {
      const title = clampPlainText(data.name, IPC_SHORT_MAX);
      const phase =
        (title ? phases.get(phaseKey(title)) : undefined) ??
        (currentPhaseId ? phaseById(currentPhaseId) : undefined);
      if (phase) {
        phase.status = 'completed';
        phase.endedAt = ts;
      }
      if (phase?.id === currentPhaseId) currentPhaseId = undefined;
      continue;
    }
    if (type === 'agent_spawned') {
      const id = clampPlainText(data.taskId, IPC_SHORT_MAX) ?? `agent-${agents.size + 1}`;
      const title = clampPlainText(data.name, IPC_SHORT_MAX) ?? id;
      const phaseId = findEventPhaseId(title);
      const item: WorkflowRunT['items'][number] = {
        id,
        title,
        kind: 'agent',
        status: 'running',
        agentId: id,
        childAgentId: id,
        ...(phaseId !== undefined ? { phaseId } : {}),
        startedAt: ts,
      };
      agents.set(id, item);
      pushItem(item);
      continue;
    }
    if (
      type === 'agent_completed' ||
      type === 'agent_failed' ||
      type === 'agent_cancelled' ||
      type === 'agent_stopped'
    ) {
      const id = clampPlainText(data.taskId, IPC_SHORT_MAX) ?? `agent-${agents.size + 1}`;
      const existing = agents.get(id);
      const title = clampPlainText(data.name, IPC_SHORT_MAX) ?? id;
      const phaseId = findEventPhaseId(title);
      const item =
        existing ??
        ({
          id,
          title,
          kind: 'agent',
          status: 'running',
          agentId: id,
          childAgentId: id,
          ...(phaseId !== undefined ? { phaseId } : {}),
        } satisfies WorkflowRunT['items'][number]);
      if (!existing) {
        agents.set(id, item);
        pushItem(item);
      }
      item.status = workflowItemStatus(
        data.status,
        type === 'agent_failed'
          ? 'failed'
          : type === 'agent_cancelled' || type === 'agent_stopped'
            ? 'cancelled'
            : 'completed',
      );
      item.endedAt = ts;
      const provider = clampPlainText(data.provider, IPC_SHORT_MAX);
      if (provider !== undefined) item.provider = provider;
      const model = clampPlainText(data.model, IPC_SHORT_MAX);
      if (model !== undefined) item.model = model;
      const summaryKind = data.summaryKind;
      const summary = clampHumanText(data.summary, IPC_MSG_MAX);
      if (summaryKind !== 'pending' && summary !== undefined) {
        item.summary = summary;
        item.summaryStatus = summaryStatusFromKind(summaryKind);
      } else if (summaryKind === 'pending') {
        item.summaryStatus = 'pending';
      }
      const error = clampHumanText(data.error, IPC_MSG_MAX);
      if (error !== undefined) item.error = error;
      continue;
    }
    if (type === 'agent_summary_updated') {
      const id = clampPlainText(data.taskId, IPC_SHORT_MAX);
      if (!id) continue;
      const item = agents.get(id);
      if (!item) continue;
      const summary = clampHumanText(data.summary, IPC_MSG_MAX);
      if (summary !== undefined) {
        item.summary = summary;
        item.summaryStatus = summaryStatusFromKind(data.summaryKind);
      }
      continue;
    }
    if (type === 'artifact_written') {
      const title = clampPlainText(data.name, IPC_SHORT_MAX);
      if (!title) continue;
      const phaseId = findEventPhaseId(title);
      pushItem({
        id: `artifact-${items.length + 1}`,
        title,
        kind: 'artifact',
        status: 'completed',
        ...(phaseId !== undefined ? { phaseId } : {}),
        endedAt: ts,
      });
    }
  }

  if (terminalStatus !== 'running' && terminalStatus !== 'paused') {
    for (const item of items) {
      if (item.status === 'running') {
        item.status = terminalStatus === 'failed' ? 'failed' : 'completed';
      }
    }
  }
  return items;
}

function terminalStatusFromEvents(
  events: readonly Record<string, unknown>[],
  hasArtifacts: boolean,
): WorkflowRunT['status'] {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const type = events[i]?.type;
    if (type === 'workflow_completed') return 'completed';
    if (type === 'workflow_failed') return 'failed';
    if (type === 'workflow_cancelled') return 'cancelled';
  }
  if (hasArtifacts || events.some((event) => event.type === 'synthesis_completed'))
    return 'completed';
  return 'cancelled';
}

function eventResultSummary(events: readonly Record<string, unknown>[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;
    const data = isRecord(event.data) ? event.data : {};
    const summary = clampHumanText(data.resultSummary, IPC_MSG_MAX);
    if (summary !== undefined) return summary;
  }
  return undefined;
}

function eventError(events: readonly Record<string, unknown>[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;
    const data = isRecord(event.data) ? event.data : {};
    const error = clampHumanText(data.error, IPC_MSG_MAX);
    if (error !== undefined) return error;
  }
  return undefined;
}

function durableCounts(
  raw: Record<string, unknown>,
  items: readonly unknown[],
): WorkflowRunT['counts'] {
  const counts = raw.counts;
  if (!isRecord(counts)) return countDurableItems(items);
  return {
    pending: nonnegativeInt(counts.pending),
    running: nonnegativeInt(counts.running),
    completed: nonnegativeInt(counts.completed),
    failed: nonnegativeInt(counts.failed),
    cancelled: nonnegativeInt(counts.cancelled),
    skipped: nonnegativeInt(counts.skipped),
  };
}

function durableProgress(
  raw: Record<string, unknown>,
  status: WorkflowRunT['status'],
  items: readonly unknown[],
): WorkflowRunT['progress'] {
  if (isRecord(raw.progress)) {
    return {
      spawnedAgents: nonnegativeInt(raw.progress.spawnedAgents),
      finishedAgents: nonnegativeInt(raw.progress.finishedAgents),
      activeAgents: nonnegativeInt(raw.progress.activeAgents),
      failedAgents: nonnegativeInt(raw.progress.failedAgents),
      stoppedAgents: nonnegativeInt(raw.progress.stoppedAgents),
      ...(typeof raw.progress.agentCap === 'number'
        ? { agentCap: nonnegativeInt(raw.progress.agentCap) }
        : {}),
      ...(typeof raw.progress.plannedItems === 'number'
        ? { plannedItems: nonnegativeInt(raw.progress.plannedItems) }
        : {}),
    };
  }
  const totalSpawned =
    nonnegativeInt(raw.totalSpawned) ||
    items.filter((item) => isRecord(item) && item.kind === 'agent').length;
  const failedAgents = items.filter((item) => isRecord(item) && item.status === 'failed').length;
  const stoppedAgents = items.filter(
    (item) => isRecord(item) && item.status === 'cancelled',
  ).length;
  const activeAgents =
    status === 'running'
      ? items.filter((item) => isRecord(item) && item.status === 'running').length
      : 0;
  const finishedAgents = Math.max(0, totalSpawned - activeAgents - failedAgents - stoppedAgents);
  return {
    spawnedAgents: totalSpawned,
    finishedAgents,
    activeAgents,
    failedAgents,
    stoppedAgents,
    ...(totalSpawned > 0 ? { plannedItems: totalSpawned } : {}),
  };
}

function durableSnapshotFromRunJson(
  raw: Record<string, unknown>,
  runId: string,
  runDir: string,
): SdkProcessSnapshot | null {
  const id = clampPlainText(raw.runId, IPC_SHORT_MAX) ?? runId;
  if (id !== runId) return null;
  const status = workflowStatus(raw.status);
  const startedAt = isoTimestamp(raw.startedAt);
  const updatedAt = isoTimestamp(raw.updatedAt ?? raw.endedAt, startedAt);
  const events = readJsonLines(path.join(runDir, 'events.jsonl'));
  const manifest = readWorkflowManifest(runDir);
  const manifestPhases = manifestPhaseTitles(manifest);
  const patterns =
    normalizeWorkflowPatterns(raw.patterns) ?? normalizeWorkflowPatterns(manifest?.patterns);
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items =
    rawItems.length > 0 ? rawItems : durableItemsFromEvents(runDir, status, events, manifestPhases);
  const workflowName = durableWorkflowName(raw, runId);
  const goal = durableGoal(raw);
  const artifacts = durableArtifactList(raw.artifacts, runDir, events);
  return {
    ...raw,
    runId,
    workflowName,
    displayName: clampPlainText(raw.displayName, IPC_SHORT_MAX) ?? workflowName,
    status,
    startedAt,
    updatedAt,
    items,
    counts: durableCounts(raw, items),
    progress: durableProgress(raw, status, items),
    artifacts,
    ...(patterns !== undefined ? { patterns } : {}),
    ...(typeof raw.phaseCount === 'number'
      ? {}
      : { phaseCount: manifestPhases.length || undefined }),
    ...(goal !== undefined ? { goal } : {}),
    manifestSnapshotPath:
      clampPlainText(raw.manifestSnapshotPath, IPC_PATH_MAX) ?? path.join(runDir, 'manifest.json'),
    scriptSnapshotPath:
      clampPlainText(raw.scriptSnapshotPath, IPC_PATH_MAX) ?? path.join(runDir, 'script.js'),
  };
}

function readDurableWorkflowSnapshot(
  runBaseDir: string,
  runId: string,
): SdkProcessSnapshot | undefined {
  const runDir = generatedRunDir(runBaseDir, runId);
  if (runDir === null) return undefined;
  const raw = readJsonObject(path.join(runDir, 'run.json'));
  if (raw) return durableSnapshotFromRunJson(raw, runId, runDir) ?? undefined;
  const events = readJsonLines(path.join(runDir, 'events.jsonl'));
  if (events.length === 0) return undefined;
  return durableSnapshotFromEvents(runId, runDir, events);
}

function durableSnapshotFromEvents(
  runId: string,
  runDir: string,
  events: readonly Record<string, unknown>[],
): SdkProcessSnapshot | undefined {
  const manifest = readWorkflowManifest(runDir);
  const artifactList = durableArtifactList([], runDir, events);
  const status = terminalStatusFromEvents(events, artifactList.length > 0);
  const startedAt = isoTimestamp(events[0]?.ts);
  const updatedAt = isoTimestamp(events.at(-1)?.ts, startedAt);
  const items = durableItemsFromEvents(runDir, status, events, manifestPhaseTitles(manifest));
  const startedEvent = events.find((event) => event.type === 'workflow_started');
  const startedData = isRecord(startedEvent?.data) ? startedEvent.data : {};
  const workflowName =
    clampPlainText(manifest?.name, IPC_SHORT_MAX) ??
    clampPlainText(startedData.workflowName ?? startedData.name, IPC_SHORT_MAX) ??
    runId;
  return {
    runId,
    workflowName,
    displayName: workflowName,
    status,
    startedAt,
    updatedAt,
    items,
    counts: countDurableItems(items),
    progress: durableProgress({ totalSpawned: undefined }, status, items),
    artifacts: artifactList,
    patterns: normalizeWorkflowPatterns(manifest?.patterns),
    phaseCount: manifestPhaseTitles(manifest).length || undefined,
    ...(eventResultSummary(events) !== undefined
      ? { resultSummary: eventResultSummary(events) }
      : {}),
    ...(eventError(events) !== undefined ? { error: eventError(events) } : {}),
    latestMessage:
      status === 'completed'
        ? 'workflow completed'
        : status === 'failed'
          ? 'workflow failed'
          : 'workflow interrupted before completion metadata was written',
    manifestSnapshotPath: path.join(runDir, 'manifest.json'),
    scriptSnapshotPath: path.join(runDir, 'script.js'),
  };
}

function artifactContentText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    for (const key of ['report', 'markdown', 'content', 'text', 'body', 'summary']) {
      const text = value[key];
      if (typeof text === 'string') return text;
    }
  }
  if (value !== undefined) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return undefined;
}

function safeArtifactName(name: string): string | undefined {
  const clamped = clampPlainText(name, IPC_SHORT_MAX)?.trim();
  if (!clamped || clamped.includes('/') || clamped.includes('\\')) return undefined;
  return clamped;
}

function readDurableWorkflowArtifact(
  runBaseDir: string,
  runId: string,
  name: string,
): unknown | undefined {
  const runDir = generatedRunDir(runBaseDir, runId);
  const safeName = safeArtifactName(name);
  if (runDir === null || safeName === undefined) return undefined;
  const artifactsDir = path.join(runDir, 'artifacts');
  const candidates = [
    path.join(artifactsDir, `${safeName}.json`),
    path.join(artifactsDir, safeName),
  ];
  const artifactsBase = path.resolve(artifactsDir);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const relative = path.relative(artifactsBase, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    try {
      const raw = readFileSync(resolved, 'utf8');
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

function readDurableWorkflowResult(runBaseDir: string, runId: string): string | undefined {
  const runDir = generatedRunDir(runBaseDir, runId);
  if (runDir === null) return undefined;
  const raw = readJsonObject(path.join(runDir, 'run.json'));
  const events = readJsonLines(path.join(runDir, 'events.jsonl'));
  const artifacts = durableArtifactList(raw?.artifacts, runDir, events);
  for (const artifact of artifacts) {
    const name =
      typeof artifact === 'string'
        ? artifact
        : isRecord(artifact)
          ? clampPlainText(artifact.name, IPC_SHORT_MAX)
          : undefined;
    if (!name) continue;
    const text = artifactContentText(readDurableWorkflowArtifact(runBaseDir, runId, name));
    if (text !== undefined && text.trim().length > 0) {
      return clampHumanText(text, 1_048_576);
    }
  }
  return clampHumanText(raw?.resultSummary, 1_048_576) ?? eventResultSummary(events);
}

function listDurableWorkflowSnapshots(
  runBaseDir: string,
  limit: number,
): readonly SdkProcessSnapshot[] {
  let entries: string[];
  try {
    entries = readdirSync(runBaseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SAFE_RUN_ID_RE.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  return entries
    .map((runId) => {
      const runDir = path.join(runBaseDir, runId);
      const runJson = path.join(runDir, 'run.json');
      let mtime = 0;
      try {
        mtime = statSync(runJson).mtimeMs;
      } catch {
        try {
          mtime = statSync(runDir).mtimeMs;
        } catch {
          mtime = 0;
        }
      }
      return { runId, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .flatMap(({ runId }) => {
      const snapshot = readDurableWorkflowSnapshot(runBaseDir, runId);
      return snapshot ? [snapshot] : [];
    });
}

interface OriginsFile {
  readonly version: 1;
  readonly origins: Record<string, WorkflowOrigin>;
}

/**
 * 默认 push:走 ipc/push 的 pushToRenderer。测试注入 no-op / 捕获器。
 */
const defaultPush: PushFn = (payload) => pushToRenderer('workflow.event', payload);

export class WorkflowController {
  private manager: WorkflowRunManagerLike | null = null;
  /** F062 run 生命周期控制器(stop/pause/resume/rename/delete/prune)。 */
  private lifecycle: WorkflowLifecycleLike | null = null;
  private unsubscribe: (() => void) | null = null;
  /** 插入序的 runId→origin。Map 迭代序 = 插入序,用于 MAX_ORIGINS LRU 淘汰。*/
  private origins = new Map<string, WorkflowOrigin>();
  private originsFileMtimeMs = 0;
  /** F066:已桥接过 artifact 的 run（防 workflow_finished 重发导致重复桥接）。*/
  private bridgedRuns = new Set<string>();
  private loaded = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly push: PushFn = defaultPush,
    private readonly originsFile: string = path.join(getSpaceDataDir(), 'workflow-origins.json'),
    /** Space 自有 run base dir——F063 启动 run 与 F062 durable 控制(delete/prune)共用。 */
    private readonly runBaseDir: string = path.join(path.dirname(originsFile), 'workflow-runs'),
  ) {}

  getRunBaseDir(): string {
    return this.runBaseDir;
  }

  /**
   * 初始化:加载持久化归属 + 订阅 run manager 的进程事件流 + 建生命周期控制器。
   * manager/lifecycle 缺省 lazy-load 真 SDK(与 AMA/REPL 共享进程单例);测试注入 fake。
   * 注:仅当 manager 未注入(生产路径)时才自动建真 lifecycle——避免拿 fake manager 去
   * 实例化真 SDK 控制器。测试需要控制能力时显式注入 lifecycle。
   * 幂等:重复 init 先解订阅旧的。
   */
  async init(manager?: WorkflowRunManagerLike, lifecycle?: WorkflowLifecycleLike): Promise<void> {
    await this.loadOrigins();
    this.unsubscribe?.();
    const managerInjected = manager !== undefined;
    this.manager = manager ?? (await loadDefaultManager());
    // 先重置——re-init 换 manager 时别留着绑在旧 manager 上的 lifecycle。
    this.lifecycle = null;
    if (lifecycle !== undefined) {
      this.lifecycle = lifecycle;
    } else if (!managerInjected && this.manager) {
      this.lifecycle = await loadLifecycle(this.manager, this.runBaseDir);
    }
    if (!this.manager) return; // SDK 不可用(理论上不会)——降级:无实时流,list/get 返回空
    this.unsubscribe = this.manager.subscribeWorkflowProcess((event) => this.onEvent(event));
  }

  // ---- F062 run 生命周期控制(委托 lifecycle controller;未就绪一律安全降级)----

  /** 停止进行中的 run(子 agent 标 cancelled / never-started 标 skipped)。 */
  async stop(runId: string, reason?: string): Promise<boolean> {
    const pushed = this.pushStopFallback(runId, reason);
    const lifecycleStop = this.lifecycle?.stopWorkflow(runId, reason);
    if (!lifecycleStop) return pushed;
    if (pushed) {
      void lifecycleStop.catch((err) => {
        console.warn(
          '[workflow] stopWorkflow failed after local fallback:',
          err instanceof Error ? err.message : err,
        );
      });
      return true;
    }
    const ok = await lifecycleStop;
    if (ok) this.pushStopFallback(runId, reason);
    return ok;
  }

  private pushStopFallback(runId: string, reason?: string): boolean {
    const snapshot = this.manager?.getWorkflowProcessSnapshot(runId);
    if (!snapshot) return false;
    const status = (snapshot as { status?: unknown }).status;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') return false;
    const origin = this.originFromSnapshot(snapshot);
    this.push({
      type: 'workflow_finished',
      snapshot: this.toCancelledSnapshot(snapshot, reason),
      message: reason ?? 'workflow stopped',
      ...(origin.sessionId !== undefined ? { sessionId: origin.sessionId } : {}),
      ...(origin.surface !== undefined ? { surface: origin.surface } : {}),
      ...(origin.projectRoot !== undefined ? { projectRoot: origin.projectRoot } : {}),
    });
    return true;
  }

  private toCancelledSnapshot(
    snapshot: SdkProcessSnapshot,
    reason?: string,
  ): WorkflowEventPayload['snapshot'] {
    const raw = snapshot as Record<string, unknown>;
    const now = new Date().toISOString();
    const items = Array.isArray(raw.items)
      ? raw.items.map((item) => this.toSettledWorkflowItem(item, now))
      : [];
    return normalizeWorkflowSnapshot(
      {
        ...(snapshot as unknown as WorkflowEventPayload['snapshot']),
        status: 'cancelled',
        updatedAt: now,
        items: items as WorkflowEventPayload['snapshot']['items'],
        counts: this.countWorkflowItems(items, raw.counts),
        progress: this.cancelledProgress(raw.progress),
        ...(reason ? { latestMessage: reason } : {}),
      } as unknown as SdkProcessSnapshot,
      this.patternsForSnapshot(snapshot),
    );
  }

  private toSettledWorkflowItem(item: unknown, endedAt: string): unknown {
    if (!item || typeof item !== 'object') return item;
    const rec = item as Record<string, unknown>;
    if (rec.status === 'running') {
      return {
        ...rec,
        status: 'cancelled',
        endedAt: typeof rec.endedAt === 'string' ? rec.endedAt : endedAt,
      };
    }
    if (rec.status === 'pending') {
      return {
        ...rec,
        status: 'skipped',
        endedAt: typeof rec.endedAt === 'string' ? rec.endedAt : endedAt,
      };
    }
    return item;
  }

  private countWorkflowItems(
    items: readonly unknown[],
    fallback: unknown,
  ): WorkflowEventPayload['snapshot']['counts'] {
    const counts: WorkflowEventPayload['snapshot']['counts'] = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      skipped: 0,
    };
    for (const item of items) {
      const status =
        item && typeof item === 'object' ? (item as { status?: unknown }).status : undefined;
      if (
        status === 'pending' ||
        status === 'running' ||
        status === 'completed' ||
        status === 'failed' ||
        status === 'cancelled' ||
        status === 'skipped'
      ) {
        counts[status] += 1;
      }
    }
    if (Object.values(counts).some((n) => n > 0)) return counts;
    const f = fallback && typeof fallback === 'object' ? (fallback as Record<string, unknown>) : {};
    return {
      pending: nonnegativeInt(f.pending),
      running: nonnegativeInt(f.running),
      completed: nonnegativeInt(f.completed),
      failed: nonnegativeInt(f.failed),
      cancelled: nonnegativeInt(f.cancelled),
      skipped: nonnegativeInt(f.skipped),
    };
  }

  private cancelledProgress(progress: unknown): WorkflowEventPayload['snapshot']['progress'] {
    const p = progress && typeof progress === 'object' ? (progress as Record<string, unknown>) : {};
    const activeAgents = nonnegativeInt(p.activeAgents);
    return {
      spawnedAgents: nonnegativeInt(p.spawnedAgents),
      finishedAgents: nonnegativeInt(p.finishedAgents) + activeAgents,
      activeAgents: 0,
      failedAgents: nonnegativeInt(p.failedAgents),
      stoppedAgents: nonnegativeInt(p.stoppedAgents) + activeAgents,
      ...(typeof p.agentCap === 'number' && Number.isFinite(p.agentCap) && p.agentCap >= 0
        ? { agentCap: Math.floor(p.agentCap) }
        : {}),
      ...(typeof p.plannedItems === 'number' &&
      Number.isFinite(p.plannedItems) &&
      p.plannedItems >= 0
        ? { plannedItems: Math.floor(p.plannedItems) }
        : {}),
    };
  }

  /** 暂停进行中的 run。 */
  async pause(runId: string): Promise<boolean> {
    return (await this.lifecycle?.pauseWorkflow(runId)) ?? false;
  }

  /** 恢复已暂停的 run。 */
  async resume(runId: string): Promise<boolean> {
    return (await this.lifecycle?.resumeWorkflow(runId)) ?? false;
  }

  /** 改 run 显示名(不改 runId)。 */
  async rename(runId: string, displayName: string): Promise<boolean> {
    return (await this.lifecycle?.renameWorkflowRun(runId, displayName)) ?? false;
  }

  /** 删终态 run(活跃 run 被 SDK 拒,除非 force)。删后清本地归属。 */
  async deleteRun(runId: string, force?: boolean): Promise<boolean> {
    const ok =
      (await this.lifecycle?.deleteWorkflowRun(runId, force ? { force } : undefined)) ?? false;
    if (ok) {
      this.bridgedRuns.delete(runId);
      if (this.origins.delete(runId)) await this.persistOrigins();
    }
    return ok;
  }

  /** 清理终态 run(保留最近 keep / olderThanDays 之外)。 */
  async prune(options: {
    keep?: number;
    olderThanDays?: number;
    dryRun?: boolean;
  }): Promise<WorkflowRetentionResult> {
    const empty: WorkflowRetentionResult = {
      deleted: 0,
      protectedRuns: 0,
      candidates: [],
      dryRun: options.dryRun ?? false,
    };
    return (await this.lifecycle?.pruneWorkflowRuns(options)) ?? empty;
  }

  // ---- F063 库 / 启动 / preflight ----

  /** 列出可启动的工作流:built-in(内置)+ saved(用户/项目 ~/.kodax/workflows)。*/
  async listLibrary(projectRoot?: string): Promise<WorkflowLibrary> {
    const sdk = await loadCodingSdk();
    if (!sdk) return { builtin: [], patterns: [], saved: [] };
    let builtin: WorkflowMetaLite[] = [];
    let patterns: WorkflowPatternLite[] = [];
    let saved: SavedWorkflowLite[] = [];
    try {
      builtin = [...(sdk.listBuiltinWorkflows?.() ?? [])] as WorkflowMetaLite[];
    } catch (err) {
      console.warn(
        '[WorkflowController] listBuiltinWorkflows:',
        err instanceof Error ? err.message : err,
      );
    }
    try {
      patterns = [...(sdk.listWorkflowPatternTemplates?.() ?? [])] as WorkflowPatternLite[];
    } catch (err) {
      console.warn(
        '[WorkflowController] listWorkflowPatternTemplates:',
        err instanceof Error ? err.message : err,
      );
    }
    try {
      const refs = (await sdk.discoverSavedWorkflows?.(savedWorkflowDirs(projectRoot))) ?? [];
      saved = refs.map((r) => ({
        name: r.name,
        path: r.path,
        source: r.source,
        ...(r.execution !== undefined ? { execution: r.execution } : {}),
      }));
    } catch (err) {
      console.warn(
        '[WorkflowController] discoverSavedWorkflows:',
        err instanceof Error ? err.message : err,
      );
    }
    return { builtin, patterns, saved };
  }

  /** 预检 saved 工作流 capsule（环境/工具/MCP/skills 需求）。built-in 视为可信、直接 ok。*/
  async preflightSaved(filePath: string): Promise<WorkflowPreflight> {
    const sdk = await loadCodingSdk();
    // fail-safe：预检能力缺失时不静默放行（否则用户以为"无问题"却跑了未校验的可执行 capsule）。
    // 回一条 warning issue → renderer 弹确认，让用户知情后再决定。
    if (!sdk?.loadSavedWorkflowCapsule || !sdk?.preflightWorkflowCapsule) {
      return {
        ok: false,
        issues: [{ severity: 'warning', message: '预检不可用（SDK 能力缺失），未校验' }],
      };
    }
    try {
      const capsule = await sdk.loadSavedWorkflowCapsule(filePath);
      const res = await preflightCapsule(sdk, capsule);
      return {
        ok: res.ok,
        issues: (res.issues ?? []).map((i) => ({ severity: i.severity, message: i.message })),
      };
    } catch (err) {
      return { ok: false, issues: [{ message: err instanceof Error ? err.message : String(err) }] };
    }
  }

  /**
   * 从一个 session 发起工作流:解析 module → 用 session 字段建精简 KodaXOptions →
   * manager.startFromOptions → 登记归属。事件经 F060 订阅自然回流到 renderer。
   */
  /**
   * SECURITY (Partner boundary): workflows spawn child agents with full tool
   * access, which would bypass the Partner toolVisibilityPolicy / agentProfile.
   * This is the single authoritative gate for every workflow-launch path (slash
   * command, workflow.* IPC channels, and any future caller) — the slash-layer
   * check in builtin.ts is a fast-fail UX nicety, this is the real fence.
   */
  private assertCoderSurface(session: LaunchSession): { error: string } | null {
    if (session.surface === 'partner') {
      return {
        error:
          '[partner] Workflows run under the Coder surface. Partner cannot create, run, or re-run a workflow — switch to a Coder session.',
      };
    }
    return null;
  }

  async start(input: LaunchInput): Promise<{ runId: string } | { error: string }> {
    const partnerBlocked = this.assertCoderSurface(input.session);
    if (partnerBlocked) return partnerBlocked;
    const sdk = await loadCodingSdk();
    if (!sdk || !this.manager) return { error: 'workflow runtime unavailable' };
    let module: unknown;
    try {
      module =
        input.source === 'builtin'
          ? sdk.getBuiltinWorkflow?.(input.target)
          : await sdk.loadSavedWorkflow?.(input.target);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    if (!module) return { error: `workflow not found: ${input.target}` };

    const s = input.session;
    const meta = (module as { meta?: { name?: string; readOnly?: boolean } }).meta;
    let resolvedAgentTarget = input.agentTarget;
    if (resolvedAgentTarget) {
      const preflight = await externalAgentGateway.preflight({
        agentId: resolvedAgentTarget.agentId,
        projectRoot: s.projectRoot,
        readOnly: meta?.readOnly !== false,
        ...(resolvedAgentTarget.expectedConfigurationRevision
          ? { expectedConfigurationRevision: resolvedAgentTarget.expectedConfigurationRevision }
          : {}),
      });
      if (!preflight.ok || preflight.descriptor === undefined) {
        return {
          error: `external agent preflight failed: ${preflight.reasons.join('; ') || preflight.dispatchability.status}`,
        };
      }
      resolvedAgentTarget = {
        agentId: preflight.descriptor.agentId,
        expectedConfigurationRevision: preflight.descriptor.configurationRevision,
      };
      module = withDefaultWorkflowAgentTarget(module, resolvedAgentTarget);
    }
    // 精简 options——workflow 子 agent 只需 provider/model/reasoning/agentMode/context + host policy;
    // 不带主对话的 events/storage/compact 等 per-run 状态(那些是 real-session 对话回路专用)。
    // 走同一 launchOptions 保证 effort 解析 / host policy / artifact 归属与其它启动路径一致。
    const options = await this.launchOptions(s);
    const runId = `wf_${randomUUID()}`;
    const runDir = path.join(this.runBaseDir, runId);
    try {
      // await:startFromOptions 可能异步（建 run 目录/注册进程/spawn）。不 await 会让
      // 异步错误变 unhandled rejection，且 registerOrigin 抢跑在启动确认之前（ghost run）。
      await this.manager.startFromOptions({
        module,
        args: input.args ?? {},
        // workflow 子 agent 用精简 options（无 session block）——run 是**短命**的，自带
        // run 目录（run.json/events.jsonl/artifacts），不写对话 lineage。刻意设计。
        options,
        runId,
        runDir,
        processMetadata: {
          displayName: meta?.name,
          source: 'sdk',
          hostMetadata: {
            ...this.hostMetadata(s, patternsFromWorkflowModule(module)),
            ...(resolvedAgentTarget
              ? {
                  externalAgentId: resolvedAgentTarget.agentId,
                  ...(resolvedAgentTarget.expectedConfigurationRevision
                    ? {
                        externalAgentConfigurationRevision:
                          resolvedAgentTarget.expectedConfigurationRevision,
                      }
                    : {}),
                }
              : {}),
          },
        },
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    this.registerOrigin(runId, {
      sessionId: s.sessionId,
      surface: s.surface,
      projectRoot: s.projectRoot,
    });
    return { runId };
  }

  // ---- F066 结果 / artifact 读取 ----

  /** 读 run 的最终 displayable result（SDK 已 lint 过非空）。无 lifecycle / 不存在 → undefined。 */
  async createGeneratedWorkflow(
    request: string,
    session: LaunchSession,
  ): Promise<WorkflowStartResult> {
    const partnerBlocked = this.assertCoderSurface(session);
    if (partnerBlocked) return partnerBlocked;
    const sdk = await loadCodingSdk();
    if (!sdk?.generateWorkflowFromOptions) return { error: 'workflow generation unavailable' };
    let generated: WorkflowGenerationResultLite;
    try {
      generated = await sdk.generateWorkflowFromOptions({
        request,
        options: await this.launchOptions(session),
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    if (generated.kind === 'declined') {
      return { error: `workflow generation declined: ${generated.reason}` };
    }
    return this.startWorkflowModule({
      module: generated.module,
      args: { request },
      session,
      source: 'command',
      scriptSnapshot: generated.scriptSnapshot,
      patterns: generated.manifest.patterns,
      processMetadata: {
        displayName: generated.manifest.name,
        goal: request,
      },
    });
  }

  async rerunGeneratedWorkflow(
    runId: string,
    args: unknown,
    session: LaunchSession,
  ): Promise<WorkflowStartResult> {
    const partnerBlocked = this.assertCoderSurface(session);
    if (partnerBlocked) return partnerBlocked;
    const sdk = await loadCodingSdk();
    if (!sdk?.loadGeneratedWorkflowFromRun) return { error: 'workflow rerun unavailable' };
    const runDir = generatedRunDir(this.runBaseDir, runId);
    if (runDir === null) return { error: 'invalid runId' };
    let loaded: LoadedGeneratedWorkflowLite;
    try {
      loaded = await sdk.loadGeneratedWorkflowFromRun({ runDir });
      if (sdk.preflightWorkflowCapsule) {
        const preflight = await preflightCapsule(sdk, loaded.capsule);
        if (!preflight.ok) return { error: formatPreflightIssues(preflight) };
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    const scriptSnapshot = scriptSnapshotFromCapsule(loaded.capsule);
    return this.startWorkflowModule({
      module: loaded.module,
      args,
      session,
      source: 'command',
      ...(scriptSnapshot ? { scriptSnapshot } : {}),
      ...(scriptSnapshot?.manifest.patterns ? { patterns: scriptSnapshot.manifest.patterns } : {}),
      processMetadata: {
        displayName: workflowNameFromModule(loaded.module),
        sourceRunId: runId,
      },
    });
  }

  async saveGeneratedWorkflowFromRun(
    runId: string,
    name: string,
    projectRoot: string,
  ): Promise<WorkflowSavedResult> {
    const sdk = await loadCodingSdk();
    if (!sdk?.saveGeneratedWorkflowFromRun) return { error: 'workflow save unavailable' };
    const runDir = generatedRunDir(this.runBaseDir, runId);
    if (runDir === null) return { error: 'invalid runId' };
    try {
      const ref = await sdk.saveGeneratedWorkflowFromRun({
        runDir,
        targetDir:
          savedWorkflowDirs(projectRoot).project ?? path.join(projectRoot, '.kodax', 'workflows'),
        name,
      });
      return { name: ref.name, path: ref.path };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async renameSavedWorkflow(
    name: string,
    newName: string,
    projectRoot: string,
    source?: string,
  ): Promise<WorkflowSavedResult> {
    const sdk = await loadCodingSdk();
    if (!sdk?.renameSavedWorkflow) return { error: 'saved workflow rename unavailable' };
    try {
      const ref = await sdk.renameSavedWorkflow({
        dirs: savedWorkflowDirs(projectRoot),
        name,
        newName,
        ...(source ? { source } : {}),
      });
      return { name: ref.name, path: ref.path };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async deleteSavedWorkflow(
    name: string,
    projectRoot: string,
    source?: string,
  ): Promise<WorkflowSavedResult> {
    const sdk = await loadCodingSdk();
    if (!sdk?.deleteSavedWorkflow) return { error: 'saved workflow delete unavailable' };
    try {
      const ref = await sdk.deleteSavedWorkflow({
        dirs: savedWorkflowDirs(projectRoot),
        name,
        ...(source ? { source } : {}),
      });
      return { name: ref.name, path: ref.path };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async reviseWorkflow(input: {
    readonly target: string;
    readonly request: string;
    readonly replace?: boolean;
    readonly session: LaunchSession;
    readonly saved?: SavedWorkflowLite;
  }): Promise<WorkflowSavedResult> {
    // C3: reviseWorkflow generates + persists an executable workflow (an LLM scan of the project),
    // so it MUST carry the same Partner gate as start/create/rerun — this is the real authz fence.
    const partnerBlocked = this.assertCoderSurface(input.session);
    if (partnerBlocked) return partnerBlocked;
    if (input.replace && !input.saved) {
      return { error: 'revise --replace requires a saved workflow name target' };
    }
    const sdk = await loadCodingSdk();
    if (!sdk?.generateWorkflowFromOptions) return { error: 'workflow revision unavailable' };
    let capsule: WorkflowCapsuleLite;
    try {
      if (input.saved) {
        if (
          input.saved.execution !== undefined &&
          input.saved.execution !== 'capability-generated'
        ) {
          return { error: 'only generated workflow capsules can be revised' };
        }
        if (!sdk.loadSavedWorkflowCapsule)
          return { error: 'saved workflow capsule loading unavailable' };
        capsule = asWorkflowCapsule(await sdk.loadSavedWorkflowCapsule(input.saved.path));
      } else {
        if (!sdk.loadGeneratedWorkflowFromRun)
          return { error: 'generated run loading unavailable' };
        const runDir = generatedRunDir(this.runBaseDir, input.target);
        if (runDir === null) return { error: 'invalid runId' };
        const loaded = await sdk.loadGeneratedWorkflowFromRun({
          runDir,
        });
        capsule = asWorkflowCapsule(loaded.capsule);
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    const revisionRequest = buildWorkflowRevisionRequest({
      target: input.target,
      capsule,
      changeRequest: input.request,
    });
    let generated: WorkflowGenerationResultLite;
    try {
      generated = await sdk.generateWorkflowFromOptions({
        request: revisionRequest,
        options: await this.launchOptions(input.session),
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    if (generated.kind === 'declined') {
      return { error: `workflow revision declined: ${generated.reason}` };
    }

    const dirs = savedWorkflowDirs(input.session.projectRoot);
    const generatedManifest = generated.manifest;
    const replacingName = input.replace ? input.saved?.name : undefined;
    const savedName =
      replacingName ?? (await nextRevisionWorkflowName(sdk, dirs, generatedManifest.name));
    const manifest =
      savedName === generatedManifest.name
        ? generatedManifest
        : { ...generatedManifest, name: savedName };
    const provenance = buildRevisionProvenance({
      capsule,
      target: input.target,
      savedName: input.saved?.name,
      ...(replacingName ? { replacesWorkflowName: replacingName } : {}),
    });
    const saveInput = {
      name: savedName,
      manifest,
      source: generated.source,
      intent: {
        taskClass: firstPatternName(manifest) ?? manifest.name,
        originalRequest: input.request,
        reusableFor: [manifest.description],
      },
      ...(capsule.inputs !== undefined ? { inputs: capsule.inputs } : {}),
      ...(capsule.requires !== undefined ? { requires: capsule.requires } : {}),
      provenance,
    };

    try {
      if (input.replace && input.saved) {
        if (!sdk.replaceSavedWorkflow) return { error: 'saved workflow replace unavailable' };
        const ref = await sdk.replaceSavedWorkflow({
          ...saveInput,
          dirs,
          ...(input.saved.source ? { savedSource: input.saved.source } : {}),
        });
        return { name: ref.name, path: ref.path, previousPath: ref.previousPath };
      }
      if (!sdk.saveGeneratedWorkflow) return { error: 'workflow revision save unavailable' };
      const ref = await sdk.saveGeneratedWorkflow({
        ...saveInput,
        dir: dirs.project ?? path.join(input.session.projectRoot, '.kodax', 'workflows'),
      });
      return { name: ref.name, path: ref.path };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async readResult(runId: string): Promise<string | undefined> {
    const durable = readDurableWorkflowResult(this.runBaseDir, runId);
    if (durable !== undefined) return durable;
    return this.lifecycle?.readWorkflowResult(runId);
  }

  /** 读 run 的某个 artifact 内容（unknown JSON 值）。 */
  async readArtifact(runId: string, name: string): Promise<unknown | undefined> {
    const durable = readDurableWorkflowArtifact(this.runBaseDir, runId, name);
    if (durable !== undefined) return durable;
    return this.lifecycle?.readWorkflowArtifact(runId, name);
  }

  /**
   * F063/F064 在启动 run 时登记其发起方,供归属。立即 push 一条不发生——只记映射;
   * 后续该 run 的事件/list 自动带上 sessionId/surface。持久化(best-effort)。
   */
  registerOrigin(runId: string, origin: WorkflowOrigin): void {
    if (!runId) return;
    // 重新插入到末尾(刷新 LRU 新近度)
    this.origins.delete(runId);
    this.origins.set(runId, origin);
    while (this.origins.size > MAX_ORIGINS) {
      const oldest = this.origins.keys().next().value;
      if (oldest === undefined) break;
      this.origins.delete(oldest);
    }
    void this.persistOrigins();
  }

  /** 切 session 时播种:列出已知 run(可按 sessionId 过滤),带归属。*/
  list(sessionId?: string): WorkflowRunT[] {
    this.reloadOriginsIfChanged();
    const snapshotsByRunId = new Map<string, SdkProcessSnapshot>();
    for (const snapshot of listDurableWorkflowSnapshots(this.runBaseDir, MAX_ORIGINS)) {
      snapshotsByRunId.set(snapshot.runId, snapshot);
    }
    for (const snapshot of this.manager?.listWorkflowProcessSnapshots({ limit: MAX_ORIGINS }) ??
      []) {
      snapshotsByRunId.set(snapshot.runId, snapshot);
    }
    const runs = [...snapshotsByRunId.values()]
      .map((s) => this.attribute(s))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_ORIGINS);
    if (sessionId === undefined) return runs;
    return runs.filter((r) => r.sessionId === sessionId);
  }

  /** 按 runId 取单个 snapshot(带归属);不存在返回 null。*/
  get(runId: string): WorkflowRunT | null {
    this.reloadOriginsIfChanged();
    const snap =
      this.manager?.getWorkflowProcessSnapshot(runId) ??
      readDurableWorkflowSnapshot(this.runBaseDir, runId);
    return snap ? this.attribute(snap) : null;
  }

  /** 等待 in-flight 归属写盘完成(测试 + 优雅关闭用)。*/
  async flush(): Promise<void> {
    await this.writeLock;
  }

  /** 关闭:解订阅。重置 loaded 让后续 re-init 能重新从盘加载归属(外部进程可能改过)。*/
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.manager = null;
    this.lifecycle = null;
    this.loaded = false;
  }

  // ---- 内部 ----

  private async launchOptions(s: LaunchSession): Promise<Record<string, unknown>> {
    // C4/C5: resolve the effort against the provider's real ladder (workflow child agents hit the
    // same localReject-crash / low-ceiling hazards as the chat path).
    let reasoningProfile: ReasoningProfileLike | undefined;
    try {
      const sdk = await loadCodingSdk();
      const resolveProvider = (
        sdk as unknown as {
          resolveProvider?: (id: string) =>
            | {
                getReasoningProfile?: (model?: string) => ReasoningProfileLike | undefined;
              }
            | undefined;
        } | null
      )?.resolveProvider;
      reasoningProfile = resolveProvider?.(s.provider)?.getReasoningProfile?.(s.model ?? undefined);
    } catch {
      reasoningProfile = undefined;
    }
    // Also exclude efforts the wire layer already rejected this process (parity with the chat path),
    // so a previously-400'd effort isn't re-sent on every workflow run.
    const rejectedEfforts =
      (await loadAgentEffortCache())?.getCachedRejectedEfforts?.(
        s.provider,
        s.model ?? undefined,
      ) ?? [];
    // C2: forward the user-configured Workflow Host Policy so maxAgents/maxConcurrency/tokenBudget
    // caps actually bound explicit /workflow runs (mirrors the AMA run_workflow path in real-session).
    const policy = workflowPolicyStore.get();
    // Repo-intelligence is a LICENSED capability, and EVERY workflow-launch path funnels
    // through launchOptions() — so this is the single gate for /workflow, the Workflow
    // Panel (workflow.* IPC), generate/revise, and module runs (parity with the chat-turn
    // gate in real-session.ts). Without it, workflow sub-agents run the built-in engine at
    // full power regardless of license: the SDK default resolves 'auto'→'full' when the
    // key is absent, and the value is threaded to each child via ChildExecutorOptions
    // .parentOptions. repoIntelContextFields() is fail-closed (see repo-intel-gate.ts).
    const repoIntelCtx = await repoIntelContextFields();
    const externalAgentBinding = await externalAgentGateway.getBinding({
      actorId: 'space:workflow',
      projectId: s.projectRoot,
      parentTaskId: s.sessionId,
    });
    return {
      provider: s.provider,
      effort: resolveWireEffort(s.reasoningMode, reasoningProfile, rejectedEfforts),
      agentMode: s.agentMode,
      ...(s.model ? { model: s.model } : {}),
      // C9: agentProfile.surface makes create_artifact's resolveSessionRunContext succeed for
      // workflow-originated artifacts (surface is 'code' — Partner is blocked upstream). Absent
      // ⇒ default Coding Agent, so no tool-visibility restriction is introduced.
      context: {
        gitRoot: s.projectRoot,
        executionCwd: s.projectRoot,
        agentProfile: { surface: s.surface },
        // Licensed → enable trace (chip lights up); unlicensed → force engine off.
        ...repoIntelCtx,
        ...(externalAgentBinding !== undefined ? { agentExecutorPlane: externalAgentBinding } : {}),
      },
      // Host policy shape (incl. "tokenBudget 0 = unlimited", KodaX 0.7.59) is single-sourced
      // in buildWorkflowHostPolicy — mirrors the AMA run_workflow path in real-session.ts.
      workflowHostPolicy: buildWorkflowHostPolicy(policy),
      workflow: { maxConcurrency: policy.maxConcurrency },
    };
  }

  private hostMetadata(s: LaunchSession, patterns?: readonly string[]): Record<string, string> {
    const normalizedPatterns = normalizeWorkflowPatterns(patterns);
    return {
      host: 'kodax-space',
      sessionId: s.sessionId,
      surface: s.surface,
      projectRoot: s.projectRoot,
      ...(normalizedPatterns
        ? { [HOST_METADATA_PATTERNS_KEY]: JSON.stringify(normalizedPatterns) }
        : {}),
    };
  }

  private async startWorkflowModule(input: {
    readonly module: unknown;
    readonly args: unknown;
    readonly session: LaunchSession;
    readonly source: string;
    readonly scriptSnapshot?: WorkflowScriptSnapshotLite;
    readonly patterns?: readonly string[];
    readonly processMetadata?: Record<string, unknown>;
  }): Promise<WorkflowStartResult> {
    if (!this.manager) return { error: 'workflow runtime unavailable' };
    const runId = `wf_${randomUUID()}`;
    const runDir = path.join(this.runBaseDir, runId);
    const displayName = workflowNameFromModule(input.module);
    try {
      await this.manager.startFromOptions({
        module: input.module,
        args: input.args ?? {},
        options: await this.launchOptions(input.session),
        runId,
        runDir,
        ...(input.scriptSnapshot ? { scriptSnapshot: input.scriptSnapshot } : {}),
        processMetadata: {
          displayName,
          ...input.processMetadata,
          source: input.source,
          hostMetadata: this.hostMetadata(input.session, input.patterns),
        },
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    this.registerOrigin(runId, {
      sessionId: input.session.sessionId,
      surface: input.session.surface,
      projectRoot: input.session.projectRoot,
    });
    return { runId };
  }

  private onEvent(event: SdkProcessEvent): void {
    const origin = this.originFromSnapshot(event.snapshot);
    const snapshot = this.normalizeSnapshot(event.snapshot);
    const message = clampHumanText(event.message, IPC_MSG_MAX);
    // SDK snapshot 可能带完整长报告；IPC 进度快照只传有界预览，完整内容走 result/artifact 读取。
    this.push({
      type: event.type,
      snapshot,
      ...(message !== undefined ? { message } : {}),
      ...(origin.sessionId !== undefined ? { sessionId: origin.sessionId } : {}),
      ...(origin.surface !== undefined ? { surface: origin.surface } : {}),
      ...(origin.projectRoot !== undefined ? { projectRoot: origin.projectRoot } : {}),
    });
    // F066:run 终态时把产出的 artifact 桥进 Space artifact 层（方案 A）。fire-and-forget + 顶层 catch。
    if (event.type === 'workflow_finished') {
      void this.bridgeArtifacts(event.snapshot, origin).catch((err) =>
        console.warn(
          '[WorkflowController] bridgeArtifacts:',
          err instanceof Error ? err.message : err,
        ),
      );
    }
  }

  /**
   * F066：把 workflow run 的 artifacts 复制进 artifactStore（方案 A——统一面板，复用 F057-F059）。
   * 每个 run 仅桥接一次（防 workflow_finished 重发）。归属到发起 session；外部 run（无 sessionId）跳过。
   */
  private async bridgeArtifacts(
    snapshot: SdkProcessSnapshot,
    origin: WorkflowOrigin,
  ): Promise<void> {
    const runId = snapshot.runId;
    if (this.bridgedRuns.has(runId) || !origin.sessionId) return;
    const artifacts = (snapshot as { artifacts?: { name?: string }[] }).artifacts;
    if (!artifacts || artifacts.length === 0) return;
    // 先标记（防并发重入 + workflow_finished 重发导致重复桥接——artifactStore.upsert 无外部键去重,
    // 重桥会产生重复 artifact）。取舍:首个 artifact 读/写失败不会在 re-finish 重试(已记日志);
    // 重复 artifact 对用户更糟,故优先防重复而非失败重试。
    this.bridgedRuns.add(runId);
    // 有界 LRU:超 MAX_ORIGINS*2 淘汰最旧(Set 插入序),不 clear-all——避免清空后老 run 重发被重桥成重复。
    while (this.bridgedRuns.size > MAX_ORIGINS * 2) {
      const oldest = this.bridgedRuns.values().next().value;
      if (oldest === undefined) break;
      this.bridgedRuns.delete(oldest);
    }
    for (const a of artifacts) {
      const name = a?.name;
      if (!name) continue;
      try {
        const value = await this.readArtifact(runId, name);
        if (value === undefined) continue;
        const { kind, content } = detectArtifactKind(value);
        const wfName = typeof snapshot.workflowName === 'string' ? snapshot.workflowName : '';
        await artifactStore.upsert({
          sessionId: origin.sessionId,
          surface: origin.surface ?? 'code',
          kind,
          title: name,
          content,
          summary: `workflow ${wfName}`.trim(),
        });
        pushToRenderer('artifact.changed', { sessionId: origin.sessionId, reason: 'created' });
      } catch (err) {
        console.warn(
          '[WorkflowController] bridge artifact failed:',
          name,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  private attribute(snapshot: SdkProcessSnapshot): WorkflowRunT {
    const origin = this.originFromSnapshot(snapshot);
    const run = this.normalizeSnapshot(snapshot);
    return {
      ...run,
      ...(origin.sessionId !== undefined ? { sessionId: origin.sessionId } : {}),
      ...(origin.surface !== undefined ? { surface: origin.surface } : {}),
      ...(origin.projectRoot !== undefined ? { projectRoot: origin.projectRoot } : {}),
    };
  }

  private normalizeSnapshot(snapshot: SdkProcessSnapshot): WorkflowRunT {
    return normalizeWorkflowSnapshot(snapshot, this.patternsForSnapshot(snapshot));
  }

  private patternsForSnapshot(snapshot: SdkProcessSnapshot): string[] | undefined {
    const raw = snapshot as Record<string, unknown>;
    return readWorkflowManifestPatterns(raw.manifestSnapshotPath, snapshot.runId, this.runBaseDir);
  }

  private originFromSnapshot(snapshot: SdkProcessSnapshot): WorkflowOrigin {
    const meta = snapshot.hostMetadata;
    const sessionId =
      typeof meta?.sessionId === 'string' && meta.sessionId.length > 0 ? meta.sessionId : undefined;
    const surface =
      meta?.surface === 'code' || meta?.surface === 'partner' ? meta.surface : undefined;
    const projectRoot =
      typeof meta?.projectRoot === 'string' && meta.projectRoot.length > 0
        ? meta.projectRoot
        : undefined;
    if (sessionId !== undefined || surface !== undefined || projectRoot !== undefined) {
      return {
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(surface !== undefined ? { surface } : {}),
        ...(projectRoot !== undefined ? { projectRoot } : {}),
      };
    }
    return this.origins.get(snapshot.runId) ?? {};
  }

  private async loadOrigins(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const stat = await fs.stat(this.originsFile).catch(() => null);
      const raw = await fs.readFile(this.originsFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<OriginsFile>;
      this.mergeOrigins(parsed);
      this.originsFileMtimeMs = stat?.mtimeMs ?? Date.now();
    } catch (err) {
      // ENOENT(首次)静默;其它损坏文件 → 从空开始(归属丢失只影响 UI 分面,不致命)。
      if (!(err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT')) {
        console.warn(
          '[WorkflowController] origins read failed, starting empty:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  private reloadOriginsIfChanged(): void {
    let mtime = 0;
    try {
      mtime = statSync(this.originsFile).mtimeMs;
    } catch {
      return;
    }
    if (mtime <= this.originsFileMtimeMs) return;
    try {
      const parsed = JSON.parse(readFileSync(this.originsFile, 'utf-8')) as Partial<OriginsFile>;
      this.mergeOrigins(parsed);
      this.loaded = true;
      this.originsFileMtimeMs = mtime;
    } catch (err) {
      console.warn(
        '[WorkflowController] origins reload failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private mergeOrigins(parsed: Partial<OriginsFile>): void {
    if (!parsed || parsed.version !== 1 || !parsed.origins || typeof parsed.origins !== 'object') {
      return;
    }
    for (const [runId, origin] of Object.entries(parsed.origins)) {
      if (!origin || typeof origin !== 'object') continue;
      const o: WorkflowOrigin = {};
      const so = origin as WorkflowOrigin;
      if (typeof so.sessionId === 'string') (o as { sessionId?: string }).sessionId = so.sessionId;
      if (so.surface === 'code' || so.surface === 'partner') {
        (o as { surface?: 'code' | 'partner' }).surface = so.surface;
      }
      if (typeof so.projectRoot === 'string') {
        (o as { projectRoot?: string }).projectRoot = so.projectRoot;
      }
      this.origins.set(runId, o);
    }
  }

  /** 序列化写盘（写锁串行化；跨平台替换不跟随 symlink/hardlink aliases）。 */
  private async persistOrigins(): Promise<void> {
    const prev = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      const payload: OriginsFile = { version: 1, origins: Object.fromEntries(this.origins) };
      const dir = path.dirname(this.originsFile);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await replaceFileWithoutFollowingAliases(
        this.originsFile,
        Buffer.from(JSON.stringify(payload), 'utf8'),
        'workflow origins changed during atomic replacement',
      );
    } catch (err) {
      // 归属持久化失败不致命(下次 registerOrigin 再试;最坏重启后该 run 归属丢)。
      console.warn(
        '[WorkflowController] origins persist failed:',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      release();
    }
  }
}

// F063 用到的 SDK coding 子集(库/启动/preflight)。lazy-load 一次缓存。
interface WorkflowScriptManifestLite {
  readonly name: string;
  readonly description: string;
  readonly patterns?: readonly string[];
  readonly mayUseWorktree?: boolean;
  readonly [key: string]: unknown;
}
interface WorkflowScriptSnapshotLite {
  readonly manifest: WorkflowScriptManifestLite;
  readonly source: string;
}
interface WorkflowCapsuleLite {
  readonly manifest: WorkflowScriptManifestLite;
  readonly source: string;
  readonly inputs?: unknown;
  readonly requires?: unknown;
  readonly provenance?: {
    readonly fromRunId?: string;
    readonly fromWorkflowName?: string;
    readonly revisionOf?: string;
    readonly replacesWorkflowName?: string;
    readonly createdAt?: string;
    readonly kodaxVersion?: string;
  };
}
interface LoadedGeneratedWorkflowLite {
  readonly capsule: WorkflowCapsuleLite;
  readonly module: unknown;
}
type WorkflowGenerationResultLite =
  | { readonly kind: 'declined'; readonly reason: string; readonly rawText?: string }
  | {
      readonly kind: 'generated';
      readonly manifest: WorkflowScriptManifestLite;
      readonly source: string;
      readonly module: unknown;
      readonly scriptSnapshot: WorkflowScriptSnapshotLite;
      readonly approvalSummary?: string;
      readonly rawText?: string;
    };
interface SavedWorkflowDirsLite {
  readonly personal: string;
  readonly project?: string;
}

interface CodingSdkSubset {
  listBuiltinWorkflows?: () => readonly WorkflowMetaLite[];
  listWorkflowPatternTemplates?: () => readonly WorkflowPatternLite[];
  getBuiltinWorkflow?: (name: string) => unknown;
  discoverSavedWorkflows?: (dirs: {
    personal?: string;
    project?: string;
  }) => Promise<readonly SavedWorkflowLite[]>;
  loadSavedWorkflow?: (filePath: string) => Promise<unknown>;
  loadSavedWorkflowCapsule?: (filePath: string) => Promise<unknown>;
  preflightWorkflowCapsule?: (
    capsuleOrInput: unknown,
    env?: unknown,
  ) => Promise<WorkflowPreflight> | WorkflowPreflight;
  generateWorkflowFromOptions?: (input: {
    request: string;
    options: Record<string, unknown>;
  }) => Promise<WorkflowGenerationResultLite>;
  loadGeneratedWorkflowFromRun?: (input: {
    runDir: string;
  }) => Promise<LoadedGeneratedWorkflowLite>;
  saveGeneratedWorkflowFromRun?: (input: {
    runDir: string;
    targetDir: string;
    name: string;
  }) => Promise<SavedWorkflowLite>;
  renameSavedWorkflow?: (input: {
    dirs: SavedWorkflowDirsLite;
    name: string;
    newName: string;
    source?: string;
  }) => Promise<SavedWorkflowLite>;
  deleteSavedWorkflow?: (input: {
    dirs: SavedWorkflowDirsLite;
    name: string;
    source?: string;
  }) => Promise<SavedWorkflowLite>;
  saveGeneratedWorkflow?: (input: {
    dir: string;
    name: string;
    manifest: WorkflowScriptManifestLite;
    source: string;
    intent?: unknown;
    inputs?: unknown;
    requires?: unknown;
    provenance?: unknown;
  }) => Promise<SavedWorkflowLite>;
  replaceSavedWorkflow?: (input: {
    dirs: SavedWorkflowDirsLite;
    savedSource?: string;
    name: string;
    manifest: WorkflowScriptManifestLite;
    source: string;
    intent?: unknown;
    inputs?: unknown;
    requires?: unknown;
    provenance?: unknown;
  }) => Promise<SavedWorkflowLite & { previousPath: string }>;
}
let codingSdkCache: CodingSdkSubset | null = null;
export function _setCodingSdkForTesting(sdk: unknown | null): void {
  if (process.env.NODE_ENV === 'production') return;
  codingSdkCache = sdk as CodingSdkSubset | null;
}

async function loadCodingSdk(): Promise<CodingSdkSubset | null> {
  if (codingSdkCache) return codingSdkCache;
  try {
    codingSdkCache = (await import('@kodax-ai/kodax/coding')) as unknown as CodingSdkSubset;
    return codingSdkCache;
  } catch (err) {
    console.warn(
      '[WorkflowController] failed to load SDK coding module:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// /agent subpath — only for the reasoning-effort rejection cache (same source the chat path uses),
// so workflow child agents also stop resending a wire-rejected effort. Load failure → empty cache.
type AgentEffortCache = {
  getCachedRejectedEfforts?: (provider: string, model?: string) => readonly string[];
};
let agentEffortCache: AgentEffortCache | null = null;
async function loadAgentEffortCache(): Promise<AgentEffortCache | null> {
  if (agentEffortCache) return agentEffortCache;
  try {
    agentEffortCache = (await import('@kodax-ai/kodax/agent')) as unknown as AgentEffortCache;
    return agentEffortCache;
  } catch {
    return null;
  }
}

/** saved 工作流搜索目录:个人 ~/.kodax/workflows + 项目 <root>/.kodax/workflows。*/
function savedWorkflowDirs(projectRoot?: string): { personal: string; project?: string } {
  return {
    personal: path.join(os.homedir(), '.kodax', 'workflows'),
    ...(projectRoot ? { project: path.join(projectRoot, '.kodax', 'workflows') } : {}),
  };
}

/** Lazy-load SDK 的进程级 run manager 单例(与 AMA/REPL 共享同一实例)。*/
function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asWorkflowCapsule(value: unknown): WorkflowCapsuleLite {
  const capsule = asRecord(value, 'workflow capsule');
  const manifest = asRecord(capsule.manifest, 'workflow capsule manifest');
  const name = manifest.name;
  const description = manifest.description;
  const source = capsule.source;
  if (typeof name !== 'string' || typeof description !== 'string' || typeof source !== 'string') {
    throw new Error('workflow capsule missing manifest.name, manifest.description, or source');
  }
  return {
    manifest: manifest as unknown as WorkflowScriptManifestLite,
    source,
    ...(capsule.inputs !== undefined ? { inputs: capsule.inputs } : {}),
    ...(capsule.requires !== undefined ? { requires: capsule.requires } : {}),
    ...(capsule.provenance && typeof capsule.provenance === 'object'
      ? { provenance: capsule.provenance as WorkflowCapsuleLite['provenance'] }
      : {}),
  };
}

function workflowNameFromModule(module: unknown): string | undefined {
  const meta =
    module && typeof module === 'object'
      ? (module as { meta?: { name?: unknown } }).meta
      : undefined;
  return typeof meta?.name === 'string' ? meta.name : undefined;
}

function patternsFromWorkflowModule(module: unknown): string[] | undefined {
  const meta =
    module && typeof module === 'object'
      ? (module as { meta?: { patterns?: unknown; pattern?: unknown } }).meta
      : undefined;
  return (
    normalizeWorkflowPatterns(meta?.patterns) ??
    (typeof meta?.pattern === 'string' ? normalizeWorkflowPatterns([meta.pattern]) : undefined)
  );
}

function generatedRunDir(baseDir: string, runId: string): string | null {
  return SAFE_RUN_ID_RE.test(runId) ? path.join(baseDir, runId) : null;
}

function scriptSnapshotFromCapsule(capsule: unknown): WorkflowScriptSnapshotLite | undefined {
  try {
    const c = asWorkflowCapsule(capsule);
    return { manifest: c.manifest, source: c.source };
  } catch {
    return undefined;
  }
}

async function preflightCapsule(
  sdk: CodingSdkSubset,
  capsule: unknown,
): Promise<WorkflowPreflight> {
  if (!sdk.preflightWorkflowCapsule) return { ok: true, issues: [] };
  try {
    const direct = await sdk.preflightWorkflowCapsule(capsule);
    return { ok: direct.ok, issues: direct.issues ?? [] };
  } catch (err) {
    console.warn(
      '[WorkflowController] preflightWorkflowCapsule direct call failed; retrying boxed capsule:',
      err instanceof Error ? err.message : err,
    );
    const boxed = await sdk.preflightWorkflowCapsule({ capsule });
    return { ok: boxed.ok, issues: boxed.issues ?? [] };
  }
}

function formatPreflightIssues(result: WorkflowPreflight): string {
  if (result.ok) return 'workflow capsule preflight passed';
  const details = result.issues
    .map((issue) => issue.message)
    .filter(Boolean)
    .join('; ');
  return details
    ? `workflow capsule preflight failed: ${details}`
    : 'workflow capsule preflight failed';
}

function firstPatternName(manifest: WorkflowScriptManifestLite): string | undefined {
  return Array.isArray(manifest.patterns) && typeof manifest.patterns[0] === 'string'
    ? manifest.patterns[0]
    : undefined;
}

async function nextRevisionWorkflowName(
  sdk: CodingSdkSubset,
  dirs: SavedWorkflowDirsLite,
  preferredName: string,
): Promise<string> {
  let refs: readonly SavedWorkflowLite[] = [];
  try {
    refs = (await sdk.discoverSavedWorkflows?.(dirs)) ?? [];
  } catch (err) {
    console.warn(
      '[WorkflowController] discoverSavedWorkflows for revision:',
      err instanceof Error ? err.message : err,
    );
    return `${preferredName}-revision-${Date.now().toString(36)}`;
  }
  const existing = new Set(refs.map((ref) => ref.name));
  if (!existing.has(preferredName)) return preferredName;
  return `${preferredName}-revision-${Date.now().toString(36)}`;
}

function currentKodaxWorkflowVersion(): string {
  if (process.env.KODAX_VERSION) return process.env.KODAX_VERSION;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = typeof require !== 'undefined' ? null : (import.meta as any);
    const req = meta ? createRequire(meta.url) : require;
    const pkg = req('@kodax-ai/kodax/package.json') as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version.length > 0) return pkg.version;
  } catch {
    // fall through
  }
  return process.env.npm_package_version ?? 'unknown';
}

function buildRevisionProvenance(input: {
  readonly capsule: WorkflowCapsuleLite;
  readonly target: string;
  readonly savedName?: string;
  readonly replacesWorkflowName?: string;
}): {
  readonly fromRunId?: string;
  readonly fromWorkflowName?: string;
  readonly revisionOf?: string;
  readonly replacesWorkflowName?: string;
  readonly createdAt: string;
  readonly kodaxVersion: string;
} {
  const fromRunId = input.savedName ? input.capsule.provenance?.fromRunId : input.target;
  const fromWorkflowName = input.savedName ?? input.capsule.provenance?.fromWorkflowName;
  const revisionOf = input.savedName ?? input.target;
  return {
    ...(fromRunId !== undefined ? { fromRunId } : {}),
    ...(fromWorkflowName !== undefined ? { fromWorkflowName } : {}),
    ...(revisionOf !== undefined ? { revisionOf } : {}),
    ...(input.replacesWorkflowName !== undefined
      ? { replacesWorkflowName: input.replacesWorkflowName }
      : {}),
    createdAt: new Date().toISOString(),
    kodaxVersion: currentKodaxWorkflowVersion(),
  };
}

function buildWorkflowRevisionRequest(input: {
  readonly target: string;
  readonly capsule: WorkflowCapsuleLite;
  readonly changeRequest: string;
}): string {
  return [
    'Revise this existing KodaX dynamic workflow capsule.',
    'Return a complete revised workflow, not a patch.',
    'Preserve the reusable workflow intent, safety requirements, and compatible args shape unless the requested change explicitly requires otherwise.',
    '',
    `Target: ${input.target}`,
    '',
    'Original manifest:',
    JSON.stringify(input.capsule.manifest, null, 2),
    '',
    'Original source:',
    '```js',
    input.capsule.source,
    '```',
    '',
    `Change request: ${input.changeRequest}`,
  ].join('\n');
}

async function loadDefaultManager(): Promise<WorkflowRunManagerLike | null> {
  try {
    // 经 unknown 中转：SDK 的 WorkflowProcessSnapshot 不带我们 SdkProcessSnapshot 的 index
    // signature，strictFunctionTypes 下 listener 形参逆变检查会拒绝直接 cast。我们只用到
    // subscribe/get/list 这个子集，运行时形状一致，中转 unknown 是安全的边界适配。
    const sdk = (await import('@kodax-ai/kodax/coding')) as unknown as {
      getDefaultWorkflowRunManager?: () => WorkflowRunManagerLike;
    };
    if (typeof sdk.getDefaultWorkflowRunManager !== 'function') {
      console.warn('[WorkflowController] sdk.getDefaultWorkflowRunManager unavailable');
      return null;
    }
    return sdk.getDefaultWorkflowRunManager();
  } catch (err) {
    console.warn(
      '[WorkflowController] failed to load SDK workflow run manager:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/** Lazy-load 并实例化 SDK 的 run 生命周期控制器(F062 控制能力)。 */
async function loadLifecycle(
  manager: WorkflowRunManagerLike,
  runBaseDir: string,
): Promise<WorkflowLifecycleLike | null> {
  try {
    const sdk = (await import('@kodax-ai/kodax/coding')) as unknown as {
      createWorkflowLifecycleController?: (opts: {
        runManager: unknown;
        runBaseDir: string;
      }) => WorkflowLifecycleLike;
    };
    if (typeof sdk.createWorkflowLifecycleController !== 'function') {
      console.warn('[WorkflowController] sdk.createWorkflowLifecycleController unavailable');
      return null;
    }
    return sdk.createWorkflowLifecycleController({ runManager: manager, runBaseDir });
  } catch (err) {
    console.warn(
      '[WorkflowController] failed to create workflow lifecycle controller:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// 单例。main.ts init / IPC handler / F063-F064 启动登记都通过这个 instance。
export const workflowController = new WorkflowController();
