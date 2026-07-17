import { expect, test } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { launchSpace, type SpaceInstance } from './fixtures.js';

test.setTimeout(90_000);

interface InvokeEnvelope<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: { readonly message?: string };
}

function projectFilePreviewSessionId(projectRoot: string): string {
  const normalized = projectRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `__project_file_preview___${hash.toString(36)}`;
}

async function launchArtifactSpace(
  testId: string,
): Promise<{ space: SpaceInstance; projectDir: string }> {
  const space = await launchSpace(testId);
  const projectDir = path.join(space.testDataDir, 'artifact-html-project');
  await fs.mkdir(projectDir, { recursive: true });
  await space.seedProject(projectDir);
  await space.page.evaluate(() => {
    localStorage.setItem('kodax-space.smartPopoutEnabled', '0');
  });
  await space.page.reload();
  await space.page.waitForLoadState('domcontentloaded');
  await space.page.getByRole('button', { name: 'Show right sidebar' }).click();
  await expect(space.page.getByTestId('right-sidebar')).toBeVisible({ timeout: 10_000 });
  return { space, projectDir };
}

async function focusArtifact(space: SpaceInstance, detail: Record<string, unknown>): Promise<void> {
  await space.page.evaluate((payload) => {
    window.dispatchEvent(new CustomEvent('kodax-space.focus-artifact', { detail: payload }));
  }, detail);
}

async function invokeArtifactCreate(
  space: SpaceInstance,
  input: Record<string, unknown>,
): Promise<{ id: string; version: number }> {
  const result = await space.page.evaluate(async (payload) => {
    const bridge = (
      window as unknown as {
        kodaxSpace: {
          invoke: (
            channel: string,
            input: unknown,
          ) => Promise<InvokeEnvelope<{ id: string; version: number }>>;
        };
      }
    ).kodaxSpace;
    return bridge.invoke('artifact.create', payload);
  }, input);
  if (!result.ok || !result.data) {
    throw new Error(result.error?.message ?? 'artifact.create failed');
  }
  return result.data;
}

test('interactive HTML Artifact executes inline runtime code inside the restricted frame', async () => {
  const { space } = await launchArtifactSpace(`artifact-html-runtime-${Date.now()}`);
  try {
    await focusArtifact(space, {
      id: 'runtime-html',
      snapshot: {
        id: 'runtime-html',
        kind: 'interactive-html',
        title: 'Runtime HTML',
        content:
          '<!doctype html><html><body><main id="runtime-state" style="opacity:0">waiting</main>' +
          '<script>const el=document.getElementById("runtime-state");el.textContent="script-ran";el.style.opacity="1";</script>' +
          '</body></html>',
      },
    });

    const frame = space.page.frameLocator('iframe[title="Interactive HTML artifact"]');
    await expect(frame.locator('#runtime-state')).toHaveText('script-ran', { timeout: 10_000 });
    await expect(frame.locator('#runtime-state')).toHaveCSS('opacity', '1');
  } finally {
    await space.close();
  }
});

test('interactive HTML Artifact keeps inline controls and timer-driven playback working', async () => {
  const { space } = await launchArtifactSpace(`artifact-html-controls-${Date.now()}`);
  try {
    const fixturePath = process.env.KODAX_ARTIFACT_HTML_FIXTURE;
    const content = fixturePath
      ? await fs.readFile(fixturePath, 'utf8')
      : `<!doctype html><html><body>
          <button id="next" onclick="next()">开始演示 ▶</button>
          <button id="auto" onclick="toggleAuto()">⏯ 自动</button>
          <div id="sAcc">—</div><div id="step">0</div>
          <script>
            var cur=0, auto=false, autoT=null;
            function render(){document.getElementById('step').textContent=String(cur);document.getElementById('sAcc').textContent=cur>=1?'96.8%':'—'}
            function next(){cur+=1;render()}
            function toggleAuto(){auto=!auto;document.getElementById('auto').classList.toggle('on',auto);if(auto){next();autoT=setInterval(next,4500)}else{clearInterval(autoT);autoT=null}}
            render();
          </script>
        </body></html>`;

    await focusArtifact(space, {
      id: 'runtime-controls-html',
      snapshot: {
        id: 'runtime-controls-html',
        kind: 'interactive-html',
        title: 'Runtime Controls HTML',
        content,
      },
    });

    const frame = space.page.frameLocator('iframe[title="Interactive HTML artifact"]');
    await frame.locator('#next').click();
    await expect(frame.locator('#sAcc')).toHaveText('96.8%', { timeout: 10_000 });

    await frame.locator('#auto').click();
    await expect(frame.locator('#auto')).toHaveClass(/\bon\b/);
    await frame.locator('#auto').click();
    await expect(frame.locator('#auto')).not.toHaveClass(/\bon\b/);
  } finally {
    await space.close();
  }
});

test('current Artifact payload refreshes when a new version becomes latest', async () => {
  const { space, projectDir } = await launchArtifactSpace(
    `artifact-html-current-version-${Date.now()}`,
  );
  try {
    const sessionId = projectFilePreviewSessionId(projectDir);
    const first = await invokeArtifactCreate(space, {
      sessionId,
      surface: 'code',
      kind: 'interactive-html',
      title: 'Versioned HTML',
      content: '<!doctype html><html><body><main id="version-state">v1</main></body></html>',
    });
    await focusArtifact(space, { id: first.id });

    const frame = space.page.frameLocator('iframe[title="Interactive HTML artifact"]');
    await expect(frame.locator('#version-state')).toHaveText('v1', { timeout: 10_000 });

    const second = await invokeArtifactCreate(space, {
      id: first.id,
      sessionId,
      surface: 'code',
      kind: 'interactive-html',
      title: 'Versioned HTML',
      content: '<!doctype html><html><body><main id="version-state">v2</main></body></html>',
    });
    expect(second.version).toBe(2);

    await expect(
      space.page.locator('select').filter({ has: space.page.locator('option[value="2"]') }),
    ).toHaveValue('2', { timeout: 10_000 });
    await expect(frame.locator('#version-state')).toHaveText('v2', { timeout: 10_000 });
  } finally {
    await space.close();
  }
});
