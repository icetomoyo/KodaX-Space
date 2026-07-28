/**
 * Keeps the trusted boot page visible until main-process initialization has
 * registered every renderer-facing IPC handler. Windows can be created and
 * shown immediately without letting the React renderer race startup.
 */
export class RendererStartupGate {
  private ready = false;
  private readonly readyPromise: Promise<void>;
  private releaseReady!: () => void;

  constructor() {
    this.readyPromise = new Promise<void>((resolve) => {
      this.releaseReady = resolve;
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  wait(): Promise<void> {
    return this.readyPromise;
  }

  run(task: () => void): void {
    void this.readyPromise.then(task);
  }

  release(): void {
    if (this.ready) return;
    this.ready = true;
    this.releaseReady();
  }
}
