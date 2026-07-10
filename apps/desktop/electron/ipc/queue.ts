// KodaX message queue IPC: query + subscribe.
//
// Space exposes KodaX's SDK process-global MessageQueue for renderer visibility.
// Follow-up prompts support two explicit modes:
// - interrupt: enqueue into the SDK queue so KodaX can drain at the next safe
//   mid-turn boundary; owner guards keep desktop sessions isolated.
// - after-turn: hold in a Space-owned per-session queue until the current turn
//   settles, then start the next turn normally.
import { registerChannel } from './register.js';
import { pushToRenderer } from './push.js';
import {
  _resetSessionQueueGuardForTests,
  countOwnedPromptsForSession,
  dequeueOwnedPromptsForSession,
  enqueueOwnedPrompt,
  installSessionQueueGuard,
  ownerSessionForQueuedPrompt,
  peekOwnedPromptsForSession,
} from '../kodax/session-queue-guard.js';
import type {
  QueuedMessageT,
  MessagePriorityT,
  MessageModeT,
  QueueEventKindT,
  SessionSendQueueMode,
} from '@kodax-space/space-ipc-schema';

type AgentModule = typeof import('@kodax-ai/kodax/agent');
type MessageQueue = ReturnType<AgentModule['getMessageQueue']>;
type QueuedMessage = import('@kodax-ai/kodax/agent').QueuedMessage;

type QueueGetInput = {
  readonly agentId?: string;
  readonly maxPriority?: MessagePriorityT;
  readonly mode?: MessageModeT;
  readonly limit?: number;
};

type SpaceQueuedPrompt = {
  readonly id: string;
  readonly priority: 'user';
  readonly mode: 'prompt';
  readonly agentId: string;
  readonly content: string;
  readonly promptOverlay?: string;
  readonly enqueuedAt: number;
  readonly order: number;
  readonly queueMode: 'after-turn';
};

export type DequeuedUserPrompt = {
  readonly content: string;
  readonly queueMode: SessionSendQueueMode;
  readonly promptOverlay?: string;
};

let agentModuleCache: AgentModule | null = null;
async function loadAgent(): Promise<AgentModule> {
  if (agentModuleCache === null) {
    agentModuleCache = await import('@kodax-ai/kodax/agent');
  }
  return agentModuleCache;
}

async function loadQueue(): Promise<MessageQueue> {
  const agent = await loadAgent();
  const q = agent.getMessageQueue();
  installSessionQueueGuard(q);
  ensureSdkPromptMetadataCleanup(q);
  return q;
}

const MAX_QUEUE_DEPTH_PER_SESSION = 10;
const QUEUE_CONTENT_SCHEMA_MAX = 32 * 1024;
const TRUNCATED_SUFFIX = '\n[truncated]';

const afterTurnPromptQueues = new Map<string, SpaceQueuedPrompt[]>();
const sdkPromptOrders = new Map<string, number>();
const sdkPromptOverlays = new Map<string, string>();
let sdkPromptMetadataQueue: MessageQueue | null = null;
let unsubscribeSdkPromptMetadataCleanup: (() => void) | null = null;
let nextAfterTurnQueueSeq = 1;
let nextQueueOrder = 1;

function clearSdkPromptMetadata(messages: readonly QueuedMessage[]): void {
  for (const message of messages) sdkPromptOrders.delete(message.id);
  for (const message of messages) sdkPromptOverlays.delete(message.id);
}

function ensureSdkPromptMetadataCleanup(q: MessageQueue): void {
  if (sdkPromptMetadataQueue === q && unsubscribeSdkPromptMetadataCleanup !== null) return;
  unsubscribeSdkPromptMetadataCleanup?.();
  // A replaced SDK singleton cannot retain any of the old queue's messages.
  // Clear metadata as well so reused SDK ids cannot inherit stale overlays.
  sdkPromptOrders.clear();
  sdkPromptOverlays.clear();
  sdkPromptMetadataQueue = q;
  unsubscribeSdkPromptMetadataCleanup = q.subscribe((event) => {
    if (event.kind !== 'enqueued') clearSdkPromptMetadata(event.messages);
  });
}

