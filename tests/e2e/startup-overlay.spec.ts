import { expect, test } from '@playwright/test';

import { launchSpace } from './fixtures.js';

test('boot overlay remains above a painted Shell and is then removed atomically', async () => {
  const space = await launchSpace(`startup-overlay-${Date.now()}`, {
    env: {
      SPACE_TEST_BOOT_PAINT_HOLD_MS: '10000',
      SPACE_TEST_STARTUP_OVERLAY_HOLD_MS: '10000',
    },
  });

  try {
    await expect
      .poll(
        () =>
          space.app
            .evaluate(({ app, BrowserWindow, WebContentsView }) => {
              const win = BrowserWindow.getAllWindows()[0];
              if (!win) return null;
              const readState = () => ({
                visible: win.isVisible(),
                overlays: win.contentView.children.filter((view) => view instanceof WebContentsView)
                  .length,
              });
              const beforeActivation = readState();
              app.emit(
                'second-instance',
                {} as Electron.Event,
                [process.execPath],
                process.cwd(),
                {},
              );
              return { beforeActivation, afterActivation: readState() };
            })
            .catch(() => null),
        { timeout: 15_000 },
      )
      .toEqual({
        beforeActivation: { visible: false, overlays: 1 },
        afterActivation: { visible: false, overlays: 1 },
      });

    await space.page.locator('[data-space-shell-ready]').waitFor();
    await expect
      .poll(
        () =>
          space.app
            .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)
            .catch(() => false),
        { timeout: 15_000 },
      )
      .toBe(true);

    const coveredState = await space.app.evaluate(async ({ BrowserWindow, WebContentsView }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return null;
      const overlays = win.contentView.children.filter(
        (view): view is Electron.WebContentsView => view instanceof WebContentsView,
      );
      return {
        visible: win.isVisible(),
        mainUrl: win.webContents.getURL(),
        throttling: win.webContents.getBackgroundThrottling(),
        overlayUrls: overlays.map((view) => view.webContents.getURL()),
        overlayPainted:
          overlays.length === 1
            ? await overlays[0]!.webContents.executeJavaScript(
                "document.body.dataset.bootPainted === 'true'",
              )
            : false,
      };
    });

    expect(coveredState).not.toBeNull();
    expect(coveredState?.visible).toBe(true);
    expect(coveredState?.mainUrl).toMatch(/^app:\/\/space\//);
    expect(coveredState?.throttling).toBe(false);
    expect(coveredState?.overlayUrls).toHaveLength(1);
    expect(coveredState?.overlayUrls[0]).toMatch(/^data:text\/html;charset=utf-8,/);
    expect(coveredState?.overlayPainted).toBe(true);

    await expect
      .poll(
        () =>
          space.app
            .evaluate(({ BrowserWindow, WebContentsView }) => {
              const win = BrowserWindow.getAllWindows()[0];
              if (!win) return null;
              return {
                overlays: win.contentView.children.filter((view) => view instanceof WebContentsView)
                  .length,
                throttling: win.webContents.getBackgroundThrottling(),
              };
            })
            .catch(() => null),
        { timeout: 15_000 },
      )
      .toEqual({ overlays: 0, throttling: true });

    await expect(space.page.locator('[data-space-shell-ready]')).toBeVisible();

    await space.page.reload();
    await space.page.locator('[data-space-shell-ready]').waitFor();
    const reloadCoveredState = await space.app.evaluate(({ BrowserWindow, WebContentsView }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return null;
      return {
        overlays: win.contentView.children.filter((view) => view instanceof WebContentsView).length,
        throttling: win.webContents.getBackgroundThrottling(),
      };
    });
    expect(reloadCoveredState).toEqual({ overlays: 1, throttling: false });

    await expect
      .poll(
        () =>
          space.app
            .evaluate(({ BrowserWindow, WebContentsView }) => {
              const win = BrowserWindow.getAllWindows()[0];
              if (!win) return null;
              return {
                overlays: win.contentView.children.filter((view) => view instanceof WebContentsView)
                  .length,
                throttling: win.webContents.getBackgroundThrottling(),
              };
            })
            .catch(() => null),
        { timeout: 15_000 },
      )
      .toEqual({ overlays: 0, throttling: true });
  } finally {
    await space.close();
  }
});
