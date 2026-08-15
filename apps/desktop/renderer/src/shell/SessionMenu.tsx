// SessionMenu — alpha.1
//
// Claude Desktop session 名右侧 ▾ 下拉（截图 1）：
//
//   Open in        ›
//   Pin            P    (alpha.1: 占位)
//   Mark as unread U    (alpha.1: 占位)
//   Rename         R    ✓ 已有
//   Fork           F    ✓ FEATURE_033 (in-memory)
//   Rewind         W    ✓ FEATURE_033 (in-memory)
//   Move to group  ›    (alpha.1: 灰)
//   Archive        A    (alpha.1: 占位)
//   Delete         D    ✓ 已有
//
// 实装：Rename / Fork / Rewind / Delete。Fork/Rewind alpha.1 仅 in-memory（重启 desktop
// 会丢）；KodaX SDK 0.7.42 出 forkSession()/rewindSession() 后接磁盘。

import { useEffect, useState } from 'react';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';
import {
  ExternalLink,
  Pin,
  PinOff,
  Circle,
  Pencil,
  GitFork,
  Undo2,
  Network,
  FolderInput,
  Archive,
  ArchiveRestore,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useAppStore, type UserMessage } from '../store/appStore.js';
import { shouldActivateSessionForCurrentScope } from '../lib/sessionActivation.js';
import { SessionLineagePanel } from '../features/session/SessionLineagePanel.js';
import { useSurfaceStore } from '../store/surface.js';
import { invokeWithTimeout } from '../lib/ipcInvokeWithTimeout.js';
import { deleteSessionWithFeedback } from '../lib/deleteSession.js';
import { requestConfirm } from '../store/confirmStore.js';
import { pushToast } from '../store/toastStore.js';
import { useI18n } from '../i18n/I18nProvider.js';
import {
  latestSelectorTurnIndex,
  localNoticeCutoffSentAtForSelectorTurn,
  messageForSelectorTurn,
  previousSelectorTurnIndex,
} from '../features/session/turnIndex.js';

// 稳定空数组，防 selector `?? []` literal 每次新引用触发 zustand re-render loop (React #185)。
const EMPTY_USER_MESSAGES: readonly UserMessage[] = [];

interface SessionMenuProps {
  sessionId: string;
  onClose: () => void;
}

