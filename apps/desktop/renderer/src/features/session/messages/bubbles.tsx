// Bubble + ToolCallCard + SystemNotice 组件集合。
// 单文件聚合：每个组件 < 80 行，共享 ConversationMessage 类型，拆分反而提高复杂度。

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  GitFork,
  ImageOff,
  Maximize2,
  Undo2,
} from 'lucide-react';
import { isSessionAttachmentPreviewUrl } from '@kodax-space/space-ipc-schema';
import type { ConversationMessage } from '../composeMessages.js';
import { useAppStore, type UserImageAttachment } from '../../../store/appStore.js';
import { Markdown } from './Markdown.js';
import { Caret } from '../../../components/Caret.js';
import { Collapse } from '../../../components/Collapse.js';
import { ScrollCapBox } from '../../../components/ScrollCapBox.js';
import { FileNameText } from '../../../components/FileNameText.js';
import { EASE_EXPO, usePrefersReducedMotion } from '../../../lib/motion.js';
import { openFileSmart, looksLikeFilePath } from '../../../lib/openPath.js';
import { parseFileReferences, type ParsedFileReference } from '../../../lib/fileReferences.js';
import { useI18n } from '../../../i18n/I18nProvider.js';
import type { MessageKey } from '../../../i18n/messages.js';
import { dispatchOpenFileViewer } from '../../artifact/transientArtifact.js';
// OC-21: side-effect import 让内置 tool renderers (write/edit/multi_edit) 注册到 registry
import './toolRenderers.js';
import { getToolInputRenderer, getToolResultRenderer } from './toolRegistry.js';

// ---- P4c: tool result 收窄渲染 ----

const DIFF_MIDDLE_COLLAPSE_LINES = 16;
const DIFF_HEAD_TAIL_LINES = 8;
const NORMAL_MIDDLE_COLLAPSE_LINES = 32;
const NORMAL_HEAD_TAIL_LINES = 5;
/** 超过此行数：极端守门 — 只显示头 5 行 + N 行折叠，不做对称的尾巴避免拉爆视窗。*/
const EXTREME_LINE_THRESHOLD = 200;
const EXTREME_HEAD_LINES = 5;

/**
 * 粗略估算 token 数——renderer 拿不到真 tokenizer，给个跟人类直觉对得上的近似：
 *   - ASCII (英文 / 数字 / 标点)：每 4 chars ≈ 1 token（GPT/Claude BPE 经验值）
 *   - 其他 (中文/日文/韩文/emoji 等)：每字符 ≈ 1 token（CJK 字符通常单独成 token）
 * 误差通常在 ±20%，对 Thinking 段长度感知足够。
 */
function approxTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else nonAscii++;
  }
  return Math.max(1, Math.round(ascii / 4 + nonAscii));
}

function formatCompactCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value < 1000) return String(value);
  const precision = value < 10000 ? 1 : 0;
  return `${(value / 1000).toFixed(precision).replace(/\.0$/, '')}k`;
}

function isDiffLike(text: string): boolean {
  // 启发式：unified diff 必含 "@@ " hunk 头，或 >40% 行以 +/- 起头（排除 ---/+++ 头部
  // 与 "- " 这种 markdown bullet / "  - " yaml 列表项 → 通常列表也是 dash-space，但
  // 真实 diff 的 -/+ 后多直接跟代码字符，少见空格）。0.4 比 0.3 抗"shell log 列表型输出"的
  // false-positive 更稳。
  if (text.includes('\n@@ ') || text.startsWith('@@ ')) return true;
  const lines = text.split('\n');
  if (lines.length < 4) return false;
  let diffLines = 0;
  for (const l of lines) {
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    // "+ " / "- " 前缀通常是 markdown / shell log，不视为 diff
    if (l.startsWith('+ ') || l.startsWith('- ')) continue;
    if (l.startsWith('+') || l.startsWith('-')) diffLines++;
  }
  return diffLines / lines.length > 0.4;
}

interface CollapseResult {
  body: string;
  collapsed: boolean;
  /** 极端守门触发；renderer 可考虑禁用 "show full" 钮 */
  extreme: boolean;
  totalLines: number;
}

function collapseLargeText(text: string, t: Translate): CollapseResult {
  const lines = text.split('\n');
  const total = lines.length;
  const isDiff = isDiffLike(text);
  const threshold = isDiff ? DIFF_MIDDLE_COLLAPSE_LINES : NORMAL_MIDDLE_COLLAPSE_LINES;
  if (total <= threshold) {
    return { body: text, collapsed: false, extreme: false, totalLines: total };
  }
  if (total > EXTREME_LINE_THRESHOLD) {
    const head = lines.slice(0, EXTREME_HEAD_LINES).join('\n');
    const omitted = total - EXTREME_HEAD_LINES;
    return {
      body: `${head}\n${t('message.moreLinesExtremelyLarge', { count: omitted })}`,
      collapsed: true,
      extreme: true,
      totalLines: total,
    };
  }
  const headN = isDiff ? DIFF_HEAD_TAIL_LINES : NORMAL_HEAD_TAIL_LINES;
  const tailN = headN;
  const head = lines.slice(0, headN).join('\n');
  const tail = lines.slice(-tailN).join('\n');
  const omitted = total - headN - tailN;
  return {
    body: `${head}\n…(${omitted} lines collapsed)…\n${tail}`,
    collapsed: true,
    extreme: false,
    totalLines: total,
  };
}

