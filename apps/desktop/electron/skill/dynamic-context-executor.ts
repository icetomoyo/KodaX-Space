// SkillDynamicContextExecutor — Space-side trust-boundary hook (v0.1.x)
//
// SDK 0.7.42+ 给 SkillContext.executeDynamicContext 这个钩子,替代原来内部 execSync 白名单。
// Space 实现: 每个 `!`cmd`` 解析时 → permissionBroker 弹窗征求用户批准 → 批准则 spawn 跑 →
// 返回 stdout (字符串)。
//
// 安全 / DoS:
//   - permission broker 走 plan/accept-edits/auto 三 mode short-circuit (plan 一律 deny)
//   - 真正 spawn: shell:true 让用户能用 piped/redirect 命令 (git log | head),由 OS 默认 shell
//     处理 — 命令本身已经被用户看到 + 批准,与 SDK 旧的 execSync 行为对齐
//   - 30s timeout: 防长跑命令把 KodaX skill invoke 卡住
//   - 1 MB stdout 上限: 防超大 stdout 撑爆 IPC envelope (skill 输出会被嵌进 prompt 喂 LLM)
//   - cwd 强制 caller 传入 (一般是 session.projectRoot); 永远 NOT process.cwd()

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { permissionBroker, type PermissionRequestInput } from '../permission/broker.js';
import type { PermissionMode, Surface } from '@kodax-space/space-ipc-schema';
import type { AutoModeToolGuardrail } from '@kodax-ai/kodax/coding';
import type { SkillDynamicContextExecutor } from '@kodax-ai/kodax/skills';

const EXEC_TIMEOUT_MS = 30_000;
const MAX_STDOUT_BYTES = 1_048_576; // 1 MB
const PROCESS_TREE_TERMINATION_TIMEOUT_MS = 5_000;

function admissionCancelledError(): Error {
  return new Error('[skill dynamic-context cancelled before admission]');
}

function throwIfAdmissionCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw admissionCancelledError();
}

/**
 * Terminate an approved dynamic-context command and its descendants before the
 * surrounding Skill admission settles. Windows needs taskkill /T because
 * ChildProcess.kill() only terminates the intermediate shell.
 */
export async function terminateDynamicContextProcessTree(
  child: Pick<ReturnType<typeof spawn>, 'pid' | 'kill'>,
): Promise<void> {
  if (process.platform !== 'win32') {
    try {
      if (child.pid !== undefined) {
        process.kill(-child.pid, 'SIGKILL');
      } else if (!child.kill('SIGKILL')) {
        throw new Error('spawned process has no terminable PID');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    return;
  }

  if (child.pid === undefined) {
    throw new Error('spawned Windows process has no PID for tree termination');
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const helper = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
      windowsHide: true,
      stdio: 'ignore',
    });
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      helper.removeAllListeners();
      if (error) reject(error);
      else resolve();
    };
    const deadline = setTimeout(() => {
      helper.kill('SIGKILL');
      finish(
        new Error(
          `Windows process-tree termination did not settle within ${PROCESS_TREE_TERMINATION_TIMEOUT_MS}ms`,
        ),
      );
    }, PROCESS_TREE_TERMINATION_TIMEOUT_MS);
    helper.once('error', (error) => {
      finish(new Error(`Windows process-tree termination failed to start: ${error.message}`));
    });
    helper.once('close', (code) => {
      finish(
        code === 0
          ? undefined
          : new Error(`Windows process-tree termination failed with taskkill exit ${code}`),
      );
    });
  });
}

