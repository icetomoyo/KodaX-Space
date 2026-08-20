// askUserQuestionRules 单测 — 锁住与 AskUserModal 时代完全一致的答复校验语义
// （替换 UI 形态不改协议行为）。纯函数、零运行时依赖，node:test 直跑。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowsCustomInput,
  customInputLabel,
  isGuardrail,
  isQuestion,
  isOptionalSelection,
  selectionError,
  selectionHint,
  truncate,
  type GuardrailPayload,
  type QuestionPayload,
  type Translate,
} from './askUserQuestionRules.js';

const t: Translate = (key, vars) => (vars === undefined ? key : `${key}:${JSON.stringify(vars)}`);

function selectQuestion(overrides: Partial<QuestionPayload> = {}): QuestionPayload {
  return {
    kind: 'select',
    reqId: 'req-1',
    sessionId: 's-1',
    question: '要用哪种包管理器？',
    options: [
      { label: 'pnpm', value: 'pnpm' },
      { label: 'npm', value: 'npm' },
    ],
    ...overrides,
  };
}

const guardrail: GuardrailPayload = {
  reqId: 'req-2',
  sessionId: 's-1',
  reason: '写入 node_modules',
  toolCall: { toolId: 't-1', toolName: 'bash' },
};

test('truncate keeps short strings and appends ellipsis beyond the cap', () => {
  assert.equal(truncate('abc', 5), 'abc');
  assert.equal(truncate('abcde', 5), 'abcde');
  assert.equal(truncate('abcdef', 5), 'abcd…');
});

test('isGuardrail / isQuestion discriminate the three payload shapes', () => {
  assert.equal(isGuardrail(guardrail), true);
  assert.equal(isQuestion(guardrail), false);
  assert.equal(isGuardrail(selectQuestion()), false);
  assert.equal(isQuestion(selectQuestion()), true);
  const inputQuestion = selectQuestion({ kind: 'input', options: undefined });
  assert.equal(isQuestion(inputQuestion), true);
});

test('selectionError: single-select requires at least one option', () => {
  assert.equal(selectionError(selectQuestion(), 0, t), 'askUser.selection.oneRequired');
  assert.equal(selectionError(selectQuestion(), 1, t), null);
});

test('selectionError: multi-select reports the real minimum first', () => {
  const multiMinOne = selectQuestion({ multiSelect: true, minSelections: 1 });
  assert.equal(selectionError(multiMinOne, 0, t), 'askUser.selection.minOne:{"min":1}');

  const multiMinTwo = selectQuestion({ multiSelect: true, minSelections: 2 });
  assert.equal(selectionError(multiMinTwo, 1, t), 'askUser.selection.min:{"min":2}');
});

test('selectionError: min_selections:0 multi-select may submit empty (FEATURE_222)', () => {
  const optional = selectQuestion({ multiSelect: true, minSelections: 0 });
  assert.equal(selectionError(optional, 0, t), null);
  assert.equal(selectionError(selectQuestion({ multiSelect: true, minSelections: 0 }), 0, t), null);
});

test('selectionError: max violations and the global 20 cap', () => {
  const multiMaxTwo = selectQuestion({ multiSelect: true, minSelections: 1, maxSelections: 2 });
  assert.equal(selectionError(multiMaxTwo, 3, t), 'askUser.selection.max:{"max":2}');

  const multiMaxOne = selectQuestion({ multiSelect: true, minSelections: 1, maxSelections: 1 });
  assert.equal(selectionError(multiMaxOne, 2, t), 'askUser.selection.maxOne:{"max":1}');

  const uncapped = selectQuestion({ multiSelect: true, minSelections: 1 });
  assert.equal(selectionError(uncapped, 21, t), 'askUser.selection.max:{"max":20}');
});

test('selectionHint covers optional / exact / range / one-sided bounds', () => {
  assert.equal(selectionHint(selectQuestion(), t), null);

  assert.equal(
    selectionHint(selectQuestion({ multiSelect: true, minSelections: 0, maxSelections: 3 }), t),
    'askUser.hint.optionalMax:{"max":3}',
  );
  assert.equal(
    selectionHint(selectQuestion({ multiSelect: true, minSelections: 0 }), t),
    'askUser.hint.optionalAny',
  );
  assert.equal(
    selectionHint(selectQuestion({ multiSelect: true, minSelections: 2, maxSelections: 2 }), t),
    'askUser.hint.exact:{"count":2}',
  );
  assert.equal(
    selectionHint(selectQuestion({ multiSelect: true, minSelections: 1, maxSelections: 3 }), t),
    'askUser.hint.range:{"min":1,"max":3}',
  );
  assert.equal(
    selectionHint(selectQuestion({ multiSelect: true, minSelections: 2 }), t),
    'askUser.hint.min:{"min":2}',
  );
  assert.equal(
    selectionHint(selectQuestion({ multiSelect: true, maxSelections: 2 }), t),
    'askUser.hint.max:{"max":2}',
  );
});

test('isOptionalSelection only accepts explicit min_selections:0 multi-select', () => {
  assert.equal(isOptionalSelection(selectQuestion({ multiSelect: true, minSelections: 0 })), true);
  assert.equal(isOptionalSelection(selectQuestion({ multiSelect: true, minSelections: 1 })), false);
  assert.equal(isOptionalSelection(selectQuestion()), false);
});

test('allowsCustomInput defaults on for select and off for input', () => {
  assert.equal(allowsCustomInput(selectQuestion()), true);
  assert.equal(allowsCustomInput(selectQuestion({ allowCustomInput: false })), false);
  assert.equal(allowsCustomInput(selectQuestion({ kind: 'input', options: undefined })), false);
  assert.equal(allowsCustomInput(null), false);
});

test('customInputLabel trims explicit labels and falls back to the generic one', () => {
  assert.equal(customInputLabel(selectQuestion({ customInputLabel: '  手动输入  ' }), t), '手动输入');
  assert.equal(customInputLabel(selectQuestion({ customInputLabel: '   ' }), t), 'askUser.other');
  assert.equal(customInputLabel(selectQuestion(), t), 'askUser.other');
});
