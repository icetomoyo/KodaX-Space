import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchSpace, type SpaceInstance } from './fixtures.js';

test.setTimeout(180_000);

const DEFAULT_DOWNLOADS_ROOT = 'C:\\Users\\iceto\\Downloads';
const DOWNLOADS_ROOT = process.env.KODAX_ARTIFACT_E2E_DIR ?? DEFAULT_DOWNLOADS_ROOT;

type PreviewKind = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'video' | 'audio' | 'text';

interface FileCandidate {
  readonly absPath: string;
  readonly relPath: string;
  readonly ext: string;
  readonly size: number;
}

interface PreviewCase {
  readonly label: string;
  readonly kind: PreviewKind;
  readonly file: FileCandidate;
}

interface CaseGroup {
  readonly label: string;
  readonly kind: PreviewKind;
  readonly extensions: readonly string[];
  readonly maxBytes: number;
  readonly prefer?: (file: FileCandidate) => number;
}

const MB = 1024 * 1024;

const CASE_GROUPS: readonly CaseGroup[] = [
  {
    label: 'pdf',
    kind: 'pdf',
    extensions: ['.pdf'],
    maxBytes: 50 * MB,
    prefer: (file) =>
      /2604\.21748v1\.pdf|2604\.25850v3\.pdf|2601\.07055v1\.pdf/i.test(file.relPath) ? 0 : 1,
  },
  {
    label: 'image-gif',
    kind: 'image',
    extensions: ['.gif'],
    maxBytes: 50 * MB,
    prefer: (file) => (file.relPath.toLowerCase() === 'kodax.gif' ? 0 : 1),
  },
  {
    label: 'image-raster',
    kind: 'image',
    extensions: ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg'],
    maxBytes: 50 * MB,
    prefer: (file) =>
      file.ext === '.png' ? 0 : file.ext === '.jpeg' || file.ext === '.jpg' ? 1 : 2,
  },
  {
    label: 'video-mp4',
    kind: 'video',
    extensions: ['.mp4'],
    maxBytes: 50 * MB,
  },
  {
    label: 'text-config-log',
    kind: 'text',
    extensions: ['.log', '.ini', '.conf', '.txt', '.cfg', '.properties', '.csv', '.tsv'],
    maxBytes: 5 * MB,
    prefer: (file) =>
      file.ext === '.log' ? 0 : file.ext === '.ini' ? 1 : file.ext === '.conf' ? 2 : 3,
  },
  {
    label: 'docx',
    kind: 'docx',
    extensions: ['.docx'],
    maxBytes: 10 * MB,
  },
  {
    label: 'xlsx',
    kind: 'xlsx',
    extensions: ['.xlsx', '.xlsm', '.xls'],
    maxBytes: 10 * MB,
  },
  {
    label: 'pptx',
    kind: 'pptx',
    extensions: ['.pptx', '.pptm', '.ppt'],
    maxBytes: 25 * MB,
  },
  {
    label: 'audio',
    kind: 'audio',
    extensions: ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'],
    maxBytes: 50 * MB,
  },
];

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.idea',
  '.vscode',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
]);

function toPosixRelative(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join('/');
}

function cssString(value: string): string {
  return JSON.stringify(value);
}

async function collectCandidates(root: string): Promise<readonly FileCandidate[]> {
  const results: FileCandidate[] = [];
  const queue: string[] = [''];

  while (queue.length > 0 && results.length < 50_000) {
    const relDir = queue.shift() ?? '';
    const absDir = relDir ? path.join(root, relDir) : root;
    let entries: readonly import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= 50_000) break;
      if (entry.isSymbolicLink()) continue;
      const absPath = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          queue.push(relDir ? path.join(relDir, entry.name) : entry.name);
        }
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!CASE_GROUPS.some((group) => group.extensions.includes(ext))) continue;

      let stat;
      try {
        stat = await fs.stat(absPath);
      } catch {
        continue;
      }
      results.push({
        absPath,
        relPath: toPosixRelative(root, absPath),
        ext,
        size: stat.size,
      });
    }
  }

  return results;
}

