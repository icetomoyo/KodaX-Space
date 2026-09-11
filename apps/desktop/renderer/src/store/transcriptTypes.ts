import type { SessionEvent } from '@kodax-space/space-ipc-schema';

/**
 * 用户在 renderer 端发出的 prompt 记录。
 * Main 端不会把用户 prompt 通过 push channel 回放——它是 invoke 的入参，单向。
 * Renderer 自己保留一份，与 session.event push 流共同构成完整对话。
 */
export type UserImageAttachment =
  | {
      readonly id: string;
      readonly kind: 'image';
      readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
      readonly label?: string;
      readonly bytes?: number;
      readonly status: 'available';
      /**
       * History uses short-lived app:// capabilities; the optimistic live row uses the
       * already-normalized data URL until session.send replaces it with the capability.
       */
      readonly thumbnailUrl: string;
      readonly previewUrl: string;
    }
  | {
      readonly id: string;
      readonly kind: 'image';
      readonly mediaType?: 'image/png' | 'image/jpeg' | 'image/webp';
      readonly label?: string;
      readonly bytes?: number;
      readonly status: 'missing' | 'unsupported';
    };

export interface UserMessage {
  /** Position in the derived view, assigned after source-plane ownership is resolved. */
  readonly projectionOrder?: number;
  /** 唯一 id：sessionId + 单调 counter 拼接，保 React key 稳定。*/
  readonly id: string;
  readonly content: string;
  readonly sentAt: number;
  readonly attachments?: readonly UserImageAttachment[];
  /** Stable canonical boundary identity supplied by KodaX Runtime/history. */
  readonly turnId?: string;
  readonly turnUserOrdinal?: number;
  /** Renderer-only admission identity captured from run.started before turnId exists. */
  readonly runtimeRunId?: string;
  /** Composer send-operation identity; deterministically claims this optimistic message
   *  when a live run projection arrives with the same originOperationId (lost-ACK recovery). */
  readonly operationId?: string;
  readonly operationReservation?: SendOperationReservation;
  readonly sendAdmissionSettled?: true;
  readonly canonicalIndex?: number;
  /** Absolute visible turn index before bounded history-window truncation. */
  readonly historyTurnIndex?: number;
  /** Exact persisted turn-end boundary used instead of a page-local turn index. */
  readonly historyBoundary?: {
    readonly boundaryId: string;
    readonly sourceRevision: string;
  };
  /** Canonical persisted transcript provenance (history-only, never used as a React key). */
  readonly entryId?: string;
  readonly auditEntryIds?: readonly string[];
  readonly parentId?: string | null;
  readonly logicalId?: string;
  readonly sourceEntryId?: string;
  readonly authoritativeEntryId?: string;
  /** Internal idempotency identity for a Runtime-delivered queued prompt. */
  readonly deliveryQueueId?: string;
  readonly deliveryQueueMode?: QueuedUserMessage['queueMode'];
  /** Interrupt deliveries require an exact canonical entry reference before live/history folding. */
  readonly deliveredInterrupt?: true;
  /** Stable renderer-local identity retained when a queued bubble is promoted before its ACK. */
  readonly sourceQueuedLocalId?: string;
  readonly historyNoAssistantSegment?: boolean;
  /** Internal provenance used only to reconcile the session.history/live-stream boundary. */
  readonly restoredFromHistory?: true;
  /**
   * A complete durable projection is already visible for this canonical boundary, but the live
   * projection still needs a segment owner until its terminal arrives. Consume its events without
   * rendering a second user/assistant copy; terminal reconciliation removes this placeholder.
   */
  readonly hiddenProjectionDuplicate?: true;
  /** Original live ordering key while hiddenProjectionDuplicate temporarily follows its owner. */
  readonly hiddenProjectionOriginalSentAt?: number;
  /**
   * Internal alignment anchor for assistant/tool-leading history and history/live segment gaps.
   * It keeps positional event owners aligned without presenting a fabricated empty user bubble.
   */
  readonly hiddenHistoryAnchor?: boolean;
  /**
   * The newest bounded history page began inside this Runtime turn, before its canonical user
   * entry. The anchor may reconcile with a unique live owner for the same authoritative turnId;
   * it must remain ambiguous when one Runtime turn contains multiple live user prompts.
   */
  readonly leadingPartialHistory?: true;
  /**
   * Runtime supplied a canonical turnId but could not prove this user's ordinal within that turn.
   * A unique semantic live owner may supply only that missing ordinal; canonical content and
   * mutation boundary remain authoritative.
   */
  readonly omittedHistoryUserOrdinal?: true;
}

export interface QueuedUserMessage {
  readonly id: string;
  readonly queueId?: string;
  /** Exact session.send operation identity, available before the queue ACK returns. */
  readonly operationId?: string;
  readonly operationReservation?: SendOperationReservation;
  readonly sendAdmissionSettled?: true;
  readonly content: string;
  readonly matchContent: string;
  readonly attachments?: readonly UserImageAttachment[];
  readonly queueMode: 'interrupt' | 'after-turn';
  readonly status: 'pending-ack' | 'queued' | 'failed';
  readonly failureReason?: Extract<SessionEvent, { kind: 'queued_user_prompt_failed' }>['reason'];
  readonly sentAt: number;
}

export interface SendOperationReservation {
  readonly requestGeneration: number;
}
