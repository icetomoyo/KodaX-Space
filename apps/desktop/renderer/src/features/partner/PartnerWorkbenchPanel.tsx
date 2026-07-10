import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { PartnerSourceT } from '@kodax-space/space-ipc-schema';
import {
  BarChart3,
  BookOpenCheck,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  Loader2,
  Mail,
  Palette,
  Presentation,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import {
  PARTNER_SOURCES_CHANGED_EVENT,
  PARTNER_WORKBENCH_OUTPUT_PREFERENCES,
  PARTNER_WORKBENCH_SCENARIOS,
  buildPartnerWorkbenchContextDetail,
  defaultPartnerWorkbenchTargetPath,
  inferPartnerWorkbenchRoute,
  isFileProposalOutput,
  publishPartnerWorkbenchContext,
  readPartnerPendingSources,
  type PartnerWorkbenchPendingSourceRef,
  type PartnerWorkbenchOutputPreferenceId,
  type PartnerWorkbenchScenarioId,
} from './partnerWorkbench.js';

const LS_KEY_COLLAPSED = 'kodax-space.partnerWorkbenchCollapsed';

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LS_KEY_COLLAPSED) === '1';
  } catch {
    return false;
  }
}

function persistCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(LS_KEY_COLLAPSED, collapsed ? '1' : '0');
  } catch {
    // Preference persistence is optional.
  }
}

function scenarioIcon(scenarioId: PartnerWorkbenchScenarioId): LucideIcon {
  switch (scenarioId) {
    case 'finance':
      return TrendingUp;
    case 'data-analysis':
      return BarChart3;
    case 'deep-research':
      return Search;
    case 'product-management':
      return FolderKanban;
    case 'presentation':
      return Presentation;
    case 'design':
      return Palette;
    case 'email-editing':
      return Mail;
    default:
      return FileText;
  }
}

function outputIcon(outputId: PartnerWorkbenchOutputPreferenceId): LucideIcon {
  switch (outputId) {
    case 'auto':
      return Sparkles;
    case 'xlsx':
      return FileSpreadsheet;
    case 'pptx':
      return Presentation;
    default:
      return FileText;
  }
}

