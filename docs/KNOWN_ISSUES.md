# Known Issues

Last Updated: 2026-07-12

## Issue Index

| ID  | Priority | Status   | Title                                                                                                                       | Introduced            | Created    |
| --- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------- |
| 001 | High     | Resolved | Resumed sessions display `glm-5.2` but run with provider default `glm-5`, causing early compaction                          | v0.1.21               | 2026-06-22 |
| 002 | High     | Resolved | Space used SDK MessageQueue `agentId` for main-thread prompts, preventing runner drain and making prior queue fix incorrect | v0.1.4                | 2026-06-22 |
| 003 | High     | Resolved | SDK `askUser` / `askUserMulti` / `askUserInput` callbacks were not wired to Space UI                                        | v0.1.21               | 2026-06-22 |
| 004 | Medium   | Resolved | MCP manager reload could be overwritten by a stale in-flight initializer                                                    | v0.1.x                | 2026-06-22 |
| 005 | Low      | Resolved | Context window indicator could keep the previous model cap while the new model cap was loading                              | v0.1.21               | 2026-06-22 |
| 006 | Medium   | Resolved | Persisted SDK session summaries do not expose exact historical runtime model metadata                                       | pre-v0.1.21           | 2026-06-22 |
| 007 | High     | Resolved | SDK main-thread follow-up owner guard did not protect already-running concurrent sessions                                   | v0.1.21               | 2026-06-22 |
| 008 | High     | Resolved | Real KodaX sessions did not register configured MCP capability provider                                                     | v0.1.x                | 2026-06-23 |
| 009 | High     | Resolved | Space per-session follow-up queue removed SDK mid-turn queue-query insertion                                                | v0.1.21               | 2026-06-23 |
| 010 | High     | Resolved | Changing current project could keep a stale active session, so agent ran in the previous workspace                          | v0.1.x                | 2026-06-23 |
| 011 | Medium   | Resolved | Streaming transcript auto-follow ignores upward wheel input and locks the view to the bottom                                | v0.1.23               | 2026-06-24 |
| 012 | High     | Resolved | Mid-turn interrupt prompts stayed visually above the spinner because SDK prompt-consumption events were not surfaced        | v0.1.22               | 2026-06-24 |
| 013 | High     | Resolved | Restored KodaX sessions could pair assistant segments with the following user prompt after consecutive user messages        | v0.1.29               | 2026-07-08 |
| 014 | Medium   | Resolved | Session rename reverted after switching sessions because manual titles were not persisted outside memory                    | v0.1.29               | 2026-07-08 |
| 015 | High     | Resolved | Partner capability redesign drift allowed overly broad workspace delivery writes and stale output registry state            | v0.1.30               | 2026-07-09 |
| 016 | High     | Resolved | Partner helper VM exposed host constructors and allowed escape to Node process and unrestricted filesystem                  | v0.1.30               | 2026-07-10 |
| 017 | High     | Resolved | Partner corrupted Unicode PDF output and could not read PDF or Office sources                                               | v0.1.30               | 2026-07-10 |
| 018 | High     | Resolved | Active queue watcher deleted Partner follow-up overlay before dequeue returned it                                           | v0.1.30               | 2026-07-10 |
| 019 | High     | Resolved | Partner KB could not search Chinese and could overwrite corrupt durable state                                               | v0.1.30               | 2026-07-10 |
| 020 | High     | Resolved | Partner file paths, writes, decoding, hashing, and durable stores had unsafe edge cases                                     | v0.1.30               | 2026-07-10 |
| 021 | Medium   | Resolved | Partner advertised unavailable SDK Skills and Outputs lacked an in-app delivery preview loop                                | v0.1.30               | 2026-07-10 |
| 022 | Medium   | Open     | KodaX Runtime lacks a general per-invocation execution service for Partner helper migration                                 | KodaX 0.7.66 adoption | 2026-07-10 |
| 023 | Medium   | Resolved | Composer file picker opened the project-directory dialog and could not select images or files                               | v0.1.30               | 2026-07-11 |
| 024 | High     | Resolved | ACP placeholder sessions consumed the 200-row Space history window and hid real project sessions                            | v0.1.30               | 2026-07-11 |
| 025 | High     | Resolved | KodaX ACP tests persist fixture sessions into the real user session/runtime directories                                     | KodaX 0.7.66          | 2026-07-11 |
| 026 | High     | Resolved | Space E2E test mode isolated app data but left the SDK session home pointed at the real user directory                      | v0.1.30               | 2026-07-11 |
| 027 | High     | Resolved | A global 200-session window let one busy project make other project histories appear empty                                  | v0.1.30               | 2026-07-11 |
| 028 | High     | Resolved | External Agent event pagination could skip audit events after the first 512 entries                                         | v0.1.30               | 2026-07-12 |
| 029 | High     | Resolved | Renderer could supply a new opaque Agent identity to the Reference update path                                              | v0.1.30               | 2026-07-12 |
| 030 | Medium   | Resolved | Workflow external-target wrapper lost method receiver and did not always audit the resolved revision                        | v0.1.30               | 2026-07-12 |
| 031 | High     | Resolved | Packaged smoke still expected KodaX 0.7.66 after the 0.7.67 integration                                                     | v0.1.30               | 2026-07-12 |
| 032 | High     | Resolved | External Agent task IPC trusted renderer ownership and Task Dock could show/control stale cross-session tasks               | v0.1.30               | 2026-07-12 |
| 033 | Low      | Resolved | Project Session spinner remained visible over already-restored rows after switching surfaces                                | v0.1.30               | 2026-07-12 |
| 034 | Medium   | Resolved | Task Dock width presets drifted from responsive default, explicit half, and full-workspace behavior                         | v0.1.30               | 2026-07-12 |

## Issue Details

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

### 008: Real KodaX sessions did not register configured MCP capability provider

- Priority: High
- Status: Resolved
- Introduced: v0.1.x
- Fixed: v0.1.22
- Created: 2026-06-23
- Resolution Date: 2026-06-23

#### Original Problem

Current behavior:

- KodaX Space could show MCP servers in the MCP popout because the popout owns a separate `McpManager`.
- The actual `RealKodaXSession` agent runtime did not create a SDK extension runtime and did not call `registerConfiguredMcpCapabilityProvider()` for `~/.kodax/config.json` `mcpServers`.
- As a result, agent turns could miss `mcp_search`, `mcp_read_resource`, `mcp_call`, and related MCP capabilities even though the same config worked in KodaX CLI.

Expected behavior:

- Each real Space session should provide the KodaX SDK with an extension runtime containing the configured MCP capability provider.
- MCP reverse capabilities should expose the current Space project root, matching the CLI/ACP host contract.
- Filesystem extension discovery remains opt-in behind `KODAX_SPACE_ENABLE_SDK_EXTENSIONS`; configured MCP servers are not env-gated.

#### Context

Affected components:

- `apps/desktop/electron/kodax/sdk-extensions.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/test/sdk-extensions.test.ts`
- `apps/desktop/electron/slash/builtin.ts`
- `apps/desktop/electron/mcp/kodax-user-config-loader.ts`
- `apps/desktop/electron/ipc/mcp.ts`
- `apps/desktop/electron/ipc/mcpb.ts`
- `apps/desktop/electron/mcp/manager.ts`
- `apps/desktop/renderer/src/shell/popouts/McpPanel.tsx`
- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `packages/space-ipc-schema/src/channels/mcp.ts`
- `packages/space-ipc-schema/test/mcp.test.ts`

#### Root Cause

Space had MCP lifecycle wiring for the UI popout, but that manager is intentionally not shared with the SDK agent runtime. The real session path called `runManagedTask()` without an `extensionRuntime`, so SDK capability lookup had no MCP provider. A preliminary `sdk-extensions.ts` module existed but only loaded filesystem extensions and was not connected to `RealKodaXSession`.

#### Resolution

Implemented per-session SDK extension runtime wiring:

- `createSpaceSdkExtensionRuntime()` now checks KodaX `mcpServers`, creates a SDK extension runtime when MCP is configured, registers `registerConfiguredMcpCapabilityProvider()`, and injects `buildMcpReverseCapabilities({ cwd: projectRoot, enableElicitation: true })`.
- The helper merges global `~/.kodax/config.json` MCP servers with project-level `${projectRoot}/.kodax/config.json` MCP servers, preserving raw SDK config fields and letting project config override by server name.
- Project-level MCP remains usable even if global config loading fails; malformed individual server entries are ignored instead of crashing runtime creation.
- The helper returns `undefined` without loading the SDK when neither MCP nor env-enabled filesystem extensions are present.
- `RealKodaXSession` now lazily creates and caches this runtime before building `KodaXOptions`, passes it as `options.extensionRuntime`, and disposes it when the session is disposed.
- MCP reload and MCP bundle install/uninstall invalidate cached session runtimes via a SDK extension config generation, so existing sessions rebuild their MCP runtime on the next turn.
- If config generation changes while a runtime is still initializing, the stale runtime is disposed and the current turn retries once against the new generation.
- The MCP popout lifecycle manager now supports an optional projectRoot scope, so project-level servers can be listed, started, stopped, inspected, and queried for tools instead of only appearing in discover output.
- `/extensions sdk load` active runtimes are now replaced through the helper, disposing the previous Space-owned active runtime before installing a new one.
- Filesystem extension loading remains controlled by `KODAX_SPACE_ENABLE_SDK_EXTENSIONS`; configured MCP servers are always considered.

Files changed:

- `apps/desktop/electron/kodax/sdk-extensions.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/test/sdk-extensions.test.ts`
- `apps/desktop/electron/slash/builtin.ts`
- `apps/desktop/electron/mcp/kodax-user-config-loader.ts`
- `apps/desktop/electron/ipc/mcp.ts`
- `apps/desktop/electron/ipc/mcpb.ts`

Tests added:

- `sdkExtensionsEnabledByEnv accepts common truthy values only`
- `hasEnabledMcpServers ignores missing, disabled, and malformed servers`
- `loadKodaxProjectMcpServers reads raw project-level MCP config`
- `createSpaceSdkExtensionRuntime returns undefined without MCP or enabled filesystem extensions`
- `createSpaceSdkExtensionRuntime registers configured MCP provider with project roots`
- `createSpaceSdkExtensionRuntime disposes runtime when MCP provider registration fails`
- `createSpaceSdkExtensionRuntime replaces and disposes active runtimes only when requested`
- `invalidateSpaceSdkExtensionRuntimes increments generation and disposes active runtime`
- `createSpaceSdkExtensionRuntime loads filesystem extensions only when env-enabled`
- `mcp lifecycle inputs accept optional projectRoot scope`

Verification:

- `node --test --import tsx/esm electron/test/sdk-extensions.test.ts electron/test/host.test.ts electron/test/host-try-resume.test.ts electron/test/slash-builtin.test.ts electron/test/mcp-config-reader.test.ts` from `apps/desktop` passed: 95/95.
- `node --test --import tsx/esm packages/space-ipc-schema/test/mcp.test.ts` passed: 9/9.
- `npm run typecheck` passed.

### 009: Space per-session follow-up queue removed SDK mid-turn queue-query insertion

- Priority: High
- Status: Resolved
- Introduced: v0.1.21
- Fixed: v0.1.22
- Created: 2026-06-23
- Resolution Date: 2026-06-23

#### Original Problem

Current behavior:

- Issue 007 moved Space follow-up prompts out of the SDK main-thread `MessageQueue` into a Space-owned per-session queue.
- That fixed the cross-session drain race, but it also removed KodaX's native mid-turn `queue-query` insertion path for Space follow-up prompts.
- A prompt sent while a Space session was running could only start after the current run settled, even when the SDK had a safe mid-turn drain point.

Expected behavior:

- Space should support both follow-up semantics while a session is running:
  - `interrupt`: enter the SDK main-thread queue so KodaX can inject at the next safe mid-turn boundary.
  - `after-turn`: stay in a Space-owned per-session queue and run only after the current turn settles.
- The composer should expose the choice directly: `Enter` defaults to `interrupt`; `Ctrl+Enter` / `Cmd+Enter` selects `after-turn`; `Shift+Enter` remains newline.
- Prompts in either mode must be owned by the Space session that queued them.
- A different already-running Space session must not be able to drain another session's prompt.
- If an interrupt prompt is not consumed by a SDK mid-turn drain before settle, Space should still run it as the next prompt for the same session.

#### Root Cause

Space previously treated follow-up queueing as a single backend policy. The SDK process-global main-thread queue enabled mid-turn insertion but needed a Space session ownership layer; the Space-owned per-session queue had ownership but bypassed SDK mid-turn drains. Users need both behaviors, so the mode must be explicit at the UI/IPC boundary instead of being guessed by the backend.

#### Resolution

Implemented explicit queue modes across renderer, IPC, and main-process queue handling:

- Added `session.send.queueMode` with default `interrupt` and queued ACK `queueMode` in the IPC schema.
- The composer now maps `Enter` to `interrupt` and `Ctrl+Enter` / `Cmd+Enter` to `after-turn`; send button remains default interrupt.
- `RealKodaXSession.send()` forwards the requested mode when a turn is already running and rejects image attachments during an active turn as before.
- `interrupt` prompts enqueue into the SDK main-thread queue with `agentId === undefined`, preserving KodaX mid-turn drain behavior.
- `after-turn` prompts enqueue into a Space-owned per-session queue and are only started after the current turn settles.
- `RealKodaXSession` wraps each `sdk.runManagedTask()` call in an `AsyncLocalStorage` queue scope keyed by Space `sessionId`, so SDK `dequeue` / `peek` / `count` / `has` calls cannot consume another Space session's owner-tagged interrupt prompt.
- `dequeueNextUserPromptForSession()` compares both modes with a monotonic Space receive order so fallback execution remains stable even when prompts are queued in the same millisecond.
- Queue IPC snapshots include both SDK interrupt prompts and Space after-turn prompts, and renderer payloads remain content-clamped for schema safety.
- Conversation history composition treats a later `session_start` as a new user-turn boundary, so interrupt-queued prompts cannot inherit prior stream output while waiting for a terminal event.
- Cancel/dispose drains both queues for the affected session only.

Files changed:

- `packages/space-ipc-schema/src/channels/session.ts`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/ipc/queue.ts`
- `apps/desktop/electron/kodax/session-queue-guard.ts`
- `apps/desktop/electron/kodax/session-adapter.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/kodax/mock-session.ts`
- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `apps/desktop/renderer/src/features/session/composeMessages.ts`
- `apps/desktop/electron/test/queue.test.ts`
- `apps/desktop/electron/test/composeMessages.test.ts`
- `packages/space-ipc-schema/test/session.test.ts`
- `apps/desktop/electron/test/slash-ipc.test.ts`
- `packages/space-ipc-schema/test/slash.test.ts`

Tests added/updated:

- `enqueueUserPrompt enters SDK main-thread queue but drains only its owner session`
- `after-turn follow-up stays out of the SDK queue until session settles`
- `after-turn prompts are invisible to SDK mid-turn drains`
- `session queue scope lets SDK mid-turn drain only the current session prompt`
- `drainQueueForSession clears only that session across both queues`
- `queue IPC preview clamps large prompts while preserving raw prompt`
- `queue depth is enforced per session across both queue modes, not globally`
- `session_start can split an interrupt-queued user turn before terminal event`
- `session.send queueMode defaults to interrupt and accepts after-turn`
- `session.send queued output may include queueMode`

Verification:

- `node --test --import tsx/esm electron/test/queue.test.ts electron/test/composeMessages.test.ts electron/test/app-store-cancel-event.test.ts electron/test/host.test.ts electron/test/host-try-resume.test.ts electron/test/session-setters.test.ts` from `apps/desktop` passed: 71/71.
- `node --test --import tsx/esm test/session.test.ts` from `packages/space-ipc-schema` passed: 46/46.
- `npm run typecheck` passed.

### 010: Changing current project could keep a stale active session, so agent ran in the previous workspace

- Priority: High
- Status: Resolved
- Introduced: v0.1.x
- Fixed: v0.1.22
- Created: 2026-06-23
- Resolution Date: 2026-06-23

#### Original Problem

Current behavior:

- The UI breadcrumb and bottom project chip can show the newly selected project, such as `88. Finance Management System`.
- The active `currentSessionId` can still point at a session whose `projectRoot` is the previous default workspace, such as `/Users/vincegao/kodax_workspace`.
- Sending a prompt then reuses that stale session, so the agent runs in the previous workspace and reports that the selected project appears empty.

Expected behavior:

- Changing the current project should not leave an active session from a different project attached to the composer.
- Sending a prompt should reuse only a session that belongs to the displayed project and current surface; otherwise it should create a fresh session in the displayed project.

#### Context

Affected components:

- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `apps/desktop/renderer/src/features/quick-ask/QuickAskPopover.tsx`
- `apps/desktop/renderer/src/features/session/EventStream.tsx`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/ipc/slash.ts`
- `packages/space-ipc-schema/src/channels/session.ts`
- `packages/space-ipc-schema/src/channels/slash.ts`
- `apps/desktop/electron/test/set-current-session-syncs-project.test.ts`
- `apps/desktop/electron/test/session-send-scope.test.ts`
- `packages/space-ipc-schema/test/session.test.ts`
- `apps/desktop/electron/test/slash-ipc.test.ts`
- `packages/space-ipc-schema/test/slash.test.ts`

#### Root Cause

`setCurrentProject(path)` updated only `currentProjectPath` and persisted the path to localStorage. It did not clear or validate `currentSessionId`. `BottomBar.ensureSession()` then trusted any non-null `currentSessionId` without checking whether that session's `projectRoot` matched `currentProjectPath`. This allowed the UI to compose a new project label with an old session runtime.

#### Resolution

Implemented project/session scope validation on both state transition and send:

- `setCurrentProject()` now clears `currentSessionId` when switching to a project that does not match the active session's canonical `projectRoot`.
- `setCurrentProject(null)` clears the active session as well as the project.
- `setCurrentProject()` was hardened so any explicit switch to a different project starts from the new-session view, even if renderer metadata could otherwise preserve a session.
- Selecting the same canonical project keeps the current session, so no-op project picks do not disturb the user.
- `BottomBar.ensureSession()` now validates the active session with `sessionMatchesScope()` against the current project and surface before reusing it.
- If the active session is stale or missing from renderer session metadata, the composer clears it and creates a new session scoped to the displayed project.
- Async `session.create` and `session.fork` responses now activate the returned session only if the user is still viewing the same project and surface when the IPC call returns.
- Surface tab session memory now restores only sessions that still belong to the displayed project, so switching Coder/Partner after a project change cannot resurrect the previous project's session.
- `session.send` and `slash.exec` now accept optional `expectedProjectRoot` and `expectedSurface` guard fields.
- First-party renderer send and slash paths pass those guard fields from the displayed project/surface.
- The main process rejects a send before title mutation or agent execution if the resolved session scope does not match the expected project/surface.

Tests added:

- `setCurrentProject clears currentSessionId when active session belongs to previous project`
- `setCurrentProject clears currentSessionId when switching to a different project`
- `setCurrentProject keeps currentSessionId when target project is unchanged`
- `setSurface does not restore a remembered session from another project`
- `created session activates only when current project and surface still match`
- `missing session surface is treated as code for activation`
- `forked session does not activate after the user switched projects`
- `assertSessionSendScope rejects stale project root`
- `assertSessionSendScope rejects stale surface`
- `session.send accepts expected project and surface guard fields`
- `slash.exec rejects known commands when expected project root does not match session`
- `slash.exec rejects known commands when expected surface does not match session`
- `slash.exec input accepts expected project and surface guard fields`

