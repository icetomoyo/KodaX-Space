# Archived Known Issues

Last Updated: 2026-07-23

> Resolved issues are moved here only after they have remained closed for more than 30 days. Details are preserved verbatim as investigation and regression evidence.

## Archive Index

| ID  | Priority | Status   | Title                                                                                                                       | Introduced  | Created    |
| --- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- |
| 001 | High     | Resolved | Resumed sessions display `glm-5.2` but run with provider default `glm-5`, causing early compaction                          | v0.1.21     | 2026-06-22 |
| 002 | High     | Resolved | Space used SDK MessageQueue `agentId` for main-thread prompts, preventing runner drain and making prior queue fix incorrect | v0.1.4      | 2026-06-22 |
| 003 | High     | Resolved | SDK `askUser` / `askUserMulti` / `askUserInput` callbacks were not wired to Space UI                                        | v0.1.21     | 2026-06-22 |
| 004 | Medium   | Resolved | MCP manager reload could be overwritten by a stale in-flight initializer                                                    | v0.1.x      | 2026-06-22 |
| 005 | Low      | Resolved | Context window indicator could keep the previous model cap while the new model cap was loading                              | v0.1.21     | 2026-06-22 |
| 006 | Medium   | Resolved | Persisted SDK session summaries do not expose exact historical runtime model metadata                                       | pre-v0.1.21 | 2026-06-22 |
| 007 | High     | Resolved | SDK main-thread follow-up owner guard did not protect already-running concurrent sessions                                   | v0.1.21     | 2026-06-22 |

## 2026-06

### 001: Resumed sessions display `glm-5.2` but run with provider default `glm-5`, causing early compaction

- Priority: High
- Status: Resolved
- Introduced: v0.1.21
- Fixed: v0.1.21
- Created: 2026-06-22
- Resolution Date: 2026-06-22

#### Original Problem

Current behavior:

- The model picker and context-window indicator can show `zhipu-coding / glm-5.2` with a `1.0M` context window.
- In a resumed historical session, automatic compaction can still begin around `~100k` tokens.
- The user's `~/.kodax/config.json` contains `provider: zhipu-coding`, `model: glm-5.2`, and `compaction.triggerPercent: 50`.
- If the runtime actually used `glm-5.2`, compaction should not trigger near `100k`; 50% of a 1M window should be around `500k`.

Expected behavior:

- A resumed session should apply the same effective model that the picker displays.
- If the effective model is `glm-5.2`, Space should pass `model: "glm-5.2"` to the SDK before the next user turn and workflow launch.
- Context-window UI, picker state, session metadata, and SDK runtime options should agree on the same model.

Reproduction steps:

1. Configure KodaX defaults with `provider: zhipu-coding`, `model: glm-5.2`, and `compaction.triggerPercent: 50`.
2. Open or resume a historical session from the sidebar.
3. Observe that the picker/context indicator shows `glm-5.2` and `1.0M`.
4. Send a prompt in the resumed session, especially in AMA/Workflow mode.
5. Observe automatic compaction around the 100k range instead of near 500k.

#### Context

Affected components:

- `apps/desktop/electron/kodax/host.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/ipc/workflow.ts`
- `apps/desktop/electron/kodax/workflow-controller.ts`
- `apps/desktop/renderer/src/shell/ModelEffortSelector.tsx`
- `apps/desktop/renderer/src/shell/ContextWindowIndicator.tsx`
- `apps/desktop/renderer/src/shell/resolveActiveModel.ts`
- `packages/space-ipc-schema/src/channels/session.ts`

Observed evidence:

- SDK provider capability is correct: `zhipu-coding/glm-5.2` resolves to `1,000,000`; provider default `glm-5` resolves to `200,000`.
- `tryResume()` restores provider/reasoning/permission defaults but does not restore or pass a model to `createSession()`.
- `RealKodaXSession` only passes `options.model` to SDK when `this.model !== undefined`.
- The picker computes display model from `pendingModel` / KodaX defaults / provider default, not from authoritative runtime `session.model`.
- When the picker already displays `glm-5.2`, selecting `glm-5.2` again does not run `/model glm-5.2`, so the runtime model remains unset.
- Workflow launch options inherit `session.model`; when it is unset, workers also omit `model` and fall back to the provider default.

#### Root Cause

KodaX-Space has split model state across multiple layers:

1. Preference/display state: `pendingModel` and `~/.kodax/config.json`.
2. Runtime session state: `ManagedSession.model`.
3. SDK provider fallback state: provider default model when `options.model` is omitted.

The resumed-session path does not hydrate `ManagedSession.model` from the same effective model shown in the UI. As a result, the UI can display `glm-5.2` while the runtime omits `model`, causing the SDK to use `zhipu-coding`'s default `glm-5` and a 200k window. With `compaction.triggerPercent: 50`, this produces compaction near 100k.

#### Proposed Solution

Make `ManagedSession.model` the runtime source of truth for active sessions, and ensure resumed sessions hydrate it before the next turn.

Recommended repair sequence:

1. Restore model on resume.
   - In `host.tryResume()`, read `ud.model` from `loadKodaxUserDefaults()`.
   - Validate the model belongs to the resolved provider before passing it to `createSession()`.
   - Pass `model` into `createSession()` for resumed sessions when valid.
   - If validation fails, omit `model` and log a diagnostic without breaking resume.

2. Align picker display with runtime state.
   - Update `ModelEffortSelector` to prefer `session.model` when present.
   - Only fall back to `pendingModel` / defaults when there is no active session model.
   - If an active session has no model but the resolved display model is non-default, treat that as "not yet applied" rather than "already current".

3. Ensure clicking the displayed model can repair runtime drift.
   - In `commitProviderAndModel()`, compare the selected model against the authoritative runtime model, not just the resolved display model.
   - If `session.model` is unset and selected model is `glm-5.2`, execute `/model glm-5.2` even if the picker label already showed `glm-5.2`.
   - After successful slash execution, update renderer session metadata with `model`.
   - Do not swallow slash failures silently; surface a warning or keep a diagnostic log.

4. Align context-window indicator with runtime state.
   - Prefer `session.model` for active sessions.
   - If `session.model` is unset, distinguish provider-default runtime from pending next-session model.
   - Avoid showing a 1M cap for an active session that will actually run with provider default.

5. Propagate model to workflow consistently.
   - Ensure workflow launch receives `session.model` after resume hydration or picker repair.
   - Add coverage for AMA/Workflow launch options so workers do not omit `model` when the parent session is expected to use `glm-5.2`.

#### Detailed Fix Plan

File-level plan:

| File                                                         | Change Summary                                                                              | Reason                                                        | Expected Outcome                                         | Risks                                                | Tests                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| `apps/desktop/electron/kodax/host.ts`                        | Hydrate and validate model in `tryResume()` before `createSession()`                        | Resume currently drops model                                  | Resumed runtime receives `model: "glm-5.2"`              | Invalid stale model could be passed if not validated | Add host resume unit test                    |
| `apps/desktop/renderer/src/shell/ModelEffortSelector.tsx`    | Prefer runtime `session.model`; compare selected model against runtime model                | Picker currently treats display preference as applied runtime | Re-selecting `glm-5.2` repairs unset runtime model       | UI labels may need "next" handling                   | Add component/unit test for drift            |
| `apps/desktop/renderer/src/shell/ContextWindowIndicator.tsx` | Use active session runtime model before pending/default model                               | Indicator can show 1M while runtime uses 200k                 | Context cap reflects actual next send                    | Need careful fallback for no-session state           | Add model source test                        |
| `apps/desktop/electron/ipc/session.ts`                       | Ensure in-flight `model` continues to be returned; consider persisted placeholder semantics | Renderer needs runtime model visibility                       | Store can distinguish runtime vs fallback                | Persisted rows still lack historical model           | Existing session.list tests plus resume case |
| `apps/desktop/electron/ipc/workflow.ts`                      | Verify `toLaunchSession()` receives hydrated model                                          | Workflow workers inherit parent model                         | AMA/Workflow uses `glm-5.2`                              | None if parent model is correct                      | Add workflow launch options test             |
| `apps/desktop/electron/kodax/workflow-controller.ts`         | Keep forwarding `s.model`; add regression coverage                                          | Worker options already conditionally include model            | No worker fallback to `glm-5` when parent uses `glm-5.2` | None                                                 | Add controller launchOptions test            |
| `packages/space-ipc-schema/src/channels/session.ts`          | Confirm optional `model` schema semantics; no schema change expected                        | Existing schema already supports in-flight model              | Avoid unnecessary schema churn                           | Over-documenting stale persisted model               | Schema tests only if behavior changes        |

Mandatory checklist:

- [x] Expected outcome is clearly defined for every touched file.
- [x] No unrelated refactors.
- [x] Existing new-session model path remains unchanged.
- [x] Resume path validates provider/model compatibility.
- [x] Picker no longer conflates pending preference with applied runtime model.
- [x] Context indicator no longer overstates active runtime context window.
- [x] Workflow workers inherit the hydrated model.
- [x] Slash command failure is observable during model repair.
- [x] Tests cover new session and resumed-session model hydration; typecheck covers picker/context indicator integration. Workflow inherits the hydrated parent session model through existing launch-option forwarding.

#### Acceptance Criteria

- Resuming a session with defaults `zhipu-coding / glm-5.2` yields in-flight `session.model === "glm-5.2"`.
- `RealKodaXSession` sends SDK options with `model: "glm-5.2"` for the next turn after resume.
- Context indicator shows `1.0M` only when the active runtime model is `glm-5.2` or no active runtime exists and it is clearly a next-session/default preview.
- Re-selecting `glm-5.2` in a drifted active session executes `/model glm-5.2` and updates renderer session metadata.
- Workflow/AMA launch options include `model: "glm-5.2"` when the active parent session is expected to use it.
- With `compaction.triggerPercent: 50`, automatic compaction does not trigger near 100k for an active `glm-5.2` session.

#### Resolution

Implemented a Space-side fix that keeps active runtime model state aligned across resume, picker display, context-window calculation, and workflow launch inheritance.

Resolution details:

- `host.tryResume()` now reads the configured KodaX default model, validates it against the resolved provider, and passes it into `createSession()` for resumed sessions.
- Invalid stale configured models are ignored with a diagnostic warning instead of being passed to SDK runtime.
- `ModelEffortSelector` now treats `session.model` as the active-session source of truth, falling back to provider default when the runtime model is unset.
- Picker model commits now compare against runtime model state, so selecting `glm-5.2` can repair a resumed session whose UI preference showed `glm-5.2` while runtime model was unset.
- Successful picker `/model` execution updates renderer session metadata with the applied model; IPC/slash failures are logged instead of silently swallowed.
- `ContextWindowIndicator` now uses active runtime model for active sessions and only uses pending/config model as a no-active-session preview.
- Workflow/AMA workers continue to inherit `session.model` through the existing workflow launch paths; after resume hydration the inherited model is no longer omitted.

Files changed:

