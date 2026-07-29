import { expect, test } from '@playwright/test';

import { launchSpace, waitForMainRendererPage } from './fixtures.js';

test('Windows tray keeps only the background host and can recreate a closed Space window', async () => {
  test.skip(process.platform !== 'win32', 'The background tray is intentionally Windows-only.');

  const space = await launchSpace(`tray-lifecycle-${Date.now()}`, {
    env: { SPACE_DISABLE_TRAY: '0' },
  });
  let closed = false;
  let mainStderr = '';
  space.app.process().stderr?.on('data', (chunk: Buffer) => {
    mainStderr += chunk.toString('utf8');
  });
  try {
    const closePreference = await space.page.evaluate(() =>
      window.kodaxSpace?.invoke('settings.setWindowCloseBehavior', {
        windowCloseBehavior: 'minimize-to-tray',
      }),
    );
    expect(closePreference?.ok).toBe(true);

    await space.page.close();
    await expect.poll(() => space.app.windows().length).toBe(0);
    expect(space.app.process().exitCode).toBeNull();

    await space.app.evaluate(({ app }) => {
      app.emit('activate');
    });
    // The boot WebContentsView is also exposed as a Playwright Page and is
    // intentionally closed after the real app://space renderer becomes ready.
    // Select the BrowserWindow renderer by URL instead of racing the first
    // short-lived "window" event.
    const reopened = await waitForMainRendererPage(space.app);
    await reopened.waitForFunction(() => document.getElementById('root') !== null);
    await expect
      .poll(() => space.app.windows().filter((candidate) => !candidate.isClosed()).length)
      .toBe(1);
    expect(reopened.isClosed()).toBe(false);
    await space.close();
    closed = true;
    expect(mainStderr).not.toMatch(/unhandledRejection|Object has been destroyed/);
  } finally {
    if (!closed) await space.close();
  }
});