function pickCases(files: readonly FileCandidate[]): readonly PreviewCase[] {
  const cases: PreviewCase[] = [];
  for (const group of CASE_GROUPS) {
    const candidates = files
      .filter((file) => group.extensions.includes(file.ext) && file.size <= group.maxBytes)
      .sort((a, b) => {
        const pa = group.prefer?.(a) ?? 0;
        const pb = group.prefer?.(b) ?? 0;
        if (pa !== pb) return pa - pb;
        return a.size - b.size;
      });
    const file = candidates[0];
    if (file) cases.push({ label: group.label, kind: group.kind, file });
  }
  return cases;
}

async function launchDownloadsSpace(testId: string): Promise<SpaceInstance> {
  const space = await launchSpace(testId);
  await space.page.setViewportSize({ width: 1500, height: 900 });
  await space.seedProject(DOWNLOADS_ROOT);
  await space.page.evaluate(() => {
    localStorage.setItem('kodax-space.smartPopoutEnabled', '0');
    localStorage.setItem('kodax-space.rightSidebarOpen', '0');
  });
  await space.page.reload();
  await space.page.waitForLoadState('domcontentloaded');
  return space;
}

async function openFilesPanel(page: Page): Promise<Locator> {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('kodax-space.open-files-workspace'));
  });
  const panel = page.getByTestId('files-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  return panel;
}

async function openFileViaFilesPanel(page: Page, file: FileCandidate): Promise<void> {
  const panel = await openFilesPanel(page);
  const search = panel.getByTestId('files-search-input');
  await search.fill(path.basename(file.relPath));
  await expect(panel.getByTestId('files-search-result').first()).toBeVisible({ timeout: 20_000 });
  const exact = panel.locator(`button[title=${cssString(file.relPath)}]`);
  await expect(exact).toBeVisible({ timeout: 20_000 });
  await exact.click();
  await expect(page.getByTestId('right-sidebar')).toBeVisible({ timeout: 10_000 });
}

async function expectNoPreviewError(sidebar: Locator): Promise<void> {
  await expect(sidebar).not.toContainText(
    /artifact refresh failed|artifact 刷新失败|input failed schema validation|file too large to preview|Unable to preview|无法 Artifact 预览|无法预览|too large/i,
    {
      timeout: 1_000,
    },
  );
}

