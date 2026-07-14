// AskUserBroker - FEATURE_032
//
// Bridges KodaX guardrail escalation and ask_user_question callbacks into the
// Space renderer. Guardrail prompts resolve to allow/block; question prompts
// resolve to a user-provided string or undefined when cancelled.

import { randomUUID } from 'node:crypto';
import type {
  AskUserQuestionAnswer,
  AskUserQuestionOption,
  AskUserReplyInput,
  AskUserSignal,
  AskUserToolCall,
  AskUserVerdict,
} from '@kodax-space/space-ipc-schema';
import { pushToRenderer } from '../ipc/push.js';
import { sanitizeForDisplay, sanitizeInputForDisplay } from './sanitize.js';

const DEFAULT_TIMEOUT_MS = 60_000;

export interface AskUserRequestInput {
  readonly sessionId: string;
  readonly reason: string;
  readonly toolCall: AskUserToolCall;
  readonly signals?: readonly AskUserSignal[];
  /** Test-only override. */
  readonly timeoutMs?: number;
}

export interface AskUserQuestionRequestInput {
  readonly sessionId: string;
  readonly kind: 'select' | 'input';
  readonly question: string;
  readonly header?: string;
  readonly options?: readonly AskUserQuestionOption[];
  readonly multiSelect?: boolean;
  readonly minSelections?: number;
  readonly maxSelections?: number;
  readonly default?: string;
  readonly allowCustomInput?: boolean;
  readonly customInputLabel?: string;
  readonly customInputPrompt?: string;
  readonly customInputDefault?: string;
  /** Test-only override. */
  readonly timeoutMs?: number;
}

type PendingAskUser =
  | {
      readonly kind: 'guardrail';
      readonly reqId: string;
      readonly sessionId: string;
      readonly resolve: (verdict: AskUserVerdict) => void;
      readonly timer: NodeJS.Timeout;
    }
  | {
      readonly kind: 'question';
      readonly reqId: string;
      readonly sessionId: string;
      readonly resolve: (answer: AskUserQuestionAnswer | undefined) => void;
      readonly timer: NodeJS.Timeout;
    };

/** Mirrors the askUser.request push schema's `.max(20)` on options[] and signals[]. */
const ASK_USER_ARRAY_MAX = 20;

function normalizeOption(option: AskUserQuestionOption): AskUserQuestionOption {
  const value = sanitizeForDisplay(option.value, 512) || '(empty)';
  const label = sanitizeForDisplay(option.label, 160) || value;
  const description = option.description !== undefined
    ? sanitizeForDisplay(option.description, 512)
    : undefined;
  return {
    label,
    value,
    ...(description !== undefined ? { description } : {}),
  };
}

function normalizeSelectionBound(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(20, Math.floor(value));
}

function isSingleQuestionAnswer(value: unknown): value is AskUserQuestionAnswer {
  return (
    typeof value === 'string' ||
    Array.isArray(value) ||
    (value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as { kind?: unknown }).kind === 'customInput')
  );
}

class AskUserBroker {
  private readonly pending = new Map<string, PendingAskUser>();

  /** Guardrail allow/block prompt. Timeout/cancel resolves to block. */
  request(req: AskUserRequestInput): Promise<AskUserVerdict> {
    const reqId = randomUUID();

    return new Promise<AskUserVerdict>((resolve) => {
      const timer = this.createTimer(reqId, req.sessionId, req.timeoutMs, () => resolve('block'));
      this.pending.set(reqId, {
        kind: 'guardrail',
        reqId,
        sessionId: req.sessionId,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        timer,
      });

      const safeToolName = sanitizeForDisplay(req.toolCall.toolName, 128) || '(unnamed)';
      const safeReason = sanitizeForDisplay(req.reason, 2048) || 'Agent needs your input.';
      const safeInput = sanitizeInputForDisplay(req.toolCall.input);
      // C8: the askUser.request push schema caps signals[] at max(20); a schema-compliant guardrail
      // with exactly 20 signals is fine, but any overflow would fail the push zod validation
      // silently → renderer never receives the prompt → 60s timeout resolves as if cancelled. Clamp.
      const safeSignals = req.signals?.slice(0, ASK_USER_ARRAY_MAX).map((s) => ({
        type: sanitizeForDisplay(s.type, 64) || 'signal',
        severity: s.severity,
        message: sanitizeForDisplay(s.message, 512),
      }));

      pushToRenderer('askUser.request', {
        kind: 'guardrail',
        reqId,
        sessionId: req.sessionId,
        reason: safeReason,
        toolCall: {
          toolId: req.toolCall.toolId,
          toolName: safeToolName,
          input: safeInput,
        },
        signals: safeSignals,
      });
    });
  }