function clampQueueContentForIpc(content: string): string {
  if (content.length <= QUEUE_CONTENT_SCHEMA_MAX) return content;
  return content.slice(0, QUEUE_CONTENT_SCHEMA_MAX - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX;
}

function projectMessage(m: QueuedMessage): QueuedMessageT {
  const proj: QueuedMessageT = {
    id: m.id,
    priority: m.priority as MessagePriorityT,
    mode: m.mode as MessageModeT,
    content: clampQueueContentForIpc(m.content),
    enqueuedAt: m.enqueuedAt,
    ...(ownerSessionForQueuedPrompt(m) !== undefined ? { queueMode: 'interrupt' as const } : {}),
  };
  if (m.agentId !== undefined) {
    return { ...proj, agentId: m.agentId };
  }
  return proj;
}

function projectSpacePrompt(m: SpaceQueuedPrompt): QueuedMessageT {
  return {
    id: m.id,
    priority: m.priority,
    mode: m.mode,
    agentId: m.agentId,
    content: clampQueueContentForIpc(m.content),
    enqueuedAt: m.enqueuedAt,
    queueMode: m.queueMode,
  };
}

function priorityWithinMax(priority: MessagePriorityT, maxPriority: MessagePriorityT): boolean {
  if (maxPriority === 'background') return true;
  return priority === 'user';
}

function filterProjectedMessages(
  messages: readonly QueuedMessageT[],
  input: QueueGetInput | undefined,
): QueuedMessageT[] {
  const maxPriority = input?.maxPriority ?? 'background';
  const filtered = messages.filter((m) => {
    if (input?.agentId !== undefined && m.agentId !== input.agentId) return false;
    if (input?.mode !== undefined && m.mode !== input.mode) return false;
    return priorityWithinMax(m.priority, maxPriority);
  });
  return input?.limit !== undefined ? filtered.slice(0, input.limit) : filtered;
}

function getAfterTurnPromptSnapshot(): QueuedMessageT[] {
  return Array.from(afterTurnPromptQueues.values()).flatMap((queue) =>
    queue.map(projectSpacePrompt),
  );
}

function getAfterTurnPromptTotalSize(): number {
  let total = 0;
  for (const queue of afterTurnPromptQueues.values()) total += queue.length;
  return total;
}

function getSdkSnapshotIfLoaded(): { messages: QueuedMessageT[]; totalSize: number } {
  if (agentModuleCache === null) return { messages: [], totalSize: 0 };
  const q = agentModuleCache.getMessageQueue();
  installSessionQueueGuard(q);
  return {
    messages: q.getSnapshot().map(projectMessage),
    totalSize: q.size(),
  };
}

function combinedSnapshot(): { messages: QueuedMessageT[]; totalSize: number } {
  const sdk = getSdkSnapshotIfLoaded();
  const afterTurn = getAfterTurnPromptSnapshot();
  return {
    messages: [...sdk.messages, ...afterTurn],
    totalSize: sdk.totalSize + afterTurn.length,
  };
}

function emitQueueChanged(kind: QueueEventKindT, affected: QueuedMessageT[]): void {
  const snapshot = combinedSnapshot();
  pushToRenderer('kodax.queueChanged', {
    kind,
    affected,
    snapshot: snapshot.messages,
    totalSize: snapshot.totalSize,
  });
}

function enqueueAfterTurnPrompt(
  sessionId: string,
  content: string,
  promptOverlay?: string,
): string {
  const message: SpaceQueuedPrompt = {
    id: `space-after-turn-${nextAfterTurnQueueSeq++}`,
    priority: 'user',
    mode: 'prompt',
    agentId: sessionId,
    content,
    ...(promptOverlay !== undefined ? { promptOverlay } : {}),
    enqueuedAt: Date.now(),
    order: nextQueueOrder++,
    queueMode: 'after-turn',
  };
  const queue = afterTurnPromptQueues.get(sessionId) ?? [];
  afterTurnPromptQueues.set(sessionId, [...queue, message]);
  emitQueueChanged('enqueued', [projectSpacePrompt(message)]);
  return message.id;
}

function shiftAfterTurnPrompt(sessionId: string): SpaceQueuedPrompt | undefined {
  const queue = afterTurnPromptQueues.get(sessionId);
  if (!queue || queue.length === 0) return undefined;
  const [message, ...rest] = queue;
  if (rest.length === 0) afterTurnPromptQueues.delete(sessionId);
  else afterTurnPromptQueues.set(sessionId, rest);
  if (message) emitQueueChanged('dequeued', [projectSpacePrompt(message)]);
  return message;
}

/**
 * Queue a follow-up user prompt for a single Space session.
 *
 * interrupt mode uses the SDK main-thread MessageQueue so KodaX can consume the
 * prompt at a mid-turn drain boundary. after-turn mode stays in Space's
 * per-session queue and is started only after the current turn settles.
 */
export async function enqueueUserPrompt(
  sessionId: string,
  content: string,
  queueMode: SessionSendQueueMode = 'interrupt',
  promptOverlay?: string,
): Promise<string> {
  const q = await loadQueue();
  const depth =
    countOwnedPromptsForSession(q, sessionId) + (afterTurnPromptQueues.get(sessionId)?.length ?? 0);
  if (depth >= MAX_QUEUE_DEPTH_PER_SESSION) {
    throw new Error(
      `Message queue full for session ${sessionId} (${depth} >= ${MAX_QUEUE_DEPTH_PER_SESSION}); ` +
        'wait for the current turn to drain',
    );
  }

  if (queueMode === 'after-turn') {
    return enqueueAfterTurnPrompt(sessionId, content, promptOverlay);
  }

  const queueId = enqueueOwnedPrompt(q, sessionId, content);
  sdkPromptOrders.set(queueId, nextQueueOrder++);
  if (promptOverlay !== undefined) sdkPromptOverlays.set(queueId, promptOverlay);
  return queueId;
}

/** Pop the next queued follow-up prompt for one Space session. */
export function dequeueNextUserPromptForSession(sessionId: string): DequeuedUserPrompt | undefined {
  const afterTurnPrompt = afterTurnPromptQueues.get(sessionId)?.[0];
  const sdkPrompt =
    agentModuleCache === null
      ? undefined
      : peekOwnedPromptsForSession(agentModuleCache.getMessageQueue(), sessionId)[0];

  const sdkOrder = sdkPrompt ? sdkPromptOrders.get(sdkPrompt.id) : undefined;
  const afterTurnFirst =
    afterTurnPrompt &&
    (!sdkPrompt ||
      (sdkOrder !== undefined
        ? afterTurnPrompt.order <= sdkOrder
        : afterTurnPrompt.enqueuedAt <= sdkPrompt.enqueuedAt));
  if (afterTurnFirst) {
    const message = shiftAfterTurnPrompt(sessionId);
    return message
      ? {
          content: message.content,
          queueMode: message.queueMode,
          ...(message.promptOverlay !== undefined ? { promptOverlay: message.promptOverlay } : {}),
        }
      : undefined;
  }

  if (!sdkPrompt || agentModuleCache === null) return undefined;
  const q = agentModuleCache.getMessageQueue();
  // MessageQueue listeners run synchronously. The metadata cleanup listener
  // therefore sees the dequeued id before dequeueOwnedPromptsForSession()
  // returns. Capture the metadata selected by peek() before mutating the SDK
  // queue; the listener still cleans external SDK drains, while this path
  // performs the same cleanup idempotently below.
  const promptOverlay = sdkPromptOverlays.get(sdkPrompt.id);
  const [message] = dequeueOwnedPromptsForSession(q, sessionId, 1);
  if (message) sdkPromptOrders.delete(message.id);
  if (message) sdkPromptOverlays.delete(message.id);
  return message
    ? {
        content: message.content,
        queueMode: 'interrupt',
        ...(promptOverlay !== undefined ? { promptOverlay } : {}),
      }
    : undefined;
}

/** Clear Space-owned queued user prompts when a session is cancelled/disposed. */
export async function drainQueueForSession(sessionId: string): Promise<number> {
  const q = await loadQueue();
  const sdkDrained = dequeueOwnedPromptsForSession(q, sessionId);
  clearSdkPromptMetadata(sdkDrained);
  const afterTurnDrained = afterTurnPromptQueues.get(sessionId) ?? [];
  if (afterTurnDrained.length > 0) {
    afterTurnPromptQueues.delete(sessionId);
    emitQueueChanged('dequeued', afterTurnDrained.map(projectSpacePrompt));
  }
  return sdkDrained.length + afterTurnDrained.length;
}

export function registerQueueChannels(): void {
  registerChannel('kodax.queueGet', async (input: QueueGetInput | undefined) => {
    const q = await loadQueue();
    const filter: import('@kodax-ai/kodax/agent').DequeueFilter = {
      agentId: input?.agentId,
      maxPriority: input?.maxPriority ?? 'background',
      mode: input?.mode,
    };
    const sdkMessages = q.peek(filter).map(projectMessage);
    const afterTurnMessages = getAfterTurnPromptSnapshot();
    return {
      messages: filterProjectedMessages([...sdkMessages, ...afterTurnMessages], input),
      totalSize: q.size() + getAfterTurnPromptTotalSize(),
    };
  });
}

export async function startQueueWatch(): Promise<() => void> {
  const q = await loadQueue();
  let active = true;
  const unsubscribe = q.subscribe((event) => {
    let affected: QueuedMessageT[];
    if (event.kind === 'enqueued') {
      // enqueueOwnedPrompt can only stamp the owner map after SDK enqueue()
      // returns the id. Defer projection one microtask so UI snapshots can
      // distinguish Space-owned interrupt prompts from internal SDK prompts.
      queueMicrotask(() => {
        if (active) emitQueueChanged(event.kind, [projectMessage(event.message)]);
      });
      return;
    } else {
      affected = event.messages.map(projectMessage);
    }
    emitQueueChanged(event.kind, affected);
  });
  return () => {
    active = false;
    unsubscribe();
  };
}

export function _resetQueueStateForTests(): void {
  unsubscribeSdkPromptMetadataCleanup?.();
  unsubscribeSdkPromptMetadataCleanup = null;
  sdkPromptMetadataQueue = null;
  _resetSessionQueueGuardForTests();
  afterTurnPromptQueues.clear();
  sdkPromptOrders.clear();
  sdkPromptOverlays.clear();
  nextAfterTurnQueueSeq = 1;
  nextQueueOrder = 1;
  agentModuleCache = null;
}