async function expectMountedPreview(page: Page, previewCase: PreviewCase): Promise<void> {
  const sidebar = page.getByTestId('right-sidebar');
  await expect(sidebar.getByTestId('file-viewer')).toBeVisible({ timeout: 10_000 });
  await expect(sidebar.getByTestId('right-sidebar-tab-file')).toBeVisible();
  await expect(sidebar.getByTestId('rich-preview')).toHaveAttribute(
    'data-preview-kind',
    previewCase.kind,
    { timeout: 30_000 },
  );
  await expectNoPreviewError(sidebar);

  switch (previewCase.kind) {
    case 'pdf': {
      const viewer = sidebar.getByTestId('pdf-viewer');
      await expect(viewer).toBeVisible({ timeout: 30_000 });
      const canvas = viewer.locator('canvas').first();
      await expect(canvas).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(
          () =>
            canvas.evaluate((node) => {
              const c = node as HTMLCanvasElement;
              return c.width > 100 && c.height > 100;
            }),
          { timeout: 20_000 },
        )
        .toBe(true);
      break;
    }
    case 'image': {
      const imageViewer = sidebar.getByTestId('media-image-viewer');
      await expect(imageViewer).toBeVisible({ timeout: 20_000 });
      const image = imageViewer.locator('img');
      const largeGifFallback = imageViewer.getByTestId('media-large-gif-fallback');
      await expect
        .poll(
          async () => {
            if ((await largeGifFallback.count()) > 0 && (await largeGifFallback.isVisible()))
              return 'fallback';
            if ((await image.count()) > 0 && (await image.isVisible())) return 'image';
            return 'pending';
          },
          { timeout: 20_000 },
        )
        .not.toBe('pending');
      if ((await largeGifFallback.count()) > 0 && (await largeGifFallback.isVisible())) break;

      await expect
        .poll(
          () =>
            image.evaluate((node) => {
              const img = node as HTMLImageElement;
              return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
            }),
          { timeout: 20_000 },
        )
        .toBe(true);
      break;
    }
    case 'video': {
      const video = sidebar.getByTestId('media-video-viewer').locator('video');
      await expect(video).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(
          () =>
            video.evaluate((node) => {
              const v = node as HTMLVideoElement;
              return v.error === null && v.src.length > 0;
            }),
          { timeout: 10_000 },
        )
        .toBe(true);
      break;
    }
    case 'audio': {
      const audio = sidebar.getByTestId('media-audio-viewer').locator('audio');
      await expect(audio).toBeVisible({ timeout: 20_000 });
      break;
    }
    case 'text':
      await expect(sidebar.getByTestId('text-file-viewer')).toBeVisible({ timeout: 20_000 });
      break;
    case 'docx':
      await expect(sidebar.getByTestId('docx-viewer')).toBeVisible({ timeout: 20_000 });
      break;
    case 'xlsx':
      await expect(sidebar.getByTestId('xlsx-viewer').locator('table')).toBeVisible({
        timeout: 20_000,
      });
      break;
    case 'pptx':
      await expect(sidebar.getByTestId('pptx-viewer')).toBeVisible({ timeout: 30_000 });
      break;
    default: {
      const exhaustive: never = previewCase.kind;
      void exhaustive;
    }
  }

  await expect(sidebar.getByTestId('artifact-selector')).toHaveCount(0);
}

test('File Viewer previews real Downloads files without persisting them as Artifacts', async () => {
  const rootStat = await fs.stat(DOWNLOADS_ROOT).catch(() => null);
  test.skip(!rootStat?.isDirectory(), `Downloads test directory not found: ${DOWNLOADS_ROOT}`);

  const cases = pickCases(await collectCandidates(DOWNLOADS_ROOT));
  test.skip(cases.length < 5, `Need at least 5 previewable files under ${DOWNLOADS_ROOT}`);

  test.info().annotations.push({
    type: 'downloads-preview-cases',
    description: cases
      .map((item) => `${item.label}: ${item.file.relPath} (${(item.file.size / MB).toFixed(2)} MB)`)
      .join(' | '),
  });

  const space = await launchDownloadsSpace(`artifact-file-preview-${Date.now()}`);
  try {
    const { page } = space;

    for (const item of cases) {
      await test.step(`preview ${item.label}: ${item.file.relPath}`, async () => {
        await openFileViaFilesPanel(page, item.file);
        await expectMountedPreview(page, item);
      });
    }
  } finally {
    await space.close();
  }
});

