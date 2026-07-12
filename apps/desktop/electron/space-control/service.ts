import { createHash, randomBytes } from 'node:crypto';
import type { SpaceActionArgsT, SpaceActionIdT } from '@kodax-space/space-ipc-schema';
import type { SessionRunContext } from '../kodax/session-run-context.js';
import {
  getSpaceActionDescriptor,
  listSpaceActionDescriptors,
  validateSpaceActionArgs,
} from './catalog.js';
import type { RendererActionBroker } from './renderer-broker.js';
import { getDiagnosticsLogger } from '../diagnostics/runtime.js';

interface Precondition {
  readonly actionId: SpaceActionIdT;
  readonly digest: string;
  readonly sessionId: string;
  readonly surface: SessionRunContext['surface'];
  readonly revision: number;
  readonly projectRoot: string;
  readonly rendererInstanceId: string;
  readonly expiresAt: number;
}

interface IdempotencyEntry {
  readonly digest: string;
  readonly result: SpaceControlApplyResult;
  readonly expiresAt: number;
}

export interface SpaceControlInspectInput {
  readonly query?: string;
  readonly actionId?: SpaceActionIdT;
  readonly args?: SpaceActionArgsT;
}

export interface SpaceControlApplyInput {
  readonly actionId: SpaceActionIdT;
  readonly args: SpaceActionArgsT;
  readonly expectedRevision: number;
  readonly preconditionToken: string;
}

export interface SpaceControlApplyResult {
  readonly actionId: SpaceActionIdT;
  readonly status: 'applied' | 'unchanged' | 'denied' | 'failed' | 'unknown';
  readonly revision: number;
  readonly safeState?: string | boolean;
  readonly summaryKey: string;
  readonly reasonCode?: string;
}

export interface SpaceControlServiceOptions {
  readonly broker: RendererActionBroker;
  readonly now?: () => number;
  readonly token?: () => string;
  readonly tokenTtlMs?: number;
  readonly idempotencyTtlMs?: number;
  readonly maxEntries?: number;
}

function argsDigest(actionId: SpaceActionIdT, args: SpaceActionArgsT): string {
  return createHash('sha256')
    .update(`${actionId}\0${typeof args.value}:${String(args.value)}`)
    .digest('hex');
}

function applyDigest(input: SpaceControlApplyInput): string {
  return createHash('sha256')
    .update(
      `${argsDigest(input.actionId, input.args)}\0${input.expectedRevision}\0${input.preconditionToken}`,
    )
    .digest('hex');
}

export class SpaceControlService {
  private readonly broker: RendererActionBroker;
  private readonly now: () => number;
  private readonly token: () => string;
  private readonly tokenTtlMs: number;
  private readonly idempotencyTtlMs: number;
  private readonly maxEntries: number;
  private readonly preconditions = new Map<string, Precondition>();
  private readonly idempotency = new Map<string, IdempotencyEntry>();

  constructor(options: SpaceControlServiceOptions) {
    this.broker = options.broker;
    this.now = options.now ?? Date.now;
    this.token = options.token ?? (() => randomBytes(24).toString('base64url'));
    this.tokenTtlMs = Math.max(1000, options.tokenTtlMs ?? 60_000);
    this.idempotencyTtlMs = Math.max(1000, options.idempotencyTtlMs ?? 10 * 60_000);
    this.maxEntries = Math.max(8, options.maxEntries ?? 1024);
  }

  async inspect(input: SpaceControlInspectInput, context: SessionRunContext): Promise<unknown> {
    this.prune();
    const descriptors = input.actionId
      ? [getSpaceActionDescriptor(input.actionId)].filter((descriptor) =>
          descriptor.surfaces.includes(context.surface),
        )
      : listSpaceActionDescriptors(input.query, context.surface);
    const results = await Promise.all(
      descriptors.map(async (descriptor) => {
        if (
          (context.permissionMode === 'plan' || context.taskSurface === 'plan') &&
          !descriptor.planModeAllowed
        ) {
          return {
            id: descriptor.id,
            title: descriptor.title,
            description: descriptor.description,
            effect: descriptor.effect,
            planModeAllowed: descriptor.planModeAllowed,
            valueType: descriptor.valueType,
            ...(descriptor.allowedValues ? { allowedValues: descriptor.allowedValues } : {}),
            available: false,
            revision: 0,
            reasonCode: 'plan-mode-denied',
          };
        }
        const state = await this.broker.inspect(descriptor.id);
        let preconditionToken: string | undefined;
        if (
          input.actionId === descriptor.id &&
          input.args &&
          validateSpaceActionArgs(descriptor, input.args) &&
          state.status === 'available' &&
          state.rendererInstanceId !== undefined
        ) {
          preconditionToken = this.issuePrecondition(
            descriptor.id,
            input.args,
            context,
            state.revision,
            state.rendererInstanceId,
          );
        }
        return {
          id: descriptor.id,
          title: descriptor.title,
          description: descriptor.description,
          effect: descriptor.effect,
          planModeAllowed: descriptor.planModeAllowed,
          valueType: descriptor.valueType,
          ...(descriptor.allowedValues ? { allowedValues: descriptor.allowedValues } : {}),
          available: state.status === 'available',
          revision: state.revision,
          ...(state.safeState !== undefined ? { safeState: state.safeState } : {}),
          ...(state.reasonCode ? { reasonCode: state.reasonCode } : {}),
          ...(preconditionToken ? { preconditionToken } : {}),
        };
      }),
    );
    getDiagnosticsLogger()?.info('space-control', 'inspect_completed', undefined, {
      sessionId: context.sessionId,
      surface: context.surface,
      actionId: input.actionId,
      resultCount: results.length,
      preconditionIssued: results.some((result) => result.preconditionToken !== undefined),
    });
    return { actions: results };
  }