Verification:

- `node --test --import tsx/esm electron/test/set-current-session-syncs-project.test.ts electron/test/surface-session-swap.test.ts electron/test/session-activation.test.ts electron/test/session-send-scope.test.ts` from `apps/desktop` passed: 21/21.
- `node --test --import tsx/esm test/session.test.ts test/slash.test.ts` from `packages/space-ipc-schema` passed: 51/51.
- `npm run typecheck` passed.

### 011: Streaming transcript auto-follow ignores upward wheel input and locks the view to the bottom

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.23
- Fixed: v0.1.23
- Created: 2026-06-24
- Resolution Date: 2026-06-24

#### Original Problem

Current behavior:

- During streaming assistant output, scrolling upward with the mouse wheel can feel stuck or locked to the bottom.
- The transcript briefly moves upward, then the next streamed content growth pulls it back down.
- The jump-to-bottom button can appear late or inconsistently because the scroll handler may ignore the real user scroll event.

Expected behavior:

- If the user wheels upward while output is streaming, the transcript should stop auto-following immediately.
- Auto-follow should resume only after the user scrolls back to the bottom or clicks the jump-to-bottom button.
- Programmatic scroll events from sticky-bottom maintenance should still not be mistaken for user intent.

Reproduction steps:

1. Start a prompt that produces a long streaming response.
2. Keep the transcript near the bottom while output is still growing.
3. Wheel upward before streaming finishes.
4. Observe that the view is pulled back to the bottom by subsequent streamed content.

#### Context

Affected components:

- `apps/desktop/renderer/src/shell/ConversationStreamV2.tsx`
- `apps/desktop/renderer/src/features/session/composeMessages.ts`
- `apps/desktop/renderer/src/features/session/messages/Markdown.tsx`

Observed evidence:

- `ConversationStreamV2` stores the auto-follow gate in `wasAtBottomRef`.
- `ResizeObserver` is the sticky-bottom executor: when content height changes and `wasAtBottomRef.current` is true, it marks a programmatic scroll and sets `scrollTop = scrollHeight`.
- `handleScroll` is the only place that normally flips `wasAtBottomRef.current` to false when the user leaves the bottom.
- `handleScroll` ignores every scroll event that occurs within `PROGRAMMATIC_SCROLL_GUARD_MS` after a programmatic scroll.
- Streaming `text_delta` updates accumulate into the same assistant bubble, and markdown rendering produces a new growing DOM tree during streaming, so `ResizeObserver` can refresh the guard repeatedly.

#### Root Cause

The current guard is time-based. It assumes programmatic scrolls are short, isolated events, but streaming output can trigger repeated `ResizeObserver` callbacks faster than the 400ms guard window expires. While auto-follow is active, each callback refreshes `lastProgrammaticScrollRef`.

A real upward wheel event during streaming can therefore reach `handleScroll` inside the refreshed guard window. The handler returns before updating `wasAtBottomRef.current`, so auto-follow remains enabled. The next content resize sees `wasAtBottomRef.current === true` and scrolls back to the bottom.

#### Proposed Solution

Use explicit user input events as the authoritative signal for scroll intent, while keeping the time guard for programmatic scroll race protection.

Recommended repair sequence:

1. Add a helper that computes bottom distance and updates `wasAtBottomRef` plus the jump button state.
2. Add explicit user-input handlers on the transcript scroller.
3. Treat upward wheel, upward keyboard navigation, touch movement toward older content, and scrollbar drag as explicit requests to leave the bottom, bypassing the time guard.
4. Let downward wheel/keyboard/touch movement sync from the actual scroll position so reaching the bottom restores follow mode.
5. Keep the existing programmatic scroll guard for scroll events caused by `ResizeObserver` or smooth scrolling.
6. Make `jumpToBottom()` explicitly restore `wasAtBottomRef.current = true` and hide the jump button before starting the smooth scroll.

#### Detailed Fix Plan

| File                                                       | Change Summary                                                                                                                                          | Reason                                                                      | Expected Outcome                                                                                       | Risks                                                                                                                                             | Tests                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `apps/desktop/renderer/src/shell/ConversationStreamV2.tsx` | Add explicit user scroll-intent handling; keep programmatic guard for resize/smooth-scroll events; make jump-to-bottom explicitly re-enable follow mode | User scroll intent must not be swallowed by the time guard during streaming | Upward wheel/keyboard/touch/scrollbar intent immediately disables auto-follow; bottom/jump restores it | Trackpad momentum could send small mixed deltas; use upward movement as the decisive break signal and sync downward movement from actual position | `npm run typecheck`; manual/e2e smoke if needed |
| `docs/KNOWN_ISSUES.md`                                     | Track issue 011 through resolution                                                                                                                      | Preserve root cause and fix rationale                                       | Future regressions can be compared against the documented behavior                                     | Documentation drift if not updated after verification                                                                                             | Review final issue entry                        |

Mandatory checklist:

- [x] Expected outcome is clearly defined.
- [x] No unrelated refactors.
- [x] Existing sticky-bottom behavior remains active when the user is at the bottom.
- [x] Existing programmatic scroll guard remains in place for the original ResizeObserver race.
- [x] User upward scroll intent can break auto-follow even during streaming.
- [x] Returning to the bottom or clicking jump-to-bottom restores auto-follow.

#### Acceptance Criteria

- While streaming, an upward wheel/keyboard/touch/scrollbar gesture immediately disables auto-follow.
- After upward user scroll intent, subsequent streamed content growth does not reset `scrollTop` to the bottom.
- Scrolling to the bottom re-enables auto-follow.
- Clicking the jump-to-bottom button re-enables auto-follow and hides the button.
- The previous programmatic-scroll race remains guarded.

#### Resolution

Implemented explicit user scroll-intent handling while preserving the existing programmatic scroll guard.

Resolution details:

- Added shared bottom-distance helpers in `ConversationStreamV2` so the scroll handler, user-intent handlers, and resize observer use the same thresholds.
- Kept the 400ms programmatic scroll guard for `ResizeObserver` and smooth-scroll events, preserving the original OC-18 race fix.
- Added `onWheelCapture` on the transcript scroller so upward wheel gestures immediately set `wasAtBottomRef.current = false` even if the following `scroll` event lands inside the programmatic guard window.
- Added keyboard, touch, and scrollbar-pointer intent handlers so other explicit user attempts to browse upward also bypass the programmatic scroll guard.
- Added next-frame position sync so downward user scroll gestures can restore auto-follow when the user reaches the bottom.
- Updated the `ResizeObserver` non-follow path to keep the jump-to-bottom button visibility current as streaming content continues to grow.
- Updated `jumpToBottom()` to explicitly restore `wasAtBottomRef.current = true` and hide the jump button before starting smooth scroll.

Files changed:

- `apps/desktop/renderer/src/shell/ConversationStreamV2.tsx`
- `docs/KNOWN_ISSUES.md`

Verification:

- `npx eslint apps/desktop/renderer/src/shell/ConversationStreamV2.tsx` passed.
- `npm run typecheck` passed.
- `npm run build -w @kodax-space/desktop` passed. Vite reported existing large-chunk and dynamic-import warnings, but the renderer build completed successfully.

### 012: Mid-turn interrupt prompts stayed visually above the spinner because SDK prompt-consumption events were not surfaced

- Priority: High
- Status: Resolved
- Introduced: v0.1.22
- Fixed: v0.1.23
- Created: 2026-06-24
- Resolution Date: 2026-06-24

#### Original Problem

Current behavior:

- `queueMode: interrupt` successfully entered the SDK main-thread queue and could be consumed mid-turn.
- The renderer optimistically appended the user's follow-up prompt immediately.
- Space did not surface the SDK `onMidTurnUserMessages` callback, so `composeMessages()` had no event boundary showing when the SDK actually consumed the queued prompt.
- While the current run kept streaming, the optimistic user bubble stayed directly above the live spinner and older stream output kept growing above it, visually resembling the old after-turn queue behavior.
- Even after mid-turn boundaries were surfaced, pending interrupt/after-turn prompts still looked like normal user bubbles before they had actually entered the agent flow.

Expected behavior:

- Once the SDK consumes an interrupt prompt mid-turn, Space should receive an explicit event boundary.
- Once Space starts an after-turn queued prompt, Space should receive an explicit event boundary with the original queue mode.
- Pending interrupt/after-turn prompts should have a distinct queued visual state until they are consumed or started.
- The transcript should split the current event segment at that boundary so subsequent assistant output belongs to the inserted user prompt.
- The live spinner should reset to the inserted prompt's current turn instead of inheriting the previous stream status.

#### Context

Affected components:

