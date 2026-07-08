// PopoutOverlay — F011-revised
//
// 右上 toolbar 5 个 popout 的容器。当 active popout 切换时渲染对应面板。
//
// 形态：右侧 panel slide-in，覆盖主区右侧；半透明遮罩可关闭。
// 不全屏覆盖——保留主对话流可见，让用户能在 popout 操作时仍看到对话上下文。
//
// **v0.1.10 fix**: 按 kind 决定宽度。Viewer 类 (preview / terminal) 走宽容器
// (880px) 让 Preview render / Terminal 80 列都够看;
// List 类 (tasks / plan / agents / mcp) 保持 480px 紧凑列表风。
//
// **v0.1.11**: diff 升级为"完整覆盖层"——铺满整个对话区 (left-0)，side-by-side diff
// 不再挤在一半屏。用户反馈 880px 看代码 diff 还是太窄 (2026-06-08)。其它 popout 维持
// 右侧 slide-in 窄 panel。FULL_COVER_KINDS 控制谁走全宽。
// **F059c**: artifact 加入 full-cover —— HTML/图表/报告在 760px 窄条里被截、读不全
// (用户反馈 2026-06-15)。⤢ 后铺满整个中间对话区 (像 diff)；再"单独打开"走 L3 独立窗口。
const FULL_COVER_KINDS = new Set<string>(['files', 'diff', 'artifact', 'workflow']);
// 全覆盖 popout 里，diff / artifact 的内容区自带不透明表面（Monaco 编辑器 / 渲染出的产出），
// 玻璃半透明只剩标题栏薄边，从不透字；只有 workflow 是纯文字行直接铺在半透明 .glass 上，
// 没有不透明内容层 → 下层对话会透上来。故只给这类「内容透明」的全覆盖层补不透明度，
// 不动 diff / artifact 本来就没问题的观感。
const TRANSPARENT_CONTENT_KINDS = new Set<string>(['workflow']);
const POPOUT_WIDTH: Record<string, string> = {
  preview: 'w-[880px]',
  terminal: 'w-[800px]',
  memory: 'w-[760px]',
  workflow: 'w-[900px]',
};
const DEFAULT_POPOUT_WIDTH = 'w-[480px]';

import { Component, Suspense, lazy, type ErrorInfo, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import type { PopoutKind } from '../CommandToolbar.js';
import { PreviewPanel } from './PreviewPanel.js';
import { FilesPanel } from './FilesPanel.js';
import { DiffPanel } from './DiffPanel.js';
// F011 v0.1.6 + F023 v0.1.7: Terminal popout 改成真 PTY (xterm.js + node-pty)；
// F023 引入多 tab 通过 TerminalManager 包装层（每个 tab 自己的 PTY）。
// Lazy 加载：xterm + 2 个 addon + CSS 只在用户首次开 Terminal popout 时拉，
// 避免 startup bundle 体积膨胀 + 把任何 xterm 模块加载错误隔离到 popout 内（不白屏整 app）。
const TerminalPanel = lazy(() =>
  import('../../features/terminal/TerminalManager.js').then((m) => ({
    default: m.TerminalManager,
  })),
);
import { TasksPanel } from './TasksPanel.js';
import { PlanPanel } from './PlanPanel.js';
import { AgentsMdPanel } from './AgentsMdPanel.js';
import { McpPanel } from './McpPanel.js';
import { MemoryPanel } from './MemoryPanel.js';
import { ArtifactsView } from '../../features/artifact/ArtifactsView.js';
import { WorkflowManagementPanel } from '../../features/workflow/WorkflowManagementPanel.js';
import { FloatingSurfaceHost } from '../FloatingSurfaceHost.js';
import { floatingSurfaceForPopout } from '../floatingSurfacePolicy.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';

interface PopoutOverlayProps {
  kind: PopoutKind;
  onClose: () => void;
  boundsRef: RefObject<HTMLElement | null>;
}

interface PopoutPanelErrorBoundaryProps {
  readonly kind: PopoutKind;
  readonly onClose: () => void;
  readonly panelFailedText: string;
  readonly closeText: string;
  readonly children: ReactNode;
}

interface PopoutPanelErrorBoundaryState {
  readonly hasError: boolean;
  readonly message: string | null;
}

class PopoutPanelErrorBoundary extends Component<
  PopoutPanelErrorBoundaryProps,
  PopoutPanelErrorBoundaryState
> {
  override state: PopoutPanelErrorBoundaryState = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown): PopoutPanelErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[kodax-space] popout panel render failed', {
      kind: this.props.kind,
      error,
      componentStack: info.componentStack,
    });
  }

  override componentDidUpdate(prevProps: PopoutPanelErrorBoundaryProps): void {
    if (prevProps.kind !== this.props.kind && this.state.hasError) {
      this.setState({ hasError: false, message: null });
    }
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-sm font-medium text-fg-primary">{this.props.panelFailedText}</div>
        {this.state.message && (
          <div className="max-w-[420px] break-words text-xs leading-relaxed text-fg-muted">
            {this.state.message}
          </div>
        )}
        <button
          type="button"
          onClick={this.props.onClose}
          className="rounded-md border border-border-default px-3 py-1.5 text-xs text-fg-secondary hover:bg-surface-3 hover:text-fg-primary"
        >
          {this.props.closeText}
        </button>
      </div>
    );
  }
}

