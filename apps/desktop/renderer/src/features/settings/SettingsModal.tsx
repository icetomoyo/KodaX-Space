import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  FileArchive,
  FolderOpen,
  KeyRound,
  Languages,
  Loader2,
  Network,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type {
  DispatchableAgentListingT,
  KodaxConfigOverviewT,
  ExternalAgentRegistrationSummaryT,
  LanguageModeT,
  LicenseStatusT,
  ProviderInfo,
  SupportedLocaleT,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import { localeDisplayName, useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';
import { pushToast } from '../../store/toastStore.js';
import { requestConfirm } from '../../store/confirmStore.js';
import { ProviderCard } from '../provider/ProviderCard.js';
import { CustomProviderForm } from '../provider/CustomProviderForm.js';
import { WorkflowPolicySection } from '../workflow/WorkflowPolicySection.js';
import { setSpaceLanguage } from '../../space-control/semanticActions.js';

export type SettingsTab = 'providers' | 'preferences' | 'runtime' | 'diagnostics' | 'license';

interface SettingsModalProps {
  readonly initialTab?: SettingsTab;
  readonly onTabChange?: (tab: SettingsTab) => void;
  readonly onClose: () => void;
}

interface SettingsTabMeta {
  readonly id: SettingsTab;
  readonly labelKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly Icon: LucideIcon;
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const TABS: readonly SettingsTabMeta[] = [
  {
    id: 'preferences',
    labelKey: 'settings.preferences',
    descriptionKey: 'settings.preferences.description',
    Icon: SlidersHorizontal,
  },
  {
    id: 'providers',
    labelKey: 'settings.providers',
    descriptionKey: 'settings.providers.description',
    Icon: KeyRound,
  },
  {
    id: 'runtime',
    labelKey: 'settings.runtime',
    descriptionKey: 'settings.runtime.description',
    Icon: Database,
  },
  {
    id: 'license',
    labelKey: 'settings.license',
    descriptionKey: 'settings.license.description',
    Icon: ShieldCheck,
  },
  {
    id: 'diagnostics',
    labelKey: 'settings.diagnostics',
    descriptionKey: 'settings.diagnostics.description',
    Icon: FileArchive,
  },
];

export function SettingsModal({
  initialTab = 'preferences',
  onTabChange,
  onClose,
}: SettingsModalProps): JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0];

  function selectTab(next: SettingsTab): void {
    setTab(next);
    onTabChange?.(next);
    window.requestAnimationFrame(() => {
      document.getElementById(`settings-tab-${next}`)?.focus();
    });
  }

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  function handleTabListKeyDown(e: ReactKeyboardEvent<HTMLElement>): void {
    const currentIndex = TABS.findIndex((t) => t.id === tab);
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % TABS.length;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = TABS.length - 1;
    }

    if (nextIndex === null) return;
    e.preventDefault();
    selectTab(TABS[nextIndex].id);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 px-4 py-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      onMouseDown={onClose}
    >
      <div
        className="glass lift ix-zone flex h-[min(780px,calc(100vh-32px))] w-[min(1120px,calc(100vw-32px))] min-h-[560px] overflow-hidden rounded-xl border border-border-default bg-surface-2 text-sm text-fg-primary"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <aside className="flex w-64 shrink-0 flex-col border-r border-border-default bg-surface/55">
          <div className="border-b border-border-default px-4 py-4">
            <div className="mb-1 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-default bg-surface-3 text-accent-ink">
                <Settings2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              </div>
              <div className="min-w-0">
                <h2 id="settings-modal-title" className="text-base font-semibold leading-tight">
                  {t('common.settings')}
                </h2>
                <p className="truncate text-[11px] text-fg-muted">{t('settings.subtitle')}</p>
              </div>
            </div>
          </div>

          <nav
            role="tablist"
            aria-label={t('settings.sections')}
            className="flex-1 space-y-1 px-3 py-3"
            onKeyDown={handleTabListKeyDown}
          >
            {TABS.map((t) => (
              <SettingsNavButton
                key={t.id}
                tab={t}
                label={t.labelKey}
                description={t.descriptionKey}
                active={tab === t.id}
                onClick={() => selectTab(t.id)}
              />
            ))}
          </nav>

          <div className="m-3 rounded-lg border border-border-default bg-surface-2 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-fg-primary">
              <ShieldCheck className="h-3.5 w-3.5 text-ok" strokeWidth={1.8} aria-hidden />
              {t('settings.keySafety.title')}
            </div>
            <p className="text-[11px] leading-5 text-fg-muted">
              {t('settings.keySafety.description')}
            </p>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-[72px] shrink-0 items-center gap-3 border-b border-border-default px-5 py-3">
            <activeTab.Icon className="h-5 w-5 text-fg-secondary" strokeWidth={1.8} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight">{t(activeTab.labelKey)}</div>
              <div className="truncate text-xs text-fg-muted">{t(activeTab.descriptionKey)}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="ix-pop inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
              aria-label={t('settings.close')}
              title={t('settings.close')}
            >
              <X className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto bg-surface/30">
            <div
              id="settings-panel-preferences"
              role="tabpanel"
              aria-labelledby="settings-tab-preferences"
              hidden={tab !== 'preferences'}
              className="h-full"
            >
              <PreferencesPanel />
            </div>
            <div
              id="settings-panel-providers"
              role="tabpanel"
              aria-labelledby="settings-tab-providers"
              hidden={tab !== 'providers'}
              className="h-full"
            >
              <ProvidersPanel />
            </div>
            <div
              id="settings-panel-runtime"
              role="tabpanel"
              aria-labelledby="settings-tab-runtime"
              hidden={tab !== 'runtime'}
              className="h-full"
            >
              <RuntimePanel />
            </div>
            <div
              id="settings-panel-diagnostics"
              role="tabpanel"
              aria-labelledby="settings-tab-diagnostics"
              hidden={tab !== 'diagnostics'}
              className="h-full"
            >
              <DiagnosticsPanel />
            </div>
            <div
              id="settings-panel-license"
              role="tabpanel"
              aria-labelledby="settings-tab-license"
              hidden={tab !== 'license'}
              className="h-full"
            >
              <LicensePanel />
            </div>
          </div>
        </section>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function DiagnosticsPanel(): JSX.Element {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  async function exportDiagnostics(): Promise<void> {
    if (!window.kodaxSpace || busy) return;
    setBusy(true);
    try {
      const result = await window.kodaxSpace.invoke('diagnostics.export', {
        categories: ['manifest', 'logs', 'capabilities', 'release', 'degradations'],
      });
      if (!result.ok) {
        pushToast(t('settings.diagnostics.exportFailed'), 'error');
        return;
      }
      if (result.data.status === 'cancelled') return;
      pushToast(t('settings.diagnostics.exported', { fileName: result.data.fileName }), 'success');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5">
      <SettingsSection
        title={t('settings.diagnostics.title')}
        description={t('settings.diagnostics.description')}
        icon={FileArchive}
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-border-default bg-surface px-3 py-3 text-xs leading-5 text-fg-secondary">
            <div className="font-medium text-fg-primary">
              {t('settings.diagnostics.includesTitle')}
            </div>
            <div className="mt-1">{t('settings.diagnostics.includes')}</div>
          </div>
          <div className="rounded-lg border border-ok/30 bg-ok/8 px-3 py-3 text-xs leading-5 text-fg-muted">
            {t('settings.diagnostics.privacy')}
          </div>
          <button
            type="button"
            onClick={() => void exportDiagnostics()}
            disabled={busy}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-3 px-3 text-xs text-fg-primary hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
            ) : (
              <FileArchive className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
            {t('settings.diagnostics.export')}
          </button>
        </div>
      </SettingsSection>
    </div>
  );
}

function SettingsNavButton({
  tab,
  label,
  description,
  active,
  onClick,
}: {
  readonly tab: SettingsTabMeta;
  readonly label: MessageKey;
  readonly description: MessageKey;
  readonly active: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <button
      id={`settings-tab-${tab.id}`}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`settings-panel-${tab.id}`}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={[
        'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left',
        active
          ? 'border border-border-default bg-surface-3 text-fg-primary shadow-sm'
          : 'border border-transparent text-fg-secondary hover:bg-hover-bg hover:text-fg-primary',
      ].join(' ')}
    >
      <tab.Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-tight">{t(label)}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-fg-muted">{t(description)}</span>
      </span>
    </button>
  );
}

function PreferencesPanel(): JSX.Element {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);

  const [defaultWorkspace, setDefaultWorkspace] = useState('');
  const [originalDefault, setOriginalDefault] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!window.kodaxSpace) return;
    void window.kodaxSpace.invoke('settings.get', {}).then((r) => {
      if (r.ok) {
        setDefaultWorkspace(r.data.defaultWorkspace);
        setOriginalDefault(r.data.defaultWorkspace);
      }
    });
  }, []);

  async function browseFolder(): Promise<void> {
    if (!window.kodaxSpace) return;
    const r = await window.kodaxSpace.invoke('project.openDialog', undefined);
    if (r.ok && r.data.path !== null) {
      setDefaultWorkspace(r.data.path);
      setSaved(false);
    }
  }

  async function save(): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const trimmed = defaultWorkspace.trim();
      if (!trimmed) {
        setErr(t('settings.workspace.emptyError'));
        return;
      }
      const r = await window.kodaxSpace.invoke('settings.setDefaultWorkspace', { path: trimmed });
      if (!r.ok) {
        setErr(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'save failed'}`);
        return;
      }
      if (currentProjectPath === originalDefault) {
        setCurrentProject(r.data.defaultWorkspace);
        await window.kodaxSpace
          .invoke('project.recent.add', { path: r.data.defaultWorkspace })
          .catch(() => {});
        const listR = await window.kodaxSpace.invoke('project.list', undefined);
        if (listR.ok) useAppStore.getState().setProjects(listR.data.projects);
      }
      setOriginalDefault(r.data.defaultWorkspace);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  const changed = defaultWorkspace.trim() !== originalDefault.trim();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5">
      <LanguageSection />

      <SettingsSection
        title={t('settings.workspace.title')}
        description={t('settings.workspace.description')}
        icon={FolderOpen}
      >
        <label
          htmlFor="settings-default-workspace"
          className="block text-[11px] font-medium uppercase tracking-wide text-fg-muted"
        >
          {t('settings.workspace.default')}
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="settings-default-workspace"
            type="text"
            value={defaultWorkspace}
            onChange={(e) => {
              setDefaultWorkspace(e.target.value);
              setSaved(false);
            }}
            className="min-h-9 flex-1 rounded-lg border border-border-default bg-surface px-3 py-2 font-mono text-xs text-fg-primary outline-none focus:border-info"
            placeholder={t('settings.workspace.placeholder')}
            aria-describedby="settings-default-workspace-hint"
          />
          <button
            type="button"
            onClick={() => void browseFolder()}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-3 px-3 text-xs text-fg-primary hover:bg-hover-bg"
            title={t('settings.workspace.browseTitle')}
          >
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
            {t('common.browse')}
          </button>
        </div>
        <div
          id="settings-default-workspace-hint"
          className="mt-2 text-[11px] leading-5 text-fg-muted"
        >
          {t('settings.workspace.hint')}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !changed}
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-ok/50 bg-ok/15 px-3 text-xs font-medium text-ok hover:bg-ok/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />}
            {busy ? t('common.saving') : t('settings.workspace.save')}
          </button>
          {err && <span className="text-xs text-danger">{err}</span>}
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ok">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              {t('common.saved')}
            </span>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('settings.interface.title')}
        description={t('settings.interface.description')}
        icon={SlidersHorizontal}
      >
        <div className="space-y-3">
          <SmartPopoutToggle />
          <NativeCompletionNotificationToggle />
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('settings.workflowHost.title')}
        description={t('settings.workflowHost.description')}
        icon={Settings2}
      >
        <WorkflowPolicySection />
      </SettingsSection>
    </div>
  );
}

type SkillInstallBusy = 'user-directory' | 'user-archive' | 'project-directory' | 'project-archive';

function RuntimePanel(): JSX.Element {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const [overview, setOverview] = useState<KodaxConfigOverviewT | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mcpReloading, setMcpReloading] = useState(false);
  const [installing, setInstalling] = useState<SkillInstallBusy | null>(null);
  const [compactionEnabled, setCompactionEnabled] = useState(true);
  const [triggerPercent, setTriggerPercent] = useState('');
  const [contextWindow, setContextWindow] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function syncCompactionForm(next: KodaxConfigOverviewT): void {
    setCompactionEnabled(next.compaction.enabled ?? true);
    setTriggerPercent(next.compaction.triggerPercent?.toString() ?? '');
    setContextWindow(next.compaction.contextWindow?.toString() ?? '');
  }

  async function refresh(): Promise<void> {
    if (!window.kodaxSpace) return;
    setLoading(true);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('settings.kodaxConfig.get', {
        ...(currentProjectPath ? { projectRoot: currentProjectPath } : {}),
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setOverview(result.data);
      syncCompactionForm(result.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectPath]);

  async function saveCompaction(): Promise<void> {
    if (!window.kodaxSpace) return;
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const trigger = parseOptionalInt(
        triggerPercent,
        t('settings.compaction.triggerPercent'),
        1,
        100,
        t,
      );
      const windowTokens = parseOptionalInt(
        contextWindow,
        t('settings.compaction.contextWindow'),
        1024,
        10_000_000,
        t,
      );
      const result = await window.kodaxSpace.invoke('settings.kodaxConfig.setCompaction', {
        ...(currentProjectPath ? { projectRoot: currentProjectPath } : {}),
        compaction: {
          enabled: compactionEnabled,
          ...(trigger !== undefined ? { triggerPercent: trigger } : {}),
          ...(windowTokens !== undefined ? { contextWindow: windowTokens } : {}),
        },
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setOverview(result.data);
      syncCompactionForm(result.data);
      setSaved(true);
      pushToast(t('settings.compaction.saved'), 'success', 1800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function reloadMcp(): Promise<void> {
    if (!window.kodaxSpace) return;
    setMcpReloading(true);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('mcp.reload', {
        ...(currentProjectPath ? { projectRoot: currentProjectPath } : {}),
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      pushToast(
        t('settings.mcp.reloaded', { count: result.data.serverCount }),
        result.data.ok ? 'success' : 'warning',
        1800,
      );
      await refresh();
    } finally {
      setMcpReloading(false);
    }
  }

  async function installSkill(
    source: 'directory' | 'archive',
    target: 'user' | 'project',
  ): Promise<void> {
    if (!window.kodaxSpace) return;
    if (target === 'project' && !currentProjectPath) {
      setErr(t('settings.skills.projectUnavailable'));
      return;
    }
    const busyKey = `${target}-${source}` as SkillInstallBusy;
    setInstalling(busyKey);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('skill.install', {
        source,
        target,
        ...(target === 'project' && currentProjectPath ? { projectRoot: currentProjectPath } : {}),
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      if (result.data.cancelled) return;
      if (currentProjectPath) {
        await window.kodaxSpace
          .invoke('skill.discover', { projectRoot: currentProjectPath, forceReload: true })
          .catch(() => undefined);
      }
      pushToast(
        t('settings.skills.installed', { name: result.data.name ?? 'skill' }),
        'success',
        2200,
      );
      await refresh();
    } finally {
      setInstalling(null);
    }
  }

  const projectConfigLabel = overview?.mcp.projectPath ?? t('settings.runtime.none');
  const projectSkillDir = overview?.skills.projectSkillsDir ?? t('settings.runtime.none');

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5">
      {err && (
        <div className="rounded-lg border border-danger/40 bg-danger/12 px-3 py-2 text-xs text-danger">
          {err}
        </div>
      )}

      <ExternalAgentsSection projectRoot={currentProjectPath ?? undefined} />

      <SettingsSection
        title={t('settings.kodaxConfig.title')}
        description={t('settings.kodaxConfig.description')}
        icon={Database}
      >
        <div className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
          <RuntimeField
            label={t('settings.kodaxConfig.configPath')}
            value={overview?.configPath ?? t('common.loading')}
            mono
            wide
          />
          <RuntimeField
            label={t('settings.kodaxConfig.configExists')}
            value={
              overview
                ? overview.configExists
                  ? t('settings.runtime.yes')
                  : t('settings.runtime.no')
                : t('common.loading')
            }
          />
          <RuntimeField
            label={t('settings.kodaxConfig.scope')}
            value={t('settings.kodaxConfig.sharedScope')}
            wide
          />
        </div>
        {loading && !overview && (
          <div className="mt-3 inline-flex items-center gap-2 text-xs text-fg-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
            {t('common.loading')}
          </div>
        )}
        {overview && overview.errors.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-border-default pt-3">
            {overview.errors.map((item) => (
              <div key={`${item.path}-${item.error}`} className="text-xs leading-5 text-warn">
                <span className="font-mono">{item.path}</span>: {item.error}
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title={t('settings.compaction.title')}
        description={t('settings.compaction.description')}
        icon={Archive}
      >
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={compactionEnabled}
            onChange={(e) => {
              setCompactionEnabled(e.target.checked);
              setSaved(false);
            }}
            className="mt-1 h-4 w-4 accent-ok"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-fg-primary">
              {t('settings.compaction.enabled')}
            </span>
            <span className="mt-1 block text-xs leading-5 text-fg-muted">
              {t('settings.compaction.enabledHint')}
            </span>
          </span>
        </label>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">
              {t('settings.compaction.triggerPercent')}
            </span>
            <input
              type="number"
              min={1}
              max={100}
              value={triggerPercent}
              onChange={(e) => {
                setTriggerPercent(e.target.value);
                setSaved(false);
              }}
              placeholder="75"
              className="mt-2 h-9 w-full rounded-lg border border-border-default bg-surface px-3 text-xs text-fg-primary outline-none focus:border-info"
            />
            <span className="mt-1 block text-[11px] leading-5 text-fg-muted">
              {t('settings.compaction.triggerPercentHint')}
            </span>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">
              {t('settings.compaction.contextWindow')}
            </span>
            <input
              type="number"
              min={1024}
              max={10_000_000}
              value={contextWindow}
              onChange={(e) => {
                setContextWindow(e.target.value);
                setSaved(false);
              }}
              placeholder={t('settings.compaction.contextWindowPlaceholder')}
              className="mt-2 h-9 w-full rounded-lg border border-border-default bg-surface px-3 text-xs text-fg-primary outline-none focus:border-info"
            />
            <span className="mt-1 block text-[11px] leading-5 text-fg-muted">
              {t('settings.compaction.contextWindowHint')}
            </span>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void saveCompaction()}
            disabled={saving}
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-ok/50 bg-ok/15 px-3 text-xs font-medium text-ok hover:bg-ok/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />}
            {saving ? t('common.saving') : t('settings.compaction.save')}
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ok">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              {t('common.saved')}
            </span>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('settings.mcp.title')}
        description={t('settings.mcp.description')}
        icon={Network}
      >
        <div className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
          <RuntimeField
            label={t('settings.mcp.globalConfig')}
            value={overview?.mcp.globalPath ?? t('common.loading')}
            mono
          />
          <RuntimeField label={t('settings.mcp.projectConfig')} value={projectConfigLabel} mono />
          <RuntimeField
            label={t('settings.mcp.globalServers')}
            value={overview ? String(overview.mcp.globalServers) : t('common.loading')}
          />
          <RuntimeField
            label={t('settings.mcp.projectServers')}
            value={overview ? String(overview.mcp.projectServers) : t('common.loading')}
          />
          <RuntimeField
            label={t('settings.mcp.recommendationLabel')}
            value={t('settings.mcp.recommendation')}
            wide
          />
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void reloadMcp()}
            disabled={mcpReloading}
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-3 px-3 text-xs text-fg-primary hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${mcpReloading ? 'animate-spin' : ''}`}
              strokeWidth={1.8}
            />
            {t('settings.mcp.reload')}
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('settings.skills.title')}
        description={t('settings.skills.description')}
        icon={FileArchive}
      >
        <div className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
          <RuntimeField
            label={t('settings.skills.userDir')}
            value={overview?.skills.userSkillsDir ?? t('common.loading')}
            mono
          />
          <RuntimeField label={t('settings.skills.projectDir')} value={projectSkillDir} mono />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <SkillInstallButton
            label={t('settings.skills.installUserFolder')}
            busy={installing === 'user-directory'}
            icon={FolderOpen}
            onClick={() => void installSkill('directory', 'user')}
          />
          <SkillInstallButton
            label={t('settings.skills.installUserZip')}
            busy={installing === 'user-archive'}
            icon={Upload}
            onClick={() => void installSkill('archive', 'user')}
          />
          <SkillInstallButton
            label={t('settings.skills.installProjectFolder')}
            busy={installing === 'project-directory'}
            icon={FolderOpen}
            disabled={!currentProjectPath}
            onClick={() => void installSkill('directory', 'project')}
          />
          <SkillInstallButton
            label={t('settings.skills.installProjectZip')}
            busy={installing === 'project-archive'}
            icon={Upload}
            disabled={!currentProjectPath}
            onClick={() => void installSkill('archive', 'project')}
          />
        </div>
      </SettingsSection>
    </div>
  );
}

