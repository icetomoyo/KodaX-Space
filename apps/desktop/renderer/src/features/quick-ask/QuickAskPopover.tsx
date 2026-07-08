import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Send, X, Zap } from 'lucide-react';
import type { SessionEvent, SessionMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import { resolveSessionCreateInputs } from '../../shell/createSession.js';
import { Markdown } from '../session/messages/Markdown.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';

type AskState =
  | { kind: 'idle' }
  | { kind: 'creating-session' }
  | {
      kind: 'streaming';
      sessionId: string;
      prompt: string;
      reply: string;
      session: SessionMeta;
      events: readonly SessionEvent[];
    }
  | {
      kind: 'done';
      sessionId: string;
      prompt: string;
      reply: string;
      session: SessionMeta;
      events: readonly SessionEvent[];
    }
  | { kind: 'error'; message: string; sessionId?: string };

interface QuickAskPopoverProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function QuickAskPopover({ open, onClose }: QuickAskPopoverProps): JSX.Element | null {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<AskState>({ kind: 'idle' });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const runSeqRef = useRef(0);
  const stateRef = useRef<AskState>({ kind: 'idle' });
  const cleanedSessionIdsRef = useRef(new Set<string>());
  const preservedSessionIdsRef = useRef(new Set<string>());

  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const providers = useAppStore((s) => s.providers);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const runtimeDefaults = useAppStore((s) => s.runtimeDefaults);
  const pendingProviderId = useAppStore((s) => s.pendingProviderId);
  const pendingModel = useAppStore((s) => s.pendingModel);
  const pendingReasoningMode = useAppStore((s) => s.pendingReasoningMode);
  const pendingAutoModeEngine = useAppStore((s) => s.pendingAutoModeEngine);
  const pendingAgentMode = useAppStore((s) => s.pendingAgentMode);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!open) return;
    setPrompt('');
    setState({ kind: 'idle' });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    return () => {
      runSeqRef.current += 1;
      void cleanupStateSession(stateRef.current);
    };
    // Cleanup needs the latest mutable stateRef, not the state captured at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void closeAndCleanup();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // closeAndCleanup intentionally reads the latest local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      void closeAndCleanup();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
    // closeAndCleanup intentionally reads the latest local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function sessionIdFromState(snapshot: AskState): string | undefined {
    if (snapshot.kind === 'streaming' || snapshot.kind === 'done') return snapshot.sessionId;
    if (snapshot.kind === 'error') return snapshot.sessionId;
    return undefined;
  }

  async function cleanupTemporarySession(sessionId: string): Promise<void> {
    if (preservedSessionIdsRef.current.has(sessionId)) return;
    if (cleanedSessionIdsRef.current.has(sessionId)) return;
    cleanedSessionIdsRef.current.add(sessionId);
    if (!window.kodaxSpace) return;
    try {
      await window.kodaxSpace.invoke('session.cancel', { sessionId });
      await window.kodaxSpace.invoke('session.delete', { sessionId });
    } catch {
      // Best-effort cleanup; UI closure and follow-up asks should never get stuck here.
    }
  }

  async function cleanupStateSession(snapshot: AskState): Promise<void> {
    const sessionId = sessionIdFromState(snapshot);
    if (sessionId) await cleanupTemporarySession(sessionId);
  }

  async function closeAndCleanup(): Promise<void> {
    runSeqRef.current += 1;
    const snapshot = stateRef.current;
    onClose();
    await cleanupStateSession(snapshot);
  }

  async function handleSend(): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed || !window.kodaxSpace) return;
    if (!currentProjectPath) {
      setState({ kind: 'error', message: t('quickAsk.openProjectFirst') });
      return;
    }

    setPrompt('');
    const runSeq = runSeqRef.current + 1;
    runSeqRef.current = runSeq;
    const isActiveRun = (): boolean => runSeqRef.current === runSeq;
    const setActiveState = (next: AskState): void => {
      if (isActiveRun()) setState(next);
    };

    const previousSessionId = sessionIdFromState(stateRef.current);
    setActiveState({ kind: 'creating-session' });
    if (previousSessionId) {
      await cleanupTemporarySession(previousSessionId);
      if (!isActiveRun()) return;
    }

    const resolved = resolveSessionCreateInputs({
      projectRoot: currentProjectPath,
      providers,
      defaultProviderId,
      kodaxDefaults,
      spaceRuntimeDefaults: runtimeDefaults,
      pendingProviderId,
      pendingReasoningMode,
      pendingPermissionMode: 'plan',
      pendingAutoModeEngine,
      pendingAgentMode,
      pendingModel,
    });

    const createResult = await window.kodaxSpace.invoke('session.create', {
      projectRoot: currentProjectPath,
      provider: resolved.provider,
      ...(resolved.model ? { model: resolved.model } : {}),
      ...resolved.runtimeOverrides,
      surface: 'code',
      ephemeral: true,
    });
    if (!createResult.ok) {
      setActiveState({
        kind: 'error',
        message: createResult.error?.message ?? t('quickAsk.createFailed'),
      });
      return;
    }

    const sessionId = createResult.data.sessionId;
    if (!isActiveRun()) {
      await cleanupTemporarySession(sessionId);
      return;
    }

    const session: SessionMeta = {
      sessionId,
      projectRoot: currentProjectPath,
      provider: resolved.provider,
      ...(resolved.model ? { model: resolved.model } : {}),
      reasoningMode: createResult.data.reasoningMode,
      permissionMode: createResult.data.permissionMode,
      autoModeEngine: createResult.data.autoModeEngine,
      agentMode: createResult.data.agentMode,
      surface: 'code',
      title: t('quickAsk.title'),
      createdAt: createResult.data.createdAt,
      lastActivityAt: createResult.data.createdAt,
    };

    const capturedEvents: SessionEvent[] = [];
    const unsubscribe = window.kodaxSpace.on('session.event', (event) => {
      if (event.sessionId === sessionId) capturedEvents.push(event);
    });

    let reply = '';
    setActiveState({ kind: 'streaming', sessionId, prompt: trimmed, reply, session, events: [] });

    const sendResult = await window.kodaxSpace.invoke('session.send', {
      sessionId,
      prompt: trimmed,
      queueMode: 'interrupt',
      expectedProjectRoot: currentProjectPath,
      expectedSurface: 'code',
    });
    if (!sendResult.ok) {
      unsubscribe();
      setActiveState({
        kind: 'error',
        sessionId,
        message: sendResult.error?.message ?? t('quickAsk.sendFailed'),
      });
      return;
    }

    const startTime = Date.now();
    const pollIntervalMs = 80;
    const timeoutMs = 60_000;

    try {
      while (Date.now() - startTime < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        reply = '';
        let terminal: 'complete' | 'error' | null = null;
        let errorMessage = '';

        for (const event of capturedEvents) {
          if (event.kind === 'text_delta') reply += event.text;
          else if (event.kind === 'session_complete') terminal = 'complete';
          else if (event.kind === 'session_error') {
            terminal = 'error';
            errorMessage = event.error;
          }
        }

        const events = capturedEvents.slice();
        setActiveState({ kind: 'streaming', sessionId, prompt: trimmed, reply, session, events });

        if (terminal === 'complete') {
          setActiveState({ kind: 'done', sessionId, prompt: trimmed, reply, session, events });
          return;
        }
        if (terminal === 'error') {
          setActiveState({ kind: 'error', sessionId, message: errorMessage });
          return;
        }
      }

      setActiveState({
        kind: 'done',
        sessionId,
        prompt: trimmed,
        reply: reply || t('quickAsk.timedOut'),
        session,
        events: capturedEvents.slice(),
      });
    } finally {
      unsubscribe();
    }
  }

  async function continueInCoder(): Promise<void> {
    if (state.kind !== 'done') return;
    const title = state.prompt.replace(/\s+/g, ' ').slice(0, 80) || t('quickAsk.title');
    preservedSessionIdsRef.current.add(state.sessionId);
    if (window.kodaxSpace) {
      try {
        await window.kodaxSpace.invoke('session.promoteEphemeral', {
          sessionId: state.sessionId,
        });
      } catch {
        // The in-memory handoff should still work even if disk promotion is best-effort.
      }
    }
    upsertSession({ ...state.session, title, lastActivityAt: Date.now() });
    setCurrentSession(state.sessionId);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  if (!open) return null;

  const isAsking = state.kind === 'creating-session' || state.kind === 'streaming';
  const exchange = state.kind === 'streaming' || state.kind === 'done' ? state : null;
  const status = quickAskStatus(state, t);

  return (
    <div
      className="fixed inset-x-0 top-12 z-[230] flex pointer-events-none justify-center px-3 sm:top-14"
      role="dialog"
      aria-labelledby="quick-ask-title"
    >
      <div
        ref={panelRef}
        className="app-no-drag pointer-events-auto flex max-h-[min(78vh,720px)] w-[min(720px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border border-border-default bg-surface-4/95 shadow-2xl lift backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border-default px-4 py-3">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent/15 text-accent-ink">
            <Zap className="h-4 w-4" strokeWidth={2} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="quick-ask-title" className="truncate text-sm font-semibold text-fg-primary">
              {t('quickAsk.title')}
            </h2>
            <div className="truncate font-mono text-[11px] text-fg-muted">
              {t('quickAsk.subtitle')}
            </div>
          </div>
          {status && (
            <div className="ml-auto hidden max-w-[240px] items-center gap-1.5 truncate rounded-md border border-border-default bg-surface-3/70 px-2 py-1 font-mono text-[11px] text-fg-secondary sm:flex">
              {status.spinning ? (
                <span className="activity-spinner-comet" aria-hidden />
              ) : (
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${status.dotClass}`} />
              )}
              <span className="truncate">{status.label}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => void closeAndCleanup()}
            className={`${status ? '' : 'ml-auto'} flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover-bg hover:text-fg-primary`}
            aria-label={t('quickAsk.closeAria')}
            title={t('quickAsk.closeTitle')}
          >
            <X className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="rounded-md border border-border-default bg-surface-3/50 px-3 py-2 focus-within:border-accent/50">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={isAsking}
              rows={3}
              placeholder={
                currentProjectPath
                  ? t('quickAsk.placeholder.ready')
                  : t('quickAsk.placeholder.noProject')
              }
              className="block max-h-32 min-h-[72px] w-full resize-none bg-transparent text-sm text-fg-primary placeholder-fg-muted focus:outline-none disabled:opacity-50"
            />
          </div>

          {exchange && (
            <div className="mt-3 border-t border-border-default pt-3">
              <div className="mb-1 font-mono text-[11px] text-fg-muted">
                {t('quickAsk.promptLabel')}
              </div>
              <div className="whitespace-pre-wrap break-words text-sm text-fg-primary">
                {exchange.prompt}
              </div>
            </div>
          )}

          {exchange && (
            <div className="mt-3 border-t border-border-default pt-3">
              {status && (
                <div className="mb-2 flex items-center gap-2 font-mono text-[11px] text-fg-secondary">
                  {status.spinning ? (
                    <span className="activity-spinner-comet" aria-hidden />
                  ) : (
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${status.dotClass}`} />
                  )}
                  <span>{status.label}</span>
                  {state.kind === 'streaming' && state.events.length > 0 && (
                    <span className="text-fg-muted">
                      {t('quickAsk.eventsCount', { count: state.events.length })}
                    </span>
                  )}
                </div>
              )}
              {exchange.reply.length > 0 ? (
                <Markdown content={exchange.reply} />
              ) : (
                <div className="text-sm text-fg-muted">{t('quickAsk.waitingForAnswer')}</div>
              )}
            </div>
          )}

          {state.kind === 'error' && (
            <div
              className="mt-3 border-t border-danger/60 pt-3 text-xs text-danger"
              role="alert"
            >
              <div className="mb-1 flex items-center gap-2 font-mono text-[11px]">
                <span className="h-2 w-2 flex-shrink-0 rounded-full bg-danger" />
                <span>{t('quickAsk.status.failed')}</span>
              </div>
              {state.message}
            </div>
          )}

          {state.kind === 'creating-session' && status && (
            <div className="mt-3 flex items-center gap-2 border-t border-border-default pt-3 font-mono text-[11px] text-fg-secondary">
              <span className="activity-spinner-comet" aria-hidden />
              <span>{status.label}</span>
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-2 border-t border-border-default px-4 py-2 font-mono text-[11px] text-fg-muted">
          <span className="min-w-0 truncate">{t('quickAsk.footerHint')}</span>
          <div className="ml-auto flex flex-shrink-0 items-center gap-2">
            {state.kind === 'done' && (
              <button
                type="button"
                onClick={() => void continueInCoder()}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-info/50 bg-info/15 px-2.5 text-info hover:bg-info/20"
              >
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                <span>{t('quickAsk.continueInCoder')}</span>
              </button>
            )}
            <button
              type="button"
              disabled={isAsking || !prompt.trim() || !currentProjectPath}
              onClick={() => void handleSend()}
              className="inline-flex h-7 min-w-[86px] items-center justify-center gap-1.5 rounded-md border border-ok/50 bg-ok/15 px-2.5 text-ok hover:bg-ok/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAsking ? (
                <span className="activity-spinner-comet" aria-hidden />
              ) : (
                <Send className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              )}
              <span>{isAsking ? t('quickAsk.asking') : t('quickAsk.ask')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

type QuickAskStatus = {
  readonly label: string;
  readonly spinning: boolean;
  readonly dotClass: string;
};

function quickAskStatus(state: AskState, t: Translate): QuickAskStatus | null {
  if (state.kind === 'creating-session') {
    return {
      label: t('quickAsk.status.creating'),
      spinning: true,
      dotClass: 'bg-warn',
    };
  }

  if (state.kind === 'streaming') {
    const eventStatus = latestStreamingStatus(state.events, t);
    if (eventStatus) return eventStatus;
    return {
      label:
        state.reply.length > 0
          ? t('quickAsk.status.streaming')
          : t('quickAsk.status.waiting'),
      spinning: true,
      dotClass: 'bg-warn',
    };
  }

  if (state.kind === 'done') {
    return {
      label: t('quickAsk.status.done'),
      spinning: false,
      dotClass: 'bg-ok',
    };
  }

  return null;
}

function latestStreamingStatus(
  events: readonly SessionEvent[],
  t: Translate,
): QuickAskStatus | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (
      event.kind === 'tool_start' ||
      event.kind === 'tool_input_delta' ||
      event.kind === 'tool_progress'
    ) {
      return {
        label: t('quickAsk.status.runningTool', {
          tool: toolNameFromEvent(event) ?? t('quickAsk.status.toolFallback'),
        }),
        spinning: true,
        dotClass: 'bg-run',
      };
    }
    if (event.kind === 'thinking_delta' || event.kind === 'thinking_end') {
      return {
        label: t('quickAsk.status.thinking'),
        spinning: true,
        dotClass: 'bg-thinking',
      };
    }
    if (event.kind === 'text_delta') {
      return {
        label: t('quickAsk.status.streaming'),
        spinning: true,
        dotClass: 'bg-warn',
      };
    }
    if (event.kind === 'session_start' || event.kind === 'queued_user_prompt_started') {
      return {
        label: t('quickAsk.status.waiting'),
        spinning: true,
        dotClass: 'bg-warn',
      };
    }
  }
  return null;
}

function toolNameFromEvent(event: SessionEvent): string | undefined {
  const toolName = (event as { readonly toolName?: unknown }).toolName;
  return typeof toolName === 'string' && toolName.length > 0 ? toolName : undefined;
}
