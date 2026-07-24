// E2E (F059): the Space static artifact renderers (Chart/Html/Media/Markdown) produce real
// DOM in a real browser. Builds a standalone gallery (no app/session needed) and
// asserts: recharts <svg> from a chart spec, invalid spec → fallback (not crash),
// sandboxed <iframe> rendering static HTML, SVG/image via <img>.
// Interactive HTML depends on Electron's app://space protocol and is covered by
// tests/e2e/artifact-html-runtime.spec.ts.
//
// 这覆盖 F056/F059 渲染器的"真渲染"边界(feedback_mock_fidelity)。code/doc 渲染器
// (Monaco worker / IPC readBinary) 依赖完整应用,留作人工/打包验证。
//
// 运行: env -u ELECTRON_RUN_AS_NODE node e2e/artifact-renderers.mjs

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const galleryDir = join(__dirname, 'gallery');
const distDir = join(galleryDir, 'dist');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function safeJoin(root, rel) {
  const rootAbs = resolve(root);
  const cand = resolve(rootAbs, normalize(rel.replace(/^\/+/, '')));
  const withSep = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep;
  return cand === rootAbs || cand.startsWith(withSep) ? cand : null;
}

async function main() {
  // 1) Build the gallery.
  console.log('[e2e] building artifact renderer gallery…');
  execFileSync('npx', ['vite', 'build', '--config', join(galleryDir, 'vite.config.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
    shell: process.platform === 'win32',
  });
  ok(existsSync(join(distDir, 'index.html')), 'gallery built (dist/index.html present)');

  // 2) Serve dist.
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    const rel = pathname === '/' ? '/index.html' : pathname;
    const abs = safeJoin(distDir, rel);
    if (!abs || !existsSync(abs) || !statSync(abs).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream',
    });
    res.end(readFileSync(abs));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  // 3) Drive a real browser.
  let browser;
  const consoleErrors = [];
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    await page.goto(`${origin}/`, { waitUntil: 'load' });

    // ChartArtifact → recharts svg + a line path. (.first(): recharts also emits a
    // tiny legend-icon svg.recharts-surface, so the selector matches >1.)
    const chartSurface = page.locator('[data-testid="chart"] svg.recharts-surface').first();
    await chartSurface.waitFor({ state: 'visible', timeout: 15_000 });
    ok(true, 'ChartArtifact rendered recharts <svg.recharts-surface>');
    const lineCount = await page.locator('[data-testid="chart"] path.recharts-line-curve').count();
    ok(lineCount >= 1, `chart line path present (count=${lineCount})`);

    // Invalid chart spec → graceful fallback (no recharts svg, panel didn't crash).
    const badSvg = await page.locator('[data-testid="chart-bad"] svg.recharts-surface').count();
    ok(badSvg === 0, 'invalid chart spec → no svg (fell back, did not render)');
    const badText = await page.locator('[data-testid="chart-bad"]').innerText();
    ok(/无法渲染|invalid/i.test(badText), 'invalid chart spec shows fallback message');

    // HtmlArtifact → sandboxed iframe rendering the static HTML.
    const iframe = page.locator('[data-testid="html"] iframe');
    ok((await iframe.count()) === 1, 'HtmlArtifact rendered an <iframe>');
    ok((await iframe.getAttribute('sandbox')) === '', 'iframe sandbox is empty (scripts disabled)');
    const hdr = page.frameLocator('[data-testid="html"] iframe').locator('#hdr');
    await hdr.waitFor({ state: 'attached', timeout: 10_000 });
    ok((await hdr.innerText()).includes('Hello HTML'), 'iframe rendered the static HTML content');

    // SvgArtifact + ImageArtifact → <img> with data: src.
    const svgImg = page.locator('[data-testid="svg"] img');
    ok(
      (await svgImg.count()) === 1 &&
        (await svgImg.getAttribute('src'))?.startsWith('data:image/svg+xml'),
      'SvgArtifact rendered <img> data URI',
    );
    const imgEl = page.locator('[data-testid="image"] img');
    ok((await imgEl.count()) === 1, 'ImageArtifact rendered <img>');

    // Markdown uses the production isolated document renderer, including its
    // pre-rendered Mermaid, KaTeX, and syntax-highlight enhancement path.
    const markdownIframe = page.locator('[data-testid="markdown"] iframe');
    ok(
      (await markdownIframe.getAttribute('sandbox')) === 'allow-same-origin',
      'Markdown iframe remains scriptless and parent-readable',
    );
    const markdownFrame = page.frameLocator('[data-testid="markdown"] iframe');
    const mdH1 = markdownFrame.locator('h1');
    await mdH1.waitFor({ state: 'attached', timeout: 10_000 });
    ok((await mdH1.innerText()).includes('Gallery MD'), 'Markdown rendered <h1>');
    ok((await markdownFrame.locator('strong').count()) >= 1, 'Markdown rendered <strong> (bold)');
    ok(
      (await markdownFrame.locator('pre code.hljs').count()) >= 1,
      'Markdown syntax-highlighted a fenced code block',
    );
    ok((await markdownFrame.locator('.katex').count()) >= 1, 'Markdown rendered KaTeX math');
    await markdownFrame.locator('[data-testid="mermaid-diagram"] svg').waitFor({
      state: 'attached',
      timeout: 15_000,
    });
    ok(true, 'Markdown rendered a Mermaid diagram to inert SVG');
    ok(
      (await markdownFrame.locator('.mermaid-error').count()) === 1,
      'Invalid Mermaid shows an inline fallback without dropping the document',
    );
    ok(
      (await markdownFrame.locator('meta[http-equiv="refresh"]').count()) === 0,
      'Markdown removes raw document-navigation metadata',
    );
    ok(
      (await markdownIframe.evaluate((frame) => frame.contentWindow?.location.href)) ===
        'about:srcdoc',
      'Markdown iframe stayed on its inert srcdoc',
    );

    ok(consoleErrors.length === 0, `no browser console/page errors (${consoleErrors.length})`);
    if (consoleErrors.length) console.log('  errors:', consoleErrors.slice(0, 4));
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
}

main()
  .then(() => {
    console.log(
      failures === 0
        ? '\nPASS: artifact renderers render in-browser'
        : `\nFAIL: ${failures} assertion(s)`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('\nFAIL (threw):', err);
    process.exit(1);
  });
