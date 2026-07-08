import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, File, FileCode, FolderTree, Search } from 'lucide-react';
import { FileTree } from '../../features/code/FileTree.js';
import { openFileAsArtifact, toProjectRelative } from '../../lib/openPath.js';
import { extOf } from '../../lib/pathClassify.js';
import { useAppStore } from '../../store/appStore.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import { FileActionMenu } from '../FileActionMenu.js';

interface FileMenuState {
  readonly path: string;
  readonly x: number;
  readonly y: number;
}

interface FilesPanelProps {
  readonly width?: number;
  readonly asSidebar?: boolean;
  readonly onBack?: () => void;
}

export function FilesPanel({
  width,
  asSidebar = false,
  onBack,
}: FilesPanelProps = {}): JSX.Element {
  const { t } = useI18n();
  const projectRoot = useAppStore((s) => s.currentProjectPath);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<readonly string[]>([]);
  const [searching, setSearching] = useState(false);
  const [fileMenu, setFileMenu] = useState<FileMenuState | null>(null);
  const projectName = useMemo(
    () => projectRoot?.split(/[\\/]/).filter(Boolean).pop() ?? '',
    [projectRoot],
  );
  const trimmedQuery = query.trim();

  useEffect(() => {
    let cancelled = false;
    const bridge = window.kodaxSpace;
    if (!projectRoot || !bridge || trimmedQuery.length === 0) {
      setSearchResults([]);
      setSearching(false);
      return () => {
        cancelled = true;
      };
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void bridge
        .invoke('project.fileSearch', {
          projectRoot,
          query: trimmedQuery,
          limit: 80,
        })
        .then((result) => {
          if (cancelled) return;
          setSearchResults(result.ok ? result.data.paths : []);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectRoot, trimmedQuery]);

  function selectFile(path: string): void {
    setSelectedPath(path);
    void openFileAsArtifact(path);
  }

  if (!projectRoot) {
    return (
      <div
        style={width !== undefined ? { width: `${width}px` } : undefined}
        className={
          asSidebar
            ? 'glass lift ix-zone flex flex-col border border-border-default rounded-xl overflow-hidden bg-surface flex-shrink-0 text-[13px]'
            : 'flex h-full items-center justify-center p-6 text-center text-sm text-fg-muted'
        }
      >
        {asSidebar && onBack && (
          <FilesPanelBackHeader projectName="" projectRoot="" selectedPath={null} onBack={onBack} />
        )}
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-fg-muted">
        <div className="max-w-sm">
          <FolderTree
            className="mx-auto mb-3 h-8 w-8 text-fg-faint"
            strokeWidth={1.7}
            aria-hidden
          />
          <div className="font-medium text-fg-primary">{t('files.noProjectTitle')}</div>
          <div className="mt-1 text-xs leading-relaxed">{t('files.noProjectBody')}</div>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={width !== undefined ? { width: `${width}px` } : undefined}
      data-testid="files-panel"
      className={
        asSidebar
          ? 'glass lift ix-zone flex min-h-0 flex-col border border-border-default rounded-xl overflow-hidden bg-surface flex-shrink-0 text-[13px]'
          : 'flex h-full min-h-0 flex-col bg-surface'
      }
    >
      <FilesPanelBackHeader
        projectName={projectName}
        projectRoot={projectRoot}
        selectedPath={selectedPath}
        onBack={onBack}
      />

      <div className="flex-shrink-0 px-3 py-2">
        <label className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-2 px-2.5 py-2 text-xs text-fg-muted">
          <Search className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
          <input
            data-testid="files-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('files.searchPlaceholder')}
            aria-label={t('files.searchAria')}
            className="min-w-0 flex-1 bg-transparent text-fg-primary outline-none placeholder:text-fg-muted"
          />
          {trimmedQuery.length === 0 ? (
            <span className="font-mono text-[11px] text-fg-faint">{t('files.searchHint')}</span>
          ) : (
            <span className="font-mono text-[11px] text-fg-faint">
              {searching ? t('common.loading') : searchResults.length}
            </span>
          )}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {trimmedQuery.length === 0 ? (
          <FileTree
            projectRoot={projectRoot}
            selectedPath={selectedPath}
            onSelect={selectFile}
            onFileContextMenu={(path, x, y) => setFileMenu({ path, x, y })}
          />
        ) : searchResults.length > 0 ? (
          <div className="space-y-0.5 text-[12px] font-mono">
            <div className="px-1 py-1 text-[11px] uppercase tracking-wider text-fg-muted">
              {t('files.searchResults', { count: searchResults.length })}
            </div>
            {searchResults.map((path) => (
              <SearchResultRow
                key={path}
                path={path}
                selected={path === selectedPath}
                onSelect={selectFile}
                onContextMenu={(x, y) => setFileMenu({ path, x, y })}
              />
            ))}
          </div>
        ) : (
          <div className="p-3 text-xs text-fg-muted">
            {searching ? t('common.loading') : t('files.noSearchResults')}
          </div>
        )}
      </div>

      {fileMenu && (
        <FileActionMenu
          path={fileMenu.path}
          x={fileMenu.x}
          y={fileMenu.y}
          primary="artifact"
          onClose={() => setFileMenu(null)}
        />
      )}
    </div>
  );
}

function FilesPanelBackHeader({
  projectName,
  projectRoot,
  selectedPath,
  onBack,
}: {
  readonly projectName: string;
  readonly projectRoot: string;
  readonly selectedPath: string | null;
  readonly onBack?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex-shrink-0 border-b border-border-default px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
            title={t('files.backToSidebar')}
            aria-label={t('files.backToSidebar')}
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
          </button>
        )}
        <FolderTree className="h-4 w-4 flex-shrink-0 text-fg-muted" strokeWidth={1.75} />
        <span className="flex-shrink-0 whitespace-nowrap font-medium text-fg-primary">
          {t('files.title')}
        </span>
        {projectRoot && (
          <span
            className="min-w-0 truncate font-mono text-[11px] text-fg-muted"
            title={projectRoot}
          >
            {projectName}
          </span>
        )}
      </div>
      {selectedPath && (
        <code
          className="mt-1 block truncate pl-6 font-mono text-[11px] leading-4 text-fg-faint"
          title={selectedPath}
        >
          {selectedPath}
        </code>
      )}
    </div>
  );
}

function SearchResultRow({
  path,
  selected,
  onSelect,
  onContextMenu,
}: {
  readonly path: string;
  readonly selected: boolean;
  readonly onSelect: (path: string) => void;
  readonly onContextMenu: (x: number, y: number) => void;
}): JSX.Element {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dir = path.slice(0, Math.max(0, path.length - name.length - 1));
  const Icon = isCodeLikePath(path) ? FileCode : File;
  return (
    <button
      type="button"
      onClick={() => onSelect(path)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      title={path}
      data-testid="files-search-result"
      className={`grid w-full grid-cols-[16px_minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2 rounded px-2 py-1.5 text-left ${
        selected ? 'bg-surface-3 text-fg-primary' : 'text-fg-secondary hover:bg-hover-bg hover:text-fg-primary'
      }`}
    >
      <Icon className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.75} aria-hidden />
      <span className="truncate">{name}</span>
      <span className="truncate text-[11px] text-fg-muted">
        {dir.length > 0 ? toProjectRelative(dir, null) : ''}
      </span>
    </button>
  );
}

function isCodeLikePath(path: string): boolean {
  const ext = extOf(path);
  if (ext === '') return false;
  return !['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'zip'].includes(ext);
}
