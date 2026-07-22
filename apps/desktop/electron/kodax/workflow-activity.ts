// F065 子 agent 活动遥测——纯路由逻辑（从 real-session 抽出以便单测）。
//
// SDK 0.7.50 给 KodaXEvents 回调加了 workflowCorrelation 尾参。带 workflowRunId 的事件
// 来自工作流子 agent；Space 据此把事件归到 run + 子 agent，不淹主 transcript。

import type { KodaXWorkflowAgentDigestEvent } from '@kodax-ai/kodax/coding';
import type { WorkflowActivityPayload } from '@kodax-space/space-ipc-schema';

export type ChildMeta =
  | {
      contextKind?: 'root' | 'child';
      workflowCorrelation?: { workflowRunId?: string; childAgentId?: string };
      childAgentId?: string;
      childAgentName?: string;
      /**
       * SDK 标记：此事件仅供 live 展示、**不得**进持久 transcript（KodaXActivityEventMeta.liveOnly）。
       * dispatch_child_task 子 agent 的流式事件带此标 + childAgentId，但**不带** workflowCorrelation。
       */
      liveOnly?: boolean;
    }
  | undefined;

/** 取子 agent 事件的 workflowRunId；非工作流子事件（含 main agent 自身事件）返回 undefined。 */
export function childRunId(meta: ChildMeta): string | undefined {
  const runId = meta?.workflowCorrelation?.workflowRunId;
  return typeof runId === 'string' && runId.length > 0 ? runId : undefined;
}

/**
 * 此事件是否来自子 agent / 仅供 live 展示——**不应进主 transcript**。
 *
 * 之前只认 workflowCorrelation.workflowRunId（run_workflow 工作流子 agent），漏了
 * `dispatch_child_task` 派生的子 agent：它们带 `childAgentId` + SDK 的 `liveOnly` 标，但
 * 不带 workflowCorrelation，于是其流式文本/工具事件穿透到主对话，和主 agent 一样刷屏。
 * 现按稳定 `contextKind`、子 agent identity 与 workflow correlation 归属事件；
 * `liveOnly` 只是「仅 live、不落主 transcript」的渲染提示，不能单独证明子上下文。
 * 主 agent 事件没有这些子上下文信号，故不受影响。子 agent 概览仍由
 * managed_task_status 事件驱动面板呈现。
 */
export function isTransientChildEvent(meta: ChildMeta): boolean {
  if (meta?.contextKind === 'child') return true;
  if (childRunId(meta) !== undefined) return true;
  const childId = meta?.childAgentId ?? meta?.workflowCorrelation?.childAgentId;
  return typeof childId === 'string' && childId.length > 0;
}

/**
 * 构造一条子 agent 活动 payload；非子事件返回 null（调用方据此跳过 push）。
 * 仅 discrete 事件（tool_use/tool_result/end）调用——控 IPC 量，不逐 text delta 推。
 */
export function buildChildActivity(
  meta: ChildMeta,
  kind: 'tool_use' | 'tool_result' | 'end',
  extra: { toolName?: string },
): WorkflowActivityPayload | null {
  const runId = childRunId(meta);
  if (!runId) return null;
  const childAgentId = meta?.childAgentId ?? meta?.workflowCorrelation?.childAgentId;
  return {
    runId,
    ...(childAgentId ? { childAgentId } : {}),
    ...(meta?.childAgentName ? { childAgentName: meta.childAgentName } : {}),
    kind,
    ...(extra.toolName ? { toolName: extra.toolName } : {}),
  };
}

const DIGEST_EVENT_TYPES = new Set([
  'agent_completed',
  'agent_unverified',
  'agent_failed',
  'agent_summary_updated',
]);
const MAX_DIGEST_SUMMARY = 8192;

type WorkflowSummaryKind = NonNullable<WorkflowActivityPayload['summaryKind']>;
type WorkflowVerification = NonNullable<WorkflowActivityPayload['verification']>;

function readString(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeSummaryKind(value: string | undefined): WorkflowSummaryKind | undefined {
  if (value === 'digest' || value === 'excerpt' || value === 'digest-failed') return value;
  return undefined;
}

function readStringArray(
  data: Record<string, unknown>,
  key: string,
  limit: number,
): string[] | undefined {
  const value = data[key];
  if (!Array.isArray(value)) return undefined;
  const strings = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, limit);
  return strings.length > 0 ? strings : undefined;
}

function readVerification(data: Record<string, unknown> | undefined): WorkflowVerification | undefined {
  const value = data?.verification;
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== 'boolean') return undefined;
  const enforcement =
    record.enforcement === 'hard' || record.enforcement === 'warn'
      ? record.enforcement
      : undefined;
  const changedPaths = readStringArray(record, 'changedPaths', 128);
  const mutationToolCalls = readStringArray(record, 'mutationToolCalls', 64);
  return {
    ok: record.ok,
    ...(enforcement ? { enforcement } : {}),
    reasons: readStringArray(record, 'reasons', 32) ?? [],
    ...(changedPaths ? { changedPaths } : {}),
    ...(mutationToolCalls ? { mutationToolCalls } : {}),
    ...(typeof record.mutationEvidence === 'boolean'
      ? { mutationEvidence: record.mutationEvidence }
      : {}),
  };
}

function clampDigestSummary(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= MAX_DIGEST_SUMMARY) return normalized;
  return `${normalized.slice(0, MAX_DIGEST_SUMMARY - 3).trimEnd()}...`;
}

export function buildWorkflowDigestActivity(
  event: KodaXWorkflowAgentDigestEvent,
): WorkflowActivityPayload | null {
  if (!DIGEST_EVENT_TYPES.has(event.event.type)) return null;
  const data = event.event.data;
  if (event.event.type === 'agent_completed' && readString(data, 'status') !== 'completed') {
    return null;
  }

  const rawSummaryKind = readString(data, 'summaryKind');
  const verification = readVerification(data);
  const summary =
    rawSummaryKind === 'pending'
      ? undefined
      : readString(data, 'summary') ?? readString(data, 'error');
  if (!summary && !verification) return null;

  const childAgentId = readString(data, 'taskId');
  const childAgentName = readString(data, 'name') ?? childAgentId;
  const summaryKind =
    normalizeSummaryKind(rawSummaryKind) ??
    (event.event.type === 'agent_failed' ? 'digest-failed' : 'digest');

  return {
    runId: event.runId,
    ...(childAgentId ? { childAgentId } : {}),
    ...(childAgentName ? { childAgentName } : {}),
    kind: 'digest',
    ...(summary ? { summary: clampDigestSummary(summary) } : {}),
    ...(summary ? { summaryKind } : {}),
    ...(verification ? { verification } : {}),
  };
}
