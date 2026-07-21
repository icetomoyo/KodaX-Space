// OC-21 Built-in tool input renderers.
//
// 这里 register 三个内置 — write / edit / multi_edit — 用 ToolDiffView 渲染 Monaco diff。
// 旧 bubbles.tsx 的 ToolEditInputView if-chain 抽出来；新 tool 想自定义渲染走
// `registerToolInputRenderer('toolName', renderer)` 即可，不再改 bubbles。
//
// 模块 import 即注册（side effect）— 让 SessionMessages mount 时就生效。
//
// 契约：renderer 是 pure function，返 null = "shape 不对/没法渲染"，调用方回退
// RawJsonInput。需要 hooks 的 renderer (multi_edit) 让返回的 JSX 内嵌使用 hooks
// 的子组件 (MultiEditList)。

import { useState } from 'react';
import { FileOutput, Maximize2 } from 'lucide-react';
import { FileNameText } from '../../../components/FileNameText.js';
import { ToolDiffView } from './ToolDiffView.js';
import { registerToolInputRenderer, registerToolResultRenderer } from './toolRegistry.js';
import { useAppStore } from '../../../store/appStore.js';
import { openFileSmart, openPartnerDeliveryById } from '../../../lib/openPath.js';
import { parsePartnerDeliveryToolResults } from '../../../lib/generatedResourceRef.js';
import {
  parseBashOutputCompression,
  stripBashOutputRecoveryHint,
} from './bashOutputCompression.js';
import { useI18n } from '../../../i18n/I18nProvider.js';

/** 工具：从 input record 里抽 string 字段（其它类型当成不存在）。 */
function pickString(o: Record<string, unknown> | undefined, key: string): string | null {
  if (!o) return null;
  const v = o[key];
  return typeof v === 'string' ? v : null;
}

// ---- bash result (KodaX 0.7.61 compressed output) ----

function BashCompressedResult({
  result,
  rawOutputPath,
  filters,
}: {
  readonly result: string;
  readonly rawOutputPath?: string;
  readonly filters: readonly string[];
}): JSX.Element {
  const { t } = useI18n();
  const visibleResult = stripBashOutputRecoveryHint(result);
  const label = filters.length > 0 ? filters.join(', ') : t('tool.compressed');
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-fg-muted uppercase">
          {t('tool.result')}{' '}
          <span className="normal-case text-info/80">{t('tool.compressed')}</span>
          <span className="normal-case text-fg-muted"> / {label}</span>
        </div>
        {rawOutputPath && (
          <button
            type="button"
            onClick={() => void openFileSmart(rawOutputPath)}
            title={rawOutputPath}
            className="inline-flex items-center gap-1 text-[11px] text-info/80 hover:text-info min-w-0"
          >
            <FileOutput className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="truncate">{t('tool.rawOutput')}</span>
          </button>
        )}
      </div>
      <pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto text-ok">
        {visibleResult}
      </pre>
    </section>
  );
}

registerToolResultRenderer('bash', ({ result }) => {
  const compression = parseBashOutputCompression(result);
  if (!compression) return null;
  return (
    <BashCompressedResult
      result={result}
      rawOutputPath={compression.rawOutputPath}
      filters={compression.filters}
    />
  );
});

// ---- write ----

registerToolInputRenderer('write', ({ input }) => {
  const path = pickString(input, 'file_path') ?? pickString(input, 'path') ?? '';
  const content = pickString(input, 'content');
  if (content === null) return null; // shape 不对 → fallback
  return (
    <section className="space-y-1">
      <div className="text-[11px] text-fg-muted uppercase">write</div>
      <ToolDiffView path={path} before="" after={content} defaultExpanded={false} />
    </section>
  );
});

// ---- edit ----

registerToolInputRenderer('edit', ({ input }) => {
  const path = pickString(input, 'file_path') ?? pickString(input, 'path') ?? '';
  const oldS = pickString(input, 'old_string');
  const newS = pickString(input, 'new_string');
  if (oldS === null || newS === null) return null;
  return (
    <section className="space-y-1">
      <div className="text-[11px] text-fg-muted uppercase">edit</div>
      <ToolDiffView path={path} before={oldS} after={newS} defaultExpanded={false} />
    </section>
  );
});

