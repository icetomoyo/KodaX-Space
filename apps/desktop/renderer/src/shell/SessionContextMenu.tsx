import type { SessionMeta } from '@kodax-space/space-ipc-schema';
import { openDirectory } from '../lib/openPath.js';
import { shouldActivateSessionForCurrentScope } from '../lib/sessionActivation.js';
import { useAppStore } from '../store/appStore.js';
import { useSurfaceStore } from '../store/surface.js';
import { requestConfirm } from '../store/confirmStore.js';
import { useI18n } from '../i18n/I18nProvider.js';
import { pushToast } from '../store/toastStore.js';
import { SidebarContextMenu, type SidebarContextMenuItem } from './SidebarContextMenu.js';
import {
  SESSION_CONTEXT_MENU_GROUPS,
  type SessionContextMenuActionId,
} from './sidebarContextMenuModel.js';

interface SessionContextMenuProps {
  readonly session: SessionMeta;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
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
  const flags = useAppStore((state) => state.sessionFlags[session.sessionId]);
  const toggleFlag = useAppStore((state) => state.toggleSessionFlag);
  const upsertSession = useAppStore((state) => state.upsertSession);
  const removeSession = useAppStore((state) => state.removeSession);
  const forkBuffers = useAppStore((state) => state.forkSessionBuffers);
  const setCurrentSession = useAppStore((state) => state.setCurrentSession);
  const userMessages = useAppStore((state) => state.userMessagesBySession[session.sessionId]);

  async function copyText(value: string, successMessage: string): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      pushToast(successMessage, 'success', 1400);
    } catch {
      pushToast(t('fileActions.copyFailed'), 'error');
    }
  }

  async function onFork(): Promise<void> {
    onClose();
    if (!window.kodaxSpace) return;
    const turnIndex = Math.max(0, (userMessages?.length ?? 0) - 1);
    const result = await window.kodaxSpace.invoke('session.fork', {
      sessionId: session.sessionId,
      forkPointTurnIdx: turnIndex,
    });
    if (!result.ok) {
      pushToast(
        t('menu.session.forkFailed', {
          message: result.error?.message ?? t('common.unknownError'),
        }),
        'error',
      );
      return;
    }

    const stub: SessionMeta = {
      ...session,
      sessionId: result.data.newSessionId,
      parentSessionId: session.sessionId,
      forkPointTurnIdx: turnIndex,
      title: session.title ? `${session.title} (fork)` : t('menu.session.forkedTitle'),
      createdAt: result.data.createdAt,
      lastActivityAt: result.data.createdAt,
    };
    upsertSession(stub);
    forkBuffers(session.sessionId, result.data.newSessionId, turnIndex);

    const latest = useAppStore.getState();
    const latestSurface = useSurfaceStore.getState().currentSurface;
    if (
      shouldActivateSessionForCurrentScope(stub, {
        currentProjectPath: latest.currentProjectPath,
        currentSurface: latestSurface,
      })
    ) {
      setCurrentSession(result.data.newSessionId);
    }

    const listResult = await window.kodaxSpace.invoke('session.list', {
      projectRoot: session.projectRoot,
      surface: session.surface,
    });
    if (listResult.ok) {
      useAppStore.getState().replaceSessionsForScope(listResult.data.sessions, {
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

    const result = await window.kodaxSpace.invoke('session.delete', {
      sessionId: session.sessionId,
    });
    if (result.ok && result.data.deleted) {
      removeSession(session.sessionId);
      window.dispatchEvent(new Event('kodax-space.focus-textarea'));
    } else if (result.ok && result.data.reason === 'session_running') {
      pushToast(t('menu.session.deleteBusy'), 'warning');
    } else if (!result.ok) {
      pushToast(result.error?.message ?? t('common.unknownError'), 'error');
    }
  }

  const actions: Record<SessionContextMenuActionId, SidebarContextMenuItem> = {
    'pin-session': {
      id: 'pin-session',
      label: flags?.pinned ? t('menu.session.unpin') : t('menu.session.pin'),
      onSelect: () => {
        toggleFlag(session.sessionId, 'pinned');
        onClose();
      },
    },
    'rename-session': {
      id: 'rename-session',
      label: t('menu.session.rename'),
      onSelect: onStartRename,
    },
    'toggle-session-unread': {
      id: 'toggle-session-unread',
      label: flags?.unread ? t('menu.session.markRead') : t('menu.session.markUnread'),
      onSelect: () => {
        toggleFlag(session.sessionId, 'unread');
        onClose();
      },
    },
    'open-session-folder': {
      id: 'open-session-folder',
      label: t('menu.session.openInFileManager'),
      onSelect: () => {
        onClose();
        void openDirectory(session.projectRoot, session.projectRoot);
      },
    },
    'copy-working-directory': {
      id: 'copy-working-directory',
      label: t('menu.session.copyWorkingDirectory'),
      onSelect: () => {
        onClose();
        void copyText(session.projectRoot, t('menu.session.workingDirectoryCopied'));
      },
    },
    'copy-session-id': {
      id: 'copy-session-id',
      label: t('menu.session.copySessionId'),
      onSelect: () => {
        onClose();
        void copyText(session.sessionId, t('menu.session.sessionIdCopied'));
      },
    },
    'continue-in-new-session': {
      id: 'continue-in-new-session',
      label: t('menu.session.continueInNewTask'),
      onSelect: () => void onFork(),
    },
    'delete-session': {
      id: 'delete-session',
      label: t('menu.session.delete'),
      danger: true,
      onSelect: () => void onDelete(),
    },
  };

  const groups = SESSION_CONTEXT_MENU_GROUPS.map((group) =>
    group.map((actionId) => actions[actionId]),
  );

  return (
    <SidebarContextMenu
      x={x}
      y={y}
      ariaLabel={t('menu.session.actions', {
        title: session.title ?? session.sessionId.slice(0, 8),
      })}
      groups={groups}
      onClose={onClose}
      width={208}
      estimatedHeight={330}
      testId="session-context-menu"
    />
  );
}
