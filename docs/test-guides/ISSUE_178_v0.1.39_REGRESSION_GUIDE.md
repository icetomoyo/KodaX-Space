# Issue 178 v0.1.39 Regression Guide

## Preconditions

- Use a Space build containing this fix and exact KodaX package bytes that
  advertise both `actorSettlementConvergence:1` and `sessionEventJournal:1`.
- Confirm the build resolves npm Registry `@kodax-ai/kodax@0.7.85`, not a
  locally linked or repacked package with the same version string.
- Use an isolated KodaX home and a large Session with at least three child
  Agents.
- Inject a delay into the first child terminal Actor snapshot save.

## Scenarios

### 1. Query admission during unknown

1. Start the multi-Agent Run and hold the terminal save until the UI reports
   that Run state was not persisted.
2. Submit one query with Enter, once with the send button, and repeat separately
   for a Slash/Skill invocation.

Expected: each accepted input appears once as after-turn queued work. It does
not execute before the old Run terminalizes and is not restored as an unsent
draft after acknowledgement.

Repeat by dropping the IPC acknowledgement after Runtime accepts query A,
attempting query B, then retrying A. Repeat A with a pasted image whose draft
file is cleaned up after acceptance. Expected: A keeps one operation ID and one
Runtime admission; its retry returns the cached accepted result without reading
the removed draft attachment.

### 2. Automatic repair and history preservation

1. Let the root stream partial output, enter unknown, then release the delayed
   save.
2. Wait for automatic repair and the queued successor Run.
3. Switch Sessions, refresh, and reopen the original Session.

Expected: the fenced Run fails factually, the queued Run starts once, and the
submitted query plus recoverable streamed output do not disappear or reorder.
The successor must not start while an exact pre-fence Runtime-mediated tool
effect is still pending; an abort-ignoring provider Promise alone must not keep
the repaired Session permanently occupied.

### 3. Exact Stop

1. While unknown is visible, record the displayed Run ID and press Stop.
2. Race a terminal update and successor admission against the Stop response.

Expected: Space sends the displayed Run ID. A mismatched receipt is rejected;
the successor is never cancelled by fallback Session lookup.

### 4. Owner diagnostics

1. Attempt child spawn after same-runtime durability self-fence.
2. Repeat with a genuinely different live Runtime owner.

Expected: self-fence reports `actor_settlement_not_persisted`; the foreign
owner case alone reports `actor_owner_conflict`.

### 5. Permanent persistence uncertainty

Never release the delayed write.

Expected: spinner and Stop remain visible, queued input is retained but never
executes, and Space never force-idles or fabricates completion.

### 6. Session journal epoch rollover

1. Observe an active Session and record its `(sessionId, journalEpoch, seq)`.
2. Restart the isolated daemon so the journal epoch changes and sequence
   numbering begins from the new lineage.
3. Complete the Run and submit another query.

Expected: the new epoch is accepted even if its `seq` is lower. The old spinner
clears, an acknowledged send does not remain stuck in `Sending`, and events
from another Session never outrank this Session's terminal event.

## Pass criteria

Run all scenarios in development and packaged Windows builds. There must be no
duplicate queued query, no lost live turn, no stale-run Stop, no post-fence
provider output, and no Session reuse before durable convergence.
