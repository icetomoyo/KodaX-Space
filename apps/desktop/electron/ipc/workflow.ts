// workflow.* IPC handlers (F060).
//
// list/get：renderer 切 session 时播种已知 run，或按 runId 取单个 snapshot。
// 实时流走 push 通道 workflow.event（由 WorkflowController 订阅 SDK 后转发）。

import os from 'node:os';
import path from 'node:path';
import { registerChannel } from './register.js';
import { workflowController, type LaunchSession } from '../kodax/workflow-controller.js';
import { workflowPolicyStore } from '../kodax/workflow-policy.js';
import { kodaxHost } from '../kodax/host.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';

/**
 * SECURITY（F063）：saved 工作流是可执行 JS——loadSavedWorkflow/loadSavedWorkflowCapsule
 * 会加载并执行它。renderer 传来的 saved 路径必须限定在已知安全目录内，否则一个被攻陷的
 * renderer（XSS/恶意依赖）能让 main 进程加载任意 .js 以 Node 权限执行。
 * projectRoot 必须取自**可信的 main 侧 session**（不能信 renderer 传的，否则白名单可绕）。
 */
function isSafeWorkflowPath(filePath: string, projectRoot: string | undefined): boolean {
  const resolved = path.resolve(filePath);
  const allowed = [path.resolve(os.homedir(), '.kodax', 'workflows')];
  if (projectRoot) allowed.push(path.resolve(projectRoot, '.kodax', 'workflows'));
  return allowed.some((prefix) => resolved === prefix || resolved.startsWith(prefix + path.sep));
}

function toLaunchSession(session: NonNullable<ReturnType<typeof kodaxHost.get>>): LaunchSession {
  return {
    sessionId: session.sessionId,
    surface: session.surface,
    provider: session.provider,
    ...(session.model !== undefined ? { model: session.model } : {}),
    reasoningMode: session.reasoningMode,
    agentMode: session.agentMode,
    projectRoot: session.projectRoot,
  };
}

function sameProjectRoot(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return true;
  return path.resolve(left) === path.resolve(right);
}

