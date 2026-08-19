import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AppBadgeController,
  createWindowsBadgeBitmap,
  drawWindowsBadge,
  windowsBadgeLabel,
  type AppBadgeNativeTarget,
} from './app-badge.js';

test('Windows badge keeps a legible one-digit or 9+ label', () => {
  assert.equal(windowsBadgeLabel(0), '');
  assert.equal(windowsBadgeLabel(1), '1');
  assert.equal(windowsBadgeLabel(9), '9');
  assert.equal(windowsBadgeLabel(10), '9+');
  assert.equal(windowsBadgeLabel(9999), '9+');

  const bitmap = createWindowsBadgeBitmap(1);
  assert.equal(bitmap.length, 16 * 16 * 4);
  const pixels = Array.from({ length: 16 * 16 }, (_, index) =>
    bitmap.subarray(index * 4, index * 4 + 4),
  );
  assert.ok(pixels.some((pixel) => pixel[2] === 220 && pixel[1] === 38 && pixel[0] === 38));
  assert.ok(pixels.some((pixel) => pixel[2] === 255 && pixel[1] === 255 && pixel[0] === 255));
  assert.equal(bitmap[3], 0, 'transparent corners keep the overlay circular');
});

test('Windows tray badge changes only the requested bottom-right region', () => {
  const bitmap = Buffer.alloc(32 * 32 * 4, 17);
  drawWindowsBadge(bitmap, { width: 32, height: 32, count: 3, x: 16, y: 16, size: 16 });

  assert.deepEqual([...bitmap.subarray(0, 4)], [17, 17, 17, 17]);
  const badgeCenter = (24 * 32 + 24) * 4;
  assert.notDeepEqual([...bitmap.subarray(badgeCenter, badgeCenter + 4)], [17, 17, 17, 17]);
});

test('native badge controller dispatches to platform targets and restores rebuilt Windows targets', () => {
  const appCounts: number[] = [];
  const overlays: Array<{ image: string | null; description: string }> = [];
  const trayImages: string[] = [];
  const errors: unknown[] = [];
  const target: AppBadgeNativeTarget<string> = {
    platform: 'darwin',
    setApplicationBadgeCount: (count) => {
      appCounts.push(count);
      return true;
    },
    getWindow: () => ({
      isDestroyed: () => false,
      setOverlayIcon: (image, description) => overlays.push({ image, description }),
    }),
    getTray: () => ({
      isDestroyed: () => false,
      setImage: (image) => trayImages.push(image),
    }),
    baseTrayImage: 'base',
    createWindowsOverlayImage: (count) => `overlay:${count}`,
    createWindowsTrayImage: (count) => `tray:${count}`,
    onError: (error) => errors.push(error),
  };
  const controller = new AppBadgeController(target);

  assert.equal(controller.setCount(2), true);
  assert.deepEqual(appCounts, [2]);
  assert.equal(overlays.length, 0);

  target.platform = 'linux';
  target.setApplicationBadgeCount = (count) => {
    appCounts.push(count);
    return false;
  };
  assert.equal(controller.setCount(3), false);
  assert.deepEqual(appCounts, [2, 3]);

  target.platform = 'win32';
  assert.equal(controller.setCount(4), true);
  assert.deepEqual(overlays.at(-1), {
    image: 'overlay:4',
    description: 'KodaX Space: 4 Sessions need attention',
  });
  assert.equal(trayImages.at(-1), 'tray:4');

  assert.equal(controller.setCount(0), true);
  assert.equal(overlays.at(-1)?.image, null);
  assert.equal(trayImages.at(-1), 'base');

  controller.setCount(7);
  controller.refresh();
  assert.equal(overlays.at(-1)?.image, 'overlay:7');
  assert.equal(trayImages.at(-1), 'tray:7');
  assert.deepEqual(errors, []);
});

test('native badge controller isolates a failing Windows target', () => {
  const trayImages: string[] = [];
  const errors: unknown[] = [];
  const controller = new AppBadgeController<string>({
    platform: 'win32',
    setApplicationBadgeCount: () => false,
    getWindow: () => ({
      isDestroyed: () => false,
      setOverlayIcon: () => {
        throw new Error('taskbar unavailable');
      },
    }),
    getTray: () => ({
      isDestroyed: () => false,
      setImage: (image) => trayImages.push(image),
    }),
    baseTrayImage: 'base',
    createWindowsOverlayImage: (count) => `overlay:${count}`,
    createWindowsTrayImage: (count) => `tray:${count}`,
    onError: (error) => errors.push(error),
  });

  assert.equal(controller.setCount(1), true);
  assert.equal(trayImages.at(-1), 'tray:1');
  assert.equal(errors.length, 1);
});