// ---- Message footer (copy + relative time) ----
//
// 替代之前的 "✓ complete" 横条——视觉更轻，对每个 user/assistant message 都挂一个
// 尾巴：[复制 icon] + "Xd ago"。hover bubble 时显示，非 hover 时 dim 或隐藏避免视觉
// 噪音。Claude Desktop 同款风格。
interface TurnFooterActions {
  readonly onFork?: () => void;
  readonly onRewind?: () => void;
  readonly rewindDisabled?: boolean;
}

function MessageFooter({
  text,
  sentAt,
  turnActions,
}: {
  text: string;
  sentAt?: number;
  turnActions?: TurnFooterActions;
}): JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  async function copyToClipboard(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 极少数情况 clipboard API 不可用——静默失败，不打扰用户
    }
  }

  const timeStr = sentAt !== undefined ? formatRelativeTime(sentAt, t) : null;

  // 时间 + action 图标都常驻显示 (dim)。hover 到 footer 或单个 action 时展开文字；
  // 标签保持单行和稳定行高，避免中文在 max-width 动画中换行引发 hover 抖动。
  const actionButtonClass =
    'group/action inline-flex h-4 min-w-0 items-center gap-1 whitespace-nowrap leading-none text-fg-muted hover:text-fg-primary transition-colors';
  const actionLabelClass =
    'inline-block max-w-0 overflow-hidden whitespace-nowrap leading-none opacity-0 transition-[max-width,opacity] duration-150 group-hover/footer:max-w-[7.5rem] group-hover/footer:opacity-100 group-hover/action:max-w-[7.5rem] group-hover/action:opacity-100 group-focus-visible/action:max-w-[7.5rem] group-focus-visible/action:opacity-100';

  return (
    <div className="group/footer mt-1 flex min-h-4 items-center gap-2 text-[11px] leading-none">
      <button
        type="button"
        onClick={() => void copyToClipboard()}
        className={actionButtonClass}
        title={t('message.copyMessage')}
        aria-label={t('message.copyMessage')}
      >
        {copied ? (
          <span className="copy-pulse text-ok inline-flex items-center gap-1 whitespace-nowrap leading-none">
            <Check className="w-3 h-3" strokeWidth={2.5} aria-hidden /> {t('message.copied')}
          </span>
        ) : (
          <>
            {/* Lucide icon keeps copy visible across fonts and follows currentColor. */}
            <Copy className="w-3 h-3" strokeWidth={2} aria-hidden />
            <span className={actionLabelClass}>{t('message.copy')}</span>
          </>
        )}
      </button>
      {turnActions && (
        <>
          <button
            type="button"
            onClick={turnActions.onFork}
            className={actionButtonClass}
            title={t('message.forkFromHere')}
            aria-label={t('message.forkFromHere')}
          >
            <GitFork className="w-3 h-3" strokeWidth={2} aria-hidden />
            <span className={actionLabelClass}>{t('message.forkFromHere')}</span>
          </button>
          <button
            type="button"
            onClick={turnActions.rewindDisabled ? undefined : turnActions.onRewind}
            disabled={turnActions.rewindDisabled}
            className={`${actionButtonClass} disabled:opacity-35 disabled:hover:text-fg-muted disabled:cursor-not-allowed`}
            title={
              turnActions.rewindDisabled ? t('message.alreadyAtTurn') : t('message.rewindToHere')
            }
            aria-label={
              turnActions.rewindDisabled ? t('message.alreadyAtTurn') : t('message.rewindToHere')
            }
          >
            <Undo2 className="w-3 h-3" strokeWidth={2} aria-hidden />
            <span className={actionLabelClass}>
              {turnActions.rewindDisabled ? t('message.alreadyAtTurn') : t('message.rewindToHere')}
            </span>
          </button>
        </>
      )}
      {timeStr && (
        <span className="text-fg-muted leading-none" title={new Date(sentAt!).toLocaleString()}>
          {timeStr}
        </span>
      )}
    </div>
  );
}

/**
 * 相对时间格式：~now / 5m ago / 2h ago / 3d ago / 2w ago / 4mo ago / 1y ago
 * 跟 Claude Desktop 同款"短英文"风格，避免本地化里中英混杂。
 */
