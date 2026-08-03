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
  /** Run-owned guardrail authorization. Omit only when the broker is the owner. */
  readonly authorize?: (command: string, cwd: string, toolId: string) => Promise<boolean>;
}): SkillDynamicContextExecutor {
  return async (command, cwd) => {
    // Partner is intentionally shell-free. Dynamic-context commands execute
    // inside Skill expansion rather than as ordinary tools, so enforce the
    // surface boundary here even if a future caller forgets `disable: true`.
    if (opts.surface === 'partner') {
      throw new Error('[skill dynamic-context disabled on Partner surface]');
    }

    const toolId = randomUUID();
    if (opts.authorize) {
      const allowed = await opts.authorize(command, cwd, toolId);
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
      const result = await permissionBroker.request(req);
      if (result.decision === 'deny') {
        throw new Error(`[skill dynamic-context denied by user] ${command}`);
      }
    }

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
        // env: 显式空对象 — 不泄 KODAX_ / ANTHROPIC_ 等敏感 env 给用户授权的命令。
        // PATH 仍需要才能找 git / node 等,所以保留 PATH; 其他全部清掉。
        env: { PATH: process.env.PATH ?? '' },
      });

      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        // Windows: child.kill 只 kill shell (cmd.exe),它 spawn 的真实 git/find/etc 不在
        // job object 里,会成为孤儿继续跑。用 taskkill /F /T /PID 杀整棵进程树 (审查 H1)。
        // POSIX: 默认 detached=false,child 与 parent 同 process group,直接 kill PID 即可。
        try {
          if (process.platform === 'win32' && child.pid !== undefined) {
            // fire-and-forget; taskkill 失败就退回 child.kill (单进程,杀不掉 shell 子孙)
            spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true });
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          /* 杀进程失败一般是 race (已退出); 不再重试 */
        }
        reject(new Error(`[skill dynamic-context timeout after ${EXEC_TIMEOUT_MS}ms] ${command}`));
      }, EXEC_TIMEOUT_MS);

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
        clearTimeout(timer);
        reject(new Error(`[skill dynamic-context spawn error] ${err.message}`));
      });

      child.on('close', (code) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
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
