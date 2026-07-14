// AskUserModal — FEATURE_032
//
// Shared UI for KodaX guardrail escalation and ask_user_question prompts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AskUserQuestionAnswer,
  AskUserReplyValue,
  AskUserRequestPayload,
  AskUserSignal,
  AskUserVerdict,
} from '@kodax-space/space-ipc-schema';
import { ASK_USER_BACK_SIGNAL, ASK_USER_CUSTOM_INPUT_SIGNAL } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import { FloatingSurfaceHost } from '../../shell/FloatingSurfaceHost.js';
import { floatingSurfaceForBlockingModal } from '../../shell/floatingSurfacePolicy.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import type { MessageKey } from '../../i18n/messages.js';

const SEVERITY_STYLE: Record<AskUserSignal['severity'], string> = {
  info: 'bg-info/12 text-info',
  warning: 'bg-warn/12 text-warn',
  danger: 'bg-danger/12 text-danger',
};
const ASK_USER_SURFACE = floatingSurfaceForBlockingModal('ask-user-modal', 'Agent needs input');
const ASK_USER_ANSWER_MAX = 20;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

type GuardrailPayload = Extract<AskUserRequestPayload, { toolCall: unknown }>;
type QuestionPayload = Extract<AskUserRequestPayload, { question: string }>;
type MultiQuestionPayload = Extract<AskUserRequestPayload, { kind: 'multi' }>;
type QuestionSelectionAnswer = string | { kind: 'customInput'; value: string };

function isGuardrail(payload: AskUserRequestPayload): payload is GuardrailPayload {
  return 'toolCall' in payload;
}

function isQuestion(payload: AskUserRequestPayload): payload is QuestionPayload {
  return 'question' in payload;
}

/** A multi-select is optional when the model explicitly sets min_selections:0. */
function isOptionalSelection(question: QuestionPayload): boolean {
  return question.multiSelect === true && question.minSelections === 0;
}

