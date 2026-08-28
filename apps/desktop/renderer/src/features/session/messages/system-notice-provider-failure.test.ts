import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ComponentType, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { I18nProvider } from '../../../i18n/I18nProvider.js';
import { SystemNotice } from './bubbles.js';

const TestI18nProvider = I18nProvider as ComponentType<PropsWithChildren<Record<string, never>>>;

function withEnglishLocale(render: () => void): void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => 'en-US', setItem: () => undefined },
  });
  try {
    render();
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', previousDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  }
}

test('provider failure notice renders the SDK safe message and structured diagnostics', () => {
  withEnglishLocale(() => {
    const markup = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        null,
        createElement(SystemNotice, {
          kind: 'system_notice',
          id: 'failure_notice',
          variant: 'error',
          text: 'Provider authentication failed.',
          failureKind: 'auth',
          runtimeRunId: 'run_failure_details',
          failureDetail: {
            failureKind: 'auth',
            stage: 'credential',
            providerErrorCode: 'authentication_failed',
            safeMessage: 'Provider authentication failed.',
            httpStatus: 401,
            upstreamErrorCode: 'invalid_api_key',
            requestId: 'req_failure_details',
          },
        }),
      ),
    );

    assert.match(markup, /Provider authentication failed\./);
    assert.match(markup, /Runtime failure details/);
    assert.match(markup, /authentication_failed/);
    assert.match(markup, /credential/);
    assert.match(markup, /401/);
    assert.match(markup, /req_failure_details/);
    assert.match(markup, /run_failure_details/);
  });
});

test('context-capacity notice shows the required and available token counts', () => {
  withEnglishLocale(() => {
    const markup = renderToStaticMarkup(
      createElement(
        TestI18nProvider,
        null,
        createElement(SystemNotice, {
          kind: 'system_notice',
          id: 'capacity_notice',
          variant: 'error',
          text: 'The request still exceeds the model context capacity after recovery.',
          failureKind: 'context_capacity',
          failureDetail: {
            failureKind: 'context_capacity',
            stage: 'runtime_control',
            providerErrorCode: 'context_capacity_exceeded',
            safeMessage: 'The request still exceeds the model context capacity after recovery.',
            contextTokens: { required: 143_400, available: 131_072 },
          },
        }),
      ),
    );

    assert.match(markup, /context_capacity_exceeded/);
    assert.match(markup, /143400 \/ 131072/);
  });
});
