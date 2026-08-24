/**
 * Coordinates the early visible startup surface with process shutdown.
 *
 * A user can request quit while main-process initialization is still running.
 * Shutdown records that intent immediately, lets the startup chain observe it
 * at safe checkpoints, then starts asynchronous disposal only after the chain
 * has settled so initialize() and close() cannot race each other.
 */
export class StartupShutdownCoordinator {
  private shutdownRequested = false;
  private readonly shutdownController = new AbortController();
  private startupSettled: Promise<void> = Promise.resolve();
  private readonly trackedStartupTasks = new Set<Promise<void>>();

  setStartupPromise(startup: Promise<unknown>): void {
    this.startupSettled = startup.then(
      () => undefined,
      () => undefined,
    );
  }

  trackStartupTask<T>(task: Promise<T>): Promise<T> {
    const settled = task.then(
      () => undefined,
      () => undefined,
    );
    this.trackedStartupTasks.add(settled);
    void settled.finally(() => {
      this.trackedStartupTasks.delete(settled);
    });
    return task;
  }

  requestShutdown(): void {
    this.shutdownRequested = true;
    this.shutdownController.abort();
  }

  isShutdownRequested(): boolean {
    return this.shutdownRequested;
  }

  get shutdownSignal(): AbortSignal {
    return this.shutdownController.signal;
  }

  async disposeAfterStartup(
    createDisposals: () => readonly Promise<unknown>[],
  ): Promise<PromiseSettledResult<unknown>[]> {
    await this.startupSettled;
    // Tasks can be registered by the synchronous tail of the main startup
    // chain while an earlier tracked task is settling. Drain until stable so
    // initialize()/subscribe work never races the corresponding close().
    while (this.trackedStartupTasks.size > 0) {
      await Promise.all(this.trackedStartupTasks);
    }
    return Promise.allSettled(createDisposals());
  }
}
