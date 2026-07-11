// BottomBar - F011-revised
// Composer footer: chips, textarea, attachments, mode controls, and send/stop.

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, Folder, Plus, X } from 'lucide-react';
import type {
  ChannelInput,
  ChannelOutput,
  InputArtifact,
  InputArtifactSource,
  InvokeChannelName,
  IpcResult,
  SessionMeta,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { useSurfaceStore } from '../store/surface.js';
import { ChipBar } from './ChipBar.js';
import { ModelEffortSelector } from './ModelEffortSelector.js';
import { ModeSelector } from './ModeSelector.js';
import { ContextWindowIndicator } from './ContextWindowIndicator.js';
import { QueueIndicator } from './QueueIndicator.js';
import { AttachMenu } from './AttachMenu.js';
import { AgentPicker } from './AgentPicker.js';
import { AtPathPopover } from './AtPathPopover.js';
import { SlashCommandPopover, type SlashPickerItem } from './SlashCommandPopover.js';
import {
  getActiveSlashCompletion,
  replaceActiveSlashCompletion,
  shouldOpenSlashCompletion,
} from './slashInput.js';
import { parseLegacySkillToken, safeSkillSlashText, skillSlashEchoText } from './skillSlash.js';
import { registerInsertReceiver } from './inputBridge.js';
import { resolveSessionCreateInputs } from './createSession.js';
import { inlineImageMediaType, isSupportedInlineImage } from './attachmentFiles.js';
import { useIsStreaming } from './ActivitySpinner.js';
import { AgentModeSelector } from './AgentModeSelector.js';
// Retired StashNotice; file changes now live in RightSidebar.ChangesSection.
import { RetryBanner } from './RetryBanner.js';
import { NotificationsSurface } from './NotificationsSurface.js';
import { pushToast } from '../store/toastStore.js';
import { sessionMatchesScope } from '../lib/sessionScope.js';
import { shouldActivateSessionForCurrentScope } from '../lib/sessionActivation.js';
import { compactPathForDisplay } from '../lib/fileReferences.js';
import { KodaXDogMascot } from '../components/KodaXDogMascot.js';
import { KodaXDogSpriteMascot } from '../components/KodaXDogSpriteMascot.js';
import { useI18n } from '../i18n/I18nProvider.js';
import type { MessageKey } from '../i18n/messages.js';
import {
  PARTNER_SOURCES_CHANGED_EVENT,
  PARTNER_WORKBENCH_CONTEXT_EVENT,
  buildPartnerWorkbenchPrompt,
  clearPartnerPendingSources,
  getPartnerWorkbenchScenario,
  readPartnerPendingSources,
  readPartnerWorkbenchContext,
  type PartnerWorkbenchContextDetail,
  type PartnerWorkbenchSourceRef,
} from '../features/partner/partnerWorkbench.js';

const SLASH_ARGS_MAX = 20;

const EMPTY_INPUT_HISTORY: readonly string[] = [];

type QueueMode = 'interrupt' | 'after-turn';
type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface ComposerInvokeOptions<T> {
  readonly timeoutMs?: number | null;
  readonly onLateResult?: (result: IpcResult<T>) => void;
}

const DEFAULT_COMPOSER_INVOKE_TIMEOUT_MS = 45_000;
const COMPOSER_INVOKE_TIMEOUT_MS: Partial<Record<InvokeChannelName, number>> = {
  'session.create': 45_000,
  'session.send': 30_000,
  'session.setTitle': 10_000,
  'slash.exec': 90_000,
  'skill.invoke': 60_000,
  'skill.discover': 45_000,
  'provider.test': 30_000,
  'mcp.reload': 45_000,
  'mcp.discover': 45_000,
};

function queuedToastText(queueMode: QueueMode | undefined, t: Translate): string {
  return queueMode === 'after-turn' ? t('bottom.queuedAfterTurn') : t('bottom.queuedNextSafePoint');
}

function composerInvokeFailure<T>(
  channel: InvokeChannelName,
  message: string,
  details?: unknown,
): IpcResult<T> {
  return {
    ok: false,
    error: {
      code: 'INTERNAL',
      message,
      details: details === undefined ? { channel } : { channel, cause: details },
    },
  };
}

function composerInvokeTimeoutFailure<T>(
  channel: InvokeChannelName,
  timeoutMs: number,
): IpcResult<T> {
  return composerInvokeFailure(channel, composerTimeoutMessage(channel, timeoutMs), {
    timedOut: true,
  });
}

function composerTimeoutMessage(channel: InvokeChannelName, timeoutMs: number): string {
  return `${channel} timed out after ${Math.round(timeoutMs / 1000)}s. The request may still finish in the background.`;
}

function composerInvokeTimeoutMs(channel: InvokeChannelName): number {
  return COMPOSER_INVOKE_TIMEOUT_MS[channel] ?? DEFAULT_COMPOSER_INVOKE_TIMEOUT_MS;
}

function isComposerTimeoutResult<T>(result: IpcResult<T>): boolean {
  if (result.ok) return false;
  const details = result.error.details;
  if (!details || typeof details !== 'object') return false;
  if (!('cause' in details)) return false;
  const cause = (details as { cause?: unknown }).cause;
  return (
    !!cause && typeof cause === 'object' && (cause as { timedOut?: unknown }).timedOut === true
  );
}

async function invokeComposerIpc<C extends InvokeChannelName>(
  channel: C,
  payload: ChannelInput<C>,
  optionsOrTimeoutMs: number | ComposerInvokeOptions<ChannelOutput<C>> = {},
): Promise<IpcResult<ChannelOutput<C>>> {
  const bridge = window.kodaxSpace;
  if (!bridge) {
    return composerInvokeFailure(channel, 'IPC unavailable');
  }

  const options =
    typeof optionsOrTimeoutMs === 'number' ? { timeoutMs: optionsOrTimeoutMs } : optionsOrTimeoutMs;
  const timeoutMs =
    options.timeoutMs === null ? null : (options.timeoutMs ?? composerInvokeTimeoutMs(channel));
  let timer: number | undefined;
  let timedOut = false;
  const timeoutResult =
    timeoutMs === null
      ? null
      : new Promise<IpcResult<ChannelOutput<C>>>((resolve) => {
          timer = window.setTimeout(() => {
            timedOut = true;
            resolve(composerInvokeTimeoutFailure(channel, timeoutMs));
          }, timeoutMs);
        });
  const invokeResult = bridge
    .invoke(channel, payload)
    .catch((error: unknown) =>
      composerInvokeFailure<ChannelOutput<C>>(
        channel,
        error instanceof Error ? error.message : String(error),
        error,
      ),
    )
    .then((result) => {
      if (timedOut) options.onLateResult?.(result);
      return result;
    });

  try {
    return timeoutResult === null
      ? await invokeResult
      : await Promise.race([invokeResult, timeoutResult]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

const TITLE_MAX_CHARS = 50;
interface PendingImage {
  readonly path: string;
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly source: InputArtifactSource;
  readonly bytes: number;
  readonly dataUrl: string;
  readonly label: string;
}

interface PendingFileRef {
  readonly path: string;
  readonly name: string;
  readonly reference: string;
  readonly scope: 'project' | 'external';
  readonly kind: 'file' | 'directory';
  readonly bytes?: number;
  readonly isImage: boolean;
}

const MAX_PASTE_BYTES = 6 * 1024 * 1024;
const MAX_PENDING_IMAGES = 8;
const MAX_PENDING_FILE_REFS = 32;

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files');
}

function normalizePathForCompare(value: string, platform: KodaXSpaceBridge['platform']): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$|\s+$/g, '');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function toReferencePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function encodeFileUrlSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function pathToFileUrl(filePath: string, platform: KodaXSpaceBridge['platform']): string {
  if (platform === 'win32' && filePath.startsWith('\\\\')) {
    const [host = '', ...parts] = filePath.slice(2).replace(/\\/g, '/').split('/');
    return `file://${encodeFileUrlSegment(host)}/${parts.map(encodeFileUrlSegment).join('/')}`;
  }

  const normalized = toReferencePath(filePath);
  const pathName =
    platform === 'win32'
      ? normalized.startsWith('/')
        ? normalized
        : `/${normalized}`
      : normalized;
  const encoded = pathName
    .split('/')
    .map((segment, index) =>
      platform === 'win32' && index === 1 && /^[A-Za-z]:$/.test(segment)
        ? segment
        : encodeFileUrlSegment(segment),
    )
    .join('/');
  return `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`;
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/([\\[\]])/g, '\\$1');
}

function relativeToProject(
  filePath: string,
  projectRoot: string,
  platform: KodaXSpaceBridge['platform'],
): string | null {
  const normalizedRoot = normalizePathForCompare(projectRoot, platform);
  const normalizedFile = normalizePathForCompare(filePath, platform);
  if (!normalizedFile.startsWith(`${normalizedRoot}/`)) return null;
  const rawRoot = projectRoot.replace(/\\/g, '/').replace(/\/+$/g, '');
  const rawFile = filePath.replace(/\\/g, '/');
  const rel = rawFile.slice(rawRoot.length + 1);
  return rel.length > 0 ? rel : null;
}

function isSafeAtPathReference(relativePath: string): boolean {
  const normalized = toReferencePath(relativePath);
  return !/\s|[<>()[\]"']/.test(normalized);
}

function formatFileLinkReference(
  filePath: string,
  label: string,
  platform: KodaXSpaceBridge['platform'],
): string {
  return `[${escapeMarkdownLinkLabel(label)}](<${pathToFileUrl(filePath, platform)}>)`;
}

function basenameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/g, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || normalized;
}

function makeDroppedFileRef(
  file: File,
  filePath: string,
  projectRoot: string,
  platform: KodaXSpaceBridge['platform'],
): PendingFileRef {
  const relativePath = relativeToProject(filePath, projectRoot, platform);
  const name = file.name || basenameFromPath(filePath);
  const safeProjectReference =
    relativePath !== null && isSafeAtPathReference(relativePath)
      ? `@${toReferencePath(relativePath)}`
      : null;
  return {
    path: filePath,
    name,
    reference: safeProjectReference ?? formatFileLinkReference(filePath, name, platform),
    scope: relativePath !== null ? 'project' : 'external',
    kind: 'file',
    bytes: file.size,
    isImage: file.type.startsWith('image/'),
  };
}

function makeDirectoryRef(
  directoryPath: string,
  projectRoot: string,
  platform: KodaXSpaceBridge['platform'],
): PendingFileRef {
  const relativePath = relativeToProject(directoryPath, projectRoot, platform);
  const name = basenameFromPath(directoryPath);
  const safeProjectReference =
    relativePath !== null && isSafeAtPathReference(relativePath)
      ? `@${toReferencePath(relativePath)}`
      : null;
  return {
    path: directoryPath,
    name,
    reference: safeProjectReference ?? formatFileLinkReference(directoryPath, name, platform),
    scope: relativePath !== null ? 'project' : 'external',
    kind: 'directory',
    isImage: false,
  };
}

function getDroppedFilePath(file: File): string | null {
  const bridged = window.kodaxSpace?.getPathForFile(file);
  if (bridged) return bridged;
  const legacy = (file as File & { path?: unknown }).path;
  return typeof legacy === 'string' && legacy.length > 0 ? legacy : null;
}

function clipboardImageFiles(data: DataTransfer): File[] {
  const images: File[] = [];
  const seen = new Set<string>();
  const add = (file: File | null): void => {
    if (!file || !file.type.startsWith('image/')) return;
    const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    images.push(file);
  };

  for (let i = 0; i < data.files.length; i++) add(data.files.item(i));
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    if (item?.kind === 'file' && item.type.startsWith('image/')) add(item.getAsFile());
  }
  return images;
}

