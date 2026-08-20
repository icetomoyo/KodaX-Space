// AskUserInline — FEATURE_032 v2：流内聚焦卡，替代 AskUserModal 全屏模态。
//
// 混合方案（业界收敛形态：Claude Code / Cursor / VS Code Copilot / Cline / Gemini CLI）：
//   - 问题/授权渲染在对话流尾部（AskUserInlineStack → ConversationStreamV2），紧贴上下文、
//     无遮罩，对话历史全程可滚动、可搜索；
//   - composer 上方停靠召回条（AskUserDockBar → BottomBar）：计数徽标 + 摘要 + 「查看」
//     滚动定位闪光，回答完自动消失；
//   - 键盘（仅队首卡）：1-9 选择选项、Enter 提交/允许、Esc 取消/阻止；
//     输入框/文本域聚焦时不劫持按键。
// 答复链路与原 modal 完全一致：askUser.reply IPC → dequeueAskUser，数据层零改动。
// 持久化语义不变：待答在 runtime askUserBroker（观察快照重水合）、已答进 transcript、
// 超时由 runtime expiresAt 权威控制（UI 无定时器）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AskUserQuestionAnswer,
  AskUserReplyValue,
  AskUserRequestPayload,
  AskUserSignal,
  AskUserVerdict,
} from '@kodax-space/space-ipc-schema';
import { ASK_USER_BACK_SIGNAL, ASK_USER_CUSTOM_INPUT_SIGNAL } from '@kodax-space/space-ipc-schema';
import { CircleHelp } from 'lucide-react';
import { useAppStore } from '../../store/appStore.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import { buildAskUserInteractionKey } from './ask-user-state.js';
import { interactionsForSession } from '../session/sessionInteractionRouting.js';
import { AutoModeDiagnosticsPanel } from '../permission/AutoModeDiagnosticsPanel.js';
import {
  ASK_USER_ANSWER_MAX,
  allowsCustomInput,
  customInputLabel,
  isGuardrail,
  isQuestion,
  isOptionalSelection,
  selectionError,
  selectionHint,
  truncate,
  type MultiQuestionPayload,
  type QuestionPayload,
  type QuestionSelectionAnswer,
} from './askUserQuestionRules.js';

/** 数字键快选上限：1-9。超出部分仍可点击，只是不带角标。 */
const MAX_KEYBOARD_OPTIONS = 9;
/** 停靠条「查看」事件的窗口事件名（与 BottomBar 的 'kodax-space.focus-textarea' 同款模式）。 */
export const FOCUS_ASK_USER_EVENT = 'kodax-space.focus-ask-user';

const SEVERITY_STYLE: Record<AskUserSignal['severity'], string> = {
  info: 'bg-info/12 text-info',
  warning: 'bg-warn/12 text-warn',
  danger: 'bg-danger/12 text-danger',
};

interface SelectableOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