  /** SDK ask_user_question prompt. Timeout/cancel resolves to undefined. */
  requestQuestion(req: AskUserQuestionRequestInput): Promise<AskUserQuestionAnswer | undefined> {
    if (req.kind === 'select' && (!req.options || req.options.length === 0)) {
      console.warn('[ask-user-broker] select question requested without options; cancelling prompt');
      return Promise.resolve(undefined);
    }

    const reqId = randomUUID();

    return new Promise<AskUserQuestionAnswer | undefined>((resolve) => {
      const timer = this.createTimer(reqId, req.sessionId, req.timeoutMs, () => resolve(undefined));
      this.pending.set(reqId, {
        kind: 'question',
        reqId,
        sessionId: req.sessionId,
        resolve: (answer) => {
          clearTimeout(timer);
          resolve(answer);
        },
        timer,
      });

      const minSelections = normalizeSelectionBound(req.minSelections);
      const maxSelections = normalizeSelectionBound(req.maxSelections);
      const safeMaxSelections =
        minSelections !== undefined && maxSelections !== undefined && maxSelections < minSelections
          ? undefined
          : maxSelections;

      pushToRenderer('askUser.request', {
        kind: req.kind,
        reqId,
        sessionId: req.sessionId,
        question: sanitizeForDisplay(req.question, 2048) || 'Agent needs your input.',
        ...(req.header !== undefined ? { header: sanitizeForDisplay(req.header, 96) } : {}),
        // C8: clamp to the push schema's options.max(20) so an overflowing option list can never
        // silently fail the push validation (which would hang the prompt for the full timeout).
        ...(req.kind === 'select'
          ? { options: (req.options ?? []).slice(0, ASK_USER_ARRAY_MAX).map(normalizeOption) }
          : {}),
        ...(req.multiSelect !== undefined ? { multiSelect: req.multiSelect } : {}),
        ...(minSelections !== undefined ? { minSelections } : {}),
        ...(safeMaxSelections !== undefined ? { maxSelections: safeMaxSelections } : {}),
        ...(req.default !== undefined ? { default: sanitizeForDisplay(req.default, 4096) } : {}),
        ...(req.allowCustomInput !== undefined ? { allowCustomInput: req.allowCustomInput } : {}),
        ...(req.customInputLabel !== undefined
          ? { customInputLabel: sanitizeForDisplay(req.customInputLabel, 160) }
          : {}),
        ...(req.customInputPrompt !== undefined
          ? { customInputPrompt: sanitizeForDisplay(req.customInputPrompt, 512) }
          : {}),
        ...(req.customInputDefault !== undefined
          ? { customInputDefault: sanitizeForDisplay(req.customInputDefault, 4096) }
          : {}),
      });
    });
  }

  /** Renderer answer. Missing/stale reqId returns false. */
  resolve(reqId: string, reply: AskUserVerdict | AskUserReplyInput): boolean {
    const entry = this.pending.get(reqId);
    if (!entry) return false;
    this.pending.delete(reqId);
    clearTimeout(entry.timer);

    if (entry.kind === 'guardrail') {
      if (reply === 'allow' || reply === 'block') {
        entry.resolve(reply);
      } else if ('verdict' in reply) {
        entry.resolve(reply.verdict);
      } else {
        entry.resolve('block');
      }
      return true;
    }

    if (typeof reply !== 'string' && 'value' in reply && isSingleQuestionAnswer(reply.value)) {
      entry.resolve(reply.value);
    } else {
      entry.resolve(undefined);
    }
    return true;
  }

  cancelSession(
    sessionId: string,
    reason: 'session_cancelled' | 'session_disposed' | 'shutdown',
  ): void {
    const toCancel: PendingAskUser[] = [];
    for (const entry of this.pending.values()) {
      if (entry.sessionId === sessionId) toCancel.push(entry);
    }
    for (const entry of toCancel) {
      this.cancelEntry(entry, reason);
    }
  }

  cancelAll(reason: 'shutdown'): void {
    for (const entry of [...this.pending.values()]) {
      this.cancelEntry(entry, reason);
    }
  }

  pendingCount(): number {
    return this.pending.size;
  }

  private createTimer(
    reqId: string,
    sessionId: string,
    timeoutMs: number | undefined,
    resolveOnTimeout: () => void,
  ): NodeJS.Timeout {
    const timer = setTimeout(() => {
      if (this.pending.delete(reqId)) {
        pushToRenderer('askUser.cancelled', {
          reqId,
          sessionId,
          reason: 'timeout',
        });
        resolveOnTimeout();
      }
    }, timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  private cancelEntry(
    entry: PendingAskUser,
    reason: 'session_cancelled' | 'session_disposed' | 'shutdown',
  ): void {
    this.pending.delete(entry.reqId);
    clearTimeout(entry.timer);
    pushToRenderer('askUser.cancelled', {
      reqId: entry.reqId,
      sessionId: entry.sessionId,
      reason,
    });
    if (entry.kind === 'guardrail') {
      entry.resolve('block');
    } else {
      entry.resolve(undefined);
    }
  }
}

export const askUserBroker = new AskUserBroker();