test('File Viewer opens a project file before the first Session without exposing Artifact state', async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-file-viewer-'));
  const relPath = 'README.md';
  const absPath = path.join(projectDir, relPath);
  await fs.mkdir(path.join(projectDir, 'assets'), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'assets', 'pixel.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  await fs.writeFile(path.join(projectDir, 'RELATED.md'), '# Related document\n', 'utf8');
  await fs.writeFile(
    absPath,
    `# File Viewer

No Session is required. Inline math: $E = mc^2$.

## Details

- [x] GFM task list

\`\`\`ts
const viewer: string = 'highlighted';
\`\`\`

\`\`\`mermaid
flowchart LR
  Markdown --> Mermaid
\`\`\`

\`\`\`mermaid
not a valid diagram
\`\`\`

![Local pixel](./assets/pixel.png)

[Open related](./RELATED.md)

Footnote reference.[^1]

[^1]: Footnote content.

<img src="./missing.png" onerror="parent.__kodaxMarkdownScriptRan = true">

<meta http-equiv="refresh" content="0;url=https://example.com/">
`,
    'utf8',
  );
  const stat = await fs.stat(absPath);

  const space = await launchSpace(`file-viewer-no-session-${Date.now()}`);
  try {
    await space.page.setViewportSize({ width: 1500, height: 900 });
    await space.seedProject(projectDir);
    await space.page.evaluate(() => {
      localStorage.setItem('kodax-space.smartPopoutEnabled', '0');
      localStorage.setItem('kodax-space.rightSidebarOpen', '0');
    });
    await space.page.reload();
    await space.page.waitForLoadState('domcontentloaded');

    await openFileViaFilesPanel(space.page, {
      absPath,
      relPath,
      ext: '.md',
      size: stat.size,
    });

    const sidebar = space.page.getByTestId('right-sidebar');
    await expect(sidebar.getByTestId('right-sidebar-tab-file')).toBeVisible();
    await expect(sidebar.getByTestId('right-sidebar-tab-artifact')).toHaveCount(0);
    await expect(sidebar.getByTestId('file-viewer')).toBeVisible();
    await expect(sidebar.getByTestId('artifacts-view')).toHaveCount(0);
    const markdownPreview = sidebar.getByTestId('markdown-artifact-preview');
    await expect(markdownPreview).toBeVisible();
    await expect(
      markdownPreview.contentFrame().getByRole('heading', { name: 'File Viewer' }),
    ).toBeVisible();
    const markdownFrame = markdownPreview.contentFrame();
    await expect(markdownFrame.locator('h2#details')).toBeVisible();
    await expect(markdownFrame.locator('pre code.hljs')).toContainText('highlighted');
    await expect(markdownFrame.locator('.katex')).toBeVisible();
    await expect(markdownFrame.getByTestId('mermaid-diagram').locator('svg')).toBeVisible();
    await expect(markdownFrame.locator('.mermaid-error')).toContainText('not a valid diagram');
    await expect(
      markdownFrame.locator('img[data-markdown-resource="assets/pixel.png"]'),
    ).toBeVisible();
    await expect(markdownFrame.locator('.footnotes')).toContainText('Footnote content');
    await expect(markdownFrame.locator('meta[http-equiv="refresh"]')).toHaveCount(0);
    await expect
      .poll(() =>
        markdownPreview.evaluate(
          (frame) => (frame as HTMLIFrameElement).contentWindow?.location.href,
        ),
      )
      .toBe('about:srcdoc');
    await expect
      .poll(() =>
        space.page.evaluate(
          () =>
            (window as typeof window & { __kodaxMarkdownScriptRan?: boolean })
              .__kodaxMarkdownScriptRan,
        ),
      )
      .toBeUndefined();
    await expectNoPreviewError(sidebar);

    await markdownFrame.getByRole('link', { name: 'Open related' }).click();
    await expect(
      sidebar
        .getByTestId('markdown-artifact-preview')
        .contentFrame()
        .getByRole('heading', { name: 'Related document' }),
    ).toBeVisible();
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true });
  }
});

