// File tree (lazy load + expand/collapse) — F009.
//
// 渲染递归 FileNode 树。dir 展开时按需 invoke files.tree(subPath) 拉子节点 cache 在 local state，
// 不放 zustand——树状态只在 FilePanel 内消费。点击 file 通过 onSelect 回调上抛。
//
// 性能要点：
//   - 渲染 5k 节点用普通 DOM 就够；超过再考虑虚拟化（v0.1.0 暂不引 react-window）
//   - 展开状态用 Set<path> 跟踪——避免在 node 上加 mutable expanded 字段

import { useEffect, useRef, useState } from 'react';
import { File, FileCode, Folder, FolderOpen } from 'lucide-react';
import type { FileNodeT } from '@kodax-space/space-ipc-schema';
import { Caret } from '../../components/Caret.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import { extOf } from '../../lib/pathClassify.js';
import { fileTreeRefreshPaths, splitFileTreeLabel } from './fileTreeModel.js';

interface FileTreeProps {
  projectRoot: string;
  /** 当前选中文件——高亮显示 */
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onSelectDirectory?: (path: string) => void;
  onFileContextMenu?: (path: string, x: number, y: number) => void;
  /** Changing this token refreshes the root and all currently expanded directories. */
  refreshToken?: number;
}

export function FileTree({
  projectRoot,
  selectedPath,
  onSelect,
  onSelectDirectory,
  onFileContextMenu,
  refreshToken,
}: FileTreeProps): JSX.Element {
  const { t } = useI18n();
  const [rootNodes, setRootNodes] = useState<readonly FileNodeT[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 缓存已加载的子树：path → children
  const [childrenCache, setChildrenCache] = useState<Record<string, readonly FileNodeT[]>>({});
  const expandedRef = useRef<Set<string>>(new Set());
  const loadGenerationRef = useRef(0);
  const lastRefreshTokenRef = useRef(refreshToken);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  // 项目根变了：重新拉树
  useEffect(() => {
    if (!projectRoot) return;
    let cancelled = false;
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setErr(null);
    setRootNodes([]);
    setExpanded(new Set());
    setChildrenCache({});

    const bridge = window.kodaxSpace;
    if (!bridge) {
      setErr(t('code.ipcUnavailable'));
      setLoading(false);
      return;
    }
    bridge
      .invoke('files.tree', { projectRoot, depth: 1 })
      .then((result) => {
        if (cancelled || generation !== loadGenerationRef.current) return;
        if (result.ok) {
          setRootNodes(result.data.tree);
          setTruncated(result.data.truncated);
        } else {
          setErr(`${result.error.code}: ${result.error.message}`);
        }
      })
      .finally(() => {
        if (!cancelled && generation === loadGenerationRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectRoot, t]);

  useEffect(() => {
    if (refreshToken === undefined || refreshToken === lastRefreshTokenRef.current) return;
    lastRefreshTokenRef.current = refreshToken;

    const bridge = window.kodaxSpace;
    if (!projectRoot || !bridge) return;
    let cancelled = false;
    const generation = ++loadGenerationRef.current;
    const refreshPaths = fileTreeRefreshPaths(expandedRef.current);

    void Promise.all(
      refreshPaths.map((subPath) =>
        bridge.invoke(
          'files.tree',
          subPath === null ? { projectRoot, depth: 1 } : { projectRoot, subPath, depth: 1 },
        ),
      ),
    )
      .then((results) => {
        if (cancelled || generation !== loadGenerationRef.current) return;
        const rootResult = results[0];
        if (!rootResult?.ok) {
          if (rootResult) setErr(`${rootResult.error.code}: ${rootResult.error.message}`);
          return;
        }

        setRootNodes(rootResult.data.tree);
        setTruncated(rootResult.data.truncated);
        setErr(null);

        const refreshedChildren: Record<string, readonly FileNodeT[]> = {};
        for (let index = 1; index < results.length; index += 1) {
          const result = results[index];
          const path = refreshPaths[index];
          if (path !== null && result?.ok) refreshedChildren[path] = result.data.tree;
        }
        if (Object.keys(refreshedChildren).length > 0) {
          setChildrenCache((current) => ({ ...current, ...refreshedChildren }));
        }
      })
      .catch((error: unknown) => {
        if (cancelled || generation !== loadGenerationRef.current) return;
        setErr(error instanceof Error ? error.message : t('common.unknownError'));
      })
      .finally(() => {
        if (!cancelled && generation === loadGenerationRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectRoot, refreshToken, t]);

  async function toggleDir(path: string): Promise<void> {
    const next = new Set(expanded);
    if (next.has(path)) {
      next.delete(path);
      setExpanded(next);
      return;
    }
    next.add(path);
    setExpanded(next);

    // 已 cache 过就不重拉
    if (childrenCache[path]) return;
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    const result = await bridge.invoke('files.tree', {
      projectRoot,
      subPath: path,
      depth: 1,
    });
    if (result.ok) {
      setChildrenCache((c) => ({ ...c, [path]: result.data.tree }));
    }
  }

  if (loading) {
    return <div className="text-xs text-fg-muted p-3">{t('code.loadingTree')}</div>;
  }
  if (err) {
    return <div className="text-xs text-danger p-3 font-mono">{err}</div>;
  }
  if (rootNodes.length === 0) {
    return <div className="text-xs text-fg-faint p-3">{t('code.emptyProject')}</div>;
  }
  return (
    <div className="text-[12px] font-mono select-none">
      {truncated && (
        <div className="text-[11px] text-warn px-2 py-1 border-b border-border-default">
          {t('code.treeTruncated')}
        </div>
      )}
      <FileTreeLevel
        nodes={rootNodes}
        depth={0}
        expanded={expanded}
        childrenCache={childrenCache}
        selectedPath={selectedPath}
        onToggle={(p) => void toggleDir(p)}
        onSelect={onSelect}
        onSelectDirectory={onSelectDirectory}
        onFileContextMenu={onFileContextMenu}
      />
    </div>
  );
}

interface FileTreeLevelProps {
  nodes: readonly FileNodeT[];
  depth: number;
  expanded: Set<string>;
  childrenCache: Record<string, readonly FileNodeT[]>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onSelectDirectory?: (path: string) => void;
  onFileContextMenu?: (path: string, x: number, y: number) => void;
}

function FileTreeLevel({
  nodes,
  depth,
  expanded,
  childrenCache,
  selectedPath,
  onToggle,
  onSelect,
  onSelectDirectory,
  onFileContextMenu,
}: FileTreeLevelProps): JSX.Element {
  return (
    <ul>
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={depth}
          expanded={expanded}
          childrenCache={childrenCache}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onSelect={onSelect}
          onSelectDirectory={onSelectDirectory}
          onFileContextMenu={onFileContextMenu}
        />
      ))}
    </ul>
  );
}

interface FileTreeNodeProps {
  node: FileNodeT;
  depth: number;
  expanded: Set<string>;
  childrenCache: Record<string, readonly FileNodeT[]>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onSelectDirectory?: (path: string) => void;
  onFileContextMenu?: (path: string, x: number, y: number) => void;
}

function FileTreeNode({
  node,
  depth,
  expanded,
  childrenCache,
  selectedPath,
  onToggle,
  onSelect,
  onSelectDirectory,
  onFileContextMenu,
}: FileTreeNodeProps): JSX.Element {
  const isDir = node.kind === 'dir';
  const isExpanded = isDir && expanded.has(node.path);
  // dir 子节点优先用 cache（lazy load 后的）；否则用 node.children（initial depth=1 时为空）
  const dirChildren = isDir ? (childrenCache[node.path] ?? node.children ?? []) : [];
  const isSelected = node.path === selectedPath;
  const padLeft = depth * 12 + 6;
  const FileIcon = isCodeLikePath(node.path) ? FileCode : File;
  const FolderIcon = isExpanded ? FolderOpen : Folder;
  const label = splitFileTreeLabel(node.name, node.kind);

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          if (isDir) {
            onToggle(node.path);
            onSelectDirectory?.(node.path);
          } else {
            onSelect(node.path);
          }
        }}
        onContextMenu={(e) => {
          if (isDir || !onFileContextMenu) return;
          e.preventDefault();
          onFileContextMenu(node.path, e.clientX, e.clientY);
        }}
        className={`w-full text-left flex items-center gap-1.5 px-1 py-1 rounded hover:bg-hover-bg ${
          isSelected ? 'bg-surface-3 text-fg-primary' : 'text-fg-secondary hover:text-fg-primary'
        }`}
        style={{ paddingLeft: padLeft }}
        title={node.path}
      >
        <span className="w-4 text-fg-muted inline-flex justify-center flex-shrink-0" aria-hidden>
          {isDir ? <Caret open={isExpanded} /> : null}
        </span>
        <span className="w-3.5 h-3.5 text-fg-muted inline-flex items-center justify-center flex-shrink-0">
          {isDir ? (
            <FolderIcon className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
          ) : (
            <FileIcon className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
          )}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline overflow-hidden">
          <span className="min-w-0 flex-1 truncate">{label.leading}</span>
          {label.trailing && <span className="flex-shrink-0">{label.trailing}</span>}
        </span>
      </button>
      {isDir && isExpanded && dirChildren.length > 0 && (
        <FileTreeLevel
          nodes={dirChildren}
          depth={depth + 1}
          expanded={expanded}
          childrenCache={childrenCache}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onSelect={onSelect}
          onSelectDirectory={onSelectDirectory}
          onFileContextMenu={onFileContextMenu}
        />
      )}
    </li>
  );
}

function isCodeLikePath(path: string): boolean {
  const ext = extOf(path);
  if (ext === '') return false;
  return !['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'zip'].includes(ext);
}
