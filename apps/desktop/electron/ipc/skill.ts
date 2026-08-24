// Skill IPC handlers — FEATURE_035.
//
// 启动 main 时 main.ts 调 registerSkillChannels()，注册 skill.discover + compatibility-only
// skill.invoke。Composer 的真实执行路径是单次 session.send；这里不拥有 Run admission。

import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import { skillMetaSchema } from '@kodax-space/space-ipc-schema';
import { registerChannel } from './register.js';
import { validateProjectRoot } from './validate.js';
import { kodaxHost } from '../kodax/host.js';
import {
  getSkillRegistry,
  invalidateSkillCache,
  mergeSkillMetas,
  toSkillMeta,
  type SkillMeta,
} from '../skill/registry.js';
import { createSkillDynamicContextExecutor } from '../skill/dynamic-context-executor.js';
import { installSkillFromPath } from '../skill/install.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';
import { isSpaceBuiltinSkillPath } from '../skill/space-builtins.js';

/**
 * 安全 env：**完全不转发** process.env 给 SDK VariableResolver。
 *
 * 起因（reviewer F035 CRITICAL-1）：providers/keys.ts 启动期把 ANTHROPIC_API_KEY /
 * KIMI_API_KEY 等 secret 注入 process.env 让 KodaX runtime 能拿到；若同时把
 * process.env 喂给 SkillRegistry.invoke 的 VariableContext.environment，恶意 SKILL.md
 * 用 `${ANTHROPIC_API_KEY}` 模板就能把密钥拼进 resolvedPrompt 走 session.send 流出。
 *
 * SDK 内部仍会注入 KODAX_SESSION_ID / CLAUDE_SESSION_ID / KODAX_WORKING_DIR，不依赖
 * 我们传入。用户级 ${MY_VAR} 替换暂不支持——alpha.1 不开 user-defined env 通道；
 * 后续若要加，应当走 per-skill frontmatter `env:` whitelist 显式声明，不能直通进程 env。
 */
const SAFE_ENV: Record<string, string> = {};

/**
 * 拼回 args 字符串。SDK VariableResolver 处理 $1..$N (按空格切的 token) +
 * $ARGUMENTS (整段原文)。renderer 端 tokenizeArgs 已经按空格 + 双引号切好；
 * 这里 join 成 SDK 期望的 "raw text"。
 */
function joinArgs(args: readonly string[]): string {
  return args.join(' ');
}

function keepValidSkillMetas(skills: readonly SkillMeta[]): SkillMeta[] {
  return skills.filter((skill) => {
    const ok = skillMetaSchema.safeParse(skill).success;
    if (!ok) console.warn(`[skill.discover] dropping schema-invalid skill: ${skill.name}`);
    return ok;
  });
}