test('Project HTML File Viewer runs relative modules, assets, local fetch, storage, and workers in isolation', async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-project-web-preview-'));
  const relPath = 'web/index.html';
  const absPath = path.join(projectDir, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(
    absPath,
    `<!doctype html><html><head>
      <link rel="stylesheet" href="./style.css">
      <link rel="stylesheet" href="https://preview-assets.test/theme.css">
    </head><body>
      <button id="advance">Advance</button>
      <output id="state">waiting</output>
      <div id="authored-resource">authored-waiting</div>
      <div id="fetch-state">fetch-waiting</div>
      <div id="worker-state">worker-waiting</div>
      <div id="storage-state">storage-waiting</div>
      <script type="module" src="./app.js"></script>
      <script type="module" src="https://preview-assets.test/ready-gate.js"></script>
      <script src="https://preview-assets.test/presentation.js"></script>
    </body></html>`,
    'utf8',
  );
  await fs.writeFile(
    path.join(projectDir, 'web', 'style.css'),
    'body { color: rgb(12, 120, 74); } #state { display: block; }',
    'utf8',
  );
  await fs.writeFile(
    path.join(projectDir, 'web', 'data.json'),
    '{"label":"local-fetch-ok"}',
    'utf8',
  );
  await fs.writeFile(
    path.join(projectDir, 'web', 'worker.js'),
    'postMessage("worker-ok");',
    'utf8',
  );
  await fs.writeFile(
    path.join(projectDir, 'web', 'app.js'),
    `const state = document.querySelector('#state');
     document.querySelector('#advance').addEventListener('click', () => { state.textContent = 'clicked'; });
     const visits = Number(localStorage.getItem('visits') || '0') + 1;
     localStorage.setItem('visits', String(visits));
     document.querySelector('#storage-state').textContent = 'storage-' + visits;
     fetch('./data.json').then((r) => r.json()).then((data) => { document.querySelector('#fetch-state').textContent = data.label; });
     const worker = new Worker('./worker.js');
     worker.onmessage = (event) => { document.querySelector('#worker-state').textContent = event.data; worker.terminate(); };`,
    'utf8',
  );
  const stat = await fs.stat(absPath);
  let releaseReadyGate = (): void => undefined;
  let reportReadyGateRequest = (): void => undefined;
  const readyGateResponse = new Promise<void>((resolve) => {
    releaseReadyGate = resolve;
  });
  const readyGateRequested = new Promise<void>((resolve) => {
    reportReadyGateRequest = resolve;
  });

  const space = await launchSpace(`project-web-preview-${Date.now()}`);
  try {
    await space.page.route('https://preview-assets.test/**', async (route) => {
      if (route.request().url().endsWith('/ready-gate.js')) {
        reportReadyGateRequest();
        await readyGateResponse;
        await route.fulfill({
          contentType: 'text/javascript',
          body: 'document.documentElement.dataset.readyGateLoaded = "true";',
        });
        return;
      }
      if (route.request().url().endsWith('/theme.css')) {
        await route.fulfill({
          contentType: 'text/css',
          body: '#authored-resource { background-color: rgb(31, 41, 55); }',
        });
        return;
      }
      await route.fulfill({
        contentType: 'text/javascript',
        body: `document.querySelector('#authored-resource').textContent = 'authored-script-ok';`,
      });
    });
    await space.page.setViewportSize({ width: 1500, height: 900 });
    await space.seedProject(projectDir);
    await space.page.evaluate(() => {
      localStorage.setItem('kodax-space.smartPopoutEnabled', '0');
      localStorage.setItem('kodax-space.rightSidebarOpen', '0');
    });
    await space.page.reload();
    await space.page.waitForLoadState('domcontentloaded');

    await openFileViaFilesPanel(space.page, {
      absPath,
      relPath,
      ext: '.html',
      size: stat.size,
    });

    const sidebar = space.page.getByTestId('right-sidebar');
    const preview = sidebar.getByTestId('project-web-preview');
    await expect(preview).toBeVisible({ timeout: 10_000 });
    const frameHost = preview.locator('iframe');
    const frame = frameHost.contentFrame();
    await readyGateRequested;
    await expect(frame.locator('#storage-state')).toHaveText('storage-1');
    await expect(frameHost).toHaveAttribute('data-ready', 'false');
    await frame.getByRole('button', { name: 'Advance' }).click();
    await expect(frame.locator('#state')).toHaveText('waiting');

    releaseReadyGate();
    await expect(frameHost).toHaveAttribute('data-ready', 'true', { timeout: 10_000 });
    await expect(frame.locator('html')).toHaveAttribute('data-ready-gate-loaded', 'true');
    await expect(frame.locator('body')).toHaveCSS('color', 'rgb(12, 120, 74)');
    await expect(frame.locator('#fetch-state')).toHaveText('local-fetch-ok');
    await expect(frame.locator('#worker-state')).toHaveText('worker-ok');
    await expect(frame.locator('#storage-state')).toHaveText('storage-1');
    await expect(frame.locator('#authored-resource')).toHaveText('authored-script-ok');
    await expect(frame.locator('#authored-resource')).toHaveCSS(
      'background-color',
      'rgb(31, 41, 55)',
    );
    await frame.getByRole('button', { name: 'Advance' }).click();
    await expect(frame.locator('#state')).toHaveText('clicked');
    expect(await frame.locator('body').evaluate(() => typeof window.kodaxSpace)).toBe('undefined');
    expect(
      await frame.locator('body').evaluate(() => {
        try {
          return parent.document.title;
        } catch {
          return 'cross-origin-blocked';
        }
      }),
    ).toBe('cross-origin-blocked');

    const network = sidebar.getByRole('button', {
      name: 'Allow additional HTTPS/WSS requests for this trusted page',
    });
    await expect(network).toHaveAttribute('aria-pressed', 'false');
    await expect(network).toHaveAttribute(
      'title',
      'Current: Limited to local and page-authored display resources',
    );
    await network.click();
    const enabledNetwork = sidebar.getByRole('button', {
      name: 'Limit this page to local and authored display resources',
    });
    await expect(enabledNetwork).toHaveAttribute('aria-pressed', 'true');
    await expect(enabledNetwork).toHaveAttribute(
      'title',
      'Current: Additional HTTPS/WSS requests are allowed for this page',
    );
    await expect(sidebar.getByTestId('web-preview-diagnostic')).toHaveCount(0);
    await expectNoPreviewError(sidebar);
  } finally {
    releaseReadyGate();
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true });
  }
});