async function awaitWithAdmissionAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return pending;
  throwIfAdmissionCancelled(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(admissionCancelledError());
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

type AutoGuardrailBeforeTool = NonNullable<AutoModeToolGuardrail['beforeTool']>;
type AutoGuardrailContext = Parameters<AutoGuardrailBeforeTool>[1];

/**
 * Adapt Skill's hidden dynamic-context execution to the same run-owned Auto
 * guardrail used by ordinary tools. The caller supplies the live transcript
 * and trusted permission intent so user constraints cannot disappear here.
 */
export function createAutoSkillDynamicContextAuthorizer(opts: {
  readonly guardrail: AutoModeToolGuardrail;
  readonly context: AutoGuardrailContext;
}): (command: string, cwd: string, toolId: string) => Promise<boolean> {
  return async (command, cwd, toolId) => {
    const verdict = await opts.guardrail.beforeTool?.(
      {
        id: toolId,
        name: 'bash',
        input: {
          command,
          cwd,
          description: 'Resolve Skill dynamic context',
        },
      },
      opts.context,
    );
    return verdict?.action === 'allow';
  };
}

/**
 * 工厂函数: 给特定 session + mode 创建一个 executor。
 * Skill invoke 时把它塞进 SkillContext.executeDynamicContext。
 */
export function createSkillDynamicContextExecutor(opts: {
  readonly sessionId: string;
  readonly permissionMode: PermissionMode;
  readonly surface?: Surface;
  /** Cancels authorization and terminates a spawned command before Run admission. */
  readonly signal?: AbortSignal;
  /** Run-owned guardrail authorization. Omit only when the broker is the owner. */
  readonly authorize?: (command: string, cwd: string, toolId: string) => Promise<boolean>;
}): SkillDynamicContextExecutor {
  return async (command, cwd) => {
    throwIfAdmissionCancelled(opts.signal);
    // Partner is intentionally shell-free. Dynamic-context commands execute
    // inside Skill expansion rather than as ordinary tools, so enforce the
    // surface boundary here even if a future caller forgets `disable: true`.
    if (opts.surface === 'partner') {
      throw new Error('[skill dynamic-context disabled on Partner surface]');
    }

    const toolId = randomUUID();
    if (opts.authorize) {
      const allowed = await awaitWithAdmissionAbort(
        opts.authorize(command, cwd, toolId),
        opts.signal,
      );
      if (!allowed) {
        throw new Error(`[skill dynamic-context denied by Auto guardrail] ${command}`);
      }
    } else {
      // 1) 走 permission broker - toolName='skill_dynamic_context' 让规则 + UI 都能识别
      //    toolId 用 randomUUID — 每次 dynamic-context exec 是独立 request (允许"允许这一次"语义)
      const req: PermissionRequestInput = {
        sessionId: opts.sessionId,
        toolId,
        toolName: 'skill_dynamic_context',
        input: { command, cwd },
        mode: opts.permissionMode,
        surface: opts.surface,
      };
      const result = await awaitWithAdmissionAbort(permissionBroker.request(req), opts.signal);
      if (result.decision === 'deny') {
        throw new Error(`[skill dynamic-context denied by user] ${command}`);
      }
    }
    throwIfAdmissionCancelled(opts.signal);

    // 2) 用户批准 → spawn 命令。shell:true 使用 OS 默认 shell,支持 piped/redirect 命令。
    //    用户已经看到完整命令 string,trust 转移成功 (与 SDK 旧版 execSync 行为一致)。
    return new Promise<string>((resolve, reject) => {
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let truncated = false;
      let resolved = false;

      const child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        // On POSIX, a separate process group lets cancellation kill the shell and every
        // descendant it launched. Killing only the shell PID leaves approved commands
        // running after the surrounding Skill admission has been cancelled.
        detached: process.platform !== 'win32',
        // env: 显式空对象 — 不泄 KODAX_ / ANTHROPIC_ 等敏感 env 给用户授权的命令。
        // PATH 仍需要才能找 git / node 等,所以保留 PATH; 其他全部清掉。
        env: { PATH: process.env.PATH ?? '' },
      });

      const clearLifecycle = (): void => {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        if (resolved) return;
        resolved = true;
        clearLifecycle();
        void terminateDynamicContextProcessTree(child).then(
          () => reject(admissionCancelledError()),
          (error: unknown) =>
            reject(
              new Error('[skill dynamic-context cancellation could not terminate process tree]', {
                cause: error,
              }),
            ),
        );
      };

      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        // Windows: child.kill 只 kill shell (cmd.exe),它 spawn 的真实 git/find/etc 不在
        // job object 里,会成为孤儿继续跑。用 taskkill /F /T /PID 杀整棵进程树 (审查 H1)。
        // POSIX: child owns a dedicated process group, so the negative PID kills the tree.
        clearLifecycle();
        void terminateDynamicContextProcessTree(child).then(
          () =>
            reject(
              new Error(`[skill dynamic-context timeout after ${EXEC_TIMEOUT_MS}ms] ${command}`),
            ),
          (error: unknown) =>
            reject(
              new Error('[skill dynamic-context timeout could not terminate process tree]', {
                cause: error,
              }),
            ),
        );
      }, EXEC_TIMEOUT_MS);
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      if (opts.signal?.aborted) onAbort();

      child.stdout?.on('data', (chunk: Buffer) => {
        if (truncated) return;
        const next = Buffer.concat([stdout, chunk]);
        if (next.length > MAX_STDOUT_BYTES) {
          truncated = true;
          stdout = next.subarray(0, MAX_STDOUT_BYTES);
        } else {
          stdout = next;
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length > MAX_STDOUT_BYTES) return;
        stderr = Buffer.concat([stderr, chunk]);
      });

      child.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        clearLifecycle();
        reject(new Error(`[skill dynamic-context spawn error] ${err.message}`));
      });

      child.on('close', (code) => {
        if (resolved) return;
        resolved = true;
        clearLifecycle();
        if (code !== 0) {
          const errTail = stderr.toString('utf8').slice(-512);
          reject(
            new Error(
              `[skill dynamic-context exit ${code}] ${command}${errTail ? `\n${errTail}` : ''}`,
            ),
          );
          return;
        }
        let output = stdout.toString('utf8');
        if (truncated) output += '\n…(truncated 1MB)';
        resolve(output);
      });
    });
  };
}
