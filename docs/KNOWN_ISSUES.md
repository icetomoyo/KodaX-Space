# Known Issues

Last Updated: 2026-07-22

> Historical issue details are preserved as investigation evidence. The current package/source baseline is v0.1.32 release preparation. Start from the [documentation hub](README.md) for current behavior and status.

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
| 035 | Medium   | Resolved | Project Session refresh rescanned the full history tree and made empty Coder/Partner scopes slow                            | v0.1.30               | 2026-07-12 |
| 036 | Medium   | Resolved | New Sessions ignored the provider/model most recently selected in the active Session                                        | v0.1.31               | 2026-07-13 |
| 037 | Medium   | Resolved | Partner output links lost their Delivery identity and were incorrectly resolved as project files                            | v0.1.31               | 2026-07-14 |
| 038 | Medium   | Resolved | File-backed Markdown opened in Artifact as raw Monaco source instead of a document reading preview                          | v0.1.31               | 2026-07-14 |
| 039 | Medium   | Resolved | Partner kept a duplicate collapsed-sidebar edge rail alongside the shared header toggle                                     | v0.1.31               | 2026-07-14 |
| 040 | Low      | Resolved | Adjacent command and thinking receipt chips render at different heights                                                     | v0.1.31               | 2026-07-14 |
| 041 | Medium   | Resolved | Every assistant text block in a user turn reuses the Query timestamp instead of its own output time                         | v0.1.31               | 2026-07-14 |
| 042 | High     | Resolved | Interactive HTML Artifact can show only its static shell and keep stale content after a new version                         | v0.1.31               | 2026-07-14 |
| 043 | High     | Open     | Unsigned macOS releases repeatedly request the login password for Provider Keychain access                                  | v0.1.4                | 2026-07-14 |
| 044 | Low      | Resolved | Windows portable executable icon can render as missing or inconsistently across shell sizes                                 | v0.1.31               | 2026-07-15 |
| 045 | Low      | Resolved | New-conversation mode selectors append a confusing `next` suffix                                                            | v0.1.x                | 2026-07-15 |
| 046 | High     | Resolved | F121 live projection and daemon lease lifecycles could diverge across attached Space clients                                | v0.1.32 development   | 2026-07-15 |
| 047 | Low      | Resolved | Long user queries consume excessive transcript height without an inline collapse control                                    | v0.1.x                | 2026-07-16 |
| 048 | Low      | Resolved | Legacy `tsx/esm` test registration corrupts CommonJS JSON imports from the KodaX SDK dependency graph                       | v0.1.x                | 2026-07-17 |
| 049 | Medium   | Resolved | Provider/model and mode changes rolled back before the first send because the daemon Session was not admitted               | v0.1.32 development   | 2026-07-17 |
| 050 | Medium   | Resolved | Reference Agent continuation can remain `working` after `sendInput` until an explicit reconcile                             | KodaX 0.7.72          | 2026-07-17 |
| 051 | Low      | Resolved | Embedded Runtime omits the working `externalAgentAdmin` service from its public capability metadata                         | KodaX 0.7.72          | 2026-07-17 |
| 052 | Medium   | Resolved | Composer could send text before an asynchronously attached image entered the artifact payload                               | v0.1.9                | 2026-07-17 |
| 053 | Medium   | Resolved | Restored daemon runs rejected queued prompts because the composer requested unsupported interrupt delivery                  | v0.1.32 development   | 2026-07-17 |
| 054 | High     | Resolved | Daemon permission dialogs discarded command, directory, and operation context                                               | v0.1.31               | 2026-07-17 |
| 055 | High     | Resolved | Ark multimodal follow-ups rejected supported model routes during artifact preflight                                         | <= v0.1.31            | 2026-07-17 |
| 056 | High     | Resolved | Restored daemon Sessions lost Auto mode, exposed an unwired plan exit, and reset AskUser choices                            | v0.1.32 development   | 2026-07-17 |
| 057 | High     | Resolved | Auto LLM sent an empty classifier model after daemon observation erased the provider default                                | v0.1.32 development   | 2026-07-19 |
| 058 | High     | Resolved | Auto LLM diagnosis exposed a stale 8-second process while Space did not seed daemon classifier defaults                     | v0.1.32 development   | 2026-07-19 |
| 059 | Medium   | Resolved | KodaX Runtime does not publish complete effective Auto LLM settings or timeout-phase telemetry                              | KodaX 0.7.72          | 2026-07-19 |
| 060 | High     | Resolved | Space restart during daemon run admission aborted the accepted Coder run and startup health failures did not reconnect      | v0.1.32 development   | 2026-07-20 |
| 061 | High     | Resolved | No-Session File Viewer calls `artifact.previewFile` without legacy-required Session fields and cannot open project files    | v0.1.32 development   | 2026-07-20 |
| 062 | Medium   | Resolved | Composer sent renderer `file://` attachment links to the model instead of exact native filesystem paths                     | v0.1.30               | 2026-07-20 |
| 063 | Medium   | Resolved | Pasted image normalization could send JPEG bytes with a stale PNG media type and make mixed image attachments fail          | v0.1.32-hotfix.0      | 2026-07-20 |
| 064 | Medium   | Resolved | Space ignored Runtime-issued concrete permission grants, so Always allow was absent or rejected                             | KodaX 0.7.73 adoption | 2026-07-20 |
| 065 | Medium   | Resolved | Project Files sidebar hides file extensions and keeps a stale directory tree                                                | v0.1.32               | 2026-07-21 |
| 066 | Medium   | Resolved | Changes panel displayed non-ASCII Git paths as octal escapes and could not open their diffs                                 | v0.1.4                | 2026-07-21 |
| 067 | Medium   | Resolved | Partner project-file rows select an attachment target but do not open the file viewer                                       | v0.1.32               | 2026-07-21 |
| 068 | High     | Resolved | Project HTML preview loses relative assets and hides sandbox/runtime failures that work in a browser                        | v0.1.32               | 2026-07-21 |
| 069 | High     | Resolved | Coder daemon converted interrupt follow-ups into separate sequential after-turn runs                                        | v0.1.32 development   | 2026-07-21 |
| 070 | High     | Resolved | Large or dependency-backed HTML Artifacts can be misclassified as static and render blank or incomplete                     | v0.1.32               | 2026-07-21 |
| 071 | High     | Resolved | Daemon compaction telemetry is dropped, so `/compact` appears frozen and context usage grows past a stale threshold         | v0.1.32 development   | 2026-07-21 |
| 072 | High     | Resolved | E2E cleanup hangs until timeout because the isolated shared daemon keeps Electron test pipes open                           | v0.1.32 development   | 2026-07-21 |
| 073 | Medium   | Resolved | Artifact HTML E2E scenarios focus Session-owned Artifacts before creating a Session                                         | v0.1.32 development   | 2026-07-21 |
| 074 | High     | Resolved | Artifact bootstrap CSP blocks Blob workers that the in-document preview policy explicitly allows                            | v0.1.32 development   | 2026-07-21 |
| 084 | High     | Resolved | Daemon child-agent prose, thinking, and tools are merged into the parent transcript and live snapshot                       | v0.1.32 development   | 2026-07-22 |

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

### 035: Project Session refresh rescanned the full history tree and made empty Coder/Partner scopes slow

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.30
- Created: 2026-07-12
- Resolution Date: 2026-07-12

#### Original Problem

Switching between Coder and Partner, or collapsing and reopening a project, triggered a fresh `session.list` request. Projects with no Session on the selected surface still showed a prolonged loading state, and repeated switches felt disproportionately slow. The loading indicator itself was acceptable; the problem was that every refresh repeated expensive disk work even when the scoped result was empty.

Expected behavior: project Session refreshes may retain their loading feedback and freshness semantics, but repeated Coder/Partner and expand/collapse refreshes should complete quickly. An empty scoped result must be cacheable without hiding later Session additions.

#### Root Cause

- The sidebar requested each recent project independently on every surface change. KodaX 0.7.67's `projectRoot` list path scans the entire persisted Session JSONL tree before applying the project filter, so several visible projects caused several complete scans.
- Space paged mixed Coder/Partner summaries and filtered surface ownership afterward. A project with many Coder Sessions and no Partner Session could repeatedly rescan the same files while paging to prove the Partner result was empty.
- Every persisted row resolved identical global runtime defaults again and read the same per-session runtime sidecar twice: once inside `resolveRuntimeDefaults()` and once for historical provider/model identity.
- Empty lists and completed summary reads had no short-lived, invalidation-aware cache.

Local reproduction data contained 1,183 Session JSONL files (about 291 MB). Direct SDK measurements took about 1.1–1.3 seconds per project-scoped scan; the global summary-index path took about 0.5–0.7 seconds once and produced the same Session IDs for the sampled KodaX and KodaX-Space projects.

#### Resolution

- Use one bounded global summary-index snapshot for the sidebar's 200-row project windows, then restore project and Coder/Partner scoping in Space. Fall back to the precise project scan if the 50,000-row global bound is saturated before a project receives its requested window.
- Share the global snapshot across project requests, coalesce identical in-flight requests, and cache scoped results—including empty arrays—for 30 seconds.
- Invalidate both global and scoped list caches on SDK Session add/change/remove events and Space-owned mutations such as rename, fork, rewind, delete, retag, append, and compact.
- Push the exact `partner` tag into the SDK on the large-history fallback path so an empty Partner scope does not page through Coder history. Keep Coder compatibility filtering in Space because untagged legacy Sessions belong to Coder.
- Resolve global runtime defaults once per IPC response and read each persisted Session runtime sidecar only once.

Files changed:

- `apps/desktop/electron/kodax/session-store.ts`
- `apps/desktop/electron/kodax/host.ts`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/test/_helpers/session-store-mock.ts`
- `apps/desktop/electron/test/session-surface.test.ts`

Tests:

- Session surface/list regressions cover one-snapshot multi-project loading, cached empty scopes, watcher invalidation, cursor fallback, and per-surface limits.
- Targeted Session runtime/store tests.
- Electron main build, desktop TypeScript typecheck, targeted ESLint, and `git diff --check`.
- Read-only real-data comparison verified zero missing/extra Session IDs for sampled KodaX and KodaX-Space project results.

### 036: New Sessions ignored the provider/model most recently selected in the active Session

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.31
- Fixed: v0.1.31
- Created: 2026-07-13
- Resolution Date: 2026-07-13

#### Original Problem

After selecting a provider/model in an active Session, creating a new Session could still start with `zhipu-coding/glm-5.2` instead of the pair that had just been selected.

Expected behavior: a successful provider/model selection should become the preference used by subsequent new Sessions, including another Session created before the desktop app restarts. Selecting the model that is already active should still refresh that next-Session preference.

#### Root Cause

- `ModelEffortSelector` persisted `provider.setDefault` in the main process but did not update the renderer store's `defaultProviderId`. `resolveSessionCreateInputs()` therefore kept using the stale in-memory provider until `provider.list` ran again or the app restarted.
- The selected model was copied to `pendingModel` only inside the branch that executed `/model`. Selecting the already-active model skipped that branch, so the next-Session preference could remain stale.
- When the stale provider and pending model did not belong together, the intentional provider/model validation fell back to that provider's default model. With `zhipu-coding` still held in memory, this appeared as a consistent reset to `zhipu-coding/glm-5.2`.

#### Proposed Solution

- Add a renderer-store action that synchronizes `defaultProviderId` and provider `isDefault` flags after `provider.setDefault` succeeds.
- Persist the selected model as the next-Session preference after a successful picker commit even when no runtime `/model` change is required.
- Add regression coverage for renderer default-provider synchronization and new-Session input resolution.

#### Acceptance Criteria

- A successful picker change from `zhipu-coding/glm-5.2` to another provider/model immediately changes the next `session.create` provider/model in the same app process.
- Re-selecting the active model refreshes the next-Session model preference without requiring a redundant runtime command.
- Failed provider/model changes do not overwrite the corresponding next-Session preference.

#### Resolution

- Added `setDefaultProviderId()` to the renderer store so a successful `provider.setDefault` call immediately updates both `defaultProviderId` and the provider catalog's `isDefault` flags.
- Updated the model picker to apply that store synchronization after main-process persistence succeeds.
- Moved the next-Session model preference update outside the runtime-change branch, so selecting the already-active model is still remembered without issuing a redundant `/model` command.

Files changed:

- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/shell/ModelEffortSelector.tsx`
- `apps/desktop/electron/test/app-store-default-provider.test.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- Renderer default-provider state and provider `isDefault` flags synchronize immediately.
- The synchronized provider/model pair is selected by `resolveSessionCreateInputs()` for the next Session.

Verification:

- Desktop test suite passed: 1,419 passed, 0 failed, 1 platform-dependent symlink test skipped.
- Root TypeScript typecheck passed.
- Targeted ESLint and Prettier checks passed.

### 037: Partner output links lost their Delivery identity and were incorrectly resolved as project files

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.31
- Fixed: v0.1.31
- Created: 2026-07-14
- Resolution Date: 2026-07-14

#### Original Problem

Partner can successfully create a file with `write_partner_deliverable`, but an assistant reply that exposes the output as a path such as `partner-output/report.md` can still show “file not found” when clicked. The output exists in the session-scoped Partner run directory and is registered with a stable Delivery ID; it is not a project-root file.

Expected behavior:

- Newly generated outputs expose and open through a typed, stable Delivery reference rather than an ambiguous filesystem-looking string.
- Existing conversations that contain only a legacy path remain openable when the path uniquely identifies an output in the current Partner Session.
- A missing, stale, cross-project, cross-session, or ambiguous reference fails explicitly without opening an unrelated file.
- The Partner Outputs browser and Artifact preview surface use the same resolved Delivery record.

#### Root Cause

- `write_partner_deliverable` returned a textual Delivery ID and paths, but the conversation UI had no structured Partner-output result card or generated-resource link protocol.
- Inline Markdown paths were routed through the generic project-file opener, so `partner-output/...` was first interpreted relative to the project root even though the file lived under the isolated Partner run root.
- The renderer performed path matching after listing registry records and selected the first match. Resolution was not centralized in the main process and did not explicitly represent missing or ambiguous registry state.

#### Proposed Solution

- Introduce a typed Partner Delivery URI backed by the stable Delivery ID and render successful delivery tool calls as clickable output cards.
- Add a scoped main-process Delivery-reference resolver for ID and legacy path references, including registry refresh and explicit `found`, `not-found`, `missing`, and `ambiguous` outcomes.
- Route the reserved `partner-output/` logical namespace to Delivery resolution before project-file resolution, while retaining project-first behavior for ordinary untyped paths.
- Keep old path-only conversation compatibility, but stop guessing when multiple Sessions match the same path.
- Add unit and Electron E2E regressions for typed links, legacy links, missing files, ambiguous paths, and project-path shadowing.

#### Resolution

- Added a typed `kodax-space://partner-delivery/<delivery-id>` resource protocol and kept it inside Markdown's URL safety transform without allowing arbitrary custom schemes.
- Delivery-producing tools now return a canonical machine-readable Delivery reference plus an exact Markdown link. Successful `write_partner_deliverable`, `write_partner_workspace_file`, and `run_partner_helper` results render as clickable output cards in the conversation.
- Added the scoped `partner.deliveries.resolve` IPC path. Main now resolves by stable ID or legacy path within the active project and optional Session, validates the target before opening, and returns explicit `found`, `not-found`, `missing`, or `ambiguous` outcomes.
- Missing on-disk targets are removed from the persistent registry and emit a deletion refresh. Cross-project/cross-session IDs are rejected; unscoped duplicate legacy paths fail as ambiguous instead of selecting the newest record.
- Reserved `partner-output/` references now resolve through Delivery before any project-file lookup, preventing a same-named project file from shadowing a generated output. Ordinary paths retain project-first behavior and only use Delivery as a compatibility fallback.
- Historical tool results and path-only assistant messages remain supported. The Partner workbench prompt now requires the exact returned output link instead of presenting run-output paths as project files.

Files changed:

- `packages/space-ipc-schema/src/channels/partner-delivery.ts`
- `packages/space-ipc-schema/src/channels/index.ts`
- `packages/space-ipc-schema/src/index.ts`
- `apps/desktop/electron/ipc/partner-deliveries.ts`
- `apps/desktop/electron/kodax/partner-delivery-store.ts`
- `apps/desktop/electron/kodax/partner-delivery-reference.ts`
- `apps/desktop/electron/kodax/partner-delivery-tool.ts`
- `apps/desktop/electron/kodax/partner-workspace-file-tool.ts`
- `apps/desktop/electron/kodax/partner-helper-runner-tool.ts`
- `apps/desktop/renderer/src/lib/generatedResourceRef.ts`
- `apps/desktop/renderer/src/lib/openPath.ts`
- `apps/desktop/renderer/src/lib/pathClassify.ts`
- `apps/desktop/renderer/src/features/session/messages/Markdown.tsx`
- `apps/desktop/renderer/src/features/session/messages/toolRenderers.tsx`
- `apps/desktop/renderer/src/features/session/messages/bubbles.tsx`
- `apps/desktop/renderer/src/features/partner/partnerWorkbench.ts`
- `apps/desktop/renderer/src/i18n/messages.ts`

Tests added or extended:

- Typed Delivery URI formatting/parsing and Markdown preservation.
- Canonical and historical single/multi-output tool-result parsing.
- Project/Session-scoped ID and path resolution.
- Ambiguous cross-Session legacy paths.
- Missing-file detection and registry pruning.
- Stable reference output from all three Partner Delivery producers.
- Workbench final-response link contract.

Verification:

- Desktop test suite: 1,464 passed, 0 failed, 2 platform-conditional skips.
- Targeted Delivery/reference suite: 52 passed, 0 failed.
- Root TypeScript typecheck, targeted ESLint, Prettier, and `git diff --check` passed.
- Production renderer/main smoke build passed.
- Partner sidebar/files and Outputs/rollback/Artifact Electron E2E: 2 passed, 0 failed.

