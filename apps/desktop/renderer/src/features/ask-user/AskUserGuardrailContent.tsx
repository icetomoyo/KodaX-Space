import { useMemo, type JSX } from 'react';
import type { AskUserSignal, AskUserVerdict } from '@kodax-space/space-ipc-schema';

import { useI18n } from '../../i18n/I18nProvider.js';
import { AutoModeDiagnosticsPanel } from '../permission/AutoModeDiagnosticsPanel.js';
import { truncate, type GuardrailPayload } from './askUserQuestionRules.js';

const SEVERITY_STYLE: Record<AskUserSignal['severity'], string> = {
  info: 'bg-info/12 text-info',
  warning: 'bg-warn/12 text-warn',
  danger: 'bg-danger/12 text-danger',
};

export function AskUserGuardrailContent({
  guardrail,
  busy,
  error,
  errorId,
  onAnswer,
}: {
  readonly guardrail: GuardrailPayload;
  readonly busy: boolean;
  readonly error: string | null;
  readonly errorId: string;
  readonly onAnswer: (verdict: AskUserVerdict) => void;
}): JSX.Element {
  const { t } = useI18n();
  const inputPreview = useMemo(() => {
    if (!guardrail.toolCall.input) return null;
    try {
      return truncate(JSON.stringify(guardrail.toolCall.input, null, 2), 2000);
    } catch {
      return t('askUser.unserializableInput');
    }
  }, [guardrail.toolCall.input, t]);

  return (
    <div className="space-y-3">
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg-primary">
        {truncate(guardrail.reason, 1500)}
      </div>
      <AutoModeDiagnosticsPanel diagnostics={guardrail.autoModeDiagnostics} />
      <div className="space-y-1">
        <div className="font-mono text-[10px] uppercase text-fg-muted">{t('askUser.tool')}</div>
        <div className="font-mono text-sm text-warn">{guardrail.toolCall.toolName}</div>
      </div>
      {inputPreview && (
        <div className="space-y-1">
          <div className="font-mono text-[10px] uppercase text-fg-muted">{t('askUser.input')}</div>
          <pre className="max-h-48 overflow-x-auto rounded border border-border-default bg-surface p-2 font-mono text-xs">
            {inputPreview}
          </pre>
        </div>
      )}
      {guardrail.signals && guardrail.signals.length > 0 && (
        <div className="space-y-1">
          <div className="font-mono text-[10px] uppercase text-fg-muted">
            {t('askUser.signals')}
          </div>
          <div className="flex flex-wrap gap-1">
            {guardrail.signals.map((signal, index) => (
              <span
                key={`${signal.type}-${index}`}
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${SEVERITY_STYLE[signal.severity]}`}
                title={signal.message}
              >
                {signal.type}
              </span>
            ))}
          </div>
          {guardrail.signals.map((signal, index) => (
            <div key={`msg-${signal.type}-${index}`} className="pl-2 text-xs text-fg-muted">
              · {truncate(signal.message, 200)}
            </div>
          ))}
        </div>
      )}
      {error && (
        <div id={errorId} role="alert" className="font-mono text-xs text-danger">
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer('block')}
          className="rounded bg-surface-3 px-3 py-1.5 text-xs text-fg-primary hover:bg-hover-bg disabled:opacity-50"
        >
          {t('askUser.blockEsc')}
        </button>
        <button
          type="button"
          data-ask-user-primary-focus
          disabled={busy}
          onClick={() => onAnswer('allow')}
          className="rounded border border-ok/50 bg-ok/15 px-3 py-1.5 text-xs font-medium text-ok hover:bg-ok/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('askUser.allowEnter')}
        </button>
      </div>
    </div>
  );
}
