import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, Eye, EyeOff, KeyRound, Loader2, Plus, Save, Server } from 'lucide-react';
import type { CustomProviderReasoning, ProviderInfo } from '@kodax-space/space-ipc-schema';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';

interface CustomProviderFormProps {
  readonly provider?: ProviderInfo;
  readonly onAdded?: (providerId: string) => Promise<void>;
  readonly onPartialAdded?: (providerId: string) => Promise<void>;
  readonly onSaved?: (providerId: string) => Promise<void>;
  readonly onPartialSaved?: (providerId: string) => Promise<void>;
  readonly onCancel: () => void;
}
type CustomProtocol = 'openai' | 'anthropic';
type CredentialMode = 'apiKey' | 'env';
type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function providerProtocol(provider: ProviderInfo | undefined): CustomProtocol {
  return provider?.protocol === 'anthropic' ? 'anthropic' : 'openai';
}

function providerCredentialMode(provider: ProviderInfo | undefined): CredentialMode {
  return provider?.configuredSource === 'env' ? 'env' : 'apiKey';
}

function providerHasManagedKey(provider: ProviderInfo | undefined): boolean {
  return provider?.configuredSource === 'keychain' || provider?.configuredSource === 'both';
}

function providerModelsCsv(provider: ProviderInfo | undefined): string {
  return (provider?.models ?? []).join(', ');
}

function suggestedApiKeyEnv(displayName: string): string {
  const stem = displayName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const namedStem = stem.length > 0 ? stem : 'CUSTOM_PROVIDER';
  const safeStem = /^[A-Z_]/.test(namedStem) ? namedStem : `CUSTOM_${namedStem}`;
  const suffix = safeStem.endsWith('_API_KEY') ? '' : '_API_KEY';
  return `${safeStem.slice(0, 128 - suffix.length)}${suffix}`;
}

function reasoningEffortsCsv(reasoning: CustomProviderReasoning | undefined): string {
  return reasoning && reasoning !== 'none' ? reasoning.efforts.join(', ') : '';
}

function reasoningDefaultOf(reasoning: CustomProviderReasoning | undefined): string {
  return reasoning && reasoning !== 'none' ? (reasoning.default ?? '') : '';
}

/** Build the SDK friendly reasoning declaration from the form fields (undefined = not declared). */
function buildReasoning(none: boolean, effortsCsv: string, defaultEffort: string): CustomProviderReasoning | undefined {
  if (none) return 'none';
  const efforts = effortsCsv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (efforts.length === 0) return undefined;
  const def = defaultEffort.trim();
  return { efforts, ...(def.length > 0 ? { default: def } : {}) };
}

function normalizeModels(defaultModel: string, csv: string): string[] | undefined {
  const rawModels = csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (rawModels.length === 0) return undefined;

  const models: string[] = [];
  const seen = new Set<string>();
  const add = (model: string): void => {
    if (model.length === 0 || seen.has(model)) return;
    seen.add(model);
    models.push(model);
  };

  add(defaultModel);
  rawModels.forEach(add);
  return models;
}

const MODEL_PLACEHOLDERS: Record<
  CustomProtocol,
  { readonly defaultModel: string; readonly models: string }
> = {
  openai: {
    defaultModel: 'gpt-5.3-codex',
    models: 'gpt-5.3-codex, gpt-5.3',
  },
  anthropic: {
    defaultModel: 'claude-sonnet-4-6',
    models: 'claude-sonnet-4-6, claude-opus-4-7',
  },
};

const FIELD_IDS = {
  displayName: 'custom-provider-display-name',
  displayNameHint: 'custom-provider-display-name-hint',
  protocolLabel: 'custom-provider-protocol-label',
  protocolHint: 'custom-provider-protocol-hint',
  baseUrl: 'custom-provider-base-url',
  baseUrlHint: 'custom-provider-base-url-hint',
  skipBaseUrlValidation: 'custom-provider-skip-base-url-validation',
  skipBaseUrlValidationHint: 'custom-provider-skip-base-url-validation-hint',
  promptCacheAffinity: 'custom-provider-prompt-cache-affinity',
  promptCacheAffinityHint: 'custom-provider-prompt-cache-affinity-hint',
  credentialModeLabel: 'custom-provider-credential-mode-label',
  credentialModeHint: 'custom-provider-credential-mode-hint',
  apiKeyEnv: 'custom-provider-api-key-env',
  apiKeyEnvHint: 'custom-provider-api-key-env-hint',
  defaultModel: 'custom-provider-default-model',
  defaultModelHint: 'custom-provider-default-model-hint',
  models: 'custom-provider-models',
  modelsHint: 'custom-provider-models-hint',
  reasoningHint: 'custom-provider-reasoning-hint',
  reasoningEfforts: 'custom-provider-reasoning-efforts',
  reasoningDefault: 'custom-provider-reasoning-default',
  apiKey: 'custom-provider-api-key',
  apiKeyHint: 'custom-provider-api-key-hint',
} as const;

