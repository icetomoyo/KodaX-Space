import { useEffect, useRef } from 'react';
import { AtSign, Copy, Eye, FolderOpen, GitCompare } from 'lucide-react';
import { Portal } from '../components/Portal.js';
import { openFileAsArtifact, openInDiff, revealPath, toProjectRelative } from '../lib/openPath.js';
import { useAppStore } from '../store/appStore.js';
import { pushToast } from '../store/toastStore.js';
import { useI18n } from '../i18n/I18nProvider.js';
import { requestInsert } from './inputBridge.js';

type PrimaryFileAction = 'artifact' | 'diff';

interface FileActionMenuProps {
  readonly path: string;
  readonly x: number;
  readonly y: number;
  readonly primary?: PrimaryFileAction;
  readonly onClose: () => void;
}

export function insertPathReference(path: string, projectRoot?: string | null): boolean {
  const rel = toProjectRelative(path, projectRoot ?? useAppStore.getState().currentProjectPath);
  return requestInsert(` @${rel} `);
}

export function FileActionMenu({
  path,
  x,
  y,
  primary = 'artifact',
  onClose,
}: FileActionMenuProps): JSX.Element {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const projectRoot = useAppStore((s) => s.currentProjectPath);
  const relativePath = toProjectRelative(path, projectRoot);

  useEffect(() => {
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

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
        ref={ref}
        className="fixed z-[100] min-w-[220px] rounded-lg border border-border-default bg-surface-4 py-1 text-xs shadow-xl"
        style={{ left, top }}
        role="menu"
      >
        {artifactFirst ? (
          <>
            <MenuRow
              icon={<Eye className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
              label={t('fileActions.openAsArtifact')}
              primary
              onClick={() => {
                onClose();
                void openFileAsArtifact(path);
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
              label={t('fileActions.openAsArtifact')}
              onClick={() => {
                onClose();
                void openFileAsArtifact(path);
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
  readonly icon: JSX.Element;
  readonly label: string;
  readonly primary?: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className={`grid w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded px-2.5 py-1.5 text-left ${
        primary ? 'bg-hover-bg text-fg-primary' : 'text-fg-secondary hover:bg-hover-bg hover:text-fg-primary'
      }`}
    >
      <span className="flex h-4 w-4 items-center justify-center text-fg-muted">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
