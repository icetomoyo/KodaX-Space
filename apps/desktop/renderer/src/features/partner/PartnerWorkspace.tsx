// PartnerWorkspace — F045 路由目标 / F046 三栏实体。
//
// doc-workspace 三栏（ADR-007 / HLD §9.4）：
//   Sources（左）| 对话 + 输入（中）| Artifact 预览（右）
// 去掉 Coder 的 Subagent tree / 内置 Terminal 抽屉（知识工作不需要）。
//
// F046 范围：三栏 shell + 中栏功能可用（真能对话，绑 Partner session）。
//   - 左栏 Sources：占位（F047 接非 git 作用域目录树 / F052 接 URL 源）
//   - 中栏 PartnerConversation：复用 ConversationStreamV2 + 裁剪版 BottomBar
//   - 右栏 Artifact：占位（F048 接 artifact 登记/预览/迭代/导出）
//
// LeftSidebar（项目 / session / SurfaceTabs）是两 surface 共用的全局导航，在本组件之外
// 由 Shell 渲染。per-surface 当前 session 由 store/surface.ts 的 setSurface 维护。

import { useEffect, useRef, useState } from 'react';
import { Handshake, PanelLeft, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider.js';
import { SourcesPanel } from './SourcesPanel.js';
import { PartnerConversation } from './PartnerConversation.js';
import { ArtifactPanel } from './ArtifactPanel.js';

const LS_KEY_SOURCES_OPEN = 'kodax-space.partnerSourcesOpen';
const LS_KEY_ARTIFACT_OPEN = 'kodax-space.partnerArtifactOpen';
const SOURCES_MIN_WORKSPACE_PX = 640;
const ARTIFACT_MIN_WORKSPACE_PX = 900;

function readPanelOpen(key: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}

function persistPanelOpen(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(key, open ? '1' : '0');
  } catch {
    // Non-critical: losing a panel preference should not affect Partner workspace use.
  }
}

export function PartnerWorkspace(): JSX.Element {
  const { t } = useI18n();
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState<number | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(() => readPanelOpen(LS_KEY_SOURCES_OPEN));
  const [artifactOpen, setArtifactOpen] = useState(() => readPanelOpen(LS_KEY_ARTIFACT_OPEN));

  useEffect(() => {
    const node = workspaceRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const updateWidth = (): void => {
      setWorkspaceWidth(Math.round(node.getBoundingClientRect().width));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const toggleSources = (): void => {
    setSourcesOpen((open) => {
      const next = !open;
      persistPanelOpen(LS_KEY_SOURCES_OPEN, next);
      return next;
    });
  };
  const toggleArtifact = (): void => {
    if (workspaceWidth !== null && workspaceWidth < ARTIFACT_MIN_WORKSPACE_PX) return;
    setArtifactOpen((open) => {
      const next = !open;
      persistPanelOpen(LS_KEY_ARTIFACT_OPEN, next);
      return next;
    });
  };

  const sourcesAutoHidden =
    sourcesOpen && workspaceWidth !== null && workspaceWidth < SOURCES_MIN_WORKSPACE_PX;
  const artifactTooNarrow = workspaceWidth !== null && workspaceWidth < ARTIFACT_MIN_WORKSPACE_PX;
  const artifactAutoHidden = artifactOpen && artifactTooNarrow;
  const showSources = sourcesOpen && !sourcesAutoHidden;
  const showArtifact = artifactOpen && !artifactAutoHidden;
  const sourcesLabel = sourcesAutoHidden
    ? t('partner.kb.hiddenAtWidth')
    : showSources
      ? t('partner.kb.hide')
      : t('partner.kb.show');
  const artifactLabel = artifactTooNarrow
    ? t('partner.artifact.tooNarrow')
    : showArtifact
      ? t('partner.artifact.hide')
      : t('partner.artifact.show');
  const ArtifactToggleIcon = showArtifact ? PanelRightClose : PanelRightOpen;

  return (
    <div
      ref={workspaceRef}
      className="center-pane flex-1 flex flex-col min-h-0 min-w-0 relative bg-surface rounded-xl border border-border-default overflow-hidden lift"
      data-testid="partner-workspace"
    >
      <div className="flex items-center gap-2 px-4 h-10 border-b border-border-default flex-shrink-0">
        <button
          type="button"
          onClick={toggleSources}
          className={`ix-pop w-7 h-7 -ml-1 rounded-md flex items-center justify-center flex-shrink-0 hover:bg-hover-bg ${
            showSources ? 'text-fg-primary' : 'text-fg-muted hover:text-fg-primary'
          }`}
          title={sourcesLabel}
          aria-label={sourcesLabel}
          aria-pressed={showSources}
          data-testid="partner-sources-toggle"
        >
          <PanelLeft className="w-4 h-4" strokeWidth={1.75} aria-hidden />
        </button>
        <Handshake className="w-4 h-4 text-accent-ink" strokeWidth={1.75} aria-hidden />
        <span className="text-[13px] text-fg-primary font-medium flex-shrink-0">Partner</span>
        <span className="text-[11px] text-fg-muted min-w-0 truncate">{t('partner.subtitle')}</span>
        <button
          type="button"
          onClick={toggleArtifact}
          className={`ix-pop ml-auto w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 hover:bg-hover-bg ${
            showArtifact ? 'text-fg-primary' : 'text-fg-muted hover:text-fg-primary'
          }`}
          title={artifactLabel}
          aria-label={artifactLabel}
          aria-pressed={showArtifact}
          disabled={artifactTooNarrow}
          data-testid="partner-artifact-toggle"
        >
          <ArtifactToggleIcon className="w-4 h-4" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <div className="flex flex-1 min-h-0">
        {showSources && <SourcesPanel />}
        <PartnerConversation />
        {showArtifact ? (
          <ArtifactPanel onClose={toggleArtifact} />
        ) : (
          <button
            type="button"
            onClick={toggleArtifact}
            disabled={artifactTooNarrow}
            className="w-9 flex-shrink-0 border-l border-border-default bg-surface text-fg-muted hover:bg-hover-bg hover:text-fg-primary disabled:pointer-events-none disabled:opacity-35 flex items-start justify-center pt-3"
            title={artifactLabel}
            aria-label={artifactLabel}
            data-testid="partner-artifact-edge-toggle"
          >
            <PanelRightOpen className="w-4 h-4" strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
