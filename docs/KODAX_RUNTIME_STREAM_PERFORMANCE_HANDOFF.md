# KodaX Runtime stream performance handoff

> **Published-package follow-up (2026-08-07):** the performance investigation
> below is historical evidence. Space v0.1.38 now pins the published npm
> Registry `@kodax-ai/kodax@0.7.84` package. Its `runtimeEventCoalescing:1`
> behavior is still consumed by the adapter; the current release additionally
> requires `managedRunDurability:1`, bounded Agent progress, same-owner Stop
> reconciliation, and protects active-Session admission and multi-Session
> recovery. This handoff does not describe a local-tarball dependency.

Date: 2026-07-30

Owner: KodaX Runtime / SDK

Consumer: KodaX Space

## 0.7.79 release-candidate validation

The local `@kodax-ai/kodax@0.7.79` release candidate implements the required
source boundary and advertises it twice: the importable SDK fact
`KODAX_RUNTIME_SDK_CAPABILITIES.runtimeEventCoalescing === 1` is available
before daemon auto-start, and the connected host publishes
`runtime.capabilities.runtimeEventCoalescing.version === 1`. Space now requires
both facts and requests `runtimeEventCoalescing: 1`, so a stale daemon cannot be
accepted merely because it still satisfies the older lifecycle contracts.

The KodaX release-candidate regression suite covers 25,000 tiny thinking
fragments, the 7 KiB + 7 KiB pre-merge size boundary, structural flushes,
reconnect/replay, snapshot watermarks, cancellation and shutdown. Space's
published-package compatibility probe independently checks the SDK, embedded
Worker and process-distinct daemon capability surfaces. Formal Registry pinning
and packaged long-Session measurements remain release steps; this document no
longer represents an unimplemented upstream request.

## Problem

Before the 0.7.79 source-side fix, KodaX emitted and sequenced one typed Runtime
event for each provider or tool fragment. A factual active Run
(`run_ms7m99gl_d9210f61`) produced
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

KodaX Space also coalesces continuous same-stream deltas before store updates,
including paused queues released by snapshot hydration. It respects Runtime
sequence continuity and snapshot draft watermarks, caps merged payloads, joins
tool-input fragments, and retains only the latest adjacent progress state.
This bounds renderer work and preserves cursor correctness independently of the
source implementation; the two layers protect different failure domains.

## Orphan-daemon note

The 15 observed `space-f121-*` daemons were created by Space's
process-distinct compatibility test. Space now records the exact test
profile/home/PID, performs graceful shutdown, waits for exact-PID exit, and
uses identity-verified tree termination only as an exceptional fallback. It
never kills by the generic `node.exe` name.

KodaX may optionally add a launcher/client lease or parent-PID watchdog as a
second safety layer for explicitly test-owned profiles. It must remain opt-in
so ordinary persistent CLI daemons retain their current lifetime semantics.
