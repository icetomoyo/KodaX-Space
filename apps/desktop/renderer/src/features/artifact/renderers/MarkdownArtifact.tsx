import { useEffect, useMemo, useState, type JSX, type SyntheticEvent } from 'react';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { math, mathHtml } from 'micromark-extension-math';
import katexCss from 'katex/dist/katex.min.css?inline';
import highlightDarkCss from 'highlight.js/styles/github-dark.css?inline';
import highlightLightCss from 'highlight.js/styles/github.css?inline';
import { useI18n } from '../../../i18n/I18nProvider';
import { openExternalUrl, openFileSmart } from '../../../lib/openPath.js';
import { useEffectiveDark } from '../../code/useEffectiveDark.js';
import { detectKind, mimeForPath } from '../../preview/binaryUtils.js';
import { resolveMarkdownWorkspacePath } from './markdownResources.js';

export { resolveMarkdownWorkspacePath } from './markdownResources.js';

export interface MarkdownArtifactResourceContext {
  /** Allowed workspace root used by the existing scope-checked file IPC. */
  readonly projectRoot: string;
  /** Project-relative path of the Markdown document. */
  readonly path: string;
}

export interface MarkdownArtifactProps {
  readonly content: string;
  readonly resourceContext?: MarkdownArtifactResourceContext;
}

interface MarkdownLabels {
  readonly copyCode: string;
  readonly copyCodeAria: string;
  readonly copied: string;
  readonly codeCopiedAria: string;
  readonly mermaidDiagram: string;
  readonly mermaidError: string;
  readonly mermaidLimit: string;
  readonly mermaidSource: string;
}

interface MarkdownEnhancementRequest {
  readonly html: string;
  readonly isDark: boolean;
  readonly labels: MarkdownLabels;
  readonly resourceContext?: MarkdownArtifactResourceContext;
}

interface EnhancedMarkdownSrcDoc {
  readonly request: MarkdownEnhancementRequest;
  readonly srcDoc: string;
}

const MAX_EMBEDDED_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_EMBEDDED_IMAGES = 16;
const MAX_HIGHLIGHTED_CODE_BLOCKS = 128;
const MAX_RENDERED_MERMAID_DIAGRAMS = 32;
const MERMAID_MAX_TEXT_SIZE = 50_000;
const MERMAID_MAX_EDGES = 500;
const BLOCKED_RAW_HTML_ELEMENTS = 'base, embed, frame, iframe, link, meta, object, script';

let mermaidRenderSequence = 0;
let mermaidRenderTail: Promise<void> = Promise.resolve();

/**
 * Mermaid keeps global configuration. Serialize render batches so a simultaneous
 * light/dark preview cannot change the theme halfway through another document.
 */