- `apps/desktop/electron/kodax/host.ts`
- `apps/desktop/renderer/src/shell/ModelEffortSelector.tsx`
- `apps/desktop/renderer/src/shell/ContextWindowIndicator.tsx`
- `apps/desktop/electron/test/host-try-resume.test.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- `tryResume hydrates configured model when it belongs to the resolved provider`
- `tryResume ignores configured model when it does not belong to the resolved provider`

Verification:

- `node --test --import tsx/esm electron/test/host-try-resume.test.ts electron/test/resolve-active-model.test.ts electron/test/create-session-inputs.test.ts` from `apps/desktop` passed: 17/17.
- `npm run typecheck` passed.
- Initial `npm test -- ...` attempt was blocked by sandbox `spawn EPERM` and workspace glob behavior; targeted tests were rerun directly with elevated sandbox permissions.

### 002: Space used SDK MessageQueue `agentId` for main-thread prompts, preventing runner drain and making prior queue fix incorrect

- Priority: High
- Status: Resolved
- Introduced: v0.1.4
- Fixed: v0.1.21
- Created: 2026-06-22
- Resolution Date: 2026-06-22

#### Original Problem

Current behavior:

- Space intended to support mid-turn follow-up prompts by enqueueing them into the KodaX SDK process-global `MessageQueue`.
- The previous Space-side queue fix called `enqueueUserPrompt(sessionId, prompt)` and passed `agentId: sessionId` into SDK queue entries.
- SDK runner-driven main-thread drains consume only main-thread prompt entries where `agentId === undefined`.
- Therefore a queued user prompt could appear in the queue but never be consumed by the active runner.

Expected behavior:

- Space should enqueue prompts in the SDK shape that the runner actually drains.
- Cross-session safety must still be preserved, because omitting `agentId` makes the SDK queue process-global.

#### Context

Affected components:

- `apps/desktop/electron/ipc/queue.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/test/queue.test.ts`

Observed evidence:

- SDK type definitions and runner comments state main-thread prompt drains target canonical prompt messages, not arbitrary Space session IDs.
- The SDK queue `agentId` field is for child/current agent routing, not a Space desktop session identifier.
- The old Space comment claiming `agentId=this.sessionId` was required was therefore the wrong repair.

#### Root Cause

Space conflated two different identities:

1. Space desktop session ID, used by renderer/host to route UI sessions.
2. SDK queue `agentId`, used by KodaX runner internals to route agent-specific messages.

Passing the Space session ID into `agentId` made the message safer-looking from Space's point of view but invisible to the SDK main-thread drain.

#### Proposed Solution

Use SDK main-thread prompt semantics and add Space-side ownership protection:

1. Enqueue mid-turn prompts without `agentId`.
2. Track a Space-side owner session while main-thread prompts are pending.
3. Reject another session from starting or queueing while a different session owns pending main-thread prompts.
4. Drain only when the Space owner matches the cancelling/disposing session.
5. Release the owner after the queue drains.

#### Detailed Fix Plan

| File                                          | Change Summary                                                                              | Reason                                                                          | Expected Outcome                                                      | Risks                                                              | Tests                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| `apps/desktop/electron/ipc/queue.ts`          | Omit `agentId`; add `mainThreadPromptOwnerSessionId`; guard enqueue/start/drain/release     | Match SDK drain semantics while preventing cross-session stealing               | Active runner consumes queued prompt; another session cannot steal it | Global owner can briefly block another session until drain/release | `queue.test.ts`                                |
| `apps/desktop/electron/kodax/real-session.ts` | Check queue owner before starting an idle run; release owner after run settles              | Idle run from another session could otherwise drain pending main-thread prompts | Cross-session runs wait until pending prompt is consumed              | User gets explicit error if they race sessions                     | Covered through queue unit tests and typecheck |
| `apps/desktop/electron/test/queue.test.ts`    | Assert queued prompt has `agentId === undefined`; assert owner guard blocks another session | Regression coverage for the exact wrong previous fix                            | Future changes cannot reintroduce `agentId=sessionId` silently        | Depends on SDK queue test reset hook                               | New test                                       |

#### Acceptance Criteria

- `enqueueUserPrompt()` creates SDK queue entries with `agentId === undefined`.
- SDK `peek({ agentId: sessionId })` does not see the message; main-thread prompt peek does.
- Another Space session cannot start/drain while the owner session has pending main-thread prompt input.
- Cancelling/disposing the owner session drains its queued prompt and releases ownership.

#### Resolution

Resolved the immediate SDK contract bug by confirming Space follow-up prompts must not use SDK `agentId=sessionId` for main-thread drains. The first owner-guard implementation was later found insufficient for already-running concurrent sessions; see issue 007 for the final Space-owned per-session queue repair.

### 003: SDK `askUser` / `askUserMulti` / `askUserInput` callbacks were not wired to Space UI

- Priority: High
- Status: Resolved
- Introduced: v0.1.21
- Fixed: v0.1.21
- Created: 2026-06-22
- Resolution Date: 2026-06-22

#### Original Problem

Current behavior:

- KodaX SDK exposes `KodaXEvents.askUser`, `askUserMulti`, and `askUserInput` for the built-in `ask_user_question` tool and interactive host questions.
- Space only wired `AutoModeAskUser` guardrail allow/block escalation through `askUserBroker`.
- If the SDK asked a real select/input question, Space had no callback implementation, so the tool path degraded as if the host were headless.

Expected behavior:

- Space should surface SDK interactive questions in the renderer and return the user's answer to the SDK.
- Guardrail allow/block prompts must remain backward compatible.

#### Context

Affected components:

- `packages/space-ipc-schema/src/channels/ask-user.ts`
- `apps/desktop/electron/permission/ask-user-broker.ts`
- `apps/desktop/electron/ipc/ask-user.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/renderer/src/features/ask-user/AskUserModal.tsx`
- `packages/space-ipc-schema/test/ask-user.test.ts`
- `apps/desktop/electron/test/ask-user-broker.test.ts`

#### Root Cause

Space treated `askUser` as only an auto-mode guardrail concept, but the SDK now exposes a broader host interaction contract. The IPC schema and modal supported only `verdict: allow | block`, not string answers or cancellation.

#### Proposed Solution

Extend the existing ask-user channel rather than creating a parallel queue:

1. Keep guardrail payloads compatible; add optional `kind: 'guardrail'`.
2. Add `kind: 'select' | 'input'` request payloads for SDK questions.
3. Let replies carry either `{ verdict }`, `{ value }`, or `{ cancelled: true }`.
4. Add broker methods that resolve guardrails to allow/block and questions to string/undefined.
5. Wire all three SDK callbacks in `RealKodaXSession`.
6. Render select/input prompts in `AskUserModal`.

#### Detailed Fix Plan

| File                                                           | Change Summary                                                  | Reason                                                             | Expected Outcome                                    | Risks                          | Tests        |
| -------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------ | ------------ |
| `packages/space-ipc-schema/src/channels/ask-user.ts`           | Add union request/reply schemas for guardrail/select/input      | IPC needs to represent SDK question answers                        | Backward-compatible guardrail and new question flow | Renderer/main type mismatches  | Schema tests |
| `apps/desktop/electron/permission/ask-user-broker.ts`          | Add `requestQuestion()` and union reply resolution              | Broker needs different cancel semantics for guardrail vs questions | Guardrail timeout blocks; question timeout cancels  | Incorrect stale reqId handling | Broker tests |
| `apps/desktop/electron/ipc/ask-user.ts`                        | Pass full reply object to broker                                | Broker must distinguish verdict/value/cancel                       | Correct answer routing                              | None                           | Typecheck    |
| `apps/desktop/electron/kodax/real-session.ts`                  | Wire `askUser`, `askUserMulti`, `askUserInput` in `KodaXEvents` | SDK callbacks need live UI host                                    | `ask_user_question` works in Space                  | Select with no options cancels | Typecheck    |
| `apps/desktop/renderer/src/features/ask-user/AskUserModal.tsx` | Render guardrail/select/input modes                             | User needs to answer SDK questions                                 | Modal can submit strings or cancel                  | UI complexity                  | Typecheck    |

#### Acceptance Criteria

- Existing guardrail allow/block requests still parse and resolve.
- Select question requests with options parse and render.
- Input question requests parse and render.
- Renderer can reply with a string value or cancellation.
- SDK `askUser` gets a string or the SDK cancel result; `askUserInput` and `askUserMulti` get `undefined` on cancel.

#### Resolution

Implemented the extended IPC schema, broker, renderer modal, and `RealKodaXSession` event wiring. Added schema tests and broker tests for select/input answer and cancellation behavior.

### 004: MCP manager reload could be overwritten by a stale in-flight initializer

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.x
- Fixed: v0.1.21
- Created: 2026-06-22
- Resolution Date: 2026-06-22

#### Original Problem

Current behavior:

- `getMcpManager()` caches an in-flight async initialization promise.
- `reloadMcpManager()` clears `cached` and `initPromise`.
- If the old initialization resolves after reload, it can still assign `cached = oldManager`, undoing the reload.

Expected behavior:

- Reload should invalidate all older in-flight initializers.
- A stale initializer must not write back into cache.

#### Root Cause

The singleton used `initPromise` as a concurrency guard but had no generation/epoch check. Clearing `initPromise` during reload did not stop the older closure from later assigning `cached`.

#### Proposed Solution

Add an initialization generation counter:

1. Capture `initGeneration` at initialization start.
2. Increment generation during reload/dispose.
3. After constructing a manager, only write `cached` if the generation still matches.
4. Dispose stale constructed managers and retry against the current generation.
5. Only clear `initPromise` from the initializer that still owns the current generation.

#### Resolution

Implemented a generation barrier in `apps/desktop/electron/mcp/manager.ts`. Stale initializers now dispose their manager and re-enter `getMcpManager()` for the current generation instead of overwriting cache.

### 005: Context window indicator could keep the previous model cap while the new model cap was loading

- Priority: Low
- Status: Resolved
- Introduced: v0.1.21
- Fixed: v0.1.21
- Created: 2026-06-22
- Resolution Date: 2026-06-22

#### Original Problem

Current behavior:

- `useResolvedContextWindow()` keeps the previous `resolved` state while a new `(provider, model)` key is loading or already marked pending in cache.
- During a model/provider switch, the UI can temporarily display the old model's cap.

Expected behavior:

- While the new cap is loading, the component should fall back to the current model's hardcoded fallback, not the previous model's resolved cap.

#### Root Cause

The hook used a single `resolved` state value without clearing it on key changes when the new key had no resolved number yet.

#### Resolution

`ContextWindowIndicator` now clears `resolved` to `null` when provider/model is missing, when a new key is pending, or before starting a fresh IPC lookup. The returned cap falls back to the current model's hardcoded fallback during the pending period.

### 006: Persisted SDK session summaries do not expose exact historical runtime model metadata

- Priority: Medium
- Status: Resolved
- Introduced: pre-v0.1.21
- Fixed: v0.1.30
- Created: 2026-06-22
- Resolution Date: 2026-07-10

#### Original Problem

Current behavior:

- KodaX SDK persisted session summaries used by Space restore/list paths do not provide exact per-session runtime provider/model metadata.
- Space can hydrate resumed sessions from current defaults, which fixes the common `glm-5.2` default case, but cannot reconstruct an older session's exact model if that session used a non-current override and the SDK summary does not expose it.

Expected behavior:

- A historical session should resume with the exact model it last used, not merely the current configured default.

#### Context

Affected area:

- SDK session summary/list interface.
- Space `session-store` and resume hydration path.

#### Root Cause

The SDK's upward session summary contract does not currently include the runtime model. Space therefore lacks authoritative historical data for sessions created before any Space-side metadata sidecar exists.

#### Proposed Solution

Two viable repair paths:

1. Preferred SDK contract repair:
   - Extend SDK persisted session summary to expose provider/model/thinking metadata.
   - Space consumes those fields in session list and resume hydration.

2. Space sidecar fallback:
   - Add a Space-owned session metadata store keyed by `sessionId`.
   - Write model/provider on session creation and after successful `/model` commits.
   - Read sidecar metadata during resume before falling back to current defaults.
   - Clearly mark pre-sidecar sessions as best-effort when no metadata exists.

#### Detailed Fix Plan

| File / Layer           | Change Summary                                             | Reason                                              | Expected Outcome                                     | Risks                                      | Tests                    |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------ | ------------------------ |
| SDK session summary    | Expose provider/model/thinking in persisted summaries      | Provides authoritative historical runtime metadata  | Space can resume exact historical model              | Requires SDK change/release                | SDK storage/list tests   |
| Space sidecar metadata | Persist per-session model/provider on create and `/model`  | Works even if SDK summary cannot change immediately | Future sessions resume exact model                   | Must avoid stale metadata when slash fails | Host/session-store tests |
| Space resume path      | Prefer SDK summary or sidecar model, then current defaults | Deterministic fallback ladder                       | No silent historical model drift for future sessions | Old sessions remain best-effort            | Resume regression tests  |

#### Acceptance Criteria

- Future sessions persist exact model/provider metadata at the time it is applied.
- Resuming a session uses persisted session metadata before current defaults.
- If no historical metadata exists, UI/runtime explicitly fall back to current defaults without pretending it is the original model.

#### Resolution

Resolved for all sessions created or mutated after the v0.1.30 sidecar migration:

- `session-runtime-store.ts` now persists provider, effective model, `thinking`, `reasoningMode`, `permissionMode`, `autoModeEngine`, and `agentMode` by session id through a compare-and-swap atomic file primitive.
- Create, promote, fork, provider/model/thinking setters, IPC setters, and slash-command mutations all persist the effective runtime metadata. Explicit `undefined` clears model/thinking instead of silently retaining stale values.
- Resume prefers validated sidecar metadata, rejects malformed/schema-invalid state without overwriting its bytes, validates provider/model compatibility, and falls back safely when a provider has been removed.
- Forked sessions inherit and persist the source session's exact model/thinking state.
- A `session_running` delete refusal now returns `deleted: false`, preserving the still-live session's runtime/title/notice sidecars instead of reporting success and erasing exact metadata.
- Pre-sidecar sessions are explicitly labeled `runtimeMetadataSource: 'current-default-fallback'`; exact sessions use `persisted`. The UI marks fallback history and excludes it from exact historical model analytics rather than pretending the current default was the original model.

Files changed:

- `apps/desktop/electron/kodax/atomic-file.ts`
- `apps/desktop/electron/kodax/session-runtime-store.ts`
- `apps/desktop/electron/kodax/host.ts`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/slash/builtin.ts`
- `packages/space-ipc-schema/src/channels/session.ts`
- Session list/dashboard renderer surfaces and focused regression tests.