### 038: File-backed Markdown opened in Artifact as raw Monaco source instead of a document reading preview

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.31
- Fixed: v0.1.31
- Created: 2026-07-14
- Resolution Date: 2026-07-14

#### Original Problem

Markdown stored inline as an Artifact uses the rendered Markdown document view, but a `.md` or `.markdown` file opened from a Partner Delivery or project-file preview is classified as a generic text file. `RichPreview` therefore sends it to `TextFileViewer` and Monaco, making the read-only Artifact panel look like an editor.

Expected behavior:

- Artifact is a reading/preview surface, so Markdown should render as a document regardless of whether its bytes come from the workspace, Artifact store, or Partner Delivery store.
- Headings, paragraphs, lists, tables, quotes, links, images, and code blocks should use the existing safe Markdown preview presentation.
- Non-Markdown text/code files must continue to use the current text viewer.
- Existing sandbox, CSP, size caps, loading, truncation, and error behavior must remain intact.

#### Root Cause

`ArtifactView` correctly routes inline `kind: markdown` content to `MarkdownArtifact`, but file-backed content is represented as `kind: file`. That branch detects `.md` as a generic `text` preview and `RichPreview` has no Markdown-specific presentation mode after loading the bytes.

#### Proposed Solution

- Add an explicit Markdown presentation mode to the file-backed preview pipeline based on the file extension.
- Decode the already-bounded UTF-8 bytes and reuse `MarkdownArtifact` rather than duplicating Markdown parsing or loading the file again.
- Keep raw Monaco rendering for all other text/code paths and add regression coverage for the presentation-mode classifier and rendered iframe output.

#### Resolution

- Added an explicit file-presentation classifier: `.md` and `.markdown` use document preview, while every other text and code extension remains in the read-only source viewer.
- Routed file bytes from workspace, Artifact store, and Partner Delivery store through the same classification after the existing bounded read, so all three sources now behave consistently without a second file load.
- Reused the existing sandboxed `MarkdownArtifact` renderer, preserving its CSP and URL restrictions instead of introducing a separate parser or less-restricted document surface.
- Refined the Markdown renderer into a responsive reading canvas with a centered page, comfortable line length, editorial typography, document spacing, and light/dark presentation. Narrow sidebars fall back to an edge-to-edge page without card chrome.

Files changed:

- `apps/desktop/renderer/src/features/preview/previewPresentation.ts`
- `apps/desktop/renderer/src/features/preview/TextFileViewer.tsx`
- `apps/desktop/renderer/src/features/preview/RichPreview.tsx`
- `apps/desktop/renderer/src/features/artifact/renderers/MarkdownArtifact.tsx`
- `apps/desktop/electron/test/rich-preview-utils.test.ts`
- `tests/e2e/partner-mode.spec.ts`
- `docs/KNOWN_ISSUES.md`

Tests added or extended:

- `.md`, `.markdown`, case-insensitive paths, and whitespace-normalized paths select the Markdown document presentation.
- `.mdx`, source code, and plain-text files remain in the source presentation.
- A seeded Partner Markdown Delivery renders as Markdown both in Outputs detail and after “Open as Artifact”; a Partner `.txt` Delivery remains in `TextFileViewer`.

Verification:

- Rich-preview utility suite: 14 passed, 0 failed.
- Root TypeScript typecheck and targeted ESLint passed.
- Production renderer/main smoke build passed.
- Targeted Partner Delivery/Artifact Electron E2E passed.

### 039: Partner kept a duplicate collapsed-sidebar edge rail alongside the shared header toggle

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.31
- Fixed: v0.1.31
- Created: 2026-07-14
- Resolution Date: 2026-07-14

#### Original Problem

When Partner's right sidebar was closed, the workspace retained both the persistent header toggle and a 36px vertical edge rail containing a second expand button. The duplicate control reduced conversation width and made Partner's right-sidebar interaction inconsistent with Coder.

Expected behavior:

- Partner and Coder expose one persistent right-sidebar toggle in the workspace header.
- Closing the right sidebar returns its full width to the central workspace without leaving an empty edge rail.
- The shared sidebar's internal close control remains available while the sidebar is open, including at maximum width.

#### Root Cause

`PartnerWorkspace` independently rendered `partner-artifact-edge-toggle` whenever the shared sidebar was closed. That legacy recovery affordance became redundant after Partner gained the same always-visible header toggle used by Coder.

#### Proposed Solution

- Remove the Partner-only collapsed edge rail and its duplicate expand button.
- Keep the header toggle as the single open/close entry point and retain the shared `RightSidebarFrame` width and close controls.
- Update the Partner desktop regression to prove the rail is absent and the header toggle reopens the sidebar after either normal or maximum-width close.

#### Resolution

- Removed the Partner-only 36px collapsed edge rail and its duplicate expand button.
- Kept the workspace-header right-sidebar toggle as the single persistent open/close entry point, matching Coder and returning the reclaimed width to the conversation.
- Preserved the shared open-sidebar toolbar, including default/half/max width presets and its close action at maximum width.

Files changed:

- `apps/desktop/renderer/src/features/partner/PartnerWorkspace.tsx`
- `tests/e2e/partner-mode.spec.ts`
- `docs/KNOWN_ISSUES.md`

Verification:

- Targeted ESLint and production renderer build passed.
- Partner sidebar/chrome, normal composer/resume, and Delivery/Artifact Electron E2E: 3 passed, 0 failed.

### 040: Adjacent command and thinking receipt chips render at different heights

- Priority: Low
- Status: Resolved
- Introduced: v0.1.31
- Fixed: v0.1.31
- Created: 2026-07-14
- Resolution Date: 2026-07-14

#### Original Problem

When a collapsed command receipt and a collapsed thinking receipt appear on the same process-receipt row, the thinking chip is visibly taller than the command chip.

Expected behavior:

- Adjacent command and thinking receipts share the same outer height and vertical alignment.
- A command receipt remains the same height whether or not it contains an embedded thinking/status badge.
- Expanding either receipt must preserve the current top-anchored layout and responsive wrapping behavior.

Reproduction steps:

1. Run a Coder task that alternates tools and thinking so the compact process-receipt strip contains both receipt kinds.
2. Keep both receipts collapsed.
3. Compare the adjacent `运行了 N 个命令` and `思考（约 N token）` chips.

#### Context

Affected component:

- `apps/desktop/renderer/src/shell/ConversationStreamV2.tsx`

Existing regression surface:

- `tests/e2e/conversation-receipts-scroll.spec.ts`

#### Root Cause

`ThinkingBlock` and `ToolCluster` use similar outer button classes but have no shared height contract. The thinking button always contains a bordered token badge with `py-0.5`; a tool-cluster button without embedded thinking contains only plain text. Content therefore determines each button's outer height, producing an approximately one spacing-step mismatch even though both use `py-1`.

#### Proposed Solution

- Give both collapsed receipt buttons the same explicit minimum/fixed header height through one shared class or token.
- Keep badge padding and colors internal to that common header box instead of allowing them to determine its height.
- Extend the existing receipt-layout E2E to assert equal collapsed header heights, not only shared Y position and horizontal adjacency.

#### Acceptance Criteria

- The collapsed command and thinking buttons differ in rendered height by at most 1 CSS pixel at supported zoom/DPI settings.
- Command receipts with and without embedded thinking/status badges retain the same header height.
- Existing expansion, top anchoring, narrow wrapping, hit testing, and scroll-position assertions continue to pass.

#### Resolution

- Both collapsed receipt buttons now use the same explicit `h-8` outer-height contract while retaining their existing internal badge and expansion layouts.
- The receipt-layout Electron E2E now measures both rendered buttons and permits at most a 1 CSS pixel difference.
- The production build, targeted type checks, and the full receipt layout assertion sequence passed. On this Windows host, Playwright reached its existing Electron `Close context` hang only after all layout assertions had completed.

Files changed:

- `apps/desktop/renderer/src/shell/ConversationStreamV2.tsx`
- `tests/e2e/conversation-receipts-scroll.spec.ts`
- `docs/KNOWN_ISSUES.md`

### 041: Every assistant text block in a user turn reuses the Query timestamp instead of its own output time

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.31
- Fixed: v0.1.31
- Created: 2026-07-14
- Resolution Date: 2026-07-14

#### Original Problem

Every assistant text block generated for one user Query receives the same timestamp: the Query's send time. This includes separate text blocks before and after thinking/tool receipts. During a long-running Coder turn, a paragraph that has just appeared can therefore immediately display `4 分钟前` (or another duration close to the whole turn runtime), and all answer blocks for that Query show the same relative time.

Expected behavior:

- A newly created assistant text block displays `刚刚` when it first appears.
- Separate text blocks emitted before and after tool calls retain their own stable output timestamps.
- Restoring the Session preserves assistant timestamps instead of replacing them with the user prompt time or the history-load time.

Reproduction steps:

1. Start a task that runs for several minutes and alternates assistant text with tool calls.
2. Wait until a new assistant paragraph appears after a tool result.
3. Observe that its footer reports approximately the age of the original user prompt instead of the new paragraph.

#### Context

Affected components:

- `apps/desktop/renderer/src/features/session/composeMessages.ts`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/electron/ipc/session.ts`
- `packages/space-ipc-schema/src/channels/session.ts`
- `apps/desktop/renderer/src/features/session/messages/bubbles.tsx`

#### Root Cause

- `composeAssistantSegment()` assigns every new assistant text bubble `sentAt: parentSentAt`, where `parentSentAt` is the triggering user message's timestamp.
- Live `text_delta` and `thinking_delta` events do not carry or retain a renderer arrival timestamp, so a text block created after several minutes has no block-level time to use.
- The history schema already permits `assistant.sentAt`, but `session.history` currently creates assistant items without forwarding the transcript entry timestamp, and `prependSessionHistory()` converts assistant items back into untimed stream events.
- `formatRelativeTime()` is calculating the supplied value correctly; this is not a timezone or seconds-versus-milliseconds bug. The wrong timestamp is selected upstream.

#### Proposed Solution

- Add an optional timestamp to stream text/thinking events and stamp missing live events once when they enter the renderer store. Adjacent delta coalescing must preserve the first timestamp for that block.
- In `composeAssistantSegment()`, prefer the first text/thinking event timestamp and use the parent user timestamp only as a backward-compatible fallback.
- Forward each persisted assistant transcript entry's timestamp through `session.history` and preserve it when history items are converted into renderer events.
- Add regression coverage for a multi-minute turn containing text → tool → text and for history restore with distinct user/assistant timestamps.

#### Acceptance Criteria

- A text block first received at time T renders as `刚刚` at T even when its user turn began several minutes earlier.
- A later block after a tool boundary receives a distinct, stable timestamp.
- Coalescing adjacent stream deltas does not move a block timestamp forward on every chunk or backward to the user timestamp.
- History restore retains the persisted assistant timestamp when available and uses the user timestamp only for legacy history without one.

#### Resolution

- Text/thinking stream events can now carry `sentAt`; missing live timestamps are stamped once on renderer arrival, and delta coalescing retains the first timestamp for the block.
- Assistant bubble composition prefers the block timestamp and falls back to the parent Query time only for legacy data.
- Session history now forwards persisted assistant timestamps and restores them into stream events instead of replacing them with Query or load time.
- Targeted store/composition/history tests passed 64/64; the complete IPC-schema suite passed 253/253. Renderer/main type checks, targeted lint, and production builds also passed.

Files changed:

- `packages/space-ipc-schema/src/channels/session.ts`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/features/session/composeMessages.ts`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/test/app-store-cancel-event.test.ts`
- `apps/desktop/electron/test/composeMessages.test.ts`
- `apps/desktop/electron/test/history-replay-no-popout.test.ts`
- `docs/KNOWN_ISSUES.md`

### 042: Interactive HTML Artifact can show only its static shell and keep stale content after a new version

- Priority: High
- Status: Resolved
- Introduced: v0.1.31
- Fixed: v0.1.31
- Created: 2026-07-14
- Resolution Date: 2026-07-14

#### Original Problem

An HTML file renders correctly when opened directly in a browser, but its Artifact preview can show only the navigation/background shell while the main page is blank. Creating a second version intended to remove script-dependent reveal animations can leave the preview blank even though the version selector says `v2 (latest)`.

Expected behavior:

- HTML that contains scripts, canvas, inline handlers, or animation timers runs in the existing opaque-origin, restricted interactive sandbox.
- Script-driven visibility such as `IntersectionObserver` reveal effects works without granting the document Electron, Node, same-origin, unrestricted network, form, frame, or top-navigation access.
- When a new Artifact version becomes current, both the version selector and rendered payload update to the same version.
- Static HTML remains inert and script-disabled.

Reproduction steps:

1. Create or preview an HTML document whose primary content starts with `opacity: 0` and becomes visible from an inline `IntersectionObserver` script.
2. Open it in Artifact and observe that the fixed navigation/background render while the main content stays invisible.
3. Add a new version that makes the content visible without the reveal script.
4. Observe that the selector reports the new latest version while the iframe can continue displaying the previous payload.

#### Context

Affected components:

- `apps/desktop/renderer/src/features/artifact/renderers/HtmlArtifact.tsx`
- `apps/desktop/renderer/src/features/artifact/htmlSandbox.ts`
- `apps/desktop/renderer/src/features/artifact/useArtifacts.ts`
- `apps/desktop/renderer/src/features/artifact/ArtifactsView.tsx`
- `apps/desktop/electron/main.ts`

#### Root Cause

- Interactive HTML is loaded through `iframe.srcdoc`. In the packaged renderer, the parent response CSP permits only the app's own scripts; the embedded document does not get an independently navigated document boundary suitable for its explicitly restricted inline script policy, so script-driven reveal logic remains blocked while static markup and CSS still render.
- `useArtifactContent()` loads when `id` or the explicitly selected `version` changes, but it does not subscribe to `artifact.changed`. While following `version === undefined` (current/latest), `artifact.currentVersion` and the selector can advance without re-reading the payload, leaving v1 content under a v2 label.

#### Proposed Solution

- Navigate interactive HTML through a dedicated opaque-origin document URL whose own injected CSP governs the sandboxed document; keep `allow-scripts` but never add `allow-same-origin`.
- Restrict the parent `frame-src` change to the exact local URL scheme required by that document path, and preserve the existing in-document allowlists for scripts/passive assets/connect/forms/popups.
- Subscribe current-version content reads to `artifact.changed`, clear or refresh stale payloads safely, and ignore unrelated artifact changes.
- Add production Electron E2E coverage proving an inline script changes visible DOM inside the Artifact iframe and a current-version update refreshes the rendered payload.

#### Acceptance Criteria

- The supplied city-governance demo shows its hero and subsequent sections inside Artifact without modifying the document's reveal CSS.
- A sandboxed inline script executes, while the frame still has an opaque origin and cannot access Electron/Node/parent DOM.
- Advancing an Artifact from v1 to v2 updates both the selector and iframe content to v2 without manual version toggling or reopening.
- Static HTML continues to use the no-script renderer.

#### Resolution

- Interactive HTML now navigates to one exact local `app://space` bootstrap route, then receives its complete permission-scoped document through `postMessage`. The main renderer keeps its strict CSP; only that child response gets the bootstrap policy, and the injected Artifact document keeps its existing restrictive CSP.
- The iframe retains `allow-scripts` without `allow-same-origin`, so inline scripts, handlers, observers, animation timers, and canvas can run without Electron/Node or parent-DOM access. Static HTML still uses the inert `sandbox=""` renderer.
- A deterministic document token forces a fresh child navigation when payload or permissions change.
- Current-version content now subscribes to matching `artifact.changed` events, clears stale payloads before reads, ignores pinned/unrelated versions, and discards out-of-order read results.
- Protocol/sandbox tests passed 15/15 with one Windows symlink case skipped. The production Electron trace for the supplied v4 city-governance HTML (verified byte-for-byte by SHA-256 against stored Artifact version 4) passed `下一步`, `96.8%` state update, auto-play start, and auto-play stop assertions; only the known test-fixture `Close context` teardown subsequently timed out.

Files changed:

- `packages/space-ipc-schema/src/channels/artifact.ts`
- `packages/space-ipc-schema/src/index.ts`
- `apps/desktop/electron/window/app-protocol-policy.ts`
- `apps/desktop/electron/window/app-protocol.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/renderer/src/features/artifact/renderers/HtmlArtifact.tsx`
- `apps/desktop/renderer/src/features/artifact/useArtifacts.ts`
- `apps/desktop/electron/test/app-protocol-policy.test.ts`
- `apps/desktop/electron/test/html-sandbox.test.ts`
- `tests/e2e/artifact-html-runtime.spec.ts`
- `docs/KNOWN_ISSUES.md`

### 043: Unsigned macOS releases repeatedly request the login password for Provider Keychain access

- Priority: High
- Status: Open
- Introduced: v0.1.4
- Created: 2026-07-14

#### Original Problem

Customers using the current macOS release are repeatedly asked for their login Keychain password when KodaX Space needs a stored Provider API key. Choosing the system dialog's `Always Allow` action does not reliably stop later prompts, and a user with several stored Provider keys can be asked multiple times. Removing a stored key also asks for the login password.

Expected behavior:

- Normal Provider use is silent after the user has granted the installed app persistent Keychain access.
- `Always Allow` remains effective after a KodaX Space update from the same release channel.
- The number of configured Providers does not produce a burst of password dialogs during ordinary startup or settings refresh.
- Removing a Provider key completes without first asking to reveal that secret when the installed app is already trusted.

Reproduction steps:

1. Install an unsigned KodaX Space macOS DMG and save API keys for one or more Providers.
2. Restart or update KodaX Space, then use a Provider whose key must be loaded from Keychain.
3. Enter the macOS login Keychain password and choose `Always Allow`.
4. Repeat with another configured Provider or a later app build and observe additional password prompts.
5. Open Provider settings and remove a stored key; observe another Keychain authorization prompt.