function selectionError(question: QuestionPayload, count: number, t: Translate): string | null {
  if (question.multiSelect && count > ASK_USER_ANSWER_MAX) {
    return t('askUser.selection.max', { max: ASK_USER_ANSWER_MAX });
  }
  // Report the real minimum first (so a min>1 requirement doesn't degrade to the
  // generic "at least one" when submitted empty via the Enter shortcut).
  if (
    question.multiSelect &&
    question.minSelections !== undefined &&
    count < question.minSelections
  ) {
    return t(question.minSelections === 1 ? 'askUser.selection.minOne' : 'askUser.selection.min', {
      min: question.minSelections,
    });
  }
  // Empty is only an error when a selection is actually required. min_selections:0
  // marks a multi-select optional (FEATURE_222) — an empty submit is valid there.
  if (count === 0 && !isOptionalSelection(question)) return t('askUser.selection.oneRequired');
  if (
    question.multiSelect &&
    question.maxSelections !== undefined &&
    count > question.maxSelections
  ) {
    return t(question.maxSelections === 1 ? 'askUser.selection.maxOne' : 'askUser.selection.max', {
      max: question.maxSelections,
    });
  }
  return null;
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function selectionHint(question: QuestionPayload | null, t: Translate): string | null {
  if (!question?.multiSelect) return null;
  const min = question.minSelections;
  const max = question.maxSelections;
  if (min === 0)
    return max !== undefined
      ? t('askUser.hint.optionalMax', { max })
      : t('askUser.hint.optionalAny');
  if (min !== undefined && max !== undefined) {
    if (min === max) return t('askUser.hint.exact', { count: min });
    return t('askUser.hint.range', { min, max });
  }
  if (min !== undefined) return t('askUser.hint.min', { min });
  if (max !== undefined) return t('askUser.hint.max', { max });
  return null;
}

function allowsCustomInput(question: QuestionPayload | null): boolean {
  return question?.kind === 'select' && question.allowCustomInput !== false;
}

function customInputLabel(question: QuestionPayload, t: Translate): string {
  return question.customInputLabel?.trim() || t('askUser.other');
}

export function AskUserModal(): JSX.Element | null {
  const { t } = useI18n();
  const queue = useAppStore((s) => s.askUserQueue);
  const dequeue = useAppStore((s) => s.dequeueAskUser);
  const head = queue[0] ?? null;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [customInputValue, setCustomInputValue] = useState('');
  const [selectedValues, setSelectedValues] = useState<ReadonlySet<string>>(new Set());
  const [multiQuestionIndex, setMultiQuestionIndex] = useState(0);
  const [multiAnswers, setMultiAnswers] = useState<Readonly<Record<string, AskUserQuestionAnswer>>>({});
  const guardrailAllowButtonRef = useRef<HTMLButtonElement | null>(null);
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null);

  const guardrail = head && isGuardrail(head) ? head : null;
  const multi: MultiQuestionPayload | null = head?.kind === 'multi' ? head : null;
  const question = useMemo<QuestionPayload | null>(() => {
    if (head && isQuestion(head)) return head;
    const item = multi?.questions[multiQuestionIndex];
    return item
      ? {
          ...item,
          kind: 'select',
          reqId: multi.reqId,
          sessionId: multi.sessionId,
        }
      : null;
  }, [head, multi, multiQuestionIndex]);
  const kind = question ? question.kind : 'guardrail';

  useEffect(() => {
    setMultiQuestionIndex(0);
    setMultiAnswers({});
  }, [head?.reqId]);

  useEffect(() => {
    setBusy(false);
    setErr(null);
    setInputValue(question && kind === 'input' ? (question.default ?? '') : '');
    setCustomInputValue(question && kind === 'select' ? (question.customInputDefault ?? '') : '');
    setSelectedValues(
      new Set(question && kind === 'select' && question.default ? [question.default] : []),
    );
  }, [head?.reqId, kind, question]);

  const inputPreview = useMemo(() => {
    if (!guardrail?.toolCall.input) return null;
    try {
      return truncate(JSON.stringify(guardrail.toolCall.input, null, 2), 2000);
    } catch {
      return t('askUser.unserializableInput');
    }
  }, [guardrail, t]);

  const selectHint = useMemo(() => selectionHint(question, t), [question, t]);

  const reply = useCallback(
    async (
      payload: { verdict: AskUserVerdict } | { value: AskUserReplyValue } | { cancelled: true },
    ): Promise<void> => {
      if (!head || !window.kodaxSpace || busy) return;
      setBusy(true);
      setErr(null);
      try {
        const result = await window.kodaxSpace.invoke('askUser.reply', {
          reqId: head.reqId,
          ...payload,
        });
        if (!result.ok) {
          const code = result.error?.code ?? 'ERR_UNKNOWN';
          const message = result.error?.message ?? 'unknown error';
          setErr(`${code}: ${message}`);
          setBusy(false);
          return;
        }
        dequeue(head.reqId);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    },
    [head, busy, dequeue],
  );

  const answerGuardrail = useCallback(
    (verdict: AskUserVerdict): void => {
      void reply({ verdict });
    },
    [reply],
  );

  const submitQuestion = useCallback((): void => {
    if (!head || kind === 'guardrail') return;
    if (kind === 'input') {
      void reply({ value: inputValue });
      return;
    }
    if (!question) return;
    const customSelected = selectedValues.has(ASK_USER_CUSTOM_INPUT_SIGNAL);
    if (customSelected && customInputValue.trim().length === 0) {
      setErr(t('askUser.customAnswerRequired'));
      return;
    }
    const values: QuestionSelectionAnswer[] = [...selectedValues]
      .filter((value) => value !== ASK_USER_CUSTOM_INPUT_SIGNAL)
      .map((value) => value);
    if (customSelected) values.push({ kind: 'customInput', value: customInputValue });
    const error = selectionError(question, values.length, t);
    if (error) {
      setErr(error);
      return;
    }
    const answer: AskUserQuestionAnswer = question.multiSelect ? values : (values[0] ?? '');
    if (multi) {
      const nextAnswers = { ...multiAnswers, [question.question]: answer };
      if (multiQuestionIndex < multi.questions.length - 1) {
        setMultiAnswers(nextAnswers);
        setMultiQuestionIndex((index) => index + 1);
        return;
      }
      void reply({ value: nextAnswers });
      return;
    }
    void reply({ value: answer });
  }, [
    head,
    kind,
    inputValue,
    question,
    selectedValues,
    customInputValue,
    reply,
    t,
    multi,
    multiAnswers,
    multiQuestionIndex,
  ]);

  const cancelQuestion = useCallback((): void => {
    void reply({ cancelled: true });
  }, [reply]);

  if (!head) return null;

  const hasDangerSignal = guardrail?.signals?.some((s) => s.severity === 'danger') ?? false;
  const borderClass = hasDangerSignal ? 'border-danger' : 'border-warn';
  const title =
    kind === 'guardrail'
      ? t('askUser.title.guardrail')
      : kind === 'input'
        ? t('askUser.title.input')
        : t('askUser.title.select');
  const showCustomInput = kind === 'select' && allowsCustomInput(question);
  const customSelected = selectedValues.has(ASK_USER_CUSTOM_INPUT_SIGNAL);
  const customSubmitBlocked = customSelected && customInputValue.trim().length === 0;
  const questionSubmitDisabled =
    busy ||
    (kind === 'select' &&
      ((selectedValues.size === 0 && !(question ? isOptionalSelection(question) : false)) ||
        customSubmitBlocked));

  const toggleOption = (value: string): void => {
    if (!question || kind !== 'select') return;
    if (value === ASK_USER_BACK_SIGNAL) {
      void reply({ value });
      return;
    }
    const maxSelections =
      question.maxSelections !== undefined
        ? Math.min(question.maxSelections, ASK_USER_ANSWER_MAX)
        : ASK_USER_ANSWER_MAX;
    if (question.multiSelect) {
      const next = new Set(selectedValues);
      if (next.has(value)) next.delete(value);
      else {
        if (next.size >= maxSelections) {
          setErr(
            t(maxSelections === 1 ? 'askUser.selection.maxOne' : 'askUser.selection.max', {
              max: maxSelections,
            }),
          );
          return;
        }
        next.add(value);
      }
      setErr(null);
      setSelectedValues(next);
    } else {
      setErr(null);
      setSelectedValues(new Set([value]));
    }
  };

  return (
    <FloatingSurfaceHost
      surface={ASK_USER_SURFACE}
      role="dialog"
      ariaLabelledBy="ask-user-modal-title"
      onEscapeKey={() => {
        if (kind === 'guardrail') answerGuardrail('block');
        else cancelQuestion();
      }}
      onEnterKey={(event) => {
        if (busy || event.target instanceof HTMLTextAreaElement) return false;
        if (kind === 'guardrail') answerGuardrail('allow');
        else submitQuestion();
        return true;
      }}
      initialFocusRef={kind === 'guardrail' ? guardrailAllowButtonRef : questionInputRef}
      contentClassName="absolute inset-0 flex items-center justify-center pointer-events-none"
    >
      <div
        className={`glass lift ix-zone pointer-events-auto w-[560px] max-w-[95vw] max-h-[90vh] flex flex-col bg-surface-2 border ${borderClass} rounded-lg`}
      >
        <div className="px-5 py-3 border-b border-border-default flex items-center gap-3 flex-shrink-0">
          <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded bg-warn/15 text-warn">
            ASK
          </span>
          <h2 id="ask-user-modal-title" className="text-sm font-semibold text-fg-primary">
            {title}
          </h2>
          {queue.length > 1 && (
            <span className="ml-auto text-[11px] font-mono text-fg-muted">
              {t('askUser.pendingCount', { count: queue.length - 1 })}
            </span>
          )}
        </div>

        <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
          {guardrail ? (
            <>
              <div className="text-sm text-fg-primary leading-relaxed whitespace-pre-wrap">
                {truncate(guardrail.reason, 1500)}
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-mono uppercase text-fg-muted">
                  {t('askUser.tool')}
                </div>
                <div className="text-sm font-mono text-warn">{guardrail.toolCall.toolName}</div>
              </div>

              {inputPreview && (
                <div className="space-y-1">
                  <div className="text-[11px] font-mono uppercase text-fg-muted">
                    {t('askUser.input')}
                  </div>
                  <pre className="text-xs font-mono bg-surface border border-border-default rounded p-2 overflow-x-auto max-h-48">
                    {inputPreview}
                  </pre>
                </div>
              )}

              {guardrail.signals && guardrail.signals.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[11px] font-mono uppercase text-fg-muted">
                    {t('askUser.signals')}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {guardrail.signals.map((sig, idx) => (
                      <span
                        key={`${sig.type}-${idx}`}
                        className={`text-[11px] px-2 py-0.5 rounded font-mono ${SEVERITY_STYLE[sig.severity]}`}
                        title={sig.message}
                      >
                        {sig.type}
                      </span>
                    ))}
                  </div>
                  {guardrail.signals.map((sig, idx) => (
                    <div key={`msg-${sig.type}-${idx}`} className="text-xs text-fg-muted pl-2">
                      · {truncate(sig.message, 200)}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {multi && (
                <div className="text-[11px] font-mono text-fg-muted">
                  {multiQuestionIndex + 1}/{multi.questions.length}
                </div>
              )}
              {question?.header && (
                <div className="text-[11px] font-mono uppercase text-fg-muted">
                  {truncate(question.header, 96)}
                </div>
              )}
              <div className="text-sm text-fg-primary leading-relaxed whitespace-pre-wrap">
                {question ? truncate(question.question, 1500) : ''}
              </div>
              {selectHint && kind === 'select' && (
                <div className="text-xs text-fg-muted">{selectHint}</div>
              )}
              {kind === 'input' ? (
                <textarea
                  ref={questionInputRef}
                  autoFocus
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="w-full min-h-24 resize-y rounded border border-border-default bg-surface px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent"
                />
              ) : (
                <div className="space-y-2">
                  {question?.options?.map((option) => {
                    const selected = selectedValues.has(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={busy}
                        onClick={() => toggleOption(option.value)}
                        className={`w-full text-left rounded border px-3 py-2 transition ${
                          selected
                            ? 'border-ok bg-ok/12 text-fg-primary'
                            : 'border-border-default bg-surface hover:bg-hover-bg text-fg-primary'
                        } disabled:opacity-50`}
                      >
                        <div className="flex items-center gap-2">
                          {question.multiSelect && (
                            <span
                              className={`h-3.5 w-3.5 rounded-sm border ${
                                selected ? 'bg-ok border-ok' : 'border-fg-muted'
                              }`}
                            />
                          )}
                          {!question.multiSelect && (
                            <span
                              className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                                selected ? 'border-ok' : 'border-fg-muted'
                              }`}
                            >
                              {selected && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
                            </span>
                          )}
                          <span className="text-sm font-medium">{truncate(option.label, 160)}</span>
                        </div>
                        {option.description && (
                          <div className="mt-1 text-xs text-fg-muted">
                            {truncate(option.description, 300)}
                          </div>
                        )}
                      </button>
                    );
                  })}
                  {showCustomInput && question && (
                    <>
                      <button
                        key={ASK_USER_CUSTOM_INPUT_SIGNAL}
                        type="button"
                        disabled={busy}
                        onClick={() => toggleOption(ASK_USER_CUSTOM_INPUT_SIGNAL)}
                        className={`w-full text-left rounded border px-3 py-2 transition ${
                          customSelected
                            ? 'border-ok bg-ok/12 text-fg-primary'
                            : 'border-border-default bg-surface hover:bg-hover-bg text-fg-primary'
                        } disabled:opacity-50`}
                      >
                        <div className="flex items-center gap-2">
                          {question.multiSelect && (
                            <span
                              className={`h-3.5 w-3.5 rounded-sm border ${
                                customSelected ? 'bg-ok border-ok' : 'border-fg-muted'
                              }`}
                            />
                          )}
                          {!question.multiSelect && (
                            <span
                              className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                                customSelected ? 'border-ok' : 'border-fg-muted'
                              }`}
                            >
                              {customSelected && (
                                <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                              )}
                            </span>
                          )}
                          <span className="text-sm font-medium">
                            {truncate(customInputLabel(question, t), 160)}
                          </span>
                        </div>
                        {question.customInputPrompt && (
                          <div className="mt-1 text-xs text-fg-muted">
                            {truncate(question.customInputPrompt, 300)}
                          </div>
                        )}
                      </button>
                      {customSelected && (
                        <textarea
                          value={customInputValue}
                          onChange={(e) => {
                            setCustomInputValue(e.target.value);
                            if (err !== null && e.target.value.trim()) setErr(null);
                          }}
                          placeholder={question.customInputPrompt ?? t('askUser.typeYourAnswer')}
                          className="w-full min-h-20 resize-y rounded border border-border-default bg-surface px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent"
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {err && <div className="text-xs text-danger font-mono">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-border-default flex items-center justify-end gap-2 flex-shrink-0">
          {kind === 'guardrail' ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => answerGuardrail('block')}
                className="px-3 py-1.5 text-xs rounded bg-surface-3 text-fg-primary hover:bg-hover-bg disabled:opacity-50"
              >
                {t('askUser.blockEsc')}
              </button>
              <button
                ref={guardrailAllowButtonRef}
                type="button"
                disabled={busy}
                onClick={() => answerGuardrail('allow')}
                className="px-3 py-1.5 text-xs rounded font-medium bg-ok/15 text-ok border border-ok/50 hover:bg-ok/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('askUser.allowEnter')}
              </button>
            </>
          ) : (
            <>
              {multi && multiQuestionIndex > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMultiQuestionIndex((index) => Math.max(0, index - 1))}
                  className="px-3 py-1.5 text-xs rounded bg-surface-3 text-fg-primary hover:bg-hover-bg disabled:opacity-50"
                >
                  {t('askUser.back')}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={cancelQuestion}
                className="px-3 py-1.5 text-xs rounded bg-surface-3 text-fg-primary hover:bg-hover-bg disabled:opacity-50"
              >
                {t('askUser.cancelEsc')}
              </button>
              <button
                type="button"
                disabled={questionSubmitDisabled}
                onClick={submitQuestion}
                className="px-3 py-1.5 text-xs rounded font-medium bg-ok/15 text-ok border border-ok/50 hover:bg-ok/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('askUser.submit')}
              </button>
            </>
          )}
        </div>
      </div>
    </FloatingSurfaceHost>
  );
}