function shouldTryNativeClipboardImageFallback(data: DataTransfer): boolean {
  const types = Array.from(data.types);
  const hasText = types.includes('text/plain') && data.getData('text/plain').length > 0;
  if (hasText) return false;
  if (Array.from(data.items).some((item) => item.type.startsWith('image/'))) return true;
  return types.length === 0;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function pendingFileReferencePrompt(
  promptText: string,
  fileRefs: readonly PendingFileRef[],
): string {
  return fileRefs
    .map((file) => file.reference)
    .filter((reference) => !promptText.includes(reference))
    .join(' ');
}

function combinePromptAndFileReferences(promptText: string, fileReferencePrompt: string): string {
  if (promptText && fileReferencePrompt) return `${promptText}\n\n${fileReferencePrompt}`;
  return promptText || fileReferencePrompt;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.onload = () => {
      const r = String(reader.result ?? '');
      const comma = r.indexOf(',');
      resolve(comma >= 0 ? r.slice(comma + 1) : r);
    };
    reader.readAsDataURL(blob);
  });
}

function deriveTitle(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) return null;
  const oneLine = trimmed.replace(/\s+/g, ' ');
  return oneLine.length > TITLE_MAX_CHARS
    ? `${oneLine.slice(0, TITLE_MAX_CHARS).trimEnd()}...`
    : oneLine;
}
function tokenizeArgs(rest: string): string[] {
  const result: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    result.push(m[1] ?? m[2] ?? '');
    if (result.length >= SLASH_ARGS_MAX) break;
  }
  return result;
}

function scanArgSpans(rest: string): Array<{ value: string; end: number }> {
  const result: Array<{ value: string; end: number }> = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    result.push({ value: m[1] ?? m[2] ?? '', end: re.lastIndex });
  }
  return result;
}

function tokenizeWorkflowArgs(rest: string): string[] {
  const trimmed = rest.trim();
  if (trimmed === '') return [];
  const spans = scanArgSpans(trimmed);
  const first = spans[0];
  if (!first) return [];
  const command = first.value.toLowerCase();
  const tailAfter = (span: { end: number }): string => trimmed.slice(span.end).trim();
  if (command === 'create') {
    const request = tailAfter(first);
    return request ? ['create', request] : ['create'];
  }
  if (command === 'revise') {
    const args = ['revise'];
    let targetIndex = 1;
    if (spans[1]?.value === '--replace') {
      args.push('--replace');
      targetIndex = 2;
    }
    const target = spans[targetIndex];
    if (!target) return args;
    args.push(target.value);
    const request = tailAfter(target);
    if (request) args.push(request);
    return args;
  }
  if (command === 'rename' || command === 'rerun') {
    const target = spans[1];
    if (!target) return [command];
    const tail = tailAfter(target);
    return tail ? [command, target.value, tail] : [command, target.value];
  }
  const subcommands = new Set([
    'help',
    'list',
    'ls',
    'runs',
    'show',
    'pause',
    'resume',
    'stop',
    'delete',
    'prune',
    'save',
  ]);
  if (!subcommands.has(command)) {
    const rawArgs = tailAfter(first);
    return rawArgs ? [first.value, rawArgs] : [first.value];
  }
  return spans.slice(0, 20).map((span) => span.value);
}

function slashEchoText(name: string, args: readonly string[]): string {
  return `/${name} ${args.join(' ')}`.trim();
}

function workflowPendingMessage(name: string, args: readonly string[]): string | null {
  if (name.toLowerCase() !== 'workflow') return null;
  const first = args[0]?.toLowerCase();
  if (!first) return null;
  if (first === 'create' && (args[1]?.trim().length ?? 0) > 0) {
    return 'generating workflow...';
  }
  if (first === 'revise') {
    const request = args[1] === '--replace' ? args[3] : args[2];
    return request?.trim() ? 'revising workflow...' : null;
  }
  if (first === 'rerun' && args[1]?.trim()) return 'starting workflow...';

  const nonStartingSubcommands = new Set([
    'help',
    'list',
    'ls',
    'runs',
    'show',
    'pause',
    'resume',
    'stop',
    'delete',
    'prune',
    'save',
    'rename',
  ]);
  return nonStartingSubcommands.has(first) ? null : 'starting workflow...';
}

// Projects already asked to prewarm repo-intel this app run. Prewarm is best-effort and
// fires once per project on the user's first keystroke — typing means a send is imminent,
// so we warm the semantic index during the typing window (main gates on license + git
// root; a no-repo / unlicensed project just no-ops). Module-level so it survives composer
// remounts; resetting on app restart is fine (warm again next run).
const prewarmedProjects = new Set<string>();
function maybePrewarmRepoIntel(value: string, projectRoot: string | null): void {
  if (!projectRoot || value.length === 0 || prewarmedProjects.has(projectRoot)) return;
  if (!window.kodaxSpace) return;
  prewarmedProjects.add(projectRoot); // optimistic — never retry-spam per keystroke
  // Fire-and-forget: must never disrupt typing, so swallow everything.
  void window.kodaxSpace.invoke('repointel.prewarm', { projectRoot }).catch(() => {});
}

