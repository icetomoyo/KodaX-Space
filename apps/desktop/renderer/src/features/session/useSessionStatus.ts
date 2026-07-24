// F040: per-session status hook —— 把 store 里散布在多处的事件流派生成一个紧凑枚举：
//
//   - 'running'  : session 正在跑（pendingSend 或 in-flight 事件流）
//   - 'awaiting' : 等用户确认（permissionQueue / askUserQueue 头部）
//   - 'error'    : 最近一条 session lifecycle 事件是 session_error 且未被新事件 supersede
//   - 'idle'     : 其它
//
// LeftSidebar.ProjectTree 用这个驱动每行末尾的状态点 + 折叠项目节点的运行计数。
//
// 选择 hook 形态而非 store-derived state 的原因：
//   - 每次 events 流入都重算需要 selector，store 里写就会污染 reducer
//   - hook 把派生留给消费者，且 useMemo 自动跟随 events buffer 引用变化
//   - 同 session 多处订阅时 React 会去重 re-render，相比 store 衍生不慢

import { useMemo } from 'react';
import { useAppStore } from '../../store/appStore.js';

export type SessionStatus = 'idle' | 'running' | 'awaiting' | 'error';

/**
 * 单 session 状态。
 * 优先级 awaiting > error > running > idle —— 等用户操作的事比 spinner 更紧急。
 */
export function useSessionStatus(sessionId: string | null): SessionStatus {
  const pending = useAppStore((s) =>
    sessionId ? Boolean(s.pendingSendBySession[sessionId]) : false,
  );
  const events = useAppStore((s) => (sessionId ? s.eventsBySession[sessionId] : undefined));
  const awaitingPermission = useAppStore((s) =>
    sessionId ? s.permissionQueue.some((p) => p.sessionId === sessionId) : false,
  );
  const awaitingAskUser = useAppStore((s) =>
    sessionId ? s.askUserQueue.some((p) => p.sessionId === sessionId) : false,
  );
  const errorSeenAt = useAppStore((s) =>
    sessionId ? (s.errorSeenAtBySession[sessionId] ?? 0) : 0,
  );
  const runtimeLive = useAppStore((s) =>
    sessionId ? s.liveProjectionBySession[sessionId] : undefined,
  );

  return useMemo<SessionStatus>(() => {
    if (!sessionId) return 'idle';
    if (
      runtimeLive?.activeRun?.phase === 'waiting_permission' ||
      runtimeLive?.activeRun?.phase === 'waiting_user_input' ||
      runtimeLive?.interactions.some((interaction) => interaction.state === 'pending')
    ) {
      return 'awaiting';
    }
    // Renderer queues can arrive one frame before the Runtime projection catches up. Human input
    // must still outrank running/error so the sidebar never loses the actionable signal.
    if (awaitingPermission || awaitingAskUser) return 'awaiting';
    if (runtimeLive?.activeRun || (runtimeLive?.queuedRuns.length ?? 0) > 0) return 'running';
    if (
      runtimeLive?.lastTerminalRun?.phase === 'failed' ||
      runtimeLive?.lastTerminalRun?.phase === 'interrupted'
    ) {
      return 'error';
    }
    // 倒扫 events 找最近一条 session lifecycle —— complete/error 表示已结束
    if (events) {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.kind === 'session_error') {
          // 已被用户看过（含取消）的 error 不再亮红点；未看过的才算 'error'。
          if (i >= errorSeenAt) return 'error';
          break;
        }
        if (ev.kind === 'session_complete') break; // session 结束但没错 → 看 pending/start
        if (ev.kind === 'session_start') return 'running';
      }
    }
    if (pending) return 'running';
    return 'idle';
  }, [sessionId, pending, events, awaitingPermission, awaitingAskUser, errorSeenAt, runtimeLive]);
}

/**
 * 批量 —— 项目展开聚合 N session 计数时复用。返回每种状态的 sessionId 数组。
 * 性能：events 引用变化时会重算，但 ProjectTree 调用层会按 projectPath 切片，
 * 单项目几十条 session 内运算量小，不影响渲染。
 */
export function useSessionStatusMap(
  sessionIds: readonly string[],
): Readonly<Record<string, SessionStatus>> {
  const pendingMap = useAppStore((s) => s.pendingSendBySession);
  const eventsMap = useAppStore((s) => s.eventsBySession);
  const permissionQueue = useAppStore((s) => s.permissionQueue);
  const askUserQueue = useAppStore((s) => s.askUserQueue);
  const errorSeenMap = useAppStore((s) => s.errorSeenAtBySession);
  const liveProjectionBySession = useAppStore((s) => s.liveProjectionBySession);

  return useMemo(() => {
    const permissionSids = new Set(permissionQueue.map((p) => p.sessionId));
    const askUserSids = new Set(askUserQueue.map((p) => p.sessionId));
    const out: Record<string, SessionStatus> = {};
    for (const sid of sessionIds) {
      const runtimeLive = liveProjectionBySession[sid];
      if (
        runtimeLive?.activeRun?.phase === 'waiting_permission' ||
        runtimeLive?.activeRun?.phase === 'waiting_user_input' ||
        runtimeLive?.interactions.some((interaction) => interaction.state === 'pending')
      ) {
        out[sid] = 'awaiting';
        continue;
      }
      if (permissionSids.has(sid) || askUserSids.has(sid)) {
        out[sid] = 'awaiting';
        continue;
      }
      if (runtimeLive?.activeRun || (runtimeLive?.queuedRuns.length ?? 0) > 0) {
        out[sid] = 'running';
        continue;
      }
      if (
        runtimeLive?.lastTerminalRun?.phase === 'failed' ||
        runtimeLive?.lastTerminalRun?.phase === 'interrupted'
      ) {
        out[sid] = 'error';
        continue;
      }
      const events = eventsMap[sid];
      let status: SessionStatus = pendingMap[sid] ? 'running' : 'idle';
      if (events) {
        const seenAt = errorSeenMap[sid] ?? 0;
        for (let i = events.length - 1; i >= 0; i--) {
          const ev = events[i];
          if (ev.kind === 'session_error') {
            // 已看过（含取消）的 error 不再亮红点；保持 running/idle。未看过才标 'error'。
            if (i >= seenAt) status = 'error';
            break;
          }
          if (ev.kind === 'session_complete') {
            // complete 不重写 status —— 让 pendingSend 决定（罕见 race：用户在 complete 后立刻
            // 新 send，pendingSend=true 让 status='running' 立刻反映）
            break;
          }
          if (ev.kind === 'session_start') {
            status = 'running';
            break;
          }
        }
      }
      out[sid] = status;
    }
    return out;
  }, [
    sessionIds,
    pendingMap,
    eventsMap,
    permissionQueue,
    askUserQueue,
    errorSeenMap,
    liveProjectionBySession,
  ]);
}