- `packages/space-ipc-schema/src/channels/session.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/ipc/queue.ts`
- `apps/desktop/electron/kodax/session-queue-guard.ts`
- `packages/space-ipc-schema/src/channels/queue.ts`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/features/session/composeMessages.ts`
- `apps/desktop/renderer/src/features/session/messages/bubbles.tsx`
- `apps/desktop/renderer/src/shell/ActivitySpinner.tsx`
- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `apps/desktop/renderer/src/shell/ConversationStreamV2.tsx`
- `apps/desktop/renderer/src/shell/QueueIndicator.tsx`
- `apps/desktop/electron/test/composeMessages.test.ts`
- `apps/desktop/electron/test/activitySpinner.test.ts`
- `apps/desktop/electron/test/queue.test.ts`
- `apps/desktop/electron/test/app-store-cancel-event.test.ts`
- `apps/desktop/electron/test/session-event-schema.test.ts`
- `packages/space-ipc-schema/test/session.test.ts`

#### Root Cause

The first interrupt-mode fix restored SDK queue insertion and guarded cross-session ownership, but the renderer only knew about optimistic local user messages and terminal or `session_start` boundaries. KodaX's runner-driven mid-turn insertion happens inside the same `runManagedTask()` call and does not emit a second `session_start`. The SDK exposes `KodaXEvents.onMidTurnUserMessages` for this exact UI boundary, but Space was not wiring it into `session.event`.

#### Resolution

Implemented explicit queued-prompt lifecycle boundaries and UI states:

- Added `session.event` kind `mid_turn_user_prompt` with clamped prompt content.
- Added `session.event` kind `queued_user_prompt_started` with `queueMode` and clamped prompt content for queued prompts that start after the current turn settles.
- Changed `dequeueNextUserPromptForSession()` to return both prompt content and queue mode.
- Added renderer-local `queuedUserMessagesBySession` state for prompts accepted into a queue but not yet effective.
- `BottomBar` now renders running-session sends as queued bubbles first; it promotes them to normal user bubbles only when `mid_turn_user_prompt` or `queued_user_prompt_started` arrives.
- If main returns `queued: true` after the renderer optimistically rendered a normal user bubble, `BottomBar` converts that last user bubble back into a queued bubble.
- Added a dashed warning-tone `QueuedUserBubble` that distinguishes `Interrupt queued` from `After-turn queued`.
- Queue snapshots now include `queueMode` for Space-owned interrupt/after-turn prompt entries, and `QueueIndicator` shows that mode.
- Deferred queue-watch projection is cancelled on unsubscribe, so the owner-stamped interrupt preview cannot leak after a watcher has been torn down.
- Wired `KodaXEvents.onMidTurnUserMessages` in `RealKodaXSession` to emit `mid_turn_user_prompt` for each consumed interrupt prompt.
- Updated `composeMessages()` so a later `mid_turn_user_prompt` splits the current user-turn segment without rendering a duplicate user bubble.
- Updated `ActivitySpinner` so `mid_turn_user_prompt` resets live status boundaries; immediately after the prompt is consumed it shows a fresh thinking state instead of inheriting previous text output.
- Updated `ActivitySpinner` so `queued_user_prompt_started` is treated as a live run boundary until the next `session_start` arrives.

Files changed:

- `packages/space-ipc-schema/src/channels/session.ts`
- `packages/space-ipc-schema/src/channels/queue.ts`
- `apps/desktop/electron/ipc/queue.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/kodax/session-queue-guard.ts`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/features/session/composeMessages.ts`
- `apps/desktop/renderer/src/features/session/messages/bubbles.tsx`
- `apps/desktop/renderer/src/shell/ActivitySpinner.tsx`
- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `apps/desktop/renderer/src/shell/ConversationStreamV2.tsx`
- `apps/desktop/renderer/src/shell/QueueIndicator.tsx`
- `apps/desktop/electron/test/composeMessages.test.ts`
- `apps/desktop/electron/test/activitySpinner.test.ts`
- `apps/desktop/electron/test/queue.test.ts`
- `apps/desktop/electron/test/app-store-cancel-event.test.ts`
- `apps/desktop/electron/test/session-event-schema.test.ts`
- `packages/space-ipc-schema/test/session.test.ts`

Tests added/updated:

- `mid_turn_user_prompt splits SDK-consumed interrupt prompt within the same run`
- `pending queued user messages render as queued_user, not normal user bubbles`
- `queued_user_prompt_started splits a queued follow-up turn at its effective point`
- `mid_turn_user_prompt promotes a pending interrupt queued message`
- `queued_user_prompt_started promotes a pending after-turn queued message`
- `convertLastUserMessageToQueued replaces a normal optimistic bubble after queued ack`
- `queued_user_prompt_started keeps spinner alive before the next session_start arrives`
- `queue IPC preview clamps large prompts while preserving raw prompt`
- `session.event accepts SDK mid-turn user prompt boundaries`
- `session.event accepts queued user prompt started boundaries`
- `session.event payload: mid_turn_user_prompt variant`
- `session.event payload: queued_user_prompt_started variant`

Verification:

- `npm test` from `apps/desktop` passed: 879/879.
- `node --test --import tsx/esm test/session.test.ts` from `packages/space-ipc-schema` passed: 49/49.
- `npm run typecheck` passed.

### 013: Restored KodaX sessions could pair assistant segments with the following user prompt after consecutive user messages

- Priority: High
- Status: Resolved
- Introduced: v0.1.29
- Fixed: v0.1.29
- Created: 2026-07-08
- Resolution Date: 2026-07-08

#### Original Problem

Current behavior:

- Opening a session created by KodaX CLI in KodaX Space could show a user's query below the answer that actually responded to it.
- The reproduced session `20260707_220442` had consecutive real user messages at 2026-07-07 14:27:00 before the next assistant response.
- After those consecutive user messages, later restored turns were shifted by one segment. For example, the `repoIntelligenceMode` query could appear after the assistant/tool content that belonged to it.

Expected behavior:

- Space should preserve KodaX's persisted display order when replaying historical sessions.
- Consecutive user prompts with no intervening assistant output should not consume the next assistant event segment.
- The shared assistant response should remain attached to the later effective prompt instead of shifting every subsequent turn.

#### Context

Affected components:

- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/features/session/composeMessages.ts`
- `apps/desktop/electron/test/history-replay-no-popout.test.ts`

Observed evidence:

- The KodaX JSONL `meta.uiHistory` / `meta_update.uiHistory` for `20260707_220442` was already in the correct visible order.
- SDK `loadFullTranscript()` also preserved the real prompt order. Its `transcriptEntries` are the structured host-facing scrollback, but still expose append-order transcript entries that may include consecutive user prompts and tool-result user entries; Space must project those entries into UI turns without assuming one visible user always consumes one assistant segment.
- Space rebuilt display turns from `transcriptEntries` and used one event segment per visible user message. A visible user with no assistant segment was not represented, producing an off-by-one shift.

#### Root Cause

Space's history replay assumed each restored user message consumes an assistant/tool event segment. That is false for KodaX sessions where the user sends multiple prompts before the assistant responds. Because no empty segment was represented for the earlier prompt, `composeMessages()` consumed the following prompt's assistant events too early and every later turn was paired one slot ahead.

This was a Space replay bug. KodaX's persisted `uiHistory` was correct, and the transcript dedupe logic was not the direct cause.

#### Resolution

Implemented an explicit restored-history marker for user prompts that have no assistant segment:

- `prependSessionHistory()` now tracks restored users that are followed by another user before any assistant/tool/notice event.
- Such users are stored with `historyNoAssistantSegment: true` instead of emitting an extra terminal event that `findSegmentEnd()` could merge away.
- `composeMessages()` still renders the user bubble but skips consuming an event segment for that marked user.
- Historical user timestamps are normalized to remain monotonic in transcript order, preventing timestamp backtracking from causing the same pairing problem through sorting.

Tests added:

- `history replay preserves pairing after consecutive restored user prompts`
- `history replay preserves transcript pairing when restored user timestamps move backwards`

Verification:

- `node --test --import tsx/esm apps/desktop/electron/test/transcript-dedup.test.ts apps/desktop/electron/test/composeMessages.test.ts apps/desktop/electron/test/history-replay-no-popout.test.ts` passed: 52/52.
- `npm run build -w @kodax-space/desktop` passed. Vite reported existing large-chunk and dynamic-import warnings.

### 014: Session rename reverted after switching sessions because manual titles were not persisted outside memory

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.29
- Fixed: v0.1.29
- Created: 2026-07-08
- Resolution Date: 2026-07-08

#### Original Problem

Current behavior:

- Renaming a session in the sidebar appeared to save at first.
- After clicking another session or refreshing the session list, the renamed row could revert to its previous title.
- The failure was most visible for historical/persisted sessions that were listed from SDK storage but were not loaded into the in-memory host map.

Expected behavior:

- Manual session renames should remain visible after switching sessions, refreshing the list, resuming the session, and restarting the app.
- Renaming a persisted-only session should succeed instead of silently returning to the SDK summary title.

#### Context

Affected components:

- `apps/desktop/electron/kodax/host.ts`
- `apps/desktop/electron/kodax/session-store.ts`
- `apps/desktop/electron/kodax/session-title-store.ts`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/test/host.test.ts`
- `apps/desktop/electron/test/_helpers/session-store-mock.ts`

#### Root Cause

`session.setTitle` only updated `ManagedSession.title` in the main-process in-memory map. Persisted-only sessions were not in that map, so the handler returned `ok: false`; the renderer refreshed from `session.list`, which read the unchanged SDK summary title. Even for in-flight sessions, the manual title was not stored anywhere durable outside memory, so a later persisted-list fallback could show the old title again.

#### Resolution

Implemented a Space-owned per-session title override store:

- Added `SessionTitleStore`, stored under Space data as `session-title-overrides`.
- `kodaxHost.setTitle()` is now async, sanitizes the title, updates in-flight sessions when present, and writes a durable title override for both in-flight and persisted-only sessions.
- `listPersistedSessions()` overlays Space title overrides on top of SDK session summaries.
- `tryResume()` hydrates the in-flight session title from the Space override before falling back to the SDK title.
- Session delete clears the title override only when SDK deletion succeeds.
- Test mocks now install an in-memory title override store so unit tests do not touch real user data.

Tests added/updated:

- `setTitle: persists rename for a persisted-only session`
- `setTitle: in-flight rename survives fallback to persisted list`
- `delete clears a persisted title override`

Verification:

- `node --test --import tsx/esm electron/test/host.test.ts electron/test/session-fork-rewind.test.ts electron/test/host-try-resume.test.ts` from `apps/desktop` passed: 54/54.
- `node --test --import tsx/esm test/session.test.ts test/project.test.ts` from `packages/space-ipc-schema` passed: 66/66.

### 015: Partner capability redesign drift allowed overly broad workspace delivery writes and stale output registry state

- Priority: High
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-09
- Resolution Date: 2026-07-09

#### Original Problem

Current behavior:

