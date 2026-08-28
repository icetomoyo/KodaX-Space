import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  ShieldCheck,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { ProviderInfo } from '@kodax-space/space-ipc-schema';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';
import { requestConfirm } from '../../store/confirmStore.js';

interface ProviderCardProps {
  readonly provider: ProviderInfo;
  readonly onChanged: () => Promise<void>;
  readonly onEditCustom: (provider: ProviderInfo) => void;
  readonly externallyEditing: boolean;
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; latencyMs: number }
  | { kind: 'fail'; error: string };
type CredentialSource = ProviderInfo['configuredSource'];
type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function ProviderCard({
  provider,
  onChanged,
  onEditCustom,
  externallyEditing,
}: ProviderCardProps): JSX.Element {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [err, setErr] = useState<string | null>(null);
  const credentialSource: CredentialSource =
    provider.configuredSource ?? (provider.configured ? 'keychain' : 'none');
  const canSetDefault = provider.configured && !provider.isDefault;
  const canRemoveKey = credentialSource === 'keychain' || credentialSource === 'both';

  async function handleSave(): Promise<void> {
    if (!window.kodaxSpace) return;
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;

    setBusy(true);
    setErr(null);
    const submitted = trimmed;
    setDraft('');
    setReveal(false);

    try {
      const result = await window.kodaxSpace.invoke('provider.setKey', {
        providerId: provider.id,
        apiKey: submitted,
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setEditing(false);
      setTest({ kind: 'idle' });
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('provider.removeKey', {
        providerId: provider.id,
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setTest({ kind: 'idle' });
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleTest(): Promise<void> {
    if (!window.kodaxSpace || test.kind === 'testing') return;
    setBusy(true);
    setTest({ kind: 'testing' });
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('provider.test', { providerId: provider.id });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        setTest({ kind: 'idle' });
        return;
      }
      if (result.data.ok) {
        setTest({ kind: 'ok', latencyMs: result.data.latencyMs ?? 0 });
      } else {
        setTest({ kind: 'fail', error: result.data.error ?? 'unknown error' });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setTest({ kind: 'idle' });
    } finally {
      setBusy(false);
    }
  }

  async function handleSetDefault(): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('provider.setDefault', {
        providerId: provider.id,
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveCustom(): Promise<void> {
    if (!window.kodaxSpace || !provider.isCustom) return;
    // #1 fix: window.confirm 在 Electron sandbox=true 下会夺走 webContents 键盘焦点且拿不回来
    // （见 confirmStore.ts 顶部注释）——改用应用内 requestConfirm。
    const confirmed = await requestConfirm({
      message: t('provider.deleteConfirm', { name: provider.displayName }),
      danger: true,
      confirmLabel: t('common.delete'),
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('provider.removeCustom', {
        providerId: provider.id,
      });
      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }
      if (!result.data.ok) {
        setErr(t('provider.deleteFailed'));
        return;
      }
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className={[
        'flex min-h-[220px] flex-col rounded-lg border bg-surface-2 p-4',
        provider.isDefault
          ? 'border-ok/55 shadow-[0_0_0_1px_rgb(var(--ok)/0.12)]'
          : provider.configured
            ? 'border-border-strong'
            : 'border-border-default',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <div
          className={[
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
            provider.configured
              ? 'border-ok/30 bg-ok/12 text-ok'
              : 'border-border-default bg-surface-3 text-fg-muted',
          ].join(' ')}
        >
          {provider.configured ? (
            <ShieldCheck className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          ) : (
            <Cloud className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="max-w-full truncate text-sm font-semibold text-fg-primary">
              {provider.displayName}
            </h4>
            {provider.isDefault && (
              <Badge tone="ok" icon={Star}>
                {t('provider.badge.default')}
              </Badge>
            )}
            {provider.isCustom && <Badge tone="info">{t('provider.badge.custom')}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-muted">
            <span className="font-mono">{provider.id}</span>
            <span className="font-mono">{provider.protocol}</span>
          </div>
        </div>

        <StatusBadge configured={provider.configured} source={credentialSource} />
      </div>

      <dl className="mt-4 grid gap-2 rounded-lg border border-border-default bg-surface px-3 py-3 text-xs">
        <MetaRow label={t('provider.meta.env')} value={provider.apiKeyEnv} />
        <MetaRow
          label={t('provider.meta.key')}
          value={credentialSourceLabel(credentialSource, t)}
        />
        <MetaRow label={t('provider.meta.model')} value={provider.defaultModel} />
        {provider.baseUrl && <MetaRow label="URL" value={provider.baseUrl} />}
      </dl>

      {editing ? (
        <div className="mt-4 rounded-lg border border-info/40 bg-info/10 p-3">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-muted">
            {t('provider.apiKey')}
          </label>
          <div className="mt-2 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <KeyRound
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted"
                strokeWidth={1.8}
                aria-hidden
              />
              <input
                type={reveal ? 'text' : 'password'}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    void handleSave();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditing(false);
                    setDraft('');
                    setReveal(false);
                  }
                }}
                placeholder={t('provider.pasteKey', { env: provider.apiKeyEnv })}
                aria-label={`${provider.apiKeyEnv} ${t('provider.apiKey')}`}
                className="h-9 w-full rounded-lg border border-border-default bg-surface px-9 text-xs font-mono text-fg-primary outline-none focus:border-info disabled:cursor-not-allowed disabled:opacity-60"
                autoComplete="off"
                disabled={busy}
              />
            </div>
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              disabled={busy}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-default bg-surface-3 text-fg-muted hover:bg-hover-bg hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
              title={reveal ? t('provider.hideKey') : t('provider.showKey')}
              aria-label={reveal ? t('provider.hideKey') : t('provider.showKey')}
            >
              {reveal ? (
                <EyeOff className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              ) : (
                <Eye className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              )}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy || draft.trim() === ''}
              className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-info/50 bg-info/15 px-3 text-xs font-medium text-info hover:bg-info/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />}
              {t('provider.saveKey')}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft('');
                setReveal(false);
              }}
              disabled={busy}
              className="inline-flex min-h-8 items-center justify-center rounded-lg border border-border-default bg-surface-3 px-3 text-xs text-fg-secondary hover:bg-hover-bg hover:text-fg-primary disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            {provider.isCustom && (
              <button
                type="button"
                onClick={() => void handleRemoveCustom()}
                disabled={busy}
                className="ml-auto inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-3 px-3 text-xs text-fg-muted hover:border-danger/40 hover:bg-danger/12 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                {t('common.delete')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {provider.isCustom && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft('');
                setReveal(false);
                setTest({ kind: 'idle' });
                setErr(null);
                onEditCustom(provider);
              }}
              disabled={busy || externallyEditing}
              className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-3 px-3 text-xs font-medium text-fg-primary hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              {t('provider.edit')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={busy || externallyEditing}
            className={[
              'inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50',
              provider.configured
                ? 'border-border-default bg-surface-3 text-fg-primary hover:bg-hover-bg'
                : 'border-info/50 bg-info/15 text-info hover:bg-info/25',
            ].join(' ')}
          >
            <KeyRound className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
            {provider.configured ? t('provider.updateKey') : t('provider.addKey')}
          </button>

          {provider.configured && (
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={busy || test.kind === 'testing'}
              className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-3 px-3 text-xs text-fg-primary hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {test.kind === 'testing' && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} aria-hidden />
              )}
              {t('provider.test')}
            </button>
          )}

          {canSetDefault && (
            <button
              type="button"
              onClick={() => void handleSetDefault()}
              disabled={busy}
              className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-ok/50 bg-ok/15 px-3 text-xs font-medium text-ok hover:bg-ok/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Star className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              {t('provider.setDefault')}
            </button>
          )}

          {canRemoveKey && (
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={busy}
              className="inline-flex min-h-8 items-center justify-center rounded-lg border border-danger/40 bg-danger/12 px-3 text-xs text-danger hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('provider.removeKey')}
            </button>
          )}

          {provider.isCustom && (
            <button
              type="button"
              onClick={() => void handleRemoveCustom()}
              // 编辑表单打开时禁用删除：删除会令面板级 editingProviderId 悬空、表单被静默卸载
              disabled={busy || externallyEditing}
              className="ml-auto inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-3 px-3 text-xs text-fg-muted hover:border-danger/40 hover:bg-danger/12 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              {t('common.delete')}
            </button>
          )}
        </div>
      )}

      <div className="mt-auto pt-3">
        <TestResult test={test} />
        {err && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-danger/35 bg-danger/10 px-3 py-2 text-[11px] leading-5 text-danger">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
            <span>{err}</span>
          </div>
        )}
      </div>
    </article>
  );
}

function MetaRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-[11px] uppercase tracking-wide text-fg-muted">{label}</dt>
      <dd className="truncate font-mono text-[11px] text-fg-secondary" title={value}>
        {value}
      </dd>
    </div>
  );
}

