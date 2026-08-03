import type {
  AutoModeDecisionDiagnostics,
  AutoModeOutputWarningCode,
} from '@kodax-space/space-ipc-schema';
import type { JSX } from 'react';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';

const SOURCE_LABELS: Record<AutoModeDecisionDiagnostics['source'], MessageKey> = {
  classifier_confirm: 'autoModeDiagnostics.source.classifierConfirm',
  classifier_failure: 'autoModeDiagnostics.source.classifierFailure',
  classifier_circuit_breaker: 'autoModeDiagnostics.source.circuitBreaker',
  configuration: 'autoModeDiagnostics.source.configuration',
};

const OUTCOME_LABELS: Record<
  NonNullable<AutoModeDecisionDiagnostics['classifierAttempts']>[number]['outcome'],
  MessageKey
> = {
  allow: 'autoModeDiagnostics.outcome.allow',
  confirm: 'autoModeDiagnostics.outcome.confirm',
  timeout: 'autoModeDiagnostics.outcome.timeout',
  provider_error: 'autoModeDiagnostics.outcome.providerError',
  contract_error: 'autoModeDiagnostics.outcome.contractError',
  input_budget: 'autoModeDiagnostics.outcome.inputBudget',
};

const WARNING_LABELS: Record<AutoModeOutputWarningCode, MessageKey> = {
  missing_hazard: 'autoModeDiagnostics.warning.missingHazard',
  invalid_hazard: 'autoModeDiagnostics.warning.invalidHazard',
  decision_hazard_conflict: 'autoModeDiagnostics.warning.hazardConflict',
  decision_reason_conflict: 'autoModeDiagnostics.warning.reasonConflict',
  missing_reason: 'autoModeDiagnostics.warning.missingReason',
  structured_format_violation: 'autoModeDiagnostics.warning.structuredFormat',
  legacy_format_violation: 'autoModeDiagnostics.warning.legacyFormat',
};

export function AutoModeDiagnosticsPanel({
  diagnostics,
}: {
  readonly diagnostics: AutoModeDecisionDiagnostics | undefined;
}): JSX.Element | null {
  const { t } = useI18n();
  if (!diagnostics) return null;

  return (
    <div className="space-y-2 rounded border border-info/30 bg-info/5 px-3 py-2">
      <div className="text-[11px] font-mono uppercase text-info">
        {t('autoModeDiagnostics.title')}
      </div>
      <div className="text-xs text-fg-primary">{t(SOURCE_LABELS[diagnostics.source])}</div>
      {diagnostics.classifierFailureKind && (
        <div className="text-xs text-fg-muted">
          {t('autoModeDiagnostics.failureKind')} <code>{diagnostics.classifierFailureKind}</code>
        </div>
      )}
      {diagnostics.classifierAttempts?.map((attempt) => (
        <div
          key={`${attempt.attempt}-${attempt.outcome}`}
          className="space-y-1 border-t border-border-default/60 pt-1.5 text-xs"
        >
          <div className="text-fg-primary">
            {t('autoModeDiagnostics.attempt', { attempt: attempt.attempt })}{' '}
            {t(OUTCOME_LABELS[attempt.outcome])}
            {attempt.observedProtocol ? (
              <span className="text-fg-muted">
                {' · '}
                {t('autoModeDiagnostics.protocol', { protocol: attempt.observedProtocol })}
              </span>
            ) : null}
          </div>
          {attempt.parseFailureCode && (
            <div className="text-fg-muted">
              {t('autoModeDiagnostics.decisionFailure')} <code>{attempt.parseFailureCode}</code>
            </div>
          )}
          {attempt.outputWarnings && attempt.outputWarnings.length > 0 && (
            <div className="space-y-1">
              <div className="text-fg-muted">{t('autoModeDiagnostics.outputWarnings')}</div>
              <div className="flex flex-wrap gap-1">
                {attempt.outputWarnings.map((warning) => (
                  <span
                    key={warning}
                    className="rounded bg-info/10 px-1.5 py-0.5 text-[11px] text-info"
                    title={warning}
                  >
                    {t(WARNING_LABELS[warning])}
                  </span>
                ))}
              </div>
            </div>
          )}
          {attempt.diagnostics && (
            <div className="break-all text-[11px] text-fg-muted">
              {attempt.diagnostics.provider} · {attempt.diagnostics.model} ·{' '}
              {attempt.diagnostics.elapsedMs}ms
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