#### Context

Affected components:

- `electron-builder.yml`
- `.github/workflows/release.yml`
- `apps/desktop/electron/providers/keychain.ts`
- `apps/desktop/electron/ipc/provider.ts`
- `apps/desktop/electron/test/provider-keychain.test.ts`

Existing mitigation:

- The main process caches successfully read secrets and coalesces concurrent reads.
- macOS startup loads only the default Provider key instead of enumerating and revealing every stored credential.
- Provider-list status checks use non-secret existence probes for known accounts.

Those measures reduce redundant reads within one process but cannot create a stable Keychain trust identity for an unsigned release.

#### Root Cause

There are three interacting causes:

1. `electron-builder.yml` explicitly builds macOS artifacts with `identity: null` and `hardenedRuntime: false`, and the release workflow describes those artifacts as unsigned. macOS therefore cannot use a stable Developer ID code requirement to recognize successive releases as the same trusted application. Keychain `Always Allow` decisions are not reliable across binaries whose application identity changes.
2. Space stores every Provider under a separate generic-password account in the `kodax-space` service. File-based macOS Keychain access control is attached to each item, so legacy or untrusted entries can each produce a separate authorization dialog.
3. `@napi-rs/keyring`'s macOS delete path locates the item through a generic-password read before deleting it. As a result, `provider.removeKey` can trigger the same secret-access authorization even though the user only asked to remove the key.

#### Proposed Solution

Treat stable macOS application identity as the release-blocking fix, with credential-layout changes as prompt-count and migration work:

1. Sign macOS stable artifacts with one persistent Developer ID Application identity and notarize them. Enable hardened runtime with the required Electron entitlements, inject credentials only through release secrets, and fail stable release staging when signature/notarization verification is absent.
2. Introduce one versioned macOS credential-vault entry (or one OS-protected master key with an encrypted on-disk Provider map) so Provider count no longer maps to Keychain authorization count. Keep secrets out of renderer, logs, diagnostics, settings JSON, and plaintext disk.
3. Migrate legacy per-Provider `kodax-space` entries only after a successful read, record migration durably, and defer cleanup so one denied legacy entry does not block unrelated Providers. Never weaken ACLs to allow every application and never shell out to `security -w` for secret reads.
4. Make logical Provider-key removal delete only the encrypted Provider record. Keychain access should be required only when the vault must be decrypted or rewritten, not to reveal the individual key solely to locate it.
5. Retain the current in-process cache/read coalescing and add typed diagnostics that distinguish legacy-entry migration, locked Keychain, denied access, unsigned build identity, and unavailable backend without exposing secrets.

#### Acceptance Criteria

- A signed/notarized macOS release upgraded to the next release signed by the same identity does not ask again for previously granted Keychain access.
- After migration, startup and Provider settings produce at most one vault authorization interaction regardless of the number of configured Providers, and no repeated prompt after `Always Allow`.
- Removing one stored Provider key does not perform a read of that legacy per-Provider secret and does not leave the Provider usable through a stale managed environment value.
- Denying or cancelling migration for one legacy key does not trigger a prompt loop or block Providers backed by environment variables or already-migrated credentials.
- Packaged macOS tests verify the Developer ID signature, hardened runtime, notarization result, migration behavior, prompt-count contract, deletion, and secret redaction; Windows and Linux key storage behavior remains unchanged.

#### Unsigned-Build Mitigation Implemented

The issue remains Open because an unsigned app update still has no stable macOS code identity, but the non-signing prompt amplification paths have been removed:

- macOS now stores each Provider as a separately encrypted record in `~/.kodax/space/provider-credentials.v1.json`, using Electron `safeStorage` and its single OS-protected application key. The file contains ciphertext and account metadata only; plaintext API keys remain main-process-only.
- Provider catalog and settings refreshes list encrypted record metadata without decrypting any key. Only the Provider that is actually about to run is decrypted, then cached for the process lifetime.
- Existing per-Provider `kodax-space` Keychain items migrate lazily on first real use. A cancelled or denied read is suppressed for the rest of that process so concurrent/repeated callers cannot immediately reopen the same password dialog.
- Removing a migrated/new Provider deletes its encrypted record without decrypting it. Legacy cleanup uses a no-secret-output delete command; a durable revocation tombstone prevents a legacy item from being re-imported if physical cleanup is unavailable.
- Vault writes are atomic, serialized, permission-restricted, size-bounded, and fail closed on corrupt state. Windows and Linux continue using their existing native keyring implementations.

Files changed:

- `apps/desktop/electron/providers/encrypted-credential-vault.ts`
- `apps/desktop/electron/providers/keychain.ts`
- `apps/desktop/electron/test/encrypted-credential-vault.test.ts`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- Ciphertext-only persistence and secret restoration.
- Metadata listing and deletion without decryption.
- Durable legacy revocation and replacement behavior.
- Serialized concurrent writes and safe-storage key rotation.
- Fail-closed handling for corrupt vault state.

Verification:

- Targeted encrypted-vault, Provider keychain, and Provider environment-injection suites: 22 passed, 0 failed.
- Electron main and renderer TypeScript checks passed with an explicit 4 GB Node heap after the default heap exhausted on the full main project.
- Targeted ESLint, Prettier, `git diff --check`, and the production Electron main build passed.
- A packaged macOS password-dialog count test still requires a macOS host and remains part of the Open issue's release acceptance criteria.

### 044: Windows portable executable icon can render as missing or inconsistently across shell sizes

- Priority: Low
- Status: Resolved
- Introduced: v0.1.31
- Fixed: v0.1.31
- Created: 2026-07-15
- Resolution Date: 2026-07-15

#### Original Problem

Current behavior:

- A user reported that the Windows portable build appeared without the KodaX Space application icon.
- The published v0.1.31 portable executable does contain the K icon, but the generated ICO contains only one 256x256 PNG-compressed image entry, leaving smaller Explorer/taskbar sizes dependent on shell scaling and cache behavior.

Expected behavior:

- The portable outer launcher and unpacked application executable show the KodaX Space icon consistently at common Windows shell sizes.
- Release verification fails if either Windows executable is produced without the configured icon resource.

Reproduction steps:

1. Download or build `KodaX-Space-Portable-0.1.31.exe`.
2. View the file in Windows Explorer or launch it and inspect its shell/taskbar icon.
3. On an affected Windows shell scale or stale icon-cache state, observe a missing or inconsistent icon.

#### Context

Affected components:

- `scripts/gen-icon.mjs`
- `electron-builder.yml`
- `scripts/smoke-pack.mjs`

#### Root Cause

The Windows build relied on electron-builder to convert the generated 1024px PNG into an ICO. The resulting release resource contained only a 256px entry. Although the current v0.1.31 artifact embeds that entry correctly, it did not provide explicit small-size images or a release gate proving that the outer portable NSIS launcher contains the configured icon.

#### Resolution

- Generate an explicit Windows ICO containing 16, 24, 32, 48, 64, 128, and 256px PNG entries without adding a native image dependency.
- Configure Windows packaging to use `resources/icon.ico` directly for both the unpacked app executable and the portable NSIS launcher.
- Extend package smoke verification to validate the ICO structure and assert that the generated Windows executables contain its 256px image resource.

Files changed:

- `scripts/gen-icon.mjs`
- `electron-builder.yml`
- `scripts/smoke-pack.mjs`
- `docs/KNOWN_ISSUES.md`

Tests added:

- Windows package smoke checks for required ICO sizes and embedded executable icon resources.

Verification:

- Regenerated the complete v0.1.31 Windows Setup and Portable artifacts successfully.
- Package smoke passed and confirmed both executables contain the configured application icon.
- The published v0.1.31 portable executable was independently downloaded and inspected; it contains the K icon, so affected users may still need a renamed file or Windows icon-cache refresh for that already-published binary.

### 045: New-conversation mode selectors append a confusing `next` suffix

- Priority: Low
- Status: Resolved
- Introduced: v0.1.x
- Fixed: v0.1.31
- Created: 2026-07-15
- Resolution Date: 2026-07-15

#### Original Problem

Current behavior:

- Before a session exists, the permission-mode chip displays labels such as `Auto · llm (next)` / `全自动 · llm（下次）`.
- The adjacent Agent-mode chip displays `AMA (next)`.
- Because these selections are used by the conversation created on the first send, `next` makes users question whether the visible choice applies immediately or only after another conversation.

Expected behavior:

- New-conversation chips display only the selected permission/engine and Agent mode names.
- Pending selection state and session creation behavior remain unchanged.

Reproduction steps:

1. Open a project without selecting or creating a session.
2. Inspect the permission-mode and Agent-mode chips below the composer.
3. Observe `(next)` / `（下次）` appended to their labels.

#### Context

Affected components:

- `apps/desktop/renderer/src/shell/ModeSelector.tsx`
- `apps/desktop/renderer/src/shell/AgentModeSelector.tsx`
- `tests/e2e/mode-toggle.spec.ts`

#### Root Cause

Both components intentionally distinguished pending new-session state by appending a presentation-only suffix. The pending values already describe the conversation that will be created on the user's first send, so the suffix added ambiguity without conveying a useful state difference.

#### Resolution

- Display the normal permission/engine label when no session exists.
- Display the normal Agent-mode label when no session exists (historically AMA/AMAW/SA; current releases expose AMA/SA).
- Keep pending-mode persistence, current-session updates, keyboard shortcuts, and session creation inputs unchanged.

Files changed:

- `apps/desktop/renderer/src/shell/ModeSelector.tsx`
- `apps/desktop/renderer/src/shell/AgentModeSelector.tsx`
- `tests/e2e/mode-toggle.spec.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- The mode-toggle E2E scenario now asserts that both targeted mode buttons omit `(next)` / `（下次）` before cycling permission modes.

Verification:

- Renderer TypeScript, targeted ESLint, Prettier, and the production renderer build passed.
- Playwright trace confirms both new suffix assertions and the existing three-step Shift+Tab mode-cycle assertions completed successfully. The command subsequently timed out only in the pre-existing Electron `Close context` cleanup path, after all product assertions had passed.

### 046: F121 live projection and daemon lease lifecycles could diverge across attached Space clients

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32 development
- Created: 2026-07-15
- Resolution Date: 2026-07-15

#### Original Problem

Review of the F121 shared-Coder daemon implementation found five related convergence and lifecycle failures:

- `run` projection changes carried durable after-turn `queuedInputs`, but the renderer discarded that field, so an already-attached Space client could retain an empty or stale queue until a full snapshot.
- Terminal and next-run events updated run status without clearing the previous run's assistant/thinking draft, active tools, managed task, or pending interaction projection. The next assistant delta could therefore append to the previous run's draft.
- AskUser and Permission reply routing checked only the asynchronously refreshed profile interaction cache even though the modal could already be visible from a newer per-session live projection.
- Credential brokers closed over one run-binding object while successful starts/submissions updated another, and a throwing after-turn submission did not revoke its newly registered credential lease.
- Observation bootstrap errors and session deletion did not consistently close/remove daemon subscriptions. A first `ensureObserved()` racing Runtime initialization could also establish a duplicate subscription.

Expected behavior: every attached Space client applies the same queue and run-scoped live truth, daemon interactions remain answerable as soon as they are shown, credential leases stay bound and bounded, and every failed/deleted observation is closed exactly once.

#### Root Cause

The Space IPC run-change contract evolved to carry queue state but its renderer reducer was not updated with the new field. The projection protocol also treated a terminal run transition as run-domain-only even though KodaX atomically removes several run-scoped live domains. Interaction ownership was inferred from a lagging global cache instead of both authoritative caches. Credential tracking copied mutable binding state instead of sharing it with the broker closure. Finally, observation installation had no common cleanup boundary and initialization recovery did not recognize an already in-flight observation promise.

#### Resolution

- Added an explicit `resetRunScopedState` run-change flag and applied queue plus run-scoped resets atomically in the main reducer, renderer reducer, and modal queues while preserving session Todo state.
- Made pending-interaction lookup consult both profile and per-session live projections, removing the AskUser/Permission routing window.
- Shared one mutable run-binding scope between each credential broker and its tracked lease, and revoke newly created leases when `submitInput()` throws.
- Made observation installation exception-safe, ignored events from detached observations, prevented initialization from duplicating an in-flight subscription, and fully removed live observation state after successful session deletion.

Files changed:

- `packages/space-ipc-schema/src/channels/runtime.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/kodax/runtime/coder-daemon-projection.ts`
- `apps/desktop/electron/kodax/runtime/runtime-projection-controller.ts`
- `apps/desktop/renderer/src/store/runtimeProjectionState.ts`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/electron/test/app-store-runtime-projection.test.ts`
- `apps/desktop/electron/test/coder-daemon-projection.test.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `apps/desktop/electron/test/runtime-projection-controller.test.ts`
- `apps/desktop/electron/test/runtime-projection-state.test.ts`
- `docs/KNOWN_ISSUES.md`

Tests added or extended:

- Run deltas update queued inputs and atomically reset stale run-scoped state without clearing Todo.
- A new run's first assistant delta cannot append to the prior run's draft.
- Terminal reset removes Runtime AskUser entries from renderer modal queues.
- Per-session live interactions are routable before the global profile refresh.
- Wrong-run credential requests fail before the intended run's first broker call, and failed submissions revoke their lease.
- Failed observation bootstrap and session deletion close exactly one subscription; initial observation does not duplicate during Runtime startup.

Verification:

- F121 targeted and published KodaX `0.7.69` process-distinct suites: 51 passed, 0 failed, 1 Windows symlink test skipped.
- Complete desktop suite: 1,495 passed, 0 failed, 2 platform-conditional skips.
- Root TypeScript typecheck, targeted ESLint, Prettier, and `git diff --check` passed.

### 047: Long user queries consume excessive transcript height without an inline collapse control

- Priority: Low
- Status: Resolved
- Introduced: v0.1.x
- Fixed: v0.1.31
- Created: 2026-07-16
- Resolution Date: 2026-07-16

#### Original Problem

Current behavior:

- A long user query always renders at its full height in the conversation transcript.
- Detailed prompts can occupy most of the viewport and make previous questions, responses, and tool receipts harder to scan.
- There is no local control for recovering the full query after a compact transcript presentation.

Expected behavior:

- Queries that exceed a compact preview should show their opening lines by default.
- The user can expand the full query and collapse it again without leaving the conversation.
- Short queries remain unchanged and do not gain redundant controls.
- The behavior is shared by Coder and Partner and remains correct as the transcript width changes.

Reproduction steps:

1. Open either Coder or Partner and send a multi-paragraph prompt that occupies more than four rendered lines.
2. Observe that the complete prompt consumes a large vertical region in the transcript.
3. Look for an expand/collapse control and observe that none exists.

#### Context

Affected components:

- `apps/desktop/renderer/src/features/session/messages/bubbles.tsx`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `tests/e2e/user-query-collapse.spec.ts`

#### Root Cause

`UserBubble` rendered `UserMessageContent` directly inside the bubble with wrapping and overflow safety but no height policy or local expansion state. Character-count truncation would not have been reliable because the actual height depends on locale, file references, transcript font size, and available pane width.

#### Resolution

- Measure the query's real rendered height and show a four-line opening preview only when that content overflows.
- Add an inline Expand/Collapse control with a short height transition, keyboard focus treatment, `aria-controls`, `aria-expanded`, and localized accessible labels.
- Observe content reflow with `ResizeObserver` so the decision stays correct when the transcript width or wrapping changes.
- Keep short queries unchanged and preserve the complete original content for copy, fork, rewind, and session history behavior.

Files changed:

- `apps/desktop/renderer/src/features/session/messages/bubbles.tsx`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `tests/e2e/user-query-collapse.spec.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- An Electron E2E scenario verifies the four-line overflow preview, opening content, localized accessible toggle state, full expansion, and collapse back to the original height.

Verification:

- Renderer TypeScript, targeted ESLint, Prettier, and the production renderer build passed.
- The Electron trace completed every new product assertion. The command subsequently timed out only in the pre-existing `Close context` teardown path after the final collapsed-state assertion passed.

### 048: Legacy `tsx/esm` test registration corrupts CommonJS JSON imports from the KodaX SDK dependency graph

- Priority: Low
- Status: Resolved
- Introduced: v0.1.x
- Fixed: v0.1.32 development
- Created: 2026-07-17
- Resolution Date: 2026-07-17

#### Original Problem

Current behavior:

- Space's Node test commands register `tsx/esm` directly.
- Importing `@kodax-ai/kodax`, `@kodax-ai/kodax/runtime`, or `@kodax-ai/kodax/a2a` under that legacy registration transforms `cli-boxes/boxes.json` into JavaScript and then asks Node's CommonJS loader to parse the transformed text as JSON.
- SDK-backed tests either fail with `Unexpected token 'v', "var single"... is not valid JSON` or depend on lazy-load and mock paths that hide the loader failure.

Expected behavior:

- Space tests use the supported `tsx` registration entrypoint.
- KodaX root and subpath exports import normally under the same loader used by the test suite.
- Test mocks remain responsible only for state isolation, not for hiding a loader incompatibility.

Reproduction steps:

1. Run `node --import tsx/esm --input-type=module -e "await import('@kodax-ai/kodax/runtime')"`.
2. Observe the JSON-as-JavaScript parse failure in `cli-boxes/boxes.json`.
3. Replace the registration with `--import tsx` and observe that the root, Runtime, and A2A entries import successfully.

#### Context

Affected components:

- `apps/desktop/package.json`
- `packages/space-ipc-schema/package.json`
- Test-loader comments and mock rationale across Electron and schema tests

#### Root Cause

