import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import type { ConversationMessage } from '../features/session/composeMessages.js';

function streamOriginsRemainCompatible(previous: SessionEvent, next: SessionEvent): boolean {
  const previousOrigin = 'runtimeEvent' in previous ? previous.runtimeEvent : undefined;
  const nextOrigin = 'runtimeEvent' in next ? next.runtimeEvent : undefined;
  if (previousOrigin === undefined || nextOrigin === undefined) {
    return previousOrigin === undefined && nextOrigin === undefined;
  }
  return (
    previousOrigin.runtimeId === nextOrigin.runtimeId &&
    previousOrigin.runId === nextOrigin.runId &&
    nextOrigin.seq >= previousOrigin.seq
  );
}

/**
 * Store coalescing replaces the active final delta with a cumulative value. Replaying the complete
 * historical projection for that replacement is unnecessary: patch the one open assistant row and
 * retain structural identity for every historical message. Structural events and non-tail changes
 * deliberately fall back to the canonical pure composer.
 */
export function patchComposedStreamTail(
  previousEvents: readonly SessionEvent[],
  previousMessages: readonly ConversationMessage[],
  nextEvents: readonly SessionEvent[],
): ConversationMessage[] | undefined {
  if (previousEvents.length === 0 || previousEvents.length !== nextEvents.length) return undefined;
  for (let index = 0; index < previousEvents.length - 1; index += 1) {
    if (previousEvents[index] !== nextEvents[index]) return undefined;
  }

  const previousEvent = previousEvents.at(-1);
  const nextEvent = nextEvents.at(-1);
  if (
    previousEvent === undefined ||
    nextEvent === undefined ||
    previousEvent.kind !== nextEvent.kind ||
    (nextEvent.kind !== 'text_delta' && nextEvent.kind !== 'thinking_delta') ||
    (previousEvent.kind !== 'text_delta' && previousEvent.kind !== 'thinking_delta') ||
    previousEvent.sessionId !== nextEvent.sessionId ||
    !streamOriginsRemainCompatible(previousEvent, nextEvent) ||
    !nextEvent.text.startsWith(previousEvent.text)
  ) {
    return undefined;
  }

  const suffix = nextEvent.text.slice(previousEvent.text.length);
  if (suffix.length === 0) return [...previousMessages];
  for (let index = previousMessages.length - 1; index >= 0; index -= 1) {
    const message = previousMessages[index];
    if (message?.kind !== 'assistant_text' || message.completed === true) continue;
    if (nextEvent.kind === 'text_delta' && !message.text.endsWith(previousEvent.text)) {
      return undefined;
    }
    if (
      nextEvent.kind === 'thinking_delta' &&
      !(message.thinking ?? '').endsWith(previousEvent.text)
    ) {
      return undefined;
    }
    const patched: ConversationMessage =
      nextEvent.kind === 'text_delta'
        ? { ...message, text: message.text + suffix }
        : { ...message, thinking: (message.thinking ?? '') + suffix };
    return [...previousMessages.slice(0, index), patched, ...previousMessages.slice(index + 1)];
  }
  return undefined;
}
