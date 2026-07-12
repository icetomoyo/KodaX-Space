import { randomUUID } from 'node:crypto';
import type {
  SpaceActionArgsT,
  SpaceActionIdT,
  SpaceControlResultT,
  PushPayload,
} from '@kodax-space/space-ipc-schema';

type RendererRequest = PushPayload<'spaceControl.requested'>;

interface PendingRequest {
  readonly actionId: SpaceActionIdT;
  readonly resolve: (result: SpaceControlResultT) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface RendererActionBrokerOptions {
  readonly push: (payload: RendererRequest) => void;
  readonly timeoutMs?: number;
  readonly requestId?: () => string;
}

export class RendererActionBroker {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly push: (payload: RendererRequest) => void;
  private readonly timeoutMs: number;
  private readonly requestId: () => string;

  constructor(options: RendererActionBrokerOptions) {
    this.push = options.push;
    this.timeoutMs = Math.max(100, options.timeoutMs ?? 5000);
    this.requestId = options.requestId ?? randomUUID;
  }

  inspect(actionId: SpaceActionIdT): Promise<SpaceControlResultT> {
    return this.request({ operation: 'inspect', actionId });
  }

  apply(
    actionId: SpaceActionIdT,
    args: SpaceActionArgsT,
    expectedRevision: number,
    expectedRendererInstanceId: string,
  ): Promise<SpaceControlResultT> {
    return this.request({
      operation: 'apply',
      actionId,
      args,
      expectedRevision,
      expectedRendererInstanceId,
    });
  }

  resolve(result: SpaceControlResultT): boolean {
    const pending = this.pending.get(result.requestId);
    if (!pending || pending.actionId !== result.actionId) return false;
    clearTimeout(pending.timer);
    this.pending.delete(result.requestId);
    pending.resolve(result);
    return true;
  }

  cancelAll(reasonCode = 'broker-cancelled'): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({
        requestId,
        actionId: pending.actionId,
        status: 'unknown',
        revision: 0,
        summaryKey: 'spaceControl.unknown',
        reasonCode,
      });
    }
    this.pending.clear();
  }

  private request(input: Omit<RendererRequest, 'requestId'>): Promise<SpaceControlResultT> {
    const requestId = this.requestId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          requestId,
          actionId: input.actionId,
          status: 'unknown',
          revision: input.expectedRevision ?? 0,
          summaryKey: 'spaceControl.unknown',
          reasonCode: 'renderer-timeout',
        });
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(requestId, { actionId: input.actionId, resolve, timer });
      try {
        this.push({ requestId, ...input } as RendererRequest);
      } catch {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({
          requestId,
          actionId: input.actionId,
          status: 'failed',
          revision: input.expectedRevision ?? 0,
          summaryKey: 'spaceControl.failed',
          reasonCode: 'renderer-unavailable',
        });
      }
    });
  }
}