// ---- multi_edit ----
//
// 需要 useState 控 showAllEdits，把状态放在 sub-component 而不是 renderer 本体，
// 让 renderer 仍是 pure function。

interface MultiEditListProps {
  readonly path: string;
  readonly edits: readonly unknown[];
}

function MultiEditList({ path, edits }: MultiEditListProps): JSX.Element {
  const { t } = useI18n();
  // cap 同屏 Monaco 实例 — 全展开 = N × DiffEditor × ~3MB JS + N × worker
  const MAX_VISIBLE = 5;
  const [showAllEdits, setShowAllEdits] = useState(false);
  const visible = showAllEdits ? edits : edits.slice(0, MAX_VISIBLE);
  const overflow = edits.length - MAX_VISIBLE;
  return (
    <section className="space-y-1.5">
      <div className="text-[11px] text-fg-muted uppercase">
        {t('tool.multiEditCount', { count: edits.length })}
      </div>
      {visible.map((e, i) => {
        const item = e as Record<string, unknown> | undefined;
        const oldS = pickString(item, 'old_string');
        const newS = pickString(item, 'new_string');
        if (oldS === null || newS === null) {
          return (
            <div
              key={i}
              className="text-[11px] text-fg-muted italic px-2 py-1 border border-dashed border-border-strong/40 rounded"
            >
              {t('tool.editMissingFields', { index: i + 1 })}
            </div>
          );
        }
        return (
          <ToolDiffView key={i} path={path} before={oldS} after={newS} defaultExpanded={false} />
        );
      })}
      {!showAllEdits && overflow > 0 && (
        <button
          type="button"
          onClick={() => setShowAllEdits(true)}
          className="text-[11px] text-info/80 hover:text-info px-2 py-0.5"
        >
          {t('tool.moreEdits', { count: overflow })}
        </button>
      )}
    </section>
  );
}

registerToolInputRenderer('multi_edit', ({ input }) => {
  const edits = input?.edits;
  if (!Array.isArray(edits) || edits.length === 0) return null;
  const path = pickString(input, 'file_path') ?? pickString(input, 'path') ?? '';
  return <MultiEditList path={path} edits={edits} />;
});

// ---- create_artifact (F059c) ----
//
// 产物默认埋在折叠的 tool_call 卡里、对话里看不到入口（用户反馈 2026-06-15）。这里:
//   - input 渲染成一行紧凑描述，避免把整段 HTML/代码 content dump 进对话流
//   - result 渲染成可点的 artifact 卡片：点卡片 → 右侧栏聚焦该 artifact；⛶ → 独立窗口
// 配合 bubbles 把 create_artifact 设为默认展开，产物在对话里就直接可见可点。