const POPOUT_TITLE_KEYS: Record<PopoutKind, MessageKey> = {
  files: 'popout.title.files',
  preview: 'popout.title.preview',
  diff: 'popout.title.review',
  terminal: 'popout.title.terminal',
  tasks: 'popout.title.agents',
  plan: 'popout.title.plan',
  agents: 'popout.title.agents',
  mcp: 'popout.title.mcp',
  memory: 'popout.title.memory',
  artifact: 'popout.title.artifact',
  workflow: 'popout.title.workflow',
};

export function PopoutOverlay({ kind, onClose, boundsRef }: PopoutOverlayProps): JSX.Element {
  const { t } = useI18n();
  const surface = floatingSurfaceForPopout(kind);
  const fullCover = FULL_COVER_KINDS.has(kind);
  const transparentContent = TRANSPARENT_CONTENT_KINDS.has(kind);
  const title = t(POPOUT_TITLE_KEYS[kind]);
  // full-cover：left-0 铺满整个对话区；窄 panel：固定宽度从右侧贴边 slide-in。
  const widthCls = fullCover
    ? 'left-0'
    : `${POPOUT_WIDTH[kind] ?? DEFAULT_POPOUT_WIDTH} max-w-[95vw]`;
  return (
    <FloatingSurfaceHost
      surface={surface}
      boundsRef={boundsRef}
      onClose={onClose}
      backdropTestId="popout-backdrop"
    >
      <aside
        data-testid={`popout-${kind}`}
        data-popout-kind={kind}
        data-surface-kind={surface.kind}
        data-surface-placement={surface.placement}
        // `!absolute`：`.glass`（styles.css，无 @layer 的裸规则）带 `position: relative`，
        // 在级联里永远压过 Tailwind `@layer utilities` 的 `.absolute` —— 不加 important 这个
        // 浮层会退回文档流、掉到 BottomBar(输入框) 下面（F060 起的回归）。important utility
        // 精准压住，且全仓仅此一处 glass+absolute 冲突，零波及其它 glass 面板。
        // 内容透明的全覆盖层（workflow）盖在对话流上面：加 `glass-cover` 拉高不透明度，避免下层
        // 对话文字透上来干扰阅读。diff / artifact 内容自带不透明表面、窄侧 panel 需透出上下文，均不加。
        className={`glass ix-zone pointer-events-auto ${transparentContent ? 'glass-cover' : ''} !absolute right-0 top-10 bottom-0 ${widthCls} border-l border-border-default flex flex-col`}
      >
        <div className="px-3 py-2 border-b border-border-default flex items-center text-xs text-fg-muted flex-shrink-0">
          <span>{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded hover:bg-surface-3 hover:text-fg-primary"
            aria-label={t('popout.closeAria')}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <PopoutPanelErrorBoundary
            kind={kind}
            onClose={onClose}
            panelFailedText={t('popout.panelFailed')}
            closeText={t('popout.close')}
          >
            {kind === 'files' && <FilesPanel />}
            {kind === 'preview' && <PreviewPanel />}
            {kind === 'diff' && <DiffPanel />}
            {kind === 'terminal' && (
              <Suspense
                fallback={
                  <div className="p-3 text-xs text-fg-muted">{t('popout.loadingTerminal')}</div>
                }
              >
                <TerminalPanel />
              </Suspense>
            )}
            {kind === 'tasks' && <TasksPanel />}
            {kind === 'plan' && <PlanPanel />}
            {kind === 'agents' && <AgentsMdPanel />}
            {kind === 'mcp' && <McpPanel />}
            {kind === 'memory' && <MemoryPanel />}
            {kind === 'artifact' && <ArtifactsView />}
            {kind === 'workflow' && (
              <div className="h-full min-h-0 overflow-hidden">
                <WorkflowManagementPanel />
              </div>
            )}
          </PopoutPanelErrorBoundary>
        </div>
      </aside>
    </FloatingSurfaceHost>
  );
}