- Partner delivery remained too rigid for real working-agent output, while direct project-workspace writes were also too broad by default.
- Admin policy defaults enabled workspace delivery writes and registry-only delivery registration unless explicitly overridden.
- Rollback restored file contents but did not synchronize the delivery registry, so Outputs could show stale hashes or ghost entries.
- Checkpoint creation could persist metadata after a target mutation failed.
- Some write paths checked only the final parent path; recursive directory creation could still traverse an ancestor symlink before the later guard ran.
- Partner delivery and checkpoint list IPC calls were scoped by session alone instead of requiring a validated project root.
- Outputs lacked safe copy/reveal actions for arbitrary output files, and 0.1.30 docs overclaimed unsupported arbitrary-file behavior.

Expected behavior:

- Partner can produce arbitrary useful deliverables and, when useful, create and run bounded helper code for itself.
- Heavy coding work remains a Coder workflow concern, but Partner is not blocked from lightweight tool-making.
- Direct project-workspace writes are default-closed and require explicit local policy opt-in.
- Normal Partner writes stay in run-output; checkpointed workspace writes and rollback stay policy-bound and registry-consistent.
- Project-scoped IPC, symlink guards, and safe UI actions preserve the local-first safety model.

#### Context

Affected components:

- `packages/space-ipc-schema/src/channels/admin.ts`
- `packages/space-ipc-schema/src/channels/partner-delivery.ts`
- `packages/space-ipc-schema/src/channels/partner-checkpoint.ts`
- `apps/desktop/electron/kodax/admin-policy-audit-store.ts`
- `apps/desktop/electron/kodax/partner-helper-runner-tool.ts`
- `apps/desktop/electron/kodax/partner-delivery-store.ts`
- `apps/desktop/electron/kodax/partner-checkpoint-store.ts`
- `apps/desktop/electron/kodax/partner-workspace-file-tool.ts`
- `apps/desktop/electron/ipc/partner-deliveries.ts`
- `apps/desktop/electron/ipc/partner-checkpoints.ts`
- `apps/desktop/electron/kodax/partner-profile.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/renderer/src/features/partner/DeliveriesPanel.tsx`
- `apps/desktop/renderer/src/features/partner/partnerWorkbench.ts`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `docs/features/v0.1.30.md`
- `docs/ADR/ADR-007-partner-surface-model.md`
- `docs/FEATURE_LIST.md`

#### Root Cause

The Partner redesign mixed two concerns that must be handled separately: delivery expressiveness and mutation authority. The previous implementation addressed arbitrary deliverables incompletely while making direct workspace delivery writes default-open. Rollback, registry, IPC, symlink, UI, and documentation behavior then drifted from the intended bounded working-agent model.

#### Resolution

- Changed workspace delivery direct write/register policy defaults to `false`; project-workspace writes now require explicit local policy opt-in.
- Added `run_partner_helper`, a bounded Partner-only JavaScript helper runner. Helpers run from Partner run-output files, with no shell, package manager, `require`, `import`, `process`, `env`, or subagents. The file API is capped and restricted to run-output.
- Registered the helper runner in real Partner sessions and updated Partner prompt/workbench wording to describe lightweight helper use without implying unrestricted coding-agent authority.
- Changed rollback paths to refresh or remove delivery registry entries after rollback, so Outputs matches actual file state.
- Reordered checkpoint persistence so failed file mutations do not leave durable checkpoint records.
- Added ancestor symlink checks before recursive directory creation in delivery, checkpoint, and helper-output paths.
- Required `projectRoot` for Partner delivery and checkpoint list IPC calls and validated it through the project allowlist before listing.
- Added safe Outputs actions for copy absolute path and reveal in file manager without opening or executing files.
- Updated 0.1.30 docs, ADR, and feature list to remove overclaims and document the bounded helper model.

Files changed:

- `packages/space-ipc-schema/src/channels/admin.ts`
- `packages/space-ipc-schema/src/channels/partner-delivery.ts`
- `packages/space-ipc-schema/src/channels/partner-checkpoint.ts`
- `apps/desktop/electron/kodax/admin-policy-audit-store.ts`
- `apps/desktop/electron/kodax/partner-helper-runner-tool.ts`
- `apps/desktop/electron/kodax/partner-delivery-store.ts`
- `apps/desktop/electron/kodax/partner-checkpoint-store.ts`
- `apps/desktop/electron/kodax/partner-workspace-file-tool.ts`
- `apps/desktop/electron/ipc/partner-deliveries.ts`
- `apps/desktop/electron/ipc/partner-checkpoints.ts`
- `apps/desktop/electron/kodax/partner-profile.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/renderer/src/features/partner/DeliveriesPanel.tsx`
- `apps/desktop/renderer/src/features/partner/partnerWorkbench.ts`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `packages/space-ipc-schema/test/admin.test.ts`
- `packages/space-ipc-schema/test/partner-delivery.test.ts`
- `packages/space-ipc-schema/test/partner-checkpoint.test.ts`
- `apps/desktop/electron/test/admin-policy-audit-store.test.ts`
- `apps/desktop/electron/test/partner-helper-runner-tool.test.ts`
- `apps/desktop/electron/test/partner-delivery-store.test.ts`
- `apps/desktop/electron/test/partner-checkpoint-store.test.ts`
- `apps/desktop/electron/test/partner-workspace-file-tool.test.ts`
- `apps/desktop/electron/test/partner-workbench.test.ts`
- `apps/desktop/electron/test/partner-profile.test.ts`
- `tests/e2e/partner-mode.spec.ts`
- `docs/features/v0.1.30.md`
- `docs/ADR/ADR-007-partner-surface-model.md`
- `docs/FEATURE_LIST.md`
- `docs/KNOWN_ISSUES.md`

Tests added/updated:

- Partner helper runner validates Partner-only execution, bounded file access, blocked runtime escapes, delivery registration, and policy denial.
- Partner workspace file tests validate default-closed workspace direct writes, rollback delivery refresh, and rollback delivery removal.
- Partner delivery/checkpoint store tests validate ancestor symlink rejection before recursive directory creation.
- Partner delivery/checkpoint schema tests require project roots for list calls.
- Partner E2E validates arbitrary delivery visibility, workspace rollback, post-rollback registry refresh, and safe copy/reveal actions.

Verification:

- `node --test --import tsx/esm apps/desktop/electron/test/partner-delivery-store.test.ts apps/desktop/electron/test/partner-checkpoint-store.test.ts apps/desktop/electron/test/partner-helper-runner-tool.test.ts apps/desktop/electron/test/partner-workspace-file-tool.test.ts` passed: 18/18.
- `npm run typecheck` passed.
- `npm test` passed across workspaces: desktop 1224/1224 and space-ipc-schema 232/232.
- `npm run build:smoke` passed. Vite reported existing large-chunk and Monaco dynamic/static import warnings.
- `npx playwright test tests/e2e/partner-mode.spec.ts tests/e2e/partner-layout.spec.ts` passed: 6/6.

### 016: Partner helper VM exposed host constructors and allowed escape to Node process and unrestricted filesystem

- Priority: High
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-10
- Resolution Date: 2026-07-10

#### Original Problem

Current behavior:

- `run_partner_helper` injected host-realm constructors and callbacks into a Node `vm` context.
- A helper could evaluate `Date.constructor('return process')()` and obtain the Electron main process.
- From `process.getBuiltinModule('node:fs')`, the helper could read or write outside the Partner run-output root.
- Blocking direct `require` and setting `codeGeneration.strings=false` did not close cross-realm host-object escape paths.

Expected behavior:

- Helper code can use JSON input, bounded file operations, logging, ordinary JavaScript, microtasks, and result values.
- It cannot access host constructors, `process`, environment variables, Node built-ins, dynamic imports, shell, network, or arbitrary filesystem paths.
- Timeout, size, write-count, delivery-registration, and partial-output behavior remain intact.

#### Context

Affected components:

- `apps/desktop/electron/kodax/partner-helper-runner-tool.ts`
- `apps/desktop/electron/test/partner-helper-runner-tool.test.ts`

#### Root Cause

Node context code received host-realm values. Disabling string code generation applies to the context's own `Function`, but does not make a host constructor or callback safe when its prototype chain exposes the host `Function` constructor.

#### Resolution

- Moved each helper invocation into a one-shot `worker_threads` isolate so infinite Promise-microtask chains, synchronous loops, ordinary JS heap growth, and worker crashes cannot starve the Electron main thread indefinitely.
- Removed all host constructors, callbacks, input objects, and file-return values from the helper context.
- Builds a bounded, symlink-checked run-output snapshot and serializes it into the VM.
- Creates input, file APIs, encoder/decoder, console/logging, operation journal, and result bridge entirely inside the VM realm.
- The VM returns one validated serialized payload; the host independently validates path policy, content size, Base64, symlinks, and allowed extensions before applying writes and registering deliveries.
- Applies V8 heap/stack resource limits, a parent wall-clock deadline followed by awaited `worker.terminate()`, and explicit caps for input/config/snapshot/result/log/payload/journal operations and aggregate writes.
- Applies the fully validated write journal with conflict-safe exclusive installation so a raced target alias is not followed or overwritten.
- Expanded escape regressions across Date, file callbacks, input prototypes, log/console, encoder, global/object prototypes, lexical `this`, dynamic import, and the original process/filesystem PoC.
- Expanded credential path, canonical Base64, prototype-poisoning, output-amplification, alias-race, and infinite-microtask coverage while preserving legitimate pure helpers, Promise/microtask writes, timeout, and partial deliveries.

Files changed:

- `apps/desktop/electron/kodax/partner-helper-runner-tool.ts`
- `apps/desktop/electron/test/partner-helper-runner-tool.test.ts`

Tests added/updated:

- Original `Date.constructor` process/filesystem escape is rejected through the real handler.
- Ten constructor/prototype variants report blocked rather than escaped.
- Dynamic Node import, credential paths, malformed Base64, timeout, infinite microtasks, partial-output, resource caps, alias races, and legitimate helper behavior are covered.

### 017: Partner corrupted Unicode PDF output and could not read PDF or Office sources