export function SessionMenu({ sessionId, onClose }: SessionMenuProps): JSX.Element {
  const { t } = useI18n();
  const sessions = useAppStore((s) => s.sessions);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const forkSessionBuffers = useAppStore((s) => s.forkSessionBuffers);
  const rewindSessionBuffers = useAppStore((s) => s.rewindSessionBuffers);
  const userMessages = useAppStore(
    (s) => s.userMessagesBySession[sessionId] ?? EMPTY_USER_MESSAGES,
  );
  const latestTurnIndex = latestSelectorTurnIndex(userMessages);
  const previousTurnIndex = previousSelectorTurnIndex(userMessages);
  const sessionFlags = useAppStore((s) => s.sessionFlags[sessionId]);
  const toggleFlag = useAppStore((s) => s.toggleSessionFlag);
  const session = sessions.find((x) => x.sessionId === sessionId);

  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(session?.title ?? '');
  const [showLineage, setShowLineage] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (renaming) return;
      const key = e.key.toLowerCase();
      const map: Record<string, () => void> = {
        r: () => setRenaming(true),
        d: () => void doDelete(),
        f: () => void doFork(),
        w: () => void doRewind(),
        l: () => setShowLineage((v) => !v),
        p: () => {
          toggleFlag(sessionId, 'pinned');
          onClose();
        },
        u: () => {
          toggleFlag(sessionId, 'unread');
          onClose();
        },
        a: () => {
          toggleFlag(sessionId, 'archived');
          onClose();
        },
        escape: () => onClose(),
      };
      const fn = map[key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renaming, sessionId, latestTurnIndex, previousTurnIndex]);

  async function doRename(): Promise<void> {
    const trimmed = newTitle.trim();
    if (!session || !window.kodaxSpace || trimmed === '' || trimmed === session.title) {
      setRenaming(false);
      onClose();
      return;
    }
    const r = await invokeWithTimeout(window.kodaxSpace, 'session.setTitle', {
      sessionId,
      title: trimmed,
    });
    if (r.ok) {
      upsertSession({ ...session, title: trimmed });
    }
    setRenaming(false);
    onClose();
  }

  async function doDelete(): Promise<void> {
    if (!window.kodaxSpace) return;
    const confirmed = await requestConfirm({
      title: t('menu.session.deleteTitle'),
      message: t('menu.session.deleteMessage', { title: session?.title ?? sessionId }),
      confirmLabel: t('menu.session.delete'),
      danger: true,
    });
    if (!confirmed) return;
    // 统一流程：在途守卫 + "删除中"反馈 + 收起动画后移除（见 lib/deleteSession.ts）。
    // 键盘 D 连按 / 多入口并发由该流程内部守卫。本地数据仍等 IPC 成功才动（F033 MEDIUM-4）。
    await deleteSessionWithFeedback(sessionId, t);
    onClose();
  }

  /**
   * FEATURE_033 Fork: 从当前对话末尾 fork 出一条新 session。
   * alpha.1 in-memory：events 全量复制到新 session id；重启 desktop 会丢。
   * forkPointTurnIdx 取 userMessages.length - 1（即"到最后一条 user message 为止"）；
   * 空对话 fork (没发过任何 prompt) 用 0。
   */
  async function doFork(): Promise<void> {
    if (!window.kodaxSpace || !session) return;
    if (latestTurnIndex === undefined) {
      pushToast(t('menu.session.noTurnsToFork'), 'info');
      onClose();
      return;
    }
    const forkPointTurnIdx = latestTurnIndex;
    const historyBoundary = messageForSelectorTurn(userMessages, forkPointTurnIdx)?.historyBoundary;
    if (session.surface === 'code' && historyBoundary === undefined) {
      pushToast(t('session.historyBoundaryUnavailable'), 'warning');
      onClose();
      return;
    }
    const r = await window.kodaxSpace.invoke('session.fork', {
      sessionId,
      forkPointTurnIdx,
      ...(historyBoundary ? { historyBoundary } : {}),
    });
    if (!r.ok) {
      pushToast(
        t('menu.session.forkFailed', {
          message: r.error?.message ?? t('common.unknownError'),
        }),
        'error',
      );
      onClose();
      return;
    }
    const { newSessionId, createdAt } = r.data;
    // 推一条新 meta 到 sessions list；ports parent metadata 从 main 来（这里手工 mirror，
    // 避免再发一次 session.list；下次 sidebar 刷新会按 main 数据矫正）。
    // title 与 main 端 stripForkSuffix 保持一致——连 fork N 次仍是 "X (fork)"。
    const childTitle =
      session.title !== undefined
        ? `${session.title.replace(/( \(fork\))+$/, '')} (fork)`
        : t('menu.session.forkedTitle');
    const childSession: SessionMeta = {
      sessionId: newSessionId,
      projectRoot: session.projectRoot,
      provider: session.provider,
      reasoningMode: session.reasoningMode,
      permissionMode: session.permissionMode,
      autoModeEngine: session.autoModeEngine,
      agentMode: session.agentMode, // fork 继承 source 的形态
      surface: session.surface, // F045: fork 继承 source 的工作面（与 main host.fork 一致）
      title: childTitle,
      createdAt,
      lastActivityAt: createdAt,
      parentSessionId: sessionId,
      forkPointTurnIdx,
    };
    upsertSession(childSession);
    // 复制 buffer 到新 session
    forkSessionBuffers(sessionId, newSessionId, forkPointTurnIdx);
    // 切到新 session（用户期望"fork 后立刻在新分支里干活"）
    const latest = useAppStore.getState();
    const latestSurface = useSurfaceStore.getState().currentSurface;
    if (
      shouldActivateSessionForCurrentScope(childSession, {
        currentProjectPath: latest.currentProjectPath,
        currentSurface: latestSurface,
      })
    ) {
      setCurrentSession(newSessionId);
    }
    onClose();
  }

  /**
   * FEATURE_033 Rewind: 把当前 session 回退一个 turn（去掉最后一条 user message + 其后所有 events）。
   * 没有可回退的 turn (userMessages.length === 0) → no-op。
   */
  async function doRewind(): Promise<void> {
    if (!window.kodaxSpace || !session) return;
    if (previousTurnIndex === undefined) {
      pushToast(t('menu.session.noEarlierTurn'), 'info');
      onClose();
      return;
    }
    const confirmed = await requestConfirm({
      title: t('menu.session.rewindTitle'),
      message: t('menu.session.rewindMessage'),
      confirmLabel: t('menu.session.rewindOneTurn'),
      danger: true,
    });
    if (!confirmed) {
      onClose();
      return;
    }
    // rewindPastTurnIdx = 保留前 N 条 user messages；要丢最后一条意味着保留 (length - 2) 索引位。
    const rewindPastTurnIdx = previousTurnIndex;
    const historyBoundary = messageForSelectorTurn(
      userMessages,
      rewindPastTurnIdx,
    )?.historyBoundary;
    const localNoticeCutoffSentAt = localNoticeCutoffSentAtForSelectorTurn(
      userMessages,
      rewindPastTurnIdx,
    );
    if (session.surface === 'code' && historyBoundary === undefined) {
      pushToast(t('session.historyBoundaryUnavailable'), 'warning');
      onClose();
      return;
    }
    const r = await window.kodaxSpace.invoke('session.rewind', {
      sessionId,
      rewindPastTurnIdx,
      ...(historyBoundary ? { historyBoundary } : {}),
      ...(localNoticeCutoffSentAt !== undefined ? { localNoticeCutoffSentAt } : {}),
    });
    if (!r.ok) {
      pushToast(
        t('menu.session.rewindFailed', {
          message: r.error?.message ?? t('common.unknownError'),
        }),
        'error',
      );
      onClose();
      return;
    }
    if (!r.data.ok) {
      pushToast(
        t('menu.session.rewindRejected', {
          message: r.data.reason ?? t('common.unknownError'),
        }),
        'error',
      );
      onClose();
      return;
    }
    if (r.data.diskRewound === false) {
      pushToast(
        t('menu.session.rewindRejected', {
          message: t('menu.session.rewindDiskNotRewound'),
        }),
        'error',
      );
      onClose();
      return;
    }
    // IPC ok → 才动 local state（reviewer F033 MEDIUM-4: 失败时不要优化更新本地）
    rewindSessionBuffers(sessionId, rewindPastTurnIdx);
    onClose();
  }

  if (renaming) {
    return (
      <div className="absolute left-0 top-full mt-1 w-64 bg-surface-4 border border-border-default rounded-lg shadow-xl p-2 z-50">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void doRename();
            else if (e.key === 'Escape') {
              setRenaming(false);
              onClose();
            }
          }}
          autoFocus
          className="w-full bg-surface border border-border-default text-xs text-fg-primary px-2 py-1 rounded focus:outline-none focus:border-border-strong"
          placeholder={t('menu.session.newTitlePlaceholder')}
        />
        <div className="flex gap-1 mt-1 text-[11px]">
          <button
            type="button"
            onClick={() => void doRename()}
            className="px-2 py-0.5 rounded bg-surface-3 hover:bg-hover-bg text-fg-primary"
          >
            {t('common.save')}
          </button>
          <button
            type="button"
            onClick={() => {
              setRenaming(false);
              onClose();
            }}
            className="px-2 py-0.5 text-fg-muted hover:text-fg-secondary"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`absolute left-0 top-full mt-1 ${showLineage ? 'w-80' : 'w-52'} bg-surface-4 border border-border-default rounded-lg shadow-xl py-1 text-xs z-50`}
      onMouseLeave={onClose}
    >
      <MenuRow
        Icon={ExternalLink}
        label={t('menu.session.openIn')}
        shortcut=""
        disabled
        hint={t('menu.session.externalAppHint')}
      />
      <MenuRow
        Icon={sessionFlags?.pinned ? PinOff : Pin}
        label={sessionFlags?.pinned ? t('menu.session.unpin') : t('menu.session.pin')}
        shortcut="P"
        onClick={() => {
          toggleFlag(sessionId, 'pinned');
          onClose();
        }}
      />
      <MenuRow
        Icon={Circle}
        label={sessionFlags?.unread ? t('menu.session.markRead') : t('menu.session.markUnread')}
        shortcut="U"
        onClick={() => {
          toggleFlag(sessionId, 'unread');
          onClose();
        }}
      />
      <MenuRow
        Icon={Pencil}
        label={t('menu.session.rename')}
        shortcut="R"
        onClick={() => setRenaming(true)}
      />
      <MenuRow
        Icon={GitFork}
        label={t('menu.session.fork')}
        shortcut="F"
        onClick={() => void doFork()}
        disabled={latestTurnIndex === undefined}
        hint={latestTurnIndex === undefined ? t('menu.session.noTurnsToFork') : undefined}
      />
      <MenuRow
        Icon={Undo2}
        label={t('menu.session.rewindOneTurn')}
        shortcut="W"
        onClick={() => void doRewind()}
        disabled={previousTurnIndex === undefined}
        hint={previousTurnIndex === undefined ? t('menu.session.noEarlierTurn') : undefined}
      />
      <MenuRow
        Icon={Network}
        label={showLineage ? t('menu.session.hideLineage') : t('menu.session.showLineage')}
        shortcut="L"
        onClick={() => setShowLineage((v) => !v)}
      />
      {showLineage && (
        <div className="border-t border-border-default mt-1 pt-1">
          <SessionLineagePanel
            anchorSessionId={sessionId}
            onPickSession={(sid) => {
              setCurrentSession(sid);
              onClose();
            }}
          />
        </div>
      )}
      <MenuRow
        Icon={FolderInput}
        label={t('menu.session.moveToGroup')}
        shortcut=""
        disabled
        hint="v0.1.x"
      />
      <MenuRow
        Icon={sessionFlags?.archived ? ArchiveRestore : Archive}
        label={sessionFlags?.archived ? t('menu.session.unarchive') : t('menu.session.archive')}
        shortcut="A"
        onClick={() => {
          toggleFlag(sessionId, 'archived');
          onClose();
        }}
      />
      <div className="border-t border-border-default my-1" />
      <MenuRow
        Icon={Trash2}
        label={t('menu.session.delete')}
        shortcut="D"
        onClick={() => void doDelete()}
        danger
      />
    </div>
  );
}

interface MenuRowProps {
  Icon: LucideIcon;
  label: string;
  shortcut: string;
  onClick?: () => void;
  disabled?: boolean;
  hint?: string;
  danger?: boolean;
}

function MenuRow({
  Icon,
  label,
  shortcut,
  onClick,
  disabled,
  hint,
  danger,
}: MenuRowProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={`w-full text-left px-3 py-1 flex items-center gap-2 ${
        disabled
          ? 'text-fg-faint cursor-not-allowed'
          : danger
            ? 'text-danger hover:bg-danger/15'
            : 'text-fg-secondary hover:bg-hover-bg'
      }`}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="flex-1">{label}</span>
      <span className="text-[11px] text-fg-faint">{shortcut}</span>
    </button>
  );
}
