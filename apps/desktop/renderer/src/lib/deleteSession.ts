// deleteSession — 三个删除入口（SessionMenu ▾菜单/快捷键D、SessionContextMenu 右键、
// SessionList 行内 ×）共享的"删除中反馈 + 收起后移除"流程：
//   1. 在途守卫——IPC 已在途时忽略重复触发（键盘 D 连按 / 多入口并发）。
//   2. markSessionDeleting → 侧栏行立即 dim + spinner，消除 IPC 在途的静默期。
//   3. IPC 成功 → markSessionRemoving（行播 grid-rows 收起动画）→ 等动画播完 →
//      removeSession 真正动本地数据。失败/`session_running` 则 unmark 恢复原样 + toast。
// 本地数据始终等 IPC 成功才动（F033 MEDIUM-4 先例：失败时不乐观更新本地）。

import { useAppStore } from '../store/appStore.js';
import { pushToast } from '../store/toastStore.js';
import type { MessageKey } from '../i18n/messages.js';

/** 与行收起 CSS transition 时长一致（LeftSidebar.SessionRow / SessionList 的 duration-200）。*/
const ROW_COLLAPSE_MS = 200;

/**
 * 行收起动画的过渡 class——与 ROW_COLLAPSE_MS 配套使用（时长必须一致，否则动画被截断或空窗）。
 * 以字面量集中在本文件：Tailwind 的 content glob 覆盖 renderer/src 下全部 .ts 文件，
 * 此处字面量会被扫描生成对应 CSS，两个行组件引用常量即不会漂移。
 */
export const ROW_COLLAPSE_CLASS =
  'transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none';

export type DeleteSessionOutcome = 'deleted' | 'busy' | 'failed' | 'ignored';

export async function deleteSessionWithFeedback(
  sessionId: string,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): Promise<DeleteSessionOutcome> {
  const bridge = window.kodaxSpace;
  if (!bridge) return 'failed';
  const initial = useAppStore.getState();
  if (
    initial.deletingSessionIds.has(sessionId) ||
    initial.removingSessionIds.has(sessionId)
  ) {
    return 'ignored';
  }
  initial.markSessionDeleting(sessionId);
  try {
    const r = await bridge.invoke('session.delete', { sessionId });
    if (!r.ok) {
      useAppStore.getState().unmarkSessionDeleting(sessionId);
      pushToast(r.error?.message ?? t('common.unknownError'), 'error');
      return 'failed';
    }
    if (r.data.deleted) {
      useAppStore.getState().markSessionRemoving(sessionId);
      // 等收起动画播完再动 store——动画由 removingSessionIds 驱动，行此时仍在列表里。
      await new Promise((resolve) => setTimeout(resolve, ROW_COLLAPSE_MS));
      useAppStore.getState().removeSession(sessionId); // 内部同步清 deleting/removing 标记
      window.dispatchEvent(new Event('kodax-space.focus-textarea'));
      return 'deleted';
    }
    useAppStore.getState().unmarkSessionDeleting(sessionId);
    if (r.data.reason === 'session_running') {
      pushToast(t('menu.session.deleteBusy'), 'warning');
      return 'busy';
    }
    // ok 但既未删除也非 session_running——主进程契约外的兜底，恢复行原样
    pushToast(t('common.unknownError'), 'error');
    return 'failed';
  } catch (err) {
    // preload invoke 透传 ipcRenderer.invoke——handler 未捕获异常时 reject。
    // 不兜底会泄漏 deleting 标记：行永久卡"删除中"，且在途守卫会锁死该 session 的后续删除。
    useAppStore.getState().unmarkSessionDeleting(sessionId);
    pushToast(err instanceof Error ? err.message : t('common.unknownError'), 'error');
    return 'failed';
  }
}