The repository retained the old `tsx/esm` registration subpath after the installed `tsx` version adopted `tsx` as its supported Node registration entrypoint. The legacy loader transforms JSON required by a CommonJS dependency and conflicts with Node's subsequent JSON parsing. The KodaX package and `cli-boxes/boxes.json` are valid; plain Node, packaged Electron, and the supported `tsx` registration all load them correctly.

#### Resolution

- Changed both formal Node test commands from `--import tsx/esm` to `--import tsx`.
- Updated current test-harness comments so lazy loading, mocks, and plain-Node daemon probes describe their actual isolation and compatibility responsibilities instead of the removed loader workaround.
- Preserved `tsx/esm/api` in the Partner extraction runner because that is a separate supported programmatic API, not the obsolete Node registration entrypoint.

Files changed:

- `apps/desktop/package.json`
- `packages/space-ipc-schema/package.json`
- `packages/space-ipc-schema/test/registry.test.ts`
- `scripts/build-main.mjs`
- Current Electron loader, catalog, mock, and compatibility comments
- `docs/KNOWN_ISSUES.md`

Tests added:

- No new test file was required; the existing schema and Electron suites now execute through the corrected formal loader entrypoint.

Verification:

- KodaX root, Runtime, and A2A import probe under `node --import tsx`: passed.
- Space IPC schema suite: 253 passed.
- Runtime/Session targeted suite including process-distinct daemon sharing: 50 passed.
- Complete Electron suite with isolated profile and serial execution: 1,499 passed, 0 failed, 2 Windows capability skips.

### 049: Provider/model and mode changes rolled back before the first send because the daemon Session was not admitted

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32 development
- Created: 2026-07-17
- Resolution Date: 2026-07-17

#### Original Problem

Current behavior:

- After creating or selecting a Coder Session, choosing a Provider/model from the bottom-right picker can close the picker without changing its label.
- The same shared mutation path can reject permission, reasoning, engine, or Agent-mode changes before that Session has sent its first prompt.
- Repeated clicks keep failing and the UI previously exposed the failure only through a renderer console warning.

Expected behavior:

- Any Space Coder Session can accept runtime-setting changes immediately, including before its first send.
- The shared Runtime receives a complete settings snapshot when it first admits that Session.
- A failed selection is visible to the user and must not silently change only the global default Provider.

Reproduction steps:

1. Start Space with the shared Coder Runtime enabled and create a new Coder Session.
2. Before sending the first prompt, open the bottom-right Provider/model picker.
3. Select another configured Provider and model.
4. Observe that the selector remains unchanged and the diagnostics log reports `host.commitRuntimeMutation` followed by `Session not found`.

#### Context

Affected components:

- `apps/desktop/electron/kodax/host.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/renderer/src/shell/ModelEffortSelector.tsx`

#### Root Cause

Space creates its in-memory `ManagedSession` synchronously, while admission to the shared Coder daemon is intentionally lazy and normally happens when `RealKodaXSession.send()` runs. `commitRuntimeMutation()` saw that the daemon was ready and called `updateSessionSettings()` immediately, but that method assumed the Session already existed in the daemon. A pre-send selection therefore threw `Session not found`; the host rolled the mutation back, while the picker closed and logged the error only to the console. The picker also attempted to persist the global default Provider before the current Session switch succeeded, which could leave the default changed even though the visible Session selection failed.

#### Resolution

- Extended Runtime settings updates with an optional authoritative Session identity. When supplied, the adapter admits a missing Coder Session before reading or updating its revisioned settings.
- Made host runtime mutations send the complete current Provider/model/reasoning/permission/Agent/engine/execution settings snapshot. This correctly initializes a newly admitted daemon Session instead of leaving every unchanged field empty.
- Reordered the Provider/model picker so the current or pending selection is applied before global-default persistence. Failed live-session changes no longer alter only the global default.
- Added visible error toasts for `/model` and Provider-default persistence failures while preserving diagnostic console warnings.

Files changed:

- `apps/desktop/electron/kodax/host.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/renderer/src/shell/ModelEffortSelector.tsx`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `tests/e2e/fixtures.ts`
- `tests/e2e/model-picker.spec.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- A Runtime adapter regression verifies that a settings update admits a missing Coder Session before its first send and then performs the revisioned settings update.
- An Electron interaction scenario covers Provider/model selection both before and after Session creation with two isolated configured Providers.

Verification:

- User diagnostics contained repeated `Session not found` failures at the exact Provider/model selection times, confirming the admission gap.
- Runtime adapter and Session mutation suites: 33 passed, 0 failed.
- Desktop TypeScript and targeted ESLint passed.
- The Electron interaction scenario is checked in; on this Windows host Electron failed before creating its first window because its GPU subprocess repeatedly exited, so no product assertion from that run was evaluated.

### 050: Reference Agent continuation can remain `working` after `sendInput` until an explicit reconcile

- Priority: Medium
- Status: Resolved
- Introduced: KodaX 0.7.71
- Fixed: KodaX 0.7.72
- Created: 2026-07-17
- Resolution Date: 2026-07-19

#### Original Problem

Current behavior:

- A Reference External Agent task reaches `input-required` and accepts `sendInput()`.
- The Reference executor can finish between that call and the normal durable event pump, while `tasks.wait()` times out and the persisted task snapshot remains `working`.
- Calling the public `reconcile(taskId)` operation advances the same task to its terminal state.

Expected behavior:

- Successful input delivery wakes or reconciles the admitted task without requiring every host to schedule a second lifecycle operation.
- `tasks.wait()` and durable snapshots converge on the executor's terminal state after `sendInput()` within the configured bound.

Reproduction steps:

1. Create a Reference executor task that requests input and completes after receiving it.
2. Wait for `input-required`, call `sendInput()`, then call `tasks.wait()` without an explicit reconcile.
3. Observe the wait timeout or stale `working` snapshot; call `reconcile(taskId)` and observe terminal convergence.

#### Context

Affected components:

- Published `@kodax-ai/kodax@0.7.71` Reference executor lifecycle
- `apps/desktop/electron/kodax/external-agent-gateway.ts`
- `apps/desktop/electron/test/external-agent-gateway.test.ts`

#### Root Cause

The observable contract has a continuation race between successful input delivery, executor completion, and the durable task event pump. Space does not depend on the SDK's private scheduling mechanism, so the precise internal cause remains upstream; the public evidence is that an immediate reconcile closes the gap.

#### Resolution

KodaX `0.7.72` makes successful Reference `sendInput()` wake and reconcile the admitted task lifecycle. The exact published Registry package reaches a terminal task and terminal durable snapshot through `tasks.wait()` without a second host lifecycle call.

Space removed `withReferenceContinuationReconcile()` and now returns the SDK plane directly. The direct package probe and all six `external-agent-gateway` regression cases pass, including the input-required continuation path; the full Space regression, packaging smoke, and packaged boot also pass.

### 051: Embedded Runtime omits the working `externalAgentAdmin` service from its public capability metadata

- Priority: Low
- Status: Resolved
- Introduced: KodaX 0.7.71
- Fixed: KodaX 0.7.72
- Created: 2026-07-17
- Resolution Date: 2026-07-19

#### Original Problem

Current behavior:

- `createKodaXRuntime()` in embedded inline mode succeeds with `requirements.externalAgentAdmin = 1`.
- `runtime.admin.agentRegistrations.setEnabled()` exists and works.
- The returned `runtime.capabilities.externalAgentAdmin` field is nevertheless absent, so a host cannot truthfully inspect the version it just required and consumed.

Expected behavior:

- A capability that satisfies a versioned requirement and exposes a working public administration service is also present in the returned public capability metadata.
- Embedded and daemon Runtime surfaces report the same capability name/version semantics where they expose the same service.

Reproduction steps:

1. Create an embedded inline Runtime with an External Agent registration store and `requirements: { externalAgents: true, externalAgentAdmin: 1 }`.
2. Verify that creation succeeds and `runtime.admin.agentRegistrations.setEnabled()` works.
3. Inspect `runtime.capabilities.externalAgentAdmin` and observe that it is `undefined`; compare with the daemon capability metadata, which advertises version 1.

#### Context

Affected components:

- Published `@kodax-ai/kodax@0.7.71` embedded Runtime facade
- Space's inline Reference External Agent host

#### Root Cause

KodaX validates embedded requirements against an internal capability set containing `externalAgentAdmin: { version: 1 }`, but the returned public Runtime object constructs a narrower capability object and omits that entry. The service is functional; the metadata projection is incomplete.

#### Resolution

KodaX `0.7.72` includes `externalAgentAdmin: { version: 1 }` in the embedded Runtime's public capability projection and keeps the service available through `runtime.admin.agentRegistrations`.

The direct published-package probe creates embedded Runtime with `externalAgentAdmin: 1`, asserts the advertised version, and exercises the administration service. Space's Worker/daemon compatibility suite and full regression also pass with the capability required by the host adapter.

### 052: Composer could send text before an asynchronously attached image entered the artifact payload

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.9
- Fixed: v0.1.32 development
- Created: 2026-07-17
- Resolution Date: 2026-07-17

#### Original Problem

Current behavior:

- Pasting, dropping, or selecting an image starts asynchronous Session creation and clipboard-sandbox persistence without marking the composer busy.
- If the user submits text before that work finishes, `handleSend()` can observe an empty `pendingImages` array and send a text-only turn.
- This is easiest to hit in a new Session because image preparation must first wait for `session.create`.

Expected behavior:

- Attachment preparation becomes visible to send guards synchronously, before the first asynchronous wait.
- Button, keyboard, and programmatic composer sends remain blocked until every concurrent attachment operation has settled.
- Space continues to pass completed image artifacts through the SDK capability preflight; it does not bypass or duplicate the SDK's Provider/model capability policy.

#### Context

Affected components:

- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `apps/desktop/renderer/src/shell/attachmentFiles.ts`

#### Root Cause

Attachment event handlers invoked their asynchronous work fire-and-forget. The only signal that an image was ready was the later React `pendingImages` state update, so neither the synchronous Enter handler nor `handleSend()` could distinguish “no image selected” from “selected image is still being saved.”

#### Resolution

- Added a synchronous, reference-counted pending-attachment gate so overlapping attachment operations cannot re-enable sending prematurely.
- Routed clipboard image, native clipboard fallback, drag/drop, file picker, and folder attachment entry points through the same gate.
- Guarded both `handleSend()` and the Enter key with the synchronous gate, while using React state to disable the send button and show working feedback.
- Preserved attachment errors and the existing SDK artifact preflight behavior.

Files changed:

- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `apps/desktop/renderer/src/shell/attachmentFiles.ts`
- `apps/desktop/electron/test/attachment-files.test.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- The attachment gate becomes pending synchronously and remains pending until all overlapping operations release it.
- Releasing the same operation more than once is idempotent and cannot corrupt the pending count.

Verification:

- Targeted attachment tests: 6 passed, 0 failed.
- Full repository TypeScript check passed; targeted ESLint and Prettier checks passed for all changed code and test files.

### 053: Restored daemon runs rejected queued prompts because the composer requested unsupported interrupt delivery

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32 development
- Created: 2026-07-17
- Resolution Date: 2026-07-17

#### Original Problem

Current behavior:

- A Coder turn is interrupted, Space is closed, and the same Space and Session are reopened while the daemon-owned run is still active.
- Sending a normal queued follow-up makes `session.send` fail with `Interrupt delivery is not supported by the connected KodaX Runtime; choose after-turn`.
- The rejected prompt is restored to the composer, but it is not accepted into the Runtime continuation queue.

Expected behavior:

- Space preserves a follow-up prompt when the recovered active run cannot accept interrupt delivery.
- The prompt is queued after the active daemon run and the transcript bubble reflects the delivery mode actually accepted by main.
- Legacy inline sessions retain their existing interrupt queue behavior.

Reproduction steps:

1. Start a Coder turn through the shared daemon Runtime and interrupt or detach Space while work remains active.
2. Close Space, reopen the same Space, and select the same Session so live Runtime state is restored.
3. While the restored turn is still running, submit a follow-up with the composer's normal Enter path.
4. Observe a `HANDLER_ERROR` because the composer requested `interrupt` while the connected Runtime advertises only `after-turn` input.

#### Context

Affected components:

- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `apps/desktop/renderer/src/store/appStore.ts`

#### Root Cause

The daemon correctly retained and re-exposed the active run across the Space process restart. `RealKodaXSession.send()` discovered that run through `findActiveRunId()`, but the composer still defaulted a normal Enter submission to `queueMode: interrupt`. The connected Runtime does not advertise `interruptInput`, and the daemon continuation path rejected that mode instead of preserving the prompt through its supported `after_turn` submission API.

#### Resolution

- Treat interrupt delivery as best-effort for daemon continuations and downgrade it to the supported after-turn queue instead of throwing from `session.send`.
- Return the authoritative accepted `queueMode: after-turn` in the send acknowledgement.
- Update an existing optimistic queued bubble with the accepted mode so its label and waiting-state copy no longer claim that it is awaiting an interrupt safe point.
- Leave the inline SDK interrupt queue unchanged.

Files changed:

- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/electron/test/real-session-runtime-queue.test.ts`
- `apps/desktop/electron/test/app-store-cancel-event.test.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- A restored-run regression simulates a new Space process with no local `currentAbort`, discovers the daemon's active run, submits an interrupt-style prompt, and verifies that it is accepted as an after-turn continuation.
- A renderer-store regression verifies that the queued acknowledgement replaces an optimistic `interrupt` mode with authoritative `after-turn` metadata.

Verification:

- Runtime queue, Session send-scope, Runtime adapter, renderer queue-state, and restored-run tests: 57 passed, 0 failed.
- Full repository TypeScript check passed.

### 054: Daemon permission dialogs discarded command, directory, and operation context

- Priority: High
- Status: Resolved
- Introduced: v0.1.31
- Fixed: v0.1.32 development
- Created: 2026-07-17
- Resolution Date: 2026-07-17

#### Original Problem

When a shared-daemon Coder run requested permission, the modal displayed only
`Permission requested for bash` and the tool name. It did not show the command,
working directory, target, operation type, or useful description. A user could
therefore neither verify a legitimate request nor distinguish a read from a
write/execute action before authorizing it.

Expected behavior: a permission request must expose enough sanitized context
for an informed decision, while keeping credentials and transport-only fields
out of renderer state. Single and batched request views must both show the
actual command when present.

#### Root Cause

The SDK daemon request already emitted `inputPreview`, reason, and risk, but
`coder-daemon-projection.ts` projected only `toolName` and a generic fallback
reason. The Space Runtime IPC schema then stripped any additional tool-call
display fields. The modal had no operation or execution-directory fields to
render and its batch branch reduced every item to tool name plus reason.

#### Resolution

- Parse the bounded SDK input preview in Electron main, sanitize it before IPC,
  derive operation type, assess dangerous commands, and attach the effective
  execution directory.
- Preserve only bounded display-safe input, operation, and cwd through the
  Runtime and permission schemas; unknown transport fields remain stripped.
- Render description, operation, working directory, target, exact command, and
  remaining structured input in the single modal; show each command in batch
  mode as well.
- Redact sensitive field names and common inline shell credential assignments,
  while preserving command line breaks and tab-separated token boundaries.
- Reject previews over 8192 characters before `JSON.parse`, omit malformed raw
  preview text from error fallbacks, and cap every displayed collection at 128
  total items including its explicit truncation marker.
- Apply recursion depth and cycle limits before data reaches the renderer.

Files changed:

- `apps/desktop/electron/kodax/runtime/coder-daemon-projection.ts`
- `apps/desktop/electron/permission/sanitize.ts`
- `apps/desktop/renderer/src/features/permission/PermissionModal.tsx`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `packages/space-ipc-schema/src/channels/permission.ts`
- `packages/space-ipc-schema/src/channels/runtime.ts`
- `apps/desktop/electron/test/coder-daemon-projection.test.ts`
- `apps/desktop/electron/test/permission-sanitize.test.ts`
- `packages/space-ipc-schema/test/runtime.test.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- Daemon projection preserves sanitized command/description/cwd and derives
  execution operation and fallback risk/reason.
- Permission input sanitization redacts sensitive keys and inline credentials.
- Multiline command semantics, oversized/non-object preview rejection, and
  bounded nested collection regressions.
- Runtime IPC keeps bounded display fields and strips unknown transport data.

Verification:

- Full Space TypeScript check passed.
- Projection, sanitizer, batching, broker, mode-policy, registry, risk, Runtime
  adapter/controller, and IPC schema tests passed 152/152.

### 055: Ark multimodal follow-ups rejected supported model routes during artifact preflight

- Priority: High
- Status: Resolved
- Introduced: <= v0.1.31
- Fixed: v0.1.32-hotfix.0
- Created: 2026-07-17
- Resolution Date: 2026-07-17

#### Original Problem

After a successful image-and-text turn, a user could send a text follow-up,
stop generation, then add another image and immediately send. The follow-up
could fail with `input artifact preflight failed` even when the selected Ark
Coding route supported image input. The same workflow also exposed the
asynchronous attachment-persistence race tracked separately as issue 052.

#### Resolution

- KodaX SDK `0.7.72-hotfix.0` first corrected image capability routing for the
  supported Ark Coding models; the published `0.7.72` baseline retains that fix.
- Capability and artifact preflight checks cover both Doubao Seed 2.0 routes,
  Kimi K2.7 Code, Kimi K2.6, and MiniMax M3.
- Space synchronously gates all send paths while attachment persistence is
  pending, as documented and tested under issue 052.

### 056: Restored daemon Sessions lost Auto mode, exposed an unwired plan exit, and reset AskUser choices

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32 development with KodaX SDK 0.7.72
- Created: 2026-07-17
- Resolution Date: 2026-07-19

#### Original Problem

The Coder UI displayed `Auto · llm`, but a restored shared-daemon Session
prompted for low-risk `read`, ordinary verification `bash`, large `write`, and
`exit_plan_mode` calls. In Session
`s_e2be3e5b-5071-4bd7-b287-bd0739f339e3`, run
`run_mroxwies_2b373716` emitted ten generic permission requests. Its effective
configuration contained provider/model/reasoning data but omitted both
`permissionMode` and `autoModeEngine`, and its versioned Session settings file
did not exist. The same run also showed two interaction failures: daemon
projection refreshes cleared a selected AskUser option, and `exit_plan_mode`
opened a generic high-risk permission dialog before failing because no approval
callback existed.

Expected behavior:

- The mode shown for a Session must be the mode used by every newly admitted or
  restored daemon run.
- `Auto · llm` must route tools through the Runtime-owned Auto guardrail; generic
  permission requests are reserved for explicit guardrail escalation or a
  deliberate fail-closed non-Auto policy.
- A daemon run must not advertise a tool whose required interaction bridge is
  unavailable.
- Refreshing an unchanged interaction projection must preserve the user's local
  selection.

#### Root Cause

- `RealKodaXSession.send()` synchronized Runtime settings only when
  `ensureSession()` reported that the canonical Session was newly created.
  Canonical Session identity and versioned settings have separate persistence
  lifecycles, so an existing Session could have missing/stale settings and skip
  synchronization indefinitely.
- The daemon transport cannot carry the `exitPlanMode` callback, but the run
  still exposed `exit_plan_mode`; Runtime therefore treated it as an ordinary
  permission-controlled tool and execution later produced the interactive-REPL
  error.
- `AskUserModal` used the deserialized `question` object identity as a reset
  dependency. An equivalent projection object reset local selection state.
- The installed KodaX bundle also lacked the Runtime-owned Auto guardrail and
  valid bounded permission-preview fixes tracked in KodaX SDK issue 172.

#### Resolution

- Reconcile the complete Runtime settings snapshot once at each daemon run
  execution boundary and before attaching an after-turn continuation. The
  revisioned comparison treats `null` deletion and absent values as equivalent,
  skips unchanged writes, and serializes concurrent updates per Session.
- Exclude `exit_plan_mode` from Space daemon runs until a dedicated approval
  transport exists. It therefore cannot become an unknown high-risk permission
  prompt followed by an interactive-REPL error.
- Reset AskUser form state by a canonical semantic interaction key rather than
  projection object identity, preserving selections across equivalent refreshes.
- Recover only complete, allowlisted top-level display fields from an older
  SDK's truncated permission preview, then apply the normal credential
  redaction. Never expose partial file content or nested lookalike fields.
- Require the KodaX daemon `runtimeAutoModeGuardrail` capability during Runtime
  connection, and use the SDK-owned, once-consumed tool-call authorization path
  as the only Coder permission decision owner. Space projects only genuine
  escalation requests and no longer re-runs a second Coder broker.
- Install and verify the published KodaX SDK 0.7.72 package containing
  the Runtime guardrail, bounded permission preview, daemon capability upgrade,
  Workflow host policy forwarding, and AMA/SA-only mode contract.

Files changed:

- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/kodax/runtime/coder-daemon-projection.ts`
- `apps/desktop/renderer/src/features/ask-user/AskUserModal.tsx`
- `apps/desktop/renderer/src/features/ask-user/ask-user-state.ts`
- `apps/desktop/electron/test/coder-daemon-projection.test.ts`
- `apps/desktop/electron/test/real-session-runtime-queue.test.ts`
- `apps/desktop/electron/test/ask-user-state.test.ts`
- `docs/KNOWN_ISSUES.md`

Verification:

- Full Space tests against the published Registry package passed: 1,819 passed,
  2 platform-permission skips, 0 failed. The process-distinct daemon probe
  explicitly requires and verifies `runtimeAutoModeGuardrail: 1` with owner
  `session-runtime`.
- KodaX permission, Auto guardrail, daemon upgrade, Workflow signal, and
  AMA-migration regressions passed: 792 passed, 1 platform-dependent skip.
- Space TypeScript check and renderer/main production smoke build passed.
- The installed Space SDK `dist` matched the built KodaX `dist` byte-for-byte:
  120 files, 0 missing, 0 extra, 0 hash mismatches.
- Verified Registry package: `@kodax-ai/kodax@0.7.72`, npm integrity
  `sha512-aDKwe006GZC1YKt6o+ArFdOoj/waAavcZZ78nejFSYVY1Gi8va5c+VUiESKd5N2eyKpkBBfe2/sRsEqqrqnNIw==`, SHA-256
  `BC40A7237F0601C47578A07B36CBBA1C7EBF843D747E7ED5BD304AA6F001C949`.

### 057: Auto LLM sent an empty classifier model after daemon observation erased the provider default

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32 development
- Created: 2026-07-19
- Resolution Date: 2026-07-19

#### Original Problem

With the UI showing `Auto · llm`, a low-risk read-only `bash` command still
opened a permission dialog. The dialog reason contained a z.ai Coding API 400:
`[1214][model:The model code cannot be empty.]`. Every subsequent tool request
could repeat the same 400 and prompt. The affected Session
`s_ff911c11-2e3f-4ddf-bf44-43e51c24496b` used `zai-coding`; its failed Run
`run_mrrvpdcm_935803b0` had no model, even though Space's durable sidecar and
KodaX user configuration both selected `glm-5.2`.

Expected behavior:

- Space must pass a concrete effective model to Runtime-owned side services
  whenever a provider has a default model.
- Missing Runtime override fields must not erase a valid provider default while
  an observation is being admitted.
- Auto LLM classifier failures must not turn every ordinary tool call into a
  manual permission prompt.

#### Root Cause

- A newly admitted daemon Session initially exposed an empty versioned settings
  snapshot. `syncSpaceSessionSettings()` assigned `settings.model` directly to
  the in-memory Session, so the absent field erased the valid `glm-5.2` model
  that Space had already resolved and persisted.
- The next run-boundary reconciliation converted the now-missing model into a
  `null` deletion in Runtime. The main provider still worked because it applies
  its own default internally, but the SDK Runtime Auto guardrail inherited the
  empty Run model and sent it to the classifier API.
- KodaX SDK 0.7.72 logs a warning for an empty inherited classifier model but
  still performs the request. Its fail-closed error path then escalates the tool
  call and its circuit breaker eventually changes the Session engine to rules.
- Earlier tests proved settings synchronization, Runtime guardrail ownership,
  and explicit classifier models independently, but did not cover the combined
  case `provider default + omitted Runtime model + observation bootstrap`.

#### Resolution

- Resolve a concrete provider default model when a Space Session is created.
- When the provider changes, replace the old model with the new provider's
  concrete default instead of representing that default as `undefined`.
- Materialize the effective default in main-process Session creation, UI and
  slash-command provider switches, and `/model default`; custom providers use
  the same descriptor resolution instead of falling back to an empty model.
- Interpret an omitted Runtime settings model as “use the provider default”
  during daemon projection. Preserve an existing model only as the final
  fallback for a same-provider custom descriptor that is temporarily missing.
- Repair the one confirmed affected Session only after verifying it had no
  active Run or pending permission: Runtime settings revision 2 to 3 now stores
  `model: glm-5.2` and restores `autoModeEngine: llm`; the Space sidecar received
  the same values through the normal settings event.
- Do not modify the KodaX SDK source. Track the remaining SDK hardening request
  separately for upstream delivery.

Files changed:

- `apps/desktop/electron/kodax/host.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/slash/builtin.ts`
- `apps/desktop/renderer/src/store/runtimeSessionSettings.ts`
- `apps/desktop/electron/test/host.test.ts`
- `apps/desktop/electron/test/host-try-resume.test.ts`
- `apps/desktop/electron/test/session-setters.test.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `apps/desktop/electron/test/runtime-session-settings.test.ts`
- `apps/desktop/electron/test/slash-builtin.test.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- Session creation resolves `zai-coding` to the concrete `glm-5.2` default.
- Provider switching replaces a stale model override with the new provider
  default.
- Clearing a model override and switching to a KodaX-config custom provider
  both persist a concrete provider default.
- Daemon observation with an omitted Runtime model retains a concrete model for
  Auto LLM.
- Renderer projection preserves the effective model for partial settings
  updates, while a provider change cannot retain the previous provider's model.

Verification:

- Targeted host, resume, setter, slash-command, daemon adapter, and renderer
  settings regressions passed: 131 passed, 0 failed.
- Full all-workspace Space tests passed: 1,837 passed, 2 platform-permission
  skips, 0 failed. TypeScript check and renderer/main production smoke build
  also passed.
- The repaired Runtime settings and Space sidecar both report
  `provider: zai-coding`, `model: glm-5.2`, `permissionMode: auto`, and
  `autoModeEngine: llm`.

### 058: Auto LLM diagnosis exposed a stale 8-second process while Space did not seed daemon classifier defaults

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32 development
- Created: 2026-07-19
- Resolution Date: 2026-07-19

#### Original Problem

The Auto LLM side query had previously been extended from eight seconds to 20
seconds, but a new permission escalation appeared to report another classifier
timeout. The visible behavior made it unclear whether KodaX 0.7.72 still timed
out at eight seconds, whether a real 20-second provider request had expired, or
whether Space was attached to stale code after the dependency update.

Expected behavior:

- a Space 0.1.32 Coder session must never silently use a daemon older than the
  exact KodaX 0.7.72 release baseline;
- the Runtime Session snapshot must expose the effective Auto LLM timeout and
  optional classifier model rather than depending on an invisible SDK default;
- `autoMode` config and valid `KODAX_AUTO_MODE_*` environment overrides must
  have the same precedence in Space-started Runtime sessions as in the KodaX
  REPL;
- another attached client's explicit Session settings must remain authoritative.

#### Evidence and Root Cause

- The persisted trace
  `trace-1784371464466-5-ezg0sk.jsonl` records the exact reason
  `classifier timeout (8000ms exceeded)`. It is therefore not evidence of a
  20,000ms request expiring. The same trace's abort stack points to the sibling
  KodaX checkout's `dist/kodax_cli.js`, so the confirmed event came from a
  long-lived local KodaX CLI process rather than proving that the current Space
  package emitted it.
- The machine retained two profile daemon records. The daemon below
  the Space profile root was KodaX `0.7.69`, PID `16192`, started on
  2026-07-14; the CLI-style profile daemon was KodaX `0.7.72`, PID `17268`,
  started on 2026-07-19. Those recorded PIDs were no longer alive at final
  verification. Older live `electron.exe` entries initially looked related,
  but their full command lines proved they were isolated `kodax-test-*` E2E
  daemon fixtures, not the main Space application and not owners of the user
  profile. Installing or rebuilding a package still cannot replace code already
  loaded into a long-lived CLI, Electron, or daemon process.
- KodaX commit `f51ba6be` changed
  `DEFAULT_CLASSIFIER_TIMEOUT_MS` from eight seconds to 20 seconds and is part
  of tag `v0.7.72`. `classify()` passes this value to `sideQuery()`, whose one
  AbortController deadline covers provider queueing, request/first-token time,
  streaming until completion, and provider retry waits.
- The KodaX REPL reads `autoMode.engine`, `classifierModel`, and `timeoutMs`
  from the user config plus `KODAX_AUTO_MODE_*`. The Runtime daemon path instead
  consumes `RuntimeSessionSettings`. Space projected these fields from Runtime
  but did not seed them when reconciling a Session, so the effective timeout
  remained an implicit property of whichever daemon version happened to own
  the session.
- A genuine 20-second timeout remains possible on a slow or queued foreground
  provider because the Auto classifier inherits the main provider/model unless
  an independent classifier model is configured. That is a different case and
  should be diagnosed from a literal `20000ms` reason plus provider telemetry.

#### Resolution

- Require daemon identity version `>= 0.7.72` before Runtime readiness. An older
  or malformed version fails Coder closed with an explicit restart-after-update
  diagnostic; Space never falls back to a hidden inline Coder owner.
- Resolve the Runtime-supported KodaX `autoMode` fields (`engine`,
  `classifierModel`, and `timeoutMs`) plus their valid environment overrides in
  the main process. Space materializes the 0.7.72 default as an explicit
  20,000ms Session setting and carries an optional classifier model.
- Fill only missing Runtime fields. Existing daemon/session values written by
  another trusted client are not overwritten.
- Retry revisioned settings convergence after a bounded CAS conflict and
  re-read the latest snapshot before merging, preserving concurrent client
  updates.
- Include Runtime version, effective classifier model, and effective timeout in
  `/auto-denials` output so an eight-second stale path and a genuine 20-second
  provider timeout are distinguishable without inspecting private state.

Files changed:

- `apps/desktop/electron/kodax/user-config.ts`
- `apps/desktop/electron/kodax/runtime-defaults.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/slash/builtin.ts`
- `apps/desktop/renderer/src/shell/createSession.ts`
- `packages/space-ipc-schema/src/channels/kodax.ts`
- `apps/desktop/electron/test/user-config.test.ts`
- `apps/desktop/electron/test/runtime-defaults.test.ts`
- `apps/desktop/electron/test/create-session-inputs.test.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- KodaX 0.7.72's 20-second default, config mapping, environment precedence,
  invalid-value fallback, and KodaX Auto engine selection.
- Old-daemon rejection, first-Session timeout/classifier seeding, preservation
  of explicit daemon values, and CAS-race convergence without overwrite.

Verification:

- Focused Auto LLM/config/defaults/Runtime adapter regressions pass.
- Full TypeScript, all-workspace tests, lint, build and release checks are run
  as part of the final 0.1.32 gate recorded in the changelog.

### 059: KodaX Runtime does not publish complete effective Auto LLM settings or timeout-phase telemetry

- Priority: Medium
- Status: Resolved
- Introduced: KodaX 0.7.72
- Fixed: KodaX 0.7.73 / v0.1.32 development
- Created: 2026-07-19
- Resolution Date: 2026-07-20

#### Original Problem

Space can now prevent an old daemon and explicitly seed the Runtime-supported
Auto LLM settings, but the public KodaX contracts still cannot answer why a
genuine 20-second classifier call expired or fully reproduce the REPL config
path without a local compatibility parser.

Observed contract gaps:

- `loadConfig()` preserves the raw `autoMode` object at runtime but its public
  return type omits that field. The authoritative `loadAutoModeSettings()`
  parser is not exported from `@kodax-ai/kodax/repl`, so an SDK host must either
  cast an undocumented object or duplicate parsing and environment precedence.
- `RuntimeSessionSettings` carries engine, classifier model and timeout but not
  `speculativeWindowMs`; the Runtime-owned bootstrap also does not load the
  REPL config file. A host therefore cannot express the complete documented
  `autoMode` file configuration per Session.
- Both the historical eight-second implementation and 0.7.72's 20-second
  implementation advertise `runtimeAutoModeGuardrail: 1`. Capability
  negotiation cannot distinguish this behavior change; consumers must inspect
  the daemon version separately.
- The timeout trace reports only `classifier timeout (Nms exceeded)`. It omits
  provider, model, actual elapsed time, retry count/wait, and whether the
  deadline was spent in provider queue/connect, waiting for first token, or
  streaming the response. In the confirmed trace the `guardrail:auto-mode`
  span lasts only 1ms even though the decision says an eight-second classifier
  timeout, because it records the adopted verdict rather than the classifier
  operation.
- `packages/llm/src/side-query.ts` still describes the classifier override as
  approximately eight seconds even though the implementation is now 20 seconds.

Expected upstream behavior:

- Export one typed, side-effect-bounded Auto mode settings resolver or include
  `autoMode` in the public config type, and expose every Runtime-supported
  Session setting needed for REPL parity.
- Version the Auto guardrail capability when its externally visible default
  semantics change, or advertise the effective default timeout as structured
  capability/status data.
- Emit a prompt-free structured classifier diagnostic containing provider,
  model, configured timeout, elapsed time, outcome, retry count/wait and the
  last observable request phase. The classifier span should cover the actual
  side query, not only the final guardrail decision.

#### Resolution

KodaX 0.7.73 closes the public-contract gaps:

- The root and REPL entries export the pure typed
  `resolveAutoModeSettings()` resolver, and `loadConfig().autoMode` is declared.
- Runtime Session settings now carry `autoModeSpeculativeWindowMs`, including
  the meaningful value `0`.
- `runtimeAutoModeGuardrail` v2 publishes effective timeout/window defaults,
  bounded-input and diagnostics metadata; the concrete-grant contract extends
  the current daemon to v3. Capability negotiation is monotonic and safely
  upgrades only an idle old daemon.
- Public side-query results include provider, model, configured timeout,
  elapsed time, retry count/wait, first-output/stream timing and terminal phase.
  Timeout reasons and spans now cover the awaited classifier operation.

Space now consumes the SDK resolver instead of maintaining a compatibility
parser, projects the speculative window into revisioned Session settings, and
requires guardrail v3 plus the 0.7.73 Runtime baseline.

Verification:

- Resolver precedence/default and `speculativeWindowMs: 0` regressions pass.
- Session CAS tests cover configured speculative-window propagation and
  preservation of a concurrent daemon value.
- The published-package compatibility probe confirms the 0.7.73 daemon and
  guardrail v3 contract across processes.
- The npm-published 0.7.73 build includes KodaX commits `a6f022f0` and
  `bab0c689`: omitted Auto engines resolve to `llm`, persisted engines are not
  overwritten by a fresh REPL, configured classifier models remain observable,
  and the Space public-API probe needs no client-side fallback.

### 060: Space restart during daemon run admission aborted the accepted Coder run and startup health failures did not reconnect

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32 development
- Created: 2026-07-20
- Resolution Date: 2026-07-20

#### Original Problem

Immediately after opening the development build, a first Coder send could show
a generic `HANDLER_ERROR`. The provider picker displayed the default
`zai-coding / glm-5.2`, so the symptom looked like the earlier empty-model defect
had survived its fix.

Expected behavior:

- the effective provider model must be concrete even when the user has not
  manually changed the model picker;
- a normal Space close or development restart must detach from the shared
  daemon without aborting an accepted Coder run;
- a transient daemon-health ownership window must recover in the background
  rather than leaving Coder failed until a user send happens to retry startup;
- an explicit Stop/Cancel must continue to abort the authoritative daemon run.

#### Evidence and Root Cause

- Session `20260719_233647` and Run `run_mrsjgd41_4d356bef` both recorded
  `provider: zai-coding` and `model: glm-5.2`. Runtime settings revision 1 also
  contained the concrete model before `run.start`. No empty-model request or
  provider 400 occurred in this reproduction.
- The Run was accepted at `2026-07-20T01:21:02.639Z`; Space then issued an
  explicit `run.abort` operation about 1.1 seconds later. The old Electron main
  process exited and a new development main process initialized immediately
  afterward, while the daemon process remained alive.
- `RealKodaXSession.dispose()` correctly marked the local session disposed and
  aborted its local wait signal. However, if that signal arrived while
  `runs.start()` was still being acknowledged, `runCoderDaemon()` treated it as
  a user cancellation and called `abortSessionRun()`. This contradicted F121's
  detach-only shutdown contract.
- The preceding startup initially received the SDK's fail-safe error
  `Runtime daemon is unhealthy; refusing to start a competing owner.` Space
  published failure but did not schedule its existing bounded reconnect loop.
  The condition later cleared and a subsequent initialization succeeded, but
  recovery depended on another caller retrying manually.

#### Resolution

- During daemon run admission, distinguish shutdown detach from destructive
  session disposal and explicit cancellation. Normal Space shutdown does not
  send `run.abort`; user deletion and explicit cancellation still terminate a
  run started by that Space Session.
- Treat the SDK's exact transient unhealthy-owner refusal as `reconnecting` and
  schedule the existing exponential-backoff reconnect loop. The health-window
  retry chain stops if a later attempt reports a permanent failure. Other
  initialization failures, including version/capability incompatibility, remain
  fail-closed and are not silently retried as health races.
- Keep the previous default-model materialization unchanged: the persisted
  Session/Run evidence confirms that path was active in this reproduction.

Files changed:

- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/kodax/session-adapter.ts`
- `apps/desktop/electron/kodax/mock-session.ts`
- `apps/desktop/electron/kodax/host.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/test/real-session-runtime-queue.test.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- Disposing Space while daemon run admission is pending does not issue an abort,
  while an explicit cancellation still does.
- An exact transient unhealthy-daemon startup error automatically retries after
  the ownership safety window and reaches Runtime ready state.
- A health-window retry stops after a subsequent permanent incompatibility
  instead of creating an unbounded retry loop.

### 061: No-Session File Viewer calls `artifact.previewFile` without legacy-required Session fields and cannot open project files

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32 development
- Created: 2026-07-20
- Resolution Date: 2026-07-20

#### Original Problem

After F131 separated File Viewer from Artifact, opening any project file before
the first Session failed before the viewer could mount. The renderer displayed
two error toasts:

`无法预览文件：[artifact.previewFile] input failed schema validation`

Reproduction steps:

1. Open a project that has no Session.
2. Open a Markdown or other previewable file from the Files panel.
3. Observe that the right sidebar does not open and schema-validation toasts appear.

Expected behavior:

- File Viewer must require only an allowed project root and file path.
- It must not depend on a synthetic Session identity or Artifact IPC validation.
- Existing file read, binary-size, path-boundary and project allowlist guards must remain enforced.

#### Root Cause

The renderer switched `artifact.previewFile` to a new Session-optional schema and
immediately omitted `sessionId` and `surface`. A running development Electron
process can hot-reload the renderer while retaining its already-loaded
main/preload schema, which still requires those fields. The old validator rejects
the request before the new File Viewer event can be dispatched. More
fundamentally, the project-scoped File Viewer should not depend on an
`artifact.*` channel at all.

#### Resolution

- Load content-backed project files through the existing `files.read` channel.
- Validate path-backed files with `files.stat`, then let the shared `RichPreview`
  stack load them through `files.readBinary`.
- Keep the legacy Session-scoped `artifact.previewFile` schema unchanged and remove
  Artifact IPC from the File Viewer request path.
- Use monotonic snapshot versions and request keys so late refresh responses cannot
  replace a newly selected file; keep copy and refresh errors operation-specific.

Files changed:

- `apps/desktop/renderer/src/lib/openPath.ts`
- `apps/desktop/renderer/src/lib/pathClassify.ts`
- `apps/desktop/renderer/src/features/preview/FileViewer.tsx`
- `packages/space-ipc-schema/src/channels/artifact.ts`
- `packages/space-ipc-schema/test/artifact.test.ts`
- `apps/desktop/electron/test/open-path-helpers.test.ts`
- `tests/e2e/artifact-file-preview.spec.ts`

Verification:

- TypeScript, targeted ESLint, 264 IPC schema tests, 14 focused helper/model tests,
  and the production renderer/main smoke build passed.
- Electron trace confirms that a no-Session Markdown file opens in File Viewer,
  exposes no Artifact UI, and shows no schema-validation/preview error. The later
  runner timeout occurs only in the existing `Close context` cleanup step.

### 062: Composer sent renderer `file://` attachment links to the model instead of exact native filesystem paths

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.30
- Fixed: v0.1.32 development
- Created: 2026-07-20
- Resolution Date: 2026-07-20

#### Original Problem

Dragging a non-image file into the composer produced a useful clickable chip in
the user message, but the first model turn received that same Markdown
`file://` URL as its only file reference. The model then had to infer a local
filesystem path from a URL-encoded display value. On Windows this could turn a
drive path or UNC path into the wrong slash/root form; spaces and non-ASCII
segments made the failure more visible. macOS and Linux used a different POSIX
absolute-path shape and depended on the same guesswork.

Expected behavior:

- The transcript keeps the clickable attachment link and compact chip.
- The model receives the exact native absolute path returned by Electron.
- Windows drive paths, Windows UNC paths, macOS paths, and Linux paths retain
  their platform-native spelling and separators.
- Retrying a restored attachment link recovers the native path again.

#### Root Cause

The renderer used one `effectivePrompt` for two different concerns: transcript
presentation and model filesystem context. Space passed that prompt unchanged
through `session.send`; the SDK did not rewrite the path. The defect was
therefore in the Space composer/IPC boundary, not in KodaX SDK path handling.

#### Resolution

- Keep the existing `file://` Markdown link only in the visible and persisted
  user prompt.
- Send bounded structured attachment paths over `session.send`, validate that
  they are absolute in the Electron main process, and render them as a JSON
  model-only prompt overlay.
- Recover native paths from restored file links when the transient attachment
  state no longer exists.
- Preserve the overlay through fresh daemon runs and embedded follow-up queues;
  for a daemon after-turn continuation, include it beside that queued input
  because the current daemon input API has no per-input overlay field.

Files changed:

- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `apps/desktop/renderer/src/lib/fileReferences.ts`
- `packages/space-ipc-schema/src/channels/session.ts`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/kodax/attachment-path-overlay.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- related schema, path, overlay, and daemon-queue tests

Verification:

- Cross-platform path regressions cover Windows drive and UNC paths, macOS,
  Linux, spaces, Unicode, and restored file links.
- TypeScript and the full desktop test suite pass.

### 063: Pasted image normalization could send JPEG bytes with a stale PNG media type and make mixed image attachments fail

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32-hotfix.0
- Fixed: v0.1.32 development
- Created: 2026-07-20
- Resolution Date: 2026-07-20

#### Original Problem

A customer pasted one image from the OS clipboard, selected another image with
the file picker, and received an image-format error after sending both. Sending
the same turn with two file-picker images succeeded. The failure was especially
likely for large clipboard bitmaps exposed as PNG.

Expected behavior:

- Paste, drag/drop, and file-picker images can be mixed in one request.
- The media type sent to KodaX matches the bytes persisted by Space.
- SDK normalization from PNG or WebP to JPEG remains transparent to the user.

#### Root Cause

Space correctly called `normalizePastedImage` and chose the persisted file
extension from the normalized result. However, `clipboard.saveImage` returned
only the path and byte count. The renderer therefore retained the source
clipboard MIME type. When normalization changed a large PNG bitmap to JPEG,
Space sent JPEG bytes while declaring the artifact as `image/png`; the provider
could then reject or fail to decode it. KodaX SDK already returned the canonical
media type and supported multi-image PNG/JPEG input, so no SDK change was
required.

#### Resolution

- Make the `clipboard.saveImage` output contract require the final persisted
  `mediaType`.
- Return the canonical media type from the main-process normalization handler.
- Build pending and outgoing image artifacts from that returned type instead of
  the original renderer MIME type.
- Keep the original base64/MIME pair only for the local composer preview.

Files changed:

- `packages/space-ipc-schema/src/channels/clipboard.ts`
- `apps/desktop/electron/ipc/clipboard.ts`
- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `packages/space-ipc-schema/test/registry.test.ts`
- `apps/desktop/electron/test/clipboard-save-image.test.ts`

Verification:

- Handler regressions cover PNG output, PNG-to-JPEG normalization, and the
  normalization-failure WebP fallback.
- IPC schema regression rejects save responses that omit the final media type.
- Full schema and desktop test suites, renderer strict TypeScript checking, and
  the desktop production build pass.

### 064: Space ignored Runtime-issued concrete permission grants, so Always allow was absent or rejected

- Priority: Medium
- Status: Resolved
- Introduced: KodaX 0.7.73 adoption
- Fixed: v0.1.32 development
- Created: 2026-07-20
- Resolution Date: 2026-07-20

#### Original Problem

Coder Runtime permission dialogs showed only one-time execution and cancel, or
could submit an Always-allow response that the upgraded Runtime rejected. The
UI could not honestly tell the user which future operation would be remembered.

Expected behavior:

- Show Always allow only when Runtime offers a safe persistent candidate.
- Remember the exact normalized command/cwd/shell/background combination or
  the exact normalized tool/path scope, never an entire shell tool.
- Keep dangerous, dynamic-shell and unsupported generic calls one-time only.

#### Root Cause

KodaX 0.7.73 introduced Runtime-issued `grantSuggestions` with opaque IDs and
concrete matchers. Space ignored those suggestions and constructed the
deprecated broad `{ toolName, sessionId }` scope itself. That widened the
operator's intent and no longer matched the Runtime-issued candidate, so the
new SDK correctly rejected it.

#### Resolution

- Require the 0.7.73 Runtime, guardrail v3 and `permission:grant-admin` scope.
- Project only the bounded, redacted label of a Runtime persistent suggestion
  to the renderer; keep its opaque ID in Electron main.
- On approval, re-read the pending request and return exactly the Runtime-issued
  persistent suggestion ID. Fail closed if it is absent or expired.
- Hide Always allow when Runtime omits a persistent candidate or Space's
  independent risk assessment marks the command dangerous.
- Display Runtime grant labels in permission settings and add the new Qwen
  Token Plan provider metadata shipped by the same SDK update.

Verification:

- Projection/UI tests cover safe, session-only and dangerous requests.
- Adapter tests prove the opaque suggestion ID is returned unchanged and no
  response is sent without a persistent candidate.
- A real 0.7.73 Runtime probe creates an `exact-command` persistent grant for
  `npm test`; its matcher contains only a fingerprint, not the raw command.
- The npm-published 0.7.73 tarball (SHA-256
  `D7CF6F22F70FAEA192E9A5439AC98DF97B909F47A8062FF7764DA333D61F3330`)
  reuses that exact grant, offers no persistent candidate for dynamic
  PowerShell, and no longer authorizes concrete calls through matcherless
  legacy grants.
- Shared-daemon compatibility tests confirm guardrail v3 and grant-admin scope.

### 065: Project Files sidebar hides file extensions and keeps a stale directory tree

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32
- Created: 2026-07-21
- Fixed: v0.1.32 development
- Resolution Date: 2026-07-21

#### Original Problem

Current behavior:

- Every long file and directory name uses the same trailing ellipsis treatment.
- Long file names therefore hide the final extension, making similarly named Markdown, PDF, Office, and other files hard to distinguish.
- The Project Files tree loads only when the project changes. Expanded directories retain their first lazy-load result indefinitely.
- There is no visible refresh action; users must leave the panel and return to force a new tree instance.

Expected behavior:

- A truncated file name keeps the complete suffix after its final dot visible.
- A directory name may keep the conventional leading-name truncation because it has no file-type suffix.
- A visible refresh button reloads the root and every currently expanded directory without collapsing the user's navigation state.
- File-producing tool completions refresh promptly, while focus/visibility changes and bounded polling recover external filesystem changes.

Reproduction steps:

1. Open Project Files for a project containing several long, similarly prefixed file names with different extensions.
2. Observe that the narrow sidebar hides the extensions.
3. Create, rename, or remove a file while the panel remains open.
4. Observe that the tree and expanded-directory cache remain unchanged until leaving and reopening the panel.

#### Context

Affected components:

- `apps/desktop/renderer/src/features/code/FileTree.tsx`
- `apps/desktop/renderer/src/shell/popouts/FilesPanel.tsx`

#### Root Cause

`FileTreeNode` renders every node name through one Tailwind `truncate` span, without separating a file's basename from its extension. `FileTree` requests the root only from a project-change effect and lazy-loads each directory once into `childrenCache`; no refresh signal can invalidate or repopulate either data source.

#### Proposed Solution

- Add a pure label model that splits files at the final dot while leaving directories intact.
- Render the basename as the flexible truncated segment and the extension as the fixed trailing segment.
- Add a refresh token to `FileTree`; on change, reload the root and currently expanded directories while preserving expansion.
- Add a refresh control to Project Files and advance the token after relevant tool results, focus/visibility recovery, and a fallback interval.

#### Resolution

- Added a shared file-tree label model that keeps the complete suffix after the final dot visible while the basename truncates. Directories, dotfiles, and extensionless files retain the conventional leading-name treatment.
- Added a visible refresh button to Project Files. Refreshing reloads the root and all expanded directories without collapsing the tree, and generation guards prevent stale requests from overwriting newer results.
- Added automatic refresh after file-mutating tool results, on window focus or visibility recovery, and through a ten-second visible-panel fallback interval. Search results use the same refresh signal.

Files changed:

- `apps/desktop/renderer/src/features/code/fileTreeModel.ts`
- `apps/desktop/renderer/src/features/code/FileTree.tsx`
- `apps/desktop/renderer/src/shell/popouts/FilesPanel.tsx`
- `apps/desktop/electron/test/file-tree-model.test.ts`

Verification:

- File-tree model tests pass, including final-extension preservation and expanded-directory refresh planning.
- The focused file test suite passes (41 tests).
- Desktop renderer TypeScript, targeted ESLint and Prettier checks, and the production renderer build pass.

### 066: Changes panel displayed non-ASCII Git paths as octal escapes and could not open their diffs

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.4
- Created: 2026-07-21
- Fixed: v0.1.32 development
- Resolution Date: 2026-07-21

#### Original Problem

The Changes panel displayed Chinese file names as quoted octal escape sequences,
for example `"docs/\345\237\272...txt"`, instead of their actual names. The same
escaped text was retained as the file path, so selecting the entry could not load
the corresponding diff.

Expected behavior:

- Changes displays the exact repository-relative file name.
- Unicode paths and paths containing spaces remain valid inputs to file diff.
- Renames display and open the destination path.

#### Root Cause

`project.gitChanges` parsed the newline-delimited output of
`git status --porcelain=v1 -b` as if every path were literal. Git's default
`core.quotePath` behavior C-quotes non-ASCII bytes, while paths requiring quotes
also retain surrounding quote syntax. The renderer therefore received display
syntax rather than a filesystem path.

#### Resolution

- Request porcelain v1 with `-z`, Git's NUL-delimited machine format, so paths
  are emitted as raw UTF-8 without C-style quoting.
- Parse NUL-delimited records and consume the extra source-path record emitted
  for rename/copy entries while retaining the destination path.
- Keep the existing file-count, path-length, traversal, and NUL safety bounds.

Files changed:

- `apps/desktop/electron/ipc/project-git-changes.ts`
- `apps/desktop/electron/ipc/project.ts`
- `apps/desktop/electron/test/project-git-changes.test.ts`

Verification:

- Real Git repository regressions cover an untracked Chinese path containing
  spaces and a staged Chinese rename.
- Strict TypeScript, targeted ESLint, and Prettier checks pass.
- The previously failing Session test and the new Git regressions pass together
  after restoring the test environment's Node-native SQLite ABI.

### 067: Partner project-file rows select an attachment target but do not open the file viewer

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32
- Created: 2026-07-21
- Fixed: v0.1.32 development
- Resolution Date: 2026-07-21

#### Original Problem

Current behavior:

- Clicking a file in the Project Materials file tree at the bottom-left of Partner only changes the orange selection state.
- No file preview opens, so the row appears interactive but produces no visible result beyond selection.
- Users expect the same file-opening behavior as the expanded Project Files sidebar while retaining the ability to attach the selected path as a Partner source.

Expected behavior:

- Clicking a file selects it as the current Partner source target and opens it in the existing File Viewer.
- Directory clicks continue to expand or select directories without attempting to preview them as files.
- Existing source attachment behavior remains available after previewing.

Reproduction steps:

1. Open a project in Partner mode.
2. Expand the Project Materials file tree in the bottom-left panel.
3. Click a file such as Markdown, HTML, or DOCX.
4. Observe that the row becomes selected but the file viewer does not open.

#### Context

Affected components:

- `apps/desktop/renderer/src/features/partner/SourcesPanel.tsx`
- Shared File Viewer routing in `apps/desktop/renderer/src/lib/openPath.ts`

#### Root Cause