export function CustomProviderForm({
  provider,
  onAdded,
  onPartialAdded,
  onSaved,
  onPartialSaved,
  onCancel,
}: CustomProviderFormProps): JSX.Element {
  const { t } = useI18n();
  const mountedRef = useRef(true);
  const isEditing = provider !== undefined;
  const initialProtocol = useMemo(() => providerProtocol(provider), [provider]);
  const initialCredentialMode = useMemo(() => providerCredentialMode(provider), [provider]);
  const initialModelsCsv = useMemo(() => providerModelsCsv(provider), [provider]);
  const [displayName, setDisplayName] = useState(provider?.displayName ?? '');
  const [protocol, setProtocol] = useState<CustomProtocol>(initialProtocol);
  const [credentialMode, setCredentialMode] = useState<CredentialMode>(initialCredentialMode);
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '');
  const [skipBaseUrlValidation, setSkipBaseUrlValidation] = useState(
    provider?.skipBaseUrlValidation ?? false,
  );
  const [promptCacheAffinity, setPromptCacheAffinity] = useState(
    provider?.promptCacheAffinity ?? false,
  );
  const [apiKeyEnv, setApiKeyEnv] = useState(provider?.apiKeyEnv ?? '');
  const [defaultModel, setDefaultModel] = useState(provider?.defaultModel ?? '');
  const [modelsCsv, setModelsCsv] = useState(initialModelsCsv);
  const [reasoningNone, setReasoningNone] = useState(provider?.reasoning === 'none');
  const [reasoningEfforts, setReasoningEfforts] = useState(reasoningEffortsCsv(provider?.reasoning));
  const [reasoningDefault, setReasoningDefault] = useState(reasoningDefaultOf(provider?.reasoning));
  const [apiKey, setApiKey] = useState('');
  const [revealKey, setRevealKey] = useState(false);
  const [setAsDefault, setSetAsDefault] = useState(!isEditing);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<'idle' | 'provider' | 'key' | 'removeKey' | 'default'>('idle');
  const [createdProviderId, setCreatedProviderId] = useState<string | null>(null);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!window.kodaxSpace || createdProviderId) return;

    setBusy(true);
    setErr(null);
    setStep('provider');

    const submittedKey = credentialMode === 'apiKey' ? apiKey.trim() : '';
    setApiKey('');
    setRevealKey(false);

    try {
      const trimmedDefaultModel = defaultModel.trim();
      const models = normalizeModels(trimmedDefaultModel, modelsCsv);
      const reasoning = buildReasoning(reasoningNone, reasoningEfforts, reasoningDefault);
      const config = {
        displayName: displayName.trim(),
        protocol,
        baseUrl: baseUrl.trim(),
        skipBaseUrlValidation: skipBaseUrlValidation ? true : undefined,
        apiKeyEnv: effectiveApiKeyEnv,
        defaultModel: trimmedDefaultModel,
        models,
        promptCacheAffinity: promptCacheAffinity ? true : undefined,
        ...(reasoning !== undefined ? { reasoning } : {}),
      };

      if (isEditing) {
        if (!provider) return;
        const result = await window.kodaxSpace.invoke('provider.updateCustom', {
          providerId: provider.id,
          ...config,
        });
        if (!result.ok) {
          setErr(`${result.error.code}: ${result.error.message}`);
          return;
        }

        const providerId = result.data.providerId;
        if (submittedKey.length > 0) {
          setStep('key');
          const keyResult = await window.kodaxSpace.invoke('provider.setKey', {
            providerId,
            apiKey: submittedKey,
          });
          if (!keyResult.ok) {
            await onPartialSaved?.(providerId);
            setErr(
              t('customProvider.error.updateKeyNotSaved', {
                code: keyResult.error.code,
                message: keyResult.error.message,
              }),
            );
            return;
          }
        }

        if (credentialMode === 'env' && providerHasManagedKey(provider)) {
          setStep('removeKey');
          const removeResult = await window.kodaxSpace.invoke('provider.removeKey', {
            providerId,
          });
          if (!removeResult.ok) {
            await onPartialSaved?.(providerId);
            setErr(`${removeResult.error.code}: ${removeResult.error.message}`);
            return;
          }
        }

        await onSaved?.(providerId);
        return;
      }

      const result = await window.kodaxSpace.invoke('provider.addCustom', config);

      if (!result.ok) {
        setErr(`${result.error.code}: ${result.error.message}`);
        return;
      }

      const providerId = result.data.providerId;

      if (submittedKey.length > 0) {
        setStep('key');
        const keyResult = await window.kodaxSpace.invoke('provider.setKey', {
          providerId,
          apiKey: submittedKey,
        });
        if (!keyResult.ok) {
          setCreatedProviderId(providerId);
          await onPartialAdded?.(providerId);
          setErr(
            t('customProvider.error.keyNotSaved', {
              code: keyResult.error.code,
              message: keyResult.error.message,
            }),
          );
          return;
        }
      }

      if (setAsDefault && submittedKey.length > 0) {
        setStep('default');
        const defaultResult = await window.kodaxSpace.invoke('provider.setDefault', { providerId });
        if (!defaultResult.ok) {
          setCreatedProviderId(providerId);
          await onPartialAdded?.(providerId);
          setErr(
            t('customProvider.error.defaultNotSet', {
              code: defaultResult.error.code,
              message: defaultResult.error.message,
            }),
          );
          return;
        }
      }

      await onAdded?.(providerId);
    } catch (e2) {
      if (mountedRef.current) setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      if (mountedRef.current) {
        setStep('idle');
        setBusy(false);
      }
    }
  }
  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>): void {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (!busy) onCancel();
  }

  const hasExistingManagedKey = providerHasManagedKey(provider);
  const hasDraftKey = apiKey.trim().length > 0;
  const effectiveApiKeyEnv =
    credentialMode === 'apiKey'
      ? apiKeyEnv.trim() || suggestedApiKeyEnv(displayName)
      : apiKeyEnv.trim();
  const credentialValid =
    credentialMode === 'apiKey'
      ? hasDraftKey || (isEditing && hasExistingManagedKey)
      : apiKeyEnv.trim().length > 0;
  const valid =
    displayName.trim().length > 0 &&
    baseUrl.trim().length > 0 &&
    credentialValid &&
    defaultModel.trim().length > 0;
  const canSubmit = valid && !createdProviderId;
  const formLocked = busy || createdProviderId !== null;
  const modelPlaceholders = MODEL_PLACEHOLDERS[protocol];

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      onKeyDown={handleKeyDown}
      className="rounded-lg border border-border-default bg-surface-2 p-4 shadow-sm"
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/35 bg-accent/15 text-accent-ink">
          <Server className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg-primary">
            {isEditing ? t('customProvider.editTitle') : t('customProvider.title')}
          </h3>
          <p className="mt-0.5 text-xs leading-5 text-fg-muted">
            {isEditing ? t('customProvider.editDescription') : t('customProvider.description')}
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Field
          label={t('customProvider.displayName.label')}
          hint={t('customProvider.displayName.hint')}
          inputId={FIELD_IDS.displayName}
          hintId={FIELD_IDS.displayNameHint}
          requiredLabel={t('common.required')}
        >
          <input
            id={FIELD_IDS.displayName}
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="OpenRouter"
            className={inputClass}
            required
            disabled={formLocked}
            aria-describedby={FIELD_IDS.displayNameHint}
          />
        </Field>

        <Field
          label={t('customProvider.protocol.label')}
          hint={t('customProvider.protocol.hint')}
          labelId={FIELD_IDS.protocolLabel}
          hintId={FIELD_IDS.protocolHint}
        >
          <div
            role="group"
            aria-labelledby={FIELD_IDS.protocolLabel}
            aria-describedby={FIELD_IDS.protocolHint}
            className="grid grid-cols-2 gap-2"
          >
            <ProtocolButton
              active={protocol === 'openai'}
              label={t('customProvider.protocol.openai')}
              onClick={() => setProtocol('openai')}
              disabled={formLocked}
            />
            <ProtocolButton
              active={protocol === 'anthropic'}
              label={t('customProvider.protocol.anthropic')}
              onClick={() => setProtocol('anthropic')}
              disabled={formLocked}
            />
          </div>
        </Field>

        <Field
          label={t('customProvider.baseUrl.label')}
          hint={t('customProvider.baseUrl.hint')}
          inputId={FIELD_IDS.baseUrl}
          hintId={FIELD_IDS.baseUrlHint}
          requiredLabel={t('common.required')}
        >
          <input
            id={FIELD_IDS.baseUrl}
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            className={`${inputClass} font-mono`}
            required
            disabled={formLocked}
            aria-describedby={FIELD_IDS.baseUrlHint}
          />
        </Field>

        <label
          htmlFor={FIELD_IDS.skipBaseUrlValidation}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-3 lg:col-span-2"
        >
          <input
            id={FIELD_IDS.skipBaseUrlValidation}
            type="checkbox"
            checked={skipBaseUrlValidation}
            onChange={(e) => setSkipBaseUrlValidation(e.target.checked)}
            className="mt-1 h-4 w-4 accent-warning"
            disabled={formLocked}
            aria-describedby={FIELD_IDS.skipBaseUrlValidationHint}
          />
          <span className="min-w-0">
            <span className="block text-xs font-medium text-fg-primary">
              {t('customProvider.skipBaseUrlValidation.title')}
            </span>
            <span
              id={FIELD_IDS.skipBaseUrlValidationHint}
              className="mt-0.5 block text-[11px] leading-5 text-fg-muted"
            >
              {t('customProvider.skipBaseUrlValidation.description')}
            </span>
          </span>
        </label>

        <label
          htmlFor={FIELD_IDS.promptCacheAffinity}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-info/35 bg-info/10 px-3 py-3 lg:col-span-2"
        >
          <input
            id={FIELD_IDS.promptCacheAffinity}
            type="checkbox"
            checked={promptCacheAffinity}
            onChange={(e) => setPromptCacheAffinity(e.target.checked)}
            className="mt-1 h-4 w-4 accent-info"
            disabled={formLocked}
            aria-describedby={FIELD_IDS.promptCacheAffinityHint}
          />
          <span className="min-w-0">
            <span className="block text-xs font-medium text-fg-primary">
              {t('customProvider.promptCacheAffinity.title')}
            </span>
            <span
              id={FIELD_IDS.promptCacheAffinityHint}
              className="mt-0.5 block text-[11px] leading-5 text-fg-muted"
            >
              {t('customProvider.promptCacheAffinity.description')}
            </span>
          </span>
        </label>

        <Field
          label={t('customProvider.credentialMode.label')}
          hint={t('customProvider.credentialMode.hint')}
          labelId={FIELD_IDS.credentialModeLabel}
          hintId={FIELD_IDS.credentialModeHint}
          className="lg:col-span-2"
          requiredLabel={t('common.required')}
        >
          <div
            role="group"
            aria-labelledby={FIELD_IDS.credentialModeLabel}
            aria-describedby={FIELD_IDS.credentialModeHint}
            className="grid grid-cols-2 gap-2"
          >
            <ProtocolButton
              active={credentialMode === 'apiKey'}
              label={t('customProvider.credentialMode.apiKey')}
              onClick={() => {
                setCredentialMode('apiKey');
                if (!isEditing) setApiKeyEnv('');
              }}
              disabled={formLocked}
            />
            <ProtocolButton
              active={credentialMode === 'env'}
              label={t('customProvider.credentialMode.env')}
              onClick={() => {
                setCredentialMode('env');
                setApiKey('');
                setRevealKey(false);
              }}
              disabled={formLocked}
            />
          </div>
        </Field>

        {credentialMode === 'env' && (
          <Field
            label={t('customProvider.apiKeyEnv.label')}
            hint={t('customProvider.apiKeyEnv.hint')}
            inputId={FIELD_IDS.apiKeyEnv}
            hintId={FIELD_IDS.apiKeyEnvHint}
            requiredLabel={t('common.required')}
          >
            <input
              id={FIELD_IDS.apiKeyEnv}
              type="text"
              value={apiKeyEnv}
              onChange={(e) => setApiKeyEnv(e.target.value.toUpperCase())}
              placeholder="OPENROUTER_API_KEY"
              className={`${inputClass} font-mono`}
              required
              disabled={formLocked}
              aria-describedby={FIELD_IDS.apiKeyEnvHint}
            />
          </Field>
        )}

        <Field
          label={t('customProvider.defaultModel.label')}
          hint={t('customProvider.defaultModel.hint')}
          inputId={FIELD_IDS.defaultModel}
          hintId={FIELD_IDS.defaultModelHint}
          requiredLabel={t('common.required')}
        >
          <input
            id={FIELD_IDS.defaultModel}
            type="text"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder={modelPlaceholders.defaultModel}
            className={`${inputClass} font-mono`}
            required
            disabled={formLocked}
            aria-describedby={FIELD_IDS.defaultModelHint}
          />
        </Field>

        <Field
          label={t('customProvider.models.label')}
          hint={t('customProvider.models.hint')}
          inputId={FIELD_IDS.models}
          hintId={FIELD_IDS.modelsHint}
        >
          <input
            id={FIELD_IDS.models}
            type="text"
            value={modelsCsv}
            onChange={(e) => setModelsCsv(e.target.value)}
            placeholder={modelPlaceholders.models}
            className={`${inputClass} font-mono`}
            disabled={formLocked}
            aria-describedby={FIELD_IDS.modelsHint}
          />
        </Field>

        <Field
          label={t('customProvider.reasoning.label')}
          hint={t('customProvider.reasoning.hint')}
          hintId={FIELD_IDS.reasoningHint}
          labelId="custom-provider-reasoning-label"
          className="lg:col-span-2"
        >
          <label className="mb-2 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={reasoningNone}
              onChange={(e) => setReasoningNone(e.target.checked)}
              className="h-4 w-4 accent-accent"
              disabled={formLocked}
            />
            <span className="text-xs text-fg-secondary">{t('customProvider.reasoning.none')}</span>
          </label>
          {!reasoningNone && (
            <div className="grid gap-2 lg:grid-cols-2">
              <input
                id={FIELD_IDS.reasoningEfforts}
                type="text"
                value={reasoningEfforts}
                onChange={(e) => setReasoningEfforts(e.target.value)}
                placeholder="off, low, medium, high"
                className={`${inputClass} font-mono`}
                disabled={formLocked}
                aria-label={t('customProvider.reasoning.efforts.label')}
              />
              <input
                id={FIELD_IDS.reasoningDefault}
                type="text"
                value={reasoningDefault}
                onChange={(e) => setReasoningDefault(e.target.value)}
                placeholder={t('customProvider.reasoning.default.placeholder')}
                className={`${inputClass} font-mono`}
                disabled={formLocked}
                aria-label={t('customProvider.reasoning.default.label')}
              />
            </div>
          )}
        </Field>

        {credentialMode === 'apiKey' && (
          <Field
            label={t('customProvider.apiKey.label')}
            hint={isEditing ? t('customProvider.apiKey.editHint') : t('customProvider.apiKey.hint')}
            inputId={FIELD_IDS.apiKey}
            hintId={FIELD_IDS.apiKeyHint}
            className="lg:col-span-2"
            requiredLabel={!isEditing && !hasExistingManagedKey ? t('common.required') : undefined}
          >
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <KeyRound
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted"
                  strokeWidth={1.8}
                  aria-hidden
                />
                <input
                  id={FIELD_IDS.apiKey}
                  type={revealKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t('customProvider.apiKey.placeholder')}
                  className={`${inputClass} pl-9 pr-3 font-mono`}
                  autoComplete="off"
                  required={!isEditing && !hasExistingManagedKey}
                  disabled={formLocked}
                  aria-describedby={FIELD_IDS.apiKeyHint}
                />
              </div>
              <button
                type="button"
                onClick={() => setRevealKey((v) => !v)}
                disabled={formLocked}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-default bg-surface-3 text-fg-muted hover:bg-hover-bg hover:text-fg-primary disabled:opacity-50"
                aria-label={
                  revealKey ? t('customProvider.hideApiKey') : t('customProvider.showApiKey')
                }
                title={revealKey ? t('customProvider.hideApiKey') : t('customProvider.showApiKey')}
              >
                {revealKey ? (
                  <EyeOff className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                )}
              </button>
            </div>
            <span className="mt-2 block rounded-lg border border-info/25 bg-info/10 px-3 py-2 text-[11px] leading-4 text-fg-muted">
              {t('customProvider.apiKey.storageHint', { env: effectiveApiKeyEnv })}
            </span>
          </Field>
        )}
      </div>

      {!isEditing && credentialMode === 'apiKey' && (
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border-default bg-surface/70 px-3 py-3">
          <input
            type="checkbox"
            checked={setAsDefault && hasDraftKey}
            onChange={(e) => setSetAsDefault(e.target.checked)}
            className="mt-1 h-4 w-4 accent-accent"
            disabled={formLocked || !hasDraftKey}
          />
          <span className="min-w-0">
            <span className="block text-xs font-medium text-fg-primary">
              {t('customProvider.setDefault.title')}
            </span>
            <span className="mt-0.5 block text-[11px] leading-5 text-fg-muted">
              {hasDraftKey
                ? t('customProvider.setDefault.withKey')
                : t('customProvider.setDefault.noKey')}
            </span>
          </span>
        </label>
      )}

      {createdProviderId && !isEditing && (
        <div className="mt-3 rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-xs leading-5 text-info">
          {t('customProvider.created')}
        </div>
      )}
      {err && (
        <div className="mt-3 rounded-lg border border-danger/40 bg-danger/12 px-3 py-2 text-xs text-danger">
          {err}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit || busy}
          className="btn-accent inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-4 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} aria-hidden />
          ) : createdProviderId ? (
            <Check className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          ) : isEditing ? (
            <Save className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          ) : (
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          )}
          {busy
            ? progressLabel(step, t, isEditing)
            : createdProviderId
              ? t('customProvider.providerAdded')
              : isEditing
                ? t('customProvider.updateProvider')
                : t('customProvider.addProvider')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border-default bg-surface-3 px-4 text-xs text-fg-secondary hover:bg-hover-bg hover:text-fg-primary disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
        {!busy && valid && !createdProviderId && (
          <span className="inline-flex items-center gap-1.5 text-xs text-ok">
            <Check className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
            {t('common.ready')}
          </span>
        )}
      </div>
    </form>
  );
}