export function registerSkillChannels(): void {
  // skill.discover
  // 列出所有可显式调用的 enabled Skill。KodaX 0.7.94 起
  // disableModelInvocation 只影响模型发现/模型 skill tool，不影响用户 /skill。
  // 输入 projectRoot —— 不依赖 live SDK session：用户从 Recents 恢复历史会话时
  // UI 有 sessionId 但 kodaxHost 没对应 session；discover 是只读操作不需要 live session。
  registerChannel('skill.discover', async (input) => {
    // v0.1.10: forceReload=true 时清掉 wrapper cache, 让下次 getSkillRegistry new 一个
    // SkillRegistry instance + 触发 SDK discover() 重 scan 磁盘。
    // 用户 dogfood 报: skill-creator 生成新 skill 后必须重启 Space 才能 / 补全, 因为
    // wrapper cache TTL 60s + SDK 单 instance 不 re-scan。
    if (input.forceReload) {
      invalidateSkillCache(input.projectRoot);
    }
    if (runtimeHostAdapter.isRuntimeSelected()) {
      try {
        const runtimeSkills = keepValidSkillMetas(
          (await runtimeHostAdapter.listRuntimeSkills(input.projectRoot)).map((skill) => ({
            name: skill.name,
            description: skill.description.slice(0, 512),
            ...(skill.argumentHint ? { argumentHint: skill.argumentHint.slice(0, 128) } : {}),
            source: skill.source,
            path: skill.path,
          })),
        );
        try {
          const registry = await getSkillRegistry(input.projectRoot);
          const spaceBuiltinSkills = keepValidSkillMetas(
            registry
              .listUserInvocable()
              .filter((skill) => isSpaceBuiltinSkillPath(skill.path))
              .map(toSkillMeta),
          );
          return { skills: mergeSkillMetas(spaceBuiltinSkills, runtimeSkills) };
        } catch (error) {
          console.warn(
            '[skill.discover] Space builtin catalog unavailable; using Coder daemon catalog:',
            error instanceof Error ? error.message : error,
          );
          return { skills: runtimeSkills.slice(0, 256) };
        }
      } catch (error) {
        console.warn(
          '[skill.discover] Coder daemon catalog unavailable; using Space host provider:',
          error instanceof Error ? error.message : error,
        );
      }
    }
    const registry = await getSkillRegistry(input.projectRoot);
    // Per-item validate + drop the invalid (instead of letting one bad skill fail
    // the whole array via OUTPUT_INVALID). toSkillMeta already clamps the common
    // overflow (long descriptions); this catches anything still off-spec (e.g. a
    // SKILL.md with a non-kebab name) so the picker/slash list degrade gracefully.
    const skills = keepValidSkillMetas(registry.listUserInvocable().map(toSkillMeta)).slice(0, 256); // schema caps the array at 256
    return { skills };
  });

  registerChannel('skill.install', async (input) => {
    const projectRoot = input.projectRoot ? validateProjectRoot(input.projectRoot) : undefined;
    if (input.target === 'project' && !projectRoot) {
      throw new Error('project skill install requires projectRoot');
    }

    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const dialogOptions: OpenDialogOptions =
      input.source === 'directory'
        ? {
            title: 'Install KodaX skill folder',
            properties: ['openDirectory'],
          }
        : {
            title: 'Install KodaX skill archive',
            filters: [{ name: 'KodaX skill archive (.zip)', extensions: ['zip'] }],
            properties: ['openFile'],
          };
    const dlg = parent
      ? await dialog.showOpenDialog(parent, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (dlg.canceled || dlg.filePaths.length === 0) {
      return { cancelled: true };
    }

    const installed = await installSkillFromPath(input.source, dlg.filePaths[0], {
      target: input.target,
      ...(projectRoot ? { projectRoot } : {}),
    });
    if (input.target === 'user') invalidateSkillCache();
    else invalidateSkillCache(projectRoot);
    return installed;
  });

  // Compatibility prompt preview only. Production explicit-Skill execution resolves trusted
  // metadata and lifecycle inside the idempotent session.send admission.
  // SDK SkillRegistry.invoke 内部做 markdown 解析 + VariableResolver；输出 SkillInvokeResult
  // { success, content, error } 映射到 IPC envelope。
  //
  // 安全设计 (v0.7.42 起):
  //   旧版 (alpha.1): refuseIfUnsafeContent 一律拒绝含 `!`cmd`` token 的 skill (SDK 用
  //   execSync 跑这些命令,完全绕过 F029/F030 permission broker)。**过度限制**: 实用 skill
  //   大量需要 git log / find 等命令查询当前 repo 状态。
  //   现在 (v0.1.x): 传 executeDynamicContext hook → 每个 !`cmd` 走 permissionBroker
  //   弹窗征求批准 → 用户授权后 spawn 跑 → stdout 回 SDK 继续解析。
  //
  // 不再传 SAFE_ENV={} (改成 {}+session env)，而是: SDK 解析 ${VAR} 时如果 environment
  // 是空对象,${ANTHROPIC_API_KEY} 等都 resolve 成空串,密钥不会进 resolvedPrompt。维持原 secure stance。
  registerChannel('skill.invoke', async (input) => {
    let session = kodaxHost.get(input.sessionId);
    if (!session) {
      // v0.1.10 fix: 同 session.send 的 lazy resume 路径 — sessionId 不在 in-flight
      // 但磁盘 persisted (重启后历史 session,用户报 "session not found" bug)。
      // 否则用户重启 Space → 从 Recents 点击 → 输入 /skill-name 立刻 HANDLER_ERROR。
      const resumed = await kodaxHost.tryResume(input.sessionId);
      if (!resumed) {
        throw new Error(`session not found: ${input.sessionId}`);
      }
      session = kodaxHost.get(input.sessionId);
      if (!session) {
        throw new Error(`session resume failed: ${input.sessionId}`);
      }
    }
    const registry = await getSkillRegistry(session.projectRoot);

    // 用当前 session 的 permissionMode 创建 executor; 'plan' mode 下任何 !`cmd` 会被 broker
    // 直接 deny (符合 plan-mode 语义 — 只规划不执行)
    const executor = createSkillDynamicContextExecutor({
      sessionId: input.sessionId,
      permissionMode: session.permissionMode,
      surface: session.surface,
    });

    const result = await registry.invoke(input.skillName, joinArgs(input.args), {
      sessionId: input.sessionId,
      workingDirectory: session.projectRoot,
      environment: SAFE_ENV,
      executeDynamicContext: executor,
    });
    if (!result.success) {
      return { ok: false, error: result.error ?? 'skill invocation failed' };
    }
    return { ok: true, resolvedPrompt: result.content };
  });
}
