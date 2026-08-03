import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../../renderer/src/i18n/I18nProvider.js';
import {
  Markdown,
  _clearMarkdownLruCacheForTesting,
} from '../../renderer/src/features/session/messages/Markdown.js';

function renderMarkdown(content: string): string {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
  _clearMarkdownLruCacheForTesting();

  try {
    return renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(Markdown, { content })),
    );
  } finally {
    if (navigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator;
    }
  }
}

test('inline code stays inline and uses the neutral semantic treatment', () => {
  const html = renderMarkdown('Run `npm test` before merging.');

  assert.match(html, /<code class="markdown-inline-code[^>]*>npm test<\/code>/);
  assert.doesNotMatch(html, /<pre/);
  assert.doesNotMatch(html, /text-danger|bg-danger/);
  assert.doesNotMatch(html, /data-markdown-copy-kind/);
});

test('an unlabeled fenced block is treated as a plain block with Copy text', () => {
  const html = renderMarkdown('```\nfirst line\nsecond line\n```');

  assert.match(
    html,
    /<pre[^>]*class="[^"]*markdown-code-block[^"]*"[^>]*data-markdown-code-kind="plain"/,
  );
  assert.match(html, /<code class="markdown-code-block-content">/);
  assert.match(html, /data-markdown-copy-kind="text"/);
  assert.match(html, />Copy text<\/button>/);
  assert.doesNotMatch(html, /markdown-inline-code|text-danger|bg-danger/);
});

test('an explicitly labeled fence exposes its language and keeps Copy code', () => {
  const html = renderMarkdown('```typescript\nconst answer: number = 42;\n```');

  assert.match(html, /data-markdown-code-kind="source"/);
  assert.match(html, /data-markdown-code-language="typescript"/);
  assert.match(html, /class="markdown-code-language"[^>]*>typescript<\/span>/);
  assert.match(html, /class="markdown-code-block-content hljs language-typescript"/);
  assert.match(html, /data-markdown-copy-kind="code"/);
  assert.match(html, />Copy code<\/button>/);
  assert.doesNotMatch(html, /markdown-inline-code/);
});

test('a single-line unlabeled fence remains a block during streaming-shaped output', () => {
  const html = renderMarkdown('```\nstatus: running');

  assert.match(html, /data-markdown-code-kind="plain"/);
  assert.match(html, /<code class="markdown-code-block-content">status: running\n<\/code>/);
});

test('blockquote uses the non-italic semantic treatment and preserves nested inline code', () => {
  const html = renderMarkdown('> Keep `npm test` running.');

  assert.match(html, /<blockquote class="markdown-blockquote[^"]*">/);
  assert.match(html, /<code class="markdown-inline-code[^>]*>npm test<\/code>/);
  assert.doesNotMatch(html, /<blockquote[^>]*\bitalic\b/);
  assert.doesNotMatch(html, /<pre|data-markdown-copy-kind/);
});
