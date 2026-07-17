import { useMemo, type JSX } from 'react';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { useI18n } from '../../../i18n/I18nProvider';

export interface MarkdownArtifactProps {
  content: string;
}

export function MarkdownArtifact({ content }: MarkdownArtifactProps): JSX.Element {
  const { t } = useI18n();
  const srcDoc = useMemo(() => buildMarkdownSrcDoc(content), [content]);

  return (
    <iframe
      title={t('artifact.markdownTitle')}
      srcDoc={srcDoc}
      sandbox=""
      referrerPolicy="no-referrer"
      className="w-full h-full flex-1 border-0 bg-surface"
      data-testid="markdown-artifact-preview"
    />
  );
}

function buildMarkdownSrcDoc(markdown: string): string {
  const body = micromark(markdown, {
    allowDangerousHtml: true,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'">
<style>${MARKDOWN_ARTIFACT_CSS}</style>
</head>
<body>
<main class="markdown-body">${body}</main>
</body>
</html>`;
}

const MARKDOWN_ARTIFACT_CSS = `
:root {
  color-scheme: dark;
  --canvas: #0b0c10;
  --page: #111319;
  --fg: #e6e7eb;
  --muted: #9ca3af;
  --border: rgba(255,255,255,.12);
  --link: #8ab4ff;
  --code-bg: rgba(255,255,255,.08);
  --table-alt: rgba(255,255,255,.035);
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--canvas); color: var(--fg); }
body {
  padding: 18px;
  font: 15px/1.75 "Iowan Old Style", "Noto Serif SC", "Source Han Serif SC", "Songti SC", Georgia, serif;
}
.markdown-body {
  width: min(100%, 780px);
  min-height: calc(100vh - 36px);
  margin: 0 auto;
  padding: clamp(30px, 6vw, 58px) clamp(26px, 7vw, 68px) 64px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--page);
  box-shadow: 0 18px 54px rgba(0,0,0,.22);
}
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
p { margin: 0 0 16px; }
br { line-height: 1.75; }
h1, h2, h3, h4, h5, h6 {
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
@media (prefers-color-scheme: light) {
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
  }
}
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
