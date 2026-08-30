import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ComponentType, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ASK_USER_CUSTOM_INPUT_SIGNAL } from '@kodax-space/space-ipc-schema';

import { I18nProvider } from '../../i18n/I18nProvider.js';
import { AskUserGuardrailContent } from './AskUserGuardrailContent.js';
import { AskUserQuestionContent } from './AskUserQuestionContent.js';

const TestI18nProvider = I18nProvider as ComponentType<PropsWithChildren<Record<string, never>>>;

function withEnglishLocale(run: () => void): void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => 'en-US', setItem: () => undefined },
  });
  try {
    run();
  } finally {
    if (previousDescriptor) Object.defineProperty(globalThis, 'localStorage', previousDescriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('single-select AskUser content uses a native radio group and exposes errors', () => {
  withEnglishLocale(() => {
    const options = [
      { value: 'first', label: 'First' },
      { value: 'second', label: 'Second' },
    ];
    const markup = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        null,
        createElement(AskUserQuestionContent, {
          question: {
            kind: 'select',
            reqId: 'request-1',
            sessionId: 'session-1',
            question: 'Choose one',
            options,
          },
          selectHint: null,
          selectableOptions: options,
          keyboardOptions: options,
          selectedValues: new Set(['second']),
          inputValue: '',
          customInputValue: '',
          busy: false,
          error: 'Choose one option.',
          errorId: 'ask-user-error',
          submitDisabled: false,
          isHead: true,
          onInputChange: () => undefined,
          onCustomInputChange: () => undefined,
          onTextInputKeyDown: () => undefined,
          onToggleOption: () => undefined,
          onCancel: () => undefined,
          onSubmit: () => undefined,
        }),
      ),
    );

    assert.match(markup, /<fieldset[^>]*aria-labelledby="ask-user-error-question"/);
    assert.match(markup, /<input type="radio"[^>]*name="ask-user-error-selection"/);
    assert.match(markup, /<input type="radio"[^>]*checked=""/);
    assert.match(markup, /aria-describedby="ask-user-error"/);
    assert.match(markup, /id="ask-user-error" role="alert"/);
  });
});

test('free-text AskUser content names its textarea from the visible question', () => {
  withEnglishLocale(() => {
    const markup = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        null,
        createElement(AskUserQuestionContent, {
          question: {
            kind: 'input',
            reqId: 'request-input',
            sessionId: 'session-1',
            question: 'Explain the change',
          },
          selectHint: null,
          selectableOptions: [],
          keyboardOptions: [],
          selectedValues: new Set<string>(),
          inputValue: '',
          customInputValue: '',
          busy: false,
          error: null,
          errorId: 'ask-user-input',
          submitDisabled: false,
          isHead: true,
          onInputChange: () => undefined,
          onCustomInputChange: () => undefined,
          onTextInputKeyDown: () => undefined,
          onToggleOption: () => undefined,
          onCancel: () => undefined,
          onSubmit: () => undefined,
        }),
      ),
    );

    assert.match(markup, /id="ask-user-input-question"/);
    assert.match(markup, /<textarea[^>]*aria-labelledby="ask-user-input-question"/);
  });
});

test('custom AskUser input combines the question and custom prompt as its accessible name', () => {
  withEnglishLocale(() => {
    const options = [{ value: 'first', label: 'First' }];
    const customOption = { value: ASK_USER_CUSTOM_INPUT_SIGNAL, label: 'Other' };
    const markup = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        null,
        createElement(AskUserQuestionContent, {
          question: {
            kind: 'select',
            reqId: 'request-custom',
            sessionId: 'session-1',
            question: 'Choose or describe another option',
            options,
            customInputPrompt: 'Describe the alternative',
          },
          selectHint: null,
          selectableOptions: [...options, customOption],
          keyboardOptions: [...options, customOption],
          selectedValues: new Set([ASK_USER_CUSTOM_INPUT_SIGNAL]),
          inputValue: '',
          customInputValue: '',
          busy: false,
          error: null,
          errorId: 'ask-user-custom',
          submitDisabled: true,
          isHead: true,
          onInputChange: () => undefined,
          onCustomInputChange: () => undefined,
          onTextInputKeyDown: () => undefined,
          onToggleOption: () => undefined,
          onCancel: () => undefined,
          onSubmit: () => undefined,
        }),
      ),
    );

    assert.match(markup, /id="ask-user-custom-custom-input-label"/);
    assert.match(
      markup,
      /<textarea[^>]*aria-labelledby="ask-user-custom-question ask-user-custom-custom-input-label"/,
    );
  });
});

test('guardrail reply failures are visible as alerts', () => {
  withEnglishLocale(() => {
    const markup = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        null,
        createElement(AskUserGuardrailContent, {
          guardrail: {
            kind: 'guardrail',
            reqId: 'request-2',
            sessionId: 'session-1',
            reason: 'Review this command.',
            toolCall: { toolId: 'tool-1', toolName: 'bash' },
          },
          busy: false,
          error: 'Space bridge is unavailable.',
          errorId: 'guardrail-error',
          onAnswer: () => undefined,
        }),
      ),
    );

    assert.match(markup, /id="guardrail-error" role="alert"/);
    assert.match(markup, /data-ask-user-primary-focus="true"/);
  });
});
