// SessionContextMenu — alpha.1
//
// Claude Desktop 截图 4：右键 session 标题弹出菜单：
//   ┌──────────────────────┐
//   │ Open in            > │
//   │ Pin                P │
//   │ Mark as unread     U │
//   │ Rename             R │
//   │ Fork               F │
//   │ Move to group      > │
//   │ Archive            A │
//   │ Delete             D │   (红色)
//   └──────────────────────┘
//
// Space 实现状态：
//   - Open in     → 占位（Sublime/VSCode/Cursor 一键打开 — v0.1.x）
//   - Pin         → 本地 sessionFlags.pinned (zustand)
//   - Mark unread → 本地 sessionFlags.unread (zustand)
//   - Rename      → 用 prompt() 弹输入框 → session.setTitle
//   - Fork        → session.fork + appStore.forkSessionBuffers (FEATURE_033 现成)
//   - Move group  → 占位（v0.1.x）
//   - Archive     → 本地 sessionFlags.archived (zustand)
//   - Delete      → session.delete + appStore.removeSession (有确认提示)

import { useEffect, useRef } from 'react';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { shouldActivateSessionForCurrentScope } from '../lib/sessionActivation.js';
import { useSurfaceStore } from '../store/surface.js';
import { Caret } from '../components/Caret.js';
import { Portal } from '../components/Portal.js';
import { requestConfirm } from '../store/confirmStore.js';
import { useI18n } from '../i18n/I18nProvider.js';
import { pushToast } from '../store/toastStore.js';

interface SessionContextMenuProps {
  readonly session: SessionMeta;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
  /** 点 Rename / 按 R → 通知父层让 SessionRow 进入 inline edit 模式
   *  （window.prompt 在 Electron 上不稳定，统一改成 inline edit）*/
  readonly onStartRename: () => void;
}