function progressLabel(
  step: 'idle' | 'provider' | 'key' | 'removeKey' | 'default',
  t: Translate,
  isEditing: boolean,
): string {
  if (step === 'key') return t('customProvider.progress.savingKey');
  if (step === 'removeKey') return t('customProvider.progress.removingStoredKey');
  if (step === 'default') return t('customProvider.progress.settingDefault');
  if (step === 'provider') {
    return isEditing
      ? t('customProvider.progress.updatingProvider')
      : t('customProvider.progress.creatingProvider');
  }
  return t('customProvider.progress.adding');
}

function ProtocolButton({
  active,
  label,
  onClick,
  disabled,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={[
        'min-h-9 rounded-lg border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'border-info/55 bg-info/15 text-info'
          : 'border-border-default bg-surface text-fg-secondary hover:bg-hover-bg hover:text-fg-primary',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  hint,
  inputId,
  labelId,
  hintId,
  className,
  requiredLabel,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly inputId?: string;
  readonly labelId?: string;
  readonly hintId?: string;
  readonly className?: string;
  readonly requiredLabel?: string;
  readonly children: ReactNode;
}): JSX.Element {
  const labelNode = inputId ? (
    <label
      htmlFor={inputId}
      className="text-[11px] font-medium uppercase tracking-wide text-fg-muted"
    >
      {label}
    </label>
  ) : (
    <span id={labelId} className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">
      {label}
    </span>
  );

  return (
    <div className={`block ${className ?? ''}`}>
      <span className="flex items-baseline justify-between gap-2">
        {labelNode}
        {requiredLabel && (
          <span
            aria-hidden
            className="rounded border border-warning/35 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning"
          >
            {requiredLabel}
          </span>
        )}
      </span>
      <span className="mt-1 block">{children}</span>
      <span id={hintId} className="mt-1 block text-[11px] leading-4 text-fg-muted">
        {hint}
      </span>
    </div>
  );
}

const inputClass =
  'h-9 w-full rounded-lg border border-border-default bg-surface px-3 text-xs text-fg-primary outline-none placeholder:text-fg-faint focus:border-info disabled:cursor-not-allowed disabled:opacity-60';
