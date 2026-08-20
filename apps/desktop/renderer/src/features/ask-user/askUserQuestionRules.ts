// askUserQuestionRules — AskUserInline 的纯校验/摘要规则（无 React 依赖，node:test 可测）。
// 逻辑自 AskUserModal 原样迁移：答复语义（min/max 可选、min_selections:0 可选提交、
// 自定义输入必填）保持完全一致，替换 UI 形态不改变协议行为。

import type { AskUserRequestPayload } from '@kodax-space/space-ipc-schema';
import type { MessageKey } from '../../i18n/messages.js';

export const ASK_USER_ANSWER_MAX = 20;

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export type GuardrailPayload = Extract<AskUserRequestPayload, { toolCall: unknown }>;
export type QuestionPayload = Extract<AskUserRequestPayload, { question: string }>;
export type MultiQuestionPayload = Extract<AskUserRequestPayload, { kind: 'multi' }>;
export type QuestionSelectionAnswer = string | { kind: 'customInput'; value: string };

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function isGuardrail(payload: AskUserRequestPayload): payload is GuardrailPayload {
  return 'toolCall' in payload;
}

export function isQuestion(payload: AskUserRequestPayload): payload is QuestionPayload {
  return 'question' in payload;
}

/** A multi-select is optional when the model explicitly sets min_selections:0. */
export function isOptionalSelection(question: QuestionPayload): boolean {
  return question.multiSelect === true && question.minSelections === 0;
}

export function selectionError(
  question: QuestionPayload,
  count: number,
  t: Translate,
): string | null {
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

export function selectionHint(question: QuestionPayload | null, t: Translate): string | null {
  if (!question?.multiSelect) return null;
  const min = question.minSelections;
  const max = question.maxSelections;
  if (min === 0)
    return max !== undefined ? t('askUser.hint.optionalMax', { max }) : t('askUser.hint.optionalAny');
  if (min !== undefined && max !== undefined) {
    if (min === max) return t('askUser.hint.exact', { count: min });
    return t('askUser.hint.range', { min, max });
  }
  if (min !== undefined) return t('askUser.hint.min', { min });
  if (max !== undefined) return t('askUser.hint.max', { max });
  return null;
}

export function allowsCustomInput(question: QuestionPayload | null): boolean {
  return question?.kind === 'select' && question.allowCustomInput !== false;
}

export function customInputLabel(question: QuestionPayload, t: Translate): string {
  return question.customInputLabel?.trim() || t('askUser.other');
}