test('PDF File Viewer supports keyboard paging after focus', async () => {
  const rootStat = await fs.stat(DOWNLOADS_ROOT).catch(() => null);
  test.skip(!rootStat?.isDirectory(), `Downloads test directory not found: ${DOWNLOADS_ROOT}`);

  const pdfCase = pickCases(await collectCandidates(DOWNLOADS_ROOT)).find(
    (item) => item.kind === 'pdf',
  );
  test.skip(!pdfCase, `No PDF under ${DOWNLOADS_ROOT}`);
  if (!pdfCase) return;

  const space = await launchDownloadsSpace(`artifact-pdf-keyboard-${Date.now()}`);
  try {
    const { page } = space;
    await openFileViaFilesPanel(page, pdfCase.file);
    await expectMountedPreview(page, pdfCase);

    const sidebar = page.getByTestId('right-sidebar');
    const viewer = sidebar.getByTestId('pdf-viewer');
    await viewer.click();

    const pageLabel = viewer.getByTestId('pdf-page-counter');
    await expect(pageLabel).toBeVisible({ timeout: 10_000 });
    const initial = (await pageLabel.textContent())?.trim() ?? '';
    const match = /^(\d+)\s*\/\s*(\d+)$/.exec(initial);
    test.skip(
      !match || Number(match[2]) < 2,
      `Selected PDF only has one page: ${pdfCase.file.relPath}`,
    );

    await page.keyboard.press('PageDown');
    await expect
      .poll(async () => (await pageLabel.textContent())?.trim() ?? '', { timeout: 10_000 })
      .not.toBe(initial);

    await page.keyboard.press('Home');
    await expect
      .poll(async () => (await pageLabel.textContent())?.trim() ?? '', { timeout: 10_000 })
      .toMatch(/^1\s*\//);
  } finally {
    await space.close();
  }
});
