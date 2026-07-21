// FilePanel — F009 右抽屉，整合 FileTree + MonacoViewer + DiffViewer。
//
// 视图状态机：
//   - 没选文件 → placeholder
//   - 选了文件 + viewMode='read' → MonacoViewer
//   - 选了文件 + viewMode='diff' + diff 可用 → MonacoDiffViewer
//   - 选了文件 + viewMode='diff' + diff 不可用 → fallback to read + 提示
//
// 与 store 的耦合：只读 currentProjectPath + activeFileFromTool（store 里 derive 出来的
// "最新一次 tool_call 改的文件路径"）。点击 file tree 不写 store——viewer 状态全本地。

import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { FileTree } from './FileTree.js';
import { MonacoViewer } from './MonacoViewer.js';
import { MonacoDiffViewer } from './MonacoDiffViewer.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import { FileNameText } from '../../components/FileNameText.js';

type ViewMode = 'read' | 'diff';

interface FileContent {
  content: string;
  isBinary: boolean;
  truncated: boolean;
  size: number;
}

interface DiffContent {
  before: string;
  after: string;
}

export function FilePanel(): JSX.Element | null {
  const { t } = useI18n();
  const projectRoot = useAppStore((s) => s.currentProjectPath);
  const lastDiffPath = useAppStore((s) => s.lastDiffPath);
  const clearLastDiffPath = useAppStore((s) => s.clearLastDiffPath);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('read');
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [diffContent, setDiffContent] = useState<DiffContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 项目切换：清状态
  useEffect(() => {
    setSelectedPath(null);
    setViewMode('read');
    setFileContent(null);
    setDiffContent(null);
    setErr(null);
  }, [projectRoot]);

  // F009: tool_call write/edit 完成时，store 里的 lastDiffPath 更新
  // → 自动选中那个文件 + 切到 diff 模式
  useEffect(() => {
    if (lastDiffPath === null || !projectRoot) return;
    setSelectedPath(lastDiffPath);
    setViewMode('diff');
    clearLastDiffPath();
  }, [lastDiffPath, projectRoot, clearLastDiffPath]);

  // 选中文件变化：拉内容（+ 可能拉 diff）
  useEffect(() => {
    if (selectedPath === null || !projectRoot) return;
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    let cancelled = false;
    setBusy(true);
    setErr(null);
    setFileContent(null);
    setDiffContent(null);

    void (async () => {
      const readResult = await bridge.invoke('files.read', {
        projectRoot,
        path: selectedPath,
      });
      if (cancelled) return;
      if (!readResult.ok) {
        setErr(`${readResult.error.code}: ${readResult.error.message}`);
        setBusy(false);
        return;
      }
      setFileContent({
        content: readResult.data.content,
        isBinary: readResult.data.isBinary,
        truncated: readResult.data.truncated,
        size: readResult.data.size,
      });

      // diff mode：再拉一次 diff
      if (viewMode === 'diff') {
        const diffResult = await bridge.invoke('files.diff', {
          projectRoot,
          path: selectedPath,
        });
        if (cancelled) return;
        if (diffResult.ok && diffResult.data.available) {
          setDiffContent({ before: diffResult.data.before, after: diffResult.data.after });
        } else {
          // diff 不可用就 fallback 到 read
          setDiffContent(null);
          setViewMode('read');
        }
      }
      setBusy(false);
    })();

    return () => {
      cancelled = true;
    };
    // viewMode 也作为依赖：用户手切 diff/read 时重 fetch
  }, [selectedPath, projectRoot, viewMode]);

  if (!projectRoot) {
    return (
      <div className="w-[420px] border-l border-border-default flex items-center justify-center text-fg-faint text-xs">
        {t('code.openProjectToBrowse')}
      </div>
    );
  }

  return (
    <aside className="w-[480px] border-l border-border-default flex flex-col flex-shrink-0 min-h-0">
      <div className="px-3 py-2 border-b border-border-default flex items-center gap-2 text-xs text-fg-muted flex-shrink-0">
        <span className="font-medium">{t('code.files')}</span>
        {selectedPath && (
          <>
            <span className="text-fg-faint">·</span>
            <FileNameText name={selectedPath} className="flex-1 font-mono text-fg-muted" />
            <button
              type="button"
              className={`px-1.5 py-0.5 rounded text-[11px] ${
                viewMode === 'read'
                  ? 'bg-surface-3 text-fg-primary'
                  : 'text-fg-muted hover:text-fg-secondary'
              }`}
              onClick={() => setViewMode('read')}
            >
              {t('code.read')}
            </button>
            <button
              type="button"
              className={`px-1.5 py-0.5 rounded text-[11px] ${
                viewMode === 'diff'
                  ? 'bg-surface-3 text-fg-primary'
                  : 'text-fg-muted hover:text-fg-secondary'
              }`}
              onClick={() => setViewMode('diff')}
              disabled={!diffContent && viewMode !== 'diff'}
            >
              {t('code.diff')}
            </button>
          </>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-[180px] border-r border-border-default overflow-y-auto overflow-x-hidden flex-shrink-0">
          <FileTree
            projectRoot={projectRoot}
            selectedPath={selectedPath}
            onSelect={(p) => {
              setSelectedPath(p);
              setViewMode('read');
            }}
          />
        </div>

        <div className="flex-1 min-w-0 relative">
          {selectedPath === null && (
            <div className="absolute inset-0 flex items-center justify-center text-fg-faint text-xs">
              {t('code.selectFile')}
            </div>
          )}
          {selectedPath !== null && busy && (
            <div className="absolute inset-0 flex items-center justify-center text-fg-muted text-xs">
              {t('code.loading')}
            </div>
          )}
          {selectedPath !== null && err && (
            <div className="p-3 text-xs text-danger font-mono whitespace-pre-wrap">{err}</div>
          )}
          {selectedPath !== null && !busy && !err && fileContent?.truncated && (
            <FileTooLargePlaceholder size={fileContent.size} />
          )}
          {selectedPath !== null && !busy && !err && fileContent?.isBinary && (
            <BinaryPlaceholder path={selectedPath} />
          )}
          {selectedPath !== null &&
            !busy &&
            !err &&
            fileContent &&
            !fileContent.truncated &&
            !fileContent.isBinary &&
            viewMode === 'read' && (
              <MonacoViewer path={selectedPath} content={fileContent.content} />
            )}
          {selectedPath !== null &&
            !busy &&
            !err &&
            fileContent &&
            !fileContent.truncated &&
            !fileContent.isBinary &&
            viewMode === 'diff' &&
            diffContent && (
              <MonacoDiffViewer
                path={selectedPath}
                before={diffContent.before}
                after={diffContent.after}
              />
            )}
        </div>
      </div>
    </aside>
  );
}

function FileTooLargePlaceholder({ size }: { size: number }): JSX.Element {
  const { t } = useI18n();
  const mb = (size / (1024 * 1024)).toFixed(2);
  return (
    <div className="flex items-center justify-center h-full text-xs text-fg-muted p-4 text-center">
      {t('code.fileTooLarge', { size: mb })}
      <br />
      {t('code.openSystemEditor')}
    </div>
  );
}

function BinaryPlaceholder({ path }: { path: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center h-full text-xs text-fg-muted p-4 text-center">
      <code className="font-mono text-fg-muted">{path}</code>
      <br />
      {t('code.binaryFile')}
    </div>
  );
}