function credentialSourceLabel(source: CredentialSource, t: Translate): string {
  if (source === 'both') return t('provider.keySource.both');
  if (source === 'keychain') return t('provider.keySource.keychain');
  if (source === 'env') return t('provider.keySource.env');
  if (source === 'runtime') return t('provider.keySource.runtime');
  return t('provider.keySource.none');
}

function StatusBadge({
  configured,
  source,
}: {
  readonly configured: boolean;
  readonly source: CredentialSource;
}): JSX.Element {
  const { t } = useI18n();
  return configured ? (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ok/15 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ok"
      title={credentialSourceLabel(source, t)}
    >
      <CheckCircle2 className="h-3 w-3" strokeWidth={1.8} aria-hidden />
      {t('provider.ready')}
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-3 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
      <XCircle className="h-3 w-3" strokeWidth={1.8} aria-hidden />
      {t('provider.noKey')}
    </span>
  );
}

function TestResult({ test }: { readonly test: TestState }): JSX.Element | null {
  const { t } = useI18n();
  if (test.kind === 'idle' || test.kind === 'testing') return null;
  if (test.kind === 'ok') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-ok/35 bg-ok/10 px-3 py-2 text-[11px] text-ok">
        <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
        {t('provider.connectionOk', { ms: test.latencyMs })}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-danger/35 bg-danger/10 px-3 py-2 text-[11px] leading-5 text-danger">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
      {test.error}
    </div>
  );
}

function Badge({
  tone,
  icon: Icon,
  children,
}: {
  readonly tone: 'ok' | 'info';
  readonly icon?: typeof Star;
  readonly children: string;
}): JSX.Element {
  const cls =
    tone === 'ok' ? 'bg-ok/15 text-ok border-ok/30' : 'bg-info/15 text-info border-info/30';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {Icon && <Icon className="h-3 w-3" strokeWidth={1.8} aria-hidden />}
      {children}
    </span>
  );
}