function queueMermaidRender<T>(render: () => Promise<T>): Promise<T> {
  const queued = mermaidRenderTail.catch(() => undefined).then(render);
  mermaidRenderTail = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

export function MarkdownArtifact({ content, resourceContext }: MarkdownArtifactProps): JSX.Element {
  const { t } = useI18n();
  const isDark = useEffectiveDark();
  const resourceProjectRoot = resourceContext?.projectRoot;
  const resourcePath = resourceContext?.path;
  const labels = useMemo<MarkdownLabels>(
    () => ({
      copyCode: t('markdown.copyCode'),
      copyCodeAria: t('markdown.copyCodeAria'),
      copied: t('markdown.copied'),
      codeCopiedAria: t('markdown.codeCopiedAria'),
      mermaidDiagram: t('artifact.mermaidDiagram'),
      mermaidError: t('artifact.mermaidRenderFailed'),
      mermaidLimit: t('artifact.mermaidLimit'),
      mermaidSource: t('artifact.mermaidSource'),
    }),
    [t],
  );
  const html = useMemo(() => markdownToHtml(content), [content]);
  const basicSrcDoc = useMemo(() => buildMarkdownSrcDoc(html, isDark), [html, isDark]);
  const enhancementRequest = useMemo<MarkdownEnhancementRequest>(
    () => ({
      html,
      isDark,
      labels,
      ...(resourceProjectRoot !== undefined && resourcePath !== undefined
        ? { resourceContext: { projectRoot: resourceProjectRoot, path: resourcePath } }
        : {}),
    }),
    [html, isDark, labels, resourcePath, resourceProjectRoot],
  );
  const [enhanced, setEnhanced] = useState<EnhancedMarkdownSrcDoc | null>(null);
  const srcDoc = enhanced?.request === enhancementRequest ? enhanced.srcDoc : basicSrcDoc;

  useEffect(() => {
    const controller = new AbortController();
    // Show parsed prose immediately while optional Mermaid/highlight chunks and
    // workspace-local images are prepared.
    void buildEnhancedMarkdownSrcDoc(
      enhancementRequest.html,
      enhancementRequest.isDark,
      enhancementRequest.labels,
      enhancementRequest.resourceContext,
      controller.signal,
    ).then(
      (enhancedSrcDoc) => {
        if (!controller.signal.aborted) {
          setEnhanced({ request: enhancementRequest, srcDoc: enhancedSrcDoc });
        }
      },
      () => {
        // The basic document is still useful if an enhancement unexpectedly fails.
      },
    );
    return () => {
      controller.abort();
    };
  }, [enhancementRequest]);

  function onFrameLoad(event: SyntheticEvent<HTMLIFrameElement>): void {
    const frameDocument = event.currentTarget.contentDocument;
    if (!frameDocument) return;

    frameDocument.addEventListener('click', (click) => {
      const frameWindow = frameDocument.defaultView;
      if (!frameWindow || !(click.target instanceof frameWindow.Element)) return;
      const target = click.target;

      const copyButton = target.closest<HTMLButtonElement>('[data-markdown-copy-code]');
      if (copyButton) {
        click.preventDefault();
        const code = copyButton.parentElement?.querySelector('pre code')?.textContent ?? '';
        void navigator.clipboard
          .writeText(code)
          .then(() => {
            copyButton.textContent = labels.copied;
            copyButton.setAttribute('aria-label', labels.codeCopiedAria);
            window.setTimeout(() => {
              if (copyButton.isConnected) {
                copyButton.textContent = labels.copyCode;
                copyButton.setAttribute('aria-label', labels.copyCodeAria);
              }
            }, 2_000);
          })
          .catch(() => undefined);
        return;
      }

      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href')?.trim() ?? '';
      if (href.startsWith('#')) return;

      click.preventDefault();
      if (/^https?:\/\//i.test(href)) {
        void openExternalUrl(href);
        return;
      }
      if (!enhancementRequest.resourceContext) return;
      const workspacePath = resolveMarkdownWorkspacePath(
        enhancementRequest.resourceContext.path,
        href,
      );
      if (workspacePath) {
        void openFileSmart(workspacePath, {
          projectRoot: enhancementRequest.resourceContext.projectRoot,
        });
      }
    });
  }

  return (
    <iframe
      title={t('artifact.markdownTitle')}
      srcDoc={srcDoc}
      // Scripts, forms, popups, and navigation stay disabled. Same-origin only lets
      // this trusted parent attach link/copy handlers to the inert document.
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      onLoad={onFrameLoad}
      className="w-full h-full flex-1 border-0 bg-surface"
      data-testid="markdown-artifact-preview"
    />
  );
}

function markdownToHtml(markdown: string): string {
  const rendered = micromark(markdown, {
    allowDangerousHtml: true,
    extensions: [gfm(), math()],
    htmlExtensions: [
      gfmHtml(),
      mathHtml({
        throwOnError: false,
        strict: 'ignore',
        trust: false,
        maxExpand: 1_000,
        maxSize: 20,
        output: 'htmlAndMathml',
      }),
    ],
  });
  const template = document.createElement('template');
  template.innerHTML = rendered;
  for (const element of template.content.querySelectorAll(BLOCKED_RAW_HTML_ELEMENTS)) {
    element.remove();
  }
  return template.innerHTML;
}

async function buildEnhancedMarkdownSrcDoc(
  html: string,
  isDark: boolean,
  labels: MarkdownLabels,
  resourceContext?: MarkdownArtifactResourceContext,
  signal?: AbortSignal,
): Promise<string> {
  const host = document.createElement('main');
  host.className = 'markdown-body';
  host.innerHTML = html;

  addHeadingAnchors(host);
  await Promise.all([
    highlightCodeBlocks(host, labels),
    embedWorkspaceImages(host, resourceContext),
  ]);
  if (!signal?.aborted) await renderMermaidBlocks(host, isDark, labels, signal);

  return buildMarkdownSrcDoc(host.outerHTML, isDark, true);
}

function addHeadingAnchors(host: HTMLElement): void {
  const occurrences = new Map<string, number>();
  for (const heading of host.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    if (heading.id) continue;
    const base = githubLikeSlug(heading.textContent ?? '') || 'section';
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    heading.id = occurrence === 0 ? base : `${base}-${occurrence}`;
  }
}

function githubLikeSlug(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

async function highlightCodeBlocks(host: HTMLElement, labels: MarkdownLabels): Promise<void> {
  const blocks = Array.from(host.querySelectorAll<HTMLElement>('pre > code')).filter(
    (code) => !languageForCode(code, 'mermaid'),
  );
  const highlighted = blocks
    .filter((code) => Array.from(code.classList).some((name) => name.startsWith('language-')))
    .slice(0, MAX_HIGHLIGHTED_CODE_BLOCKS);
  if (highlighted.length > 0) {
    const { default: highlighter } = await import('highlight.js/lib/common');
    for (const code of highlighted) {
      const languageClass = Array.from(code.classList).find((name) => name.startsWith('language-'));
      const language = languageClass?.slice('language-'.length).toLowerCase();
      if (!language || !highlighter.getLanguage(language)) continue;
      code.innerHTML = highlighter.highlight(code.textContent ?? '', {
        language,
        ignoreIllegals: true,
      }).value;
      code.classList.add('hljs');
    }
  }

  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre || pre.parentElement?.classList.contains('markdown-code-block')) continue;
    const wrapper = document.createElement('div');
    wrapper.className = 'markdown-code-block';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'markdown-copy-code';
    copy.dataset.markdownCopyCode = 'true';
    copy.textContent = labels.copyCode;
    copy.setAttribute('aria-label', labels.copyCodeAria);
    pre.replaceWith(wrapper);
    wrapper.append(copy, pre);
  }
}