function AskUserInlineCard({
  request,
  isHead,
  stackCount,
  flashing,
}: {
  readonly request: AskUserRequestPayload;
  readonly isHead: boolean;
  readonly stackCount: number;
  readonly flashing: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const dequeue = useAppStore((s) => s.dequeueAskUser);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [customInputValue, setCustomInputValue] = useState('');
  const [selectedValues, setSelectedValues] = useState<ReadonlySet<string>>(new Set());
  const [multiQuestionIndex, setMultiQuestionIndex] = useState(0);
  const [multiAnswers, setMultiAnswers] = useState<Readonly<Record<string, AskUserQuestionAnswer>>>(
    {},
  );
  const initializedInteractionKeyRef = useRef<string | null>(null);

  const guardrail = isGuardrail(request) ? request : null;
  const multi: MultiQuestionPayload | null = request.kind === 'multi' ? request : null;
  const question = useMemo<QuestionPayload | null>(() => {
    if (isQuestion(request)) return request;
    const item = multi?.questions[multiQuestionIndex];
    return item
      ? {
          ...item,
          kind: 'select',
          reqId: multi.reqId,
          sessionId: multi.sessionId,
        }
      : null;
  }, [request, multi, multiQuestionIndex]);
  const kind = question ? question.kind : 'guardrail';
  const interactionKey = buildAskUserInteractionKey({
    requestId: request.reqId,
    kind,
    multiQuestionIndex,
    question,
  });

  useEffect(() => {
    setMultiQuestionIndex(0);
    setMultiAnswers({});
  }, [request.reqId]);

  useEffect(() => {
    // Store projections can replace `question` with a semantically identical
    // object while the card is open. Preserve the user's local selection in
    // that case, and reset only for a genuinely different interaction.
    if (initializedInteractionKeyRef.current === interactionKey) return;
    initializedInteractionKeyRef.current = interactionKey;
    setBusy(false);
    setErr(null);
    setInputValue(question && kind === 'input' ? (question.default ?? '') : '');
    setCustomInputValue(question && kind === 'select' ? (question.customInputDefault ?? '') : '');
    setSelectedValues(
      new Set(question && kind === 'select' && question.default ? [question.default] : []),
    );
  }, [interactionKey, kind, question]);

  const inputPreview = useMemo(() => {
    if (!guardrail?.toolCall.input) return null;
    try {
      return truncate(JSON.stringify(guardrail.toolCall.input, null, 2), 2000);
    } catch {
      return t('askUser.unserializableInput');
    }
  }, [guardrail, t]);

  const selectHint = useMemo(() => selectionHint(question, t), [question, t]);
  const showCustomInput = kind === 'select' && allowsCustomInput(question);

  /** 渲染顺序即键盘数字顺序：模型选项 → 自定义输入 → （back 信号在 options 里由模型给出）。 */
  const selectableOptions = useMemo<readonly SelectableOption[]>(() => {
    if (kind !== 'select' || !question) return [];
    const base: SelectableOption[] = (question.options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
      description: option.description,
    }));
    if (showCustomInput) {
      base.push({
        value: ASK_USER_CUSTOM_INPUT_SIGNAL,
        label: customInputLabel(question, t),
        description: undefined,
      });
    }
    return base;
  }, [kind, question, showCustomInput, t]);

  /** 数字键映射：排除 back 信号（无角标、不可逆直接 reply，不应占数字位被盲触发）。 */
  const keyboardOptions = useMemo(
    () => selectableOptions.filter((option) => option.value !== ASK_USER_BACK_SIGNAL),
    [selectableOptions],
  );

  const reply = useCallback(
    async (
      payload: { verdict: AskUserVerdict } | { value: AskUserReplyValue } | { cancelled: true },
    ): Promise<void> => {
      if (!window.kodaxSpace || busy) return;
      setBusy(true);
      setErr(null);
      try {
        const result = await window.kodaxSpace.invoke('askUser.reply', {
          reqId: request.reqId,
          ...payload,
        });
        if (!result.ok) {
          const code = result.error?.code ?? 'ERR_UNKNOWN';
          const message = result.error?.message ?? 'unknown error';
          setErr(`${code}: ${message}`);
          setBusy(false);
          return;
        }
        dequeue(request.reqId);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    },
    [request.reqId, busy, dequeue],
  );

  const answerGuardrail = useCallback(
    (verdict: AskUserVerdict): void => {
      void reply({ verdict });
    },
    [reply],
  );

  const submitQuestion = useCallback((): void => {
    if (kind === 'guardrail') return;
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

  const toggleOption = useCallback(
    (value: string): void => {
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
    },
    [question, kind, selectedValues, reply, t],
  );

  // 键盘语义（方向一）：仅队首卡接管按键，且必须「独占可答」——
  // ① defaultPrevented / 修饰键 / 按键重复 / 焦点在输入元素 → 让位；
  // ② 任何 FloatingSurfaceHost 浮层（PermissionModal/ConfirmDialog/popout）打开 → 让位，
  //    它们有自己的 Enter/Esc 语义（旧 modal 时代经 capture+stopImmediatePropagation 独占）；
  // ③ 作用域门控：焦点在对话流容器内或 body 上才接管——天然避开 BottomBar 芯片菜单、
  //    ModeSelector 数字键、role=dialog/menu 浮层与命令面板的 window 级监听，
  //    防止 Esc/Enter 双触发不可逆动作（cancel/allow/提交）；
  // ④ 处理后 preventDefault + stopImmediatePropagation 独占，阻断后续 window 监听。
  useEffect(() => {
    if (!isHead) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('[data-floating-surface-host]')) return;
      // M2：任何 ARIA 浮层（QuickAsk/Settings/CommandPalette/菜单/listbox）或 transcript
      // 搜索框打开时让位——它们的 Esc/Enter/数字键语义优先，防止一次按键双消费
      //（如 Esc 同时关搜索又 cancel 问题、Enter 同时确认对话框又提交答案）。
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-testid="transcript-search-bar"]',
        )
      )
        return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.isContentEditable) return;
      if (target.closest('input, textarea, select')) return;
      const ownsFocus =
        target.closest('[data-testid="conversation-stream"]') !== null ||
        target === document.body ||
        target === document.documentElement;
      if (!ownsFocus) return;
      // M1：焦点在另一张卡内时让位——键盘只归队首卡，不能把队首卡的答复
      // 提交给用户正在交互的那张卡（全部卡可点选作答，鼠标语义归所在卡）。
      const focusCardReq = target.closest<HTMLElement>('[data-ask-user-req]')?.dataset
        .askUserReq;
      if (focusCardReq !== undefined && focusCardReq !== request.reqId) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (kind === 'guardrail') answerGuardrail('allow');
        else submitQuestion();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (kind === 'guardrail') answerGuardrail('block');
        else cancelQuestion();
        return;
      }
      if (kind === 'select') {
        const digit = Number(event.key);
        if (Number.isInteger(digit) && digit >= 1 && digit <= keyboardOptions.length) {
          event.preventDefault();
          event.stopImmediatePropagation();
          toggleOption(keyboardOptions[digit - 1]!.value);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isHead,
    kind,
    keyboardOptions,
    answerGuardrail,
    submitQuestion,
    cancelQuestion,
    toggleOption,
    request.reqId,
  ]);

  const hasDangerSignal = guardrail?.signals?.some((s) => s.severity === 'danger') ?? false;
  const borderClass = guardrail
    ? hasDangerSignal
      ? 'border-l-danger'
      : 'border-l-warn'
    : 'border-l-info';
  const title =
    kind === 'guardrail'
      ? t('askUser.title.guardrail')
      : kind === 'input'
        ? t('askUser.title.input')
        : t('askUser.title.select');
  const customSelected = selectedValues.has(ASK_USER_CUSTOM_INPUT_SIGNAL);
  const customSubmitBlocked = customSelected && customInputValue.trim().length === 0;
  const questionSubmitDisabled =
    busy ||
    (kind === 'select' &&
      ((selectedValues.size === 0 && !(question ? isOptionalSelection(question) : false)) ||
        customSubmitBlocked));

  return (
    <div
      data-testid="ask-user-inline-card"
      data-ask-user-req={request.reqId}
      className={`ix-zone w-full max-w-[720px] rounded-lg border border-border-default border-l-2 ${borderClass} bg-surface-2 px-4 py-3 shadow-lg transition-colors duration-500 ${
        flashing ? 'border-info/70 bg-info/5' : ''
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-warn">
          {t('askUser.badge')}
        </span>
        <span className="text-xs font-semibold text-fg-primary">{title}</span>
        {stackCount > 1 && isHead && (
          <span className="font-mono text-[10px] text-fg-muted">
            {t('askUser.pendingCount', { count: stackCount - 1 })}
          </span>
        )}
        {isHead && kind !== 'guardrail' && (
          <span className="ml-auto hidden font-mono text-[10px] text-fg-faint sm:inline">
            {t('askUser.inline.kbdHint')}
          </span>
        )}
      </div>

      {guardrail ? (
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
              <div className="font-mono text-[10px] uppercase text-fg-muted">
                {t('askUser.input')}
              </div>
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
                {guardrail.signals.map((sig, idx) => (
                  <span
                    key={`${sig.type}-${idx}`}
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${SEVERITY_STYLE[sig.severity]}`}
                    title={sig.message}
                  >
                    {sig.type}
                  </span>
                ))}
              </div>
              {guardrail.signals.map((sig, idx) => (
                <div key={`msg-${sig.type}-${idx}`} className="pl-2 text-xs text-fg-muted">
                  · {truncate(sig.message, 200)}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => answerGuardrail('block')}
              className="rounded bg-surface-3 px-3 py-1.5 text-xs text-fg-primary hover:bg-hover-bg disabled:opacity-50"
            >
              {t('askUser.blockEsc')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => answerGuardrail('allow')}
              className="rounded border border-ok/50 bg-ok/15 px-3 py-1.5 text-xs font-medium text-ok hover:bg-ok/25 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('askUser.allowEnter')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {multi && (
            <div className="font-mono text-[10px] text-fg-muted">
              {multiQuestionIndex + 1}/{multi.questions.length}
            </div>
          )}
          {question?.header && (
            <div className="font-mono text-[10px] uppercase text-fg-muted">
              {truncate(question.header, 96)}
            </div>
          )}
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg-primary">
            {question ? truncate(question.question, 1500) : ''}
          </div>
          {selectHint && kind === 'select' && (
            <div className="text-xs text-fg-muted">{selectHint}</div>
          )}
          {kind === 'input' ? (
            <textarea
              value={inputValue}
              autoFocus={isHead}
              disabled={busy}
              onChange={(e) => setInputValue(e.target.value)}
              className="min-h-24 w-full resize-y rounded border border-border-default bg-surface px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent"
            />
          ) : (
            <div className="space-y-2">
              {selectableOptions.map((option) => {
                const selected = selectedValues.has(option.value);
                const isCustom = option.value === ASK_USER_CUSTOM_INPUT_SIGNAL;
                const keyIndex = keyboardOptions.indexOf(option);
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={busy}
                    onClick={() => toggleOption(option.value)}
                    className={`w-full rounded border px-3 py-2 text-left transition ${
                      selected
                        ? 'border-ok bg-ok/12 text-fg-primary'
                        : 'border-border-default bg-surface text-fg-primary hover:bg-hover-bg'
                    } disabled:opacity-50`}
                  >
                    <div className="flex items-center gap-2">
                      {question?.multiSelect ? (
                        <span
                          className={`h-3.5 w-3.5 rounded-sm border ${
                            selected ? 'border-ok bg-ok' : 'border-fg-muted'
                          }`}
                        />
                      ) : (
                        <span
                          className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
                            selected ? 'border-ok' : 'border-fg-muted'
                          }`}
                        >
                          {selected && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
                        </span>
                      )}
                      <span className="text-sm font-medium">{truncate(option.label, 160)}</span>
                      {keyIndex >= 0 && keyIndex < MAX_KEYBOARD_OPTIONS && (
                        <span className="ml-auto rounded border border-border-default px-1 font-mono text-[10px] text-fg-muted">
                          {keyIndex + 1}
                        </span>
                      )}
                    </div>
                    {!isCustom && option.description && (
                      <div className="mt-1 text-xs text-fg-muted">
                        {truncate(option.description, 300)}
                      </div>
                    )}
                    {isCustom && question?.customInputPrompt && (
                      <div className="mt-1 text-xs text-fg-muted">
                        {truncate(question.customInputPrompt, 300)}
                      </div>
                    )}
                  </button>
                );
              })}
              {customSelected && (
                <textarea
                  value={customInputValue}
                  disabled={busy}
                  onChange={(e) => {
                    setCustomInputValue(e.target.value);
                    if (err !== null && e.target.value.trim()) setErr(null);
                  }}
                  placeholder={question?.customInputPrompt ?? t('askUser.typeYourAnswer')}
                  className="min-h-20 w-full resize-y rounded border border-border-default bg-surface px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent"
                />
              )}
            </div>
          )}
          {err && <div className="font-mono text-xs text-danger">{err}</div>}
          <div className="flex items-center justify-end gap-2">
            {multi && multiQuestionIndex > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setMultiQuestionIndex((index) => Math.max(0, index - 1))}
                className="rounded bg-surface-3 px-3 py-1.5 text-xs text-fg-primary hover:bg-hover-bg disabled:opacity-50"
              >
                {t('askUser.back')}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={cancelQuestion}
              className="rounded bg-surface-3 px-3 py-1.5 text-xs text-fg-primary hover:bg-hover-bg disabled:opacity-50"
            >
              {t('askUser.cancelEsc')}
            </button>
            <button
              type="button"
              disabled={questionSubmitDisabled}
              onClick={submitQuestion}
              className="rounded border border-ok/50 bg-ok/15 px-3 py-1.5 text-xs font-medium text-ok hover:bg-ok/25 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('askUser.submit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 渲染当前会话的全部 pending ask-user 请求（对话流尾部），全部可点选作答；键盘归队首卡。 */
export function AskUserInlineStack(): JSX.Element | null {
  const queue = useAppStore((s) => s.askUserQueue);
  const sessionId = useAppStore((s) => s.currentSessionId);
  const requests = useMemo(
    () => interactionsForSession(queue, sessionId),
    [queue, sessionId],
  );
  const [flashingReqId, setFlashingReqId] = useState<string | null>(null);
  const flashTimerRef = useRef<number>(0);

  // 新卡到达不主动滚动：贴底场景由 ConversationStreamV2 的 ResizeObserver 追底权威处理
  //（wasAtBottomRef 含 isDocumentActiveForAutoFollow 判定），用户上翻历史时零打扰；
  // 召回定位交给停靠条「查看」。此处只处理该事件的定位 + 闪光。
  useEffect(() => {
    const onFocus = (): void => {
      const first = requests[0];
      if (!first) return;
      const card = document.querySelector(`[data-ask-user-req="${CSS.escape(first.reqId)}"]`);
      if (card instanceof HTMLElement) {
        // Shell 可能刚因同一事件退出右侧栏 max 模式（center-pane display:none 解除），
        // 隔两帧待布局稳定再测量；instant 滚动（默认 auto）避免平滑滚动绕过
        // ConversationStreamV2 的程序滚动守卫（markProgrammaticScroll）。
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            card.scrollIntoView({ block: 'center' });
            card.querySelector<HTMLElement>('button, textarea, input')?.focus();
          });
        });
      }
      setFlashingReqId(first.reqId);
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => {
        setFlashingReqId((current) => (current === first.reqId ? null : current));
      }, 900);
    };
    window.addEventListener(FOCUS_ASK_USER_EVENT, onFocus);
    return () => {
      window.removeEventListener(FOCUS_ASK_USER_EVENT, onFocus);
      window.clearTimeout(flashTimerRef.current);
    };
  }, [requests]);

  if (requests.length === 0) return null;
  return (
    <>
      {requests.map((request, index) => (
        <AskUserInlineCard
          key={request.reqId}
          request={request}
          isHead={index === 0}
          stackCount={requests.length}
          flashing={flashingReqId === request.reqId}
        />
      ))}
    </>
  );
}

/** composer 上方停靠召回条：pending>0 时常驻，全部处理完自动消失。 */
export function AskUserDockBar(): JSX.Element | null {
  const { t } = useI18n();
  const queue = useAppStore((s) => s.askUserQueue);
  const sessionId = useAppStore((s) => s.currentSessionId);
  const requests = useMemo(
    () => interactionsForSession(queue, sessionId),
    [queue, sessionId],
  );
  if (requests.length === 0) return null;
  const head = requests[0]!;
  const summary =
    'toolCall' in head
      ? t('askUser.dock.awaitingGuardrail', { tool: head.toolCall.toolName })
      : t('askUser.dock.awaitingQuestion', {
          question: truncate(
            head.kind === 'multi' ? (head.questions[0]?.question ?? '') : head.question,
            80,
          ),
        });
  return (
    <div
      data-testid="ask-user-dock-bar"
      className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/5 px-2.5 py-1.5 text-xs text-fg-secondary"
    >
      <CircleHelp className="h-3.5 w-3.5 flex-shrink-0 text-info" aria-hidden />
      <span className="min-w-[16px] rounded-full border border-info/40 bg-info/10 px-1 text-center font-mono font-semibold text-info">
        {requests.length}
      </span>
      {/* role=status 只包摘要文本：live region 每次队列变化重读时不应把「查看」按钮一起读出 */}
      <span role="status" className="min-w-0 flex-1 truncate">
        {summary}
      </span>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent(FOCUS_ASK_USER_EVENT))}
        className="rounded border border-info/40 px-2 py-0.5 text-info transition-colors hover:bg-info/10"
      >
        {t('askUser.dock.view')}
      </button>
    </div>
  );
}
