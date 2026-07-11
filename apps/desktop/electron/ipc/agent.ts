// Markdown agent IPC handler — FEATURE_197 (KodaX 0.7.43).
//
// Exposes a read-only listing to the renderer: scan ~/.kodax/agents/*.md and
// <projectRoot>/.kodax/agents/*.md, then return metadata + parse failures.
// This path does not call admission and does not write the SDK registry.
// Runtime activation is handled per run by RealKodaXSession via the SDK 0.7.67
// scoped loader (`loadMarkdownAgentScope`) so projects do not leak agents.
//
// CJS/ESM trap：@kodax-ai/kodax/coding 的 subpath exports 只声明 "import" 条件（ESM）。
// Space main 输出 CJS，静态 require 会撞 ERR_PACKAGE_PATH_NOT_EXPORTED。
// 必须用 `await import(...)` 动态拉——动态 import 即使在 CJS 上下文也走 ESM 解析规则。
// 详见 scripts/build-main.mjs 的 external 注释。

import { registerChannel, registerChannelWithEvent } from './register.js';
import { isRendererTarget } from './push.js';
import { externalAgentGateway } from '../kodax/external-agent-gateway.js';
import { kodaxHost } from '../kodax/host.js';
import type { IpcMainInvokeEvent } from 'electron';

type SdkCodingModule = typeof import('@kodax-ai/kodax/coding');
let sdkCodingCache: SdkCodingModule | null = null;
async function loadSdkCoding(): Promise<SdkCodingModule> {
  if (sdkCodingCache === null) {
    sdkCodingCache = await import('@kodax-ai/kodax/coding');
  }
  return sdkCodingCache;
}

const NAME_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

/**
 * SDK 返回的 source 是 union 'markdown:user' | 'markdown:project'——已经跟 IPC schema
 * 对齐，直接透传即可。这个函数只做 narrowing 让 TS 满意（zod 在出口再校验一次）。
 */
function isAgentSource(value: string): value is 'markdown:user' | 'markdown:project' {
  return value === 'markdown:user' || value === 'markdown:project';
}

function assertPrimaryRenderer(event: IpcMainInvokeEvent): void {
  if (!isRendererTarget(event.sender)) {
    throw new Error('external-agent administration is restricted to the primary window');
  }
}

function requireSession(sessionId: string) {
  const session = kodaxHost.get(sessionId);
  if (!session) throw new Error('session not found');
  return session;
}

export function registerAgentChannels(): void {
  // agent.discover
  //
  // SDK 通过 frontmatter `description` / `name` / `tools` / `model` 字段做发现 +
  // 校验，校验失败的文件进 `failed[]` 不抛错。我们把 SDK 输出按 IPC schema 上限
  // 兜底过滤（防 SDK 给超长字段把 zod 出口炸了），再吐回给 renderer。
  registerChannel('agent.discover', async (input) => {
    const { discoverMarkdownAgents } = await loadSdkCoding();
    const result = await discoverMarkdownAgents({ cwd: input.projectRoot });

    const agents = [];
    for (const a of result.agents) {
      // 越过 schema 上限的直接丢——picker UI 视角"有点 agent 拒载"远比整个列表炸好。
      if (!NAME_RE.test(a.name)) continue;
      if (!isAgentSource(a.source)) continue;
      if (a.path.length > 4096) continue;
      if (a.description.length > 2048) continue;

      // tools 字段：SDK 给的是用户原始名字，单 token cap 128，最多 64 个。
      let tools: string[] | undefined;
      if (a.tools && a.tools.length > 0) {
        const cleaned = a.tools.filter((t) => t.length > 0 && t.length <= 128).slice(0, 64);
        if (cleaned.length > 0) tools = cleaned;
      }

      agents.push({
        name: a.name,
        description: a.description,
        source: a.source,
        path: a.path,
        ...(tools !== undefined ? { tools } : {}),
        ...(a.model !== undefined && a.model.length > 0 && a.model.length <= 128
          ? { model: a.model }
          : {}),
      });

      if (agents.length >= 256) break; // schema 硬上限
    }

    const failed = [];
    for (const f of result.failed) {
      if (f.path.length > 4096) continue;
      // reason 超长截断，保留前 2048 个字符；调试足够。
      const reason = f.reason.length > 2048 ? `${f.reason.slice(0, 2045)}...` : f.reason;
      failed.push({ path: f.path, reason });
      if (failed.length >= 256) break;
    }

    return { agents, failed };
  });

  registerChannelWithEvent('agent.external.status', async (_input, event) => {
    assertPrimaryRenderer(event);
    return externalAgentGateway.status();
  });

  registerChannelWithEvent('agent.external.registration.list', async (_input, event) => {
    assertPrimaryRenderer(event);
    return { registrations: await externalAgentGateway.listRegistrations() };
  });

  registerChannelWithEvent('agent.external.reference.upsert', async (input, event) => {
    assertPrimaryRenderer(event);
    return externalAgentGateway.upsertReference(input);
  });

  registerChannelWithEvent('agent.external.registration.remove', async (input, event) => {
    assertPrimaryRenderer(event);
    return { removed: await externalAgentGateway.remove(input.agentId) };
  });

  registerChannelWithEvent('agent.external.dispatchable.list', async (input, event) => {
    assertPrimaryRenderer(event);
    return { agents: await externalAgentGateway.listDispatchable(input) };
  });

  registerChannelWithEvent('agent.external.preflight', async (input, event) => {
    assertPrimaryRenderer(event);
    return externalAgentGateway.preflight(input);
  });

  registerChannelWithEvent('agent.external.task.list', async (input, event) => {
    assertPrimaryRenderer(event);
    requireSession(input.sessionId);
    return {
      tasks: await externalAgentGateway.listTasks({
        parentTaskId: input.sessionId,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      }),
    };
  });

  registerChannelWithEvent('agent.external.task.start', async (input, event) => {
    assertPrimaryRenderer(event);
    const session = requireSession(input.sessionId);
    return externalAgentGateway.startTask({
      agentId: input.agentId,
      objective: input.objective,
      projectRoot: session.projectRoot,
      parentTaskId: input.sessionId,
      readOnly: input.readOnly,
      ...(input.expectedConfigurationRevision
        ? { expectedConfigurationRevision: input.expectedConfigurationRevision }
        : {}),
    });
  });

  registerChannelWithEvent('agent.external.task.events', async (input, event) => {
    assertPrimaryRenderer(event);
    requireSession(input.sessionId);
    await externalAgentGateway.assertTaskParent(input.taskId, input.sessionId);
    return externalAgentGateway.taskEvents(input.taskId, input.cursor);
  });

  registerChannelWithEvent('agent.external.task.sendInput', async (input, event) => {
    assertPrimaryRenderer(event);
    requireSession(input.sessionId);
    await externalAgentGateway.assertTaskParent(input.taskId, input.sessionId);
    return externalAgentGateway.sendTaskInput(input.taskId, input.content);
  });

  registerChannelWithEvent('agent.external.task.cancel', async (input, event) => {
    assertPrimaryRenderer(event);
    requireSession(input.sessionId);
    await externalAgentGateway.assertTaskParent(input.taskId, input.sessionId);
    return externalAgentGateway.cancelTask(input.taskId, input.reason);
  });

  registerChannelWithEvent('agent.external.task.reconcile', async (input, event) => {
    assertPrimaryRenderer(event);
    requireSession(input.sessionId);
    await externalAgentGateway.assertTaskParent(input.taskId, input.sessionId);
    return externalAgentGateway.reconcileTask(input.taskId);
  });
}
