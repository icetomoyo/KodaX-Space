import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import { AtSign, Copy, Eye, FolderOpen, GitCompare } from 'lucide-react';
import { Portal } from '../components/Portal.js';
import { openFileInViewer, openInDiff, revealPath, toProjectRelative } from '../lib/openPath.js';
import { useAppStore } from '../store/appStore.js';
import { pushToast } from '../store/toastStore.js';
import { useI18n } from '../i18n/I18nProvider.js';
import { requestInsert } from './inputBridge.js';

type PrimaryFileAction = 'artifact' | 'diff';

interface FileActionMenuProps {
  readonly id?: string;
  readonly path: string;
  readonly x: number;
  readonly y: number;
  readonly primary?: PrimaryFileAction;
  readonly trigger?: HTMLElement | null;
  readonly onClose: () => void;
}

export function insertPathReference(path: string, projectRoot?: string | null): boolean {
  const rel = toProjectRelative(path, projectRoot ?? useAppStore.getState().currentProjectPath);
  return requestInsert(` @${rel} `);
}

export function FileActionMenu({
  id,
  path,
  x,
  y,
  primary = 'artifact',
  trigger,
  onClose,
}: FileActionMenuProps): ReactElement {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const projectRoot = useAppStore((s) => s.currentProjectPath);
  const relativePath = toProjectRelative(path, projectRoot);

  useEffect(() => {
    const returnFocusTarget =
      trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const focusFrame = window.requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
      window.requestAnimationFrame(() => {
        if (returnFocusTarget?.isConnected) returnFocusTarget.focus();
      });
    }
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, trigger]);

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const activeIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowUp'
            ? activeIndex <= 0
              ? items.length - 1
              : activeIndex - 1
            : activeIndex < 0
              ? 0
              : (activeIndex + 1) % items.length;
    items[nextIndex]?.focus();
  }

  async function copyPath(): Promise<void> {
    try {
      await navigator.clipboard.writeText(relativePath);
      pushToast(t('fileActions.copySucceeded'), 'success', 1400);
    } catch {
      pushToast(t('fileActions.copyFailed'), 'error');
    }
  }

  function insertReference(): void {
    if (!insertPathReference(path, projectRoot)) {
      pushToast(t('fileActions.insertFailed'), 'warning');
    }
  }

  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const menuW = 220;
  const menuH = 190;
  const left = Math.max(8, Math.min(x, viewportW - menuW - 8));
  const top = Math.max(8, Math.min(y, viewportH - menuH - 8));
  const artifactFirst = primary === 'artifact';

  return (
    <Portal>
      <div
        id={id}
        ref={ref}
        className="fixed z-[100] min-w-[220px] rounded-lg border border-border-default bg-surface-4 py-1 text-xs shadow-xl"
        style={{ left, top }}
        role="menu"
        onKeyDown={onMenuKeyDown}
      >
        {artifactFirst ? (
          <>
            <MenuRow
              icon={<Eye className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
              label={t('fileActions.openInFileViewer')}
              primary
              onClick={() => {
                onClose();
                void openFileInViewer(path);
              }}
            />
            <MenuRow
              icon={<GitCompare className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
              label={t('fileActions.openDiff')}
              onClick={() => {
                onClose();
                void openInDiff(path, projectRoot);
              }}
            />
          </>
        ) : (
          <>
            <MenuRow
              icon={<GitCompare className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
              label={t('fileActions.openDiff')}
              primary
              onClick={() => {
                onClose();
                void openInDiff(path, projectRoot);
              }}
            />
            <MenuRow
              icon={<Eye className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
              label={t('fileActions.openInFileViewer')}
              onClick={() => {
                onClose();
                void openFileInViewer(path);
              }}
            />
          </>
        )}
        <MenuRow
          icon={<AtSign className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
          label={t('fileActions.insertPath')}
          onClick={() => {
            onClose();
            insertReference();
          }}
        />
        <div className="my-1 border-t border-border-default/70" />
        <MenuRow
          icon={<Copy className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
          label={t('fileActions.copyRelativePath')}
          onClick={() => {
            onClose();
            void copyPath();
          }}
        />
        <MenuRow
          icon={<FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
          label={t('fileActions.revealInFileManager')}
          onClick={() => {
            onClose();
            void revealPath(path, projectRoot);
          }}
        />
      </div>
    </Portal>
  );
}

function MenuRow({
  icon,
  label,
  primary = false,
  onClick,
}: {
  readonly icon: ReactElement;
  readonly label: string;
  readonly primary?: boolean;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      tabIndex={-1}
      className={`grid w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded px-2.5 py-1.5 text-left ${
        primary
          ? 'bg-hover-bg text-fg-primary'
          : 'text-fg-secondary hover:bg-hover-bg hover:text-fg-primary'
      }`}
    >
      <span className="flex h-4 w-4 items-center justify-center text-fg-muted">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
