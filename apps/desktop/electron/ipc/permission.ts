// Permission IPC handlers — FEATURE_007
//
// 三个 invoke channel：
//   permission.answer  — renderer 回答 main 端 broker pending 的请求
//   permission.list    — 列出 always-allow 规则（设置面板用）
//   permission.revoke  — 撤销一条 always-allow 规则

import { registerChannel } from './register.js';
import { permissionBroker } from '../permission/broker.js';
import { permissionRegistry } from '../permission/registry.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';

export function registerPermissionChannels(): void {
  // permission.answer
  //
  // 流程（review C2-sec / M1-sec / M3-sec 加固）：
  //   1) 取 broker pending entry 拿 main 端生成的 trustedPattern（renderer 提交的 pattern
  //      字段一律忽略——renderer 如被攻陷可能提交 "bash" 之类整工具批准的宽 pattern）
  //   2) decision='allow_always' → 用 trustedPattern 持久化；trustedPattern 为 undefined
  //      （即 danger 命令或 bash 子命令字符集不合法）→ 降级为 allow_once + warn log
  //   3) 持久化失败 → 降级为 allow_once + warn log（M1-sec：避免"用户以为存了但其实没存"）
  //   4) 其他 decision 直接 resolve
  //
  // 即使 broker 没有这条 pending（renderer 重复点击 / 超时后回答），也返回 accepted:false
  // 而不是 throw——envelope 已是 ok，{ accepted:false } 是业务级"晚到的答案被丢弃"。
  registerChannel('permission.answer', async (input) => {
    if (runtimeHostAdapter.hasPendingPermission(input.reqId)) {
      const accepted = await runtimeHostAdapter.respondPermission(input.reqId, input.decision);
      return { accepted };
    }
    let effectiveDecision = input.decision;

    if (input.decision === 'allow_always') {
      const pending = permissionBroker.peek(input.reqId);
      const trustedPattern = pending?.trustedPattern;

      if (!trustedPattern) {
        // renderer 请求 allow_always 但 main 端没生成 trustedPattern——
        // 通常是 danger 命令（suggestAlwaysAllowPattern 返回 undefined）或 bash 子命令
        // 字符集不合法。降级为 allow_once，不持久化任何规则。
        console.warn(
          `[permission.answer] allow_always rejected: no trustedPattern for reqId=${input.reqId}, downgrading to allow_once`,
        );
        effectiveDecision = 'allow_once';
      } else {
        try {
          await permissionRegistry.add(trustedPattern);
        } catch (err) {
          // M1-sec：persist 失败不能默认 allow_always——否则用户以为下次不弹了，
          // 实际下次还是弹。降级 + log，UX 上"批准本次"是诚实的状态
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[permission.answer] failed to persist rule "${trustedPattern}": ${msg}, downgrading to allow_once`,
          );
          effectiveDecision = 'allow_once';
        }
      }
    }

    const accepted = permissionBroker.resolve(input.reqId, effectiveDecision);
    return { accepted };
  });

  // permission.list
  registerChannel('permission.list', async () => {
    await permissionRegistry.load();
    const localRules = permissionRegistry.list().map((rule) => ({
      pattern: rule.pattern,
      createdAt: rule.createdAt,
      origin: 'space' as const,
    }));
    if (!runtimeHostAdapter.isRuntimeSelected()) return { rules: localRules };
    try {
      const grants = await runtimeHostAdapter.listPermissionGrants();
      const runtimeRules = grants.value.map((grant) => ({
        pattern: `${grant.scope.toolName ?? 'all tools'}${grant.scope.sessionId ? ` (session ${grant.scope.sessionId})` : ''}`,
        createdAt: Math.max(0, Date.parse(grant.createdAt) || 0),
        origin: 'runtime' as const,
        grantId: grant.id,
        revision: grants.revision,
        ...(grant.scope.toolName ? { toolName: grant.scope.toolName } : {}),
        ...(grant.scope.sessionId ? { sessionId: grant.scope.sessionId } : {}),
      }));
      return { rules: [...runtimeRules, ...localRules] };
    } catch (error) {
      console.warn(
        '[permission.list] Runtime grants unavailable:',
        error instanceof Error ? error.message : error,
      );
      return { rules: localRules };
    }
  });

  // permission.revoke
  registerChannel('permission.revoke', async (input) => {
    const removed = input.grantId
      ? await runtimeHostAdapter.revokePermissionGrant(input.grantId, input.revision!)
      : await permissionRegistry.remove(input.pattern!);
    return { removed };
  });
}