Verification covers exact create/resume/fork/mutation persistence, legacy fallback labeling, corrupt-sidecar preservation, custom providers, removed providers, explicit clears, and runtime/UI schema propagation. Historical sessions that predate the sidecar cannot be reconstructed retroactively; they are now represented honestly as fallback rather than being misreported as exact.

### 007: SDK main-thread follow-up owner guard did not protect already-running concurrent sessions

- Priority: High
- Status: Resolved
- Introduced: v0.1.21
- Fixed: v0.1.21
- Created: 2026-06-22
- Resolution Date: 2026-06-22

#### Original Problem

Current behavior:

- Space repaired issue 002 by enqueueing follow-up prompts into the SDK main-thread queue and adding a Space-side owner guard.
- The owner guard only ran when Space enqueued a prompt or started a new idle run.
- If another Space session was already running before the prompt was queued, that already-running SDK runner could still drain the process-global main-thread prompt.
- Blocking all other sessions globally would avoid the race but would break the product requirement that multiple Space sessions can run at the same time.

Expected behavior:

- Follow-up prompts sent while a session is running must be consumed only by that same Space session.
- Other Space sessions must be able to keep running concurrently.
- SDK internal subagent/task-notification queue visibility must remain available in the queue UI.

#### Context

Affected components:

- `apps/desktop/electron/ipc/queue.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/test/queue.test.ts`

