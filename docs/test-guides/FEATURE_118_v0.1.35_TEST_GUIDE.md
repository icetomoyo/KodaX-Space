# FEATURE_118 v0.1.35 Human Test Guide

## Preconditions

- Use a Coder session connected to a shared daemon that negotiates both
  `learningCenter:1` and `skillLearningLoop:1`.
- Prepare two Runtime-owned schema-v2 learned Skills in `ready`: one candidate
  for review/trust/disable/rollback and one candidate for reject.
- Give the first candidate one Runtime-recorded exact-revision canary invocation
  with a `verified_success` outcome and an evidence reference before trusting
  it. Do not substitute an ordinary tool run or a Space-local fixture.
- Keep a second Runtime client available, such as a terminal client connected to
  the same Coder profile.

The automated process-distinct fixture in
`apps/desktop/electron/test/learning-daemon-integration.test.ts` creates this
state safely under a temporary profile and can be used as the reference setup.

## Capability gate and read model

1. Open the Task Dock Overview and locate **Learned Skill safety**.
2. Confirm the section is absent when either negotiated capability is removed
   or the Runtime projection is stale, and returns after both capabilities are
   available again.
3. Open the section. Confirm the list is bounded, has a Load more action when
   paginated, and the badge counts only actionable `ready`, `testing`, or
   `quarantined` Skills. `opportunity`, active, rejected, invocation count, and
   read-only records must not add to the badge.
4. Select a Skill and verify the detail shows its exact capability ID,
   lifecycle, immutable revision, relative artifact path, content revision,
   fingerprint, scope hashes, provenance, canary count (maximum three),
   Runtime-reported validation result, invocation evidence, diagnostics, and
   previous-good facts when present.
5. Confirm no Runtime absolute artifact path, promotion control,
   archive/restore control, or invented validation claim is shown.

## Explicit control flow

1. Click **Acknowledge notice** on the first candidate. Reopen the record and
   confirm lifecycle, revision, fingerprint, and trust state are unchanged.
2. Click **Review**. The confirmation must include the action, display name,
   exact capability ID, exact revision, and full fingerprint. Confirm it and
   verify the lifecycle becomes `testing`.
3. Confirm **Trust** is now a separate action; review must not have trusted or
   activated the Skill. Trust the canary-qualified revision and verify it
   becomes `active_learned`.
4. In the second Runtime client, read the record by exact capability ID and
   confirm the same lifecycle, revision, fingerprint, canary evidence, and
   Runtime identity are visible without a Space-owned copy.
5. Click **Disable**, confirm the destructive styling and exact-identity
   confirmation, then verify the record becomes `archived` while retaining its
   previous-good revision and artifact fingerprint.
6. Click **Rollback** and verify the Runtime creates a newer audit revision,
   restores `active_learned`, and binds the artifact to the previous-good
   fingerprint.
7. Select the second `ready` candidate, click **Reject**, and verify the Runtime
   creates a newer `rejected` revision. Confirm it is not counted as actionable
   attention.
8. Repeat one allowed action with an intentionally stale revision or
   fingerprint. Space must reject it, ask for refresh/review, and must not send
   a successful control result.

## Identity, compatibility, and failure behavior

1. If two records share a human slug, run the corresponding `/learn` action
   with that slug. Confirm Runtime reports ambiguity rather than Space choosing
   one; retry with the exact capability ID.
2. Run `/learn review`, `/learn trust`, `/learn disable`, `/learn rollback`, and
   `/learn reject` where applicable. Confirm each command resolves the target
   first and mutates the exact returned capability ID. `/learn approve` must
   remain a Partner proposal operation and must not collapse Runtime review and
   trust.
3. Present a legacy schema-v1 or future non-Skill carrier record. Confirm common
   identity/lifecycle remain readable but all mutation controls are absent.
4. Trigger a Runtime handler error or disconnect while an action is pending.
   Confirm Space reports failure/reconnecting and never infers success from
   lifecycle text or package version.

## Cursor recovery and product rollback

1. Receive several learning events, close Space, and confirm its durable local
   state contains only the Runtime ID and last event revision in
   `runtime-learning-cursor.json`; no learned record/evidence database is
   created by Space.
2. Reopen Space with the same Runtime. Confirm contiguous events replay once
   without duplicated controls or notifications.
3. Remove an intermediate event from a disposable test profile or advance the
   Runtime snapshot beyond the persisted cursor. Reconnect and confirm Space
   replaces the missing range with an authoritative snapshot.
4. Reconnect to a different Runtime ID and confirm the old cursor is discarded
   in favor of the new Runtime snapshot.
5. Launch Space with `SPACE_DISABLE_LEARNING_MUTATIONS=1`. Confirm the panel
   remains readable, all five mutation controls are absent, and `/learn`
   mutation commands fail closed. Remove the variable and restart to restore
   controls.

## Automated evidence

- IPC schema and read-only compatibility:
  `packages/space-ipc-schema/test/learning.test.ts`
- Projection, exact identity/revision/fingerprint checks, cursor replay, dedupe,
  and snapshot recovery:
  `apps/desktop/electron/test/learning-ipc.test.ts`
- Capability gate and actionable attention:
  `apps/desktop/electron/test/learning-model.test.ts`
- Real daemon, five actions, canary evidence, previous-good rollback, event
  sequence, acknowledgement, and second client at the public Runtime layer:
  `apps/desktop/electron/test/learning-daemon-integration.test.ts`
- Real-daemon list/detail and all five actions through Space's
  `LearningSafetyService`:
  `apps/desktop/electron/test/learning-safety-daemon.test.ts`