export function SessionContextMenu({
  session,
  x,
  y,
  onClose,
  onStartRename,
}: SessionContextMenuProps): JSX.Element {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const toggleFlag = useAppStore((s) => s.toggleSessionFlag);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const forkBuffers = useAppStore((s) => s.forkSessionBuffers);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const userMsgs = useAppStore((s) => s.userMessagesBySession[session.sessionId]);

  // 点击菜单外部 / Esc → 关闭
  useEffect(() => {
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
      // 按字母快捷键执行——和截图对齐 (P/U/R/F/A/D)
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        toggleFlag(session.sessionId, 'pinned');
        onClose();
      } else if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        toggleFlag(session.sessionId, 'unread');
        onClose();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        onStartRename();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        void onFork();
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        toggleFlag(session.sessionId, 'archived');
        onClose();
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        void onDelete();
      }
    }
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId]);

  async function onFork(): Promise<void> {
    onClose();
    if (!window.kodaxSpace) return;
    // Fork 在最后一个 user message 处 (turn idx = msgs.length - 1)；
    // 没有 user message 时 idx = 0（直接 fork "空对话"）
    const turnIdx = Math.max(0, (userMsgs?.length ?? 0) - 1);
    const r = await window.kodaxSpace.invoke('session.fork', {
      sessionId: session.sessionId,
      forkPointTurnIdx: turnIdx,
    });
    if (!r.ok) return;
    // 复制 buffer + 建 stub session meta，刷新 list 让 SDK 权威值覆盖
    const stub: SessionMeta = {
      ...session,
      sessionId: r.data.newSessionId,
      parentSessionId: session.sessionId,
      forkPointTurnIdx: turnIdx,
      title: session.title ? `${session.title} (fork)` : t('menu.session.forkedTitle'),
      createdAt: r.data.createdAt,
      lastActivityAt: r.data.createdAt,
    };
    upsertSession(stub);
    forkBuffers(session.sessionId, r.data.newSessionId, turnIdx);
    const latest = useAppStore.getState();
    const latestSurface = useSurfaceStore.getState().currentSurface;
    if (
      shouldActivateSessionForCurrentScope(stub, {
        currentProjectPath: latest.currentProjectPath,
        currentSurface: latestSurface,
      })
    ) {
      setCurrentSession(r.data.newSessionId);
    }
    // F045: 按 fork child 的工作面拉（fork 继承 source surface），与分面列表保持一致——
    // 否则刷新会把另一面的 session 也灌进 store，破坏 Coder/Partner 列表独立。
    const listR = await window.kodaxSpace.invoke('session.list', {
      projectRoot: session.projectRoot,
      surface: session.surface,
    });
    if (listR.ok) {
      useAppStore.getState().replaceSessionsForScope(listR.data.sessions, {
        projectRoot: session.projectRoot,
        surface: session.surface,
      });
    }
  }

  async function onDelete(): Promise<void> {
    onClose();
    if (!window.kodaxSpace) return;
    const confirmed = await requestConfirm({
      title: t('menu.session.deleteTitle'),
      message: t('menu.session.deleteMessage', {
        title: session.title ?? session.sessionId.slice(0, 8),
      }),
      confirmLabel: t('menu.session.delete'),
      danger: true,
    });
    if (!confirmed) return;
    const r = await window.kodaxSpace.invoke('session.delete', { sessionId: session.sessionId });
    if (r.ok && r.data.deleted) {
      removeSession(session.sessionId);
      window.dispatchEvent(new Event('kodax-space.focus-textarea'));
    } else if (r.ok && r.data.reason === 'session_running') {
      pushToast(t('menu.session.deleteBusy'), 'warning');
    } else if (!r.ok) {
      pushToast(r.error?.message ?? t('common.unknownError'), 'error');
    }
  }

  // 屏幕边界保护：菜单宽度 192px / 高度估算约 240px；超出右/下视口时翻转
  const VIEWPORT_W = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const VIEWPORT_H = typeof window !== 'undefined' ? window.innerHeight : 800;
  const MENU_W = 192;
  const MENU_H = 256;
  const left = Math.min(x, VIEWPORT_W - MENU_W - 8);
  const top = Math.min(y, VIEWPORT_H - MENU_H - 8);

  return (
    <Portal>
      <div
        ref={ref}
        className="fixed bg-surface-4 border border-border-default rounded-lg shadow-xl py-1 text-xs z-[100] min-w-[12rem]"
        style={{ left, top }}
        role="menu"
      >
        <MenuRow label={t('menu.session.openIn')} hint="" disabled chevron tip="v0.1.x" />
        <Divider />
        <MenuRow
          label={t('menu.session.pin')}
          hint="P"
          onClick={() => {
            toggleFlag(session.sessionId, 'pinned');
            onClose();
          }}
        />
        <MenuRow
          label={t('menu.session.markUnread')}
          hint="U"
          onClick={() => {
            toggleFlag(session.sessionId, 'unread');
            onClose();
          }}
        />
        <MenuRow label={t('menu.session.rename')} hint="R" onClick={onStartRename} />
        <MenuRow label={t('menu.session.fork')} hint="F" onClick={() => void onFork()} />
        <MenuRow label={t('menu.session.moveToGroup')} hint="" disabled chevron tip="v0.1.x" />
        <MenuRow
          label={t('menu.session.archive')}
          hint="A"
          onClick={() => {
            toggleFlag(session.sessionId, 'archived');
            onClose();
          }}
        />
        <Divider />
        <MenuRow label={t('menu.session.delete')} hint="D" onClick={() => void onDelete()} danger />
      </div>
    </Portal>
  );
}

function MenuRow({
  label,
  hint,
  onClick,
  disabled,
  chevron,
  danger,
  tip,
}: {
  label: string;
  hint: string;
  onClick?: () => void;
  disabled?: boolean;
  chevron?: boolean;
  danger?: boolean;
  tip?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tip}
      role="menuitem"
      className={`w-full text-left px-3 py-1 flex items-center gap-2 ${
        disabled
          ? 'text-fg-faint cursor-not-allowed'
          : danger
            ? 'text-danger hover:bg-hover-bg'
            : 'text-fg-primary hover:bg-hover-bg'
      }`}
    >
      <span className="flex-1">{label}</span>
      {chevron && <Caret open={false} className="text-fg-muted" />}
      {hint && <span className="text-fg-muted text-[11px] font-mono">{hint}</span>}
    </button>
  );
}

function Divider(): JSX.Element {
  return <div className="border-t border-border-default my-1" />;
}