- Priority: High
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-10
- Resolution Date: 2026-07-10

#### Original Problem

Current behavior:

- The PDF writer replaced every non-ASCII character with `?`, making Chinese output unusable.
- Partner Sources treated PDF, DOCX, XLSX, and PPTX as opaque binary files even though those are primary working-agent inputs.
- Tests checked only file signatures and ZIP entries, not extracted Unicode content or hostile archive behavior.
- Office outputs had no source/citation content and only the most minimal baseline layout.

Expected behavior:

- Unicode text round-trips through generated PDFs and unsupported glyph coverage fails clearly instead of silently corrupting output.
- Partner can extract useful bounded content from common PDF/Office sources.
- Office ZIP parsing resists archive bombs, encrypted entries, duplicate/dangerous paths, and oversized expansion.
- Generated Office files retain sources/citations and provide a consistent baseline structure without claiming template-grade publishing quality.

#### Root Cause

The PDF implementation used the built-in ASCII Helvetica path and deliberately replaced unsupported characters. The source tool stopped at generic binary detection and had no format-specific bounded parsers.

#### Resolution

- PDF now finds an embeddable TrueType face, subsets needed glyphs, and emits Type0/CIDFontType2, Identity-H, CIDToGIDMap, and ToUnicode data.
- A font must cover every requested code point; otherwise generation fails with an actionable font error.
- CI Linux jobs install `fonts-wqy-zenhei`; Windows/macOS search common system fonts and `KODAX_PDF_FONT_PATH` remains an explicit override.
- Partner Source extraction now supports PDF text, DOCX body, XLSX sheets/formulas, and PPTX slide/notes order with file/result caps.
- Office ZIP inspection bounds entries, per-entry/total expansion, compression ratio, encryption, duplicate names, and traversal before extraction.
- DOCX uses real bullet numbering, XLSX adds widths/autofilters, PPTX adds baseline hierarchy/accent styling, and sources/citations are embedded in outputs.

Files changed:

