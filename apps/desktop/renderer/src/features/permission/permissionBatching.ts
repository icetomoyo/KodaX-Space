// KX-I-05 智能权限批处理 — selectPermissionBatch
//
// 同一 turn 里 SDK 同时请求多个 permission（如 multi_edit 拍 N 个 file.write）时，
// 用户被弹窗轰炸。这里把队列头部"同 sessionId + 非 danger"的连续 request 合成 batch，
// 让 modal 显示一个批处理视图："Allow all (N) / Deny all (N)" + 逐条独立按钮兜底。
//
// danger request 绝不进 batch（必须 typed-confirm 单独走）— 安全约束硬规则。
//
// Pure function，无 React/window 依赖；apps/desktop/electron/test 直接 import 测试。

import type { PermissionRequestPayload } from '@kodax-space/space-ipc-schema';

export type PermissionBatchSelection =
  | { readonly mode: 'single'; readonly head: PermissionRequestPayload | null }
  | { readonly mode: 'batch'; readonly items: readonly PermissionRequestPayload[]; readonly sessionId: string };

/**
 * Walk queue head while items share `sessionId` and `risk !== 'danger'`.
 * Return:
 *   - { mode: 'batch', items } when >= 2 consecutive items qualify
 *   - { mode: 'single', head } otherwise (head may be null if queue is empty)
 *
 * 行为约束:
 *   - 队头是 danger → single (head = 那条 danger)
 *   - 队头非 danger 但下一条不同 sessionId → single (head)
 *   - 队头非 danger，连续 N 条同 session 非 danger (N >= 2) → batch
 *   - 队列空 → single mode + head=null
 */
export function selectPermissionBatch(
  queue: readonly PermissionRequestPayload[],
): PermissionBatchSelection {
  if (queue.length === 0) return { mode: 'single', head: null };
  const head = queue[0]!;
  // Auto[LLM] prompts carry decision provenance that must remain visible and
  // individually reviewable. Do not hide it inside the compact batch card.
  if (head.risk === 'danger' || head.autoModeDiagnostics) return { mode: 'single', head };
  const batch: PermissionRequestPayload[] = [head];
  for (let i = 1; i < queue.length; i++) {
    const next = queue[i]!;
    if (next.sessionId !== head.sessionId || next.risk === 'danger' || next.autoModeDiagnostics) break;
    batch.push(next);
  }
  if (batch.length < 2) return { mode: 'single', head };
  return { mode: 'batch', items: batch, sessionId: head.sessionId };
}