export function BottomBar(): JSX.Element {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  // New sessions are tagged with the active surface.
  const currentSurface = useSurfaceStore((s) => s.currentSurface);
  const mascotMode = useAppStore((s) => s.mascotMode);
  const providers = useAppStore((s) => s.providers);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const runtimeDefaults = useAppStore((s) => s.runtimeDefaults);
  const pendingProviderId = useAppStore((s) => s.pendingProviderId);
  const pendingModel = useAppStore((s) => s.pendingModel);
  const pendingReasoningMode = useAppStore((s) => s.pendingReasoningMode);
  const pendingPermissionMode = useAppStore((s) => s.pendingPermissionMode);
  const pendingAutoModeEngine = useAppStore((s) => s.pendingAutoModeEngine);
  const pendingAgentMode = useAppStore((s) => s.pendingAgentMode);
  const setPendingProviderId = useAppStore((s) => s.setPendingProviderId);
  const appendUserMessage = useAppStore((s) => s.appendUserMessage);
  const appendLocalNotice = useAppStore((s) => s.appendLocalNotice);
  const appendQueuedUserMessage = useAppStore((s) => s.appendQueuedUserMessage);
  const markQueuedUserMessageAccepted = useAppStore((s) => s.markQueuedUserMessageAccepted);
  const removeQueuedUserMessage = useAppStore((s) => s.removeQueuedUserMessage);
  const promoteQueuedUserMessage = useAppStore((s) => s.promoteQueuedUserMessage);
  const convertLastUserMessageToQueued = useAppStore((s) => s.convertLastUserMessageToQueued);
  const appendWorkflowNotice = useAppStore((s) => s.appendWorkflowNotice);
  const appendEvent = useAppStore((s) => s.appendEvent);
  const rollbackLastUserMessage = useAppStore((s) => s.rollbackLastUserMessage);
  const resetSessionMessages = useAppStore((s) => s.resetSessionMessages);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setPendingSend = useAppStore((s) => s.setPendingSend);
  const appendInputHistory = useAppStore((s) => s.appendInputHistory);
  const inputHistory = useAppStore((s) =>
    currentSessionId
      ? (s.inputHistoryBySession[currentSessionId] ?? EMPTY_INPUT_HISTORY)
      : EMPTY_INPUT_HISTORY,
  );
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  // Images already persisted to main-process temp storage and awaiting send.
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingFileRefs, setPendingFileRefs] = useState<PendingFileRef[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Paste/drop warnings are local to the composer.
  const [imageErr, setImageErr] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const draftRef = useRef<string>('');
  const [caret, setCaret] = useState(0);
  const [dismissedSlash, setDismissedSlash] = useState<{
    readonly start: number;
    readonly query: string;
  } | null>(null);
  const slashKeyHandlerRef = useRef<((e: KeyboardEvent) => boolean) | null>(null);
  const atPathKeyHandlerRef = useRef<((e: KeyboardEvent) => boolean) | null>(null);
  const [partnerWorkbenchContext, setPartnerWorkbenchContext] =
    useState<PartnerWorkbenchContextDetail | null>(() => readPartnerWorkbenchContext());
  const handleSendRef = useRef<
    ((queueMode?: QueueMode, promptOverride?: string) => Promise<void>) | null
  >(null);

  function focusComposerSoon(): void {
    const focusNow = (): void => textareaRef.current?.focus({ preventScroll: true });
    focusNow();
    requestAnimationFrame(focusNow);
    window.setTimeout(focusNow, 50);
    window.setTimeout(focusNow, 180);
  }

  function focusComposerFromContainer(target: EventTarget | null): void {
    if (
      target instanceof HTMLElement &&
      target.closest(
        [
          'button',
          'input',
          'textarea',
          'select',
          'a',
          '[role="button"]',
          '[role="option"]',
          '[role="listbox"]',
          '[role="menu"]',
          '[role="menuitem"]',
          '[role="dialog"]',
          '[data-composer-no-focus]',
        ].join(', '),
      )
    ) {
      return;
    }
    focusComposerSoon();
  }

  /** Insert text into the textarea at the current caret or selection. */
  function insertAtCaret(text: string): void {
    const ta = textareaRef.current;
    if (!ta) {
      setPrompt((p) => p + text);
      return;
    }
    const start = ta.selectionStart ?? -1;
    const end = ta.selectionEnd ?? -1;
    setPrompt((current) => {
      const s = start >= 0 ? start : current.length;
      const e = end >= 0 ? end : current.length;
      return current.slice(0, s) + text + current.slice(e);
    });
    const newPos = (start >= 0 ? start : ta.value.length) + text.length;
    requestAnimationFrame(() => {
      const live = textareaRef.current;
      if (!live) return;
      live.focus();
      try {
        live.setSelectionRange(newPos, newPos);
      } catch {
        /* ignore invalid selection range */
      }
    });
  }

  const maxHeightRef = useRef<number | null>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (maxHeightRef.current === null) {
      const cs = window.getComputedStyle(ta);
      let lh = parseFloat(cs.lineHeight);
      if (!Number.isFinite(lh)) {
        const fs = parseFloat(cs.fontSize) || 14;
        lh = fs * 1.4;
      }
      const padTop = parseFloat(cs.paddingTop) || 0;
      const padBottom = parseFloat(cs.paddingBottom) || 0;
      maxHeightRef.current = Math.round(lh * 12 + padTop + padBottom);
    }
    ta.style.height = 'auto';
    const next = Math.min(ta.scrollHeight, maxHeightRef.current);

    ta.style.height = `${next}px`;
    ta.style.overflowY = ta.scrollHeight > maxHeightRef.current ? 'auto' : 'hidden';
  }, [prompt]);

  useEffect(() => {
    const onFocus = (): void => focusComposerSoon();
    window.addEventListener('kodax-space.focus-textarea', onFocus);
    return () => window.removeEventListener('kodax-space.focus-textarea', onFocus);
  }, []);

  useEffect(() => {
    const onPartnerWorkbenchContext = (event: Event): void => {
      setPartnerWorkbenchContext(
        (event as CustomEvent<PartnerWorkbenchContextDetail>).detail ?? null,
      );
    };
    window.addEventListener(PARTNER_WORKBENCH_CONTEXT_EVENT, onPartnerWorkbenchContext);
    const latest = readPartnerWorkbenchContext();
    if (latest) setPartnerWorkbenchContext(latest);
    return () => {
      window.removeEventListener(PARTNER_WORKBENCH_CONTEXT_EVENT, onPartnerWorkbenchContext);
    };
  }, []);

  // and focus it (caret at end). Callers may also request an immediate submit
  // when they are launching a structured task through the normal composer path.

  useEffect(() => {
    const onPrefill = (e: Event): void => {
      const detail = (e as CustomEvent<{ text?: string; submit?: boolean; queueMode?: QueueMode }>)
        .detail;
      if (typeof detail?.text !== 'string') return;
      setPrompt(detail.text);
      const len = detail.text.length; // use the known length, not the (maybe-stale) DOM value
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(len, len);
        setCaret(len);
      });
      if (detail.submit) {
        const queueMode = detail.queueMode === 'after-turn' ? 'after-turn' : 'interrupt';
        void handleSendRef.current?.(queueMode, detail.text);
      }
    };
    window.addEventListener('kodax-space.compose-prefill', onPrefill);
    return () => window.removeEventListener('kodax-space.compose-prefill', onPrefill);
  }, []);

  useEffect(() => {
    return registerInsertReceiver((text) => {
      const safe = text.length > 4096 ? text.slice(0, 4096) : text;
      insertAtCaret(safe);
    });
  }, []);

  async function ensureSession(): Promise<string | null> {
    if (currentSessionId) {
      const activeSession = useAppStore
        .getState()
        .sessions.find((s) => s.sessionId === currentSessionId);
      if (
        currentProjectPath &&
        activeSession &&
        sessionMatchesScope(activeSession, {
          projectRoot: currentProjectPath,
          surface: currentSurface,
        })
      ) {
        return currentSessionId;
      }
      setCurrentSession(null);
    }
    if (!window.kodaxSpace) return null;
    if (!currentProjectPath) {
      setErr(t('bottom.openFolderFirstShortcut'));
      return null;
    }
    const { provider, runtimeOverrides, model } = resolveSessionCreateInputs({
      projectRoot: currentProjectPath,
      providers,
      defaultProviderId,
      kodaxDefaults,
      spaceRuntimeDefaults: runtimeDefaults,
      pendingProviderId,
      pendingReasoningMode,
      pendingPermissionMode,
      pendingAutoModeEngine,
      pendingAgentMode,
      pendingModel,
    });
    const createPayload: ChannelInput<'session.create'> = {
      projectRoot: currentProjectPath,
      provider,
      ...(model ? { model } : {}),
      ...runtimeOverrides,
      surface: currentSurface,
    };

    const applyCreatedSession = (
      data: ChannelOutput<'session.create'>,
      source: 'foreground' | 'late',
    ): string => {
      const stub: SessionMeta = {
        sessionId: data.sessionId,
        projectRoot: currentProjectPath,
        provider,
        ...(model ? { model } : {}),
        reasoningMode: data.reasoningMode,
        permissionMode: data.permissionMode,
        autoModeEngine: data.autoModeEngine,
        agentMode: data.agentMode,
        surface: currentSurface,
        title: undefined,
        createdAt: data.createdAt,
        lastActivityAt: data.createdAt,
      };
      upsertSession(stub);
      const latest = useAppStore.getState();
      const latestSurface = useSurfaceStore.getState().currentSurface;
      if (
        shouldActivateSessionForCurrentScope(stub, {
          currentProjectPath: latest.currentProjectPath,
          currentSurface: latestSurface,
        })
      ) {
        setCurrentSession(stub.sessionId);
      }
      setPendingProviderId(null);
      if (source === 'late') {
        setErr(null);
        pushToast(t('bottom.sessionCreatedInBackground'), 'info');
      }
      void window.kodaxSpace
        ?.invoke('session.list', {
          projectRoot: currentProjectPath,
          surface: currentSurface,
        })
        .then((listResult) => {
          if (listResult.ok) {
            useAppStore.getState().replaceSessionsForScope(listResult.data.sessions, {
              projectRoot: currentProjectPath,
              surface: currentSurface,
            });
          }
        })
        .catch(() => {});
      return stub.sessionId;
    };

    const result = await invokeComposerIpc('session.create', createPayload, {
      onLateResult: (lateResult) => {
        if (lateResult.ok) {
          applyCreatedSession(lateResult.data, 'late');
        }
      },
    });
    if (!result.ok) {
      setErr(`${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? 'create failed'}`);
      return null;
    }
    return applyCreatedSession(result.data, 'foreground');
  }

  async function attachPendingPartnerSourcesForSend(
    sessionId: string,
  ): Promise<readonly PartnerWorkbenchSourceRef[] | null> {
    const existingSources = partnerWorkbenchContext?.sources ?? [];
    if (currentSurface !== 'partner' || !currentProjectPath) return existingSources;
    const pendingSources = partnerWorkbenchContext?.pendingSources?.length
      ? partnerWorkbenchContext.pendingSources
      : readPartnerPendingSources(currentProjectPath);
    if (pendingSources.length === 0) return existingSources;

    const attachedSources: PartnerWorkbenchSourceRef[] = [];
    for (const source of pendingSources) {
      const payload: ChannelInput<'partner.sources.add'> = {
        sessionId,
        projectRoot: currentProjectPath,
        path: source.path,
        ...(source.label ? { label: source.label } : {}),
      };
      const result = await invokeComposerIpc('partner.sources.add', payload);
      if (!result.ok) {
        setErr(
          `${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? t('common.unknownError')}`,
        );
        return null;
      }
      attachedSources.push({
        id: result.data.source.id,
        path: result.data.source.path,
        label: result.data.source.label,
      });
    }

    clearPartnerPendingSources(currentProjectPath);
    window.dispatchEvent(new Event(PARTNER_SOURCES_CHANGED_EVENT));
    const mergedSources = [...existingSources];
    for (const source of attachedSources) {
      if (
        !mergedSources.some(
          (existing) => existing.id === source.id || existing.path === source.path,
        )
      ) {
        mergedSources.push(source);
      }
    }
    return mergedSources;
  }

  async function attachImages(blobs: readonly File[], source: InputArtifactSource): Promise<void> {
    if (blobs.length === 0) return;
    if (!window.kodaxSpace) return;

    setImageErr(null);

    // Validate before creating a session for pasted or dropped images.
    const accepted: Array<{ file: File; mediaType: PendingImage['mediaType'] }> = [];
    for (const b of blobs) {
      const mediaType = inlineImageMediaType(b);
      if (!mediaType) {
        setImageErr(t('bottom.unsupportedImageType', { type: b.type || t('common.unknownError') }));
        continue;
      }
      if (b.size > MAX_PASTE_BYTES) {
        setImageErr(
          t('bottom.imageTooLarge', {
            size: formatBytes(b.size),
            max: formatBytes(MAX_PASTE_BYTES),
          }),
        );
        continue;
      }
      if (pendingImages.length + accepted.length >= MAX_PENDING_IMAGES) {
        setImageErr(t('bottom.maxImages', { max: MAX_PENDING_IMAGES }));
        break;
      }
      accepted.push({ file: b, mediaType });
    }
    if (accepted.length === 0) return;

    const sid = await ensureSession();
    if (!sid) return;

    const saved: PendingImage[] = [];
    for (const { file: b, mediaType } of accepted) {
      try {
        const base64 = await blobToBase64(b);
        const r = await invokeComposerIpc('clipboard.saveImage', {
          sessionId: sid,
          base64,
          mediaType,
        });
        if (!r.ok) {
          setImageErr(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'save failed'}`);
          continue;
        }
        saved.push({
          path: r.data.path,
          mediaType,
          source,
          bytes: r.data.bytes,
          dataUrl: `data:${mediaType};base64,${base64}`,
          label:
            source === 'file-picker' && b.name
              ? b.name
              : b.name && b.name !== 'image.png'
                ? b.name
                : source === 'drag-drop'
                  ? t('bottom.droppedImage')
                  : t('bottom.pastedImage'),
        });
      } catch (e) {
        setImageErr(e instanceof Error ? e.message : String(e));
      }
    }
    if (saved.length > 0) {
      setPendingImages((prev) => [...prev, ...saved]);
    }
  }

  async function attachNativeClipboardImage(): Promise<void> {
    if (!window.kodaxSpace) return;
    if (pendingImages.length >= MAX_PENDING_IMAGES) {
      setImageErr(t('bottom.maxImages', { max: MAX_PENDING_IMAGES }));
      return;
    }

    setImageErr(null);
    const sid = await ensureSession();
    if (!sid) return;

    const r = await invokeComposerIpc('clipboard.readImage', { sessionId: sid });
    if (!r.ok) {
      setImageErr(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'read failed'}`);
      return;
    }
    if (r.data.image === null) return;

    const image = r.data.image;
    setPendingImages((prev) => {
      if (prev.length >= MAX_PENDING_IMAGES) return prev;
      return [
        ...prev,
        {
          path: image.path,
          mediaType: image.mediaType,
          source: 'clipboard',
          bytes: image.bytes,
          dataUrl: `data:${image.mediaType};base64,${image.base64}`,
          label: t('bottom.pastedImage'),
        },
      ];
    });
  }

  function removePendingImage(idx: number): void {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  }

  function removePendingFileRef(idx: number): void {
    setPendingFileRefs((prev) => prev.filter((_, i) => i !== idx));
  }

  async function attachLocalFiles(
    files: readonly File[],
    source: 'drag-drop' | 'file-picker',
  ): Promise<void> {
    if (files.length === 0) return;
    if (!currentProjectPath) {
      setErr(t('bottom.openFolderFirstShortcut'));
      return;
    }

    setImageErr(null);
    const imageFiles = files.filter(isSupportedInlineImage);
    const referenceFiles = files.filter((file) => !isSupportedInlineImage(file));
    const room = Math.max(0, MAX_PENDING_FILE_REFS - pendingFileRefs.length);
    const acceptedRefs = referenceFiles.slice(0, room);
    if (acceptedRefs.length < referenceFiles.length) {
      setImageErr(
        t('bottom.addedFilesWithLimit', {
          count: acceptedRefs.length,
          max: MAX_PENDING_FILE_REFS,
        }),
      );
    } else if (room <= 0 && referenceFiles.length > 0) {
      setImageErr(t('bottom.maxFileRefs', { max: MAX_PENDING_FILE_REFS }));
    }

    const refs: PendingFileRef[] = [];
    let unresolved = 0;
    for (const file of acceptedRefs) {
      const filePath = getDroppedFilePath(file);
      if (!filePath) {
        unresolved += 1;
        continue;
      }
      refs.push(
        makeDroppedFileRef(
          file,
          filePath,
          currentProjectPath,
          window.kodaxSpace?.platform ?? 'win32',
        ),
      );
    }

    if (refs.length > 0) {
      setPendingFileRefs((prev) => [...prev, ...refs]);
    }
    if (unresolved > 0) {
      setImageErr(
        t(
          source === 'file-picker'
            ? 'bottom.unresolvedSelectedFiles'
            : 'bottom.unresolvedDroppedFiles',
          { count: unresolved },
        ),
      );
    }

    if (imageFiles.length > 0) {
      await attachImages(imageFiles, source);
    }
  }

  async function attachFolder(): Promise<void> {
    if (!window.kodaxSpace) return;
    if (!currentProjectPath) {
      setErr(t('bottom.openFolderFirstShortcut'));
      return;
    }
    if (pendingFileRefs.length >= MAX_PENDING_FILE_REFS) {
      setImageErr(t('bottom.maxFileRefs', { max: MAX_PENDING_FILE_REFS }));
      return;
    }

    setImageErr(null);
    const result = await window.kodaxSpace.invoke('project.openDialog', undefined);
    if (!result.ok) {
      setErr(
        `${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? t('common.unknownError')}`,
      );
      return;
    }
    if (result.data.path === null) return;

    const ref = makeDirectoryRef(result.data.path, currentProjectPath, window.kodaxSpace.platform);
    setPendingFileRefs((prev) => (prev.length < MAX_PENDING_FILE_REFS ? [...prev, ref] : prev));
  }

  function onDragEnter(e: React.DragEvent<HTMLDivElement>): void {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>): void {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDraggingFiles(true);
  }

  function onDragLeave(e: React.DragEvent<HTMLDivElement>): void {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingFiles(false);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>): void {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    void attachLocalFiles(Array.from(e.dataTransfer.files), 'drag-drop');
  }

  const activeSlash = getActiveSlashCompletion(prompt, caret);
  const slashDismissed =
    activeSlash !== null &&
    dismissedSlash !== null &&
    dismissedSlash.start === activeSlash.start &&
    dismissedSlash.query === activeSlash.query;
  const slashMode =
    activeSlash !== null && !slashDismissed && shouldOpenSlashCompletion(activeSlash.query);
  async function execSlashOrSkill(
    sessionId: string,
    name: string,
    args: string[],
    queueMode: QueueMode = 'interrupt',
  ): Promise<void> {
    // 本函数追加进 transcript 的每一条(slash echo + 本地反馈)都**没有 SDK 回合**在背后
    // ——真正触发 SDK turn 的只有技能(走 invokeSkill,另一函数)。所以这里把 appendUserMessage
    // 局部改道到 appendLocalNotice:它们只按时间排序、**不消费一段 assistant events**,否则一条
    // 没有 events 的本地 slash 会把下一条真 query 的回答吃走(错位 bug)。workflow 走 appendWorkflowNotice,不受影响。
    const appendUserMessage = appendLocalNotice;
    if (!window.kodaxSpace) {
      setErr(t('bottom.ipcUnavailable'));
      appendUserMessage(sessionId, '[slash] IPC unavailable');
      return;
    }
    const pendingWorkflowMessage = workflowPendingMessage(name, args);
    const optimisticWorkflow = pendingWorkflowMessage !== null;
    const commandEcho = slashEchoText(name, args);
    setBusy(true);
    setErr(null);
    if (optimisticWorkflow) {
      appendUserMessage(sessionId, commandEcho);
      appendWorkflowNotice(sessionId, `[workflow] ${pendingWorkflowMessage}`);
    }
    try {
      const result = await invokeComposerIpc('slash.exec', {
        sessionId,
        name,
        args,
        ...(currentProjectPath ? { expectedProjectRoot: currentProjectPath } : {}),
        expectedSurface: currentSurface,
      });
      if (!result.ok) {
        if (optimisticWorkflow) {
          appendWorkflowNotice(
            sessionId,
            `[workflow] IPC failed: ${result.error?.message ?? t('common.unknownError')}`,
          );
        }
        setErr(
          `${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? t('common.unknownError')}`,
        );
        return;
      }
      const { ok, message, echo, clearStream, unknownCommand } = result.data;
      if (unknownCommand) {
        await invokeSkill(sessionId, name, args, queueMode);
        return;
      }
      if (ok && message?.startsWith('__action__:')) {
        await dispatchSlashAction(sessionId, name, args, message.slice('__action__:'.length));
        return;
      }
      if (echo && message) {
        // F031: show the command and the handler feedback in the conversation stream.
        if (!optimisticWorkflow) appendUserMessage(sessionId, commandEcho);
        if (!clearStream) {
          if (optimisticWorkflow) appendWorkflowNotice(sessionId, message);
          else appendUserMessage(sessionId, message);
        }
      }
      if (clearStream) {
        resetSessionMessages(sessionId);
      }
      if (!ok && message) {
        if (optimisticWorkflow) appendWorkflowNotice(sessionId, `[workflow] ${message}`);
        setErr(message);
      } else if (ok && message && !echo) {
        if (optimisticWorkflow) appendWorkflowNotice(sessionId, message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function dispatchSlashAction(
    sessionId: string,
    name: string,
    args: string[],
    action: string,
  ): Promise<void> {
    // 本函数处理的全是**本地 UI/IPC action**(status/cost/tree/history/repointel/doctor/mcp/
    // sessions/skills/review/load/delete/fork/rewind…),没有一条会触发 SDK 主回合。故把
    // appendUserMessage 局部改道到 appendLocalNotice:echo + 输出只按时间排序、**不消费 assistant
    // events**——否则这些没有 events 的本地条目会把下一条真 query 的回答吃走(用户复报的 slash 错位)。
    const appendUserMessage = appendLocalNotice;
    // Echo the slash command into the transcript.
    appendUserMessage(sessionId, `/${name} ${args.join(' ')}`.trim());

    const state = useAppStore.getState();
    const events = state.eventsBySession[sessionId] ?? [];

    if (action === 'new-session') {
      state.setCurrentSession(null);
      return;
    }

    if (action === 'copy-last') {
      let lastText = '';
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.kind === 'text_delta') lastText = (ev as { text?: string }).text + lastText;
        else if (ev.kind === 'session_complete' || ev.kind === 'session_error') {
          continue;
        } else if (
          lastText.length > 0 &&
          (ev.kind === 'tool_result' || ev.kind === 'session_start')
        ) {
          break;
        }
      }
      if (lastText.length === 0) {
        pushToast(t('bottom.noAssistantMessageToCopy'), 'warning');
        return;
      }
      try {
        await navigator.clipboard.writeText(lastText);
        pushToast(t('bottom.copiedChars', { count: lastText.length }), 'success');
      } catch (err) {
        pushToast(
          t('bottom.clipboardWriteFailed', {
            message: err instanceof Error ? err.message : String(err),
          }),
          'error',
        );
      }
      return;
    }

    if (action === 'show-cost') {
      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      let lastIter = 0;
      let maxIter = 0;
      for (const ev of events) {
        if (ev.kind === 'iteration_end') {
          const e = ev as {
            iter?: number;
            maxIter?: number;
            tokenCount?: number;
            usage?: { inputTokens?: number; outputTokens?: number };
          };
          if (typeof e.iter === 'number') lastIter = e.iter;
          if (typeof e.maxIter === 'number') maxIter = e.maxIter;
          if (typeof e.tokenCount === 'number') totalTokens = e.tokenCount;
          if (e.usage) {
            if (typeof e.usage.inputTokens === 'number') inputTokens = e.usage.inputTokens;
            if (typeof e.usage.outputTokens === 'number') outputTokens = e.usage.outputTokens;
          }
        }
      }
      const lines = [
        `[cost] session: ${sessionId.slice(0, 12)}...`,
        `  iterations: ${lastIter}/${maxIter || '?'}`,
        `  input tokens: ${inputTokens.toLocaleString()}`,
        `  output tokens: ${outputTokens.toLocaleString()}`,
        `  total: ${totalTokens.toLocaleString()}`,
        '  (cost estimate requires per-model pricing - v0.1.7+)',
      ];
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-tree') {
      const all = state.sessions;
      const me = all.find((s) => s.sessionId === sessionId);
      if (!me) {
        appendUserMessage(sessionId, '[tree] session not in renderer list');
        return;
      }
      let root = me;
      while (root.parentSessionId) {
        const parent = all.find((s) => s.sessionId === root.parentSessionId);
        if (!parent) break;
        root = parent;
      }
      const lines: string[] = [`[tree] lineage from ${root.sessionId.slice(0, 12)}...`];
      const visit = (sid: string, depth: number): void => {
        const sess = all.find((s) => s.sessionId === sid);
        if (!sess) return;
        const marker = sess.sessionId === sessionId ? '*' : '-';
        const indent = '  '.repeat(depth);
        lines.push(`${indent}${marker} ${sess.title ?? sess.sessionId.slice(0, 12)}`);
        const kids = all.filter((s) => s.parentSessionId === sid);
        for (const k of kids) visit(k.sessionId, depth + 1);
      };
      visit(root.sessionId, 0);
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-history') {
      const userMsgs = state.userMessagesBySession[sessionId] ?? [];
      if (userMsgs.length === 0) {
        appendUserMessage(sessionId, '[history] no user messages yet');
        return;
      }
      const lines = [
        `[history] ${userMsgs.length} user message(s):`,
        ...userMsgs.slice(-20).map((m, i) => {
          const idx = Math.max(0, userMsgs.length - 20) + i + 1;
          const head = m.content.replace(/\s+/g, ' ').slice(0, 80);
          return `  ${idx}. ${head}${m.content.length > 80 ? '...' : ''}`;
        }),
      ];
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-repointel-status') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[repointel] IPC unavailable');
        return;
      }
      const traces = events.filter((ev) => ev.kind === 'repointel_trace');
      const result = await invokeComposerIpc('repointel.status', {
        projectRoot: state.currentProjectPath ?? undefined,
      });
      if (!result.ok) {
        appendUserMessage(
          sessionId,
          `[repointel] status failed: ${result.error?.message ?? 'unknown'}`,
        );
        return;
      }
      const status = result.data;
      const lines = [
        '[repointel] status:',
        `  project: ${status.projectRoot ?? '(none)'}`,
        `  project exists: ${status.projectExists ? 'yes' : 'no'}`,
        `  git root: ${status.gitRoot ?? '(not detected)'}`,
        `  trace source: ${status.traceSource}`,
        `  recent session traces: ${traces.length}`,
        `  warm: ${status.warmSupported ? 'supported' : 'unsupported'}`,
        `  warm reason: ${status.warmReason}`,
        '  diagnostics:',
        ...status.diagnostics.map((d) => `    - [${d.status}] ${d.id}: ${d.detail}`),
      ];
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-repointel-trace' || action === 'show-repointel') {
      const traces: Array<{
        kind: string;
        mode?: string;
        engine?: string;
        status?: string;
        latencyMs?: number;
        cacheHit?: boolean;
      }> = [];
      for (let i = events.length - 1; i >= 0 && traces.length < 8; i--) {
        const ev = events[i];
        if (ev.kind === 'repointel_trace') {
          const e = (ev as { event?: (typeof traces)[number] }).event;
          if (e) traces.unshift(e);
        }
      }
      if (traces.length === 0) {
        appendUserMessage(
          sessionId,
          '[repointel] no traces yet - KodaX repo-intelligence has not emitted any events this session',
        );
        return;
      }
      const lines = [
        `[repointel] last ${traces.length} trace(s):`,
        ...traces.map((t, i) => {
          const parts = [`${i + 1}. ${t.kind}`];
          if (t.mode) parts.push(`mode=${t.mode}`);
          if (t.engine) parts.push(`engine=${t.engine}`);
          if (t.status) parts.push(`status=${t.status}`);
          if (typeof t.latencyMs === 'number') parts.push(`${t.latencyMs}ms`);
          if (t.cacheHit) parts.push('cache=hit');
          return `  ${parts.join(' | ')}`;
        }),
      ];
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-memory') {
      if (currentSurface === 'partner') {
        appendUserMessage(
          sessionId,
          'Use /memory from the Coder surface. Partner KB remains separate.',
        );
        return;
      }
      useAppStore.getState().requestPopout('memory');
      return;
    }

    if (action === 'insert-review-template') {
      if (!window.kodaxSpace || !currentProjectPath) {
        appendUserMessage(sessionId, '[review] no project / IPC unavailable');
        return;
      }
      const r = await invokeComposerIpc('project.gitDiff', {
        projectRoot: currentProjectPath,
      });
      if (!r.ok) {
        appendUserMessage(sessionId, `[review] git diff failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      if (!r.data.isGitRepo) {
        appendUserMessage(sessionId, '[review] not a git repository');
        return;
      }
      if (r.data.error !== null) {
        appendUserMessage(sessionId, `[review] ${r.data.error}`);
        return;
      }
      if (r.data.diff.trim().length === 0) {
        appendUserMessage(sessionId, '[review] no uncommitted changes vs HEAD');
        return;
      }
      const truncationNote = r.data.truncated
        ? '\n\n*(diff truncated at 64KB - full review may need narrower scope)*'
        : '';
      const template = [
        'Please review the following uncommitted changes vs HEAD. For each meaningful change:',
        '- Note correctness bugs or edge cases',
        '- Flag security / performance issues',
        '- Suggest concrete improvements (cite file:line)',
        'Avoid generic "consider X" - name the actual issue or skip.',
        '',
        '```diff',
        r.data.diff,
        '```',
        truncationNote,
      ].join('\n');
      setPrompt(template);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    if (action === 'show-status') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[status] IPC unavailable');
        return;
      }
      const r = await invokeComposerIpc('session.listRunning', undefined);
      if (!r.ok) {
        appendUserMessage(
          sessionId,
          `[status] listRunning failed: ${r.error?.message ?? 'unknown'}`,
        );
        return;
      }
      const peers = r.data.peers;
      if (peers.length === 0) {
        appendUserMessage(sessionId, '[status] No other KodaX peer instances running.');
        return;
      }
      const lines = [`[status] ${peers.length} other peer instance(s):`];
      for (const p of peers) {
        const ageSec = Math.max(0, Math.floor((Date.now() - p.startedAt) / 1000));
        const ageLabel =
          ageSec < 60
            ? `${ageSec}s`
            : ageSec < 3600
              ? `${Math.floor(ageSec / 60)}m`
              : `${Math.floor(ageSec / 3600)}h`;
        const sid = p.sessionId ? p.sessionId.slice(0, 12) : '(bootstrapping)';
        lines.push(`  pid ${p.pid} | session ${sid} | ${ageLabel} ago | ${p.cwd}`);
      }
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-doctor') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[doctor] IPC unavailable');
        return;
      }
      const r = await invokeComposerIpc('provider.list', undefined);
      if (!r.ok) {
        appendUserMessage(
          sessionId,
          `[doctor] provider.list failed: ${r.error?.message ?? 'unknown'}`,
        );
        return;
      }
      const providers = r.data.providers;
      const probeTargets = providers.filter((p) => p.configured);
      const probeResults = await Promise.all(
        probeTargets.map(async (p) => {
          if (!window.kodaxSpace) return { id: p.id, ok: false, error: 'no IPC' };
          const tr = await invokeComposerIpc('provider.test', { providerId: p.id });
          if (!tr.ok) return { id: p.id, ok: false, error: tr.error?.message ?? 'IPC error' };
          return {
            id: p.id,
            ok: tr.data.ok,
            latencyMs: tr.data.latencyMs,
            error: tr.data.error,
          };
        }),
      );
      const probeById = new Map(probeResults.map((x) => [x.id, x]));

      const lines: string[] = [
        `[doctor] ${providers.length} provider(s), default = ${r.data.defaultProviderId ?? '(none)'}, keychain = ${r.data.keychainBackend}`,
      ];
      for (const p of providers) {
        const isDefault = p.id === r.data.defaultProviderId ? ' [default]' : '';
        const keyStatus = p.configured ? 'key' : 'no key';
        const probe = probeById.get(p.id);
        let probeStatus = '';
        if (p.configured && probe) {
          if (probe.ok) {
            const lat = probe.latencyMs !== undefined ? ` ${probe.latencyMs}ms` : '';
            probeStatus = ` | HTTP ok${lat}`;
          } else {
            probeStatus = ` | HTTP failed: ${probe.error ?? 'failed'}`;
          }
        }
        lines.push(`  ${p.id}${isDefault} (${p.displayName}) - ${keyStatus}${probeStatus}`);
      }
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'exit-app') {
      pushToast(t('bottom.closing'), 'info', 1200);
      window.close();
      return;
    }

    if (action === 'reload-context') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[reload] IPC unavailable');
        return;
      }
      const lines = ['[reload] refreshed:'];
      if (currentProjectPath) {
        const skills = await invokeComposerIpc('skill.discover', {
          projectRoot: currentProjectPath,
          forceReload: true,
        });
        lines.push(
          skills.ok
            ? `  skills: ${skills.data.skills.length}`
            : `  skills: failed (${skills.error?.message ?? 'unknown'})`,
        );
      } else {
        lines.push('  skills: skipped (no project)');
      }
      const mcp = await invokeComposerIpc(
        'mcp.reload',
        currentProjectPath ? { projectRoot: currentProjectPath } : undefined,
      );
      lines.push(
        mcp.ok
          ? `  mcp: ${mcp.data.ok ? 'ok' : 'not reloaded'} (${mcp.data.serverCount} server(s))`
          : `  mcp: failed (${mcp.error?.message ?? 'unknown'})`,
      );
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-extensions') {
      if (!window.kodaxSpace || !currentProjectPath) {
        appendUserMessage(sessionId, '[extensions] no project / IPC unavailable');
        return;
      }
      const r = await invokeComposerIpc('mcp.discover', { projectRoot: currentProjectPath });
      if (!r.ok) {
        appendUserMessage(
          sessionId,
          `[extensions] discover failed: ${r.error?.message ?? 'unknown'}`,
        );
        return;
      }
      const lines = [`[extensions] ${r.data.servers.length} MCP extension/server(s):`];
      if (r.data.servers.length === 0) lines.push('  none configured');
      for (const server of r.data.servers.slice(0, 30)) {
        const target =
          server.transport === 'http'
            ? (server.url ?? '(no url)')
            : [server.command, ...(server.args ?? [])].filter(Boolean).join(' ');
        lines.push(`  ${server.name}  ${server.source}  ${server.transport}  ${target}`);
      }
      if (r.data.servers.length > 30) lines.push(`  ... ${r.data.servers.length - 30} more`);
      if (r.data.errors.length > 0) {
        lines.push('Errors:');
        lines.push(...r.data.errors.slice(0, 8).map((e) => `  ${e.path}: ${e.error}`));
      }
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-mcp') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[mcp] IPC unavailable');
        return;
      }
      if (args[0]?.toLowerCase() === 'refresh') {
        const reload = await invokeComposerIpc(
          'mcp.reload',
          currentProjectPath ? { projectRoot: currentProjectPath } : undefined,
        );
        if (!reload.ok) {
          appendUserMessage(
            sessionId,
            `[mcp] reload failed: ${reload.error?.message ?? 'unknown'}`,
          );
          return;
        }
      }
      const r = await invokeComposerIpc(
        'mcp.servers',
        currentProjectPath ? { projectRoot: currentProjectPath } : undefined,
      );
      if (!r.ok) {
        appendUserMessage(sessionId, `[mcp] servers failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      const prefix = args[0]?.toLowerCase() === 'refresh' ? '[mcp] reloaded; ' : '[mcp] ';
      const lines = [`${prefix}${r.data.servers.length} server(s):`];
      if (r.data.servers.length === 0) lines.push('  none configured');
      for (const server of r.data.servers) {
        const dirty = server.dirty ? ' dirty' : '';
        const cached = server.cachedAt ? ` cached=${server.cachedAt}` : '';
        const err = server.lastError ? ` error=${server.lastError}` : '';
        lines.push(
          `  ${server.serverId}  ${server.status}/${server.connect}  tools=${server.tools} resources=${server.resources} prompts=${server.prompts}${dirty}${cached}${err}`,
        );
      }
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'list-sessions') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[sessions] IPC unavailable');
        return;
      }
      const r = await invokeComposerIpc('session.list', {
        ...(currentProjectPath ? { projectRoot: currentProjectPath } : {}),
        surface: currentSurface,
      });
      if (!r.ok) {
        appendUserMessage(sessionId, `[sessions] list failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      state.replaceSessionsForScope(r.data.sessions, {
        ...(currentProjectPath ? { projectRoot: currentProjectPath } : {}),
        surface: currentSurface,
      });
      const lines = [`[sessions] ${r.data.sessions.length} session(s):`];
      for (const s of r.data.sessions.slice(0, 40)) {
        const title = s.title ? `  ${s.title}` : '';
        const count = s.msgCount !== undefined ? `  ${s.msgCount} msg(s)` : '';
        lines.push(
          `  ${s.sessionId}${title}${count}  ${new Date(s.lastActivityAt).toLocaleString()}`,
        );
      }
      if (r.data.sessions.length > 40) lines.push(`  ... ${r.data.sessions.length - 40} more`);
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'load-session') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[load] IPC unavailable');
        return;
      }
      const target = args[0];
      if (!target) {
        appendUserMessage(sessionId, '[load] Usage: /load <session-id>');
        return;
      }
      const r = await invokeComposerIpc('session.list', undefined);
      if (!r.ok) {
        appendUserMessage(sessionId, `[load] list failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      const found = r.data.sessions.find(
        (s) => s.sessionId === target || s.sessionId.startsWith(target),
      );
      if (!found) {
        appendUserMessage(sessionId, `[load] session not found: ${target}`);
        return;
      }
      state.upsertSession(found);
      state.setCurrentSession(found.sessionId);
      appendUserMessage(
        sessionId,
        `[load] switched to ${found.sessionId}${found.title ? ` (${found.title})` : ''}`,
      );
      return;
    }

    if (action === 'delete-session') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[delete] IPC unavailable');
        return;
      }
      const target = args[0];
      if (!target) {
        appendUserMessage(sessionId, '[delete] Usage: /delete <session-id>');
        return;
      }
      const r = await invokeComposerIpc(
        'session.delete',
        { sessionId: target },
        { timeoutMs: null },
      );
      if (!r.ok) {
        appendUserMessage(sessionId, `[delete] failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      if (!r.data.deleted) {
        appendUserMessage(
          sessionId,
          r.data.reason === 'session_running'
            ? `[delete] session is still running in another KodaX process: ${target}`
            : `[delete] session was not deleted: ${target}`,
        );
        return;
      }
      state.removeSession(target);
      if (target === sessionId) state.setCurrentSession(null);
      appendUserMessage(sessionId, `[delete] deleted session ${target}`);
      return;
    }

    if (action === 'fork-session') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[fork] IPC unavailable');
        return;
      }
      const session = state.sessions.find((s) => s.sessionId === sessionId);
      if (!session) {
        appendUserMessage(sessionId, '[fork] current session is not in the renderer list');
        return;
      }
      if (args[0] && !/^\d+$/.test(args[0])) {
        appendUserMessage(
          sessionId,
          '[fork] entry-id/label selection is not exposed in Space yet; forking current branch.',
        );
      }
      const userMsgs = state.userMessagesBySession[sessionId] ?? [];
      const requestedIdx = args[0] && /^\d+$/.test(args[0]) ? Number(args[0]) : undefined;
      const forkPointTurnIdx = Math.max(
        0,
        Math.min(requestedIdx ?? userMsgs.length - 1, Math.max(0, userMsgs.length - 1)),
      );
      const r = await invokeComposerIpc(
        'session.fork',
        { sessionId, forkPointTurnIdx },
        { timeoutMs: null },
      );
      if (!r.ok) {
        appendUserMessage(sessionId, `[fork] failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      const childTitle =
        session.title !== undefined
          ? `${session.title.replace(/( \(fork\))+$/, '')} (fork)`
          : undefined;
      const childSession = {
        ...session,
        sessionId: r.data.newSessionId,
        title: childTitle,
        createdAt: r.data.createdAt,
        lastActivityAt: r.data.createdAt,
        parentSessionId: sessionId,
        forkPointTurnIdx,
      };
      state.upsertSession(childSession);
      state.forkSessionBuffers(sessionId, r.data.newSessionId, forkPointTurnIdx);
      const latest = useAppStore.getState();
      const latestSurface = useSurfaceStore.getState().currentSurface;
      if (
        shouldActivateSessionForCurrentScope(childSession, {
          currentProjectPath: latest.currentProjectPath,
          currentSurface: latestSurface,
        })
      ) {
        state.setCurrentSession(r.data.newSessionId);
      }
      appendUserMessage(
        sessionId,
        `[fork] created ${r.data.newSessionId} from turn ${forkPointTurnIdx}`,
      );
      return;
    }

    if (action === 'rewind-session') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[rewind] IPC unavailable');
        return;
      }
      const userMsgs = state.userMessagesBySession[sessionId] ?? [];
      if (userMsgs.length === 0) {
        appendUserMessage(sessionId, '[rewind] nothing to rewind; no turns yet');
        return;
      }
      if (args[0] && !/^\d+$/.test(args[0])) {
        appendUserMessage(
          sessionId,
          '[rewind] entry-id/label selection is not exposed in Space yet; rewinding one turn.',
        );
      }
      const requestedIdx = args[0] && /^\d+$/.test(args[0]) ? Number(args[0]) : undefined;
      if (requestedIdx === undefined && userMsgs.length < 2) {
        appendUserMessage(sessionId, '[rewind] no earlier turn to rewind to');
        return;
      }
      const rewindPastTurnIdx = Math.max(
        0,
        Math.min(requestedIdx ?? userMsgs.length - 2, Math.max(0, userMsgs.length - 1)),
      );
      const r = await invokeComposerIpc(
        'session.rewind',
        { sessionId, rewindPastTurnIdx },
        { timeoutMs: null },
      );
      if (!r.ok) {
        appendUserMessage(sessionId, `[rewind] failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      if (!r.data.ok) {
        appendUserMessage(sessionId, `[rewind] rejected: ${r.data.reason ?? 'unknown'}`);
        return;
      }
      if (r.data.diskRewound === false) {
        appendUserMessage(sessionId, '[rewind] rejected: disk history was not rewound');
        return;
      }
      state.rewindSessionBuffers(sessionId, rewindPastTurnIdx);
      appendUserMessage(sessionId, `[rewind] rewound to turn ${rewindPastTurnIdx}`);
      return;
    }

    if (action === 'list-skills') {
      if (!window.kodaxSpace || !currentProjectPath) {
        appendUserMessage(sessionId, '[skills] no project / IPC unavailable');
        return;
      }
      const [skillsResult, commandsResult] = await Promise.all([
        invokeComposerIpc('skill.discover', {
          projectRoot: currentProjectPath,
          forceReload: true,
        }),
        invokeComposerIpc('slash.discover', undefined),
      ]);
      if (!skillsResult.ok) {
        appendUserMessage(
          sessionId,
          `[skills] discover failed: ${skillsResult.error?.message ?? 'unknown'}`,
        );
        return;
      }
      const commands = commandsResult.ok ? commandsResult.data.commands : [];
      const lines = [`[skills] ${skillsResult.data.skills.length} skill(s):`];
      if (skillsResult.data.skills.length === 0) lines.push('  none found');
      for (const skill of skillsResult.data.skills.slice(0, 40)) {
        const hint = skill.argumentHint ? ` ${skill.argumentHint}` : '';
        lines.push(`  ${safeSkillSlashText(skill.name, commands)}${hint}  ${skill.description}`);
      }
      if (skillsResult.data.skills.length > 40) {
        lines.push(`  ... ${skillsResult.data.skills.length - 40} more`);
      }
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    appendUserMessage(sessionId, `[unknown action: ${action}]`);
  }

  async function invokeSkill(
    sessionId: string,
    name: string,
    args: string[],
    queueMode: QueueMode = 'interrupt',
  ): Promise<void> {
    if (!window.kodaxSpace) return;
    const result = await invokeComposerIpc('skill.invoke', {
      sessionId,
      skillName: name,
      args,
    });
    if (!result.ok) {
      setErr(
        `${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? t('common.unknownError')}`,
      );
      return;
    }
    const { ok, resolvedPrompt, error } = result.data;
    if (!ok || resolvedPrompt === undefined) {
      setErr(error ?? t('bottom.skillFailed', { name }));
      return;
    }
    const skillEcho = skillSlashEchoText(name, args);
    const queuedLocalId = isStreaming
      ? appendQueuedUserMessage(sessionId, {
          content: skillEcho,
          matchContent: resolvedPrompt,
          queueMode,
        })
      : null;
    if (!queuedLocalId) appendUserMessage(sessionId, skillEcho);
    const sendResult = await invokeComposerIpc('session.send', {
      sessionId,
      prompt: resolvedPrompt,
      queueMode,
      ...(currentProjectPath ? { expectedProjectRoot: currentProjectPath } : {}),
      expectedSurface: currentSurface,
    });
    if (!sendResult.ok) {
      setPendingSend(sessionId, false);
      if (queuedLocalId) removeQueuedUserMessage(sessionId, queuedLocalId);
      else rollbackLastUserMessage(sessionId, skillEcho);
      setErr(
        `${sendResult.error?.code ?? 'ERR_UNKNOWN'}: ${sendResult.error?.message ?? t('common.unknownError')}`,
      );
    } else if (sendResult.data.queued) {
      const acceptedQueueMode = sendResult.data.queueMode ?? queueMode;
      if (queuedLocalId) {
        markQueuedUserMessageAccepted(sessionId, queuedLocalId, sendResult.data.queueId);
      } else {
        const convertedLocalId = convertLastUserMessageToQueued(sessionId, skillEcho, {
          content: skillEcho,
          matchContent: resolvedPrompt,
          queueMode: acceptedQueueMode,
        });
        if (convertedLocalId) {
          markQueuedUserMessageAccepted(sessionId, convertedLocalId, sendResult.data.queueId);
        }
      }
      pushToast(queuedToastText(acceptedQueueMode, t), 'info');
    } else if (queuedLocalId) {
      promoteQueuedUserMessage(sessionId, queuedLocalId);
    }
  }

  async function handleSend(
    queueMode: QueueMode = 'interrupt',
    promptOverride?: string,
  ): Promise<void> {
    if (!window.kodaxSpace) return;
    if (busy) return;
    const promptAtSend = promptOverride ?? prompt;
    const trimmed = promptAtSend.trim();
    const fileRefPrompt = pendingFileReferencePrompt(trimmed, pendingFileRefs);
    const textAndFilePrompt = combinePromptAndFileReferences(trimmed, fileRefPrompt);
    const effectivePrompt =
      textAndFilePrompt !== '' ? textAndFilePrompt : pendingImages.length > 0 ? '(image)' : '';
    if (effectivePrompt === '') return;
    if (trimmed.startsWith('/')) {
      const head = trimmed.slice(1);
      const spaceIdx = head.search(/\s/);
      const token = (spaceIdx === -1 ? head : head.slice(0, spaceIdx)).trim();
      const rest = spaceIdx === -1 ? '' : head.slice(spaceIdx + 1).trim();
      const args =
        rest === ''
          ? []
          : token.toLowerCase() === 'workflow'
            ? tokenizeWorkflowArgs(rest)
            : tokenizeArgs(rest);
      const legacySkillName = parseLegacySkillToken(token);
      setBusy(true);
      let sid: string | null = null;
      try {
        sid = await ensureSession();
      } finally {
        setBusy(false);
      }
      if (!sid) return; // err is already set
      setPrompt('');
      setPendingImages([]);
      setPendingFileRefs([]);
      setImageErr(null);
      if (legacySkillName) {
        setBusy(true);
        setErr(null);
        try {
          await invokeSkill(sid, legacySkillName, args, queueMode);
        } finally {
          setBusy(false);
        }
      } else {
        await execSlashOrSkill(sid, token, args, queueMode);
      }
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const sid = await ensureSession();
      if (!sid) return;
      const partnerSourcesForOverlay =
        currentSurface === 'partner' ? await attachPendingPartnerSourcesForSend(sid) : null;
      if (currentSurface === 'partner' && partnerSourcesForOverlay === null) return;
      const partnerPromptOverlay =
        currentSurface === 'partner' && partnerWorkbenchContext
          ? buildPartnerWorkbenchPrompt({
              projectRoot: currentProjectPath,
              hasSession: Boolean(sid),
              scenarioId: partnerWorkbenchContext.scenarioId,
              outputPreferenceId: partnerWorkbenchContext.outputPreferenceId,
              targetPath: partnerWorkbenchContext.targetPath,
              sources: partnerSourcesForOverlay ?? partnerWorkbenchContext.sources,
              userBrief: effectivePrompt,
            })
          : undefined;
      const promptForAI = effectivePrompt;
      const queuedLocalId = isStreaming
        ? appendQueuedUserMessage(sid, {
            content: effectivePrompt,
            matchContent: promptForAI,
            queueMode,
          })
        : null;
      if (!queuedLocalId) appendUserMessage(sid, effectivePrompt);
      const imagesAtSend = pendingImages;
      const fileRefsAtSend = pendingFileRefs;
      const artifactsForSend: InputArtifact[] | undefined =
        imagesAtSend.length > 0
          ? imagesAtSend.map((img) => ({
              kind: 'image' as const,
              path: img.path,
              mediaType: img.mediaType,
              source: img.source,
            }))
          : undefined;
      setPrompt('');
      setPendingImages([]);
      setPendingFileRefs([]);
      setImageErr(null);
      // Set an initial title only for untitled sessions.
      const sessNow = useAppStore.getState().sessions.find((s) => s.sessionId === sid);
      if (sessNow && !sessNow.title) {
        const title = deriveTitle(effectivePrompt);
        if (title) {
          void invokeComposerIpc('session.setTitle', { sessionId: sid, title }).then((r) => {
            if (r.ok) upsertSession({ ...sessNow, title });
          });
        }
      }

      // Store real text sends and file-reference-only sends in input history.
      if (trimmed !== '' || fileRefPrompt !== '') {
        appendInputHistory(sid, effectivePrompt);
      }
      setHistoryIdx(-1);
      draftRef.current = '';

      if (!queuedLocalId) setPendingSend(sid, true);
      const restoreFailedSend = (
        result: Extract<IpcResult<ChannelOutput<'session.send'>>, { ok: false }>,
        late: boolean,
      ): void => {
        if (!queuedLocalId) setPendingSend(sid, false);
        if (queuedLocalId) removeQueuedUserMessage(sid, queuedLocalId);
        else rollbackLastUserMessage(sid, promptForAI);
        if (!late) {
          setPrompt(promptAtSend);
          draftRef.current = promptAtSend;
        } else {
          setPrompt((current) => (current.length === 0 ? promptAtSend : current));
          if (draftRef.current.length === 0) draftRef.current = promptAtSend;
        }
        if (imagesAtSend.length > 0) {
          setPendingImages((prev) => (prev.length === 0 ? imagesAtSend : prev));
        }
        if (fileRefsAtSend.length > 0) {
          setPendingFileRefs((prev) => (prev.length === 0 ? fileRefsAtSend : prev));
        }
        setErr(
          `${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? t('common.unknownError')}`,
        );
      };

      const acceptSendResult = (data: ChannelOutput<'session.send'>, late: boolean): void => {
        if (late) {
          setErr(null);
          pushToast(t('bottom.sendAcceptedInBackground'), 'info');
        }
        if (data.queued) {
          // The turn is already running; main accepted the prompt into the requested
          // queue mode. Keep the current spinner and show a toast.
          const acceptedQueueMode = data.queueMode ?? queueMode;
          if (queuedLocalId) {
            markQueuedUserMessageAccepted(sid, queuedLocalId, data.queueId);
          } else {
            const convertedLocalId = convertLastUserMessageToQueued(sid, effectivePrompt, {
              content: effectivePrompt,
              matchContent: promptForAI,
              queueMode: acceptedQueueMode,
            });
            if (convertedLocalId) {
              markQueuedUserMessageAccepted(sid, convertedLocalId, data.queueId);
            }
          }
          pushToast(queuedToastText(acceptedQueueMode, t), 'info');
        } else if (queuedLocalId) {
          promoteQueuedUserMessage(sid, queuedLocalId);
        }
      };

      const sendPayload: ChannelInput<'session.send'> = {
        sessionId: sid,
        prompt: promptForAI,
        queueMode,
        ...(currentProjectPath ? { expectedProjectRoot: currentProjectPath } : {}),
        expectedSurface: currentSurface,
        ...(partnerPromptOverlay ? { partnerPromptOverlay } : {}),
        ...(artifactsForSend ? { artifacts: artifactsForSend } : {}),
      };
      const result = await invokeComposerIpc('session.send', sendPayload, {
        onLateResult: (lateResult) => {
          if (lateResult.ok) acceptSendResult(lateResult.data, true);
          else restoreFailedSend(lateResult, true);
        },
      });
      if (!result.ok) {
        if (isComposerTimeoutResult(result)) {
          setErr(result.error.message);
          return;
        }
        restoreFailedSend(result, false);
      } else {
        acceptSendResult(result.data, false);
      }
    } finally {
      setBusy(false);
    }
  }

  handleSendRef.current = handleSend;

  function onSlashPick(item: SlashPickerItem | null): void {
    if (item === null) {
      if (activeSlash) {
        setDismissedSlash({ start: activeSlash.start, query: activeSlash.query });
      }
      return;
    }
    // Insert the selected command into the composer so the user can add arguments.
    const insertText =
      item.kind === 'workflow'
        ? item.insertText
        : item.kind === 'slash-arg'
          ? item.insertText
          : item.kind === 'skill'
            ? item.insertText
            : `/${item.meta.name} `;
    const replacement =
      activeSlash !== null
        ? replaceActiveSlashCompletion(prompt, activeSlash, insertText)
        : { text: insertText, caret: insertText.length };
    setDismissedSlash(null);
    setPrompt(replacement.text);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(replacement.caret, replacement.caret);
        setCaret(replacement.caret);
      }
    });
  }

  function handleCancel(): void {
    const sid = currentSessionId;
    if (!sid || !window.kodaxSpace) return;
    // #13 fix: session.cancel 是异步 IPC——结果回来时用户可能已经切到别的 session。之前的
    // toast 只有 "Stop signal sent"/"Cancel failed"，看不出说的是哪个 session，容易被
    // 误当成"当前 session 出错了"。带上 session 标题消歧义。
    const sessionTitle =
      useAppStore.getState().sessions.find((s) => s.sessionId === sid)?.title ??
      t('bottom.thisSession');
    appendEvent({
      kind: 'session_error',
      sessionId: sid,
      error: 'cancelled',
      category: 'cancelled',
      retriable: true,
    });
    pushToast(t('bottom.stopSignalSent', { session: sessionTitle }), 'info', 2000);

    void window.kodaxSpace
      .invoke('session.cancel', { sessionId: sid })
      .then((r) => {
        if (!r.ok) {
          pushToast(
            t('bottom.cancelFailed', {
              session: sessionTitle,
              message: r.error?.message ?? t('common.unknownError'),
            }),
            'error',
          );
        }
      })
      .catch((err: unknown) => {
        pushToast(
          t('bottom.cancelFailed', {
            session: sessionTitle,
            message: err instanceof Error ? err.message : t('common.unknownError'),
          }),
          'error',
        );
      });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Escape' && isStreaming && !slashMode && !attachOpen) {
      e.preventDefault();
      handleCancel();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (busy) {
        e.preventDefault();
        return;
      }
      const queueMode: QueueMode = e.ctrlKey || e.metaKey ? 'after-turn' : 'interrupt';
      e.preventDefault();
      void handleSend(queueMode);
      return;
    }

    // Browse input history only at the first/last textarea line.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && inputHistory.length > 0) {
      const ta = e.currentTarget;
      const value = ta.value;
      const caret = ta.selectionStart ?? 0;
      const firstLineEnd = value.indexOf('\n');
      const isOnFirstLine = firstLineEnd === -1 || caret <= firstLineEnd;
      const isOnLastLine = caret >= value.lastIndexOf('\n') + 1 || value.indexOf('\n') === -1;

      if (e.key === 'ArrowUp' && isOnFirstLine) {
        if (historyIdx === -1) draftRef.current = value;
        const nextIdx = historyIdx === -1 ? inputHistory.length - 1 : Math.max(0, historyIdx - 1);
        e.preventDefault();
        setHistoryIdx(nextIdx);
        setPrompt(inputHistory[nextIdx]);
        return;
      }
      if (e.key === 'ArrowDown' && isOnLastLine && historyIdx !== -1) {
        e.preventDefault();
        if (historyIdx + 1 >= inputHistory.length) {
          setHistoryIdx(-1);
          setPrompt(draftRef.current);
        } else {
          const nextIdx = historyIdx + 1;
          setHistoryIdx(nextIdx);
          setPrompt(inputHistory[nextIdx]);
        }
        return;
      }
    }

    if (historyIdx !== -1 && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setHistoryIdx(-1);
    }
  }

  const isStreaming = useIsStreaming();
  const mascotInputActive =
    prompt.trim().length > 0 || pendingImages.length > 0 || pendingFileRefs.length > 0;
  const mascotInputActivityKey = `${prompt.length}:${pendingImages.length}:${pendingFileRefs.length}`;
  // Send is enabled for text, inline images, or pending file references.
  const canSend =
    !busy &&
    !isStreaming &&
    !!currentProjectPath &&
    (prompt.trim().length > 0 || pendingImages.length > 0 || pendingFileRefs.length > 0);
  const sendButtonTitle = canSend
    ? t('bottom.sendTitle.ready')
    : !currentProjectPath
      ? t('bottom.openFolderFirst')
      : busy
        ? t('bottom.sendTitle.busy')
        : t('bottom.sendTitle.empty');
  const partnerModeLabel =
    currentSurface === 'partner' && partnerWorkbenchContext
      ? t(getPartnerWorkbenchScenario(partnerWorkbenchContext.scenarioId).labelKey)
      : 'Partner';
  const placeholderText = !currentProjectPath
    ? t('bottom.placeholder.openFolder')
    : currentSurface === 'partner'
      ? currentSessionId
        ? t('bottom.placeholder.partnerWithSession', { mode: partnerModeLabel })
        : t('bottom.placeholder.partnerNewSession', { mode: partnerModeLabel })
      : currentSessionId
        ? t('bottom.placeholder.withSession')
        : t('bottom.placeholder.newSession');

  return (
    <div
      className="ix-zone px-3 pt-1 pb-3 flex-shrink-0 space-y-1"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {err && <div className="text-danger text-xs font-mono px-1">{err}</div>}

      <NotificationsSurface />

      <RetryBanner />

      <div className="relative">
        {mascotMode === 'legacy' && (
          <KodaXDogMascot
            className="pointer-events-none absolute -top-1 right-4 z-10 h-7 w-[35px] opacity-90 drop-shadow-[0_4px_6px_rgb(0_0_0_/_0.10)]"
            inputActive={mascotInputActive}
            working={busy || isStreaming}
          />
        )}
        {mascotMode === 'sprite' && (
          <KodaXDogSpriteMascot
            className="pointer-events-none absolute -top-[39px] right-3 z-10 h-10 w-10 opacity-90 drop-shadow-[0_4px_6px_rgb(0_0_0_/_0.10)]"
            inputActive={mascotInputActive}
            inputActivityKey={mascotInputActivityKey}
            working={busy || isStreaming}
          />
        )}

        <div
          onMouseDownCapture={(e) => focusComposerFromContainer(e.target)}
          className={[
            'glass lift rounded-2xl border bg-surface-2 px-3 pt-2 pb-2 space-y-1.5 transition-colors',
            draggingFiles
              ? 'border-accent/70 bg-accent/5'
              : 'border-border-default focus-within:border-accent/50',
          ].join(' ')}
        >
          <ChipBar />

          {(pendingImages.length > 0 || pendingFileRefs.length > 0 || imageErr) && (
            <div className="space-y-1">
              {pendingImages.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {pendingImages.map((img, idx) => (
                    <div
                      key={img.path}
                      className="group relative inline-flex items-center gap-1.5 bg-surface-3 border border-border-default rounded-md pl-1 pr-1.5 py-0.5 text-xs text-fg-secondary"
                      title={`${img.label} - ${formatBytes(img.bytes)}`}
                    >
                      <img
                        src={img.dataUrl}
                        alt={img.label}
                        className="w-7 h-7 rounded object-cover flex-shrink-0"
                      />
                      <span className="max-w-[120px] truncate">{img.label}</span>
                      <span className="text-fg-muted">{formatBytes(img.bytes)}</span>
                      <button
                        type="button"
                        onClick={() => removePendingImage(idx)}
                        className="ml-0.5 w-4 h-4 rounded-full text-fg-muted hover:bg-hover-bg hover:text-fg-primary flex items-center justify-center leading-none"
                        aria-label={t('bottom.removeAttachment', { name: img.label })}
                        title={t('bottom.remove')}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {pendingFileRefs.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {pendingFileRefs.map((file, idx) => {
                    const Icon = file.kind === 'directory' ? Folder : FileText;
                    const detail =
                      file.scope === 'project'
                        ? file.reference
                        : compactPathForDisplay(file.path, 54);
                    return (
                      <div
                        key={`${file.path}:${idx}`}
                        className="group inline-flex min-w-0 max-w-full items-center gap-1.5 bg-surface-3 border border-border-default rounded-md px-1.5 py-1 text-xs text-fg-secondary"
                        title={`${file.path}${file.bytes !== undefined ? ` - ${formatBytes(file.bytes)}` : ''}`}
                      >
                        <Icon className="w-3.5 h-3.5 text-fg-muted flex-shrink-0" />
                        <span className="min-w-0 max-w-[220px]">
                          <span className="block truncate font-medium text-fg-secondary">
                            {file.name}
                          </span>
                          <span className="block truncate text-[11px] text-fg-muted">{detail}</span>
                        </span>
                        {file.bytes !== undefined && (
                          <span className="shrink-0 text-fg-muted">{formatBytes(file.bytes)}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => removePendingFileRef(idx)}
                          className="ml-0.5 w-4 h-4 rounded-full text-fg-muted hover:bg-hover-bg hover:text-fg-primary flex items-center justify-center leading-none"
                          aria-label={t('bottom.removeAttachment', { name: file.name })}
                          title={t('bottom.remove')}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {imageErr && <div className="text-xs text-warn">{imageErr}</div>}
            </div>
          )}

          <div className="relative">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
                // Best-effort: warm repo-intel during the typing window (once per project).
                maybePrewarmRepoIntel(e.target.value, currentProjectPath);
              }}
              onSelect={(e) => {
                setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0);
              }}
              onClick={(e) => {
                setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0);
              }}
              onKeyDown={(e) => {
                if (slashKeyHandlerRef.current) {
                  const consumed = slashKeyHandlerRef.current(e.nativeEvent);
                  if (consumed) {
                    return;
                  }
                }
                if (atPathKeyHandlerRef.current) {
                  const consumed = atPathKeyHandlerRef.current(e.nativeEvent);
                  if (consumed) {
                    return;
                  }
                }
                onKeyDown(e);
                requestAnimationFrame(() => {
                  const ta = textareaRef.current;
                  if (ta) setCaret(ta.selectionStart ?? 0);
                });
              }}
              onPaste={(e) => {
                if (busy) {
                  e.preventDefault();
                  return;
                }
                const data = e.clipboardData;
                if (!data) return;
                const images = clipboardImageFiles(data);
                if (images.length > 0) {
                  e.preventDefault();
                  void attachImages(images, 'clipboard');
                  return;
                }
                if (!shouldTryNativeClipboardImageFallback(data)) return;
                e.preventDefault();
                void attachNativeClipboardImage();
              }}
              aria-disabled={busy}
              readOnly={busy}
              rows={2}
              placeholder={placeholderText}
              className={`w-full bg-transparent text-sm text-fg-primary placeholder-fg-muted resize-none focus:outline-none px-0.5 py-1 pr-28 ${
                busy ? 'opacity-70 cursor-wait' : ''
              }`}
            />
            <div className="absolute right-1 bottom-1 pointer-events-auto flex items-center gap-2">
              <QueueIndicator />
            </div>
            {slashMode && activeSlash && (
              <SlashCommandPopover
                query={activeSlash.query}
                onPick={onSlashPick}
                registerKeyHandler={(h) => {
                  slashKeyHandlerRef.current = h;
                }}
              />
            )}
            {!slashMode && (
              <AtPathPopover
                text={prompt}
                caret={caret}
                projectRoot={currentProjectPath}
                onAccept={(replacement, tokenStart, tokenEnd) => {
                  const next = prompt.slice(0, tokenStart) + replacement + prompt.slice(tokenEnd);
                  setPrompt(next);
                  const newCaret = tokenStart + replacement.length;
                  requestAnimationFrame(() => {
                    const live = textareaRef.current;
                    if (!live) return;
                    live.focus();
                    try {
                      live.setSelectionRange(newCaret, newCaret);
                    } catch {
                      /* ignore */
                    }
                    setCaret(newCaret);
                  });
                }}
                registerKeyHandler={(h) => {
                  atPathKeyHandlerRef.current = h;
                }}
              />
            )}
          </div>

          <div
            data-testid="composer-footer-toolbar"
            className="flex min-w-0 flex-wrap items-center gap-2 text-[11px]"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="relative">
                <input
                  ref={fileInputRef}
                  data-testid="file-attachment-input"
                  type="file"
                  multiple
                  className="hidden"
                  tabIndex={-1}
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = '';
                    void attachLocalFiles(files, 'file-picker');
                  }}
                />
                <button
                  type="button"
                  onClick={() => setAttachOpen((v) => !v)}
                  className="w-6 h-6 rounded-md text-fg-muted hover:bg-hover-bg hover:text-fg-primary flex items-center justify-center"
                  title={t('bottom.attachCommands')}
                  aria-label={t('bottom.openAttachMenu')}
                >
                  <Plus className="w-4 h-4" />
                </button>
                <AttachMenu
                  open={attachOpen}
                  onClose={() => setAttachOpen(false)}
                  onAddFiles={() => {
                    const input = fileInputRef.current;
                    if (!input) return;
                    input.value = '';
                    input.click();
                  }}
                  onAddFolder={() => void attachFolder()}
                  onInsertText={(text) => setPrompt((p) => (p ? `${p} ${text}` : text))}
                />
              </div>
              {currentSurface !== 'partner' && <AgentPicker insertAtCaret={insertAtCaret} />}
              <ModeSelector />
              {currentSurface !== 'partner' && <AgentModeSelector />}
            </div>
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
              <ContextWindowIndicator />
              <ModelEffortSelector />
              {isStreaming ? (
                <button
                  type="button"
                  onClick={() => void handleCancel()}
                  className="ml-1 w-8 h-8 rounded-lg bg-danger hover:brightness-110 text-white flex items-center justify-center shadow-sm transition-[filter]"
                  title={t('bottom.stopTitle')}
                  aria-label={t('bottom.stopGeneration')}
                >
                  <span aria-hidden className="block w-2.5 h-2.5 bg-white rounded-[2px]" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSend('interrupt')}
                  disabled={!canSend}
                  className={[
                    'ml-1 w-8 h-8 rounded-lg flex items-center justify-center disabled:cursor-not-allowed',
                    canSend ? 'btn-accent' : 'bg-surface-3 text-fg-muted',
                  ].join(' ')}
                  title={sendButtonTitle}
                  aria-label={t('bottom.sendMessage')}
                >
                  <ArrowUp className="w-4 h-4" strokeWidth={2.25} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
