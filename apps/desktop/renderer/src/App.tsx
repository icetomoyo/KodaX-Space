// App — renderer bootstrap shell.
//
// 顶层负责：
//   - 一次性订阅 push channel `session.event`，按 sessionId 路由进 store
//   - 启动期拉取 version / providers / defaults / project 列表
//   - 渲染新 Shell，以及仍需 hoist 到 App 层的 provider settings / quick ask overlay
//
// 不在这里：
//   - 业务状态——全部 Zustand store
//   - layout 结构——由 shell/* 接管

import { useEffect, useRef, useState } from 'react';
import type {
  SessionEvent,
  SpaceRuntimeDefaultsT,
  SpaceVersionOutput,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from './store/appStore.js';
import { pushToast } from './store/toastStore.js';
import { useI18n } from './i18n/I18nProvider.js';
import { SettingsModal } from './features/settings/SettingsModal.js';
import { QuickAskPopover } from './features/quick-ask/QuickAskPopover.js';
import { useSessionCompleteNotification } from './features/notifications/useSessionCompleteNotification.js';
import { Shell } from './shell/Shell.js';
import { formatWorkflowEventNotices } from './features/workflow/workflowNotices.js';
import { requestTaskDockFocus } from './shell/taskDockControl.js';

// Shell owns the visible layout; App keeps process-wide bootstrapping and global listeners.
const HIDDEN_SESSION_EVENT_FLUSH_MS = 100;

// Workflow notice dedup lives in appendEvent keyed workflow_notice events, not a module
// Set here. The notices must share the session.event stream with assistant text so a
// workflow result lands before the main-agent report that follows it.

type SessionEventAppender = (event: SessionEvent) => void;
type StreamDeltaEvent = Extract<SessionEvent, { kind: 'text_delta' | 'thinking_delta' }>;

function isStreamDeltaEvent(event: SessionEvent): event is StreamDeltaEvent {
  return event.kind === 'text_delta' || event.kind === 'thinking_delta';
}

function mergeAdjacentStreamDeltas(events: readonly SessionEvent[]): SessionEvent[] {
  const merged: SessionEvent[] = [];
  for (const event of events) {
    const previous = merged.at(-1);
    if (
      previous !== undefined &&
      isStreamDeltaEvent(previous) &&
      isStreamDeltaEvent(event) &&
      previous.sessionId === event.sessionId &&
      previous.kind === event.kind &&
      previous.text.length + event.text.length <= 256 * 1024
    ) {
      merged[merged.length - 1] = { ...event, text: previous.text + event.text };
    } else {
      merged.push(event);
    }
  }
  return merged;
}

function createSessionEventBatcher(appendEvent: SessionEventAppender): {
  push(event: SessionEvent): void;
  flush(): void;
  dispose(): void;
} {
  let queue: SessionEvent[] = [];
  let rafId: number | null = null;
  let timerId: number | null = null;

  const clearScheduled = (): void => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (timerId !== null) {
      window.clearTimeout(timerId);
      timerId = null;
    }
  };

  const flush = (): void => {
    clearScheduled();
    if (queue.length === 0) return;
    const pending = mergeAdjacentStreamDeltas(queue);
    queue = [];
    for (const event of pending) appendEvent(event);
  };

  const schedule = (): void => {
    if (rafId !== null || timerId !== null) return;
    if (document.hidden || !document.hasFocus()) {
      timerId = window.setTimeout(flush, HIDDEN_SESSION_EVENT_FLUSH_MS);
      return;
    }
    rafId = window.requestAnimationFrame(flush);
  };

  return {
    push(event) {
      queue.push(event);
      schedule();
    },
    flush,
    dispose() {
      clearScheduled();
      queue = [];
    },
  };
}