function languageForCode(code: Element, language: string): boolean {
  return Array.from(code.classList).some(
    (name) => name.toLowerCase() === `language-${language.toLowerCase()}`,
  );
}

async function renderMermaidBlocks(
  host: HTMLElement,
  isDark: boolean,
  labels: MarkdownLabels,
  signal?: AbortSignal,
): Promise<void> {
  const allBlocks = Array.from(host.querySelectorAll<HTMLElement>('pre > code')).filter((code) =>
    languageForCode(code, 'mermaid'),
  );
  const blocks = allBlocks.slice(0, MAX_RENDERED_MERMAID_DIAGRAMS);
  if (blocks.length === 0) return;
  if (allBlocks.length > MAX_RENDERED_MERMAID_DIAGRAMS) {
    const firstSkipped = allBlocks[MAX_RENDERED_MERMAID_DIAGRAMS]?.parentElement;
    if (firstSkipped) {
      const notice = document.createElement('p');
      notice.className = 'mermaid-limit';
      notice.setAttribute('role', 'note');
      notice.textContent = labels.mermaidLimit;
      firstSkipped.before(notice);
    }
  }

  await queueMermaidRender(async () => {
    if (signal?.aborted) return;
    const { default: mermaid } = await import('mermaid');
    if (signal?.aborted) return;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDark ? 'dark' : 'default',
      darkMode: isDark,
      deterministicIds: true,
      deterministicIDSeed: 'kodax-space-markdown',
      suppressErrorRendering: true,
      maxTextSize: MERMAID_MAX_TEXT_SIZE,
      maxEdges: MERMAID_MAX_EDGES,
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif',
    });

    for (const code of blocks) {
      if (signal?.aborted) break;
      const pre = code.parentElement;
      if (!pre) continue;
      const definition = code.textContent ?? '';
      const renderId = `kodax-markdown-mermaid-${++mermaidRenderSequence}`;
      try {
        const rendered = await mermaid.render(renderId, definition);
        if (signal?.aborted) break;
        const figure = document.createElement('figure');
        figure.className = 'mermaid-diagram';
        figure.dataset.testid = 'mermaid-diagram';
        figure.setAttribute('aria-label', labels.mermaidDiagram);
        figure.innerHTML = rendered.svg;

        const source = document.createElement('details');
        source.className = 'mermaid-source';
        const summary = document.createElement('summary');
        summary.textContent = labels.mermaidSource;
        const sourcePre = document.createElement('pre');
        const sourceCode = document.createElement('code');
        sourceCode.textContent = definition;
        sourcePre.append(sourceCode);
        source.append(summary, sourcePre);
        figure.append(source);
        pre.replaceWith(figure);
      } catch {
        document.getElementById(renderId)?.remove();
        document.getElementById(`d${renderId}`)?.remove();
        if (signal?.aborted) break;
        const error = document.createElement('div');
        error.className = 'mermaid-error';
        error.setAttribute('role', 'alert');
        const message = document.createElement('strong');
        message.textContent = labels.mermaidError;
        pre.replaceWith(error);
        error.append(message, pre);
      }
    }
  });
}

