import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ComponentType, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AutoModeDiagnosticsPanel } from '../../renderer/src/features/permission/AutoModeDiagnosticsPanel.js';
import { I18nProvider } from '../../renderer/src/i18n/I18nProvider.js';

const TestI18nProvider = I18nProvider as ComponentType<PropsWithChildren<Record<string, never>>>;

test('Auto[LLM] diagnostics panel explains provenance and labels auxiliary warnings as diagnostic', () => {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => 'en-US', setItem: () => undefined },
  });
  try {
    const markup = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        null,
        createElement(AutoModeDiagnosticsPanel, {
          diagnostics: {
            source: 'classifier_confirm',
            classifierAttempts: [
              {
                attempt: 1,
                outcome: 'confirm',
                observedProtocol: 'structured_v2',
                outputWarnings: ['missing_hazard'],
              },
            ],
          },
        }),
      ),
    );

    assert.match(markup, /Auto\[LLM\] decision details/);
    assert.match(markup, /LLM explicitly requested confirmation/);
    assert.match(markup, /diagnostic only; they do not change the LLM decision/);
    assert.match(markup, /hazard explanation missing/);
    assert.match(markup, /protocol structured_v2/);
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', previousDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  }
});