export default function App(): JSX.Element {
  const [version, setVersion] = useState<SpaceVersionOutput | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // F018 Quick Ask popover —— Cmd/Ctrl+K toggles
  const [showQuickAsk, setShowQuickAsk] = useState(false);
  const { t } = useI18n();
  const appendEvent = useAppStore((s) => s.appendEvent);
  const enqueuePermission = useAppStore((s) => s.enqueuePermission);
  const dequeuePermission = useAppStore((s) => s.dequeuePermission);
  const enqueueAskUser = useAppStore((s) => s.enqueueAskUser);
  const dequeueAskUser = useAppStore((s) => s.dequeueAskUser);
  const setProviders = useAppStore((s) => s.setProviders);
  const setKodaxDefaults = useAppStore((s) => s.setKodaxDefaults);
  const setRuntimeDefaults = useAppStore((s) => s.setRuntimeDefaults);
  const setCoderRuntimeConnection = useAppStore((s) => s.setCoderRuntimeConnection);
  const replaceRuntimeProfileProjection = useAppStore((s) => s.replaceRuntimeProfileProjection);
  const replaceSessionLiveProjection = useAppStore((s) => s.replaceSessionLiveProjection);
  const applySessionLiveProjectionChange = useAppStore((s) => s.applySessionLiveProjectionChange);
  const setPendingReasoningMode = useAppStore((s) => s.setPendingReasoningMode);
  const setPendingPermissionMode = useAppStore((s) => s.setPendingPermissionMode);
  const setPendingAutoModeEngine = useAppStore((s) => s.setPendingAutoModeEngine);
  const setPendingAgentMode = useAppStore((s) => s.setPendingAgentMode);
  const setQueueState = useAppStore((s) => s.setQueueState);
  const upsertWorkflowRun = useAppStore((s) => s.upsertWorkflowRun);
  const seedWorkflowRuns = useAppStore((s) => s.seedWorkflowRuns);
  const appendWorkflowActivity = useAppStore((s) => s.appendWorkflowActivity);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const setSessionFlag = useAppStore((s) => s.setSessionFlag);
  const unsubsRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    let disposed = false;
    const liveSnapshotRequests = new Set<string>();
    const sessionEventBatcher = createSessionEventBatcher(appendEvent);
    const flushSessionEventsIfActive = (): void => {
      if (!document.hidden && document.hasFocus()) sessionEventBatcher.flush();
    };
    window.addEventListener('focus', flushSessionEventsIfActive);
    document.addEventListener('visibilitychange', flushSessionEventsIfActive);

    // F121 Part 1: listener-first Runtime bootstrap. The current main controller
    // truthfully reports `incompatible` until the published daemon SDK is wired.
    // No UI capability or Coder routing changes are inferred from channel presence.
    const requestLiveSnapshot = (sessionId: string): void => {
      if (liveSnapshotRequests.has(sessionId)) return;
      liveSnapshotRequests.add(sessionId);
      void bridge
        .invoke('session.liveSnapshot', { sessionId })
        .then((result) => {
          if (!disposed && result.ok) replaceSessionLiveProjection(result.data);
        })
        .catch(() => {})
        .finally(() => {
          if (!disposed) liveSnapshotRequests.delete(sessionId);
        });
    };
    unsubsRef.current.push(
      bridge.on('runtime.connectionChanged', (connection) => {
        setCoderRuntimeConnection(connection);
      }),
      bridge.on('runtime.profileChanged', (profile) => {
        replaceRuntimeProfileProjection(profile);
      }),
      bridge.on('session.liveChanged', (change) => {
        const status = applySessionLiveProjectionChange(change);
        if (status !== 'snapshot-required') return;
        requestLiveSnapshot(change.sessionId);
      }),
    );
    void bridge
      .invoke('runtime.profileSnapshot', undefined)
      .then((result) => {
        if (!disposed && result.ok) replaceRuntimeProfileProjection(result.data);
      })
      .catch(() => {});

    // 启动期一次性自检 + 订阅事件流
    bridge.invoke('space.version', undefined).then((result) => {
      if (result.ok) setVersion(result.data);
    });

    // FEATURE_004 启动时拉一次 provider 列表（main 已经把 keychain 中的 key 注入 env）
    bridge.invoke('provider.list', undefined).then((result) => {
      if (result.ok) {
        setProviders(
          result.data.providers,
          result.data.defaultProviderId,
          result.data.keychainBackend,
        );
      }
    });

    // v0.1.6 cleanup: 同时拉 ~/.kodax/config.json 的默认值（provider / model / thinking 等）
    // Space defaultProviderId 为 null 时 SessionList 会 fallback 到这里的 provider；
    // session 创建时也用这里的 reasoningMode / model 作为初值。失败静默 — 用 Space 自己的 default。
    bridge.invoke('kodax.getDefaults', {}).then((result) => {
      if (result.ok) {
        setKodaxDefaults(result.data);
      }
    });

    // v0.1.23: hydrate Space-owned runtime defaults, then migrate old LS pending values once.
    void bridge
      .invoke('settings.get', {})
      .then((result) => {
        if (!result.ok) return;
        const defaults = result.data.runtimeDefaults ?? {};
        setRuntimeDefaults(defaults);
        const state = useAppStore.getState();
        const patch: Partial<SpaceRuntimeDefaultsT> = {};

        if (defaults.reasoningMode !== undefined) setPendingReasoningMode(defaults.reasoningMode);
        else if (state.pendingReasoningMode !== null)
          patch.reasoningMode = state.pendingReasoningMode;

        if (defaults.permissionMode !== undefined)
          setPendingPermissionMode(defaults.permissionMode);
        else if (state.pendingPermissionMode !== null)
          patch.permissionMode = state.pendingPermissionMode;

        if (defaults.autoModeEngine !== undefined)
          setPendingAutoModeEngine(defaults.autoModeEngine);
        else if (state.pendingAutoModeEngine !== null)
          patch.autoModeEngine = state.pendingAutoModeEngine;

        if (defaults.agentMode !== undefined) setPendingAgentMode(defaults.agentMode);
        else if (state.pendingAgentMode !== null) patch.agentMode = state.pendingAgentMode;

        if (Object.keys(patch).length === 0) return;
        void bridge
          .invoke('settings.setRuntimeDefaults', { runtimeDefaults: patch })
          .then((saved) => {
            if (!saved.ok) return;
            const next = saved.data.runtimeDefaults ?? {};
            setRuntimeDefaults(next);
            if (next.reasoningMode !== undefined) setPendingReasoningMode(next.reasoningMode);
            if (next.permissionMode !== undefined) setPendingPermissionMode(next.permissionMode);
            if (next.autoModeEngine !== undefined) setPendingAutoModeEngine(next.autoModeEngine);
            if (next.agentMode !== undefined) setPendingAgentMode(next.agentMode);
          })
          .catch(() => {});
      })
      .catch(() => {});

    // 启动期项目恢复 — 优先级：
    //   1. zustand store 已有 currentProjectPath（localStorage 持久化的 → store init 时就填上了）
    //   2. project.list 里 lastUsedAt 最新的 recent project（用户上次开过的真实目录）
    //   3. settings.defaultWorkspace 兜底（首次启动新用户）
    //
    // 之前直接走 defaultWorkspace，等同于"每次启动都打开默认 workspace"——用户在
    // KodaX-Space / 别的项目里干完活退出，下次开 Space 又跳回默认目录，体验差。
    // 现在按"最近用的"恢复，跟 VSCode / Claude Desktop / Cursor 等 IDE 一致。
    void (async () => {
      const listR = await bridge.invoke('project.list', undefined).catch(() => null);
      const projects = listR && listR.ok ? listR.data.projects : [];
      useAppStore.getState().setProjects(projects);

      // 已经有 currentProjectPath（localStorage 恢复 / 用户已操作）→ 不覆盖
      if (useAppStore.getState().currentProjectPath) return;

      // 优先用 recent 里 lastUsedAt 最新的
      if (projects.length > 0) {
        const mostRecent = projects.reduce((a, b) => (b.lastUsedAt > a.lastUsedAt ? b : a));
        useAppStore.getState().setCurrentProject(mostRecent.path);
        return;
      }

      // 一个 recent 都没有 → 真"首次启动"，落到 defaultWorkspace
      const settingsR = await bridge.invoke('settings.get', {}).catch(() => null);
      if (!settingsR || !settingsR.ok) return;
      const { defaultWorkspace } = settingsR.data;
      useAppStore.getState().setCurrentProject(defaultWorkspace);
      await bridge.invoke('project.recent.add', { path: defaultWorkspace }).catch(() => {});
      const refreshR = await bridge.invoke('project.list', undefined).catch(() => null);
      if (refreshR && refreshR.ok) useAppStore.getState().setProjects(refreshR.data.projects);
    })();

    // 全局 session.event 订阅——所有 session 共用这个监听，store 按 sessionId 路由
    unsubsRef.current.push(
      bridge.on('session.event', (event) => {
        sessionEventBatcher.push(event);
      }),
    );

    // F007: permission ask-and-wait — push 进队列，modal 渲染队列头
    unsubsRef.current.push(
      bridge.on('permission.request', (payload) => {
        enqueuePermission(payload);
      }),
    );

    // main 主动撤回（超时 / session 取消 / 关闭）— renderer 同步 dequeue 关弹窗
    unsubsRef.current.push(
      bridge.on('permission.cancelled', (payload) => {
        dequeuePermission(payload.reqId);
        // #5 fix: reason==='timeout' 之前是静默 dequeue——用户看不出弹窗为什么消失了，
        // 容易误以为自己点漏了。补一条 toast 说明是超时自动处理的。
        if (payload.reason === 'timeout') {
          pushToast(t('toast.permissionTimeout'), 'warning');
        }
      }),
    );

    // FEATURE_032: askUser ask-and-wait — push 进 askUser 队列，AskUserModal 渲染队列头
    unsubsRef.current.push(
      bridge.on('askUser.request', (payload) => {
        enqueueAskUser(payload);
      }),
    );
    unsubsRef.current.push(
      bridge.on('askUser.cancelled', (payload) => {
        dequeueAskUser(payload.reqId);
        // #5 fix: 同 permission.cancelled——超时静默 dequeue 容易让用户困惑弹窗去哪了。
        if (payload.reason === 'timeout') {
          pushToast(t('toast.askUserTimeout'), 'warning');
        }
      }),
    );

    // Queue snapshot reads the SDK process-global MessageQueue. Space follow-up
    // prompts live there too, with Electron-side session ownership guards; enqueue/dequeue
    // ownership stays in main/SDK.
    bridge.invoke('kodax.queueGet', {}).then((r) => {
      if (r.ok) setQueueState(r.data.messages, r.data.totalSize);
    });
    unsubsRef.current.push(
      bridge.on('kodax.queueChanged', (payload) => {
        setQueueState(payload.snapshot, payload.totalSize);
      }),
    );

    // F060 Workflow Harness — 启动期播种已知 run，然后订阅 SDK 进程事件实时流（按 runId 覆盖式 upsert）。
    bridge
      .invoke('workflow.list', undefined)
      .then((r) => {
        if (r.ok) {
          // 只播种右侧栏的 run 列表。workflow 的结果/失败**通知**不再从这里按 wall-clock 重排回
          // transcript —— 改由 session.history 从 transcript 里 SDK 存的 `<task-completed>` 合成
          // 消息**原位**还原(见 ipc/session.ts)。原来那套侧存储重排在 SDK 压缩把 transcript
          // 时间戳压平后会乱序/置顶(治本待 SDK 逐条时间戳,见转交需求)。live 通知仍走 workflow.event。
          seedWorkflowRuns(r.data.runs);
        }
      })
      .catch(() => {
        /* best-effort 播种；失败由后续实时事件补齐 */
      });
    unsubsRef.current.push(
      bridge.on('workflow.event', (payload) => {
        upsertWorkflowRun(payload);
        if (payload.sessionId !== undefined && payload.surface !== 'partner') {
          for (const notice of formatWorkflowEventNotices(payload)) {
            sessionEventBatcher.push({
              kind: 'workflow_notice',
              sessionId: payload.sessionId,
              text: notice.text,
              ...(notice.key !== undefined ? { key: notice.key } : {}),
              ...(notice.sentAt !== undefined ? { sentAt: notice.sentAt } : {}),
            });
          }
        }
        if (
          payload.type === 'workflow_started' &&
          payload.sessionId !== undefined &&
          payload.surface !== 'partner' &&
          useAppStore.getState().currentSessionId === payload.sessionId
        ) {
          requestTaskDockFocus('workflow');
        }
      }),
    );
    // F065 子 agent 活动遥测——归到 run 的有界活动桶（不进主 transcript）。
    unsubsRef.current.push(
      bridge.on('workflow.activity', (payload) => {
        // Digest/activity only feeds the right-sidebar live activity strip. The durable
        // per-agent transcript summary comes solely from the snapshot item-summary path
        // (formatItemSummaryNotice, keyed + deduped) — the same source restore replays —
        // so the digest no longer emits a separate, keyless, duplicate transcript notice.
        appendWorkflowActivity(payload);
      }),
    );

    return () => {
      disposed = true;
      for (const u of unsubsRef.current) u();
      unsubsRef.current = [];
      liveSnapshotRequests.clear();
      window.removeEventListener('focus', flushSessionEventsIfActive);
      document.removeEventListener('visibilitychange', flushSessionEventsIfActive);
      sessionEventBatcher.flush();
      sessionEventBatcher.dispose();
    };
  }, [
    t,
    appendEvent,
    enqueuePermission,
    dequeuePermission,
    enqueueAskUser,
    dequeueAskUser,
    setProviders,
    setKodaxDefaults,
    setRuntimeDefaults,
    setCoderRuntimeConnection,
    replaceRuntimeProfileProjection,
    replaceSessionLiveProjection,
    applySessionLiveProjectionChange,
    setPendingReasoningMode,
    setPendingPermissionMode,
    setPendingAutoModeEngine,
    setPendingAgentMode,
    setQueueState,
    upsertWorkflowRun,
    seedWorkflowRuns,
    appendWorkflowActivity,
  ]);

  // (Esc 关 settings 面板已下放到 SettingsModal 自己 own —— 见 features/settings/SettingsModal.tsx)

  // OC-11: SystemNotice 的 "Provider settings" 按钮派发 CustomEvent —— 这里接住
  // 打开 Settings 模态，让 auth/quota 错误一键能跳转到改 key 的界面。
  useEffect(() => {
    const open = (): void => setShowSettings(true);
    window.addEventListener('kodax-space.open-provider-settings', open);
    return () => window.removeEventListener('kodax-space.open-provider-settings', open);
  }, []);

  // F018 Quick Ask global shortcut: Cmd+K (macOS) / Ctrl+K (others)
  // 跟 VSCode Quick Open / Slack / Linear 一致的 muscle memory。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowQuickAsk((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // F020 long-task complete OS notification — 在前台时不通知，>60s 任务才通知
  useSessionCompleteNotification();

  useEffect(() => {
    if (!currentSessionId) return;
    const markCurrentSessionRead = (): void => {
      if (document.hidden || !document.hasFocus()) return;
      setSessionFlag(currentSessionId, 'unread', false);
    };
    markCurrentSessionRead();
    window.addEventListener('focus', markCurrentSessionRead);
    document.addEventListener('visibilitychange', markCurrentSessionRead);
    return () => {
      window.removeEventListener('focus', markCurrentSessionRead);
      document.removeEventListener('visibilitychange', markCurrentSessionRead);
    };
  }, [currentSessionId, setSessionFlag]);

  // F020 notification click → main 推 'notification.clicked' 带 sessionId；
  // 这里订阅 push 通道，切到对应 session 让用户回到正在跑的对话。
  //
  // v0.1.3.1 修复（F020-H2）：notification 在 OS 通知中心可能存留几分钟到数小时，
  // 期间用户可能删了对应 session。点已删 session 会把 currentSessionId 写成一个不存在
  // 的 id，后续 Shell / ConversationStreamV2 读取时会 null-deref。检查 sessionId 仍存在
  // 才 setCurrentSession；否则静默丢弃（用户感知就是"点了通知没反应"，比白屏 crash 好）。
  const setCurrentSessionForNotif = useAppStore((s) => s.setCurrentSession);
  useEffect(() => {
    if (!window.kodaxSpace) return;
    const unsub = window.kodaxSpace.on('notification.clicked', (payload) => {
      if (!payload.sessionId) return;
      const exists = useAppStore.getState().sessions.some((s) => s.sessionId === payload.sessionId);
      if (exists) setCurrentSessionForNotif(payload.sessionId);
    });
    return () => unsub();
  }, [setCurrentSessionForNotif]);

  // F021 v0.1.5 drag-drop install：把 .mcpb / .dxt 文件拖进 Space 主窗口即触发安装。
  // 走跟 "Install ext" 按钮同一条 IPC（mcpb.install + filePath）。
  // 不属于 mcpb 类的文件 → preventDefault 把浏览器默认 navigate-to-file 行为挡住，但不调 IPC。
  useEffect(() => {
    if (!window.kodaxSpace) return;
    const onDragOver = (e: DragEvent): void => {
      // 必须 preventDefault 才会触发 drop 事件
      e.preventDefault();
    };
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      for (const f of Array.from(files)) {
        const name = f.name.toLowerCase();
        if (!name.endsWith('.mcpb') && !name.endsWith('.dxt')) continue;
        // Electron renderer 在 dropped File 上额外暴露 .path 字段（非标准 Web API）
        const filePath = (f as File & { path?: string }).path;
        if (typeof filePath !== 'string' || filePath.length === 0) continue;
        // fire-and-forget；main 端会用 native notification 给用户成功 / 失败反馈
        void window.kodaxSpace!.invoke('mcpb.install', { filePath });
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // Settings overlay 仍 hoist 在这里；PermissionModal / AskUserModal 由 Shell 内部 mount。
  return (
    <>
      <Shell version={version} />
      {showSettings && (
        <SettingsModal initialTab="providers" onClose={() => setShowSettings(false)} />
      )}
      <QuickAskPopover open={showQuickAsk} onClose={() => setShowQuickAsk(false)} />
    </>
  );
}