interface ExternalAgentEditorState {
  readonly agentId?: string;
  readonly displayName: string;
  readonly description: string;
  readonly skillsText: string;
  readonly enabled: boolean;
  readonly inputRequired: boolean;
}

function ExternalAgentsSection({
  projectRoot,
}: {
  readonly projectRoot?: string;
}): JSX.Element | null {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const [status, setStatus] = useState<{
    sdkVersion: string;
    enabled: boolean;
    referenceExecutor: boolean;
    adapters: { a2a: boolean; mcpTasks: boolean; governedHttp: boolean };
    registrationCount: number;
    taskCount: number;
    error?: string;
  } | null>(null);
  const [registrations, setRegistrations] = useState<ExternalAgentRegistrationSummaryT[]>([]);
  const [dispatchable, setDispatchable] = useState<DispatchableAgentListingT[]>([]);
  const [preflightByAgent, setPreflightByAgent] = useState<
    Record<string, { ok: boolean; reasons: string[] }>
  >({});
  const [editor, setEditor] = useState<ExternalAgentEditorState | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshExternalAgents = useCallback(async (): Promise<void> => {
    if (!window.kodaxSpace) return;
    setError(null);
    const [statusResult, registrationResult, dispatchableResult] = await Promise.all([
      window.kodaxSpace.invoke('agent.external.status', {}),
      window.kodaxSpace.invoke('agent.external.registration.list', {}),
      window.kodaxSpace.invoke('agent.external.dispatchable.list', {
        ...(projectRoot ? { projectRoot } : {}),
        readOnly: true,
      }),
    ]);
    if (!statusResult.ok) {
      setError(statusResult.error.message);
      return;
    }
    setStatus(statusResult.data);
    if (!statusResult.data.enabled) return;
    if (!registrationResult.ok) {
      setError(registrationResult.error.message);
      return;
    }
    setRegistrations(registrationResult.data.registrations);
    setDispatchable(dispatchableResult.ok ? dispatchableResult.data.agents : []);
    setPreflightByAgent({});
  }, [projectRoot]);

  useEffect(() => {
    void refreshExternalAgents();
  }, [refreshExternalAgents]);

  function beginCreate(): void {
    setEditor({
      displayName: t('settings.externalAgents.referenceName'),
      description: t('settings.externalAgents.referenceDescription'),
      skillsText: 'general, conformance',
      enabled: true,
      inputRequired: false,
    });
  }

  function beginEdit(registration: ExternalAgentRegistrationSummaryT): void {
    setEditor({
      agentId: registration.agentId,
      displayName: registration.displayName,
      description: registration.description ?? '',
      skillsText: registration.skills.join(', '),
      enabled: registration.enabled,
      inputRequired: registration.inputRequired,
    });
  }

  async function saveEditor(): Promise<void> {
    if (!window.kodaxSpace || !editor) return;
    const action = editor.agentId ?? 'create';
    setBusyAction(action);
    setError(null);
    try {
      const skills = [
        ...new Set(
          editor.skillsText
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ];
      const result = await window.kodaxSpace.invoke('agent.external.reference.upsert', {
        ...(editor.agentId ? { agentId: editor.agentId } : {}),
        displayName: editor.displayName.trim(),
        ...(editor.description.trim() ? { description: editor.description.trim() } : {}),
        enabled: editor.enabled,
        skills,
        inputRequired: editor.inputRequired,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setEditor(null);
      pushToast(
        t(editor.agentId ? 'settings.externalAgents.updated' : 'settings.externalAgents.added'),
        'success',
        1800,
      );
      await refreshExternalAgents();
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleRegistration(
    registration: ExternalAgentRegistrationSummaryT,
  ): Promise<void> {
    setEditor(null);
    if (!window.kodaxSpace) return;
    setBusyAction(registration.agentId);
    const result = await window.kodaxSpace.invoke('agent.external.reference.upsert', {
      agentId: registration.agentId,
      displayName: registration.displayName,
      ...(registration.description ? { description: registration.description } : {}),
      enabled: !registration.enabled,
      skills: registration.skills,
      inputRequired: registration.inputRequired,
    });
    setBusyAction(null);
    if (!result.ok) setError(result.error.message);
    else await refreshExternalAgents();
  }

  async function removeRegistration(
    registration: ExternalAgentRegistrationSummaryT,
  ): Promise<void> {
    if (!window.kodaxSpace) return;
    const confirmed = await requestConfirm({
      message: t('settings.externalAgents.removeConfirm', { name: registration.displayName }),
      confirmLabel: t('settings.externalAgents.remove'),
      danger: true,
    });
    if (!confirmed) return;
    setBusyAction(registration.agentId);
    const result = await window.kodaxSpace.invoke('agent.external.registration.remove', {
      agentId: registration.agentId,
    });
    setBusyAction(null);
    if (!result.ok) setError(result.error.message);
    else await refreshExternalAgents();
  }

  async function preflightRegistration(
    registration: ExternalAgentRegistrationSummaryT,
  ): Promise<boolean> {
    if (!window.kodaxSpace) return false;
    setBusyAction(`preflight:${registration.agentId}`);
    const result = await window.kodaxSpace.invoke('agent.external.preflight', {
      agentId: registration.agentId,
      ...(projectRoot ? { projectRoot } : {}),
      readOnly: true,
      expectedConfigurationRevision: registration.configurationRevision,
    });
    setBusyAction(null);
    if (!result.ok) {
      setError(result.error.message);
      return false;
    }
    setPreflightByAgent((current) => ({
      ...current,
      [registration.agentId]: { ok: result.data.ok, reasons: result.data.reasons },
    }));
    return result.data.ok;
  }

  async function runConformance(registration: ExternalAgentRegistrationSummaryT): Promise<void> {
    if (!window.kodaxSpace) return;
    if (!currentSessionId) {
      setError(t('settings.externalAgents.selectSessionBeforeTest'));
      return;
    }
    if (!(await preflightRegistration(registration))) return;
    setBusyAction(`test:${registration.agentId}`);
    const result = await window.kodaxSpace.invoke('agent.external.task.start', {
      sessionId: currentSessionId,
      agentId: registration.agentId,
      objective: t('settings.externalAgents.testObjective'),
      readOnly: true,
      expectedConfigurationRevision: registration.configurationRevision,
    });
    setBusyAction(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    pushToast(
      result.data.state === 'input-required'
        ? t('settings.externalAgents.testNeedsInput')
        : t('settings.externalAgents.testStarted'),
      'success',
      2200,
    );
    await refreshExternalAgents();
  }

  if (status && !status.enabled) return null;

  return (
    <SettingsSection
      title={t('settings.externalAgents.title')}
      description={t('settings.externalAgents.description')}
      icon={Bot}
    >
      <div className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
        <RuntimeField
          label={t('settings.externalAgents.sdk')}
          value={status?.sdkVersion ?? t('common.loading')}
          mono
        />
        <RuntimeField
          label={t('settings.externalAgents.plane')}
          value={status ? t('settings.externalAgents.ready') : t('common.loading')}
        />
        <RuntimeField
          label={t('settings.externalAgents.catalog')}
          value={String(status?.registrationCount ?? registrations.length)}
        />
        <RuntimeField
          label={t('settings.externalAgents.tasks')}
          value={String(status?.taskCount ?? 0)}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" data-testid="external-agent-adapter-gates">
        <ExternalAgentGate label="Reference" enabled={status?.referenceExecutor === true} />
        <ExternalAgentGate label="A2A" enabled={status?.adapters.a2a === true} />
        <ExternalAgentGate label="MCP Tasks" enabled={status?.adapters.mcpTasks === true} />
        <ExternalAgentGate label="Governed HTTP" enabled={status?.adapters.governedHttp === true} />
      </div>

      <div className="mt-3 rounded-lg border border-info/30 bg-info/8 px-3 py-2 text-[11px] leading-5 text-fg-secondary">
        {t('settings.externalAgents.boundary')}
      </div>
      {(error ?? status?.error) && (
        <div className="mt-3 text-xs leading-5 text-danger">{error ?? status?.error}</div>
      )}

      {editor && (
        <ExternalAgentEditor
          value={editor}
          busy={busyAction !== null}
          onChange={setEditor}
          onCancel={() => setEditor(null)}
          onSave={() => void saveEditor()}
        />
      )}

      <div className="mt-3 space-y-2" data-testid="external-agent-registration-list">
        {registrations.length === 0 && !editor ? (
          <div className="rounded-lg border border-dashed border-border-default px-3 py-4 text-center text-xs text-fg-muted">
            {t('settings.externalAgents.empty')}
          </div>
        ) : (
          registrations.map((registration) => {
            const live = dispatchable.find(
              (entry) => entry.descriptor.agentId === registration.agentId,
            );
            const preflight = preflightByAgent[registration.agentId];
            const busy = busyAction?.includes(registration.agentId) === true;
            return (
              <article
                key={registration.agentId}
                className="rounded-lg border border-border-default bg-surface px-3 py-2.5"
                data-testid="external-agent-registration-card"
              >
                <div className="flex items-start gap-3">
                  <Bot className="mt-0.5 h-4 w-4 shrink-0 text-info" strokeWidth={1.8} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-fg-primary">
                      <span>{registration.displayName}</span>
                      <span className="rounded border border-border-default px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                        {registration.adapterKind}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${registration.enabled ? 'bg-ok/12 text-ok' : 'bg-surface-3 text-fg-muted'}`}
                      >
                        {registration.enabled
                          ? t('settings.externalAgents.enabled')
                          : t('settings.externalAgents.disabled')}
                      </span>
                      {live && (
                        <span className="rounded bg-info/10 px-1.5 py-0.5 text-[10px] text-info">
                          {externalDispatchabilityLabel(live.dispatchability.status, t)}
                        </span>
                      )}
                    </div>
                    {registration.description && (
                      <p className="mt-1 text-[11px] leading-4 text-fg-secondary">
                        {registration.description}
                      </p>
                    )}
                    <div className="mt-1 break-all font-mono text-[10px] text-fg-muted">
                      {registration.agentId}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {registration.skills.map((skill) => (
                        <span
                          key={skill}
                          className="rounded border border-border-default bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-muted"
                        >
                          {skill}
                        </span>
                      ))}
                      <span className="rounded border border-border-default bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-muted">
                        {registration.inputRequired
                          ? t('settings.externalAgents.inputRequired')
                          : t('settings.externalAgents.noInputRequired')}
                      </span>
                      <span className="rounded border border-border-default bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-muted">
                        {t('settings.externalAgents.noNetwork')}
                      </span>
                      <span className="rounded border border-border-default bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-muted">
                        {t('settings.externalAgents.noWorkspaceWrite')}
                      </span>
                    </div>
                    {preflight && (
                      <div
                        className={`mt-2 rounded px-2 py-1 text-[10px] ${preflight.ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'}`}
                        role="status"
                      >
                        {preflight.ok
                          ? t('settings.externalAgents.preflightPassed')
                          : t('settings.externalAgents.preflightFailed', {
                              reason:
                                preflight.reasons.join('; ') ||
                                t('settings.externalAgents.unavailable'),
                            })}
                      </div>
                    )}
                  </div>
                  {registration.adapterKind === 'reference' && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <ExternalAgentIconButton
                        icon={Pencil}
                        label={t('settings.externalAgents.edit')}
                        disabled={busy}
                        onClick={() => beginEdit(registration)}
                      />
                      <ExternalAgentIconButton
                        icon={registration.enabled ? X : CheckCircle2}
                        label={
                          registration.enabled
                            ? t('settings.externalAgents.disable')
                            : t('settings.externalAgents.enable')
                        }
                        disabled={busy}
                        onClick={() => void toggleRegistration(registration)}
                      />
                      <ExternalAgentIconButton
                        icon={Trash2}
                        label={t('settings.externalAgents.remove')}
                        disabled={busy}
                        danger
                        onClick={() => void removeRegistration(registration)}
                      />
                    </div>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 border-t border-border-default/60 pt-2">
                  <button
                    type="button"
                    disabled={busy || !registration.enabled}
                    onClick={() => void preflightRegistration(registration)}
                    className="inline-flex min-h-7 items-center gap-1.5 rounded border border-border-default bg-surface-2 px-2 text-[11px] text-fg-secondary hover:text-fg-primary disabled:opacity-50"
                  >
                    <ShieldCheck className="h-3 w-3" /> {t('settings.externalAgents.preflight')}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !registration.enabled || !currentSessionId}
                    onClick={() => void runConformance(registration)}
                    className="inline-flex min-h-7 items-center gap-1.5 rounded border border-info/40 bg-info/10 px-2 text-[11px] text-info hover:bg-info/20 disabled:opacity-50"
                    data-testid="external-agent-test-button"
                  >
                    {busyAction === `test:${registration.agentId}` ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}{' '}
                    {t('settings.externalAgents.runTest')}
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={beginCreate}
          disabled={busyAction !== null || editor !== null || status === null}
          className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-info/45 bg-info/10 px-3 text-xs font-medium text-info hover:bg-info/20 disabled:opacity-50"
          data-testid="external-agent-add-button"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />{' '}
          {t('settings.externalAgents.addReference')}
        </button>
        <button
          type="button"
          onClick={() => void refreshExternalAgents()}
          disabled={busyAction !== null}
          className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-3 px-3 text-xs text-fg-primary hover:bg-hover-bg disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${busyAction === 'refresh' ? 'animate-spin' : ''}`}
            strokeWidth={1.8}
          />{' '}
          {t('common.refresh')}
        </button>
      </div>
    </SettingsSection>
  );
}

function ExternalAgentGate({
  label,
  enabled,
}: {
  readonly label: string;
  readonly enabled: boolean;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <span
      className={`rounded-full border px-2 py-1 text-[10px] ${enabled ? 'border-ok/35 bg-ok/10 text-ok' : 'border-border-default bg-surface-2 text-fg-muted'}`}
    >
      {label} ·{' '}
      {enabled ? t('settings.externalAgents.available') : t('settings.externalAgents.hidden')}
    </span>
  );
}

function ExternalAgentEditor({
  value,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  readonly value: ExternalAgentEditorState;
  readonly busy: boolean;
  readonly onChange: (value: ExternalAgentEditorState) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div
      className="mt-3 rounded-lg border border-info/35 bg-surface-2 p-3"
      data-testid="external-agent-editor"
    >
      <div className="mb-3 text-xs font-medium text-fg-primary">
        {value.agentId
          ? t('settings.externalAgents.editTitle')
          : t('settings.externalAgents.createTitle')}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[11px] text-fg-secondary">
          {t('settings.externalAgents.displayName')}
          <input
            value={value.displayName}
            onChange={(event) => onChange({ ...value, displayName: event.target.value })}
            className="mt-1 w-full rounded-md border border-border-default bg-surface px-2 py-1.5 text-xs text-fg-primary outline-none focus:border-info"
            data-testid="external-agent-name-input"
          />
        </label>
        <label className="text-[11px] text-fg-secondary">
          {t('settings.externalAgents.skills')}
          <input
            value={value.skillsText}
            onChange={(event) => onChange({ ...value, skillsText: event.target.value })}
            className="mt-1 w-full rounded-md border border-border-default bg-surface px-2 py-1.5 text-xs text-fg-primary outline-none focus:border-info"
            placeholder="general, review"
          />
        </label>
        <label className="text-[11px] text-fg-secondary sm:col-span-2">
          {t('settings.externalAgents.agentDescription')}
          <textarea
            value={value.description}
            onChange={(event) => onChange({ ...value, description: event.target.value })}
            rows={2}
            className="mt-1 w-full resize-y rounded-md border border-border-default bg-surface px-2 py-1.5 text-xs text-fg-primary outline-none focus:border-info"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-fg-secondary">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
          />{' '}
          {t('settings.externalAgents.enabled')}
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.inputRequired}
            onChange={(event) => onChange({ ...value, inputRequired: event.target.checked })}
          />{' '}
          {t('settings.externalAgents.simulateInput')}
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !value.displayName.trim()}
          className="rounded-md bg-info px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          data-testid="external-agent-save-button"
        >
          {t('common.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-border-default px-3 py-1.5 text-xs text-fg-secondary hover:text-fg-primary"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

function ExternalAgentIconButton({
  icon: Icon,
  label,
  disabled,
  danger = false,
  onClick,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly disabled: boolean;
  readonly danger?: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-50 ${danger ? 'text-fg-muted hover:bg-danger/12 hover:text-danger' : 'text-fg-muted hover:bg-surface-3 hover:text-fg-primary'}`}
      aria-label={label}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
    </button>
  );
}

function externalDispatchabilityLabel(
  status: DispatchableAgentListingT['dispatchability']['status'],
  t: Translate,
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

function parseOptionalInt(
  value: string,
  field: string,
  min: number,
  max: number,
  t: Translate,
): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(t('settings.runtime.numberError', { field, min, max }));
  }
  return parsed;
}

function RuntimeField({
  label,
  value,
  mono = false,
  wide = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly wide?: boolean;
}): JSX.Element {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div
        className={[
          'mt-0.5 break-words text-[11px] leading-5 text-fg-primary',
          mono ? 'font-mono' : '',
        ].join(' ')}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function SkillInstallButton({
  label,
  icon: Icon,
  busy,
  disabled = false,
  onClick,
}: {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly busy: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-3 px-3 text-xs text-fg-primary hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
      ) : (
        <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
      )}
      {label}
    </button>
  );
}

function LanguageSection(): JSX.Element {
  const { languageMode, effectiveLocale, setLanguageMode, t } = useI18n();
  const [busy, setBusy] = useState<LanguageModeT | null>(null);
  const options: ReadonlyArray<{ readonly mode: LanguageModeT; readonly label: MessageKey }> = [
    { mode: 'system', label: 'language.followSystem' },
    { mode: 'zh-CN', label: 'language.zhCN' },
    { mode: 'en-US', label: 'language.enUS' },
  ];

  async function chooseLanguage(next: LanguageModeT): Promise<void> {
    if (next === languageMode || busy !== null) return;
    setBusy(next);
    try {
      const ok = await setSpaceLanguage(next, setLanguageMode);
      if (ok) pushToast(t('toast.languageSaved'), 'success', 1800);
      else pushToast(t('toast.languageSaveFailed'), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsSection
      title={t('settings.language.title')}
      description={t('settings.language.description')}
      icon={Languages}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.mode}
            type="button"
            onClick={() => void chooseLanguage(option.mode)}
            disabled={busy !== null}
            aria-pressed={languageMode === option.mode}
            className={[
              'min-h-10 rounded-lg border px-3 text-left text-sm transition-colors',
              languageMode === option.mode
                ? 'border-info/70 bg-info/10 text-fg-primary'
                : 'border-border-default bg-surface text-fg-secondary hover:bg-hover-bg hover:text-fg-primary',
            ].join(' ')}
          >
            <span className="block font-medium">{t(option.label)}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 text-xs leading-5 text-fg-muted">
        {t('language.effective', { locale: localeDisplayName(effectiveLocale) })}
      </div>
      <div className="mt-1 text-[11px] leading-5 text-fg-muted">{t('settings.language.help')}</div>
    </SettingsSection>
  );
}

function SmartPopoutToggle(): JSX.Element {
  const { t } = useI18n();
  const enabled = useAppStore((s) => s.smartPopoutEnabled);
  const setEnabled = useAppStore((s) => s.setSmartPopoutEnabled);
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-default bg-surface px-3 py-3">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
        className="mt-1 h-4 w-4 accent-ok"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg-primary">
          {t('settings.smartPopout.title')}
        </span>
        <span className="mt-1 block text-xs leading-5 text-fg-muted">
          {t('settings.smartPopout.description')}
        </span>
      </span>
    </label>
  );
}

function NativeCompletionNotificationToggle(): JSX.Element {
  const { t } = useI18n();
  const enabled = useAppStore((s) => s.nativeCompletionNotificationsEnabled);
  const setEnabled = useAppStore((s) => s.setNativeCompletionNotificationsEnabled);
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-default bg-surface px-3 py-3">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
        className="mt-1 h-4 w-4 accent-ok"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg-primary">
          {t('settings.notifications.title')}
        </span>
        <span className="mt-1 block text-xs leading-5 text-fg-muted">
          {t('settings.notifications.description')}
        </span>
      </span>
    </label>
  );
}

function LicensePanel(): JSX.Element {
  const { t, effectiveLocale } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<LicenseStatusT | null>(null);
  const [busy, setBusy] = useState<'refresh' | 'import' | 'export' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusy((cur) => cur ?? 'refresh');
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('license.getStatus', {});
      if (result.ok) setStatus(result.data);
      else setErr(`${result.error.code}: ${result.error.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function importLicense(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.currentTarget.files?.[0] ?? null;
    e.currentTarget.value = '';
    if (!file || !window.kodaxSpace) return;

    const filePath = window.kodaxSpace.getPathForFile(file);
    if (!filePath) {
      setErr(t('license.resolveFilePathError'));
      return;
    }

    setBusy('import');
    setErr(null);
    setMessage(null);
    try {
      const result = await window.kodaxSpace.invoke('license.importEntitlement', { filePath });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setStatus(result.data.status);
      setMessage(result.data.message);
      window.dispatchEvent(new Event('kodax-space.license-changed'));
    } finally {
      setBusy(null);
    }
  }

  async function exportRequest(): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusy('export');
    setErr(null);
    setMessage(null);
    try {
      const result = await window.kodaxSpace.invoke('license.exportRequest', {
        requestedEdition: 'enterprise',
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setMessage(t('license.requestExported', { path: result.data.filePath }));
    } finally {
      setBusy(null);
    }
  }

  const statusText = status ? formatLicenseStatus(status, t) : t('common.loading');
  const statusClass = status ? licenseStatusClass(status.status) : 'text-fg-muted';

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5">
      <SettingsSection
        title={t('settings.license')}
        description={t('settings.license.description')}
        icon={ShieldCheck}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".kodax-license,application/json"
          className="hidden"
          onChange={(e) => void importLicense(e)}
        />

        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className={`text-base font-semibold ${statusClass}`}>{statusText}</div>
              <div className="mt-1 text-xs text-fg-muted">
                {status?.customer
                  ? t('license.customer', { customer: status.customer })
                  : t('license.communityUse')}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy !== null}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-3 px-3 text-xs text-fg-primary hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'import' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                ) : (
                  <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.8} />
                )}
                {t('license.import')}
              </button>
              <button
                type="button"
                onClick={() => void exportRequest()}
                disabled={busy !== null}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface px-3 text-xs text-fg-secondary hover:bg-hover-bg hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'export' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                ) : (
                  <KeyRound className="h-3.5 w-3.5" strokeWidth={1.8} />
                )}
                {t('license.exportRequest')}
              </button>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={busy !== null}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-default bg-surface text-fg-secondary hover:bg-hover-bg hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
                title={t('license.refreshStatus')}
                aria-label={t('license.refreshStatus')}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`}
                  strokeWidth={1.8}
                  aria-hidden
                />
              </button>
            </div>
          </div>

          <div className="grid gap-x-6 gap-y-2 border-t border-border-default pt-3 text-xs sm:grid-cols-2">
            <LicenseField
              label={t('license.field.edition')}
              value={status ? formatEdition(status.edition, t) : t('common.loading')}
            />
            <LicenseField
              label={t('license.field.kind')}
              value={formatLicenseKind(status?.licenseKind ?? null, t)}
            />
            <LicenseField
              label={t('license.field.expires')}
              value={
                status?.expiresAt
                  ? formatDate(status.expiresAt, effectiveLocale)
                  : t('license.none')
              }
            />
            <LicenseField
              label={t('license.field.source')}
              value={formatLicenseSource(status?.enforcementSource ?? null, t)}
            />
            <LicenseField
              label={t('license.field.features')}
              value={
                status && status.features.length > 0
                  ? status.features.join(', ')
                  : t('license.none')
              }
              wide
            />
            {status?.reason && (
              <LicenseField label={t('license.field.reason')} value={status.reason} wide />
            )}
          </div>

          {message && (
            <div className="rounded-lg border border-ok/40 bg-ok/12 px-3 py-2 text-xs text-ok">
              {message}
            </div>
          )}
          {err && (
            <div className="rounded-lg border border-danger/40 bg-danger/12 px-3 py-2 text-xs text-danger">
              {err}
            </div>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}

function LicenseField({
  label,
  value,
  wide = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly wide?: boolean;
}): JSX.Element {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-0.5 break-words font-mono text-[11px] leading-5 text-fg-primary">
        {value}
      </div>
    </div>
  );
}

function formatEdition(edition: LicenseStatusT['edition'], t: Translate): string {
  if (edition === 'community') return t('license.edition.community');
  if (edition === 'professional') return t('license.edition.professional');
  return t('license.edition.enterprise');
}

function formatLicenseKind(kind: LicenseStatusT['licenseKind'], t: Translate): string {
  if (kind === null) return t('license.none');
  if (kind === 'evaluation') return t('license.kind.evaluation');
  if (kind === 'commercial') return t('license.kind.commercial');
  if (kind === 'partner') return t('license.kind.partner');
  if (kind === 'dev') return t('license.kind.dev');
  return t('license.kind.test');
}

function formatLicenseSource(
  source: LicenseStatusT['enforcementSource'] | null,
  t: Translate,
): string {
  if (source === null || source === 'none') return t('license.source.none');
  if (source === 'build-metadata') return t('license.source.buildMetadata');
  if (source === 'signed-policy-manifest') return t('license.source.signedPolicyManifest');
  return t('license.source.devOverride');
}

function formatLicenseStatus(status: LicenseStatusT, t: Translate): string {
  if (status.status === 'licensed') return formatEdition(status.edition, t);
  if (status.status === 'community') return t('license.edition.community');
  if (status.status === 'required') return t('license.status.required');
  if (status.status === 'expired') return t('license.status.expired');
  if (status.status === 'invalid') return t('license.status.invalid');
  if (status.status === 'degraded') return t('license.status.degraded');
  return status.status;
}

function licenseStatusClass(status: LicenseStatusT['status']): string {
  if (status === 'licensed' || status === 'community') return 'text-ok';
  if (status === 'expired' || status === 'required' || status === 'degraded') return 'text-warn';
  return 'text-danger';
}

function formatDate(value: string, locale: SupportedLocaleT): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale);
}

function ProvidersPanel(): JSX.Element {
  const { t } = useI18n();
  const providers = useAppStore((s) => s.providers);
  const keychainBackend = useAppStore((s) => s.keychainBackend);
  const setProviders = useAppStore((s) => s.setProviders);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const builtIn = useMemo(() => providers.filter((p) => !p.isCustom), [providers]);
  const custom = useMemo(() => providers.filter((p) => p.isCustom), [providers]);
  const configuredCount = useMemo(() => providers.filter((p) => p.configured).length, [providers]);
  const defaultProvider = useMemo(() => providers.find((p) => p.isDefault), [providers]);

  const filteredBuiltIn = useMemo(() => filterProviders(builtIn, query), [builtIn, query]);
  const filteredCustom = useMemo(() => filterProviders(custom, query), [custom, query]);

  async function refresh(): Promise<void> {
    if (!window.kodaxSpace) return;
    setLoading(true);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('provider.list', undefined);
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setProviders(
        result.data.providers,
        result.data.defaultProviderId,
        result.data.keychainBackend,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4 p-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ProviderStat
            label={t('settings.providers.configured')}
            value={`${configuredCount}/${providers.length}`}
            detail={t('settings.providers.configured.detail')}
          />
          <ProviderStat
            label={t('settings.providers.default')}
            value={defaultProvider?.displayName ?? t('settings.providers.default.none')}
            detail={defaultProvider?.defaultModel ?? t('settings.providers.default.detail')}
          />
          <ProviderStat
            label={t('settings.providers.custom')}
            value={String(custom.length)}
            detail={t('settings.providers.custom.detail')}
          />
          <ProviderStat
            label={t('settings.providers.keyStorage')}
            value={
              keychainBackend === 'memory'
                ? t('settings.providers.keyStorage.memory')
                : t('settings.providers.keyStorage.keychain')
            }
            detail={
              keychainBackend === 'memory'
                ? t('settings.providers.keyStorage.memoryDetail')
                : t('settings.providers.keyStorage.keychainDetail')
            }
          />
        </div>
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-3 px-3 text-xs text-fg-primary hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              strokeWidth={1.8}
              aria-hidden
            />
            {t('common.refresh')}
          </button>
          <button
            type="button"
            onClick={() => setShowCustomForm((v) => !v)}
            className="btn-accent inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium"
          >
            {showCustomForm ? (
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            ) : (
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
            {showCustomForm ? t('settings.providers.closeForm') : t('settings.providers.addCustom')}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-danger/40 bg-danger/12 px-3 py-2 text-xs text-danger">
          {err}
        </div>
      )}

      {keychainBackend === 'memory' && (
        <div className="flex gap-3 rounded-lg border border-warn/45 bg-warn/12 px-3 py-3 text-xs text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
          <div className="leading-5">
            <div className="font-semibold">{t('settings.providers.keychainUnavailable.title')}</div>
            <div className="text-warn/90">
              {t('settings.providers.keychainUnavailable.description')}
            </div>
          </div>
        </div>
      )}

      {showCustomForm && (
        <CustomProviderForm
          onAdded={async () => {
            setShowCustomForm(false);
            await refresh();
          }}
          onPartialAdded={async () => {
            await refresh();
          }}
          onCancel={() => setShowCustomForm(false)}
        />
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-border-default bg-surface-2 p-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted"
            strokeWidth={1.8}
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-full rounded-lg border border-border-default bg-surface pl-9 pr-3 text-xs text-fg-primary outline-none focus:border-info"
            placeholder={t('settings.providers.search.placeholder')}
            aria-label={t('settings.providers.search.aria')}
          />
        </label>
        <div className="text-xs text-fg-muted">
          {t('settings.providers.search.shown', {
            count: filteredBuiltIn.length + filteredCustom.length,
          })}
        </div>
      </div>

      <ProviderGroup
        title={t('settings.providers.customGroup.title')}
        description={t('settings.providers.customGroup.description')}
        providers={filteredCustom}
        empty={
          query.trim()
            ? t('settings.providers.customGroup.emptySearch')
            : t('settings.providers.customGroup.empty')
        }
        onChanged={refresh}
      />

      <ProviderGroup
        title={t('settings.providers.builtInGroup.title')}
        description={t('settings.providers.builtInGroup.description')}
        providers={filteredBuiltIn}
        empty={
          query.trim()
            ? t('settings.providers.builtInGroup.emptySearch')
            : t('settings.providers.builtInGroup.empty')
        }
        onChanged={refresh}
      />

      <section className="rounded-lg border border-border-default bg-surface-2 p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          {t('settings.providers.storage.title')}
        </h3>
        <div className="grid gap-2 text-xs leading-5 text-fg-muted sm:grid-cols-2">
          <div>{t('settings.providers.storage.keychain')}</div>
          <div>{t('settings.providers.storage.customProviders')}</div>
          <div>{t('settings.providers.storage.rendererState')}</div>
          <div>{t('settings.providers.storage.defaultProvider')}</div>
        </div>
      </section>
    </div>
  );
}

function filterProviders(
  providers: readonly ProviderInfo[],
  query: string,
): readonly ProviderInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return providers;
  return providers.filter((p) => {
    const fields = [
      p.displayName,
      p.id,
      p.apiKeyEnv,
      p.protocol,
      p.defaultModel,
      p.baseUrl ?? '',
      ...(p.models ?? []),
    ];
    return fields.some((field) => field.toLowerCase().includes(q));
  });
}

function ProviderGroup({
  title,
  description,
  providers,
  empty,
  onChanged,
}: {
  readonly title: string;
  readonly description: string;
  readonly providers: readonly ProviderInfo[];
  readonly empty: string;
  readonly onChanged: () => Promise<void>;
}): JSX.Element {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg-primary">{title}</h3>
          <p className="text-xs text-fg-muted">{description}</p>
        </div>
        <span className="text-xs text-fg-muted">{providers.length}</span>
      </div>
      {providers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-default bg-surface-2 px-4 py-5 text-center text-xs text-fg-muted">
          {empty}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} onChanged={onChanged} />
          ))}
        </div>
      )}
    </section>
  );
}

function ProviderStat({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}): JSX.Element {
  return (
    <div
      role="group"
      aria-label={`${label}: ${value}. ${detail}`}
      className="min-w-0 rounded-lg border border-border-default bg-surface-2 p-3"
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-fg-primary" title={value}>
        {value}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-fg-muted" title={detail}>
        {detail}
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  icon: Icon,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border-default bg-surface-2 p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-default bg-surface-3 text-fg-secondary">
          <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg-primary">{title}</h3>
          <p className="mt-0.5 text-xs leading-5 text-fg-muted">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