- `.github/workflows/build.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `apps/desktop/electron/artifact/office-writers.ts`
- `apps/desktop/electron/artifact/office-artifact-tool.ts`
- `apps/desktop/electron/kodax/partner-source-tool.ts`
- `apps/desktop/electron/test/office-artifact-tool.test.ts`
- `apps/desktop/electron/test/partner-source-tool.test.ts`

Tests added/updated:

- `pdfjs-dist` extracts the original Chinese text and no repeated `?` replacement.
- Unsupported glyphs fail rather than producing a visually corrupt PDF.
- PDF/DOCX/XLSX/PPTX source extraction, citations, structure, and highly compressed ZIP rejection are covered.

### 018: Active queue watcher deleted Partner follow-up overlay before dequeue returned it

- Priority: High
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-10
- Resolution Date: 2026-07-10

#### Original Problem

Current behavior:

- The production queue watcher subscribes to synchronous SDK dequeue events.
- Its listener deleted `sdkPromptOverlays` before `dequeueNextUserPromptForSession()` read the overlay.
- Interrupt follow-ups therefore lost Partner route/workbench context even though the no-watcher unit test passed.

Expected behavior:

- Interrupt and after-turn prompts preserve their Partner overlay through consumption.
- External SDK drains, queue reset/drain, watcher unsubscribe, and SDK queue replacement still clean metadata without leaks or ID reuse.

#### Root Cause

Prompt metadata cleanup was coupled to the UI watcher and happened synchronously inside the queue mutation, before the consumer read its metadata.

#### Resolution

- Captures selected prompt metadata before mutating the SDK queue.
- Separates permanent SDK metadata cleanup from the UI watcher lifecycle.
- Keeps cleanup idempotent across normal dequeue, external SDK drains, drain/reset, queue singleton replacement, unsubscribe, and reused message IDs.

Files changed:

- `apps/desktop/electron/ipc/queue.ts`
- `apps/desktop/electron/test/queue.test.ts`

Tests added/updated:

- Active watcher + interrupt overlay preservation.
- Unsubscribe, external dequeue, reset/drain, after-turn, UI event, and ID-reuse behavior.

### 019: Partner KB could not search Chinese and could overwrite corrupt durable state

- Priority: High
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-10
- Resolution Date: 2026-07-10

#### Original Problem

Current behavior:

- Search tokenization retained only ASCII letters/numbers, so pure Chinese queries returned no tokens and no results.
- The feature was described as hybrid search although it was weighted lexical matching.
- Malformed JSON or schema-invalid KB files loaded as an empty KB; a later mutation could overwrite the original durable state.

Expected behavior:

- Chinese, mixed Chinese/English, punctuation-normalized, and short-term queries find explainable lexical matches.
- Search terminology matches the implemented backend.
- Only a genuinely absent file starts empty; corrupt state is preserved and all reads/mutations fail closed.

#### Resolution

- Added NFKC/lowercase normalization, Unicode word runs, CJK phrase tokens, overlapping CJK bigrams, and word-boundary handling for short Latin terms.
- Preserved existing field weights, reasons, source IDs, ignore config, and bounded token counts.
- KB JSON/schema failures now throw without populating an empty cache or writing over the source file.
- Documentation now calls the implementation Unicode-aware weighted lexical search, not semantic/vector hybrid search.

Files changed:

- `apps/desktop/electron/kodax/partner-kb-store.ts`
- `apps/desktop/electron/test/partner-kb-store.test.ts`
- `docs/features/v0.1.30.md`
- `docs/FEATURE_LIST.md`

Tests added/updated:

- Chinese phrase, long CJK run, punctuation, mixed-language, and one-character Latin search.
- Malformed JSON and invalid schema preserve exact original bytes and reject mutation.

### 020: Partner file paths, writes, decoding, hashing, and durable stores had unsafe edge cases

- Priority: High
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-10
- Resolution Date: 2026-07-10

#### Original Problem

Current behavior:

- Checkpoint and proposal paths checked a base hash, then replaced the file later without a conditional commit; a concurrent user edit in that window could be overwritten.
- Secret protection covered only a handful of names and missed `.env.*`, cloud credentials, package credentials, state files, and private-key containers.
- Node's permissive Base64 decoder silently ignored invalid characters and decoded before a strong encoded-size bound.
- Delivery registration read an entire arbitrary file into memory to hash it and had no generic registration size cap.
- Delivery, checkpoint, proposal, source, and admin policy/audit JSON stores could start empty after corruption and later overwrite recoverable durable state.

Expected behavior:

- File installation is conditional on the exact version reviewed/snapshotted, including rollback.
- Sensitive paths stay blocked even when direct workspace writes are explicitly enabled.
- Binary inputs are canonical and size-bounded before decoding.
- Registration hashes are streamed from a stable file handle and bounded.
- Corrupt durable state fails closed and remains byte-for-byte intact.

#### Resolution

- Added a conditional file commit primitive: atomically displace the exact current target, verify its hash, exclusively install the replacement, and restore/preserve conflicting versions rather than overwrite them.
- Applied it to checkpoint create/update/rollback and proposal apply, with deterministic pre-commit race hooks for regression tests.
- Expanded sensitive path policy for environment files, SSH/cloud/package credentials, Docker/GnuPG/Kubernetes/Terraform paths, private-key/certificate stores, and credential filenames.
- Added canonical RFC 4648 Base64 validation with pre-decode encoded-size bounds.
- Delivery registration rejects files over 50 MB and streams SHA-256 from a file handle while checking size/mtime stability and realpath containment.
- Delivery, checkpoint, proposal, source, KB, and admin policy/audit stores now create empty state only on `ENOENT`, persist before updating caches, and refuse to overwrite malformed state.
- Added repository-wide LF policy through `.gitattributes` to remove platform-dependent release diffs.

Files changed:

- `.gitattributes`
- `apps/desktop/electron/kodax/atomic-file.ts`
- `apps/desktop/electron/kodax/partner-file-guards.ts`
- `apps/desktop/electron/kodax/partner-checkpoint-store.ts`
- `apps/desktop/electron/kodax/partner-file-proposal-store.ts`
- `apps/desktop/electron/kodax/partner-delivery-store.ts`
- `apps/desktop/electron/kodax/partner-delivery-tool.ts`
- `apps/desktop/electron/kodax/partner-workspace-file-tool.ts`
- `apps/desktop/electron/kodax/partner-source-store.ts`
- `apps/desktop/electron/kodax/admin-policy-audit-store.ts`
- Direct store/tool regression tests.

Tests added/updated:

- Deterministic concurrent user edits immediately before checkpoint/proposal commit.
- Expanded credential paths, malformed/non-canonical Base64, oversized sparse registration, and corrupt JSON preservation.
- Existing create/update/rollback, valid binary, symlink, policy, and delivery behavior remains covered.

### 021: Partner advertised unavailable SDK Skills and Outputs lacked an in-app delivery preview loop

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-10
- Resolution Date: 2026-07-10

#### Original Problem

Current behavior:

- Partner injected the SDK Skills prompt even though Partner's fail-closed tool policy blocks the SDK `skill` executor and subagent/MCP categories.
- Workbench prompt playbooks and executable SDK Skills were described with the same terminology.
- Deliveries exposed metadata/copy/reveal but did not use the existing bounded preview channel, so users had to leave Space to inspect normal outputs.
- Documentation implied WorkBuddy modes, scheduler behavior, hybrid semantic search, professional Office quality, external systems, and broader governance beyond implemented enforcement.

Expected behavior:

- The model is never instructed to call an unavailable Partner tool.
- Prompt playbooks are distinguished from executable Skills.
- Known delivery formats preview through the same bounded readers already used by artifacts/workspace files.
- v0.1.30 documentation states its actual local workspace-agent boundary and explicitly lists parity gaps.

#### Resolution

- Added surface-aware Skills prompt construction; Partner gets no SDK Skills addendum while Coder behavior remains unchanged.
- Delivery-backed rich preview now supports text, PDF, Office, image, audio, and video through `partner.deliveries.readBinary` and per-kind size caps.
- E2E covers delivery preview after checkpoint rollback/registry refresh.
- Product/docs now use scenario/capability-playbook terminology and explicitly exclude executable Partner Skills, connectors/MCP actions, browser/computer use, scheduled/remote tasks, parallel experts, hosted governance, and template-grade Office design from v0.1.30.
- Package/workspace versions are aligned to 0.1.30.

Files changed:

- `apps/desktop/electron/kodax/skills-prompt.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/renderer/src/features/preview/RichPreview.tsx`
- `apps/desktop/renderer/src/features/partner/DeliveriesPanel.tsx`
- `apps/desktop/renderer/src/features/partner/partnerWorkbench.ts`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `tests/e2e/partner-mode.spec.ts`
- `docs/features/v0.1.30.md`
- `docs/ADR/ADR-007-partner-surface-model.md`
- `docs/FEATURE_LIST.md`
- Version manifests and lockfile.

Tests added/updated:

- Partner Skills prompt suppression with unchanged Coder discovery.
- Delivery rich-preview E2E assertion.

### 022: KodaX Runtime lacks a general per-invocation execution service for Partner helper migration

- Priority: Medium
- Status: Open
- Introduced: KodaX 0.7.66 adoption
- Fixed: N/A
- Created: 2026-07-10
- Resolution Date: N/A

#### Original Problem

Current behavior:

- Space v0.1.30 resolves KodaX 0.7.67 and safely runs `run_partner_helper` in a Space-owned one-shot Worker, then applies the resulting bounded journal under Space path/policy controls. The relevant Runtime/constructed-handler isolation primitives were introduced in 0.7.66 and remain available in 0.7.67.
- KodaX 0.7.66 now provides a real `embedded + worker` Runtime with resource limits, hard close, and fail-closed `requirements.hardDispose`. Constructed handlers also run in dedicated Workers with reverse tool RPC and hard timeout termination. Space has compatibility coverage for the published Runtime Worker and packages all required sidecars.
- `KodaXRuntime` still has no general per-invocation `execution` service for arbitrary helper programs. Daemon/Worker run options are JSON-safe DTOs, so Space cannot send its process-local helper callback or VM bridge across that boundary. Moving the entire Runtime into a Worker is not equivalent to isolating and terminating one helper invocation inside a shared session owner.

Expected behavior:

- Embedded and daemon modes expose the same ID/DTO-based optional isolated-execution contract.
- Runtime/daemon host owns executor lifecycle, cancellation, hard termination, resource bounds, packaging, and run/session/tool-call attribution.
- Space continues to own Partner-specific workspace snapshots, path/credential policy, approvals, and final journal application.
- Worker isolation is described as fault/resource isolation; genuinely hostile third-party code uses a process/OS sandbox backend.

#### Root Cause

The Runtime refactor now centralizes session/run orchestration and provides whole-Runtime Worker isolation. KodaX also has specialized Worker machinery for semantic processing and constructed handlers. What remains missing is a public, protocol-neutral, per-invocation execution plane that can host an arbitrary bounded helper by ID/DTO without moving the entire Runtime owner or serializing host callbacks.

#### Proposed Solution

Add a runtime-owned `ExecutionManager` with serialized `create/start/await/abort/terminate` operations, executor/invocation IDs, `worker` and future `process` backends, capability RPC through runtime-scoped policy/permission brokers, hard deadlines, V8/resource/input/output limits, and awaited shutdown. The daemon protocol must advertise supported isolation modes and fail closed when a requested backend or sidecar is unavailable.

Migration order:

1. Keep the 0.7.67 Runtime/constructed-handler Worker capability and package-sidecar gates green in Space.
2. Publish a Runtime execution DTO/protocol with executor/invocation IDs, capability negotiation, and Worker/process backend semantics.
3. Prove invocation-local timeout, abort escalation, crash recovery, resource/output bounds, and daemon responsiveness without terminating unrelated sessions.
4. Migrate Space's helper onto that SDK service while retaining Space policy/journal application, then delete the duplicate Space Worker lifecycle.

#### Acceptance Criteria

- A normal Partner helper behaves identically in embedded and daemon modes without serializing functions or host objects.
- Infinite CPU/microtask loops, worker crash, timeout, cancellation, heap/input/output limit, and daemon disconnect tests terminate only the invocation and leave Runtime/daemon responsive.
- Invocation abort escalates from cooperative abort to hard termination after a bounded grace period without requiring `runtime.close()` to kill the whole private Runtime.
- Runtime capabilities report isolation support and never silently downgrade `worker`/`process` requests to host execution.
- The Worker/process security boundary and remaining OS-level limitations are documented.

#### Resolution

Partially addressed upstream in KodaX 0.7.66: whole-Runtime Worker isolation, hard-dispose negotiation, resource limits, constructed-handler Worker execution, reverse tool RPC, hard timeout termination, and sidecar packaging are implemented and verified. The general per-invocation execution service is not implemented yet. This does not reopen Issue 016 or weaken the current Space helper path; its concrete host escape and main-thread starvation paths are fixed. The remaining issue is an explicit migration and duplicate-lifecycle cleanup gate before Space adopts daemon-owned execution for Partner helpers.

### 023: Composer file picker opened the project-directory dialog and could not select images or files

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-11
- Resolution Date: 2026-07-11

#### Original Problem

The composer action labeled "Add files or photos" invoked `project.openDialog`, whose native dialog only permits directory selection. It could not select images, documents, or other local files, and any returned path was appended as raw prompt text instead of entering the existing attachment pipeline. The adjacent "Add folder" action reused the same project-opening flow and switched the current workspace instead of attaching the selected directory.

#### Resolution

- Added a multi-select file input with no extension/MIME allowlist, so all local file types remain selectable.
- Routed picker files through the same bounded processing used by drag-drop.
- Made "Add folder" create a directory reference without changing the current project.
- PNG/JPEG/WebP become sandboxed input artifacts with previews; SVG/GIF, documents, archives, and unknown formats remain file references.
- Added MIME normalization and safe extension fallback only for missing/generic MIME metadata.
- Added unit coverage and an Electron E2E covering menu wiring, PNG preview, SVG/PDF/unknown references, multi-select, and the absence of an `accept` filter.

### 024: ACP placeholder sessions consumed the 200-row Space history window and hid real project sessions

- Priority: High
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-11
- Resolution Date: 2026-07-11

#### Original Problem

KodaX 0.7.66 persists ACP protocol sessions with `scope: user`, `runtimeInfo.surface: acp`, the title `ACP Session`, and no messages. Space requested only the newest 200 user sessions and classified every non-Partner tag as Coder, so the SDK applied its limit before Space could distinguish surfaces. The sidebar and dashboard consequently showed 200 empty ACP rows while hundreds of real Coder/Partner/REPL JSONL records remained intact after the cutoff.

The records initially appeared to be a reconnect burst. Runtime-event correlation and the KodaX source established a more specific upstream cause: `tests/acp_server.test.ts` constructs `KodaXAcpServer` without an isolated `FileSessionStorage` in most harness calls, so tests fall back to the real user store. Each full ACP test run produces a 30-record batch. The fixture evidence includes `tool-bash-write`, `echo test > README.md`, and provider `openai`; 270 strict-empty ACP records were present at diagnosis time.

The sibling `_unknown` directory is unrelated data loss: KodaX 0.7.46's per-project storage migration places legacy sessions there when their metadata has no usable workspace/gitRoot. Those files remain valid historical records and must not be removed.

#### Resolution

- Consume SDK cursor pages when available, stopping after Space has enough visible rows; retain a bounded 50,000-summary compatibility read for KodaX 0.7.66 and cursor-invalidated races.
- Exclude only `runtimeInfo.surface === "acp"` plus existing ephemeral tags; preserve untagged legacy, REPL, Coder, and Partner sessions.
- Apply the requested 200-row default after ACP and Coder/Partner surface filtering, then warn if the scan ceiling is exhausted before enough visible sessions are found.
- Keep the 200-row recent list for startup, but let the explicit project session picker request and search a bounded 50,000-row project history on demand.
- Do not rewrite, move, archive, or delete any existing session JSONL or `_unknown` entry.
- Add regression coverage with 540 leading ACP summaries followed by 205 real sessions, plus explicit post-filter limit coverage across the SDK cursor boundary.

### 025: KodaX ACP tests persist fixture sessions into the real user session/runtime directories

- Priority: High
- Status: Resolved
- Introduced: KodaX 0.7.66
- Fixed: KodaX 0.7.67 / Space v0.1.30
- Created: 2026-07-11
- Resolution Date: 2026-07-12

#### Original Problem

`tests/acp_server.test.ts::createHarness()` makes its `storage` option optional and normally constructs `KodaXAcpServer` without one. The server therefore creates its default `FileSessionStorage` under the real `~/.kodax` home. `src/acp_server.ts::newSession()` persists `title: "ACP Session"` and `surface: "acp"` before the first prompt, while `dispose()` does not remove provisional sessions with no messages, lineage, or artifacts. The test suite consequently leaves both session metadata and runtime fixture events in the user's real data directory.

#### Required Upstream Resolution

- Give every ACP test an isolated temporary KodaX home, session storage, and runtime directory, with teardown cleanup.
- Fail tests immediately if a test storage path resolves under the real user KodaX home.
- Persist ACP sessions only after the first valid prompt, or remove strictly empty provisional sessions when their connection closes.
- Add `surface` filtering and cursor pagination to `listSessions` so embedders do not need a large pre-filter scan.
- Provide a dry-run-first cleanup command for the exact polluted signature. Space must not guess-delete another client's session files.

#### Resolution

- Published KodaX v0.7.67 delays ACP persistence until the first valid prompt, isolates both ACP test harnesses under temporary runtime homes, and adds preview-first ACP cleanup.
- The session, Runtime, and daemon APIs now carry exact `surface` filters and opaque continuation cursors; 129 targeted KodaX tests covering these paths pass locally.
- Space keeps tag-based Coder/Partner classification because its historical sessions store `code` / `partner` in `SessionSummary.tag`, while ordinary Space runner snapshots do not currently populate `runtimeInfo.surface`. Directly replacing tag filtering with the new exact surface filter would hide legacy and current Space sessions.
- Space now resolves the published 0.7.67 tarball, keeps its isolated Electron test home, and passes the complete 58-test Electron E2E suite against that package.

### 026: Space E2E test mode isolated app data but left the SDK session home pointed at the real user directory

- Priority: High
- Status: Resolved
- Introduced: Before v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-11
- Resolution Date: 2026-07-11

#### Original Problem

`KODAX_TEST_ONBOARDING` redirected Space stores and Electron `userData`, but `applySdkHomeEnv()` only handled `KODAX_PROFILE_DIR`. The KodaX SDK therefore retained its default real `~/.kodax` home during Electron E2E. Existing mock-heavy tests normally did not persist SDK sessions, which concealed the split until the ACP history regression gained a real-storage E2E.

#### Resolution

- Force `KODAX_HOME` to the deterministic temporary test root before the SDK is imported whenever `KODAX_TEST_ONBOARDING` is active.
- Let the test-isolation setting override an inherited user `KODAX_HOME`; an explicit test must never touch user data.
- Add a real SDK round-trip unit test and an Electron E2E that writes 205 Coder plus 540 ACP fixture sessions only under the temporary test root.

### 027: A global 200-session window let one busy project make other project histories appear empty

- Priority: High
- Status: Resolved
- Introduced: Before v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-11
- Resolution Date: 2026-07-11

#### Original Problem

The multi-project sidebar called `session.list` once without `projectRoot`, accepted the newest 200 sessions globally, and only then grouped them by project in the renderer. A project with more than 200 recent sessions could consume the whole response. Other projects consequently rendered “no sessions” even though project-scoped SDK queries still returned intact history; the affected local KodaX-Space project had 26 valid sessions at diagnosis time.

The same ordering risk existed between Coder and Partner: the persisted limit was applied before the requested surface filter, so one surface could consume another surface's project window.

#### Resolution

- Query every known project independently and merge each result into the renderer store with `{ projectRoot, surface }` scope.
- Refresh that same scoped recent window when a collapsed project is explicitly expanded, so project-list hydration cannot leave an expanded project stale or empty.
- Preserve a separate 200-session recent window for every project and Coder/Partner surface.
- Apply surface filtering before the limit in the persistence adapter.
- When a project-scoped SDK summary omits workspace/git-root metadata, retain the validated project filter as its renderer project root instead of grouping it under `/`.
- Keep the 50,000-row full-history request isolated to the explicit project picker instead of startup.
- Cover a 205-session project, 540 ACP fixtures, and a second three-session project in an isolated real-SDK Electron E2E.

### 028: External Agent event pagination could skip audit events after the first 512 entries

- Priority: High
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-12
- Resolution Date: 2026-07-12

#### Original Problem

The gateway bounded a task-event response to 512 entries but calculated `nextCursor` from the unbounded SDK result. A consumer following that cursor could skip every event after the first returned page. Task Dock also requested only cursor zero, so a long task could present an incomplete audit trail.

#### Resolution

- Calculate `nextCursor` only from events actually returned to the caller.
- Page Task Dock event reads with a bounded eight-page loop and monotonic-cursor guard.
- Add a 520-update event-storm regression proving page two begins immediately after page one.

### 029: Renderer could supply a new opaque Agent identity to the Reference update path

- Priority: High
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-12
- Resolution Date: 2026-07-12

#### Original Problem

The Reference upsert IPC accepted any schema-valid `agentId`. New IDs are supposed to be generated and owned by the main-process catalog, but a tampered renderer could submit an invented ID through the edit path. Settings also retained a successful preflight badge across configuration updates.

#### Resolution

- Require edits to reference an existing main-store registration owned by the Reference executor; new registrations always receive a host-generated opaque ID.
- Clear cached preflight presentation whenever the live catalog refreshes.
- Filter Task Dock task-list requests by current `parentTaskId` in main instead of returning all task objectives to the renderer and filtering there.

### 030: Workflow external-target wrapper lost method receiver and did not always audit the resolved revision

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-12
- Resolution Date: 2026-07-12

#### Original Problem

The default-target proxy invoked `spawnAgent`/`runAgent` as detached functions, which could break an SDK implementation that relies on `this`. When an API caller omitted `expectedConfigurationRevision`, preflight resolved a concrete revision but host audit metadata did not record it.

#### Resolution

- Invoke wrapped methods with the original Workflow API receiver.
- Snapshot the descriptor revision returned by successful preflight and use it for dispatch plus host audit metadata.
- Extend unit coverage to verify target precedence and receiver identity.

### 031: Packaged smoke still expected KodaX 0.7.66 after the 0.7.67 integration

- Priority: High
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-12
- Resolution Date: 2026-07-12

#### Original Problem

The ordinary production build passed, but `scripts/smoke-pack.mjs` still rejected any packaged Runtime identity other than `0.7.66`. The final 0.1.30 installer using the published 0.7.67 package would therefore fail its packaging gate despite having the correct application version.

#### Resolution

- Read Space version and the exact KodaX dependency from root package metadata.
- Use those values in the packaged Worker probe, expected identity check, and diagnostics so future version bumps do not require another hard-coded edit.

### 032: External Agent task IPC trusted renderer ownership and Task Dock could show/control stale cross-session tasks

- Priority: High
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-12
- Resolution Date: 2026-07-12

#### Original Problem

Task start accepted renderer-supplied project and parent attribution, while event/input/cancel/reconcile calls authorized only by a global task ID. The shared preload also made the external-agent administration catalog available to auxiliary windows. Separately, Task Dock used an overlapping fixed interval and accepted a late response from the previously selected session, so stale task data and controls could briefly replace the active session's cards.

#### Resolution

- Require a live `sessionId` for every task operation; main derives the project root/parent correlation from `kodaxHost` and verifies the stored task parent before reads or lifecycle interventions.
- Restrict external-agent registration, preflight, catalog, and task IPC to the primary application renderer.
- Clear all session-scoped Task Dock state immediately on session changes and reject late list/event/action responses whose captured session is no longer active.
- Replace the fixed interval with one non-overlapping polling loop; poll active foreground tasks at 1.5 seconds, terminal views at 5 seconds, and background views at 10 seconds.
- Add schema and gateway regressions for mandatory session scope and wrong-parent rejection.

### 033: Project Session spinner remained visible over already-restored rows after switching surfaces

- Priority: Low
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-12
- Resolution Date: 2026-07-12

#### Original Problem

After switching from Coder to Partner and back, some projects immediately restored their cached Coder Session rows but kept the project-header loading spinner until the background `session.list` refresh completed. Several refreshes often completed close together, making unrelated project spinners appear to stop as one group instead of reflecting each project's visible data readiness.

Expected behavior: a project-header loading spinner should communicate that the project has no Session data yet. Once that project's Session rows are visible, the spinner should stop even if a non-blocking background refresh remains in flight.

#### Root Cause

The project-header spinner was driven only by the request phase (`loading`). It did not distinguish first hydration with no rows from a background refresh while scoped Session rows were already available in the renderer store.

#### Resolution

- Derive one `isInitialSessionLoad` state from both the request phase and the scoped project's visible Session count.
- Show the project-header spinner and skeleton rows only while `loading && projectSessions.length === 0`.
- Keep restored rows stable and visually idle during background refreshes.

Files changed:

- `apps/desktop/renderer/src/shell/LeftSidebar.tsx`

Tests:

- TypeScript typecheck.
- Renderer ESLint and production build.

### 034: Task Dock width presets drifted from responsive default, explicit half, and full-workspace behavior

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-12
- Resolution Date: 2026-07-12

#### Original Problem

The three Task Dock width buttons are designed as responsive layout presets. Screenshots at restored and maximized window sizes showed three distinct failures: maximum mode left the center workspace as a thin visible strip instead of filling the available area; explicit half mode could make the Task Dock disappear in a restored window; and the default one-third ratio looked too heavy on a 2048px-wide workspace. The earlier implementation also treated `320px` as an absolute target before the first correction rather than a lower comfort bound.

#### Root Cause

The width calculation alone could not produce a true max layout because the center pane and right resize handle remained flex children, leaving their gaps and a collapsed center strip visible. The final `center >= 520px` visibility gate also treated an explicit half-width choice like an automatic layout and removed the Task Dock when the restored window was narrower. Finally, the default one-third ratio scaled too aggressively on high-resolution windows without an upper comfort bound.

#### Resolution

- Compute default width as 30% of the remaining paired workspace, bounded to a `320–520px` comfort range and never wider than half mode.
- Keep explicit half mode as a `1:1` center/Task Dock split. On a small window, evaluate the selected half width itself and hide the left sidebar first instead of removing the Task Dock.
- Make the still-visible left-sidebar toggle recoverable: when showing the left sidebar would make half/custom mode violate the `520px` center minimum, downgrade the Task Dock to default width; if even default cannot fit, close the Task Dock so the left sidebar can open.
- In max mode, preserve the mounted center workspace state but remove the center pane and right resize handle from flex layout, then size the Task Dock across the truly remaining area.
- Add Electron E2E geometry coverage for restored-width half mode, left-sidebar recovery, and default/max layouts at 1180, 1440, 1600, and 2048px viewports.

Files changed:

- `apps/desktop/renderer/src/shell/Shell.tsx`
- `tests/e2e/sidebar-resize.spec.ts`

Tests:

- Targeted sidebar preset Electron E2E.
- TypeScript typecheck, ESLint, and renderer production build.

## Summary

- Total: 34
- Open: 1
- Resolved: 33
- High: 23
- Medium: 9
- Low: 2
- Next to resolve: 022
