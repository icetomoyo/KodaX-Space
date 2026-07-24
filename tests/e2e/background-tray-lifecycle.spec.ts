import { expect, test } from '@playwright/test';

import { launchSpace } from './fixtures.js';

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
    await space.page.close();
    await expect.poll(() => space.app.windows().length).toBe(0);
    expect(space.app.process().exitCode).toBeNull();

    const reopenedPromise = space.app.waitForEvent('window');
    await space.app.evaluate(({ app }) => {
      app.emit('activate');
    });
    const reopened = await reopenedPromise;
    await reopened.waitForFunction(() => document.getElementById('root') !== null);
    expect(space.app.windows()).toHaveLength(1);
    await space.close();
    closed = true;
    expect(mainStderr).not.toMatch(/unhandledRejection|Object has been destroyed/);
  } finally {
    if (!closed) await space.close();
  }
});
