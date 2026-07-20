import { FolderOpen, Pencil, Pin, X } from 'lucide-react';
import type { Project } from '@kodax-space/space-ipc-schema';
import { openDirectory } from '../lib/openPath.js';
import { pushToast } from '../store/toastStore.js';
import { requestConfirm } from '../store/confirmStore.js';
import { useI18n } from '../i18n/I18nProvider.js';
import { SidebarContextMenu, type SidebarContextMenuItem } from './SidebarContextMenu.js';
import {
  PROJECT_CONTEXT_MENU_GROUPS,
  type ProjectContextMenuActionId,
} from './sidebarContextMenuModel.js';

interface ProjectContextMenuProps {
  readonly project: Project;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
  readonly onPinProject: () => void;
  readonly onStartRename: () => void;
  readonly onProjectsChanged: () => Promise<void>;
}

const ICON_CLASS = 'h-4 w-4';

export function ProjectContextMenu({
  project,
  x,
  y,
  onClose,
  onPinProject,
  onStartRename,
  onProjectsChanged,
}: ProjectContextMenuProps): JSX.Element {
  const { t } = useI18n();

  async function onRemove(): Promise<void> {
    if (!window.kodaxSpace) return;
    const confirmed = await requestConfirm({
      message: t('menu.project.removeConfirm', { name: project.name }),
      danger: true,
      confirmLabel: t('menu.project.remove'),
    });
    if (!confirmed) return;
    onClose();
    const result = await window.kodaxSpace.invoke('project.recent.remove', { path: project.path });
    if (!result.ok || !result.data.removed) {
      pushToast(t('menu.project.removeFailed'), 'error');
      return;
    }
    pushToast(t('menu.project.removed'), 'info', 1500);
    await onProjectsChanged();
  }

  const actions: Record<ProjectContextMenuActionId, SidebarContextMenuItem> = {
    'pin-project': {
      id: 'pin-project',
      label: t('menu.project.pin'),
      icon: <Pin className={ICON_CLASS} strokeWidth={1.75} aria-hidden />,
      onSelect: () => {
        onPinProject();
        onClose();
        pushToast(t('menu.project.pinned'), 'success', 1400);
      },
    },
    'open-project-folder': {
      id: 'open-project-folder',
      label: t('menu.project.openInFileManager'),
      icon: <FolderOpen className={ICON_CLASS} strokeWidth={1.75} aria-hidden />,
      onSelect: () => {
        onClose();
        void openDirectory(project.path, project.path);
      },
    },
    'rename-project': {
      id: 'rename-project',
      label: t('menu.project.rename'),
      icon: <Pencil className={ICON_CLASS} strokeWidth={1.75} aria-hidden />,
      onSelect: onStartRename,
    },
    'remove-project': {
      id: 'remove-project',
      label: t('menu.project.remove'),
      icon: <X className={ICON_CLASS} strokeWidth={1.75} aria-hidden />,
      danger: true,
      onSelect: () => void onRemove(),
    },
  };

  const groups = PROJECT_CONTEXT_MENU_GROUPS.map((group) =>
    group
      .filter((actionId) => project.archived !== true || actionId !== 'pin-project')
      .map((actionId) => actions[actionId]),
  ).filter((group) => group.length > 0);

  return (
    <SidebarContextMenu
      x={x}
      y={y}
      ariaLabel={t('menu.project.actions', { name: project.name })}
      groups={groups}
      onClose={onClose}
      width={208}
      estimatedHeight={project.archived === true ? 152 : 186}
      testId="project-context-menu"
    />
  );
}