/** Clickable artifact card shown as a create_artifact tool result. */
function ArtifactToolCard({
  id,
  version,
  title,
  kind,
}: {
  id: string;
  version: number | undefined;
  title: string;
  kind: string;
}): JSX.Element {
  const { t } = useI18n();
  const projectRoot = useAppStore((s) => {
    const cur = s.currentSessionId;
    return cur ? (s.sessions.find((x) => x.sessionId === cur)?.projectRoot ?? null) : null;
  });

  function focusInPanel(): void {
    // 右侧栏切到 Artifact tab + 选中该 id（RightSidebar / ArtifactsView 监听此事件）。
    window.dispatchEvent(new CustomEvent('kodax-space.focus-artifact', { detail: { id } }));
  }
  function openWindow(e: React.MouseEvent): void {
    e.stopPropagation();
    // fire-and-forget；显式吞掉 rejection 避免 unhandledrejection（窗口开不出来无关键损失）。
    window.kodaxSpace
      ?.invoke('artifact.openWindow', {
        id,
        ...(version !== undefined ? { version } : {}),
        ...(projectRoot ? { projectRoot } : {}),
        title,
      })
      .catch(() => {});
  }

  return (
    <div className="flex items-center gap-2 rounded border border-border-default bg-surface-2/40 px-2.5 py-2">
      <FileOutput
        className="w-4 h-4 text-accent-ink flex-shrink-0"
        strokeWidth={1.75}
        aria-hidden
      />
      <button
        type="button"
        onClick={focusInPanel}
        className="flex-1 min-w-0 text-left"
        title={t('tool.viewArtifactPanel')}
      >
        <div className="text-[12px] font-medium text-fg-primary truncate font-sans">{title}</div>
        <div className="text-[10px] text-fg-muted uppercase tracking-wide">
          {kind}
          {version !== undefined ? ` · v${version}` : ''}
        </div>
      </button>
      <button
        type="button"
        onClick={openWindow}
        title={t('tool.openStandaloneArtifact')}
        aria-label={t('artifact.openStandalone')}
        className="w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3 flex-shrink-0"
      >
        <Maximize2 className="w-3.5 h-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

// input：一行紧凑描述（kind · 「title」· summary），不 dump content。
registerToolInputRenderer('create_artifact', ({ input }) => {
  const title = pickString(input, 'title');
  const kind = pickString(input, 'kind');
  if (!title && !kind) return null;
  const summary = pickString(input, 'summary');
  return (
    <div className="text-[11px] text-fg-muted">
      {kind && <span className="uppercase tracking-wide">{kind}</span>}
      {title && <span className="text-fg-secondary"> · 「{title}」</span>}
      {summary && <span> · {summary}</span>}
    </div>
  );
});

// result：从结果文本解析 id/version（"…(id=<id>, v<n>)"），渲染可点卡片；解析不到（如 Error）→ 回退原文。
registerToolResultRenderer('create_artifact', ({ result, input }) => {
  const m = /\(id=([^,]+), v(\d+)\)/.exec(result);
  if (!m) return null;
  const id = m[1].trim();
  const version = Number(m[2]);
  const title = pickString(input, 'title') ?? 'Artifact';
  const kind = pickString(input, 'kind') ?? '';
  return (
    <ArtifactToolCard
      id={id}
      version={Number.isFinite(version) ? version : undefined}
      title={title}
      kind={kind}
    />
  );
});

// ---- write_partner_deliverable ----

function PartnerDeliveryToolCard({
  id,
  title,
  relativePath,
}: {
  readonly id: string;
  readonly title: string;
  readonly relativePath: string | null;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => void openPartnerDeliveryById(id)}
      title={t('tool.viewPartnerOutput')}
      className="flex w-full items-center gap-2 rounded border border-border-default bg-surface-2/40 px-2.5 py-2 text-left hover:bg-hover-bg"
      data-testid="partner-delivery-tool-card"
    >
      <FileOutput
        className="h-4 w-4 flex-shrink-0 text-accent-ink"
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-sans text-[12px] font-medium text-fg-primary">
          {title}
        </span>
        {relativePath ? (
          <FileNameText name={relativePath} className="text-[10px] text-fg-muted" />
        ) : (
          <span className="block truncate text-[10px] text-fg-muted">{id}</span>
        )}
      </span>
      <span className="flex-shrink-0 text-[10px] uppercase tracking-wide text-fg-muted">
        {t('tool.partnerOutput')}
      </span>
    </button>
  );
}

function renderPartnerDeliveryToolResult(result: string): JSX.Element | null {
  const references = parsePartnerDeliveryToolResults(result);
  if (references.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {references.map((reference) => (
        <PartnerDeliveryToolCard
          key={reference.id}
          id={reference.id}
          title={reference.title}
          relativePath={reference.relativePath}
        />
      ))}
    </div>
  );
}

registerToolResultRenderer('write_partner_deliverable', ({ result }) =>
  renderPartnerDeliveryToolResult(result),
);
registerToolResultRenderer('write_partner_workspace_file', ({ result }) =>
  renderPartnerDeliveryToolResult(result),
);
registerToolResultRenderer('run_partner_helper', ({ result }) =>
  renderPartnerDeliveryToolResult(result),
);