Observed evidence:

- KodaX SDK `MessageQueue` documents that `agentId: undefined` matches only main-thread messages, not any agent.
- SDK main-thread drains use `dequeue({ agentId: undefined, ... })` and have no Space session identifier.
- A Space owner guard outside the SDK drain path cannot affect a runner that is already executing.

#### Root Cause

The SDK main-thread queue is scoped to the process, while Space desktop sessions are separate UI/runtime identities above the SDK. The previous owner guard protected only Space entry points; it did not change SDK drain semantics. Therefore it could not prove session ownership at the actual dequeue site.

#### Proposed Solution

Move Space user follow-up prompts out of the SDK main-thread queue:

1. Keep SDK `MessageQueue` exposed for observability and SDK-internal messages.
2. Store Space user follow-up prompts in a Space-owned queue keyed by `sessionId`.
3. When a `RealKodaXSession` finishes its current turn, pop only that session's next queued prompt and start a new run.
4. On cancel/dispose, drain only that session's Space-owned queued prompts.
5. Keep per-session queue depth limits so one active session does not block another active session.

#### Detailed Fix Plan

| File                                          | Change Summary                                                                                                                           | Reason                                                      | Expected Outcome                                                   | Risks                                                                         | Tests                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------ |
| `apps/desktop/electron/ipc/queue.ts`          | Replace Space prompt use of SDK main-thread queue with a Space-owned `Map<sessionId, QueuedMessage[]>`; keep SDK queue snapshots visible | SDK main-thread queue cannot encode Space session identity  | Queued prompts are impossible for another Space session to drain   | UI queue now contains both SDK and Space-owned items                          | `queue.test.ts`                |
| `apps/desktop/electron/kodax/real-session.ts` | Start queued prompts from the same session after the current turn settles                                                                | Preserves follow-up UX without global session serialization | Multiple sessions can keep running; each drains only itself        | Follow-up prompt starts after current turn rather than SDK mid-turn injection | Typecheck and queue unit tests |
| `apps/desktop/electron/test/queue.test.ts`    | Assert Space prompts do not enter SDK main-thread queue; assert s1/s2 queues are independent                                             | Prevents reintroducing the global drain race                | Regression catches both wrong `agentId` and wrong global queue use | Requires renderer push target stub in tests                                   | New tests                      |

#### Acceptance Criteria

- `enqueueUserPrompt('s1', ...)` does not create an SDK main-thread queue entry.
- `dequeueNextUserPromptForSession('s2')` cannot consume `s1` prompts.
- `drainQueueForSession('s2')` does not clear `s1` prompts.
- One session reaching its prompt queue depth limit does not prevent another session from queueing its own prompt.
- Cancelling/dispose drains only the affected session's Space-owned prompts.
- Multiple sessions remain able to run at the same time.

#### Resolution

Implemented the Space-owned per-session prompt queue and removed Space follow-up prompts from the SDK main-thread queue. `RealKodaXSession` now starts the next queued prompt for the same session when the current turn settles. The SDK queue remains exposed for SDK-internal observability, and queue UI snapshots include Space-owned prompt items.

Tests added:

- `enqueueUserPrompt stores Space prompts per session without SDK main-thread queue`
- `per-session prompt queues do not block other active sessions`
- `drainQueueForSession clears only that session`
- `queue depth is enforced per session, not globally`
