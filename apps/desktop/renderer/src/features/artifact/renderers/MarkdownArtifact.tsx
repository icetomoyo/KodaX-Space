import { useMemo } from 'react';
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
  --bg: #0f1014;
  --fg: #e6e7eb;
  --muted: #9ca3af;
  --border: rgba(255,255,255,.12);
  --link: #8ab4ff;
  --code-bg: rgba(255,255,255,.08);
  --table-alt: rgba(255,255,255,.035);
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--fg); }
body {
  font: 14px/1.65 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.markdown-body {
  max-width: 980px;
  margin: 0 auto;
  padding: 24px 28px 36px;
}
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
p { margin: 0 0 16px; }
br { line-height: 1.75; }
h1, h2, h3, h4, h5, h6 {
  margin: 24px 0 12px;
  line-height: 1.25;
  font-weight: 650;
}
h1 { font-size: 28px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
h2 { font-size: 22px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
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
    --bg: #ffffff;
    --fg: #24292f;
    --muted: #57606a;
    --border: rgba(31,35,40,.16);
    --link: #0969da;
    --code-bg: rgba(175,184,193,.2);
    --table-alt: rgba(208,215,222,.18);
  }
}
`;
