// F063 — Workflow 启动器：浏览 built-in + saved 工作流，预检（saved）后从当前 session 发起。
//
// 挂在 workflow popout 顶部（WorkflowPanelConnected）。无 run 时也能从这里发起第一个工作流
// （解决"无 run→无 Section→无入口"的鸡蛋问题：workflow popout 在 CommandToolbar 常驻可达）。

import { useState, type JSX, type ReactNode } from 'react';
import { Play, ChevronDown, ChevronRight, ShieldCheck, RefreshCw, Lock, Bot } from 'lucide-react';
import type { DispatchableAgentListingT } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import { pushToast } from '../../store/toastStore.js';
import { requestConfirm } from '../../store/confirmStore.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import type {} from '../../types/global.js';

interface MetaLite {
  name: string;
  description: string;
  plannedAgents?: number;
  readOnly?: boolean;
}
interface SavedLite {
  name: string;
  path: string;
  description?: string;
}

export function WorkflowLauncher(): JSX.Element {
  const { t } = useI18n();
  const sessionId = useAppStore((s) => s.currentSessionId);
  const projectRoot = useAppStore((s) => s.currentProjectPath);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [builtin, setBuiltin] = useState<MetaLite[]>([]);
  const [saved, setSaved] = useState<SavedLite[]>([]);
  const [agents, setAgents] = useState<DispatchableAgentListingT[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [busyTarget, setBusyTarget] = useState<string | null>(null);

  async function loadLibrary(): Promise<void> {
    setLoading(true);
    try {
      const [r, agentResult] = await Promise.all([
        window.kodaxSpace?.invoke('workflow.library', projectRoot ? { projectRoot } : {}),
        window.kodaxSpace?.invoke('agent.external.dispatchable.list', {
          ...(projectRoot ? { projectRoot } : {}),
          readOnly: true,
        }),
      ]);
      if (r?.ok) {
        setBuiltin(r.data.builtin);
        setSaved(r.data.saved);
      } else {
        pushToast(t('workflow.libraryLoadFailed'), 'warning');
      }
      if (agentResult?.ok) {
        setAgents(agentResult.data.agents);
        setSelectedAgentId((current) =>
          current && agentResult.data.agents.some((entry) => entry.descriptor.agentId === current)
            ? current
            : '',
        );
      } else {
        setAgents([]);
        setSelectedAgentId('');
      }
    } catch {
      pushToast(t('workflow.libraryLoadFailed'), 'warning');
    } finally {
      setLoading(false);
    }
  }

  function toggle(): void {
    const next = !expanded;
    setExpanded(next);
    if (next && builtin.length === 0 && saved.length === 0) void loadLibrary();
  }

  async function launch(
    target: string,
    source: 'builtin' | 'saved',
    savedPath?: string,
  ): Promise<void> {
    if (!sessionId) {
      pushToast(t('workflow.selectSessionBeforeStart'), 'warning');
      return;
    }
    setBusyTarget(target);
    try {
      // saved 先预检；有问题则确认后再启动（built-in 视为可信，跳过）。
      if (source === 'saved' && savedPath) {
        const pf = await window.kodaxSpace?.invoke('workflow.preflight', {
          path: savedPath,
          sessionId,
        });
        if (!pf?.ok) {
          pushToast(
            pf?.error?.message
              ? t('workflow.preflightFailedWithMessage', { message: pf.error.message })
              : t('workflow.preflightFailed'),
            'warning',
          );
          return;
        }
        if (!pf.data.ok && pf.data.issues.length > 0) {
          const msg = pf.data.issues.map((i) => `• ${i.message}`).join('\n');
          // #1 fix: window.confirm 在 Electron sandbox=true 下会夺走 webContents 键盘焦点且拿不回来
          // ——改用应用内 requestConfirm。非破坏性操作（仍然启动，不是删除），不走 danger 样式。
          const proceed = await requestConfirm({
            message: t('workflow.preflightIssuesConfirm', { issues: msg }),
            confirmLabel: t('workflow.start'),
          });
          if (!proceed) return;
        }
      }
      const selectedAgent = agents.find((entry) => entry.descriptor.agentId === selectedAgentId);
      if (selectedAgent) {
        const preflight = await window.kodaxSpace?.invoke('agent.external.preflight', {
          agentId: selectedAgent.descriptor.agentId,
          ...(projectRoot ? { projectRoot } : {}),
          readOnly: true,
          expectedConfigurationRevision: selectedAgent.descriptor.configurationRevision,
        });
        if (!preflight?.ok || !preflight.data.ok) {
          const reason = preflight?.ok
            ? preflight.data.reasons.join('; ')
            : preflight?.error.message;
          pushToast(
            t('workflow.externalAgentPreflightFailed', {
              reason: reason || t('settings.externalAgents.unavailable'),
            }),
            'warning',
          );
          await loadLibrary();
          return;
        }
      }
      const r = await window.kodaxSpace?.invoke('workflow.start', {
        target,
        source,
        sessionId,
        ...(selectedAgent
          ? {
              agentTarget: {
                agentId: selectedAgent.descriptor.agentId,
                expectedConfigurationRevision: selectedAgent.descriptor.configurationRevision,
              },
            }
          : {}),
      });
      if (!r?.ok || !r.data.runId) {
        pushToast(
          r?.ok
            ? (r.data.error ?? t('workflow.startFailed'))
            : (r?.error?.message ?? t('workflow.startFailed')),
          'warning',
        );
        return;
      }
      pushToast(t('workflow.started', { target, runId: r.data.runId }), 'success');
      setExpanded(false);
    } catch (err) {
      pushToast(
        err instanceof Error
          ? t('workflow.startFailedWithMessage', { message: err.message })
          : t('workflow.startFailed'),
        'warning',
      );
    } finally {
      setBusyTarget(null);
    }
  }

  return (
    <div className="mb-2 rounded-lg border border-border-default/70 bg-surface-2">
      <div className="flex items-center pr-1">
        <button
          type="button"
          onClick={toggle}
          className="flex-1 flex items-center gap-1.5 px-2 py-1.5 text-[12px] font-medium text-fg-secondary hover:text-fg-primary"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Play size={12} className="text-accent" />
          {t('workflow.launcherTitle')}
        </button>
        {expanded && (
          <button
            type="button"
            onClick={() => void loadLibrary()}
            title={t('workflow.refreshList')}
            aria-label={t('workflow.refreshListAria')}
            className="w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          {loading && builtin.length === 0 && saved.length === 0 ? (
            <div className="text-[11px] text-fg-muted py-1">{t('artifact.loading')}</div>
          ) : (
            <>
              {agents.length > 0 && (
                <AgentTargetPicker
                  agents={agents}
                  selectedAgentId={selectedAgentId}
                  onSelect={setSelectedAgentId}
                />
              )}
              <LibGroup title={t('workflow.builtin')}>
                {builtin.length === 0 ? (
                  <EmptyHint text={t('workflow.noBuiltin')} />
                ) : (
                  builtin.map((w) => (
                    <LibItem
                      key={w.name}
                      name={w.name}
                      description={w.description}
                      readOnly={w.readOnly}
                      plannedAgents={w.plannedAgents}
                      busy={busyTarget === w.name}
                      onLaunch={() => void launch(w.name, 'builtin')}
                    />
                  ))
                )}
              </LibGroup>
              <LibGroup title={t('workflow.saved')}>
                {saved.length === 0 ? (
                  <EmptyHint text={t('workflow.noSaved')} />
                ) : (
                  saved.map((w) => (
                    <LibItem
                      key={w.path}
                      name={w.name}
                      description={w.description ?? ''}
                      busy={busyTarget === w.path}
                      preflightable
                      onLaunch={() => void launch(w.path, 'saved', w.path)}
                    />
                  ))
                )}
              </LibGroup>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AgentTargetPicker({
  agents,
  selectedAgentId,
  onSelect,
}: {
  readonly agents: readonly DispatchableAgentListingT[];
  readonly selectedAgentId: string;
  readonly onSelect: (agentId: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div data-testid="workflow-agent-target-picker">
      <div className="px-1 pb-1 text-[10px] font-mono uppercase tracking-wide text-fg-faint">
        {t('workflow.agentTarget')}
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onSelect('')}
          aria-pressed={selectedAgentId === ''}
          className={`rounded border px-2 py-1.5 text-left transition-colors ${
            selectedAgentId === ''
              ? 'border-accent/60 bg-accent/10 text-fg-primary'
              : 'border-border-default/60 bg-surface text-fg-secondary hover:bg-surface-3'
          }`}
        >
          <div className="text-[11px] font-medium">{t('workflow.nativeTarget')}</div>
          <div className="text-[10px] text-fg-muted">{t('workflow.nativeTargetDescription')}</div>
        </button>
        {agents.map((entry) => {
          const selected = selectedAgentId === entry.descriptor.agentId;
          return (
            <button
              key={entry.descriptor.agentId}
              type="button"
              onClick={() => onSelect(entry.descriptor.agentId)}
              aria-pressed={selected}
              data-testid="workflow-external-agent-option"
              className={`rounded border px-2 py-1.5 text-left transition-colors ${
                selected
                  ? 'border-info/60 bg-info/10 text-fg-primary'
                  : 'border-border-default/60 bg-surface text-fg-secondary hover:bg-surface-3'
              }`}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-medium">
                <Bot size={11} className="text-info" aria-hidden />
                <span className="truncate">{entry.descriptor.displayName}</span>
                <span className="ml-auto text-[9px] uppercase text-ok">
                  {dispatchabilityLabel(entry.dispatchability.status, t)}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-fg-muted">
                {entry.descriptor.skills.join(', ') || t('workflow.externalTargetNoSkills')}
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-1 px-1 text-[10px] leading-4 text-fg-faint">
        {t('workflow.agentTargetHint')}
      </div>
    </div>
  );
}

function dispatchabilityLabel(
  status: DispatchableAgentListingT['dispatchability']['status'],
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (status) {
    case 'dispatchable':
      return t('settings.externalAgents.dispatchability.dispatchable');
    case 'degraded':
      return t('settings.externalAgents.dispatchability.degraded');
    case 'busy':
      return t('settings.externalAgents.dispatchability.busy');
    case 'unavailable':
      return t('settings.externalAgents.dispatchability.unavailable');
  }
}

function LibGroup({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-wide text-fg-faint px-1 pb-0.5">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }): JSX.Element {
  return <div className="text-[11px] text-fg-muted px-1 py-0.5">{text}</div>;
}

function LibItem({
  name,
  description,
  readOnly,
  plannedAgents,
  preflightable,
  busy,
  onLaunch,
}: {
  name: string;
  description: string;
  readOnly?: boolean;
  plannedAgents?: number;
  preflightable?: boolean;
  busy?: boolean;
  onLaunch: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-1.5 rounded border border-border-default/60 bg-surface p-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-fg-primary truncate" title={name}>
            {name}
          </span>
          {readOnly && (
            <span
              className="inline-flex items-center gap-0.5 text-[9px] text-ok"
              title={t('workflow.readOnlyTitle')}
            >
              <Lock size={9} /> {t('workflow.readOnly')}
            </span>
          )}
          {plannedAgents !== undefined && (
            <span className="text-[9px] font-mono text-fg-faint">
              {t('workflow.plannedAgents', { count: plannedAgents })}
            </span>
          )}
          {preflightable && (
            <ShieldCheck
              size={10}
              className="text-fg-faint"
              aria-label={t('workflow.preflightAria')}
            />
          )}
        </div>
        {description && <div className="text-[10px] text-fg-muted line-clamp-2">{description}</div>}
      </div>
      <button
        type="button"
        onClick={onLaunch}
        disabled={busy}
        title={t('workflow.start')}
        aria-label={t('workflow.launchAria', { name })}
        className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-accent hover:bg-surface-3 disabled:opacity-50"
      >
        <Play size={11} />
      </button>
    </div>
  );
}
