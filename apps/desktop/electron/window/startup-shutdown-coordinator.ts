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
  private startupSettled: Promise<void> = Promise.resolve();

  setStartupPromise(startup: Promise<unknown>): void {
    this.startupSettled = startup.then(
      () => undefined,
      () => undefined,
    );
  }

  requestShutdown(): void {
    this.shutdownRequested = true;
  }

  isShutdownRequested(): boolean {
    return this.shutdownRequested;
  }

  async disposeAfterStartup(
    createDisposals: () => readonly Promise<unknown>[],
  ): Promise<PromiseSettledResult<unknown>[]> {
    await this.startupSettled;
    return Promise.allSettled(createDisposals());
  }
}