async function embedWorkspaceImages(
  host: HTMLElement,
  context?: MarkdownArtifactResourceContext,
): Promise<void> {
  if (!context || !window.kodaxSpace) return;
  const images = Array.from(host.querySelectorAll<HTMLImageElement>('img[src]')).slice(
    0,
    MAX_EMBEDDED_IMAGES,
  );
  await Promise.all(
    images.map(async (image) => {
      const authoredSrc = image.getAttribute('src')?.trim() ?? '';
      const workspacePath = resolveMarkdownWorkspacePath(context.path, authoredSrc);
      if (!workspacePath || detectKind(workspacePath) !== 'image') return;
      try {
        const result = await window.kodaxSpace!.invoke('files.readBinary', {
          projectRoot: context.projectRoot,
          path: workspacePath,
          maxBytes: MAX_EMBEDDED_IMAGE_BYTES,
        });
        if (!result.ok || result.data.truncated) return;
        image.src = `data:${mimeForPath(workspacePath, 'image')};base64,${result.data.base64}`;
        image.removeAttribute('srcset');
        image.dataset.markdownResource = workspacePath;
      } catch {
        // Keep the authored URL and alt text when a resource is missing or denied.
      }
    }),
  );
}

function buildMarkdownSrcDoc(body: string, isDark: boolean, bodyIncludesMain = false): string {
  const syntaxCss = isDark ? highlightDarkCss : highlightLightCss;
  return `<!doctype html>
<html data-theme="${isDark ? 'dark' : 'light'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data: blob: https:; font-src data: app: http://127.0.0.1:* http://localhost:*; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'">
<style>${MARKDOWN_ARTIFACT_CSS}
${syntaxCss}
${katexCss}</style>
</head>
<body>
${bodyIncludesMain ? body : `<main class="markdown-body">${body}</main>`}
</body>
</html>`;
}

