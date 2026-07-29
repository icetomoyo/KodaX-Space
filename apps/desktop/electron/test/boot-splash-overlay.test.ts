import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BootSplashOverlay,
  type BootSplashViewLike,
  type BootSplashWebContentsLike,
} from '../window/boot-splash-overlay.js';

class FakeWebContents implements BootSplashWebContentsLike {
  destroyed = false;
  url = '';
  closeCalls = 0;
  scripts: string[] = [];

  isDestroyed(): boolean {
    return this.destroyed;
  }

  getURL(): string {
    return this.url;
  }

  async loadURL(url: string): Promise<void> {
    this.url = url;
  }

  async executeJavaScript(script: string): Promise<unknown> {
    this.scripts.push(script);
    return undefined;
  }

  close(): void {
    this.closeCalls += 1;
    this.destroyed = true;
  }
}

class FakeView implements BootSplashViewLike {
  readonly webContents = new FakeWebContents();
  background = '';
  backgroundError: Error | null = null;
  bounds = { x: -1, y: -1, width: -1, height: -1 };

  setBackgroundColor(color: string): void {
    if (this.backgroundError !== null) throw this.backgroundError;
    this.background = color;
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.bounds = bounds;
  }
}

test('boot overlay covers the host and closes its webContents when revealed', async () => {
  const children: FakeView[] = [];
  const view = new FakeView();
  const overlay = new BootSplashOverlay({
    bootUrl: 'data:boot',
    host: {
      addChildView: (child) => children.push(child),
      removeChildView: (child) => children.splice(children.indexOf(child), 1),
    },
    createView: () => view,
    getContentSize: () => [1280.9, 799.7],
  });

  await overlay.ensure();

  assert.equal(overlay.isAttached(), true);
  assert.deepEqual(children, [view]);
  assert.equal(view.background, '#18181b');
  assert.deepEqual(view.bounds, { x: 0, y: 0, width: 1280, height: 799 });
  assert.equal(view.webContents.url, 'data:boot');

  overlay.dispose();

  assert.equal(overlay.isAttached(), false);
  assert.deepEqual(children, []);
  assert.equal(view.webContents.closeCalls, 1);
});

test('boot overlay recreates a discarded renderer and exposes recovery actions safely', async () => {
  const children: FakeView[] = [];
  const views: FakeView[] = [];
  const overlay = new BootSplashOverlay({
    bootUrl: 'data:boot',
    host: {
      addChildView: (child) => children.push(child),
      removeChildView: (child) => children.splice(children.indexOf(child), 1),
    },
    createView: () => {
      const view = new FakeView();
      views.push(view);
      return view;
    },
    getContentSize: () => [900, 600],
  });

  await overlay.ensure();
  const first = views[0]!;
  assert.equal(overlay.invalidate(first), true);
  await overlay.ensure();
  await overlay.setStatus('</span><script>bad()</script>', 'try-again');

  assert.equal(views.length, 2);
  assert.equal(children.length, 1);
  const script = views[1]!.webContents.scripts[0] ?? '';
  assert.match(script, /textContent/);
  assert.match(script, /recovery\.hidden = false/);
  assert.doesNotMatch(script, /target\.innerHTML/);
});

test('boot overlay rejects synchronous creation and attach failures through its Promise', async () => {
  const createFailure = new Error('create failed');
  const failedCreate = new BootSplashOverlay<FakeView>({
    bootUrl: 'data:boot',
    host: {
      addChildView: () => undefined,
      removeChildView: () => undefined,
    },
    createView: () => {
      throw createFailure;
    },
    getContentSize: () => [900, 600],
  });
  await assert.rejects(failedCreate.ensure(), createFailure);

  const view = new FakeView();
  const attachFailure = new Error('attach failed');
  const failedAttach = new BootSplashOverlay({
    bootUrl: 'data:boot',
    host: {
      addChildView: () => {
        throw attachFailure;
      },
      removeChildView: () => undefined,
    },
    createView: () => view,
    getContentSize: () => [900, 600],
  });
  await assert.rejects(failedAttach.ensure(), attachFailure);
  assert.equal(view.webContents.closeCalls, 1);
  assert.equal(failedAttach.currentView(), null);
});

test('boot overlay closes a new view when synchronous setup fails', async () => {
  const backgroundView = new FakeView();
  const backgroundFailure = new Error('background failed');
  backgroundView.backgroundError = backgroundFailure;
  const failedBackground = new BootSplashOverlay({
    bootUrl: 'data:boot',
    host: {
      addChildView: () => undefined,
      removeChildView: () => undefined,
    },
    createView: () => backgroundView,
    getContentSize: () => [900, 600],
  });
  await assert.rejects(failedBackground.ensure(), backgroundFailure);
  assert.equal(backgroundView.webContents.closeCalls, 1);
  assert.equal(failedBackground.currentView(), null);

  const createdView = new FakeView();
  const setupFailure = new Error('view setup failed');
  const failedSetup = new BootSplashOverlay({
    bootUrl: 'data:boot',
    host: {
      addChildView: () => undefined,
      removeChildView: () => undefined,
    },
    createView: () => createdView,
    getContentSize: () => [900, 600],
    onViewCreated: () => {
      throw setupFailure;
    },
  });
  await assert.rejects(failedSetup.ensure(), setupFailure);
  assert.equal(createdView.webContents.closeCalls, 1);
  assert.equal(failedSetup.currentView(), null);
});