export function registerWorkflowChannels(): void {
  registerChannel('workflow.list', async (input) => {
    const localRuns = workflowController.list(input?.sessionId);
    const session = input?.sessionId ? kodaxHost.get(input.sessionId) : undefined;
    if (
      !runtimeHostAdapter.isRuntimeSelected() ||
      (input?.sessionId !== undefined && session?.surface === 'partner')
    ) {
      return { runs: localRuns };
    }
    try {
      const runtimeRuns = await runtimeHostAdapter.listWorkflows(input);
      const seen = new Set(runtimeRuns.map((run) => run.runId));
      return {
        runs: [...runtimeRuns, ...localRuns.filter((run) => !seen.has(run.runId))].slice(0, 500),
      };
    } catch (error) {
      console.warn(
        '[workflow.list] Coder daemon workflows unavailable:',
        error instanceof Error ? error.message : error,
      );
      return { runs: localRuns };
    }
  });

  registerChannel('workflow.get', async (input) => {
    if (runtimeHostAdapter.isRuntimeSelected()) {
      try {
        const run = await runtimeHostAdapter.getWorkflow(input.runId);
        if (run) return { run };
      } catch (error) {
        console.warn(
          '[workflow.get] Coder daemon workflow unavailable:',
          error instanceof Error ? error.message : error,
        );
      }
    }
    return { run: workflowController.get(input.runId) };
  });

  // F062 run 生命周期控制。控制后状态变化由 workflow.event 自然回流，handler 只回 ok。
  registerChannel('workflow.stop', async (input) => {
    if (runtimeHostAdapter.isRuntimeSelected()) {
      try {
        if (await runtimeHostAdapter.getWorkflow(input.runId)) {
          return { ok: await runtimeHostAdapter.controlWorkflow('stop', input.runId) };
        }
      } catch (error) {
        console.warn(
          '[workflow.stop] Coder daemon control unavailable:',
          error instanceof Error ? error.message : error,
        );
      }
    }
    return { ok: await workflowController.stop(input.runId, input.reason) };
  });

  registerChannel('workflow.pause', async (input) => {
    if (runtimeHostAdapter.isRuntimeSelected()) {
      try {
        if (await runtimeHostAdapter.getWorkflow(input.runId)) {
          return { ok: await runtimeHostAdapter.controlWorkflow('pause', input.runId) };
        }
      } catch (error) {
        console.warn(
          '[workflow.pause] Coder daemon control unavailable:',
          error instanceof Error ? error.message : error,
        );
      }
    }
    return { ok: await workflowController.pause(input.runId) };
  });

  registerChannel('workflow.resume', async (input) => {
    if (runtimeHostAdapter.isRuntimeSelected()) {
      try {
        if (await runtimeHostAdapter.getWorkflow(input.runId)) {
          return { ok: await runtimeHostAdapter.controlWorkflow('resume', input.runId) };
        }
      } catch (error) {
        console.warn(
          '[workflow.resume] Coder daemon control unavailable:',
          error instanceof Error ? error.message : error,
        );
      }
    }
    return { ok: await workflowController.resume(input.runId) };
  });

  registerChannel('workflow.rename', async (input) => ({
    ok: await workflowController.rename(input.runId, input.displayName),
  }));

  registerChannel('workflow.delete', async (input) => ({
    ok: await workflowController.deleteRun(input.runId, input.force),
  }));

  registerChannel('workflow.rerun', async (input) => {
    const run = workflowController.get(input.runId);
    if (!run) return { error: 'workflow run not found' };
    let session = kodaxHost.get(input.sessionId);
    if (!session && (await kodaxHost.tryResume(input.sessionId))) {
      session = kodaxHost.get(input.sessionId);
    }
    if (!session) return { error: 'session not found' };
    if (!sameProjectRoot(run.projectRoot, session.projectRoot)) {
      return { error: 'workflow run belongs to another project' };
    }
    if (run.surface && run.surface !== session.surface)
      return { error: 'workflow run belongs to another surface' };
    const res = await workflowController.rerunGeneratedWorkflow(
      input.runId,
      input.args ?? {},
      toLaunchSession(session),
    );
    return 'error' in res ? { error: res.error } : { runId: res.runId };
  });

  registerChannel('workflow.prune', async (input) => {
    const options =
      input.dryRun === true && input.keep === undefined && input.olderThanDays === undefined
        ? { ...input, keep: 50 }
        : input;
    const r = await workflowController.prune(options);
    // readonly candidates → mutable copy（schema 推断 string[]）。
    return {
      deleted: r.deleted,
      protectedRuns: r.protectedRuns,
      candidates: [...r.candidates],
      dryRun: r.dryRun,
    };
  });

  // F063 库 / preflight / 启动。
  registerChannel('workflow.library', async (input) =>
    workflowController.listLibrary(input?.projectRoot),
  );

  registerChannel('workflow.preflight', async (input) => {
    // 可信 projectRoot 取自 session；路径白名单（防任意文件加载执行）。
    const session = kodaxHost.get(input.sessionId);
    if (!isSafeWorkflowPath(input.path, session?.projectRoot)) {
      return { ok: false, issues: [{ severity: 'error', message: '路径不在允许的工作流目录内' }] };
    }
    return workflowController.preflightSaved(input.path);
  });

  registerChannel('workflow.start', async (input) => {
    // 从发起方 session 取运行时字段建 workflow 子 agent 的 KodaXOptions。
    const session = kodaxHost.get(input.sessionId);
    if (!session) return { error: 'session not found' };
    // SECURITY：saved 路径必须在白名单目录内（可信 projectRoot 来自 session）。
    if (input.source === 'saved' && !isSafeWorkflowPath(input.target, session.projectRoot)) {
      return { error: '路径不在允许的工作流目录内' };
    }
    const res = await workflowController.start({
      target: input.target,
      source: input.source,
      ...(input.args !== undefined ? { args: input.args } : {}),
      ...(input.agentTarget !== undefined ? { agentTarget: input.agentTarget } : {}),
      session: {
        sessionId: session.sessionId,
        surface: session.surface,
        provider: session.provider,
        ...(session.model !== undefined ? { model: session.model } : {}),
        reasoningMode: session.reasoningMode,
        agentMode: session.agentMode,
        projectRoot: session.projectRoot,
      },
    });
    return 'error' in res ? { error: res.error } : { runId: res.runId };
  });

  // Save a generated workflow run into the trusted workflow library for this session's project.
  registerChannel('workflow.save', async (input) => {
    const run = workflowController.get(input.runId);
    if (!run) return { error: 'workflow run not found' };
    let session = kodaxHost.get(input.sessionId);
    if (!session && (await kodaxHost.tryResume(input.sessionId))) {
      session = kodaxHost.get(input.sessionId);
    }
    if (!session) return { error: 'session not found' };
    if (!sameProjectRoot(run.projectRoot, session.projectRoot)) {
      return { error: 'workflow run belongs to another project' };
    }
    if (run.surface && run.surface !== session.surface) {
      return { error: 'workflow run belongs to another surface' };
    }
    const res = await workflowController.saveGeneratedWorkflowFromRun(
      input.runId,
      input.name,
      session.projectRoot,
    );
    return 'error' in res ? { error: res.error } : { name: res.name, path: res.path };
  });

  // F064 Host policy（AMA 强信号 Workflow + runtime caps）。
  registerChannel('workflow.saved.rename', async (input) => {
    const session = kodaxHost.get(input.sessionId);
    if (!session) return { error: 'session not found' };
    const res = await workflowController.renameSavedWorkflow(
      input.name,
      input.newName,
      session.projectRoot,
      input.source,
    );
    return 'error' in res
      ? { error: res.error }
      : { name: res.name, path: res.path, previousPath: res.previousPath };
  });

  registerChannel('workflow.saved.delete', async (input) => {
    const session = kodaxHost.get(input.sessionId);
    if (!session) return { error: 'session not found' };
    const res = await workflowController.deleteSavedWorkflow(
      input.name,
      session.projectRoot,
      input.source,
    );
    return 'error' in res
      ? { error: res.error }
      : { name: res.name, path: res.path, previousPath: res.previousPath };
  });

  registerChannel('workflow.policy.get', () => workflowPolicyStore.get());
  registerChannel('workflow.policy.set', (input) => workflowPolicyStore.set(input));

  // F066 结果读取（artifacts 由 controller 在 run 终态自动桥进 artifactStore，无单独通道）。
  registerChannel('workflow.result', async (input) => {
    const result = await workflowController.readResult(input.runId);
    return result !== undefined ? { result } : {};
  });
}