type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function formatRelativeTime(ts: number, t: Translate): string {
  const diff = Date.now() - ts;
  if (diff < 0) return t('message.justNow');
  const s = Math.floor(diff / 1000);
  if (s < 30) return t('message.justNow');
  if (s < 60) return t('message.secondsAgo', { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('message.minutesAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('message.hoursAgo', { count: h });
  const d = Math.floor(h / 24);
  if (d < 7) return t('message.daysAgo', { count: d });
  const w = Math.floor(d / 7);
  if (w < 5) return t('message.weeksAgo', { count: w });
  const mo = Math.floor(d / 30);
  if (mo < 12) return t('message.monthsAgo', { count: mo });
  const y = Math.floor(d / 365);
  return t('message.yearsAgo', { count: y });
}

function FileReferenceLink({ file }: { file: ParsedFileReference }): JSX.Element {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => void openFileSmart(file.path)}
      className={[
        'mx-0.5 my-0.5 inline-flex max-w-full items-center gap-1.5 align-middle',
        'rounded-md border border-info/35 bg-info/10 px-2 py-1 text-left text-info',
        'hover:bg-info/15 hover:border-info/55 transition-colors',
      ].join(' ')}
      title={file.path}
      aria-label={t('message.openFile', { label: file.label })}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-info/75" strokeWidth={1.8} aria-hidden />
      <span className="min-w-0 max-w-[360px]">
        <FileNameText name={file.label} className="text-[12px] font-medium leading-4" />
        <span className="block truncate text-[10px] leading-3 text-info/70">{file.detail}</span>
      </span>
    </button>
  );
}

function UserMessageContent({ content }: { content: string }): JSX.Element {
  const platform =
    typeof window === 'undefined' ? 'win32' : (window.kodaxSpace?.platform ?? 'win32');
  const parts = useMemo(() => parseFileReferences(content, platform), [content, platform]);
  const hasFileReference = parts.some((part) => part.kind === 'file');

  if (!hasFileReference) return <>{content}</>;

  return (
    <>
      {parts.map((part, idx) =>
        part.kind === 'file' ? (
          <FileReferenceLink key={`${part.href}:${idx}`} file={part} />
        ) : part.text.length > 0 ? (
          <span key={`text:${idx}`}>{part.text}</span>
        ) : null,
      )}
    </>
  );
}

// ---- User Bubble ----

const USER_QUERY_PREVIEW_LINES = 4;

function CollapsibleUserMessageContent({ content }: { content: string }): JSX.Element {
  const { t } = useI18n();
  const contentId = useId();
  const measuredContentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [layout, setLayout] = useState({
    fullHeight: 0,
    previewHeight: 0,
    collapsible: false,
  });

  useLayoutEffect(() => {
    const element = measuredContentRef.current;
    if (!element) return;

    const measure = (): void => {
      const style = getComputedStyle(element);
      const parsedLineHeight = Number.parseFloat(style.lineHeight);
      const parsedFontSize = Number.parseFloat(style.fontSize);
      const lineHeight = Number.isFinite(parsedLineHeight)
        ? parsedLineHeight
        : (Number.isFinite(parsedFontSize) ? parsedFontSize : 13) * 1.6;
      const previewHeight = Math.ceil(lineHeight * USER_QUERY_PREVIEW_LINES);
      const fullHeight = Math.ceil(element.scrollHeight);
      const collapsible = fullHeight > previewHeight + 1;

      setLayout((current) =>
        current.fullHeight === fullHeight &&
        current.previewHeight === previewHeight &&
        current.collapsible === collapsible
          ? current
          : { fullHeight, previewHeight, collapsible },
      );
      if (!collapsible) setExpanded(false);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [content]);

  const maxHeight = layout.collapsible
    ? expanded
      ? layout.fullHeight
      : layout.previewHeight
    : undefined;
  const toggleLabel = t(expanded ? 'message.collapseQuery' : 'message.expandQuery');
  const toggle = layout.collapsible ? (
    <button
      type="button"
      data-testid="user-query-toggle"
      onClick={() => setExpanded((current) => !current)}
      aria-controls={contentId}
      aria-expanded={expanded}
      aria-label={toggleLabel}
      className="ml-auto my-1 inline-flex h-5 items-center gap-0.5 rounded-md px-1.5 text-[11px] font-medium text-info/75 transition-colors hover:bg-info/10 hover:text-info focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-info/55"
    >
      {toggleLabel}
      {expanded ? (
        <ChevronUp className="h-3 w-3" strokeWidth={1.8} aria-hidden />
      ) : (
        <ChevronDown className="h-3 w-3" strokeWidth={1.8} aria-hidden />
      )}
    </button>
  ) : null;

  return (
    <>
      {expanded && toggle}
      <div
        id={contentId}
        data-testid="user-query-content"
        data-preview-lines={USER_QUERY_PREVIEW_LINES}
        className="min-w-0 overflow-hidden transition-[max-height] duration-200 ease-out motion-reduce:transition-none"
        style={maxHeight === undefined ? undefined : { maxHeight: `${maxHeight}px` }}
      >
        <div ref={measuredContentRef} className="min-w-0 leading-[1.6]">
          <UserMessageContent content={content} />
        </div>
      </div>
      {!expanded && toggle}
    </>
  );
}

function isSafeUserImageUrl(url: string): boolean {
  return /^data:image\/(?:png|jpeg|webp);base64,/i.test(url) || isSessionAttachmentPreviewUrl(url);
}

function UserImageAttachments({
  attachments,
}: {
  attachments: readonly UserImageAttachment[];
}): JSX.Element {
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const currentProjectPath = useAppStore((state) => state.currentProjectPath);

  return (
    <div
      className="flex max-w-full flex-wrap gap-2"
      data-testid="user-image-attachments"
      aria-label="Image attachments"
    >
      {attachments.map((attachment, index) => {
        const label = attachment.label ?? `Image ${index + 1}`;
        const available =
          attachment.status === 'available' &&
          isSafeUserImageUrl(attachment.thumbnailUrl) &&
          isSafeUserImageUrl(attachment.previewUrl) &&
          !failedIds.has(attachment.id);

        if (!available) {
          return (
            <div
              key={attachment.id}
              className="flex h-24 w-32 items-center justify-center gap-1.5 rounded-lg border border-info/25 bg-surface-2/60 px-2 text-center text-[10px] text-fg-muted"
              data-testid="user-image-unavailable"
              title={`${label} unavailable`}
            >
              <ImageOff className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </div>
          );
        }

        return (
          <button
            key={attachment.id}
            type="button"
            className="group/image relative h-24 w-32 overflow-hidden rounded-lg border border-info/30 bg-surface-2/60 text-left outline-none transition-colors hover:border-info/70 focus-visible:ring-2 focus-visible:ring-info/60"
            data-testid="user-image-thumbnail"
            title={`Open ${label}`}
            aria-label={`Open ${label}`}
            onClick={() =>
              dispatchOpenFileViewer({
                id: `session-attachment:${attachment.id}`,
                kind: 'image',
                title: label,
                source: 'session-attachment-preview',
                content: attachment.previewUrl,
                ...(currentProjectPath ? { projectRoot: currentProjectPath } : {}),
                ...(currentSessionId ? { sessionId: currentSessionId } : {}),
              })
            }
          >
            <img
              src={attachment.thumbnailUrl}
              alt={label}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
              onError={() =>
                setFailedIds((current) => {
                  const next = new Set(current);
                  next.add(attachment.id);
                  return next;
                })
              }
            />
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/55 px-1.5 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover/image:opacity-100 group-focus-visible/image:opacity-100">
              <span className="truncate">{label}</span>
              <Maximize2 className="h-3 w-3 shrink-0" aria-hidden />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function UserBubble({
  content,
  attachments = [],
  sentAt,
}: {
  content: string;
  attachments?: readonly UserImageAttachment[];
  sentAt?: number;
}): JSX.Element {
  // Claude Desktop 风格 ——「对话即文档」单列布局：user pill **左对齐**与 assistant
  // 同列，浅蓝窄底色、收宽到 max-w-[80%]、width 跟内容走 (inline-block) 不撑满。
  // 这样比之前 80% 右对齐蓝 bubble 视觉更克制，整体读起来像一段文档流。
  const visibleContent = attachments.length > 0 && content.trim() === '(image)' ? '' : content;
  return (
    <div className="group flex flex-col items-start" data-testid="user-message-bubble">
      <div
        className={[
          'inline-block min-w-0 max-w-[min(80%,100%)] overflow-hidden rounded-2xl px-3 py-1.5 text-[13px] whitespace-pre-wrap break-words [overflow-wrap:anywhere] border',
          'bg-info/15 border-info/40 text-info',
        ].join(' ')}
      >
        {visibleContent.length > 0 && <CollapsibleUserMessageContent content={visibleContent} />}
        {attachments.length > 0 && (
          <div className={visibleContent.length > 0 ? 'mt-2' : undefined}>
            <UserImageAttachments attachments={attachments} />
          </div>
        )}
      </div>
      <MessageFooter text={visibleContent} sentAt={sentAt} />
    </div>
  );
}

export function LocalNoticeBubble({
  content,
  sentAt,
  variant,
}: Extract<ConversationMessage, { kind: 'local_notice' }>): JSX.Element {
  const { t } = useI18n();
  const label = t(
    variant === 'echo' ? 'session.localNoticeSlashLabel' : 'session.localNoticeOutputLabel',
  );
  return (
    <div className="group flex flex-col items-start" data-testid="local-notice-bubble">
      <div
        className={[
          'inline-block max-w-[88%] rounded-lg border px-3 py-2 text-[12px]',
          'bg-surface-3/70 border-border-default text-fg-secondary',
        ].join(' ')}
      >
        <div className="mb-1 text-[10px] font-mono uppercase tracking-[0.12em] text-warn">
          {label}
        </div>
        <pre className="font-mono leading-relaxed whitespace-pre-wrap break-words">{content}</pre>
      </div>
      <MessageFooter text={content} sentAt={sentAt} />
    </div>
  );
}

// ---- Assistant Bubble (markdown + 可选 thinking) ----

export function QueuedUserBubble({
  content,
  attachments = [],
  queueMode,
  status,
  sentAt,
}: Extract<ConversationMessage, { kind: 'queued_user' }>): JSX.Element {
  const { t } = useI18n();
  const failed = status === 'failed';
  const label = failed
    ? t('message.queue.failed')
    : queueMode === 'after-turn'
      ? t('message.queue.afterTurn')
      : t('message.queue.interrupt');
  const detail = failed
    ? t('message.queue.failedDetail')
    : status === 'pending-ack'
      ? t('message.queue.sending')
      : queueMode === 'after-turn'
        ? t('message.queue.waitingTurn')
        : t('message.queue.waitingSafePoint');
  const visibleContent = attachments.length > 0 && content.trim() === '(image)' ? '' : content;
  return (
    <div
      className="group flex flex-col items-start"
      data-testid="queued-user-message-bubble"
      data-status={status}
    >
      <div
        className={[
          'inline-block min-w-0 max-w-[min(80%,100%)] overflow-hidden rounded-2xl px-3 py-2 text-[13px] whitespace-pre-wrap break-words [overflow-wrap:anywhere] border border-dashed',
          failed
            ? 'bg-danger/10 border-danger/55 text-fg-secondary'
            : 'bg-warn/10 border-warn/45 text-fg-secondary',
        ].join(' ')}
      >
        <div
          className={[
            'mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-mono',
            failed ? 'text-danger' : 'text-warn',
          ].join(' ')}
        >
          <span className="uppercase tracking-[0.12em]">{label}</span>
          <span className="text-fg-muted normal-case">{detail}</span>
        </div>
        {visibleContent.length > 0 && (
          <div className="min-w-0">
            <UserMessageContent content={visibleContent} />
          </div>
        )}
        {attachments.length > 0 && (
          <div className={visibleContent.length > 0 ? 'mt-2' : undefined}>
            <UserImageAttachments attachments={attachments} />
          </div>
        )}
      </div>
      <MessageFooter text={visibleContent} sentAt={sentAt} />
    </div>
  );
}

export function AssistantBubble({
  text,
  thinking,
  sentAt,
  turnIndex,
  completed,
  canRewind,
  onForkTurn,
  onRewindTurn,
}: {
  text: string;
  thinking?: string;
  sentAt?: number;
  turnIndex?: number;
  completed?: boolean;
  canRewind?: boolean;
  onForkTurn?: (turnIndex: number) => void;
  onRewindTurn?: (turnIndex: number) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [showThinking, setShowThinking] = useState(false);
  const thinkingTokenLabel = useMemo(
    () =>
      thinking !== undefined
        ? t('message.thinkingSummary', { tokens: formatCompactCount(approxTokens(thinking)) })
        : null,
    [thinking, t],
  );
  const turnActions =
    completed === true && turnIndex !== undefined
      ? {
          ...(onForkTurn ? { onFork: () => onForkTurn(turnIndex) } : {}),
          ...(onRewindTurn ? { onRewind: () => onRewindTurn(turnIndex) } : {}),
          rewindDisabled: canRewind === false,
        }
      : undefined;
  // 「对话即文档」—— assistant 不包 bubble，直接 markdown 进入文档流。
  // thinking 改成一行折叠摘要 (▸ Thinking (~N tokens))，跟外层 ToolCluster header 视觉一致。
  return (
    <div className="group">
      {thinking !== undefined && (
        <button
          type="button"
          onClick={() => setShowThinking((v) => !v)}
          className={[
            'mb-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1',
            'border-border-default/70 bg-surface-2/45 font-mono text-[11px] text-fg-muted',
            'transition-colors hover:border-thinking/35 hover:bg-hover-bg hover:text-fg-primary',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong',
          ].join(' ')}
          aria-expanded={showThinking}
        >
          <Caret open={showThinking} />
          <span className="rounded border border-thinking/20 bg-thinking/10 px-1.5 py-0.5 text-thinking/90">
            {thinkingTokenLabel}
          </span>
        </button>
      )}
      {thinking !== undefined && (
        <Collapse open={showThinking} lazyMount>
          <ScrollCapBox
            onCollapse={() => setShowThinking(false)}
            followTail={completed === false}
            labels={{
              collapse: t('message.collapse'),
              expandAll: t('message.expandAll'),
              restoreCap: t('message.restoreCap'),
            }}
            className={[
              'mb-2 ml-3 pl-2 border-l text-xs whitespace-pre-wrap',
              'dark:border-thinking/60 dark:text-thinking/80',
              'border-thinking/50 text-thinking/90',
            ].join(' ')}
          >
            {thinking}
          </ScrollCapBox>
        </Collapse>
      )}
      <div className="text-sm leading-relaxed text-fg-primary">
        {text.length > 0 ? (
          <Markdown content={text} />
        ) : (
          <span className="dark:text-fg-faint text-fg-muted italic">…</span>
        )}
      </div>
      {text.length > 0 && <MessageFooter text={text} sentAt={sentAt} turnActions={turnActions} />}
    </div>
  );
}

// ---- Tool Call Card ----

// Card body 颜色按**状态**而非工具种类决定 —— 用户反馈：bash done 还显示浅红色
// 与 DONE 浅绿标签矛盾。红色全局语义=错误，不应当作 bash 的常态色。
// 状态主导后 done=emerald / running=amber，跟 DONE 徽章语义一致。
const TOOL_STATUS_COLOR: Record<'running' | 'done', string> = {
  running: 'border-warn/40 bg-warn/15',
  done: 'border-ok/40 bg-ok/15',
};

// 工具种类色相留在 tool name 文字上 —— 用户仍能一眼分清工具类型，但不再霸占 body。
// 注意：bash 不用 red (语义=错误)，改 rose 表达"powerful + 注意"。
const TOOL_NAME_COLOR: Record<string, string> = {
  read: 'text-info',
  write: 'text-warn',
  edit: 'text-warn',
  multi_edit: 'text-warn',
  bash: 'text-danger',
  grep: 'text-ok',
  glob: 'text-ok',
};

// v0.1.9 fix: 文件修改类工具默认展开 — 用户期望对话流里直接看到 diff 摘要 (path + ±N),
// 不用再点一次卡片才看到。其它工具 (bash / grep / read 等) 保持默认折叠避免噪音。
// ToolDiffView 自己还有第二层折叠 — Monaco 大块 viewer 仍点开才加载,不影响性能。
const FILE_MUTATION_TOOLS_DEFAULT_EXPANDED: ReadonlySet<string> = new Set([
  'write',
  'edit',
  'multi_edit',
  'str_replace',
  'insert_after_anchor',
  // F059c: 产物卡片要在对话里直接可见可点，默认展开（input 已紧凑、不 dump content）。
  'create_artifact',
  'write_partner_deliverable',
  'write_partner_workspace_file',
  'run_partner_helper',
]);

export function ToolCallCard({
  toolName,
  input,
  result,
  progress,
  status,
}: Extract<ConversationMessage, { kind: 'tool_call' }>): JSX.Element {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(() =>
    FILE_MUTATION_TOOLS_DEFAULT_EXPANDED.has(toolName),
  );
  const [showFullResult, setShowFullResult] = useState(false);
  // F068: 运行→完成瞬间触发 WAAPI 一次性高光闪（比 CSS class 更适合一次性效果，无需 cleanup）
  const prevStatusRef = useRef(status);
  const cardRef = useRef<HTMLDivElement>(null);
  // 门控：与 CSS 一致——极简档 (q-minimal) 或 prefers-reduced-motion 下跳过 WAAPI 动画（瞬切）。
  // WAAPI 绕过 CSS 门控，必须在 JS 侧显式判断，否则极简档/减弱动效用户仍会看到一次高光闪。
  const prefersReducedMotion = usePrefersReducedMotion();
  useEffect(() => {
    if (prevStatusRef.current === 'running' && status === 'done' && cardRef.current) {
      const isMinimal =
        typeof document !== 'undefined' && document.documentElement.classList.contains('q-minimal');
      if (!prefersReducedMotion && !isMinimal) {
        cardRef.current.animate(
          [
            { boxShadow: '0 0 0 0 rgb(var(--ok) / 0.5)' },
            { boxShadow: '0 0 0 8px rgb(var(--ok) / 0)' },
          ],
          { duration: 600, easing: EASE_EXPO },
        );
      }
    }
    prevStatusRef.current = status;
  }, [status, prefersReducedMotion]);
  // showFullInput / inputPretty / inputCollapse 状态已搬进 ToolEditInputView —
  // OC-21 之后 raw-JSON fallback 由那边统一处理
  const colorClass = TOOL_STATUS_COLOR[status] ?? 'border-border-strong bg-surface-2/50';
  const toolNameColor = TOOL_NAME_COLOR[toolName] ?? 'text-fg-secondary';
  const argSummary = summarizeInput(input);

  // P4c: result 走行级折叠（diff middle-collapse / 极端守门）
  const resultCollapse = useMemo<CollapseResult | null>(() => {
    if (result === undefined) return null;
    return collapseLargeText(result, t);
  }, [result, t]);

  return (
    <div
      ref={cardRef}
      data-testid="tool-call-card"
      className={`tool-card-anim rounded border ${colorClass} text-xs font-mono`}
    >
      {/* 2026-06-18: header 拆成「折叠 toggle」+「文件路径打开」两个**并列** button（不再把可点
          span 嵌进 button —— 嵌套 interactive 在部分浏览器键盘不可达）。input 含文件路径字段时
          右侧渲染裸路径可点击按钮（argSummary 带 "path: " 前缀+空格，不能直接判路径）；否则
          argSummary 文字并入 toggle 内。 */}
      {(() => {
        const pathArg = pathArgOf(input);
        return (
          <div className="w-full px-3 py-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className={`flex items-center gap-2 text-left rounded hover:bg-hover-bg ${
                pathArg ? 'flex-shrink-0' : 'min-w-0 flex-1'
              }`}
            >
              <Caret open={expanded} className="text-fg-muted" />
              <span className={`font-semibold ${toolNameColor}`}>{toolName}</span>
              {!pathArg && <span className="text-fg-muted truncate flex-1">{argSummary}</span>}
            </button>
            {pathArg && (
              <button
                type="button"
                onClick={() => void openFileSmart(pathArg)}
                title={t('markdown.openInlinePath', { path: pathArg })}
                className="min-w-0 flex-1 text-left text-info/80 hover:text-info underline decoration-info/40 underline-offset-2 cursor-pointer"
              >
                <FileNameText name={pathArg} />
              </button>
            )}
            <StatusBadge status={status} />
          </div>
        );
      })()}

      <Collapse open={expanded} lazyMount>
        <div
          data-testid="tool-call-card-details"
          className="border-t border-border-default px-3 py-2 space-y-2"
        >
          {/* OC-21 (v0.1.8): tool input 渲染走 toolRegistry 查表分发。任意 toolName 都进
              ToolEditInputView，registry 找不到 / 返 null 就回退到 raw-JSON collapse 视图。
              新 tool 加自己的 renderer 只需 registerToolInputRenderer，不再改本文件。 */}
          <ToolEditInputView toolName={toolName} input={input} />

          {progress !== undefined && (
            <section>
              <div className="text-[11px] text-fg-muted uppercase mb-0.5">
                {t('message.progress')}
              </div>
              <div className="text-xs text-info">{progress}</div>
            </section>
          )}
          {result !== undefined && (
            <ToolResultView
              toolName={toolName}
              result={result}
              input={input}
              resultCollapse={resultCollapse}
              showFullResult={showFullResult}
              setShowFullResult={setShowFullResult}
            />
          )}
        </div>
      </Collapse>
    </div>
  );
}

function StatusBadge({ status }: { status: 'running' | 'done' }): JSX.Element {
  const { t } = useI18n();
  if (status === 'running') {
    return (
      <span
        className={[
          'text-[11px] uppercase px-1.5 py-0.5 rounded border',
          // soft badge：token 主题感知，bg 用 /12 浅衬底 + 同色文字两主题都够对比
          'text-warn bg-warn/12 border-warn/30',
        ].join(' ')}
      >
        {t('message.status.running')}
      </span>
    );
  }
  return (
    <span
      className={[
        'text-[11px] uppercase px-1.5 py-0.5 rounded border',
        'text-ok bg-ok/12 border-ok/30',
      ].join(' ')}
    >
      {t('message.status.done')}
    </span>
  );
}

// 从 tool input 里取"可点击打开"的裸文件路径（write/edit 用 file_path，多数工具用 path/file）。
// 与 summarizeInput 分开：后者返回带 "key: " 前缀的展示串（含空格），不能直接判路径/传 openFileSmart。
function pathArgOf(input?: Record<string, unknown>): string | null {
  if (!input) return null;
  const key = ['file_path', 'path', 'file'].find((k) => k in input);
  if (!key) return null;
  const v = input[key];
  if (typeof v !== 'string') return null;
  return looksLikeFilePath(v) ? v : null;
}

function summarizeInput(input?: Record<string, unknown>): string {
  if (!input) return '';
  const entries = Object.entries(input);
  if (entries.length === 0) return '';
  // 优先显示常见关键字段
  const primary = ['path', 'file', 'pattern', 'command', 'query'].find((k) => k in input);
  if (primary) {
    const value = String(input[primary]).slice(0, 60);
    return `${primary}: ${value}${String(input[primary]).length > 60 ? '…' : ''}`;
  }
  // 否则取第一个字段
  const [k, v] = entries[0];
  return `${k}: ${String(v).slice(0, 60)}`;
}

// ---- System Notice (iteration_end / error) ----

// OC-11 SystemNotice action button：
//   - retry                  → focus textarea (用户按 Send 重发上次 prompt)
//   - open_provider_settings → 打开 Provider settings 模态
//
// change_model / check_network 当前没有干净的 renderer 入口，文案已经告诉用户该做什么，
// 不强行加按钮：错的按钮比没按钮更恼人。
const ACTION_BUTTONS: Partial<
  Record<
    NonNullable<Extract<ConversationMessage, { kind: 'system_notice' }>['action']>,
    { labelKey: MessageKey; event: string }
  >
> = {
  retry: { labelKey: 'message.action.retry', event: 'kodax-space.focus-textarea' },
  open_provider_settings: {
    labelKey: 'message.action.providerSettings',
    event: 'kodax-space.open-provider-settings',
  },
};

/**
 * OC-23 倒计时 hook：把绝对时间戳 retryAvailableAt 转成"剩余秒数"。0 表示已可重试。
 * 每秒 tick；retryAvailableAt 未设/已过期 → 返 0，组件不渲染倒计时态。
 */
function useRetryCountdown(retryAvailableAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (retryAvailableAt === undefined) return;
    const remaining = retryAvailableAt - Date.now();
    if (remaining <= 0) return;
    // 每秒 tick；倒计时归零时主动停 interval，避免 SystemNotice 长期 mount 时
    // 一直每秒空转 setState (review MEDIUM)
    const id = window.setInterval(() => {
      const tickNow = Date.now();
      setNow(tickNow);
      if (tickNow >= retryAvailableAt) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [retryAvailableAt]);
  if (retryAvailableAt === undefined) return 0;
  const remainingMs = retryAvailableAt - now;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

export function SystemNotice({
  variant,
  text,
  lineageKind,
  action,
  retryAvailableAt,
  sentAt,
  historical,
}: Extract<ConversationMessage, { kind: 'system_notice' }>): JSX.Element {
  const { t } = useI18n();
  const isWorkflow = variant === 'workflow';
  const color =
    variant === 'error'
      ? 'text-danger border-danger/40 bg-danger/5'
      : 'text-warn border-warn/40 bg-warn/5';

  const actionDef = action ? ACTION_BUTTONS[action] : undefined;
  const secondsLeft = useRetryCountdown(retryAvailableAt);
  const countdownActive = action === 'retry' && secondsLeft > 0;
  // #12 fix: composeMessages 是纯函数、拿不到 i18n context，只透传 content + historical 标记
  // 而不烤入英文标签；这里（有 useI18n）按 locale 拼出中性的"历史记录"前缀。Live 事件
  // （historical 缺省）的 text 已经在 composeMessages 里烤好完整文案，原样展示不变。
  const displayText =
    variant === 'lineage' && lineageKind === 'compaction'
      ? t('session.compactionHistoryLabel')
      : variant === 'lineage' && lineageKind === 'branch_summary'
        ? `${t('session.branchSummaryHistoryLabel')}: ${text}`
        : variant === 'sidecar' && historical === true
          ? `${t('session.sidecarHistoricalLabel')}: ${text}`
          : text;

  if (isWorkflow) {
    return (
      <div
        className={['notice-in text-[11px] font-mono border-y', color, 'px-3 py-2 text-left'].join(
          ' ',
        )}
        data-testid="system-notice"
        data-notice-variant={variant}
      >
        <div className="min-w-0 whitespace-pre-wrap break-words">{displayText}</div>
        <div className="font-sans">
          <MessageFooter text={displayText} sentAt={sentAt} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        'notice-in text-[11px] font-mono border-y',
        color,
        'py-1 text-center flex items-center justify-center gap-2 flex-wrap',
      ].join(' ')}
      data-testid="system-notice"
      data-notice-variant={variant}
    >
      <span>{displayText}</span>
      {actionDef && (
        <button
          type="button"
          disabled={countdownActive}
          onClick={() => window.dispatchEvent(new CustomEvent(actionDef.event))}
          className="px-1.5 py-0.5 rounded border border-current/30 hover:bg-current/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          title={
            countdownActive ? t('message.retryWaitTitle', { seconds: secondsLeft }) : undefined
          }
        >
          {countdownActive ? t('message.retryIn', { seconds: secondsLeft }) : t(actionDef.labelKey)}
        </button>
      )}
    </div>
  );
}

// ---- OC-21 (v0.1.8): tool input 视图 ----
//
// `ToolEditInputView` 是所有工具 input 渲染的统一入口（不再按 toolName 走 if-chain）。
// 实际渲染由 toolRegistry 查表分发：
//   - 内置 write / edit / multi_edit 在 toolRenderers.tsx 注册，渲染 Monaco diff
//   - 新工具想自定义渲染，调 registerToolInputRenderer，不再要改本文件
//   - 查不到 / renderer 返 null（shape 不对）→ 回退到 raw-JSON collapse 视图

interface ToolEditInputViewProps {
  toolName: string;
  input: Record<string, unknown> | undefined;
}

/**
 * OC-21 ToolRegistry 入口。
 * - 从 toolRegistry 查 toolName 对应的 renderer（pure function）
 * - 没注册 / renderer 返 null（shape 不对）→ 回退到 raw-JSON collapse 视图
 *   （承接旧 bubbles.tsx else-branch 的 Show full / Collapse UX）
 * - 内置 write / edit / multi_edit 在 toolRenderers.tsx 里 register
 *
 * 新 tool 想自定义渲染：在 toolRenderers.tsx 或自己模块里 `registerToolInputRenderer`，
 * 不再要改本文件。
 */
function ToolEditInputView({ toolName, input }: ToolEditInputViewProps): JSX.Element | null {
  const { t } = useI18n();
  // collapse 状态搬到这里 — 让 fallback 也享有 Show full / Collapse UX
  const [showFullInput, setShowFullInput] = useState(false);
  const inputPretty = useMemo<string | null>(() => {
    if (!input || Object.keys(input).length === 0) return null;
    return JSON.stringify(input, null, 2);
  }, [input]);
  const inputCollapse = useMemo<CollapseResult | null>(() => {
    if (inputPretty === null) return null;
    return collapseLargeText(inputPretty, t);
  }, [inputPretty, t]);

  const renderer = getToolInputRenderer(toolName);
  if (renderer !== null) {
    const rendered = renderer({ toolName, input });
    if (rendered !== null) return rendered;
    // renderer 返 null = shape 不对，fallback 到 raw-JSON collapse
  }

  // Fallback — raw JSON with collapse / Show full UX
  if (inputCollapse === null || inputPretty === null) return null;
  return (
    <section>
      <div className="text-[11px] text-fg-muted uppercase mb-0.5 flex justify-between items-center">
        <span>{t('message.input')}</span>
        {inputCollapse.collapsed && (
          <button
            type="button"
            onClick={() => setShowFullInput((v) => !v)}
            className="text-[11px] text-info/80 hover:text-info normal-case"
          >
            {showFullInput
              ? t('message.collapse')
              : t('message.showFull', { lines: inputCollapse.totalLines })}
          </button>
        )}
      </div>
      <pre className="text-xs text-fg-secondary whitespace-pre-wrap break-all max-h-96 overflow-auto">
        {showFullInput ? inputPretty : inputCollapse.body}
      </pre>
    </section>
  );
}

// ---- OC-21 v0.1.9 result-side dispatch ----
//
// 跟 ToolEditInputView 对称：toolName 查 result registry → 自定义渲染；
// 找不到或返 null → 回退到原 raw-text collapse 视图（绿色 pre + Show full/Collapse）。

interface ToolResultViewProps {
  readonly toolName: string;
  readonly result: string;
  readonly input: Record<string, unknown> | undefined;
  readonly resultCollapse: CollapseResult | null;
  readonly showFullResult: boolean;
  readonly setShowFullResult: (updater: (v: boolean) => boolean) => void;
}

function ToolResultView({
  toolName,
  result,
  input,
  resultCollapse,
  showFullResult,
  setShowFullResult,
}: ToolResultViewProps): JSX.Element | null {
  const { t } = useI18n();
  const renderer = getToolResultRenderer(toolName);
  if (renderer !== null) {
    const rendered = renderer({ toolName, result, input });
    if (rendered !== null) return rendered;
  }
  // Fallback — raw-text collapse 视图
  if (resultCollapse === null) return null;
  return (
    <section>
      <div className="text-[11px] text-fg-muted uppercase mb-0.5 flex justify-between items-center">
        <span>{t('message.result')}</span>
        {resultCollapse.collapsed && (
          <button
            type="button"
            onClick={() => setShowFullResult((v) => !v)}
            className="text-[11px] text-info/80 hover:text-info normal-case"
          >
            {showFullResult
              ? t('message.collapse')
              : t('message.showFull', { lines: resultCollapse.totalLines })}
          </button>
        )}
      </div>
      <pre
        className={['text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto', 'text-ok'].join(
          ' ',
        )}
      >
        {showFullResult ? result : resultCollapse.body}
      </pre>
    </section>
  );
}