export function PartnerWorkbenchPanel(): JSX.Element {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [scenarioId, setScenarioId] = useState<PartnerWorkbenchScenarioId>('document-processing');
  const [outputPreferenceId, setOutputPreferenceId] =
    useState<PartnerWorkbenchOutputPreferenceId>('auto');
  const [targetPath, setTargetPath] = useState('');
  const [sources, setSources] = useState<readonly PartnerSourceT[]>([]);
  const [pendingSources, setPendingSources] = useState<readonly PartnerWorkbenchPendingSourceRef[]>(
    () => readPartnerPendingSources(useAppStore.getState().currentProjectPath),
  );
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const loadSources = useCallback((): (() => void) | void => {
    const bridge = window.kodaxSpace;
    if (!bridge || !currentSessionId || !currentProjectPath) {
      setSources([]);
      setLoadingSources(false);
      setSourceError(null);
      return;
    }
    let alive = true;
    setLoadingSources(true);
    setSourceError(null);
    bridge
      .invoke('partner.sources.list', {
        sessionId: currentSessionId,
        projectRoot: currentProjectPath,
      })
      .then((result) => {
        if (!alive) return;
        if (result.ok) {
          setSources(result.data.sources);
        } else {
          setSources([]);
          setSourceError(result.error.message);
        }
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setSources([]);
        setSourceError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoadingSources(false);
      });
    return () => {
      alive = false;
    };
  }, [currentProjectPath, currentSessionId]);

  useEffect(() => loadSources(), [loadSources]);

  const loadPendingSources = useCallback((): void => {
    setPendingSources(readPartnerPendingSources(currentProjectPath));
  }, [currentProjectPath]);

  useEffect(() => loadPendingSources(), [loadPendingSources]);

  useEffect(() => {
    const onSourcesChanged = (): void => {
      void loadSources();
      loadPendingSources();
    };
    window.addEventListener(PARTNER_SOURCES_CHANGED_EVENT, onSourcesChanged);
    return () => window.removeEventListener(PARTNER_SOURCES_CHANGED_EVENT, onSourcesChanged);
  }, [loadPendingSources, loadSources]);

  const config = useMemo(
    () => ({
      projectRoot: currentProjectPath,
      hasSession: Boolean(currentSessionId),
      scenarioId,
      outputPreferenceId,
      targetPath: outputPreferenceId === 'auto' ? undefined : targetPath,
      sources: sources.map((source) => ({
        id: source.id,
        path: source.path,
        label: source.label,
      })),
      pendingSources,
    }),
    [
      currentProjectPath,
      currentSessionId,
      outputPreferenceId,
      pendingSources,
      scenarioId,
      sources,
      targetPath,
    ],
  );
  const route = useMemo(() => inferPartnerWorkbenchRoute(config), [config]);
  const needsPath = outputPreferenceId !== 'auto' && isFileProposalOutput(route.output.id);
  const sourceCountLabel = t('partner.workbench.sourceCount', {
    count: currentSessionId ? sources.length : pendingSources.length,
  });
  const routedOutputLabel =
    outputPreferenceId === 'auto' ? t('partner.workbench.output.auto') : t(route.output.labelKey);
  const statusText =
    sourceError ??
    (!currentProjectPath
      ? t('partner.workbench.openFolder')
      : `${t('partner.workbench.ready')} · ${sourceCountLabel}`);

  useEffect(() => {
    publishPartnerWorkbenchContext(buildPartnerWorkbenchContextDetail(config));
  }, [config]);

  function updateCollapsed(next: boolean): void {
    setCollapsed(next);
    persistCollapsed(next);
  }

  function chooseScenario(nextScenarioId: PartnerWorkbenchScenarioId): void {
    setScenarioId(nextScenarioId);
    window.dispatchEvent(new Event('kodax-space.focus-textarea'));
    if (outputPreferenceId !== 'auto') {
      const nextRoute = inferPartnerWorkbenchRoute({
        ...config,
        scenarioId: nextScenarioId,
        outputPreferenceId,
      });
      setTargetPath(defaultPartnerWorkbenchTargetPath(nextRoute.task.id, outputPreferenceId));
    }
  }

  function chooseOutputPreference(nextOutputId: PartnerWorkbenchOutputPreferenceId): void {
    setOutputPreferenceId(nextOutputId);
    if (nextOutputId === 'auto') {
      setTargetPath('');
      return;
    }
    setTargetPath(defaultPartnerWorkbenchTargetPath(route.task.id, nextOutputId));
  }

  return (
    <section
      className="border-b border-border-default bg-surface flex-shrink-0 max-h-[34vh] overflow-hidden"
      data-testid="partner-workbench"
    >
      <div className="h-8 px-3 flex items-center gap-2">
        <ClipboardList className="w-3.5 h-3.5 text-accent-ink" strokeWidth={1.75} aria-hidden />
        <span className="text-[12px] font-medium text-fg-primary">
          {t('partner.workbench.workMode')}
        </span>
        <button
          type="button"
          className="ml-auto w-6 h-6 rounded-md inline-flex items-center justify-center text-fg-muted hover:text-fg-primary hover:bg-hover-bg"
          onClick={() => updateCollapsed(!collapsed)}
          title={collapsed ? t('partner.workbench.expand') : t('partner.workbench.collapse')}
          aria-label={collapsed ? t('partner.workbench.expand') : t('partner.workbench.collapse')}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
          ) : (
            <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
          )}
        </button>
      </div>

      {!collapsed && (
        <div className="max-h-[calc(34vh-2rem)] overflow-y-auto px-3 pb-2 flex flex-col gap-2">
          <div>
            <div className="flex flex-wrap gap-1.5" data-testid="partner-workbench-mode-strip">
              {PARTNER_WORKBENCH_SCENARIOS.map((scenario) => {
                const active = scenario.id === scenarioId;
                const Icon = scenarioIcon(scenario.id);
                return (
                  <button
                    key={scenario.id}
                    type="button"
                    onClick={() => chooseScenario(scenario.id)}
                    className={`h-8 max-w-[190px] px-2.5 rounded-md border inline-flex items-center gap-1.5 text-[12px] ${
                      active
                        ? 'border-accent-ink bg-accent-soft text-fg-primary'
                        : 'border-border-default text-fg-secondary hover:bg-hover-bg'
                    }`}
                    title={t(scenario.descriptionKey)}
                    aria-pressed={active}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
                    <span className="truncate">{t(scenario.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5" data-testid="partner-workbench-route-preview">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
              <div
                className="min-w-0 flex items-center gap-1.5 text-fg-secondary"
                title={route.reasons.join(' · ')}
              >
                <Sparkles
                  className="w-3.5 h-3.5 text-accent-ink flex-shrink-0"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="truncate">
                  {t('partner.workbench.autoRoute', {
                    mode: t(route.scenario.labelKey),
                    output: routedOutputLabel,
                  })}
                </span>
              </div>
              <div className="min-w-0 flex items-center gap-1.5 text-fg-secondary">
                {loadingSources ? (
                  <Loader2
                    className="w-3.5 h-3.5 animate-spin text-fg-muted"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                ) : (
                  <ShieldCheck
                    className="w-3.5 h-3.5 text-success"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                )}
                <span className="truncate">{statusText}</span>
              </div>
              <button
                type="button"
                onClick={() => void loadSources()}
                className="w-7 h-7 rounded-md inline-flex items-center justify-center text-fg-muted hover:text-fg-primary hover:bg-hover-bg"
                title={t('partner.workbench.refreshSources')}
                aria-label={t('partner.workbench.refreshSources')}
              >
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setAdvancedOpen(!advancedOpen)}
                className="h-7 px-2 rounded-md inline-flex items-center gap-1.5 text-[11px] text-fg-muted hover:text-fg-primary hover:bg-hover-bg"
                aria-expanded={advancedOpen}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
                <span>{t('partner.workbench.advanced')}</span>
              </button>
            </div>
          </div>

          {advancedOpen && (
            <div className="border-t border-border-default pt-2 grid grid-cols-1 gap-2.5">
              <div className="grid grid-cols-1 gap-1.5 text-[11px] text-fg-muted sm:grid-cols-2">
                <div className="min-w-0">
                  <span className="text-fg-secondary">{t('partner.workbench.capabilities')}</span>
                  <span className="ml-1">{t(route.scenario.capabilitySummaryKey)}</span>
                </div>
                <div className="min-w-0">
                  <span className="text-fg-secondary">{t('partner.workbench.deliverables')}</span>
                  <span className="ml-1">{t(route.scenario.deliverableSummaryKey)}</span>
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[11px] text-fg-muted">
                  {t('partner.workbench.outputPreference')}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {PARTNER_WORKBENCH_OUTPUT_PREFERENCES.map((output) => {
                    const active = output.id === outputPreferenceId;
                    const Icon = outputIcon(output.id);
                    return (
                      <button
                        key={output.id}
                        type="button"
                        onClick={() => chooseOutputPreference(output.id)}
                        className={`h-8 px-2 rounded-md border flex items-center gap-1.5 text-[11px] ${
                          active
                            ? 'border-accent-ink bg-accent-soft text-fg-primary'
                            : 'border-border-default text-fg-secondary hover:bg-hover-bg'
                        }`}
                        aria-pressed={active}
                      >
                        <Icon
                          className="w-3.5 h-3.5 flex-shrink-0"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                        <span className="truncate">{t(output.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-w-0">
                {needsPath ? (
                  <label className="block text-[11px] text-fg-secondary">
                    <span className="mb-1.5 block text-fg-muted">
                      {t('partner.workbench.targetPath')}
                    </span>
                    <input
                      value={targetPath}
                      onChange={(event) => setTargetPath(event.currentTarget.value)}
                      className="w-full h-8 rounded-md border border-border-default bg-surface-2 px-2 text-[11px] text-fg-primary outline-none focus:border-accent-ink"
                      spellCheck={false}
                    />
                  </label>
                ) : (
                  <div className="flex items-start gap-1.5 text-[10px] text-fg-muted leading-snug">
                    <BookOpenCheck
                      className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <span className="min-w-0">{t('partner.workbench.autoRouteHint')}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
