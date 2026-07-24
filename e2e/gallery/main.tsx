// Gallery entry: render the Space static artifact renderers with sample data so
// the e2e (artifact-renderers.mjs) can assert each produces real DOM in a browser.
// Imports the actual renderer components from the app source (no copies).
// InteractiveHtmlArtifact requires Electron's app://space protocol and is covered
// separately by tests/e2e/artifact-html-runtime.spec.ts.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChartArtifact } from '../../apps/desktop/renderer/src/features/artifact/renderers/ChartArtifact';
import { HtmlArtifact } from '../../apps/desktop/renderer/src/features/artifact/renderers/HtmlArtifact';
import {
  SvgArtifact,
  ImageArtifact,
} from '../../apps/desktop/renderer/src/features/artifact/renderers/MediaArtifact';
import { MarkdownArtifact } from '../../apps/desktop/renderer/src/features/artifact/renderers/MarkdownArtifact';
import { I18nProvider } from '../../apps/desktop/renderer/src/i18n/I18nProvider';

const MARKDOWN = `# Gallery MD

Some **bold** text with inline math $E = mc^2$.

- [x] GFM task
- [ ] another task

\`\`\`js
const x = 1;
\`\`\`

\`\`\`mermaid
flowchart LR
  A[Markdown] --> B[Rendered diagram]
\`\`\`

\`\`\`mermaid
this is not a valid mermaid diagram
\`\`\`

<meta http-equiv="refresh" content="0;url=https://example.com/">`;

const chartSpec = {
  type: 'line',
  xKey: 'name',
  title: 'Gallery chart',
  data: [
    { name: 'Mon', v: 12 },
    { name: 'Tue', v: 19 },
    { name: 'Wed', v: 7 },
  ],
  series: [{ key: 'v', label: 'Visits' }],
};

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#f59e0b"/></svg>';

function App(): JSX.Element {
  return (
    <div>
      <div data-testid="chart" style={{ width: 460, height: 300, display: 'flex' }}>
        <ChartArtifact spec={chartSpec} />
      </div>
      <div data-testid="chart-bad" style={{ width: 460, height: 120, display: 'flex' }}>
        <ChartArtifact spec={{ type: 'pie', nope: true }} />
      </div>
      <div data-testid="html" style={{ width: 460, height: 160, display: 'flex' }}>
        <HtmlArtifact html={'<h1 id="hdr">Hello HTML</h1><p>static body</p>'} />
      </div>
      <div data-testid="svg" style={{ width: 200, height: 200, display: 'flex' }}>
        <SvgArtifact svg={svg} />
      </div>
      <div data-testid="image" style={{ width: 200, height: 200, display: 'flex' }}>
        <ImageArtifact src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />
      </div>
      <div data-testid="markdown" style={{ width: 640, height: 640, display: 'flex' }}>
        <MarkdownArtifact content={MARKDOWN} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
