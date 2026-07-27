import type { AgentEvent, AgentTreeSnapshot } from '@kodax-ai/kodax/agent';
import type { AgentActorTreeSnapshotT } from '@kodax-space/space-ipc-schema';

import { projectRuntimeActorTreeSnapshot } from './runtime-agent-projection.js';

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_BASE_MS = 250;
const DEFAULT_RETRY_MAX_MS = 5_000;

export interface RuntimeAgentTelemetrySource {
  tree(sessionId: string): Promise<AgentTreeSnapshot>;
  events(sessionId: string, afterSequence?: number): Promise<readonly AgentEvent[]>;
  wait(
    sessionId: string,
    afterSequence?: number,
    timeoutMs?: number,
  ): Promise<AgentEvent | undefined>;
}

export interface RuntimeAgentTreeObserverOptions {
  readonly runtimeId: string;
  readonly sessionId: string;
  readonly source: RuntimeAgentTelemetrySource;
  readonly onSnapshot: (snapshot: AgentActorTreeSnapshotT) => void;
  readonly onError?: (error: unknown, consecutiveFailures: number, retryDelayMs: number) => void;
  readonly shouldRetry?: (error: unknown) => boolean;
  readonly waitTimeoutMs?: number;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
  readonly sleep?: (delayMs: number) => Promise<void>;
}

/**
 * Observes the Runtime-owned Actor tree without coupling it to session.event.
 *
 * Agent events have their own sequence cursor, separate from Runtime session
 * observation cursors. Each wake drains the bounded replay and then reads one
 * authoritative tree snapshot, so bursts coalesce without losing lifecycle
 * transitions. A failed refresh never advances the cursor.
 */
export class RuntimeAgentTreeObserver {
  private readonly runtimeId: string;
  private readonly sessionId: string;
  private readonly source: RuntimeAgentTelemetrySource;
  private readonly onSnapshot: (snapshot: AgentActorTreeSnapshotT) => void;
  private readonly onError:
    | ((error: unknown, consecutiveFailures: number, retryDelayMs: number) => void)
    | undefined;
  private readonly shouldRetry: (error: unknown) => boolean;
  private readonly waitTimeoutMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private started = false;
  private stopped = false;
  private eventCursor = 0;
  private snapshotValue: AgentActorTreeSnapshotT | undefined;
  private refreshQueue: Promise<AgentActorTreeSnapshotT | undefined> = Promise.resolve(undefined);

  constructor(options: RuntimeAgentTreeObserverOptions) {
    this.runtimeId = options.runtimeId;
    this.sessionId = options.sessionId;
    this.source = options.source;
    this.onSnapshot = options.onSnapshot;
    this.onError = options.onError;
    this.shouldRetry = options.shouldRetry ?? (() => true);
    this.waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.retryMaxMs = options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;
    this.sleep =
      options.sleep ?? ((delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  }

  current(): AgentActorTreeSnapshotT | undefined {
    return this.snapshotValue;
  }

  async start(): Promise<AgentActorTreeSnapshotT | undefined> {
    if (this.started) return this.snapshotValue;
    this.started = true;
    let initialFailure = false;
    try {
      await this.refreshNow();
    } catch (error) {
      if (this.stopped) return this.snapshotValue;
      if (!this.shouldRetry(error)) throw error;
      initialFailure = true;
      this.onError?.(error, 1, this.retryDelay(1));
    }
    if (!this.stopped) void this.observeLoop(initialFailure ? 1 : 0);
    return this.snapshotValue;
  }

  refreshNow(minimumCursor = this.eventCursor): Promise<AgentActorTreeSnapshotT | undefined> {
    const pending = this.refreshQueue
      .catch(() => undefined)
      .then(() => this.refresh(minimumCursor));
    this.refreshQueue = pending;
    return pending;
  }

  stop(): void {
    this.stopped = true;
  }

  private async refresh(minimumCursor: number): Promise<AgentActorTreeSnapshotT | undefined> {
    if (this.stopped) return this.snapshotValue;
    const events = await this.source.events(this.sessionId, this.eventCursor);
    let nextCursor = Math.max(this.eventCursor, minimumCursor);
    for (const event of events) nextCursor = Math.max(nextCursor, event.sequence);
    const tree = await this.source.tree(this.sessionId);
    if (this.stopped) return this.snapshotValue;
    const snapshot = projectRuntimeActorTreeSnapshot(
      this.runtimeId,
      this.sessionId,
      tree,
      nextCursor,
    );
    this.eventCursor = nextCursor;
    this.snapshotValue = snapshot;
    this.onSnapshot(snapshot);
    return snapshot;
  }

  private async observeLoop(initialFailures: number): Promise<void> {
    let consecutiveFailures = initialFailures;
    let refreshRequired = initialFailures > 0;
    while (!this.stopped) {
      try {
        if (refreshRequired) {
          await this.refreshNow();
          refreshRequired = false;
          consecutiveFailures = 0;
          continue;
        }
        const event = await this.source.wait(this.sessionId, this.eventCursor, this.waitTimeoutMs);
        if (this.stopped) return;
        // Direct-child terminal events can become hidden from root replay after
        // the parent acknowledges them. Reconcile the authoritative tree on a
        // timeout too, so acknowledged terminals and non-event mutations cannot
        // leave the UI stale indefinitely.
        if (!event) {
          await this.refreshNow();
          consecutiveFailures = 0;
          continue;
        }
        if (event.sequence <= this.eventCursor) continue;
        await this.refreshNow(event.sequence);
        consecutiveFailures = 0;
      } catch (error) {
        if (this.stopped || !this.shouldRetry(error)) return;
        consecutiveFailures += 1;
        refreshRequired = true;
        const retryDelayMs = this.retryDelay(consecutiveFailures);
        this.onError?.(error, consecutiveFailures, retryDelayMs);
        await this.sleep(retryDelayMs);
      }
    }
  }

  private retryDelay(consecutiveFailures: number): number {
    return Math.min(
      this.retryMaxMs,
      this.retryBaseMs * 2 ** Math.min(Math.max(0, consecutiveFailures - 1), 8),
    );
  }
}