`SourcesPanel` provides `FileTree.onSelect`, but its callback only updates `selectedPath` and `selectedTargetKind` for the source-attachment flow. Unlike `FilesPanel`, it never invokes the shared File Viewer routing function.

#### Proposed Solution

- Define the Partner project-file activation contract as both selecting the attachment target and requesting a file preview.
- Reuse the existing File Viewer route for file nodes only.
- Preserve directory selection and source-attachment behavior unchanged.

#### Resolution

- Connected Partner project-file activation to the shared project File Viewer while retaining the existing source-target selection state.
- Kept directory activation unchanged, so directory rows still expand or become directory source targets without attempting file preview.
- Used the project-file preview route directly, ensuring project files are not confused with Partner's logical delivery namespace.

Files changed:

- `apps/desktop/renderer/src/features/partner/SourcesPanel.tsx`
- `apps/desktop/renderer/src/features/partner/partnerProjectFileActivation.ts`
- `apps/desktop/electron/test/partner-project-file-activation.test.ts`

Tests added:

- A regression test verifies that one Partner file activation performs both source selection and preview opening, in that order.

Verification:

- The focused regression test passes.
- Renderer and Electron TypeScript checks pass.
- Targeted ESLint and Prettier checks pass.
- The production renderer build passes.

### 068: Project HTML preview loses relative assets and hides sandbox/runtime failures that work in a browser

- Priority: High
- Status: Resolved
- Introduced: v0.1.32
- Created: 2026-07-21
- Fixed: v0.1.32 development
- Resolution Date: 2026-07-21

#### Original Problem

Current behavior:

- HTML that works in a normal browser can render an empty shell or partially styled page in
  Artifact/File Viewer.
- Relative scripts, styles, modules, media, local fetches and browser storage do not have the
  selected file's directory/origin semantics.
- Blocked network requests, resource failures and runtime exceptions usually leave no visible
  explanation, so a broken interaction looks like a rendering bug.

Expected behavior:

- Workspace HTML opened in File Viewer runs local web assets and ordinary browser-side
  interactions while remaining isolated from Electron and the rest of the filesystem.
- External network remains a deliberate user decision rather than an implicit privilege.
- Artifact HTML keeps its stricter generated-content trust model.
- Runtime/resource/policy failures appear inside the preview with enough information to act.

Reproduction steps:

1. Open a project HTML file that imports `./app.js` and `./style.css`, or fetches adjacent JSON.
2. Observe missing content, styling, controls, or animation in File Viewer.
3. Open the same file from its directory in a browser and observe the expected behavior.
4. Trigger a script or CSP failure and observe that File Viewer provides no actionable error.

#### Context

Affected components:

- `apps/desktop/electron/window/app-protocol.ts`
- `apps/desktop/electron/window/app-protocol-policy.ts`
- `apps/desktop/electron/ipc/files.ts`
- `apps/desktop/renderer/src/features/preview/FileViewer.tsx`
- `apps/desktop/renderer/src/features/artifact/renderers/HtmlArtifact.tsx`

#### Root Cause

Both surfaces reuse a single-document iframe renderer. Project files are copied into `srcdoc`
or posted into a fixed sandbox document, so relative URLs resolve against Space's sandbox
endpoint instead of the file directory. The restrictive CSP and opaque origin correctly block
undeclared network/storage behavior, but the File Viewer has no project-resource origin or
visible runtime diagnostics.

#### Proposed Solution

- Implement F133's bounded capability-scoped project preview origin.
- Keep network disabled by default and require an explicit trusted-page toggle.
- Preserve the stricter Artifact sandbox and add bounded diagnostics to both dynamic paths.

#### Resolution

- Added a typed File Viewer preview channel that creates an unguessable, expiring capability URL
  only after project allow-list and canonical path validation.
- Served project HTML and supported adjacent assets from a dedicated origin, enabling relative
  styles/scripts/modules, local fetch, storage, workers, controls and animation without exposing
  Electron, Node or Space IPC.
- Added a per-file network switch. Local-only mode is the default; enabled mode permits secure
  HTTPS/WSS resources while CSP, iframe sandboxing and navigation guards continue to block frames,
  popups, top navigation and project-scope escape.
- Preserved static Artifact HTML and the stricter opaque-origin interactive Artifact tier, and
  added bounded resource/runtime/CSP diagnostics to both dynamic preview paths.
- Added capability expiry/LRU limits, a 50 MB resource cap, sensitive-file/extension/method checks,
  symlink-escape protection, no-store responses and top-level-only preload bridge exposure.

Files changed:

- `apps/desktop/electron/window/project-web-preview.ts`
- `apps/desktop/electron/window/app-protocol.ts`
- `apps/desktop/electron/window/navigation-guards.ts`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/electron/ipc/files.ts`
- `apps/desktop/renderer/src/features/preview/ProjectWebPreview.tsx`
- `apps/desktop/renderer/src/features/preview/WebPreviewDiagnosticBanner.tsx`
- `apps/desktop/renderer/src/features/preview/FileViewer.tsx`
- `apps/desktop/renderer/src/features/artifact/renderers/HtmlArtifact.tsx`
- `packages/space-ipc-schema/src/channels/files.ts`

Tests added or extended:

- Capability creation/resolution, path/method/secret/extension/size/expiry/LRU/CSP/runtime policy.
- Child-frame navigation and preload-origin confinement.
- Diagnostic message validation, bounding and deduplication.
- A File Viewer interaction scenario for CSS, ES modules, JSON fetch, localStorage, workers and
  button behavior, including the absence of Space IPC and parent-DOM access.

Verification:

- 60 focused schema, sandbox, navigation, capability and diagnostics tests pass.
- Renderer and Electron TypeScript checks pass.
- Targeted ESLint, Prettier and `git diff --check` pass.
- The full production `build:smoke` passes.

- The Playwright trace reaches and passes every feature assertion; the pre-existing fixture
  `Close context` cleanup timeout occurs only afterward and is not a preview failure.

### 069: Coder daemon converted interrupt follow-ups into separate sequential after-turn runs

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32 development
- Created: 2026-07-21
- Resolution Date: 2026-07-21

#### Original Problem

Current behavior:

- Normal Enter and the composer send button request `queueMode: interrupt` while a Coder run is active.
- The daemon path ignored that requested mode and always called `runtime.runs.submitInput()` with `delivery: after_turn`.
- A prompt submitted during an active run therefore did not reach the next safe LLM boundary; it started only after the complete managed run terminated.
- Two queued prompts became two continuation runs with distinct run IDs and `sessionOrder` values, so the second prompt waited for the first continuation run to finish instead of entering the same next LLM call.

Expected behavior:

- Space preserves the delivery mode explicitly selected by the user.
- `interrupt` is never silently converted into `after_turn` because the modes have different timing and batching semantics.
- When the connected Runtime does not advertise or accept `interruptInput`, Space rejects the unsupported request with an actionable message and restores the composer input.
- Explicit Ctrl/Cmd+Enter after-turn submission remains supported.

Reproduction steps:

1. Start a Coder managed run through the shared daemon Runtime.
2. While the run is executing, submit two follow-up prompts with normal Enter.
3. Observe that both bubbles change to after-turn state.
4. Observe in Runtime events that each prompt creates a separate after-turn continuation run and starts only after its predecessor terminates.

#### Context

Affected components:

- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- KodaX Runtime `runs.submitInput()` and `interruptInput` capability

#### Root Cause

The v0.1.32 Coder daemon migration replaced the inline SDK `MessageQueue` path. KodaX 0.7.73 does not advertise `interruptInput`, but Space treated normal Enter as a best-effort request and unconditionally submitted it through the supported after-turn API. The acknowledgement truthfully updated the bubble label, but the main process had already changed the user's delivery intent. Each Runtime after-turn submission owns one continuation run, so immediate per-prompt submission also removed the inline queue's same-boundary batch drain behavior.

#### Resolution

- Preserve `queueMode` across the daemon boundary and map it directly to `delivery: interrupt | after_turn`.
- Remove the adapter's hard-coded interrupt rejection so the Runtime capability/result contract remains authoritative.
- Project `runtime.input.interrupt` from the daemon's actual `interruptInput` advertisement instead of always reporting it unavailable.
- Reject `unsupported_capability` for interrupt input with an actionable Ctrl/Cmd+Enter after-turn alternative; do not create work with altered delivery semantics.
- Fail closed if a Runtime ever reports an accepted delivery different from the requested delivery.
- Reuse the active run's credential and host-tool bindings for interrupt input; never attach continuation-run replacement bindings that KodaX correctly rejects.
- Keep explicit after-turn submission and the Partner/legacy inline queue unchanged.

SDK integration status:

- The local KodaX 0.7.74 source worktree now implements daemon `interruptInput`, FIFO same-boundary batching, queued/delivered status, and one ordered `run.input.delivered` event; its focused interrupt tests pass.
- The implementation is packaged locally as KodaX 0.7.74 and Space now pins that exact tarball
  integrity for validation. Registry publication remains pending, so a clean Registry-only install
  is intentionally blocked until the same artifact is published; the live Coder daemon must still
  be replaced after adoption.

Files changed:

- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/test/real-session-runtime-queue.test.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `docs/KNOWN_ISSUES.md`

Tests added or updated:

- Active daemon interrupt intent is preserved and unsupported capability is surfaced without after-turn downgrade.
- Explicit after-turn input remains accepted and returns the requested queue mode.
- Runtime adapter forwards interrupt delivery and returns the Runtime's factual capability result.
- Runtime adapter does not register or attach replacement credential/host-tool bindings for interrupt delivery and rejects explicit replacements locally.
- Runtime interrupt capability projection follows the advertised version and availability.

Verification:

- Focused Space queue and Runtime adapter suite: 43 passed, 0 failed.
- Focused KodaX interrupt/runtime-event/daemon suite: 12 passed, 0 failed.
- Electron TypeScript check passed.
- Targeted ESLint and Prettier checks plus `git diff --check` passed.

### 070: Large or dependency-backed HTML Artifacts can be misclassified as static and render blank or incomplete

- Priority: High
- Status: Resolved
- Introduced: v0.1.32
- Created: 2026-07-21
- Fixed: v0.1.32 development
- Resolution Date: 2026-07-21

#### Original Problem

Current behavior:

- HTML interaction detection inspects only the first 64,000 characters. Conventional documents
  place scripts near `</body>`, so a larger page can be classified as static even though its
  presentation depends on JavaScript.
- Legacy or bypassed Artifact metadata marked as `html` is trusted at render time and is not
  corrected from the actual content.
- Static classification disables the script that reveals content, constructs controls or starts
  animation, producing an empty or partial page even when the same file works in a browser.
- External authored scripts, CSS imports, blob workers and opaque-origin storage assumptions can
  create additional avoidable browser-compatibility failures.

Expected behavior:

- Interaction and remote display-dependency detection examines the complete bounded Artifact.
- Render-time classification recovers old or incorrect `html` metadata from the actual content.
- Authored browser presentation dependencies run inside the existing isolated Artifact sandbox
  whenever they do not require Electron, parent-page or unrestricted network privileges.
- Restrictions remain visible diagnostics rather than unexplained missing content.

Reproduction steps:

1. Create an HTML Artifact larger than 64,000 characters with reveal CSS near the beginning and
   its `<script>` near the end.
2. Open it as an Artifact and observe that it is rendered in the static, script-disabled tier.
3. Observe hidden sections, absent navigation controls and inactive animation.
4. Open the same document in a browser and observe the complete interactive presentation.

#### Context

Affected components:

- `packages/space-ipc-schema/src/channels/artifact.ts`
- `apps/desktop/renderer/src/features/artifact/toArtifactContent.ts`
- `apps/desktop/renderer/src/features/artifact/htmlSandbox.ts`
- `apps/desktop/renderer/src/features/artifact/renderers/HtmlArtifact.tsx`

#### Root Cause

The classifier's 64,000-character prefix optimization is smaller than the allowed 1 MB Artifact
content and misses normal end-of-body scripts. In addition, the renderer assumes stored kind
metadata is always current, while the sandbox compatibility policy handles passive resources but
not every authored script/worker/storage pattern needed to construct the visible page.

#### Proposed Solution

- Scan the complete bounded HTML value and recognize remote display dependencies.
- Reclassify legacy `html` payloads at render time.
- Expand only sandbox-contained compatibility capabilities: authored HTTPS script origins, blob
  workers and ephemeral storage; keep Electron/IPC, frames, top navigation and undeclared data
  connections blocked.
- Add large-document and compatibility regression coverage.

#### Resolution

- Removed the 64,000-character prefix classification limit. The complete schema-bounded Artifact
  is inspected, so ordinary end-of-body scripts and remote presentation dependencies select the
  compatibility renderer.
- Added render-time recovery for legacy or bypassed `html` metadata instead of trusting stale kind
  data that would disable required scripts.
- Expanded the opaque Artifact sandbox with authored HTTPS script origins, CSS `@import`, icons and
  preloaded media, blob workers, and in-memory `localStorage`/`sessionStorage` compatibility.
- Kept arbitrary connections, frames, Electron/IPC, parent access and child navigation blocked;
  runtime/resource/CSP failures remain visible diagnostics.
- Changed File Viewer local mode to allow only HTTPS display dependencies already authored into
  the document. General HTTPS/WSS requests remain behind the trusted-page toolbar control.

Files changed:

- `packages/space-ipc-schema/src/channels/artifact.ts`
- `apps/desktop/renderer/src/features/artifact/toArtifactContent.ts`
- `apps/desktop/renderer/src/features/artifact/htmlSandbox.ts`
- `apps/desktop/electron/window/project-web-preview.ts`
- `apps/desktop/electron/window/app-protocol.ts`
- `apps/desktop/renderer/src/features/preview/WebPreviewDiagnosticBanner.tsx`
- `apps/desktop/renderer/src/i18n/messages.ts`

Tests added or extended:

- Large end-of-body script and legacy metadata classification.
- Remote stylesheets, CSS imports, authored scripts and local-only File Viewer CSP behavior.
- Artifact storage/Blob Worker compatibility and File Viewer authored-resource interaction E2E.

Verification:

- 36 focused Artifact, File Viewer, CSP, navigation and schema tests pass.
- The supplied 69,682-character presentation renders 18 slides and 18 navigation controls in the
  Artifact sandbox with no runtime errors; ephemeral storage and a Blob Worker also complete.
- Renderer and Electron TypeScript checks, targeted ESLint, Prettier and `git diff --check` pass.
- The full production `build:smoke` passes.

### 071: Daemon compaction telemetry is dropped, so `/compact` appears frozen and context usage grows past a stale threshold

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Created: 2026-07-21
- Fixed: v0.1.32 development
- Resolution Date: 2026-07-21

#### Original Problem

Current behavior:

- `/compact` keeps the composer in a global busy/read-only state while the Runtime performs a
  potentially minute-long model summary, but Space does not show the command or compaction progress
  until the request returns.
- The context indicator hard-codes a 50% automatic-compaction threshold even when Runtime settings
  use another value such as 40%.
- The daemon event bridge drops main-run iteration token telemetry and automatic-compaction
  lifecycle/statistics events.
- Without authoritative telemetry, the indicator sums the complete visible transcript. Compacted
  history is intentionally retained for scrollback, so the displayed estimate continues to grow
  and can appear to exceed the configured threshold after a successful compaction.
- The Runtime persists manual compaction with the SDK-owned reason `automatic_compaction`, making
  manual and automatic provenance indistinguishable in stored metadata.

Expected behavior:

- Space shows `/compact` and an explicit in-progress state immediately without making the composer
  look hung.
- The indicator uses the effective Runtime compaction setting and current model context window.
- Main-run iteration and compaction statistics update the current-context count without deleting or
  miscounting retained transcript history.
- A completed compaction immediately shows its before/after token result and updated context usage.
- Space documents the remaining SDK provenance limitation instead of inferring an incorrect reason.

Reproduction steps:

1. Configure automatic compaction to 40% for a model with a 1,048,576-token context window.
2. Run a long daemon-backed Coder session, then execute `/compact`.
3. Observe that the composer becomes read-only with no immediate progress and remains that way while
   the compaction summary is generated.
4. After completion, observe a 50% / 524.3k threshold and a growing approximate usage such as 451k
   or 483k even though Runtime compaction statistics report a lower active context.

#### Context

Affected components:

- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/shell/ContextWindowIndicator.tsx`
- `apps/desktop/renderer/src/shell/ActivitySpinner.tsx`
- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `packages/space-ipc-schema/src/channels/provider.ts`
- KodaX Runtime compaction event and persisted-reason contracts

#### Root Cause

The v0.1.32 daemon bridge projects assistant, tool and run-lifecycle events but not
`run.progress` iteration telemetry or `context.compaction.*` events. The renderer therefore falls
back to a transcript-size estimate that cannot account for the Runtime's compacted active message
set. Independently, the context indicator retained an old 50% UI constant and the slash-command
path waits synchronously with no immediate command echo or progress state. KodaX SDK 0.7.73's
imperative compact API does perform the compaction, but its persisted compaction anchor hard-codes
the automatic reason and does not accept a caller reason.

#### Proposed Solution

- Bridge validated main-run iteration and compaction lifecycle/statistics events to renderer session
  events.
- Update the per-session token table from both iteration completion and compaction statistics, then
  make the indicator consume that table rather than rescanning retained transcript history.
- Resolve the context window and automatic threshold from the effective Runtime compaction config;
  refresh the indicator when settings change.
- Echo `/compact` immediately, surface the compaction lifecycle, and allow composing the next prompt
  while sending remains disabled until the operation safely completes.
- Add focused event-bridge, store, threshold and activity-state regressions.

#### Resolution

- Project daemon main-run iteration telemetry and the complete compaction lifecycle into validated
  renderer session events.
- Treat iteration completion and `compact_stats.tokensAfter` as authoritative per-session usage,
  including restoration from persisted compaction history instead of summing retained scrollback.
