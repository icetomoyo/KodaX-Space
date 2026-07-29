import { bootStatusScript, type BootSplashRecoveryAction } from './boot-splash.js';

export interface BootSplashWebContentsLike {
  isDestroyed(): boolean;
  getURL(): string;
  loadURL(url: string): Promise<void>;
  executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>;
  close(options?: { waitForBeforeUnload?: boolean }): void;
}

export interface BootSplashViewLike {
  readonly webContents: BootSplashWebContentsLike;
  setBackgroundColor(color: string): void;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
}

export interface BootSplashHostLike<TView extends BootSplashViewLike> {
  addChildView(view: TView): void;
  removeChildView(view: TView): void;
}

export interface BootSplashOverlayOptions<TView extends BootSplashViewLike> {
  readonly bootUrl: string;
  readonly host: BootSplashHostLike<TView>;
  readonly createView: () => TView;
  readonly getContentSize: () => readonly number[];
  readonly onViewCreated?: (view: TView) => void;
  readonly onError?: (phase: string, error: unknown) => void;
}

/**
 * Owns the trusted startup surface independently from the application
 * renderer. The BrowserWindow webContents can paint React underneath this
 * top-layer view; removing one child view then reveals the already-rendered
 * Shell without an intermediate document or background frame.
 */
export class BootSplashOverlay<TView extends BootSplashViewLike> {
  private view: TView | null = null;
  private attached = false;
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly options: BootSplashOverlayOptions<TView>) {}

  currentView(): TView | null {
    return this.view;
  }

  isAttached(): boolean {
    return this.attached;
  }

  async ensure(): Promise<void> {
    let view = this.view;
    try {
      if (view === null || view.webContents.isDestroyed()) {
        view = this.options.createView();
        // Establish ownership immediately so any synchronous setup failure can
        // close the newly created webContents through the common catch path.
        this.view = view;
        this.attached = false;
        this.loadPromise = null;
        view.setBackgroundColor('#18181b');
        this.options.onViewCreated?.(view);
      }

      if (!this.attached) {
        this.options.host.addChildView(view);
        this.attached = true;
      }
      this.resize();

      if (view.webContents.getURL() === this.options.bootUrl) return;
      if (this.loadPromise !== null) {
        await this.loadPromise;
        return;
      }

      const loading = view.webContents.loadURL(this.options.bootUrl);
      this.loadPromise = loading.finally(() => {
        if (this.view === view) this.loadPromise = null;
      });
      await this.loadPromise;
    } catch (error) {
      this.options.onError?.('load', error);
      if (view !== null && this.view === view) {
        this.detachAndClose(view);
        this.view = null;
        this.loadPromise = null;
      }
      throw error;
    }
  }

  resize(): void {
    const view = this.view;
    if (view === null || view.webContents.isDestroyed()) return;
    try {
      const [rawWidth = 0, rawHeight = 0] = this.options.getContentSize();
      view.setBounds({
        x: 0,
        y: 0,
        width: Math.max(0, Math.floor(rawWidth)),
        height: Math.max(0, Math.floor(rawHeight)),
      });
    } catch (error) {
      this.options.onError?.('resize', error);
    }
  }

  async setStatus(
    message: string,
    recoveryAction: BootSplashRecoveryAction = 'none',
  ): Promise<void> {
    const view = this.view;
    if (
      view === null ||
      view.webContents.isDestroyed() ||
      view.webContents.getURL() !== this.options.bootUrl
    ) {
      return;
    }
    try {
      await view.webContents.executeJavaScript(bootStatusScript(message, { recoveryAction }), true);
    } catch (error) {
      this.options.onError?.('status', error);
    }
  }

  invalidate(view: TView): boolean {
    if (this.view !== view) return false;
    this.detachAndClose(view);
    this.view = null;
    this.loadPromise = null;
    return true;
  }

  dispose(): void {
    const view = this.view;
    if (view === null) return;
    this.detachAndClose(view);
    this.view = null;
    this.loadPromise = null;
  }

  private detachAndClose(view: TView): void {
    if (this.attached) {
      try {
        this.options.host.removeChildView(view);
      } catch (error) {
        this.options.onError?.('detach', error);
      }
      this.attached = false;
    }
    if (view.webContents.isDestroyed()) return;
    try {
      view.webContents.close({ waitForBeforeUnload: false });
    } catch (error) {
      this.options.onError?.('close', error);
    }
  }
}