const MARKDOWN_ARTIFACT_CSS = `
:root {
  color-scheme: light;
  --canvas: #f2f0eb;
  --page: #ffffff;
  --fg: #24292f;
  --muted: #57606a;
  --border: rgba(31,35,40,.16);
  --link: #0969da;
  --code-bg: rgba(175,184,193,.2);
  --table-alt: rgba(208,215,222,.18);
  --button-bg: #f6f8fa;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --canvas: #0b0c10;
  --page: #111319;
  --fg: #e6e7eb;
  --muted: #9ca3af;
  --border: rgba(255,255,255,.12);
  --link: #8ab4ff;
  --code-bg: rgba(255,255,255,.08);
  --table-alt: rgba(255,255,255,.035);
  --button-bg: #24272f;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--canvas); color: var(--fg); }
body {
  padding: 18px;
  font: 15px/1.75 "Iowan Old Style", "Noto Serif SC", "Source Han Serif SC", "Songti SC", Georgia, serif;
}
.markdown-body {
  width: min(100%, 860px);
  min-height: calc(100vh - 36px);
  margin: 0 auto;
  padding: clamp(30px, 6vw, 58px) clamp(26px, 7vw, 68px) 64px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--page);
  box-shadow: 0 18px 54px rgba(0,0,0,.22);
}
a { color: var(--link); text-decoration: none; cursor: pointer; }
a:hover { text-decoration: underline; }
p { margin: 0 0 16px; }
br { line-height: 1.75; }
h1, h2, h3, h4, h5, h6 {
  scroll-margin-top: 20px;
  margin: 1.65em 0 .65em;
  line-height: 1.28;
  font-weight: 650;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
  letter-spacing: -.012em;
}
h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
h1 { font-size: 30px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
h2 { font-size: 23px; padding-bottom: 9px; border-bottom: 1px solid var(--border); }
h3 { font-size: 18px; }
h4 { font-size: 16px; }
ul, ol { margin: 0 0 16px 24px; padding: 0; }
li { margin: 4px 0; }
.contains-task-list { padding-left: 4px; }
.task-list-item { list-style: none; }
.task-list-item input { margin: 0 8px 0 0; accent-color: #22c55e; }
blockquote {
  margin: 0 0 16px;
  padding: 0 16px;
  color: var(--muted);
  border-left: 3px solid var(--border);
}
hr { border: 0; border-top: 1px solid var(--border); margin: 24px 0; }
code {
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--code-bg);
  font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}
pre {
  margin: 0 0 16px;
  padding: 14px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--code-bg);
}
pre code { padding: 0; background: transparent; }
.markdown-code-block { position: relative; margin: 0 0 16px; }
.markdown-code-block pre { margin: 0; padding-top: 38px; }
.markdown-copy-code {
  position: absolute;
  z-index: 1;
  top: 8px;
  right: 8px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--muted);
  background: var(--button-bg);
  font: 11px/1.4 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
}
.markdown-copy-code:hover, .markdown-copy-code:focus-visible { color: var(--fg); }
table {
  border-collapse: collapse;
  width: max-content;
  max-width: 100%;
  margin: 0 0 16px;
  display: block;
  overflow: auto;
}
th, td { border: 1px solid var(--border); padding: 6px 10px; }
tr:nth-child(even) { background: var(--table-alt); }
img { max-width: 100%; height: auto; }
picture { display: inline-block; max-width: 100%; }
[align="center"] { text-align: center; }
[align="right"] { text-align: right; }
.math-display { max-width: 100%; margin: 20px 0; overflow-x: auto; overflow-y: hidden; }
.mermaid-diagram {
  margin: 24px 0;
  padding: 16px;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--page) 92%, var(--canvas));
  text-align: center;
}
.mermaid-diagram > svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
.mermaid-source { margin-top: 12px; color: var(--muted); text-align: left; font: 12px/1.5 ui-sans-serif, system-ui, sans-serif; }
.mermaid-source summary { cursor: pointer; user-select: none; }
.mermaid-source pre { margin-top: 8px; }
.mermaid-error {
  margin: 20px 0;
  padding: 12px;
  border: 1px solid #ef444466;
  border-radius: 8px;
  color: #ef4444;
  background: #ef444412;
}
.mermaid-error pre { margin: 10px 0 0; color: var(--fg); }
.mermaid-limit {
  margin: 20px 0 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--muted);
  background: var(--table-alt);
  font: 12px/1.5 ui-sans-serif, system-ui, sans-serif;
}
.footnotes { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; }
@media (max-width: 620px) {
  body { padding: 0; }
  .markdown-body {
    min-height: 100vh;
    padding: 26px 22px 44px;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
}
`;