- Resolve the context window and automatic-compaction threshold from the effective Runtime config
  and refresh the indicator when the setting changes.
- Echo `/compact` immediately, keep an explicit animated `Compacting` state active, leave the
  composer editable for drafting, and disable sending or misleading cancellation until compaction
  completes.
- Report formatted before/after tokens and reduction percentage when manual compaction completes.
- Verified with 103 focused tests, desktop TypeScript checks, targeted ESLint and formatting/diff
  checks. KodaX SDK 0.7.73 still labels imperative compaction anchors as
  `automatic_compaction`; Space no longer relies on that value for live behavior.

### 072: E2E cleanup hangs until timeout because the isolated shared daemon keeps Electron test pipes open

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Created: 2026-07-21
- Resolved: 2026-07-21

#### Original Problem

Current behavior:

- Product assertions in Electron E2E scenarios complete successfully in about eight seconds, but
  `SpaceInstance.close()` remains inside Playwright's `ElectronApplication.close()` until the
  180-second test timeout.
- Each timed-out scenario leaves its isolated KodaX Coder daemon running under the temporary test
  data directory.
- Running several preview scenarios therefore appears to hang and accumulates orphan test daemons.

Expected behavior:

- Test cleanup terminates only the daemon whose descriptor belongs to that fixture's isolated test
  directory, closes Electron promptly, and removes the temporary data.
- Production shared daemons remain durable across normal Space restarts.

Reproduction steps:

1. Build the desktop app and run the File Viewer E2E scenario that opens a project file before the
   first Session.
2. Observe all UI assertions pass in the Playwright trace by about eight seconds.
3. Observe the final `Close context` action hang until the 180-second timeout while the daemon PID
   from the fixture's `runtime/daemon/coder/daemon.json` remains alive.

#### Context

Affected components:

- `tests/e2e/fixtures.ts`
- KodaX 0.7.73 shared-daemon test lifecycle
- All Playwright Electron scenarios using the default Runtime host

#### Root Cause

The production contract intentionally detaches from the shared daemon during Space shutdown. In
isolated Playwright runs, that daemon inherits the Electron launch pipes. Playwright waits for those
pipes while closing the Electron application, so the persistent test daemon prevents close from
settling even though the renderer assertions and main-process shutdown are complete.

#### Proposed Solution

- During fixture cleanup only, read and validate the daemon descriptor under the exact test data
  directory and terminate that PID before awaiting `ElectronApplication.close()`.
- Bound the close wait and retain a hard process fallback so cleanup cannot consume the entire test
  timeout.
- Add focused tests for descriptor validation and idempotent cleanup behavior.

#### Resolution

- Fixture cleanup validates the exact isolated test-data directory, daemon profile, and PID before
  signalling the test-owned process; production daemons are outside that ownership boundary.
- Electron close is bounded to ten seconds with a main-process fallback, so a failed cleanup cannot
  consume the complete Playwright timeout.
- Two focused lifecycle tests pass, and both four-scenario Artifact/File Viewer E2E suites now exit
  normally in under forty seconds.

### 073: Artifact HTML E2E scenarios focus Session-owned Artifacts before creating a Session

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Created: 2026-07-21
- Resolved: 2026-07-21

#### Original Problem

Current behavior:

- The new dynamic Artifact E2E scenarios launch an empty project and dispatch
  `kodax-space.focus-artifact` while `currentSessionId` is still null.
- Artifact is intentionally Session-scoped, so the right sidebar correctly remains on Overview and
  the tests time out looking for an iframe that was never mounted.
- The persistent-version scenario also writes under a synthetic file-preview Session id that the
  current Artifact surface does not own.

Expected behavior:

- Artifact runtime tests first create and activate a real Coder Session, then create/focus Artifacts
  under that exact Session id.
- The assertions exercise iframe scripts, controls, storage, workers, and version refresh rather
  than an invalid no-Session setup.

Reproduction steps:

1. Run `tests/e2e/artifact-html-runtime.spec.ts`.
2. Observe the right sidebar remain on Overview with no Artifact tab.
3. Observe all iframe locators fail because the test never established Artifact ownership.

#### Context

Affected components:

- `tests/e2e/artifact-html-runtime.spec.ts`
- Session-scoped Artifact test setup

#### Root Cause

The E2E fixture reused the no-Session File Viewer launch pattern even though File Viewer is
project-scoped and Artifact is Session-scoped. The test therefore violated the product's ownership
contract before reaching the HTML runtime behavior it intended to validate.

#### Proposed Solution

- Create a real Session through the composer during Artifact fixture setup.
- Return and reuse that Session id for persistent Artifact creation.
- Keep the no-Session behavior test exclusively in File Viewer coverage.

#### Resolution

- Artifact runtime setup now creates and activates a real Coder Session through the composer,
  dismisses any seed-run permission modal, and reuses the observed Session id for durable Artifact
  versions.
- No-Session coverage remains project-scoped in the File Viewer suite.
- All four Artifact HTML E2E scenarios pass.

### 074: Artifact bootstrap CSP blocks Blob workers that the in-document preview policy explicitly allows

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Created: 2026-07-21
- Resolved: 2026-07-21

#### Original Problem

Current behavior:

- An interactive HTML Artifact can render its markup while leaving script-driven presentation
  state hidden or incomplete when the page creates a Worker from a Blob URL.
- The preview diagnostic banner reports that `worker-src` was blocked even though the injected
  document policy explicitly contains `worker-src blob:`.

Expected behavior:

- Blob workers allowed by the restricted in-document policy run inside the opaque iframe without
  adding same-origin, Electron, parent-page, or undeclared network access.
- The outer bootstrap response and inner document CSP enforce compatible restrictions.

#### Root Cause

The Artifact bootstrap response did not declare `worker-src`. Its `script-src *` fallback does not
include the `blob:` scheme, so Chromium intersects that response policy with the injected document
policy and blocks the Worker before the page can finish initializing.

#### Proposed Solution

- Add the same narrow `worker-src blob:` capability to the bootstrap response CSP.
- Assert the outer policy in a focused regression and rerun the dynamic Artifact E2E scenarios.

#### Resolution

- The bootstrap response now declares `worker-src blob:`, matching the narrower inner document
  policy without granting same-origin access or additional network destinations.
- The focused CSP regression and all four dynamic Artifact E2E scenarios pass, including the large
  legacy presentation with storage fallback and a Blob Worker.

### 075: Runtime manual compaction duplicates canonical events and permits stale token projection

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Created: 2026-07-21
- Resolved: 2026-07-21

#### Original Problem

Current behavior:

- KodaX 0.7.74 emits context-owned compaction lifecycle events with stable context identity and
  revision, but Space discards unchanged outcomes and most of the canonical result metadata.
- `requestCompact` also synthesizes start/stats/end around the Runtime call. Those compatibility
  events can duplicate the SDK lifecycle and the synthetic stats have no context revision.
- A late iteration or duplicate compatibility event can therefore replace the authoritative
  post-compaction root token value, making the gauge appear to grow past the configured threshold.

Expected behavior:

- Runtime-backed compaction projects exactly one SDK-owned lifecycle, including committed and
  unchanged outcomes.
- Root token accounting is monotonic within the same context revision stream; child contexts and
  stale compatibility events cannot overwrite it.
- Embedded/legacy sessions retain their compatibility lifecycle.

#### Root Cause

Space treated the pre-0.7.74 callback projection and host-synthesized manual lifecycle as two
independent sources of truth. The renderer stored only token counts and did not use context identity
or revision to reject stale updates.

#### Solution Implemented

- Observe the Runtime session before invoking compaction and rely on its canonical lifecycle.
- Preserve the 0.7.74 finished-outcome metadata through validated IPC.
- Reject child/stale context observations in the root projection and keep legacy compatibility
  lifecycle events only for non-Runtime sessions.
- Reconstruct transcripts through the 0.7.74 page/chunk APIs so oversized observations never
  require the legacy monolithic payload.

Files changed:

- Runtime host/session adapter and validated session-event schema.
- Root context projection, compacting indicator, usage/cost selection, and settings copy.
- Runtime compatibility, telemetry, transcript paging, store, and spinner regressions.

Verification:

- Space IPC schema build passed.
- Focused Space compaction/telemetry/adapter/settings suite: 74 passed, 0 failed.
- Exact 0.7.74 Runtime compatibility check passed.
- Desktop TypeScript check and production smoke build passed.

### 076: Effective compaction threshold can be paired with a different fallback context window

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Created: 2026-07-21
- Resolved: 2026-07-21

#### Original Problem

Current behavior:

- The provider IPC can return KodaX 0.7.74's final effective compaction threshold calculated from
  the SDK fallback context window.
- When the provider does not advertise a context window, the renderer replaces that SDK fallback
  window with its model-name table but keeps the SDK-derived threshold.
- The context gauge can therefore combine, for example, a 1M displayed capacity with a threshold
  calculated from 200k, making the percentage and remaining-token explanation internally
  inconsistent.

Expected behavior:

- Whenever the SDK provides a final effective threshold, the displayed context capacity and the
  threshold use the same runtime-authoritative window.
- Older/error responses without the effective field retain the renderer's model-name fallback.

#### Root Cause

The renderer treated `source: fallback` as an unconditional reason to replace the IPC context
window. That was valid before the IPC exposed the final runtime policy, but it became invalid once
the effective threshold was calculated against the IPC window.

#### Proposed Solution

- Resolve the IPC response through one pure presentation helper.
- Keep the IPC context window together with its effective threshold as one atomic policy snapshot.
- Use the legacy renderer fallback only when no effective threshold is available.
- Cover provider, current fallback, and legacy fallback responses with focused regressions.

#### Resolution

- The provider IPC now exposes KodaX 0.7.74's final compaction threshold after percentage,
  absolute-token, and physical-capacity limits.
- The renderer treats that threshold and its SDK-resolved context window as one policy snapshot;
  only legacy/error responses continue to use the model-name fallback.
- Persisted and newly entered percentage values are normalized to the SDK's 15-90 range, so the
  setting, runtime, and indicator use the same effective value.

Verification:

- Focused context-window, settings, and user-config suite: 48 passed, 0 failed.
- Desktop and package TypeScript checks passed.
- Changed-file ESLint and production smoke build passed.
- Git whitespace validation passed.

### 077: Repacked KodaX 0.7.74 leaves the release lockfile with stale integrity

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-21
- Resolved: 2026-07-21

#### Original Problem

Current behavior:

- The rebuilt `kodax-ai-kodax-0.7.74.tgz` installs and reports version 0.7.74, but its SHA-512
  differs from the earlier package with the same version.
- `package-lock.json` still records the earlier tarball integrity while resolving the future npm
  Registry URL for 0.7.74.
- A clean install of the newly published tarball would reject it as not matching the lockfile.

Expected behavior:

- The lockfile integrity matches the exact 0.7.74 tarball intended for publication.
- The dependency remains a normal Registry dependency and does not capture a developer-machine
  `file:` path.

#### Root Cause

Repacking a version changes the tarball bytes and therefore its integrity digest. The local
`--no-save --package-lock=false` install correctly avoided recording an absolute path, but it also
left the previous package digest untouched.

#### Proposed Solution

- Replace only the KodaX 0.7.74 integrity value with the digest of the newly supplied tarball.
- Keep the version, Registry resolution, dependency metadata, and all other lock entries intact.
- Recheck the digest, focused compatibility suite, typecheck, and production build.

#### Resolution

- Replaced only the KodaX package integrity with the digest of the newly supplied 0.7.74 tgz.
- Preserved the Registry URL and avoided recording any local `file:` dependency.
- Verified the lock value byte-for-byte against the supplied tarball.

Verification:

- KodaX/Space compaction, daemon, transcript, settings, and telemetry suite: 116 passed, 0 failed.
- Package and desktop TypeScript checks passed.
- Production smoke build and Git whitespace validation passed.

### 078: History restore regression asserts the pre-canonical compaction token shape

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-21
- Resolved: 2026-07-21

#### Original Problem

Current behavior:

- The history-restore regression fails after restoring a persisted compaction notice even though
  the restored token count is correct.
- Its exact-object assertion predates canonical compaction outcomes and rejects the intentionally
  preserved `compactedFrom` and `lastCompaction` facts.
- Other current store regressions require those same facts for the gauge and compaction detail UI.

Expected behavior:

- History restoration preserves the canonical before/after/committed outcome.
- The regression verifies that complete contract instead of requiring metadata to be discarded.

#### Root Cause

The canonical compaction projection was added to both live events and persisted history, but this
one older exact-object assertion was not updated with the richer token-info contract.

#### Proposed Solution

- Update only the stale expected value to include the canonical restored compaction outcome.
- Rerun the spinner, store projection, and history restoration suites together.

#### Resolution

- The history-restore regression now verifies `compactedFrom` and the canonical committed
  before/after outcome already produced by the store.
- No production behavior was weakened or changed.

Verification:

- Spinner, Runtime store projection, and persisted-history suite: 36 passed, 0 failed.
- Changed-test ESLint and Git whitespace validation passed.

### 084: Daemon child-agent prose, thinking, and tools are merged into the parent transcript and live snapshot

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32 source with the post-0.7.74 KodaX Runtime source fix
- Created: 2026-07-22
- Resolution Date: 2026-07-22

#### Original Problem

Current behavior:

- During a daemon-backed Coder run, a parent assistant can emit one formal report paragraph,
  call `wait_agent`, and then appear to resume with another formal paragraph.
- The second paragraph can actually be a child agent's live `assistant.delta`. Child thinking and
  child tools can likewise appear between two parent-authored transcript segments.
- A refresh or reconnect can reproduce the same ownership error through the Runtime live
  observation snapshot even after the direct event bridge is corrected.

Expected behavior:

- The normal transcript and primary live draft contain only root-agent prose, thinking, tools,
  and Todo state.
- Child activity remains observable through bounded child/workflow activity surfaces and raw
  Runtime events, but it never appears as if the parent assistant authored it.
- Root events with `contextKind: root` continue to stream without suppression.

#### Session Evidence

The supplied screenshot and durable Runtime log show the ownership boundary directly:

- The parent emits `Artifact 文档已生成...现在等后台运营 SaaS 调研回来...` and starts the
  root `wait_agent` tool.
- The later `assistant.delta` beginning with `演进——用户定义目标...` carries
  `childAgentId: /root/backoffice-saas-research` and `liveOnly: true`.
- Space nevertheless projected that child delta as a normal root `text_delta`, so the renderer's
  correct tool boundary split made the ownership leak visible between two report sections.

#### Root Cause

KodaX raw Runtime events already carry child ownership through stable context identity,
`childAgentId`, workflow correlation, and the `liveOnly` rendering hint. The daemon Space adapter
flattened every assistant/thinking/tool/Todo event into the root `session.event` stream without
checking those fields. Its incremental live reducer repeated the same merge. Separately, KodaX's
Runtime observation reducer aggregated child events into the root-oriented `assistantTextByRun`,
`thinkingTextByRun`, `activeTools`, and Todo snapshot, losing ownership before Space could filter a
reconnect snapshot.

The renderer is not the cause: it correctly closes the current text bubble when a root tool starts.
The LLM is also not the cause: the leaked text was emitted by a different, explicitly identified
child context.

#### Resolution

- Extend Space's shared child-event predicate to recognize stable `contextKind: child` in addition
  to child identity and workflow correlation. Keep `liveOnly` as a non-authoritative rendering hint
  so it cannot hide a root event by itself.
- Filter child assistant, thinking, tool, and Todo events in both the daemon transcript bridge and
  the incremental Space live reducer. Root events remain unchanged.
- Preserve workflow child observability by routing discrete child tool start/result/end facts to
  `workflow.activity`; high-volume child prose and thinking are not inserted into the transcript.
- Filter the same child-owned event classes before KodaX builds its atomic Runtime live
  observation projection, while retaining the attributed raw events for dedicated consumers.

Files changed:

- `apps/desktop/electron/kodax/workflow-activity.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/kodax/runtime/coder-daemon-projection.ts`
- `apps/desktop/electron/test/workflow-activity.test.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `apps/desktop/electron/test/coder-daemon-projection.test.ts`
- `../KodaX/src/sdk-runtime.ts`
- `../KodaX/src/sdk-runtime.test.ts`

Tests added or updated:

- Every supported child-ownership signal is recognized while root, unscoped, and `liveOnly`-only
  events remain visible.
- Child prose, thinking, tools, and Todo updates cannot enter the daemon root transcript bridge or
  Space primary live projection; root continuation still advances normally.
- Workflow child tool start/result/end facts remain available through the activity channel.
- Atomic KodaX observation snapshots retain root drafts/tools/Todo and exclude child-owned state
  across stable context, child identity, and workflow correlation inputs.

Verification:

- Focused Space Runtime bridge/projection/activity suite: 64 passed, 0 failed.
- Direct complete desktop Electron test command passed; three isolated orphan test daemons were
  identified by exact temporary profile and removed afterward.
- Focused KodaX Runtime observation/replay/tool suite: 5 passed, 0 failed.
- Space package/renderer/Electron TypeScript checks and KodaX package TypeScript build passed.
- Targeted Space ESLint and both-repository Git whitespace checks passed. KodaX does not currently
  provide an ESLint configuration.
- The complete 125-test KodaX `sdk-runtime` file exceeded the 304-second command limit without a
  reported assertion failure; it is recorded as timed out, not passed.

Distribution note:

- The Space-side streaming and incremental-projection guards are present in this source tree.
- The atomic reconnect-snapshot guard requires the next KodaX package synchronization after
  0.7.74. This fix intentionally does not republish or silently repack the already released version
  number while other KodaX release work is in progress.

## Summary

- Total: 79
- Open: 2
- Resolved: 77
- High: 43
- Medium: 28
- Low: 8
- Next to resolve: 043