  async apply(
    input: SpaceControlApplyInput,
    context: SessionRunContext,
  ): Promise<SpaceControlApplyResult> {
    this.prune();
    const descriptor = getSpaceActionDescriptor(input.actionId);
    if (!descriptor.surfaces.includes(context.surface)) {
      return this.denied(input.actionId, input.expectedRevision, 'surface-denied');
    }
    if (!validateSpaceActionArgs(descriptor, input.args)) {
      return this.denied(input.actionId, input.expectedRevision, 'invalid-arguments');
    }
    if (
      (context.permissionMode === 'plan' || context.taskSurface === 'plan') &&
      !descriptor.planModeAllowed
    ) {
      return this.denied(input.actionId, input.expectedRevision, 'plan-mode-denied');
    }
    if (!context.toolCallId) {
      return this.denied(input.actionId, input.expectedRevision, 'missing-tool-call-id');
    }

    const inputDigest = applyDigest(input);
    const preconditionDigest = argsDigest(input.actionId, input.args);
    const idempotencyKey = `${context.sessionId}\0${context.toolCallId}\0${input.actionId}`;
    const prior = this.idempotency.get(idempotencyKey);
    if (prior) {
      if (prior.digest !== inputDigest) {
        return this.denied(input.actionId, input.expectedRevision, 'tool-call-reused');
      }
      this.idempotency.delete(idempotencyKey);
      this.idempotency.set(idempotencyKey, prior);
      return prior.result;
    }

    const precondition = this.preconditions.get(input.preconditionToken);
    if (
      !precondition ||
      precondition.expiresAt <= this.now() ||
      precondition.actionId !== input.actionId ||
      precondition.digest !== preconditionDigest ||
      precondition.sessionId !== context.sessionId ||
      precondition.surface !== context.surface ||
      precondition.projectRoot !== context.projectRoot ||
      precondition.revision !== input.expectedRevision
    ) {
      return this.denied(input.actionId, input.expectedRevision, 'invalid-precondition');
    }
    this.preconditions.delete(input.preconditionToken);

    let rendererResult;
    try {
      rendererResult = await this.broker.apply(
        input.actionId,
        input.args,
        input.expectedRevision,
        precondition.rendererInstanceId,
      );
    } catch {
      const result: SpaceControlApplyResult = {
        actionId: input.actionId,
        status: 'failed',
        revision: input.expectedRevision,
        summaryKey: 'spaceControl.failed',
        reasonCode: 'renderer-request-failed',
      };
      this.remember(idempotencyKey, inputDigest, result);
      return result;
    }
    if (
      rendererResult.rendererInstanceId !== undefined &&
      rendererResult.rendererInstanceId !== precondition.rendererInstanceId
    ) {
      const result = this.denied(
        input.actionId,
        rendererResult.revision,
        'renderer-instance-changed',
      );
      this.remember(idempotencyKey, inputDigest, result);
      return result;
    }
    const result: SpaceControlApplyResult = {
      actionId: input.actionId,
      status: rendererResult.status === 'available' ? 'failed' : rendererResult.status,
      revision: rendererResult.revision,
      ...(rendererResult.safeState !== undefined ? { safeState: rendererResult.safeState } : {}),
      summaryKey: rendererResult.summaryKey,
      ...(rendererResult.reasonCode ? { reasonCode: rendererResult.reasonCode } : {}),
    };
    getDiagnosticsLogger()?.info('space-control', 'apply_completed', undefined, {
      sessionId: context.sessionId,
      toolCallId: context.toolCallId,
      surface: context.surface,
      taskSurface: context.taskSurface,
      permissionMode: context.permissionMode,
      actionId: input.actionId,
      status: result.status,
      reasonCode: result.reasonCode,
      revision: result.revision,
    });
    this.remember(idempotencyKey, inputDigest, result);
    return result;
  }

  private issuePrecondition(
    actionId: SpaceActionIdT,
    args: SpaceActionArgsT,
    context: SessionRunContext,
    revision: number,
    rendererInstanceId: string,
  ): string {
    const token = this.token();
    this.setBounded(this.preconditions, token, {
      actionId,
      digest: argsDigest(actionId, args),
      sessionId: context.sessionId,
      surface: context.surface,
      projectRoot: context.projectRoot,
      revision,
      rendererInstanceId,
      expiresAt: this.now() + this.tokenTtlMs,
    });
    return token;
  }

  private denied(
    actionId: SpaceActionIdT,
    revision: number,
    reasonCode: string,
  ): SpaceControlApplyResult {
    return {
      actionId,
      status: 'denied',
      revision,
      summaryKey: 'spaceControl.denied',
      reasonCode,
    };
  }

  private remember(key: string, inputDigest: string, result: SpaceControlApplyResult): void {
    this.setBounded(this.idempotency, key, {
      digest: inputDigest,
      result,
      expiresAt: this.now() + this.idempotencyTtlMs,
    });
  }

  private prune(): void {
    const now = this.now();
    for (const [key, value] of this.preconditions) {
      if (value.expiresAt <= now) this.preconditions.delete(key);
    }
    for (const [key, value] of this.idempotency) {
      if (value.expiresAt <= now) this.idempotency.delete(key);
    }
  }

  private setBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
    if (map.size >= this.maxEntries) {
      const oldest = map.keys().next().value as K | undefined;
      if (oldest !== undefined) map.delete(oldest);
    }
    map.set(key, value);
  }
}
