# KodaX Runtime stream performance handoff

Date: 2026-07-30

Owner: KodaX Runtime / SDK

Consumer: KodaX Space

## Problem

KodaX currently emits and sequences one typed Runtime event for each provider
or tool fragment. A factual active Run (`run_ms7m99gl_d9210f61`) produced
25,689 `thinking.delta` records in 191 seconds. Those records carried only
96,924 characters in total:

- approximately 134.6 events per second;
- approximately 3.8 characters per event;
- no sampled fragment exceeded 15 characters; and
- the event log repeatedly approached its 16 MB trim threshold.

For every small fragment the current pipeline allocates a Runtime sequence,
updates the durable sequence cursor, serializes and persists an event, and
notifies clients. Space can coalesce renderer work, but it cannot remove the
daemon-side sequence-file locks, atomic writes, JSON work, persistence, and
transport amplification after the SDK has already created the raw events.

Long restored conversations and Full visual effects multiply the renderer
cost, but they are not the source of this event rate. The same multi-second
freezes were reproduced in Balanced quality while a Run was streaming.

## Required upstream change

Add bounded source-side coalescing and batch persistence in the Runtime
SDK/daemon:

1. Coalesce consecutive assistant-text, thinking, and tool-input fragments
   that share `runtimeId`, `runId`, `sessionId`, context, tool, and event kind.
2. Flush after 32-50 ms or 4-8 KB, whichever comes first. Keep a hard maximum
   merged-event size so a stalled consumer cannot create an unbounded object.
3. Treat tool progress as replaceable state. Publish the latest state at no
   more than 10-20 Hz while always preserving the required first state and the
   terminal state.
4. Flush immediately at structural boundaries: tool start/finish, message
   finish, Run state changes, errors, cancellation, disconnect, explicit
   snapshot, and shutdown.
5. Allocate sequence ranges and persist the sequence cursor/event lines per
   batch. Do not lock and atomically rewrite the global sequence file for each
   few-character fragment.
6. Preserve strict monotonic ordering, exact final text, snapshot cursor and
   draft-watermark semantics, reconnect replay, and deduplication. Events on
   opposite sides of an accepted snapshot boundary must never be merged.
7. Provide an explicit and idempotent flush/close path so cancellation,
   shutdown, and exceptions cannot lose the final partial batch.

## Acceptance criteria

- Feeding 10,000 consecutive one-to-five-character fragments produces
  byte-identical final text with no loss, duplication, or reordering.
- Downstream event count falls by at least 90% in a normal stream; a reduction
  above 98% is the target for the measured pathological stream.
- Snapshot-before, snapshot-during, disconnect/reconnect, cancellation, tool
  completion, and process-shutdown tests all produce the same final semantic
  transcript as an uninterrupted execution.
- Intermediate tool progress may be replaced, but the terminal state is always
  observable.
- Daemon CPU, durable sequence writes, and persistence transactions scale with
  batch count rather than raw fragment count.
- Add telemetry for input fragments, emitted batches, replaced progress
  events, queued bytes, flush reasons, sequence writes, and persistence
  transactions.

## Space-side mitigation

KodaX Space now coalesces continuous same-stream deltas before store updates,
including paused queues released by snapshot hydration. It respects Runtime
sequence continuity and snapshot draft watermarks, caps merged payloads, joins
tool-input fragments, and retains only the latest adjacent progress state.
This bounds renderer work and preserves cursor correctness, but it does not
replace the upstream change because the raw daemon work has already occurred.

## Orphan-daemon note

The 15 observed `space-f121-*` daemons were created by Space's
process-distinct compatibility test. Space now records the exact test
profile/home/PID, performs graceful shutdown, waits for exact-PID exit, and
uses identity-verified tree termination only as an exceptional fallback. It
never kills by the generic `node.exe` name.

KodaX may optionally add a launcher/client lease or parent-PID watchdog as a
second safety layer for explicitly test-owned profiles. It must remain opt-in
so ordinary persistent CLI daemons retain their current lifetime semantics.
