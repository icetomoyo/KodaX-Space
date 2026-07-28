/**
 * Keeps only the latest renderer load/retry request alive.
 *
 * Crash, rejected-navigation, and did-fail-load events can all describe the
 * same failed navigation. A generation counter makes those signals converge
 * on one eventual load instead of starting independent timers.
 */
export class RendererLoadScheduler {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly waitUntilReady: () => Promise<void>) {}

  schedule(task: () => void, delayMs: number): void {
    const generation = ++this.generation;
    void this.waitUntilReady().then(() => {
      if (generation !== this.generation) return;
      this.clearTimer();
      this.timer = setTimeout(() => {
        this.timer = null;
        if (generation === this.generation) task();
      }, delayMs);
      this.timer.unref?.();
    });
  }

  cancel(): void {
    this.generation += 1;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
