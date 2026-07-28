# Known Issues

Last Updated: 2026-07-28

> Historical issue details are preserved as investigation evidence. Resolved items older than 30 days move to [ISSUES_ARCHIVED.md](ISSUES_ARCHIVED.md) without losing their investigation record. The current published package baseline is v0.1.33; fixes marked `Fixed: v0.1.33` ship in that release. Start from the [documentation hub](README.md) for current behavior and status.

## Issue Index

| ID  | Priority | Status      | Title                                                                                                                    | Introduced                      | Created    |
| --- | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ---------- |
| 013 | High     | Resolved    | Restored KodaX sessions could pair assistant segments with the following user prompt after consecutive user messages     | v0.1.29                         | 2026-07-08 |
| 014 | Medium   | Resolved    | Session rename reverted after switching sessions because manual titles were not persisted outside memory                 | v0.1.29                         | 2026-07-08 |
| 015 | High     | Resolved    | Partner capability redesign drift allowed overly broad workspace delivery writes and stale output registry state         | v0.1.30                         | 2026-07-09 |
| 016 | High     | Resolved    | Partner helper VM exposed host constructors and allowed escape to Node process and unrestricted filesystem               | v0.1.30                         | 2026-07-10 |
| 017 | High     | Resolved    | Partner corrupted Unicode PDF output and could not read PDF or Office sources                                            | v0.1.30                         | 2026-07-10 |
| 018 | High     | Resolved    | Active queue watcher deleted Partner follow-up overlay before dequeue returned it                                        | v0.1.30                         | 2026-07-10 |
| 019 | High     | Resolved    | Partner KB could not search Chinese and could overwrite corrupt durable state                                            | v0.1.30                         | 2026-07-10 |
| 020 | High     | Resolved    | Partner file paths, writes, decoding, hashing, and durable stores had unsafe edge cases                                  | v0.1.30                         | 2026-07-10 |
| 021 | Medium   | Resolved    | Partner advertised unavailable SDK Skills and Outputs lacked an in-app delivery preview loop                             | v0.1.30                         | 2026-07-10 |
| 022 | Medium   | Open        | KodaX Runtime lacks a general per-invocation execution service for Partner helper migration                              | KodaX 0.7.66 adoption           | 2026-07-10 |
| 023 | Medium   | Resolved    | Composer file picker opened the project-directory dialog and could not select images or files                            | v0.1.30                         | 2026-07-11 |
| 024 | High     | Resolved    | ACP placeholder sessions consumed the 200-row Space history window and hid real project sessions                         | v0.1.30                         | 2026-07-11 |
| 025 | High     | Resolved    | KodaX ACP tests persist fixture sessions into the real user session/runtime directories                                  | KodaX 0.7.66                    | 2026-07-11 |
| 026 | High     | Resolved    | Space E2E test mode isolated app data but left the SDK session home pointed at the real user directory                   | v0.1.30                         | 2026-07-11 |
| 027 | High     | Resolved    | A global 200-session window let one busy project make other project histories appear empty                               | v0.1.30                         | 2026-07-11 |
| 028 | High     | Resolved    | External Agent event pagination could skip audit events after the first 512 entries                                      | v0.1.30                         | 2026-07-12 |
| 029 | High     | Resolved    | Renderer could supply a new opaque Agent identity to the Reference update path                                           | v0.1.30                         | 2026-07-12 |
| 030 | Medium   | Resolved    | Workflow external-target wrapper lost method receiver and did not always audit the resolved revision                     | v0.1.30                         | 2026-07-12 |
| 031 | High     | Resolved    | Packaged smoke still expected KodaX 0.7.66 after the 0.7.67 integration                                                  | v0.1.30                         | 2026-07-12 |
| 032 | High     | Resolved    | External Agent task IPC trusted renderer ownership and Task Dock could show/control stale cross-session tasks            | v0.1.30                         | 2026-07-12 |
| 033 | Low      | Resolved    | Project Session spinner remained visible over already-restored rows after switching surfaces                             | v0.1.30                         | 2026-07-12 |
| 034 | Medium   | Resolved    | Task Dock width presets drifted from responsive default, explicit half, and full-workspace behavior                      | v0.1.30                         | 2026-07-12 |
| 035 | Medium   | Resolved    | Project Session refresh rescanned the full history tree and made empty Coder/Partner scopes slow                         | v0.1.30                         | 2026-07-12 |
| 036 | Medium   | Resolved    | New Sessions ignored the provider/model most recently selected in the active Session                                     | v0.1.31                         | 2026-07-13 |
| 037 | Medium   | Resolved    | Partner output links lost their Delivery identity and were incorrectly resolved as project files                         | v0.1.31                         | 2026-07-14 |
| 038 | Medium   | Resolved    | File-backed Markdown opened in Artifact as raw Monaco source instead of a document reading preview                       | v0.1.31                         | 2026-07-14 |
| 039 | Medium   | Resolved    | Partner kept a duplicate collapsed-sidebar edge rail alongside the shared header toggle                                  | v0.1.31                         | 2026-07-14 |
| 040 | Low      | Resolved    | Adjacent command and thinking receipt chips render at different heights                                                  | v0.1.31                         | 2026-07-14 |
| 041 | Medium   | Resolved    | Every assistant text block in a user turn reuses the Query timestamp instead of its own output time                      | v0.1.31                         | 2026-07-14 |
| 042 | High     | Resolved    | Interactive HTML Artifact can show only its static shell and keep stale content after a new version                      | v0.1.31                         | 2026-07-14 |
| 043 | High     | Open        | Unsigned macOS releases repeatedly request the login password for Provider Keychain access                               | v0.1.4                          | 2026-07-14 |
| 044 | Low      | Resolved    | Windows portable executable icon can render as missing or inconsistently across shell sizes                              | v0.1.31                         | 2026-07-15 |
| 045 | Low      | Resolved    | New-conversation mode selectors append a confusing `next` suffix                                                         | v0.1.x                          | 2026-07-15 |
| 046 | High     | Resolved    | F121 live projection and daemon lease lifecycles could diverge across attached Space clients                             | v0.1.32 development             | 2026-07-15 |
| 047 | Low      | Resolved    | Long user queries consume excessive transcript height without an inline collapse control                                 | v0.1.x                          | 2026-07-16 |
| 048 | Low      | Resolved    | Legacy `tsx/esm` test registration corrupts CommonJS JSON imports from the KodaX SDK dependency graph                    | v0.1.x                          | 2026-07-17 |
| 049 | Medium   | Resolved    | Provider/model and mode changes rolled back before the first send because the daemon Session was not admitted            | v0.1.32 development             | 2026-07-17 |
| 050 | Medium   | Resolved    | Reference Agent continuation can remain `working` after `sendInput` until an explicit reconcile                          | KodaX 0.7.72                    | 2026-07-17 |
| 051 | Low      | Resolved    | Embedded Runtime omits the working `externalAgentAdmin` service from its public capability metadata                      | KodaX 0.7.72                    | 2026-07-17 |
| 052 | Medium   | Resolved    | Composer could send text before an asynchronously attached image entered the artifact payload                            | v0.1.9                          | 2026-07-17 |
| 053 | Medium   | Resolved    | Restored daemon runs rejected queued prompts because the composer requested unsupported interrupt delivery               | v0.1.32 development             | 2026-07-17 |
| 054 | High     | Resolved    | Daemon permission dialogs discarded command, directory, and operation context                                            | v0.1.31                         | 2026-07-17 |
| 055 | High     | Resolved    | Ark multimodal follow-ups rejected supported model routes during artifact preflight                                      | <= v0.1.31                      | 2026-07-17 |
| 056 | High     | Resolved    | Restored daemon Sessions lost Auto mode, exposed an unwired plan exit, and reset AskUser choices                         | v0.1.32 development             | 2026-07-17 |
| 057 | High     | Resolved    | Auto LLM sent an empty classifier model after daemon observation erased the provider default                             | v0.1.32 development             | 2026-07-19 |
| 058 | High     | Resolved    | Auto LLM diagnosis exposed a stale 8-second process while Space did not seed daemon classifier defaults                  | v0.1.32 development             | 2026-07-19 |
| 059 | Medium   | Resolved    | KodaX Runtime does not publish complete effective Auto LLM settings or timeout-phase telemetry                           | KodaX 0.7.72                    | 2026-07-19 |
| 060 | High     | Resolved    | Space restart during daemon run admission aborted the accepted Coder run and startup health failures did not reconnect   | v0.1.32 development             | 2026-07-20 |
| 061 | High     | Resolved    | No-Session File Viewer calls `artifact.previewFile` without legacy-required Session fields and cannot open project files | v0.1.32 development             | 2026-07-20 |
| 062 | Medium   | Resolved    | Composer sent renderer `file://` attachment links to the model instead of exact native filesystem paths                  | v0.1.30                         | 2026-07-20 |
| 063 | Medium   | Resolved    | Pasted image normalization could send JPEG bytes with a stale PNG media type and make mixed image attachments fail       | v0.1.32-hotfix.0                | 2026-07-20 |
| 064 | Medium   | Resolved    | Space ignored Runtime-issued concrete permission grants, so Always allow was absent or rejected                          | KodaX 0.7.73 adoption           | 2026-07-20 |
| 065 | Medium   | Resolved    | Project Files sidebar hides file extensions and keeps a stale directory tree                                             | v0.1.32                         | 2026-07-21 |
| 066 | Medium   | Resolved    | Changes panel displayed non-ASCII Git paths as octal escapes and could not open their diffs                              | v0.1.4                          | 2026-07-21 |
| 067 | Medium   | Resolved    | Partner project-file rows select an attachment target but do not open the file viewer                                    | v0.1.32                         | 2026-07-21 |
| 068 | High     | Resolved    | Project HTML preview loses relative assets and hides sandbox/runtime failures that work in a browser                     | v0.1.32                         | 2026-07-21 |
| 069 | High     | Resolved    | Coder daemon converted interrupt follow-ups into separate sequential after-turn runs                                     | v0.1.32 development             | 2026-07-21 |
| 070 | High     | Resolved    | Large or dependency-backed HTML Artifacts can be misclassified as static and render blank or incomplete                  | v0.1.32                         | 2026-07-21 |
| 071 | High     | Resolved    | Daemon compaction telemetry is dropped, so `/compact` appears frozen and context usage grows past a stale threshold      | v0.1.32 development             | 2026-07-21 |
| 072 | High     | Resolved    | E2E cleanup hangs until timeout because the isolated shared daemon keeps Electron test pipes open                        | v0.1.32 development             | 2026-07-21 |
| 073 | Medium   | Resolved    | Artifact HTML E2E scenarios focus Session-owned Artifacts before creating a Session                                      | v0.1.32 development             | 2026-07-21 |
| 074 | High     | Resolved    | Artifact bootstrap CSP blocks Blob workers that the in-document preview policy explicitly allows                         | v0.1.32 development             | 2026-07-21 |
| 075 | High     | Resolved    | Runtime manual compaction duplicates canonical events and permits stale token projection                                 | v0.1.32 development             | 2026-07-21 |
| 076 | High     | Resolved    | Effective compaction threshold can be paired with a different fallback context window                                    | v0.1.32 development             | 2026-07-21 |
| 077 | High     | Resolved    | Repacked KodaX 0.7.74 leaves the release lockfile with stale integrity                                                   | v0.1.32 development             | 2026-07-21 |
| 078 | Medium   | Resolved    | History restore regression asserts the pre-canonical compaction token shape                                              | v0.1.32 development             | 2026-07-21 |
| 079 | High     | Resolved    | Space compatibility gate did not prove the KodaX 0.7.74 Auto permission semantics                                        | v0.1.32 development             | 2026-07-21 |
| 080 | Medium   | Resolved    | One clipboard image can enter the composer twice through duplicate Web clipboard representations                         | v0.1.25                         | 2026-07-22 |
| 081 | Medium   | Resolved    | Project Files mode removes the persistent Settings row from the left sidebar                                             | v0.1.29                         | 2026-07-22 |
| 082 | Medium   | Resolved    | Consumed daemon interrupt prompt can remain as a duplicate queued bubble when Runtime appends a prompt overlay           | v0.1.32 development             | 2026-07-22 |
| 083 | High     | In Progress | Late accepted daemon interrupt can be terminalized without delivery when its Run finishes during finalization            | v0.1.32 development             | 2026-07-22 |
| 084 | High     | Resolved    | Daemon child-agent prose, thinking, and tools are merged into the parent transcript and live snapshot                    | v0.1.32 development             | 2026-07-22 |
| 085 | High     | Resolved    | Background Session prompts could block the visible Session while their sidebar owner remained hidden                     | v0.1.32 development             | 2026-07-23 |
| 086 | Medium   | Resolved    | Assistant/tool-leading restored history rendered a fabricated empty user message                                         | v0.1.x                          | 2026-07-23 |
| 087 | Medium   | Resolved    | Windows 10/11 taskbar could ignore the live Space window icon or reuse stale Portable identity                           | v0.1.x                          | 2026-07-23 |
| 088 | Medium   | Resolved    | Other KodaX instance indicator could route an unknown peer into a blank orphan Session                                   | v0.1.x                          | 2026-07-23 |
| 089 | High     | Resolved    | A same-version stale daemon could fail the required capability gate and leave Coder unusable                             | v0.1.32 development             | 2026-07-23 |
| 090 | Medium   | Resolved    | Closing the last Space window left the daemon running without a visible or controllable background surface               | v0.1.x                          | 2026-07-23 |
| 091 | Medium   | Resolved    | Ordinary Windows queries can flash several short-lived command windows from KodaX Runtime child processes                | KodaX 0.7.74 adoption           | 2026-07-23 |
| 092 | Medium   | Resolved    | Isolated Electron tests leaked Runtime client credentials into the OS keychain                                           | v0.1.32 development             | 2026-07-23 |
| 093 | Medium   | Resolved    | Artifact and File Viewer Markdown omitted Mermaid and document-local resource support                                    | v0.1.31                         | 2026-07-24 |
| 094 | Medium   | Resolved    | Failed interrupt bubble followed the transcript tail instead of staying at its failure-time position                     | v0.1.32 development             | 2026-07-24 |
| 095 | Medium   | Resolved    | Changes panel collapsed a fully untracked directory into one row and hid its individual files                            | v0.1.x                          | 2026-07-24 |
| 096 | Medium   | Resolved    | Linux CI lacked an OS keychain and silently projected Runtime A2A as hidden                                              | v0.1.32 development             | 2026-07-25 |
| 097 | Medium   | Resolved    | Successful document extraction forcibly terminated its Worker during Windows native-module cleanup                       | v0.1.32 development             | 2026-07-25 |
| 098 | Medium   | Resolved    | A narrow Windows viewport required two clicks to open the right-side Task Dock                                           | v0.1.32 development             | 2026-07-25 |
| 099 | Medium   | Resolved    | Clean Electron main builds omitted generated runtime icons and disabled the Windows tray                                 | v0.1.32 development             | 2026-07-25 |
| 100 | Medium   | Resolved    | Interactive HTML Artifact could accept its first click before document controls were initialized                         | v0.1.32 development             | 2026-07-25 |
| 101 | Medium   | Resolved    | Project HTML File Viewer could accept its first click before module controls were initialized                            | v0.1.32 development             | 2026-07-25 |
| 102 | Medium   | Resolved    | Partner PDF text Workers could unload an unused native Canvas module with a Windows access violation                     | v0.1.32 development             | 2026-07-25 |
| 103 | Medium   | Resolved    | Shared-daemon release probe started its event deadline before the peer performed its settings mutation                   | v0.1.32 development             | 2026-07-25 |
| 104 | Medium   | Resolved    | Interactive HTML could report ready before its out-of-process frame committed an interactive hit-test surface            | v0.1.32 development             | 2026-07-25 |
| 105 | Medium   | Resolved    | Space builtin skills disappeared from slash completion when the Coder daemon runtime was selected                        | v0.1.32                         | 2026-07-26 |
| 106 | Medium   | Resolved    | File Viewer fallback reported authorization-scope rejection as though an existing external file were missing             | v0.1.32                         | 2026-07-26 |
| 107 | Medium   | Resolved    | Context-window popover mixed physical capacity, automatic-compaction headroom, and reserved response capacity            | v0.1.32                         | 2026-07-26 |
| 108 | High     | Resolved    | Electron native-binding probe could report an incompatible better-sqlite3 ABI as healthy                                 | v0.1.32                         | 2026-07-26 |
| 109 | Medium   | Resolved    | Cross-Provider cache field semantics made a 25k Qwen input look like six ordinary tokens                                 | v0.1.32                         | 2026-07-26 |
| 110 | High     | Resolved    | Restored Session history can render one complete user/assistant turn twice                                               | v0.1.32                         | 2026-07-26 |
| 111 | Medium   | Resolved    | Latest-request input was labeled as a still-pending queue while zero context categories disappeared                      | v0.1.32                         | 2026-07-26 |
| 112 | High     | Resolved    | Windows PTY and Coder command tools could not find runtimes initialized by the user's shell                              | v0.1.x / KodaX 0.7.76           | 2026-07-27 |
| 113 | Medium   | Resolved    | Native child Agent lifecycle is not synchronized into Task Dock and right-sidebar status                                 | v0.1.32 / KodaX 0.7.72 adoption | 2026-07-27 |
| 114 | Medium   | Resolved    | Delivered mid-turn prompt could jump above the preceding interrupt response                                              | v0.1.32                         | 2026-07-27 |
| 115 | High     | Resolved    | Missing temporary clipboard images can permanently poison restored Provider runs                                         | v0.1.9                          | 2026-07-27 |
| 116 | High     | Resolved    | Completed daemon Session can remain stuck on Processing result in the renderer                                           | v0.1.32                         | 2026-07-27 |
| 117 | High     | Resolved    | Image attachment fails when the selected persisted Session has not been lazily resumed                                   | v0.1.32                         | 2026-07-27 |
| 118 | Medium   | In Progress | Space rejects large source images before KodaX can normalize them                                                        | v0.1.9                          | 2026-07-27 |
| 119 | Medium   | Resolved    | Restored history exposes overlapping internal compaction summaries as giant yellow notices                               | v0.1.x                          | 2026-07-27 |
| 120 | High     | Resolved    | Space custom Providers were invisible to the shared Coder daemon and failed as unknown Providers                         | v0.1.32                         | 2026-07-27 |
| 121 | Medium   | Resolved    | Custom Provider settings could not declare the endpoint context window                                                   | v0.1.x                          | 2026-07-27 |
| 122 | High     | Resolved    | Cumulative Runtime snapshots replayed streamed assistant output, thinking, and active tools in the renderer              | v0.1.33                         | 2026-07-27 |
| 123 | High     | Resolved    | Space ignored KodaX split integration files and replaced valuable SDK self-manual content                                | KodaX 0.7.77 adoption           | 2026-07-28 |

## Issue Details

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
- Status: In Progress
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
- Require Runtime capability `interruptInput: 1` during daemon connection, in addition to the minimum KodaX Runtime version 0.7.74, so an older daemon cannot silently satisfy the Coder host contract.
- Use the Runtime's per-submission `inputId` as the interrupt queue ID instead of the shared active `runId`, keeping multiple queued prompts independently addressable.
- Bridge the Runtime's ordered interrupt-delivery event into one ordered `mid_turn_user_prompt` session event per prompt, so daemon and inline UI history expose the same same-boundary consumption semantics.
- Keep explicit after-turn submission and the Partner/legacy inline queue unchanged.

SDK integration status:

- npm-published KodaX 0.7.74 implements daemon `interruptInput`, FIFO same-boundary batching,
  queued/delivered status, ordered delivery events, and durable delivery-event failure that leaves
  the input queued.
- Space's installed `@kodax-ai/kodax` matches all 133 files in the official Registry tarball, and
  the lockfile records the official SRI.
- The isolated packaged-daemon smoke test advertises `interruptInput` version 1 with `per_run`
  availability and accepts the Space 0.7.74 capability requirement.
- Registry-only installation is reproducible. A stale pre-0.7.74 daemon is rejected; the next
  Space launch starts or attaches to a compatible 0.7.74 owner.

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
- Multiple interrupt acknowledgements retain their unique Runtime `inputId` queue IDs even though they target the same active run.
- One Runtime FIFO delivery event is projected into distinct ordered session prompt events without dropping or merging prompts.

Verification:

- Focused Space queue and Runtime adapter suite: 44 passed, 0 failed.
- Broader Space queue/renderer/cancel regression suite: 99 passed, 0 failed.
- Focused KodaX interrupt/runtime-event/daemon/runner suite: 21 passed, 0 failed.
- Electron TypeScript check passed.
- Targeted ESLint and Prettier checks plus `git diff --check` passed.
- Package, renderer, and Electron main production build stages passed; the aggregate shell command reached successful completion output while its 60-second wrapper timed out at the boundary.

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

The first cleanup fix still had a shutdown race: it signalled the descriptor PID before closing
Electron, but the live Runtime client could observe that exit and finish an automatic reconnect
with a replacement daemon PID before the main process stopped. The fixture then deleted the
isolated profile, leaving the replacement process alive without its ownership descriptor.

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
- Cleanup now sweeps the validated descriptor before Electron shutdown and again with bounded
  retries after shutdown, closing any replacement PID created by an in-flight reconnect before the
  isolated profile is removed.
- Two focused lifecycle tests pass, and both four-scenario Artifact/File Viewer E2E suites now exit
  normally in under forty seconds.
- The v0.1.32 release review reproduced the late-replacement race in the full 68-scenario suite,
  captured the original and replacement PIDs, and then passed eight repeated daemon-starting
  Electron scenarios with no teardown timeout or new orphan process.

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

2026-07-23 same-version repack follow-up:

- The sub-Agent/runtime fixes produced another 0.7.74 tgz with a different digest, reproducing the
  same lock-integrity hazard without changing the dependency version.
- Space again changed only the KodaX lock integrity, now to
  `sha512-CMOyTJYb+sLLLpJc5eOPkc38fhIY2IMMDVf4tzveZUvVBOef26E0Enk35ktlVdhDHp+aWoOqlPRa3jhZf8ERYQ==`,
  and retained the Registry URL. The installed core runtime/agent artifacts match the supplied tgz.
- The compatibility gate now also requires compaction v3 and transcript paging/search so a later
  clean install cannot silently lose the refreshed exact-history contract.

2026-07-23 latest bugfix repack follow-up:

- A later same-version tgz changed the digest again while adding the exact compaction-checkpoint
  lineage closure, PowerShell bracket-path hardening, and the bounded non-empty REPL auto-resume
  export.
- Space reinstalled the package and again changed only the Registry-shaped lock integrity, now to
  `sha512-Q6ITpAEihQgGU+cM9D/bBwpQjPVHdkXwYQDv7icI1MbyLPN6Hv4/5MgusE4Xzw78RBR7ZJenysu7K9AGC95SuQ==`.
  The supplied tgz SHA256 is
  `9BE1AA4A2026A71D56D87E9C4895B10839AFC5AA679BDCB788E60C7E4E478F63`.
- Direct installed-package probes confirm the unchanged capability versions, PowerShell wildcard
  escalation versus `LiteralPath` exactness, and a 1000-item auto-resume scan that skips empty ACP
  placeholders. Registry publication of these exact bytes remains pending.

2026-07-23 official Registry publication closure:

- npm now publishes `@kodax-ai/kodax@0.7.74` as `latest`. Space reinstalled from the Registry URL
  rather than a sibling checkout or local tgz.
- The lockfile now records the official SRI
  `sha512-JgPE6ct9m5l2e9F5dQIYnNdoKaMIJF1gWnyUzUowAWFva4JksE0DScANNUHEdQYjoibXwBlcNgOIse5bAfRvGg==`;
  the official tarball SHA256 is
  `61D66EA31599A5FBFEA8E5779A4BC238933A1DC000005A04757DD69A1F98F2C6`.
- All 133 published files in `node_modules/@kodax-ai/kodax` match the Registry tarball
  byte-for-byte, and root/Desktop resolve one deduplicated 0.7.74 package graph.
- The official bytes additionally close full interactive resume restoration, per-Session
  last-action-wins Auto settings, imperative flat-history compaction reconciliation, and durable
  interrupt-delivery persistence failure. Registry-only reproducibility is no longer a release
  blocker.

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

### 079: Space compatibility gate did not prove the KodaX 0.7.74 Auto permission semantics

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32 with KodaX 0.7.74 release candidate
- Created: 2026-07-21
- Resolved: 2026-07-21

#### Original Problem

Space's published-package compatibility gate verified the SDK version, daemon ownership,
`runtimeAutoModeGuardrail: 3`, permission-grant scope, and settings transport, but it did not execute
the permission decisions that caused the reported dialogs. That left two regressions detectable
only after launching the desktop client:

- Auto[rules] could ask for confirmation for an ordinary `edit` inside the active workspace.
- Auto[LLM] with an empty inherited classifier model could call the Provider, receive a 400, route
  the failure through AskUser, count it toward circuit-breaker state, and eventually downgrade to
  rules.

The capability number alone was insufficient because the externally visible behavior changed
within guardrail v3 between KodaX 0.7.73 and 0.7.74.

#### Expected Behavior

- A fully modelled edit inside the workspace is allowed in rules mode without AskUser.
- An edit outside workspace and approved temporary boundaries still escalates and remains
  fail-closed when the user rejects it.
- A missing Auto LLM classifier model returns a local block before Provider lookup, never opens a
  permission dialog, does not mutate denial/circuit-breaker state, and does not change the engine.
- Space refuses to attach to a pre-0.7.74 daemon even if that daemon advertises guardrail v3.

#### Root Cause

The SDK previously had no complete deterministic Tier-2 permission-effect evaluator for modeled
workspace mutations, and the final classifier request path did not enforce a non-empty live model
before Provider resolution. Space had already delegated non-dangerous Auto decisions to the
Runtime-owned guardrail, so adding another host classifier would have duplicated authority and
introduced divergent security behavior. The missing Space protection was a semantic package gate,
not another permission owner.

#### Resolution

- Adopt the exact KodaX 0.7.74 candidate and require a daemon identity of at least 0.7.74 while
  retaining Runtime as the single Coder Auto permission owner.
- Keep the Space broker's existing last-resort dangerous-command fence; ordinary Auto calls pass
  through once to the SDK guardrail and are not classified a second time.
- Add a black-box compatibility regression against the installed public `@kodax-ai/kodax/repl`
  entry. It proves workspace edit auto-allow, outside-boundary escalation, and missing-model local
  block with zero AskUser, denial, breaker, or engine-fallback side effects.
- Require the 0.7.74 interrupt-input capability in the same package/daemon gate so the installed
  Runtime contract and Space request surface cannot drift.
- Historical pre-publication step: distinguish the locally verified 0.7.74 candidate from the npm
  Registry, whose `latest` version was still 0.7.73 at that checkpoint.

Publication follow-up: npm `latest` is now 0.7.74, the official Registry package passes the same
semantic probes, and current documentation now treats the candidate distinction above as historical.

Verification:

- Installed Space package reports 0.7.74 and its reviewed runtime artifacts match the supplied
  `kodax-ai-kodax-0.7.74.tgz` hashes.
- KodaX permission/Auto regressions passed: 323 passed, 1 skipped; Runtime ownership and
  missing-model regressions passed: 5 passed; TypeScript project build passed.
- Space's new installed-package Auto semantics test passes, and the existing Runtime Worker and
  process-distinct daemon compatibility probes continue to pass.
- KodaX's full repository test command exceeded the five-minute review timeout without reporting an
  assertion failure; this is not treated as a substitute for the focused passing gates above.

### 080: One clipboard image can enter the composer twice through duplicate Web clipboard representations

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.25
- Fixed: v0.1.32
- Created: 2026-07-22
- Resolution Date: 2026-07-22

#### Original Problem

Current behavior:

- Copying one image to the OS clipboard and pasting it into the composer can display two identical
  pending-image cards.
- Sending without removing one card submits two image artifacts, so this is duplicate attachment
  ingestion rather than a visual-only rendering problem.

Expected behavior:

- One clipboard image creates exactly one pending image and one outgoing artifact.
- Pasting several distinct images at once remains supported.
- Clipboard implementations that expose images only through `DataTransfer.items` continue to work.

#### Root Cause

The composer merged image files from both `DataTransfer.files` and `DataTransfer.items`. Chromium
can expose the same clipboard bitmap through both collections while assigning different generated
names or timestamps. The metadata-based duplicate key therefore treated the two representations as
separate files, persisted both, and appended both to `pendingImages`.

#### Resolution

- Read clipboard images from one canonical representation: prefer `DataTransfer.files` when it
  contains images, otherwise fall back to `DataTransfer.items`.
- Preserve metadata-based duplicate filtering within the selected representation and preserve
  multiple distinct images from one paste.
- Keep native clipboard fallback and SDK image normalization unchanged; duplication is removed in
  the renderer before either path creates outgoing artifacts.

Files changed:

- `apps/desktop/renderer/src/shell/attachmentFiles.ts`
- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `apps/desktop/electron/test/attachment-files.test.ts`

Tests added:

- Duplicate `files` / `items` representations with different generated metadata produce one image.
- An empty `files` collection falls back to `items`.
- Multiple images in the canonical `files` collection remain intact.

Verification:

- Focused attachment and clipboard suite: 33 passed, 0 failed.
- Electron and renderer TypeScript checks passed.
- Targeted ESLint and Prettier checks passed.

### 081: Project Files mode removes the persistent Settings row from the left sidebar

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.29
- Fixed: v0.1.32
- Created: 2026-07-22
- Resolution Date: 2026-07-22

#### Original Problem

Current behavior:

- Opening Project Files from the left sidebar replaces the entire navigation sidebar with
  `FilesPanel`.
- The KodaX Space / Settings footer belongs to `LeftSidebar`, so it disappears together with the
  navigation content and cannot be reached from the bottom of the files view.

Expected behavior:

- The application footer and Settings button remain fixed at the bottom of the left sidebar in
  both navigation and Project Files modes.
- The files tree remains independently scrollable above the persistent footer.
- Clicking Settings from either mode opens the same unified Settings modal.

#### Root Cause

`Shell` switched between two complete sidebar components. `LeftSidebar` rendered and owned its own
Settings footer/modal, while the sidebar variant of `FilesPanel` had no footer. Switching content
modes therefore unmounted the only Settings entry instead of changing only the sidebar body.

#### Resolution

- Extract the KodaX Space / Settings row into a shared `SidebarFooter` component.
- Render the shared footer from both `LeftSidebar` and sidebar-mode `FilesPanel`, including the
  no-project fallback.
- Route both buttons through `Shell.openSettingsAt('preferences')` so content modes share one modal
  owner and one settings-opening path.

Files changed:

- `apps/desktop/renderer/src/shell/SidebarFooter.tsx`
- `apps/desktop/renderer/src/shell/LeftSidebar.tsx`
- `apps/desktop/renderer/src/shell/popouts/FilesPanel.tsx`
- `apps/desktop/renderer/src/shell/Shell.tsx`
- `tests/e2e/settings-modal.spec.ts`

Tests added or updated:

- Project Files mode keeps the Settings footer visible and opens the Settings modal.
- The existing navigation-sidebar Settings flow continues to open, interact with, and close the
  same modal.

Verification:

- New Project Files sidebar Settings Electron E2E: 1 passed, 0 failed.
- Existing navigation-sidebar Settings Electron E2E: 1 passed, 0 failed.
- Package, renderer, and Electron main smoke build passed.
- Renderer and Electron TypeScript checks passed.
- Targeted ESLint, Prettier, and Git whitespace checks passed.

### 082: Consumed daemon interrupt prompt can remain as a duplicate queued bubble when Runtime appends a prompt overlay

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-22
- Resolution Date: 2026-07-22

#### Original Problem

Current behavior:

- A Coder follow-up submitted once during an active daemon run can appear twice in the
  transcript: once as a normal user bubble already consumed by the LLM and once as an interrupt
  queued bubble still waiting for a safe insertion point.
- The duplicate is especially reproducible when the prompt contains a project-file reference.
- The Runtime accepts and delivers only one input; this is a renderer queue-overlay lifecycle
  error rather than a duplicate model submission.
- The stale queued bubble remains visible even after the run reaches `completed`, despite the
  assistant response showing that the follow-up was processed.

Expected behavior:

- Runtime consumption promotes exactly one queued bubble into one normal user bubble.
- The consumed queue overlay disappears even when the Runtime input includes an internal
  attachment or Partner prompt overlay.
- Multiple interrupt prompts consumed in one batch remain independently and deterministically
  addressable.

Reproduction steps:

1. Start a Coder daemon run.
2. While it is working, submit one interrupt follow-up that references a project file.
3. Wait for the Runtime to deliver the input at the next safe boundary.
4. Observe the normal user bubble and the stale queued copy at the same time.

#### Context

Affected components:

- `packages/space-ipc-schema/src/channels/session.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/renderer/src/store/appStore.ts`
- Runtime `run.input.delivered` and `mid_turn_user_messages` delivery events

#### Root Cause

The daemon appends a host-only prompt overlay to queued text before submitting it to Runtime. The
renderer stores only the user-visible prompt, while Space bridged the Runtime's
`mid_turn_user_messages` progress mirror with the expanded text. Queue consumption therefore missed
the exact content match, created a new normal user bubble, and left the original queued overlay
untouched through run completion. Space ignored the preceding canonical `run.input.delivered` event,
which carries the public per-input ID returned by `submitInput` and the ordered delivered inputs.

#### Resolution

- Project canonical `run.input.delivered` batches into one ordered `mid_turn_user_prompt` event per
  delivered input, carrying Runtime's public `inputId` as the queue ID.
- Stop projecting the immediately following `mid_turn_user_messages` progress mirror, preventing
  one Runtime delivery from creating two transcript boundaries.
- Reconcile renderer queue overlays by queue ID first and use content only for legacy or pre-ACK
  races. The fallback recognizes the exact `\n\n` host-overlay boundary and promotes the original
  visible content rather than the internal expanded prompt.
- Keep the consumed overlay absent when the run later completes; legitimate undelivered queue
  entries are not indiscriminately cleared by terminal events.

Files changed:

- `packages/space-ipc-schema/src/channels/session.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `apps/desktop/electron/test/app-store-cancel-event.test.ts`
- `apps/desktop/electron/test/session-event-schema.test.ts`
- `packages/space-ipc-schema/test/session.test.ts`

Tests added or updated:

- Ordered delivered interrupts retain their distinct public input IDs and the progress mirror is
  not projected a second time.
- Identical visible prompts are consumed by exact queue ID without rendering an attachment overlay.
- Delivery before renderer ACK uses the bounded overlay-suffix fallback and remains cleared after
  `session_complete`.
- Session-event schema accepts bounded queue IDs on interrupt and after-turn boundaries.

Verification:

- Broader queue, Runtime bridge, transcript, spinner, and schema suite: 184 passed, 0 failed.
- Package, renderer, and Electron TypeScript checks passed.
- Targeted ESLint, Prettier, and Git whitespace validation passed.
- The production renderer/main `build:smoke` passed; Vite reported only the existing Monaco import and large-chunk warnings.

### 083: Late accepted daemon interrupt can be terminalized without delivery when its Run finishes during finalization

- Priority: High
- Status: In Progress
- Introduced: v0.1.32 development
- Prior Fix: v0.1.32 (incomplete)
- Fixed: KodaX source; pending npm package integration
- Created: 2026-07-22
- Resolution Date: Pending
- Reopened: 2026-07-24, 2026-07-25

#### Original Problem

Current behavior:

- Normal Enter submits a daemon follow-up with `delivery: interrupt` and the renderer shows it as
  “queued as interrupt input, waiting for a safe insertion point.”
- If the prompt arrives after the last Runner/LLM boundary but while the outer managed Run still
  reports `running`, Runtime accepts it and emits `run.input.queued`.
- The Run can then complete without emitting `run.input.delivered`. Runtime changes the accepted
  input from `queued` to `terminal` during terminal cleanup, removes its MessageQueue entry, and no
  continuation Run executes the content.
- Space projects only canonical delivery and the Run terminal event, so the yellow queue bubble
  remains indefinitely even though the underlying input can no longer be delivered.

Expected behavior:

- An interrupt acknowledged as accepted must not be silently discarded during normal Run
  completion.
- Runtime should either consume every accepted input at a final safe boundary or close interrupt
  admission before delivery is no longer possible and reject the submission factually.
- If a previously accepted input nevertheless becomes terminal without delivery, Runtime and
  Space must expose an explicit non-delivery outcome, remove the false pending state, and preserve
  the user's full prompt for retry. Space must not silently convert explicit interrupt intent into
  `after_turn` delivery.

Reproduction steps:

1. Start a daemon-backed Coder managed Run.
2. Wait until the assistant has emitted its final answer and the managed evaluator is completing,
   while the Run still appears active in Space.
3. Press normal Enter to submit an interrupt prompt.
4. Observe `run.input.queued`, followed by `run.completed` with the input state `terminal`, but no
   `run.input.delivered` and no model execution of the follow-up.
5. Observe that the renderer continues to show the yellow queued bubble after the Run completes.

#### Session Evidence

The supplied screenshot corresponds to Session
`s_94da7709-e1b0-4c28-b71c-fbb8376398a4`, Run `run_mrvjmqbi_ab0d3ca1`, and interrupt
`input_mrvjszqo_4d829093`:

- `2026-07-22T03:53:59.891Z`: final assistant stream ended.
- `2026-07-22T03:54:07.334Z`: managed-task status reported `phase: completed`.
- `2026-07-22T03:54:10.073Z`: Runtime accepted “演示文稿看起来就是感觉字体有点小” as a queued
  interrupt.
- `2026-07-22T03:54:11.513Z`: the Run completed 1.44 seconds later with that input in
  `state: terminal`.
- The durable Run log contains `run.input.queued` but no `run.input.delivered`, confirming that the
  prompt was not inserted into an LLM request and was not executed.

#### Context

Affected components:

- KodaX Runtime interrupt admission and terminal cleanup in `../KodaX/src/sdk-runtime.ts`
- Space daemon submission in `apps/desktop/electron/kodax/real-session.ts`
- Runtime event projection in `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- Renderer queued-message lifecycle in `apps/desktop/renderer/src/store/appStore.ts`

#### Root Cause

Runtime interrupt admission checks that the Run is active and has an Actor Session, but it does not
track whether that Actor can still reach another safe Runner boundary. During managed-task
finalization the outer Run remains `running` after the root Actor has produced its final output, so
`submitInput()` can return `accepted: true` for an interrupt with no remaining consumption point.

When the Run settles, `terminalizeQueuedInterruptInputs()` intentionally dequeues every unconsumed
message and changes its input record to `terminal` to prevent cross-Run leakage. The terminal status
does not carry a non-delivery reason or the full input, and Runtime emits no dedicated input-terminal
event. Space therefore cannot distinguish this terminalized interrupt through its current canonical
delivery bridge and leaves the renderer overlay pending.

Issue 082 does not resolve this path: that fix reconciles a queue overlay only after
`run.input.delivered` proves model consumption. This input has no delivery event to reconcile.

#### Proposed Solution

- Add an explicit Runtime interrupt-admission window tied to the Actor Runner lifecycle. Close it
  atomically before the last consumable boundary; accepted inputs already inside the window must be
  drained before normal completion.
- Reject late submissions with a factual retryable reason instead of accepting work that cannot be
  consumed.
- Add a canonical terminal/non-delivery event containing the public `inputId`, terminal reason, and
  retry semantics for cancellation, failure, recovery, and any residual race.
- Have Space reconcile that event by queue ID, remove the false pending overlay, and restore the
  original full prompt or present an explicit retry action without changing interrupt delivery to
  `after_turn` behind the user's back.
- Add a deterministic regression where an interrupt arrives between the final Actor boundary and
  normal Run completion, asserting that it is either delivered exactly once or rejected/restored,
  never accepted and silently discarded.

#### Detailed Fix Plan

| File                                                                                                                                                                                                                                         | Change Summary                                                                                                                                   | Expected Outcome                                                                                                  | Risks and Guardrails                                                                | Tests                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `../KodaX/src/sdk-runtime.ts`                                                                                                                                                                                                                | Close per-Run interrupt admission at the final managed/coding completion signal and return `interrupt_window_closed` before enqueue              | The reproduced late send fails synchronously and Space restores the composer through its existing send-error path | Never close on intermediate managed worker turns; never downgrade to `after_turn`   | KodaX managed/coding completion-window regressions   |
| `packages/space-ipc-schema/src/channels/session.ts`                                                                                                                                                                                          | Add a bounded queue-terminal event with public queue ID, preview, and terminal reason                                                            | Residual accepted races have a typed cross-process outcome                                                        | Bound identifiers/text; keep it distinct from delivered transcript boundaries       | Package schema tests                                 |
| `apps/desktop/electron/kodax/runtime-host-adapter.ts`                                                                                                                                                                                        | Project terminal interrupt records before the owning Run terminal event                                                                          | Every accepted-but-undelivered input reaches the renderer exactly by `inputId`                                    | Emit only `state: terminal`; do not treat delivered inputs as failures              | Runtime adapter ordering/dedup tests                 |
| `apps/desktop/renderer/src/store/appStore.ts`                                                                                                                                                                                                | Mark the matching queued item failed by ID, with content fallback only for pre-ACK races; preserve failure when ACK arrives late                 | No indefinite yellow queue and no false user transcript message                                                   | Do not clear unrelated identical prompts or overwrite failed state during ACK races | Store race and identical-content tests               |
| `apps/desktop/renderer/src/features/session/composeMessages.ts`, `apps/desktop/renderer/src/features/session/messages/bubbles.tsx`, `apps/desktop/renderer/src/shell/ConversationStreamV2.tsx`, `apps/desktop/renderer/src/i18n/messages.ts` | Render a retained, visibly failed prompt with a precise copy/retry instruction                                                                   | Full visible content remains recoverable without overwriting an unrelated composer draft                          | Keep ordinary pending/queued visuals unchanged                                      | Composition/type tests and build                     |
| Runtime/Space tests and issue docs                                                                                                                                                                                                           | Cover completion, cancellation/failure/interruption, event-before-ACK, ACK-before-event, identical prompts, schema bounds, and terminal ordering | Cross-layer behavior is deterministic and auditable                                                               | Preserve existing 069/082 regressions                                               | Focused suites, typecheck, lint, format, smoke build |

#### Resolution

Implemented a two-layer delivery guarantee without changing the user's requested queue mode:

- KodaX Runtime now tracks whether an active Run can still reach an interrupt boundary. Ordinary
  completion/error callbacks and the final managed-task `completed` status close admission before
  outer Run settlement. Late submissions return `interrupt_window_closed` before normalization or
  queue mutation; Space reports that the message was not sent, removes the optimistic bubble, and
  restores the original composer content and attachments.
- Terminal cleanup remains as a final cancellation/failure/restart/race guard. Space reads only
  `state: terminal` interrupt records from `run.completed`, `run.failed`, `run.cancelled`, and
  `run.interrupted`, derives a bounded `queued_user_prompt_failed` event, and emits it before the
  owning session terminal event. Already delivered inputs are ignored.
- Renderer reconciliation uses the public Runtime `inputId` first and bounded content-preview
  matching only when the terminal event wins the ACK race. A late ACK cannot revive a failed item,
  identical accepted prompts are not conflated, and a following cancellation event retains the
  actionable failure bubble.
- Failed prompts render as a red “Not delivered / 未送达” bubble with the full local prompt still
  visible and copyable plus an explicit copy-and-retry instruction. Existing yellow pending/queued
  states and canonical delivered transcript boundaries are unchanged.

Validation:

- KodaX: 3 completion/error admission regressions and 11 related Runtime queue lifecycle tests
  passed; the complete KodaX build and declaration bundle passed.
- Space IPC schema: 270 tests passed and the package build passed.
- Space desktop: 110 directly affected tests passed; the complete desktop test command passed.
- Space TypeScript, targeted ESLint, Git whitespace validation, and production `build:smoke`
  passed. Vite reported only the existing Monaco import and large-chunk warnings.

#### Reopened Regression Evidence

Session `s_b0569457-5ef4-4928-9c2c-451b77cbbe06`, Run
`run_mryp08yx_aa5e3c13`, and interrupt `input_mryp242m_38505cf8` exposed a deterministic
admission window that the prior fix did not cover:

- `2026-07-24T08:44:30.304Z`: the root assistant stream and iteration ended.
- `2026-07-24T08:44:30.324Z`: the managed task entered `verifying`.
- `2026-07-24T08:44:32.196Z`: Runtime accepted the interrupt and emitted
  `run.input.queued`.
- `2026-07-24T08:44:38.513Z`: the managed task finally emitted `phase: completed`, which is
  where the current Runtime closes `interruptInputOpen`.
- `2026-07-24T08:44:41.155Z`: `run.completed` terminalized the still-queued input without any
  `run.input.delivered` event.

The current Runtime guard closes interrupt admission only on managed-task `completed`, after the
last root Runner consumption boundary has already passed. The existing regression test submits
after the synthetic `completed` status and therefore misses the real `verifying`-phase window.
Runtime must bind admission to actual root Runner consumption availability, closing it while
verification/finalization has no root drain point and reopening it only when another root round
starts.

#### Regression Resolution

- Space now reads the authoritative managed-task phase from its daemon observation before
  submitting an interrupt.
- `verifying` and `completed` close Space interrupt admission locally and return the Runtime's
  factual `interrupt_window_closed` reason without calling `runtime.runs.submitInput()`.
- The existing RealSession rejection path tells the user that the message was not sent and can be
  retried after the Run finishes; Space does not silently alter interrupt delivery into after-turn.
- Added an adapter regression that emits the exact `verifying` phase, submits an interrupt, and
  proves Runtime never receives it.

#### Second Reopened Regression Evidence

Session `s_7f8b4e93-6e8b-477b-badb-d35ee174b61f`, Run
`run_ms0feppg_3030a1a4`, and interrupt `input_ms0ffc5r_85028678` proved that the
Space-side `verifying` fence was still not the owning fix:

- `2026-07-25T13:50:25.361Z`: Runtime accepted the interrupt while the final
  root no-tool LLM request was already in flight.
- `2026-07-25T13:50:34.253Z`: the Runner emitted `iteration_end` without
  another `beforeNextTurn` queue drain.
- `2026-07-25T13:50:40.109Z`: the managed task completed.
- `2026-07-25T13:50:40.821Z`: `run.completed` terminalized the queued input
  without a `run.input.delivered` event.

The managed Runner intentionally called `beforeNextTurn` only after tool-using
iterations. Its no-tool terminal branch returned before the queue drain. That
behavior is correct for the REPL, whose outer `runQueuedPromptSequence` owns a
fresh follow-up round, but incorrect for Runtime: Runtime had promised delivery
inside the active Run and has no REPL outer sequence. Ordinary coding had the
same ownership mismatch at its `hasQueuedFollowUp` terminal return.

#### Upstream Source Fix

- Runtime now injects a run-owned interrupt admission controller into coding
  execution.
- Managed Runner terminal candidates close admission synchronously, drain every
  already-accepted FIFO prompt, reserve a continuation turn at the iteration
  ceiling, and continue the same Run before Sidecar verification. Admission
  reopens only when a next model turn is guaranteed; managed idle-yield is such
  a boundary.
- Ordinary coding applies the same rule at no-tool, terminal-signal, and
  post-tool follow-up boundaries. It rotates Live Turn attribution for the
  queued prompt and commits the preceding assistant response before continuing
  after COMPLETE.
- Failure, cancellation, and terminal cleanup close admission before
  asynchronous teardown, so no newly accepted input can enter after the last
  consumable boundary.
- REPL behavior is unchanged because it does not opt into Runtime terminal
  continuation; its outer fresh-round queue owner remains authoritative.
- Deterministic tests cover the final no-tool request window, configured
  iteration ceiling, terminal tools, idle-yield wakeup, failure cleanup,
  stop-hook reanimation, COMPLETE transcript ordering, queued Live Turn
  rotation, Runtime admission bridge, and multimodal interrupt artifacts. The
  focused KodaX suite passes 280 tests with two existing todos; the isolated
  TypeScript project and full publish build pass.
- Space validation against that isolated KodaX build passes 52 Runtime
  adapter/queue tests, the complete TypeScript check, and the Electron main
  process build.

The source fix must be published in the next KodaX npm package and then pinned
by Space before the packaged desktop application can be marked resolved.

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
- The npm-published 0.7.74 package contains the atomic reconnect-snapshot guard together with the
  mailbox-driven wait, resumed-user-prompt, completion-delivery, root live-projection, exact
  checkpoint-lineage, PowerShell bracket-path, and non-empty auto-resume fixes. Space has
  synchronized the official Registry SRI and verified all 133 published files; Registry-only
  reproducibility is closed.

### 085: Background Session prompts could block the visible Session while their sidebar owner remained hidden

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-23
- Resolution Date: 2026-07-23

#### Original Problem

Permission and AskUser queues are intentionally durable and global so switching Sessions cannot
discard an unanswered request. The modal layer nevertheless rendered the first global queue item
without checking whether it belonged to the visible Session. A background Session could therefore
place a blocking dialog over an unrelated foreground conversation. At the same time, the bounded
sidebar list could omit that background Session, and a renderer/runtime frame race could let
`running` or `error` visually outrank the more actionable `awaiting_user` state.

#### Root Cause

Durable interaction ownership and modal presentation were treated as the same concern. The queue
needed to remain global, but the modal selector lacked a current-Session projection. Sidebar
attention ordering considered current-project grouping and recency but not unresolved human
interaction, while the status hook evaluated transient run state before waiting state.

#### Resolution

- Keep the complete permission and AskUser queues durable, but project only the active Session's
  requests into foreground modals.
- Make `awaiting_user` outrank transient running/error frames in the renderer status hook.
- Prioritize the current Session and then background Sessions awaiting human input before applying
  the sidebar cap; show high-salience waiting indicators and project-level waiting counts.
- Add deterministic routing tests proving background requests remain queued, switching Sessions
  reveals the correct modal, and unrelated requests are never consumed.

Files changed:

- `apps/desktop/renderer/src/features/session/sessionInteractionRouting.ts`
- `apps/desktop/renderer/src/features/session/SessionAwaitingIndicator.tsx`
- `apps/desktop/renderer/src/features/session/useSessionStatus.ts`
- `apps/desktop/renderer/src/features/ask-user/AskUserModal.tsx`
- `apps/desktop/renderer/src/features/permission/PermissionModal.tsx`
- `apps/desktop/renderer/src/shell/LeftSidebar.tsx`
- `apps/desktop/electron/test/session-interaction-routing.test.ts`

### 086: Assistant/tool-leading restored history rendered a fabricated empty user message

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.x
- Fixed: v0.1.32
- Created: 2026-07-23
- Resolution Date: 2026-07-23

#### Original Problem

When restored history began with an assistant segment or tool receipt, the transcript grouping
logic inserted an empty user message to establish turn alignment. The synthetic placeholder was
then rendered as a real blank user bubble, implying input that the user never sent.

#### Root Cause

One sentinel object served both as an internal grouping anchor and as visible transcript content.
The rendering path could not distinguish structural alignment from an authentic user message.

#### Resolution

- Use an explicit hidden-history anchor for grouping assistant/tool-leading history.
- Preserve turn alignment without rendering, copying, or exposing a fabricated user bubble.
- Cover restored assistant-leading and tool-leading histories in composition and replay tests.

Files changed:

- `apps/desktop/renderer/src/features/session/composeMessages.ts`
- `apps/desktop/electron/test/history-replay-no-popout.test.ts`

### 087: Windows 10/11 taskbar could ignore the live Space window icon or reuse stale Portable identity

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.x
- Fixed: v0.1.32
- Created: 2026-07-23
- Reopened: 2026-07-25
- Resolution Date: 2026-07-25

#### Original Problem

On Windows 11, the running KodaX Space window could display a blank generic
document icon in the taskbar even though Setup, Portable, and the unpacked
application executable contained the generated multi-size KodaX icon.

#### Root Cause

The package pipeline embedded `resources/icon.ico` into PE resources, but
`BrowserWindow` did not set an explicit native window icon. The ICO was also not
copied to a stable runtime path under `process.resourcesPath`. Windows shell
selection for a live custom-titlebar window can therefore fall back to a generic
window/document icon, especially on Portable and cache-sensitive paths.

#### Resolution

- Resolve one explicit Windows window-icon path for development and packaged
  execution.
- Pass that icon to the main and standalone Artifact `BrowserWindow` instances.
- Package the exact multi-size ICO at `resources/icon.ico` beside `app.asar`.
- Extend package smoke to compare the runtime ICO byte-for-byte and verify the
  unpacked application EXE as well as Setup/Portable contains the configured
  256px marker.
- Add deterministic path-resolution tests for development, packaged Windows,
  and non-Windows behavior.

#### Windows 10 Follow-Up

The first fix closed the generic-document fallback, but a Windows 10 Portable
candidate could still show Electron's atom in the taskbar while its tray icon,
`WM_SETICON` handles, outer Portable executable, and extracted inner executable
all showed the correct KodaX K.

The remaining cause was Windows taskbar identity rather than image generation.
The stable `ai.kodax.space` AppUserModelID matched a Start Menu shortcut whose
relaunch target was an old Portable extraction path under `%TEMP%`. That path no
longer existed. `BrowserWindow.icon` correctly set the native window icon, but
Space had not supplied window-level relaunch metadata, so the shell could prefer
the stale shortcut identity and fall back to Electron branding.

The follow-up resolution:

- Applies Electron `setAppDetails()` to both main and standalone Artifact
  windows with the exact AppUserModelID, relaunch icon, command, and display
  name.
- Uses electron-builder's `PORTABLE_EXECUTABLE_FILE` as the persistent Portable
  relaunch/icon source instead of the disposable extracted inner executable.
- Repairs an existing `KodaX Space.lnk` only when its target is missing, named
  exactly `KodaX Space.exe`, and located beneath the Windows temporary
  directory. Valid or arbitrary user shortcuts are never rewritten.
- Covers Portable, installed, development, non-Windows, and stale-shortcut
  boundaries with deterministic unit tests.
- Verified a freshly packaged Portable repaired the observed stale shortcut to
  the outer candidate executable; package smoke and packaged boot both passed
  with KodaX 0.7.75. The 0.7.76 final release checklist still retains a separate human
  taskbar observation because automated Windows capture returned unsupported
  API error `0x80004002` on this Windows 10 host.

Files changed:

- `apps/desktop/electron/window/window-icon.ts`
- `apps/desktop/electron/window/windows-taskbar-identity.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/artifact/artifact-window.ts`
- `apps/desktop/electron/test/window-icon.test.ts`
- `apps/desktop/electron/test/windows-taskbar-identity.test.ts`
- `electron-builder.yml`
- `scripts/smoke-pack.mjs`

### 088: Other KodaX instance indicator could route an unknown peer into a blank orphan Session

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.x
- Fixed: v0.1.32
- Created: 2026-07-23
- Resolution Date: 2026-07-23

#### Original Problem

The left sidebar labeled SDK-discovered peer processes as `Running`, used a
settings-like gear icon, and showed only the peer working-directory basename and
process age. This made the row look like Runtime health even though it actually
represented another KodaX CLI process or Space window. Clicking a peer whose
Session was absent from the current renderer's authoritative Session list wrote
the foreign ID into `currentSessionId` and opened an empty conversation.

#### Root Cause

Peer-process discovery status and local Session navigation were conflated. The
navigation path did not prove that a discovered peer Session was already known
to this renderer, while the label, icon, and missing ownership guidance did not
explain that work remained owned by another KodaX instance.

#### Resolution

- Rename the section to `Other KodaX instances` and explain that rows represent
  a CLI or another Space window, not Runtime health.
- Replace the gear with a monitor icon and retain the process-age signal.
- Open a peer Session only when its ID already exists in the renderer's
  authoritative Session list.
- Keep the current conversation selected for unknown or bootstrapping peers and
  show an explanatory toast directing the user to the owning instance.
- Add deterministic action-routing coverage for known, unknown, bootstrapping,
  and current peer Sessions.

Files changed:

- `apps/desktop/renderer/src/shell/LeftSidebar.tsx`
- `apps/desktop/renderer/src/shell/runningPeerAction.ts`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `apps/desktop/electron/test/running-peer-action.test.ts`

### 089: A same-version stale daemon could fail the required capability gate and leave Coder unusable

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-23
- Resolution Date: 2026-07-23

#### Original Problem

After a development or package refresh that retained the same KodaX SemVer, a
resident daemon could expose the previous capability surface. Space correctly
rejected the missing `contextCompaction` contract, but every subsequent send
failed and the user had no recovery path inside the application.

#### Root Cause

The compatibility gate treated the daemon's version as a useful diagnostic but
had no safe recovery path for the stricter case where the version matched and
the required capability did not. Restarting a daemon blindly was also unsafe
because another client, active run, queued turn, workflow, or pending interaction
might still own it.

#### Resolution

- Recognize the capability-upgrade diagnostic independently of SemVer.
- Preflight daemon ownership and work state before attempting recovery.
- Stop only an idle stale daemon through the public KodaX CLI, then reconnect
  through the normal bounded Runtime lifecycle.
- Preserve the daemon and report the blockers when another client or durable
  activity still owns it.
- Use the same fail-closed idle-stop helper for the tray's complete-exit action.

Files changed:

- `apps/desktop/electron/kodax/runtime-daemon-control.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/test/runtime-daemon-control.test.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`

Tests added:

- Idle same-version capability upgrade stops and reconnects.
- Active work or another client prevents automatic daemon shutdown.
- CLI output, timeout, non-zero exit, and malformed result paths fail closed.

### 090: Closing the last Space window left the daemon running without a visible or controllable background surface

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.x
- Fixed: v0.1.32
- Created: 2026-07-23
- Resolution Date: 2026-07-23

#### Original Problem

Closing KodaX Space removed the visible window while the shared daemon could
continue running. Windows users had no persistent explanation, no direct way to
reopen Space, and no trustworthy action for completely exiting both Space and
an otherwise idle daemon.

#### Root Cause

Window lifecycle, process lifecycle, and shared-daemon ownership were presented
as one implicit close action. Space neither owned a background tray surface nor
distinguished destroying the renderer, quitting only the client, and requesting
a safe daemon stop.

#### Resolution

- On Windows, the titlebar close destroys the `BrowserWindow` and renderer while
  retaining a lightweight Electron main process, tray, and Runtime connection.
- Tray click, a second launch, or app activation recreates the main window.
- The tray menu shows Runtime/task/other-client state and offers reopen, close
  window, quit Space while preserving Runtime, and complete exit.
- Complete exit stops the daemon only after the Space client disconnects and the
  daemon atomically confirms it is idle and unowned; otherwise Space offers only
  the safe preserve-Runtime exit.
- A first-close notification explains the background state, and tray creation
  failure falls back to normal app exit instead of leaving an invisible process.
- Guard delayed boot/retry callbacks against destroyed windows.

Files changed:

- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/window/background-tray-model.ts`
- `apps/desktop/electron/kodax/runtime-daemon-control.ts`
- `apps/desktop/electron/test/background-tray-model.test.ts`
- `apps/desktop/electron/test/runtime-daemon-control.test.ts`
- `tests/e2e/background-tray-lifecycle.spec.ts`
- `tests/e2e/fixtures.ts`
- `scripts/smoke-pack.mjs`

Tests added:

- Windows close destroys all windows without terminating the tray host.
- App activation recreates a usable main window.
- Window recreation emits no destroyed-WebContents rejection.
- Localized tray state/action presentation and safe daemon-stop parsing.

### 091: Ordinary Windows queries can flash several short-lived command windows from KodaX Runtime child processes

- Priority: Medium
- Status: Resolved
- Introduced: Upstream child-process paths predate KodaX 0.7.68; exposed consistently by the v0.1.32 shared-daemon host
- Fixed: KodaX 0.7.75 / KodaX Space v0.1.32
- Created: 2026-07-23
- Resolution Date: 2026-07-24

#### Original Problem

On Windows 10 and Windows 11, sending an ordinary Coder query can rapidly open
and close several command windows even when the user did not request a terminal
command. The flashes steal visual attention and make the desktop client feel
uncontrolled.

#### Context

Space's non-interactive child-process paths for daemon control, Git actions, and
approved dynamic context already pass `windowsHide: true`. Read-only inspection
of the installed `@kodax-ai/kodax@0.7.74` Runtime worker and matching KodaX
source found missing Windows-hide options in CLI provider probes/execution, ACP,
LSP, and project-memory Git discovery.

The relevant CLI spawn lines were introduced before 0.7.68 and are unchanged
between 0.7.68 and 0.7.74. Project-memory setup also resolves the Git remote
several times during one root query: prompt memory paths, memory identity, and
the control/learning stores each call the same unhidden `git config` discovery.
This matches the observed rapid sequence without assuming that an API-backed
query selected a CLI provider.

Space v0.1.31 used KodaX 0.7.68 in `embedded` + `inline` mode and explicitly did
not attach to a daemon. v0.1.32 moves Coder execution into the independently
hosted Node daemon, which makes the latent Windows GUI-host behavior consistently
visible. The Space architecture change is the exposure condition; the missing
child-process creation flags remain an upstream implementation defect.

Affected upstream paths include:

- `packages/llm/src/cli-events/command-utils.ts`
- `packages/llm/src/cli-events/executor.ts`
- `packages/llm/src/cli-events/acp-client.ts`
- `packages/coding/src/lsp/spawn.ts`
- `packages/agent/src/memory/paths.ts`

#### Resolution

- KodaX 0.7.75 centrally forces `windowsHide: true` for non-interactive
  `spawn`, `execFile`, `execFileSync`, `exec`, and `execSync` calls under a
  Windows GUI host while preserving explicit PTY behavior.
- Its release gates audit statically identifiable Runtime Worker child-process
  calls and exercise 20 ordinary packaged-host queries with a Win32
  console-visibility probe.
- Space pins only the official Registry package, raises its final release daemon
  minimum to 0.7.76, and keeps explicit editor, terminal, and PTY interaction unchanged.
- No KodaX source or installed package is patched inside the Space repository.

### 092: Isolated Electron tests leaked Runtime client credentials into the OS keychain

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-23
- Resolution Date: 2026-07-23

#### Original Problem

Every isolated Playwright or packaged-boot profile created a stable
`runtime_client_*` secret in the OS keychain. Fixture teardown deleted the
temporary filesystem profile but not the credential named by that profile.
Repeated Windows test runs accumulated hundreds of entries until Credential
Manager rejected another write, making an otherwise valid packaged candidate
fail Runtime startup with `OS keychain is required for the Runtime client
secret`.

#### Root Cause

Runtime identity intentionally fails closed when secure storage is unavailable,
but test-profile cleanup treated the keychain as outside the isolated profile.
Once the profile's `runtime-client-identity.json` was removed, the exact
credential owner evidence was also lost. Launch failures before a fixture
returned could additionally bypass its ordinary `close()` cleanup.

#### Resolution

- Before deleting an isolated profile, read its bounded Runtime identity and
  delete only the exact credential account named there.
- Accept only profiles below the OS temporary directory whose basename begins
  with `kodax-test-` or `kodax-space-boot-smoke-`.
- Accept only UUID-shaped `runtime_client_*` accounts and the fixed
  `kodax-space` service; production profile paths and provider accounts are
  rejected.
- Use the same cleanup path after successful runs, launch/readiness failures,
  and packaged boot smoke.
- Report the bounded Runtime initialization reason when packaged boot fails.
- Verify with unit tests and a focused three-application Electron run that
  Runtime credential and isolated-daemon counts remain unchanged.

#### Legacy Inventory

The fix prevents future growth; it does not guess ownership for credentials
whose temporary profile was already deleted. On the preparation workstation,
the full 69-test suite now leaves the count unchanged at `531` and leaves zero
test daemons. Release engineering must use a clean Windows account/runner or
record an explicit operational acceptance after a successful packaged
first-start. Unverifiable `runtime_client_*` entries must not be bulk-deleted.

Files changed:

- `scripts/runtime-test-credential-cleanup.mjs`
- `scripts/test/runtime-test-credential-cleanup.test.mjs`
- `tests/e2e/fixtures.ts`
- `e2e/boot-smoke-packaged.mjs`

### 093: Artifact and File Viewer Markdown omitted Mermaid and document-local resource support

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.31
- Fixed: v0.1.32
- Created: 2026-07-24
- Resolution Date: 2026-07-24

#### Original Problem

Markdown shown in Artifact or File Viewer left fenced Mermaid definitions as
plain code. The same document surface also lacked mathematical notation,
explicit-language syntax highlighting, heading anchors, and working
document-relative images or links. Invalid diagrams had no contained fallback,
and the renderer gallery accidentally exercised the separate conversation
Markdown component rather than the production Artifact renderer.

Expected behavior:

- Standard Mermaid fences render as diagrams without enabling authored scripts.
- Invalid diagrams preserve their source and do not discard the rest of the
  document.
- Workspace-backed Markdown resolves bounded local images and document links
  relative to the source file while preserving project-root scope checks.
- Math, GFM, code highlighting, copy controls, heading anchors, footnotes, and
  light/dark themes behave consistently in Artifact and File Viewer.
- Large or rapidly replaced documents cannot queue unbounded Mermaid/highlight
  work, and raw document-level HTML cannot navigate the preview.

#### Root Cause

`MarkdownArtifact` converted Micromark plus GFM output directly into a
script-disabled `srcdoc` iframe. It had no diagram/math/highlight enhancement
stage and received only content, so it could not resolve workspace resources.
The tests asserted a heading from the conversation renderer and therefore did
not exercise this capability gap.

#### Resolution

- Added KaTeX math, explicit-language highlighting, copy controls, stable
  heading IDs, localized Mermaid success/error/source states, and
  `securityLevel: strict` Mermaid rendering to inert SVG.
- Kept the iframe scriptless through sandbox and CSP, removed raw document-level
  navigation/embed elements before first paint, and verified inline event
  handlers cannot reach the parent.
- Propagated workspace source context through inline Artifact and File Viewer
  paths, resolved normalized relative paths defensively, embedded bounded local
  images through the existing scope-checked binary IPC, and routed relative
  links through the shared file opener.
- Reused one sanitized parse result, prevented stale enhanced documents from
  flashing after content changes, cancelled obsolete enhancement batches, and
  bounded image, highlight, Mermaid text, edge, and diagram counts.
- Replaced the stale gallery fixture with the production renderer and added
  browser/Electron coverage for Mermaid, invalid fallback, math, highlighting,
  footnotes, local resources, relative navigation, CSP isolation, and blocked
  meta-refresh navigation.

Files changed:

- `apps/desktop/renderer/src/features/artifact/renderers/MarkdownArtifact.tsx`
- `apps/desktop/renderer/src/features/artifact/renderers/markdownResources.ts`
- `apps/desktop/renderer/src/features/artifact/ArtifactView.tsx`
- `apps/desktop/renderer/src/features/artifact/artifactContent.ts`
- `apps/desktop/renderer/src/features/artifact/toArtifactContent.ts`
- `apps/desktop/renderer/src/features/preview/RichPreview.tsx`
- `apps/desktop/renderer/src/features/preview/TextFileViewer.tsx`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `apps/desktop/package.json`
- `package-lock.json`
- `apps/desktop/electron/test/rich-preview-utils.test.ts`
- `apps/desktop/electron/test/to-artifact-content.test.ts`
- `e2e/gallery/main.tsx`
- `e2e/artifact-renderers.mjs`
- `tests/e2e/artifact-file-preview.spec.ts`

Tests added:

- Path normalization and workspace/resource-context unit coverage.
- Standalone Chromium renderer gallery assertions.
- Production Electron File Viewer regression with no Session.

### 094: Failed interrupt bubble followed the transcript tail instead of staying at its failure-time position

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-24
- Resolution Date: 2026-07-24

#### Original Problem

Current behavior:

- When Runtime terminalized an accepted but undelivered interrupt, Space retained a red failed
  prompt bubble with the original text and retry guidance.
- `composeMessages()` appended every queued overlay after all canonical transcript messages and
  events, regardless of the overlay's `sentAt`.
- As later turns produced user, assistant, tool, or progress history, the old failed bubble kept
  moving to the transcript tail, occupied the active viewport, and appeared to belong to the
  current Run.

Expected behavior:

- A terminal failed prompt is historical evidence and must remain fixed at its original failure-time
  position before later user turns.
- Pending and accepted live queue overlays must retain their current tail placement so users still
  see immediate queue state beside the active Run.
- Pinning the failed bubble must not consume an assistant event segment or alter user-to-assistant
  turn pairing.

#### Context

Session `s_b0569457-5ef4-4928-9c2c-451b77cbbe06` showed failed interrupt
`input_mryp242m_38505cf8` below later work even though its local `sentAt` preceded the next user
turn. The red warning itself was clear; only its continually moving transcript position was wrong.

#### Root Cause

Queued overlays were deliberately kept outside the local-message merge so pending queue state always
rendered at the transcript tail. The same unconditional append path was reused after an overlay
became terminal `failed`, even though a failed item has stable time and no longer represents live
queue state.

#### Resolution

- Split queued overlays into terminal failed items and live pending/queued items.
- Merge only failed items into the existing timestamp-ordered local-message stream. Like local and
  workflow notices, they do not consume assistant event segments.
- Continue appending live pending/queued overlays after the composed transcript, preserving current
  active-queue behavior.
- Added a two-turn regression proving that a failed item between the turns stays before the later
  user and assistant messages.

Files changed:

- `apps/desktop/renderer/src/features/session/composeMessages.ts`
- `apps/desktop/electron/test/composeMessages.test.ts`
- `docs/KNOWN_ISSUES.md`

Validation:

- `node --test --import tsx/esm electron/test/composeMessages.test.ts` from `apps/desktop` passed:
  34/34.
- `npm run typecheck` passed.
- Targeted ESLint, Prettier, and Git whitespace validation passed.

### 095: Changes panel collapsed a fully untracked directory into one row and hid its individual files

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.x
- Fixed: v0.1.32
- Created: 2026-07-24
- Resolution Date: 2026-07-24

#### Original Problem

Current behavior:

- In a repository where the entire `docs/` directory was untracked, the right-side Changes panel
  showed one `docs` directory row and `.gitignore`, reporting only two changes.
- The real repository contained four independent untracked files under `docs/`, so users could not
  inspect or open those files from the Changes tree.

Expected behavior:

- The Changes panel must list every changed file, including each file inside a fully untracked
  directory.
- Directory nodes remain a visual grouping only; they must not replace the underlying file rows or
  reduce the displayed change count.

#### Context

The issue was reproduced against `C:\Works\GitWorks\KodaX-author\KodaX-Fabric`, where
`git status --short --untracked-files=all` reported `.gitignore` plus
`docs/HLD.md`, `docs/PRD.md`, `docs/ProductDraft.md`, and `docs/UI_DESIGN.md`, while Space displayed
only `.gitignore` and `docs/`.

#### Root Cause

`project.gitChanges` invoked `git status --porcelain=v1 -b -z` without an explicit untracked-file
mode. Git's default `normal` mode coalesces a wholly untracked directory into a single `docs/`
record. The parser and renderer then behaved correctly for the incomplete input they received.

#### Resolution

- Added `--untracked-files=all` to the NUL-delimited status command used by `project.gitChanges`.
- Preserved the existing Unicode-safe parser, rename handling, 200-row UI guard, and directory tree
  grouping.
- Added real temporary-repository regressions proving that four files in a wholly untracked
  `docs/` directory are returned as four individual `U` entries and that expansion still truncates
  the response at 200 files.

Files changed:

- `apps/desktop/electron/ipc/project-git-changes.ts`
- `apps/desktop/electron/test/project-git-changes.test.ts`
- `tests/e2e/right-sidebar-popouts.spec.ts`
- `docs/KNOWN_ISSUES.md`

Validation:

- `node --test --import tsx apps/desktop/electron/test/project-git-changes.test.ts` passed: 4/4.
- The focused Electron regression passed and displayed `Changes (5)`, a four-file expanded `docs`
  tree, and the independent root file.
- The exact KodaX-Fabric reproduction reports five untracked files with
  `git status --short --untracked-files=all`.
- Targeted Prettier validation passed.

### 096: Linux CI lacked an OS keychain and silently projected Runtime A2A as hidden

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-25
- Resolution Date: 2026-07-25

#### Original Problem

Current behavior:

- Ubuntu Electron E2E ran under Xvfb without a Secret Service session.
- Space requires an OS keychain for the stable Coder Runtime client secret, so Runtime initialization failed closed in that headless environment.
- `agent.external.status` discarded the Runtime query error and returned only the local Reference plane; Settings therefore showed `A2A ? hidden` without explaining that Runtime was unavailable.
- The original UI regression expected A2A to be hidden and allowed Linux CI to remain green without exercising the shared daemon. Raising the expectation to `A2A ? available` exposed the missing prerequisite.

Expected behavior:

- Cross-platform E2E must exercise the production OS-keychain boundary rather than weakening or bypassing it in test code.
- The A2A assertion must verify successful Runtime capability negotiation before inspecting the Settings presentation.
- If Runtime external-agent discovery fails, Settings must receive a bounded diagnostic instead of silently presenting a normal hidden capability.

#### Context

Affected components:

- `.github/workflows/ci.yml`
- `apps/desktop/electron/ipc/agent.ts`
- `tests/e2e/external-agent-reference.spec.ts`

The failure reproduced on all three retries of GitHub Actions Ubuntu job `89623483352`; the same source passed the full local Windows E2E suite because Windows Credential Manager was available.

#### Root Cause

The Linux CI job installed Xvfb and fonts but did not create a D-Bus Secret Service session. The strict Runtime identity store correctly refused the Provider keychain module's process-memory fallback. Independently, the external-agent status bridge used a broad catch that erased the Runtime initialization/query diagnostic and made unavailable Runtime state look like an ordinary adapter gate.

#### Resolution

- Install `gnome-keyring` and `libsecret` for Ubuntu CI, launch the Electron suite inside an isolated `dbus-run-session`, and unlock a temporary secrets component for the job lifetime.
- Keep the production Runtime identity contract unchanged: no plaintext file or process-memory exception was added.
- Project a bounded, path-sanitized Runtime snapshot error through `agent.external.status`, while retaining the full query exception in main-process diagnostics.
- Poll the status IPC before opening Settings and require negotiated A2A availability, so a missing Runtime prerequisite fails with the actual diagnostic instead of a static UI-text mismatch.

Files changed:

- `.github/workflows/ci.yml`
- `apps/desktop/electron/ipc/agent.ts`
- `tests/e2e/external-agent-reference.spec.ts`
- `CHANGELOG.md`
- `docs/KNOWN_ISSUES.md`
- `docs/ISSUES_ARCHIVED.md`

Validation:

- `npm run typecheck`, `npm run lint`, changed-file Prettier, YAML parse, and Git whitespace checks passed.
- Production renderer/main smoke build passed.
- Focused Windows Electron coverage passed 2/2 with the real Credential Manager, negotiated A2A, Reference Agent management, and Task Dock lifecycle.
- Ubuntu CI now owns the same production keychain requirement through an ephemeral gnome-keyring session; the final cross-platform result is recorded in the v0.1.32 release-readiness document.

### 097: Successful document extraction forcibly terminated its Worker during Windows native-module cleanup

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-25
- Resolution Date: 2026-07-25

#### Original Problem

Current behavior:

- The Windows unit job completed all visible Partner source assertions, then the Node test-file
  subprocess exited with native access violation `0xC0000005`.
- The failure was intermittent and occurred during process cleanup rather than while parsing or
  asserting PDF and Office extraction results.

Expected behavior:

- A Worker that has already returned a valid extraction result must be allowed to finish its own
  parser/native-module cleanup before the caller settles.
- Cancellation, hard deadlines, invalid responses, and early failures must retain bounded forced
  termination.
- A successful Worker that does not exit naturally must still be bounded by a short termination
  fallback.

#### Context

GitHub Actions Windows job `89626507302` exposed the failure after every visible test in
`partner-source-tool.test.ts` passed. The same source had passed earlier Windows jobs, identifying a
timing-sensitive teardown path rather than a deterministic extraction assertion failure.

#### Root Cause

`runPartnerSourceStructuredExtractionWorker()` called `worker.terminate()` immediately after
receiving a valid response. The production extraction Worker had already closed its message port
and was prepared to exit naturally, but immediate termination could interrupt PDF or Office
dependency teardown inside the Worker. On Windows that race could surface as a native access
violation in the test subprocess after all assertions completed.

#### Resolution

- Wait for a successful or structured-error Worker to exit naturally after its response.
- Settle the caller only after exit, preserving cleanup ordering.
- Retain immediate forced termination for cancellation, timeout, invalid protocol data, startup
  errors, and exit-before-response paths.
- Add a one-second grace fallback so a Worker cannot keep the operation alive indefinitely.
- Add a regression Worker that reports success, performs delayed cleanup, writes a marker, and
  closes its port; the extraction call must not resolve before that marker exists.

Files changed:

- `apps/desktop/electron/kodax/partner-source-extraction-runner.ts`
- `apps/desktop/electron/test/partner-source-tool.test.ts`
- `CHANGELOG.md`
- `docs/KNOWN_ISSUES.md`
- `docs/releases/v0.1.32-release-readiness.md`

Validation:

- Focused Partner source coverage passed 20/20.
- The focused test file passed five additional consecutive runs (100/100 assertions) without a
  teardown crash.
- TypeScript and targeted ESLint passed; full local and cross-platform CI results are recorded in
  the v0.1.32 release-readiness document.

### 098: A narrow Windows viewport required two clicks to open the right-side Task Dock

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-25
- Resolution Date: 2026-07-25

#### Original Problem

The first click on **Show right sidebar** could leave the right sidebar absent on a 1024x728 Windows
runner, while a second click opened it. Artifact and Changes E2E journeys then failed in their
common sidebar-opening helper before reaching their feature assertions.

#### Root Cause

The Windows runner clamped the requested BrowserWindow to the 1024-pixel display width. The first
manual click selected the 320-pixel default dock because no explicit open intent existed yet. With
the 260-pixel left sidebar and window chrome, the remaining center pane fell below the responsive
minimum and immediately hid the dock. The second click used the now-persisted open intent and
selected balanced mode, so it appeared.

#### Resolution

- Evaluate whether the default dock width fits the actual viewport and current left-sidebar intent.
- Select balanced mode on the first click when the default width cannot fit; preserve default mode
  on wider windows and explicit close semantics.
- Cover a 1024x728 first-click layout and verify the center and dock remain visible without overlap.
- Close the Electron fixture when Artifact setup fails so one assertion cannot cascade into Worker
  teardown timeouts.

Validation:

- New 1024x728 first-click Electron E2E: 1 passed.
- Representative Artifact and complete-untracked-directory Changes journeys: 2 passed.
- Combined sidebar, Artifact, Changes, and tray regression run: 4/4 passed.
- TypeScript, focused unit, smoke build, ESLint, Prettier, and Git whitespace checks passed.

### 099: Clean Electron main builds omitted generated runtime icons and disabled the Windows tray

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-25
- Resolution Date: 2026-07-25

#### Original Problem

The real Windows tray lifecycle E2E passed on the development workstation but failed in a clean
GitHub Actions checkout. Electron logged that it could not load `resources/icon.ico`; tray
initialization therefore failed, the documented fallback quit after closing the last window, and
Playwright subsequently reported a closed target.

#### Root Cause

`resources/icon.ico` and `resources/icon.png` are intentionally generated and ignored. Platform
release scripts generated them, but the shared Electron main build used by clean development,
smoke, and E2E builds did not. Local historical files masked the missing prerequisite.

#### Resolution

- Make runtime icon generation a prerequisite of the shared Electron main build.
- Remove duplicate generation from platform packaging commands; all build paths now share one
  source of truth.
- Keep the production tray lifecycle assertion unchanged so it continues to test real Electron
  Tray behavior.

Validation:

- Moving both generated icons aside and running the main build recreated their exact hashes.
- The original Windows tray lifecycle E2E passed 3/3.
- Combined sidebar, Artifact, Changes, and tray regression run passed 4/4.
- Smoke build, ESLint, Prettier, and Git whitespace checks passed.

### 100: Interactive HTML Artifact could accept its first click before document controls were initialized

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-25
- Resolution Date: 2026-07-25

#### Original Problem

The interactive HTML Artifact control journey intermittently failed on a slow Windows GitHub
runner. Playwright found and clicked the visible **Next** button, but the authored click handler did
not advance the presentation. The same scenario passed locally and the initial authored render
still completed, making the failure look like a lost first input rather than a script or sandbox
failure.

Expected behavior:

- Visible Artifact controls must not accept mouse or keyboard input until the authored document has
  completed synchronous parsing and installed its control handlers.
- The readiness boundary must be observable by product code and tests without arbitrary sleeps.

#### Root Cause

The Artifact bootstrap streams authored markup through `document.write()`. A button in the body can
be parsed and become visible before a script later in the document registers its event listeners.
The injected diagnostic runtime sent its existing `ready` message immediately from the document
head, and the parent diagnostic hook ignored that message. On a slower Windows runner, the first
click could therefore land in the interval between button creation and handler registration.
The first readiness fix also kept a plain boolean in React state. When an Artifact version changed,
the old `true` remained observable until a post-render effect reset it, and the reused iframe could
still deliver a late message from the preceding document. After that state race was closed, main CI
run `30144213761` proved a second boundary: React updated `data-ready` and removed
`pointer-events:none` together, but Chromium's cross-process iframe hit-test state could lag the DOM
attribute observed by Playwright. The click API returned successfully while the authored handler
still received no event.

#### Resolution

- Install a capture-phase gate inside the authored document before its markup parses. It blocks
  trusted pointer, keyboard, form, input, context-menu, and wheel events until the next event-loop
  task after `DOMContentLoaded`, then removes itself before sending `ready`.
- Project readiness into the Artifact iframe for keyboard focus without dynamically changing the
  parent iframe's pointer hit-testing.
- Store the exact ready document key instead of a reusable boolean, and key the iframe by its
  versioned URL so a preceding document and `contentWindow` cannot unlock its replacement.
- Make the Electron journey wait for the explicit product readiness contract before interacting;
  no timeout sleep or retry hides the race.

Validation:

- HTML sandbox unit coverage passes 10/10 and asserts the in-document gate, deferred readiness task,
  and gate removal.
- The affected control journey and Artifact version-refresh journey pass 20/20 local runs in a
  two-worker, zero-retry stress run shared with the deterministic Project Preview gate regression.
- TypeScript, focused ESLint, changed-file Prettier, Git whitespace checks, and the production
  renderer/main smoke build pass.
- Main CI run `30142397054` passed the affected Windows shard 1/2 with 30 passes and 6 intentional
  skips; the original control regression did not retry. Later Ubuntu runs reproduced the residual
  stale-document form. Main run `30144213761` then reproduced the residual parent hit-test race on
  Windows twice before its second retry passed. Candidate `343219db` moves the gate into the
  document; a retry-free main run remains the release gate.

### 101: Project HTML File Viewer could accept its first click before module controls were initialized

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-25
- Resolution Date: 2026-07-25

#### Original Problem

Main CI run `30142397054` concluded successfully, but its Ubuntu shard 1/2 needed a Playwright retry
for the Project HTML File Viewer journey. The page had already loaded styles, local fetch, storage,
Worker output, and an authored remote script; Playwright then clicked the visible **Advance**
button, but the state remained `waiting`. The retry passed, so the green workflow still contained a
real first-input flake.

Expected behavior:

- A Project HTML File Viewer must not accept input until its authored classic and module scripts
  have finished synchronous initialization.
- A green release gate must not depend on Playwright retries hiding a lost first click.

#### Root Cause

Project Preview already emitted the same typed `ready` diagnostic as interactive Artifacts, but its
injected runtime sent that message immediately from the document head. The renderer consumed only
diagnostic failures and left the iframe interactive. A body button could therefore appear before
the later `type="module"` script registered its click handler. The initial renderer fix then exposed
the same residual stale-state window: a new URL could render while the hook still projected the
preceding document's boolean `ready=true`, and React reused the iframe node. Binding state and
remounting removed that window, but parent-side `pointer-events` still required Chromium to update
the out-of-process iframe hit-test region. Main run `30144213761` observed `data-ready=true` before
that region converged, so the click completed without reaching the button.

#### Resolution

- Capture trusted input inside Project Preview from the injected head runtime until the next task
  after `DOMContentLoaded`, which waits for the authored module graph and all synchronous
  `DOMContentLoaded` listeners.
- Remove the capture gate before sending `ready`; keep keyboard focus gated in the parent without a
  dynamic iframe `pointer-events` transition.
- Bind readiness to the exact Preview URL and key the iframe by that URL, so switching revision or
  network policy immediately returns to not-ready and rejects messages from the prior
  `contentWindow`.
- Require the File Viewer Electron journey to observe that explicit readiness state before its first
  interaction.

Validation:

- Project Preview and HTML sandbox focused unit coverage passes 16/16.
- The full Project HTML File Viewer resource/isolation/click journey passes 10/10 consecutive local
  runs with two Electron workers and Playwright retries disabled. Every run holds an authored
  module response, proves a trusted pre-ready click is blocked, releases the module, and proves the
  first post-ready click succeeds.
- TypeScript, focused ESLint, changed-file Prettier, Git whitespace checks, and the production
  renderer/main smoke build pass.
- Main CI runs `30143508131` and `30143521566` finished green but respectively exposed two and one
  Ubuntu retries across this journey and the shared Artifact readiness path. Candidate `7449d695`
  bound both consumers to the exact document, but main run `30144213761` still recorded one Ubuntu
  Project retry and two Windows Artifact attempts before success. Candidate `343219db` removes the
  shared parent hit-test transition; a clean, retry-free main CI run remains the v0.1.32 release
  gate.

### 102: Partner PDF text Workers could unload an unused native Canvas module with a Windows access violation

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-25
- Resolution Date: 2026-07-25

#### Original Problem

Two Windows jobs for main commit `0988f81e` failed the complete unit suite after all preceding
Partner source assertions had passed. The `partner-source-tool.test.ts` child ended with unsigned
exit code `3221225477` (`0xC0000005`) instead of a JavaScript assertion or exception. The same tree
passed both Windows jobs in the immediately preceding run and passed locally, so a blind retry could
hide the native teardown fault.

Expected behavior:

- Repeated PDF text extraction in short-lived Worker isolates must not load native rendering code it
  never uses.
- Windows unit and release jobs must exit cleanly without relying on retrying an access violation.

#### Root Cause

Partner source extraction uses pdfjs only for `getTextContent()`, with font and image rendering
disabled. The imported `pdfjs-dist/legacy` Node build nevertheless loads `@napi-rs/canvas` eagerly
at module initialization to provide rendering globals. The earlier Worker lifecycle fix stopped
forcibly terminating successful isolates, but this unnecessary N-API module still had to unload when
each text Worker exited. Under Windows runner timing it could terminate the test child with
`0xC0000005`.

#### Resolution

- Use pdfjs's standard parser build inside the isolated Partner text Worker. It loads Canvas only if
  rendering actually requests one, while `getTextContent()` remains a pure-JavaScript path.
- Install the standard `Promise.withResolvers` capability inside the isolated Worker when the
  release runtime is Node 20; newer runtimes retain their native implementation.
- Keep the same pdfjs parser, PDF signature/page/size limits, structured locators, hard deadline,
  Worker memory limits, and natural-exit/termination lifecycle.
- Add a local type bridge to reuse the package's legacy-build declarations for the equivalent
  standard-build API.

Validation:

- A real Space-generated Unicode PDF extracts title and page text through the standard build without
  loading native Canvas.
- The full Partner source tool suite passes 10/10 consecutive runs after the change; the unchanged
  legacy path also passed 10/10 locally, confirming the CI fault is an intermittent native teardown
  race rather than an assertion failure.
- Complete `npm test`, typecheck, focused ESLint/Prettier, Git whitespace checks, and Electron main
  bundling pass.
- Focused coverage passes 21/21, including a regression that removes the host's native
  `Promise.withResolvers` and verifies the Node 20 capability polyfill.
- Two clean Windows main jobs and the four-platform release matrix remain the final proof.

### 103: Shared-daemon release probe started its event deadline before the peer performed its settings mutation

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-25
- Resolution Date: 2026-07-25

#### Original Problem

The first manual four-platform release dispatch `30145184829` passed Windows, Ubuntu, and macOS
arm64. Its macOS Intel job failed the published-package compatibility test with
`Space did not receive the peer settings event.` The remaining 1697 Desktop tests passed and the
same process-distinct daemon test passed on the other platforms.

Expected behavior:

- Slow runner startup, dependency loading, preflight, and daemon inspection must not consume the
  deadline intended to verify event delivery after a peer mutation.
- A missing live settings event must still fail within a bounded interval after the peer has
  confirmed the mutation.

#### Root Cause

The host probe created an eight-second rejection timer before it attached the observer, collected
the client and daemon baselines, launched the peer process, and loaded the published SDK in that
process. On a loaded macOS Intel runner those prerequisites could exceed eight seconds before the
peer called `updateSettingsVersioned()`. The already-rejected promise then reported an event failure
even though the event-delivery interval had not started.

This was a Space release-test timing defect, not evidence of a KodaX SDK or Sidecar event-delivery
failure.

#### Resolution

- Attach the live observer without starting an absolute startup timer.
- Run the process-distinct peer through its existing bounded timeout.
- Start a ten-second event-delivery deadline only after the peer has confirmed its settings
  mutation; an event delivered earlier resolves immediately, while a genuinely missing event still
  fails closed.

Validation:

- The focused published KodaX 0.7.76 shared-daemon compatibility test passes 5/5 consecutive local
  runs.
- Complete `npm test`, TypeScript, focused ESLint/Prettier, and Git whitespace checks pass.
- A new four-platform release dispatch from the reviewed candidate remains the final proof.

### 104: Interactive HTML could report ready before its out-of-process frame committed an interactive hit-test surface

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 development
- Fixed: v0.1.32
- Created: 2026-07-25
- Resolution Date: 2026-07-25

#### Original Problem

Final-candidate main CI `30146786957` was classified green, but full log review found that the
Windows `interactive HTML Artifact keeps inline controls and timer-driven playback working` journey
failed its initial attempt and passed on retry #1. The authored script had rendered its initial
state and the frame reported `data-ready=true`, yet the first Playwright click did not reach the
button handler.

Expected behavior:

- `data-ready=true` must mean the authored document is initialized, painted, and able to receive its
  first trusted pointer or keyboard event.
- Release CI must not use Playwright retry to hide a lost first interaction.

#### Root Cause

Issue 100 moved the trusted-input gate inside the iframe and removed the parent `pointer-events`
transition, but the child sent `ready` in the first task after `DOMContentLoaded`. On a loaded
Windows runner, the out-of-process iframe could deliver that message before Chromium committed its
paint and hit-test surface to the parent compositor. The parent then published `data-ready=true`
immediately, leaving a narrow window in which a coordinate click completed without reaching the
already-installed authored handler.

#### Resolution

- Keep trusted input gated through two child-document animation frames after `DOMContentLoaded`,
  then remove the gate and send the ready diagnostic in the following task.
- After receiving ready, wait two parent animation frames before publishing `data-ready=true`.
- Cancel pending parent readiness frames when the document key changes or the observer unmounts, so
  an old frame cannot unlock its replacement.
- Apply the same paint-committed contract to Interactive Artifacts and Project HTML Preview.

Validation:

- Focused readiness/runtime unit coverage passes 18/18.
- The affected Artifact controls and Project HTML journeys each pass 30/30 local runs with two
  Electron workers and Playwright retries disabled; Artifact version refresh passes 10/10 after the
  formal Electron native-ABI setup.
- Complete `npm test`, TypeScript, focused ESLint/Prettier, Git whitespace checks, and production
  renderer/main smoke build pass.
- Final main Build `30147641807` and CI `30147641799` pass on all jobs with no retry/flaky marker.
- Replacement release dispatch `30148001236` passes Windows, Ubuntu, macOS arm64, and macOS Intel;
  all four platform packages and the 18-file release staging gate pass.

### 105: Space builtin skills disappeared from slash completion when the Coder daemon runtime was selected

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32
- Fixed: v0.1.32
- Created: 2026-07-26
- Resolution Date: 2026-07-26

#### Original Problem

Space ships `huashu-design` and `frontend-slides` under its installer-owned builtin skill root, but
neither skill appears in the Composer slash completion list while the Coder daemon runtime is
selected. Newly bundled Space-owned skills would have the same behavior.

Expected behavior:

- Slash completion must contain the daemon runtime catalog and Space-owned builtin skills.
- A name collision must resolve deterministically without duplicating rows.
- Runtime failure must retain the existing local registry fallback.

#### Context

Affected components:

- `skill.discover` Electron IPC catalog assembly
- Space builtin skill registration and metadata mapping
- Composer skill/slash completion

#### Root Cause

The runtime-selected branch of `skill.discover` returns immediately after
`runtimeHostAdapter.listRuntimeSkills()`. It never reads or merges the local SDK registry where
Space registers its installer-owned builtin root.

#### Resolution

- Merge the validated daemon catalog with the validated Space-owned builtin subset from the local
  registry.
- Put Space-owned entries first so they win a same-name collision without producing duplicate
  completion rows, while preserving the 256-item IPC cap.
- If local builtin discovery fails, retain the daemon catalog; if the daemon request fails, retain
  the complete local-registry fallback.
- Keep the packaged builtin set limited to `huashu-design` and `frontend-slides`; candidate design
  skills were not added while their trigger overlap remains unresolved.

Files changed:

- `apps/desktop/electron/ipc/skill.ts`
- `apps/desktop/electron/skill/registry.ts`
- `apps/desktop/electron/test/skill-meta.test.ts`
- `apps/desktop/electron/test/space-builtins.test.ts`
- `docs/FEATURE_LIST.md`
- `docs/HLD.md`
- `docs/KODAX_CAPABILITY_LEDGER.md`
- `docs/features/v0.1.32.md`
- `docs/releases/v0.1.32-release-readiness.md`
- `docs/KNOWN_ISSUES.md`

Validation:

- Focused skill discovery/registry/snapshot coverage passes 28/28.
- TypeScript, focused ESLint/Prettier, the Desktop suite with PTY isolated, and the standalone PTY
  suite pass.
- Windows Setup/Portable packaging and package smoke verification pass; the packaged snapshot
  contains all 260 locked files for the two intended Space builtin skills.

### 106: File Viewer fallback reported authorization-scope rejection as though an existing external file were missing

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32
- Fixed: v0.1.32
- Created: 2026-07-26
- Resolution Date: 2026-07-26

#### Original Problem

Clicking a transcript file path such as
`C:\Users\<user>\Downloads\report.docx` while another project was active did not open File Viewer.
The fallback reveal action then displayed “File not found; cannot reveal it” even when the file
existed.

Expected behavior:

- The project and Delivery boundaries of File Viewer remain enforced.
- An existing path outside KodaX's authorized roots is identified as out of scope, not missing.
- A genuinely missing allowed file still receives the file-not-found message.
- An OS shell failure receives a separate reveal-failed message.

#### Context

Affected components:

- Transcript file-link smart routing
- Project-scoped File Viewer fallback
- `shell.revealPath` IPC result contract
- File reveal localization and diagnostics

#### Root Cause

`shell.revealPath` returned only `{ revealed: boolean }`. Its `false` value represented several
different states: an absent file, an absolute path outside the project/KodaX allowlist, a symlink
escape, an OS permission failure, or a shell integration failure. The renderer mapped every
non-success response to `openPath.fileNotFound`, erasing the security-boundary decision and
misreporting valid external files as absent.

#### Resolution

- Extended the typed reveal response with the backward-compatible optional reasons `not-found`,
  `not-allowed`, and `failed`.
- Classify absolute paths against lexical and canonical allowed roots before resolving the target,
  preserving the allowlist and symlink-escape protections without adding an arbitrary-path
  existence oracle.
- Map authorization-scope rejection to a dedicated message explaining that the path is outside
  KodaX's authorized locations.
- Keep genuine missing files on the existing file-not-found message and route shell integration
  failures to the existing reveal-failed message.

Files changed:

- `packages/space-ipc-schema/src/channels/shell.ts`
- `packages/space-ipc-schema/test/registry.test.ts`
- `apps/desktop/electron/ipc/shell.ts`
- `apps/desktop/electron/test/shell-ipc.test.ts`
- `apps/desktop/renderer/src/lib/openPath.ts`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- IPC schema coverage accepts only the bounded reveal failure reasons while retaining legacy
  reason-less response compatibility.
- Shell handler coverage distinguishes external/symlink scope rejection, missing files, OS
  permission denial, and shell integration failure.

### 107: Context-window popover mixed physical capacity, automatic-compaction headroom, and reserved response capacity

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32
- Fixed: v0.1.33
- Created: 2026-07-26
- Resolution Date: 2026-07-26

#### Original Problem

The popover presented the current root input against the model's physical maximum context while its
primary purpose was to answer how close the Session was to automatic compaction. It also showed
reserved response capacity and physical headroom as though they were input categories or protected
space before the automatic threshold.

One explanatory sentence compounded the problem by describing a 320k effective threshold as a
percentage of a 1M model maximum even when the Runtime's final absolute threshold was authoritative.

Expected behavior:

- The primary percentage answers “how much of the effective automatic-compaction window is used?”
- Model maximum context and current automatic-compaction threshold are independent facts.
- Capacity reserved for the next response is not active input and is not labeled as compaction
  headroom.
- Cumulative Provider usage is visible but cannot be confused with current root-context pressure.

#### Root Cause

The UI reused the physical context cap as the denominator for its main progress and composition,
even after Space had resolved the Runtime's final effective threshold. The Runtime budget `total`
also includes `reservedResponse`; using it directly as a fallback advanced the input meter with
capacity that had not been sent as input. Session-wide root/child Provider usage had no separate
surface, encouraging one indicator to answer two different questions.

#### Resolution

- Normalize the primary progress and every composition percentage to the final
  `autoCompactThreshold`.
- Keep Provider root `tokenCount` authoritative; when only a context-budget fallback exists, subtract
  `reservedResponse` before calculating active input.
- Show only current-input categories in the segmented bar and legend. Remove reserved-response,
  physical-headroom, and synthetic auto-compact-reserve segments.
- Present model maximum context and auto-compact threshold as two independent facts without
  inventing a percentage relationship.
- Add a separate Session-usage indicator that accumulates each Provider-reported root/child call
  once and exposes cache subsets without double counting.
- Add matching `en-US` and `zh-CN` copy and document the privacy boundary: category counts and
  hash-only cache diagnostics contain no prompt/message/tool bodies.

Validation:

- Context-reading unit coverage proves reserved-response exclusion and Provider-count precedence.
- Desktop TypeScript and production renderer build pass.
- Focused Electron E2E verifies the semantic threshold maximum, current-input composition, policy
  facts, absence of reserve labels, mutual exclusion of the two popovers, and stable screenshots.
- The [Product Design QA comparison](../design-qa.md) passes and records the intentional “Context
  window” title plus removal of output reservation.

### 108: Electron native-binding probe could report an incompatible better-sqlite3 ABI as healthy

- Priority: High
- Status: Resolved
- Introduced: v0.1.32
- Fixed: v0.1.33
- Created: 2026-07-26
- Resolution Date: 2026-07-26

#### Original Problem

After unit tests rebuilt `better-sqlite3` for plain Node, a later Electron development or packaging
flow could accept that Node-ABI binary as compatible. The resulting application could fail during
startup even though the preflight script printed a successful native-runtime check.

#### Root Cause

The probe launched Electron with `ELECTRON_RUN_AS_NODE=1` and an inline `-e` script, then trusted only
the child-process exit status. Electron 42 can print an uncaught native-module load exception for
that invocation while still returning status 0, so the probe mistook the ABI mismatch for success.

#### Resolution

- Wrap the native load and in-memory database open in an explicit `try/catch`.
- Exit 0 only after the database opens and closes successfully.
- Print the caught failure and explicitly exit 1 so the existing rebuild path runs, or packaging
  fails closed instead of emitting a broken artifact.

Validation:

- The probe detects an Electron ABI 146 binding from Node ABI 127 and rebuilds it for Node.
- The same probe then detects the Node ABI binding from Electron and restores the Electron ABI 146
  prebuild.
- Both post-rebuild runtime checks return success.

### 109: Cross-Provider cache field semantics made a 25k Qwen input look like six ordinary tokens

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32
- Fixed: v0.1.33
- Created: 2026-07-26
- Resolution Date: 2026-07-26

#### Original Problem

Three equivalent first-turn Sessions reported visibly different usage breakdowns. Qwen Token Plan
showed six "regular input" tokens and about 25.4k cache-write tokens, while GLM and Kimi showed
roughly 23k-24k input tokens without the same split. Although the Session total was arithmetically
correct, the cards made the Qwen request look implausibly small and encouraged invalid
cross-Provider comparisons.

#### Root Cause

Qwen Token Plan uses an Anthropic-compatible endpoint. Its cold-cache response reported six
`input_tokens` plus 25,408 `cache_creation_input_tokens`; KodaX correctly normalized their sum to
25,414 total input. GLM and Kimi exposed different cache dimensions and tokenizers. Space labeled
the residual field "regular input" and did not lead with total input or explain that cache-field
availability and token counts are Provider-specific.

#### Resolution

- Present Provider-reported total input before its cache breakdown.
- Rename the residual category to "uncached input" and cache write to "cache creation input".
- State that cache creation is already included in total input.
- Add an explicit cross-Provider note directing model comparisons to total input and output.
- Keep all original Provider values and Session-total arithmetic unchanged.

Files changed:

- `apps/desktop/renderer/src/shell/ContextWindowIndicator.tsx`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/electron/kodax/space-manual-topics.ts`
- `apps/desktop/electron/test/space-manual-topics.test.ts`
- `tests/e2e/coder-layout.spec.ts`
- `docs/USER_MANUAL.zh-CN.md`
- `docs/features/v0.1.32-context-compaction-experience.md`
- `CHANGELOG.md`
- `docs/KNOWN_ISSUES.md`

Validation:

- Runtime event evidence confirms Qwen's normalized `25,414 = 6 + 25,408` total input and
  `30,097 = 25,414 + 4,683` Session total.
- The comparable GLM and Kimi events report totals of 33,565 and 24,473 respectively; their
  differences are attributable to Provider tokenization, reported cache fields, and output length.
- Localization, manual-topic, TypeScript, lint, and production-renderer checks cover the revised
  semantics.

### 110: Restored Session history can render one complete user/assistant turn twice

- Priority: High
- Status: Resolved
- Introduced: v0.1.32
- Fixed: v0.1.33
- Created: 2026-07-26
- Resolution Date: 2026-07-28

#### Original Problem

Current behavior:

- Session `s_16145973-baa1-4822-9d79-b635a9d9e144` displays the same user query, thinking receipt,
  and assistant response twice even though the query was submitted only once.
- The duplicate is visible after restoring Session history, with matching content and timestamps
  across both copies of the complete turn.

Expected behavior:

- A persisted user prompt and its assistant response render exactly once.
- Restoring history remains stable when the same canonical event is observable through more than
  one Runtime history source or page.

#### Context

Affected components:

- Coder Session history restore
- Runtime event normalization and transcript projection
- Renderer transcript row identity

#### Root Cause

The canonical Session JSONL contained one real user message and one assistant message, and the
Runtime event log contained one `turn.started` / `turn.completed` pair. The duplicate therefore did
not originate in Provider execution or durable transcript storage.

The renderer can retain the complete turn from the live `session.event` stream while a later
`session.history` restore reads the same canonical turn. `prependSessionHistory` unconditionally
concatenated the restored buckets before the existing live buckets. A renderer/Shell remount or a
history request completing after live delivery therefore projected the same user, thinking, and
assistant content twice.

The inverse ordering is also possible: `session.history` can return after the renderer-owned user
message exists but before the matching live assistant stream reaches its terminal event. Treating
the partial live prefix as a duplicate immediately would risk deleting the only complete durable
copy; waiting without a boundary identity would leave the duplicate after the live turn finishes.

#### Reopened Regression Evidence

Session `s_5d2f5c97-f5fc-4d4f-b718-29639855e146` exposed a second shape: the query rendered twice
while only part of the response projection was duplicated. Its canonical transcript still contains
one real user boundary and one Runtime run. The history and live representations of that run are
not semantically identical: durable history reconstructs canonical tool calls, while the live
projection also contains Runtime-only plan, artifact, progress, and diagnostic events.

The observed history/live timestamp skews were approximately 288 ms and 1,768 ms, so the original
250 ms window missed both reports. Widening that window would allow a fast, intentional repeat of
the same prompt and answer to be deleted. The queued-prompt promotion path also unconditionally
appended a normal user message after history had already restored that same canonical boundary,
which explains why a query could duplicate without every response block doing so.

#### Resolution

- Carry the Runtime `turnId` through run start, queued/interrupt delivery, and terminal renderer
  events, and restore the same `turnId` from canonical history.
- Identify a visible user boundary by `(sessionId, turnId, visibleUserOrdinalWithinTurn)`. `turnId`
  alone is insufficient because one Runtime turn can contain multiple real interrupt/user
  messages. Synthetic users, tool-result carriers, sidecar messages, and workflow notices do not
  consume the ordinal.
- Fold only two projections with that strong identity. Remove the timestamp/content similarity
  fallback entirely; legacy or otherwise unidentifiable turns are preserved rather than guessed.
  Distinct `turnId` values therefore preserve a legal repeat even when prompt, answer, and send time
  are nearly identical.
- Treat history as the canonical visible-order baseline, retain history-only tools/notices, merge
  live-only Runtime state/artifacts/diagnostics, and update in-flight tool receipts in place. This
  accommodates the intentionally heterogeneous history and live projections without dropping or
  reordering visible blocks.
- When complete history wins before the live terminal, retain an internal live segment owner but
  hide its duplicate user and assistant projection. Subsequent live events remain correctly paired;
  the terminal atomically folds the owner into the durable turn.
- Make queued and interrupt promotion identity-aware so a restored query is not rendered twice,
  while still retaining the hidden live owner required to receive later response/tool events.
- Recompute token estimates and transient-artifact projections from the reconciled buffers so the
  display fix cannot leave double-counted derived state.

Files changed:

- `packages/space-ipc-schema/src/channels/session.ts`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/features/session/composeMessages.ts`
- `apps/desktop/electron/test/history-replay-no-popout.test.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `packages/space-ipc-schema/test/session.test.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- Both live-first and history-first completion orders render one canonical query/answer.
- A 1,768 ms skew still folds by identity, while a content-identical legal repeat with another
  `turnId` remains two turns even inside the old timestamp window.
- History/live projections with different tool counts and visible block ordering fold without
  losing the durable ordering, notices, tool receipts, or live-only state.
- A history-first queued prompt keeps a hidden live segment owner, removes the queue row, and never
  renders a second query before or after terminal delivery.
- Multiple real user boundaries inside one Runtime turn retain ordinal 0/1 ordering and both
  responses.
- Incomplete or identity-less projections are not destructively folded.

Validation:

- Both supplied Session/Runtime datasets prove one canonical user boundary and one Runtime
  execution; editing workspace source cannot affect the already-running `out` portable build.
- Focused history/schema/Runtime-adapter coverage passes 143/143.
- Complete desktop coverage passes 1,742/1,744 with two Windows symlink-permission skips; complete
  IPC schema coverage passes 274/274.
- Release coverage passes 12/12. TypeScript, full-repository ESLint, targeted Prettier, Git
  whitespace validation, and production `build:smoke` all pass.

#### Reopened Regression Evidence (2026-07-27)

Session `s_6d037f64-c0c9-4f0a-a2b5-78d9f560ef3d` contains one canonical copy of the
`arXiv API 抓取成功了` assistant milestone, while the renderer export contains two. The first user
turn is `turn_3a21d3614712443c`; a later interrupt is a distinct
`turn_d725d7166d7f451e`.

The first resolution correctly requires strong `(turnId, turnUserOrdinal)` identity, but it binds
the optimistic first user only from `session_start.turnId`. Real daemon data shows that
`run.started` has no `turnId`, while the following `turn.started` always carries the canonical
identity. Space currently projects only `run.started` into `session_start`, so the intended
identity-bearing lifecycle event never reaches the renderer and the safe fail-open merge preserves
both history/live copies.

Expected resolution:

- Project canonical `turn.started.turnId` into the existing non-boundary `session_start` event.
- Preserve the early identity-less `run.started` event for immediate activity feedback.
- Prove the real two-event sequence folds one history/live turn without content or timestamp
  heuristics.

#### Regression Fix (2026-07-27)

- The Runtime adapter now keeps the early identity-less `run.started` projection, then emits a
  second non-boundary `session_start` when `turn.started` supplies the canonical `turnId`.
- The inline compatibility host now carries `onSessionStart.turnId` through the same renderer
  event shape.
- The renderer's existing strong `(turnId, turnUserOrdinal)` merge can therefore bind the
  optimistic user boundary and fold the restored copy without weakening its fail-open safety for
  truly identity-less or legally repeated turns.
- Regression coverage models the factual `run.started` without identity followed by
  identity-bearing `turn.started`, rather than the earlier synthetic test shape.

Additional files changed:

- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/test/history-replay-no-popout.test.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`

Additional validation:

- Local Runtime evidence: 0/67 observed `run.started` events carried `turnId`, while 83/83
  observed root `turn.started` events did.
- The focused real-sequence identity regression passes.
- An independent review added a root-context guard so a child Agent's `turn.started` event cannot
  bind the renderer's primary turn identity.
- The related history, message-composition, Runtime adapter/projection, store, and activity suite
  passes 182/182.

### 111: Latest-request input was labeled as a still-pending queue while zero context categories disappeared

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32
- Fixed: v0.1.33
- Created: 2026-07-26
- Resolution Date: 2026-07-26

#### Original Problem

After a first-turn response completed, the context popover showed "pending input" but omitted
Messages and Recent tool results. This made the completed user prompt look as though it were still
waiting in a queue and made context categories appear to replace one another between requests.

#### Root Cause

KodaX's `pendingInput` budget field describes the current-turn input segment at the instant of the
captured model request. On the first request it contains the user prompt; on later requests,
completed content is classified as transcript and tool-return blocks as recent tool results. Space
retained the last request snapshot after completion but translated the field literally as
"pending", and filtered every zero-valued category out of the legend.

#### Resolution

- Rename the field to "Request input" / "本次请求输入".
- Rename the section to "Latest model input composition" / "最近一次模型输入构成".
- Explain that this is the latest root-model request snapshot, not an unprocessed queue or the
  complete visible transcript.
- Keep all six composition categories visible even when their current value is zero, combining
  Skills and MCP into one row, so Messages
  and Recent tool results no longer appear to disappear.
- Update the manual and context-compaction documentation with the request-to-request category
  transition.

Files changed:

- `apps/desktop/renderer/src/shell/ContextWindowIndicator.tsx`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `apps/desktop/electron/kodax/space-manual-topics.ts`
- `apps/desktop/electron/test/space-manual-topics.test.ts`
- `tests/e2e/coder-layout.spec.ts`
- `docs/README.md`
- `docs/USER_MANUAL.zh-CN.md`
- `docs/features/v0.1.32-context-compaction-experience.md`
- `CHANGELOG.md`
- `docs/KNOWN_ISSUES.md`

Validation:

- KodaX source inspection confirms that the current-turn segment maps to `pendingInput`, completed
  ordinary messages map to `transcript`, and tool-result blocks map to `recentToolResults`.
- Manual-topic tests, TypeScript, lint, formatting, diff checks, and the production renderer build
  cover the revised presentation.

### 112: Windows PTY and Coder command tools could not find runtimes initialized by the user's shell

- Priority: High
- Status: Resolved
- Introduced: v0.1.x / KodaX 0.7.76
- Fixed: v0.1.33 with npm-published KodaX 0.7.77
- Created: 2026-07-27
- Resolution Date: 2026-07-28

#### Original Problem

KodaX Space started its built-in terminal with `cmd.exe`, and Coder shell tools inherited the
Electron/daemon process environment instead of the user's effective shell environment. On Windows,
Node installed through fnm was available in the user's normal PowerShell but both the built-in PTY
and LLM-invoked command tools reported that `node` and `npm` were not found. A complete solution
also had to support other shell-driven managers such as Volta, nvm, asdf, pyenv, and custom profile
PATH setup without hard-coding fnm.

#### Root Cause

- Space had no persisted, server-controlled terminal-shell preference and defaulted the Windows PTY
  to `cmd.exe`.
- A GUI-launched Electron process does not necessarily inherit PATH mutations produced by a user's
  interactive PowerShell profile.
- The previous KodaX integration had no host-supplied command shell/environment contract, so daemon
  command tools could not resolve the selected shell profile in the effective working directory.

#### Resolution

- Add Auto, PowerShell 7, Windows PowerShell, Command Prompt, Bash, and Zsh preferences with native
  Windows Auto selection preferring `pwsh`, then Windows PowerShell, then `cmd`.
- Hydrate only PATH from the selected PowerShell profile before PTY/daemon startup; retain the PTY
  environment allowlist and do not copy profile-defined credentials into the Electron process.
- Map the same preference to KodaX's versioned `shellExecution` contract and pass it through both
  revisioned Session settings and each Coder Run context.
- Use filtered environment inheritance, Registry PATH composition on Windows, profile-aware
  execution, bounded probe/cache settings, and no fnm-specific setup.
- Keep Bash/Zsh profile execution explicit on Windows so a Git/MSYS `SHELL` variable cannot
  silently replace the native daemon environment.
- Preflight profile-loading contracts with a non-throwing PATH canary. A failed PowerShell canary
  degrades to a profile-free Registry-PATH contract, while a failed Bash/Zsh canary falls back to
  the daemon's inherited environment; failures are cached for only 60 seconds before retry.
- Clear an already-persisted Runtime `shellExecution` contract with an explicit `null` patch when
  the canary later becomes unavailable, rather than leaving the daemon with a stale fail-closed
  contract.
- Bypass the SDK's GNU-only `env -0` hydration path on macOS in favor of Space's PATH-only capture,
  and use non-interactive-compatible `-lc` arguments for plain `/bin/sh`.

Files changed:

- `apps/desktop/electron/terminal/shell.ts`
- `apps/desktop/electron/terminal/ptyHost.ts`
- `apps/desktop/electron/kodax/shell-env-hydrate.ts`
- `apps/desktop/electron/kodax/shell-execution.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- Settings IPC, store, renderer, localization, and schema files
- Shell, PTY, settings, Runtime queue, and KodaX compatibility tests
- `package.json`
- `package-lock.json`

Validation:

- Both Space workspaces resolve the exact npm Registry package `@kodax-ai/kodax@0.7.77`;
  the lockfile SRI matches npm metadata and no local `file:` dependency remains.
- With every fnm multishell directory removed from the parent PATH, the KodaX command tool resolved
  the selected Windows PowerShell profile and returned Node `v22.23.1`.
- The same command-tool probe confirmed that a synthetic API-key environment variable remained
  filtered.
- An isolated real daemon accepted and returned the complete `shellExecution` Session setting; the
  permanent multi-process tarball compatibility test now verifies that round trip.
- Relevant shell, PTY, settings, Runtime adapter, and IPC coverage passed 96/96; KodaX package
  compatibility passed 4/4.
- TypeScript, targeted ESLint, targeted Prettier, Git whitespace validation, and production
  `build:smoke` passed.
- Follow-up review passed 24/24 focused shell environment, contract-cache, and Runtime queue tests;
  the full TypeScript gate and production renderer build also passed.

Release note:

- npm metadata now confirms `0.7.77` as the published KodaX version, supplying the required public
  version boundary. Advertising `shellExecution: 1` as a dedicated Runtime
  capability remains a useful future compatibility improvement, but it is not a blocker for this
  `0.7.76` to `0.7.77` release.

### 113: Native child Agent lifecycle is not synchronized into Task Dock and right-sidebar status

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32 / KodaX 0.7.72 adoption
- Fixed: v0.1.33
- Created: 2026-07-27
- Resolution Date: 2026-07-27

#### Original Problem

In the packaged Windows build, after the root Agent spawns a native child Agent, the Task Dock
status strip and the right-sidebar Agents section continue to show only the managed foreground
Worker. The displayed total and running counts therefore do not track the child Actor's running,
idle, completed, failed, or interrupted lifecycle.

#### Root Cause

Space's semantic Agent cards and Task Dock metrics are still derived from the legacy
`managed_task_status` projection. That projection describes the managed AMA foreground
Worker/role. KodaX intentionally stopped changing `activeWorkerId` to `child`, because doing so
incorrectly changed foreground ownership and cleared the root Worker's live tool calls;
`childFanoutCount` is now decorative rather than a child lifecycle source.

KodaX 0.7.72 introduced the unified Runtime-owned Actor/Turn control plane, and KodaX 0.7.77
publicly exposes `runtime.agents.tree()`, `detail()`, `events()`, and `wait()` in both embedded and
daemon modes. Those contracts contain Actor identity, parent path, lifecycle state, current Turn,
recent activity, event sequence, and tree revision. Space already consumes the same Runtime
service for configured External Agent tasks, but filters that route to `kind === "external"` and
does not expose native Actor-tree telemetry to the renderer.

The packaged `out/win-unpacked` artifact contains Space 0.1.32 and KodaX 0.7.77, but its renderer
source map confirms that the Agents projection still reads `managedTaskStatusBySession` and
`buildWorkerTree()`. This is therefore a Space adoption gap, not missing KodaX SDK capability and
not merely a stale local package.

#### Resolution

- Added validated `agent.actor.snapshot` and `agent.actor.changed` IPC contracts backed by a
  dedicated per-Session Runtime Actor observer. It seeds from `agents.events()` plus
  `agents.tree()`, advances an independent event cursor through `agents.wait()`, reconciles the
  authoritative tree after event bursts and long-poll timeouts, and stops cleanly across
  disconnect, deletion, rewind, and host teardown.
- Added one monotonic renderer Actor-snapshot store keyed by Session and Runtime identity. The app
  seeds it after Runtime observation becomes ready and applies only matching, non-regressing
  revisions/cursors.
- Made the Actor tree canonical for native, recursive, Workflow-owned, constructed, and external
  Agent identity and lifecycle in the Task Dock, right sidebar, and full Tasks panel. Legacy
  Worker fan-out is used only when no Actor snapshot exists.
- Kept `managed_task_status` as the canonical foreground root Worker source. KodaX's permanent
  `/root` control Actor intentionally stays `running` with no Turn, so its semantic card merges
  only the managed Worker's phase/progress/state; every non-root card remains strictly
  Actor/Turn-owned.
- Bounded the IPC snapshot to 256 Actors while always retaining `/root`, then prioritizing active
  Turns and the most recently updated history so a new running child cannot be hidden by old
  completed Actors.

Files changed:

- `packages/space-ipc-schema/src/channels/agent.ts`
- `apps/desktop/electron/kodax/runtime/runtime-agent-tree-observer.ts`
- `apps/desktop/electron/kodax/runtime/runtime-agent-projection.ts`
- `apps/desktop/electron/kodax/runtime/runtime-host-adapter.ts`
- `apps/desktop/electron/ipc/agent.ts`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/App.tsx`
- `apps/desktop/renderer/src/shell/agentStatusProjection.ts`
- Task Dock, right-sidebar, Tasks-panel, schema, store, observer, adapter, projection, and E2E
  tests.

Validation:

- TypeScript typecheck, targeted ESLint, Prettier, and Git whitespace validation passed.
- The focused Actor projection/observer/host/UI regression set passed 74/74, including a real
  no-Turn `/root`, interruption, timeout reconciliation, reconnect/delete teardown, and a newest
  active Actor behind 300 historical entries.
- Production `build:smoke` and the Electron Task Dock/right-sidebar/full-panel E2E scenario passed.
- The existing `out/win-unpacked` package remains the reported 0.1.32 artifact; a later Windows
  package build is required to ship this fix in `v0.1.33`.

### 114: Delivered mid-turn prompt could jump above the preceding interrupt response

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.32
- Fixed: v0.1.33
- Created: 2026-07-27
- Resolution Date: 2026-07-27

#### Original Problem

While a long-running Coder Session displayed 18 completed commands, the user queued an interrupt
prompt. The queued bubble correctly stayed at the transcript tail. After command 19 completed and
Runtime delivered the interrupt, the bubble changed into a normal user message but jumped above
the response to an earlier interrupt prompt. The earlier response and command receipt therefore
appeared to answer the newly delivered prompt.

Runtime evidence for Session `s_fdbdb493-d3ab-4e20-8879-a79476cad177` showed that the queued input
was accepted and delivered in canonical order. The durable transcript also kept the earlier user
prompt before its Redis/Lua response. The defect was limited to Space's renderer projection; no
Runtime transcript data was reordered or corrupted.

#### Context

- Affected surface: Coder Session transcript during a long-running Runtime run.
- Required trigger: restored history followed by an active live projection, then at least two
  mid-turn delivery boundaries.
- Visible symptom: the later prompt moves upward when its queue overlay is promoted.
- SDK dependency: none. Runtime already supplies ordered delivery events, `inputId`, and `turnId`.

#### Root Cause

Space composes user messages and Runtime events as two positional streams. In a history-first
observation, Runtime-only events such as `session_start` can sit between the restored history
suffix and the first live `mid_turn_user_prompt` marker without a user-message segment owner.
The promoted live duplicate then consumes that pre-delivery segment and is considered closed when
its own marker is encountered. Strong-identity reconciliation folds and removes the wrong segment
owner. When the next queued prompt is delivered, it shifts left and consumes the preceding
interrupt's response and tool events.

#### Resolution

- Count the event segments that end before each delivered prompt marker and compare them with the
  existing user-message segment owners.
- When a proven deficit exists, add only the required invisible alignment owners before promoting
  the delivered prompt. These anchors consume their event segments without fabricating user
  bubbles and preserve any unmatched live-only output.
- Reuse a restored `turnUserOrdinal` only when the canonical prompt text matches. If it does not,
  allocate a fresh ordinal after the turn's maximum instead of guessing an unmatched restored
  identity; this fail-open rule prevents a new same-turn interrupt from being folded away.
- Record the consumed `(queueMode, queueId)` on the promoted user owner, preserve it when a live
  duplicate folds into durable history, and drop a replayed delivery event before appending it.
  This makes reconnect delivery idempotent without leaving a stray segment boundary.
- Keep the queued overlay removal, strong `turnId + turnUserOrdinal` reconciliation, and normal
  after-turn/mid-turn delivery paths unchanged when no deficit exists.

Files changed:

- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/electron/test/history-replay-no-popout.test.ts`

Tests added:

- A history-first, active-run regression reproduces the reported sequence: an earlier delivered
  interrupt and response, command 19, then a later queued interrupt delivery. It asserts that the
  Redis/Lua response and command remain before the newly delivered prompt and that the queue
  overlay is consumed exactly once. The stricter variant keeps both interrupts in the same Runtime
  turn, verifies that the later prompt receives the next fresh user ordinal, simulates future-skewed
  restored timestamps, and replays the same delivery ID to prove the prompt and boundary remain
  exactly once. It also replays an earlier delivery after strong-identity folding and verifies that
  the durable history owner retained the consumed delivery identity.

### 115: Missing temporary clipboard images can permanently poison restored Provider runs

- Priority: High
- Status: Resolved
- Introduced: v0.1.9
- Fixed: v0.1.33 / KodaX 0.7.77
- Created: 2026-07-27
- Resolution Date: 2026-07-27

#### Original Problem

Session `s_f754511b-421b-48b9-b711-15f9328d1a8d` accepted a pasted PNG and completed its original
turn. Later, every follow-up failed before generating model output, regardless of the new query.
The visible error was:

`Provider run failed while using a run-scoped credential.`

The stored Session history still referenced
`%TEMP%\kodax-space\clipboard\s_f754511b-421b-48b9-b711-15f9328d1a8d\ms2sx6io-1.png`, but that
file and its clipboard root no longer existed.

Expected behavior:

- Pasted images referenced by durable Session history remain available for the lifetime of the
  Session.
- Deleting or losing one historical local image does not make all future text-only turns fail.
- Tests never delete the production user's attachment root.
- The UI exposes a missing historical attachment as an attachment-specific degradation rather
  than disguising it as a Provider credential failure.

#### Context

- Space currently stores pasted image bytes under the OS temporary directory and persists only
  the absolute path in KodaX Session history.
- Space deletes per-Session clipboard directories during general host disposal, even though
  disposing the app does not delete the durable Session.
- The clipboard unit test recursively deletes the same global temporary root used by the running
  production app.
- KodaX Provider serializers reopen every historical image path on each full-history request and
  propagate `ENOENT`.
- Runtime's run-scoped credential wrapper replaces the underlying Provider error with the generic
  credential-scoped message.

#### Root Cause

The attachment bytes and the history reference had incompatible lifetimes. A durable transcript
stored a path owned by temporary storage, while both normal shutdown cleanup and an unisolated
test could remove that storage independently of Session deletion. KodaX then treated a missing
historical image as a fatal serialization error. Runtime reported that Provider failure through
the run-scoped credential boundary, obscuring the filesystem cause.

#### Resolution

- New clipboard images first enter a profile- and process-isolated pending sandbox. After
  `session.send` accepts the prompt, main copies them into
  `<KODAX_HOME>/space/session-attachments/<sessionId>` and removes the drafts. Explicit removal,
  slash-command discard, normal shutdown, and next-start stale cleanup remove only unsent drafts.
- Legacy temporary paths remain accepted for compatibility, but renderer cleanup can no longer
  delete legacy or durable history. Durable and legacy Session directories are removed only
  after SDK Session deletion succeeds; cleanup failures are surfaced so deletion can be retried.
- Attachment storage follows the same explicit `KODAX_HOME` as KodaX Session history. Save/read
  IPC also requires a live owner Session, preventing permanent ownerless attachment directories.
- Artifact validation accepts only the owning Session's pending, durable, or legacy sandbox,
  rejects prefix siblings, requires the resolved Session directory to remain a direct child of
  the real application root, rejects file/junction escapes, and requires an existing regular
  file.
- Clipboard tests use a unique `KODAX_TEST_ONBOARDING` data profile and never recursively delete
  `%TEMP%\kodax-space\clipboard`.
- KodaX Anthropic- and OpenAI-compatible serializers degrade only missing historical files
  (`ENOENT` / `ENOTDIR`) to a path-free text placeholder. OpenAI tool-result image blocks also
  use path-free missing/unsupported markers. Other image-read filesystem failures remain visible.
- Rebuilt and audited `@kodax-ai/kodax` 0.7.77. Current Space source consumes the exact official
  npm Registry release through `package.json` / `package-lock.json`, so clean checkout and CI
  require neither a vendored archive nor an untracked sibling repository tarball.
- Restored the one missing PNG referenced by the reported Session using the user-supplied
  screenshot. The Session JSONL was not changed.

Validation:

- Clipboard and host lifecycle regressions passed 60/61; the only skip is the file-symlink
  escape case on this Windows host, which does not grant file-symlink creation permission. The
  Session-directory and application-root junction cases executed and passed.
- KodaX Provider/image serialization regressions passed 46/46 after first reproducing the
  original `ENOENT` failures.
- The KodaX official full gate passed in order: fast 1351/1351, unit 8192/8193 with one
  intentional skip, contract 881/902 with 21 todo, and system 632/632.
- A clean Space `npm ci --ignore-scripts` succeeded from the official Registry package. The
  published tarball SHA-256 is
  `E30B447059F1C237B81E5896E51698D3FFD7987A8C5E1CF15F9F2354C846F63C`; its SHA-512 integrity
  exactly matches npm metadata and `package-lock.json`.
- Space typecheck, focused ESLint, changed-file Prettier, Git whitespace checks, and production
  `build:smoke` passed. The full root test command passed 12/12 release tests, 1785/1788 desktop
  tests with three platform-capability skips, and 277/277 IPC-schema tests.
- An offline probe against Space's installed Registry package confirmed both Provider families continue
  without leaking the missing local path.
- The separately packaged `out-reviewed` Windows artifact passed the isolated packaged boot
  smoke and contained the durable/pending attachment lifecycle, both path-free image fallback
  markers, and CLI timeout/cancellation handling. The subsequent official-Registry upgrade also
  passes the production `build:smoke` gate.
- The reported Session now has one image reference and one existing file.

### 116: Completed daemon Session can remain stuck on Processing result in the renderer

- Priority: High
- Status: Resolved
- Introduced: v0.1.32
- Fixed: v0.1.33
- Created: 2026-07-27
- Resolution Date: 2026-07-27

#### Original Problem

Session `s_6d037f64-c0c9-4f0a-a2b5-78d9f560ef3d` completed its Runtime run at
`2026-07-27T09:00:00.610Z`, and the daemon reports zero active or queued runs. The visible Session
nevertheless continues to show `Processing result`, elapsed time, iteration/token counters, and an
enabled stop button.

Expected behavior:

- The daemon live projection is authoritative for queued/running/terminal state.
- A terminal or idle live snapshot clears stale event-derived activity.
- Renderer reload, Runtime reconnect, and selecting an already-open Session all reacquire the
  authoritative live snapshot.
- Legacy event-only mode continues to show activity before a daemon projection exists.

#### Context

- Affected components: Runtime observation bootstrap, renderer live-projection hydration, and
  `ActivitySpinner` / stop-button state.
- Durable Session data and Runtime run state are already terminal; the defect is renderer-only.
- The visible `Processing result` plus iteration/token counters proves the activity selector fell
  back to the legacy event stream instead of using an active daemon run projection.

#### Root Cause

`snapshotFromRuntimeProjection` returns `undefined` both when no Runtime projection exists and when
an authoritative projection exists but is idle. `selectActivitySnapshot` therefore falls back to a
legacy event stream whose final `session_complete` can be absent after observation/bootstrap
churn. The selected-Session hydration effect also reads projection presence non-reactively and
does not retry when Runtime readiness changes or the projection is cleared.

#### Resolution

- Represent an existing idle daemon projection as an explicit non-streaming activity snapshot,
  while retaining `pendingSend` and active compaction precedence.
- Re-run selected-Session hydration when Runtime readiness or projection presence changes.
- Reconcile the selected Session on focus/visibility, Runtime reconnect, and terminal lifecycle
  events.
- Treat both revision gaps and already-pending reconciliation as reasons to request the
  single-flight authoritative snapshot, so a terminal change cannot be lost behind an in-flight
  request.
- Let admitted active/queued Runtime state outrank a stale pending-send marker, and clear that
  marker when an authoritative active run or a newly observed terminal run arrives.
- Add regressions for an idle authoritative projection over a stale `Processing result` event tail,
  pending-send handoff/admission, snapshot races, and legacy event-only fallback.

Files changed:

- `apps/desktop/renderer/src/App.tsx`
- `apps/desktop/renderer/src/shell/ActivitySpinner.tsx`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/store/runtimeProjectionState.ts`
- `apps/desktop/electron/test/activitySpinner.test.ts`
- `apps/desktop/electron/test/app-store-runtime-projection.test.ts`
- `apps/desktop/electron/test/runtime-projection-state.test.ts`
- `docs/KNOWN_ISSUES.md`

Validation:

- The exact stale tail from the report (`Processing result`, iteration 5/500, 52.6k tokens) is
  cleared by an authoritative idle Runtime projection in regression coverage.
- Pending send, admitted active/queued state, new terminal reconciliation, active compaction, and
  pre-hydration legacy event fallback remain covered.
- Two independent sub-Agent reviews completed; their actionable pending-send, snapshot-race, and
  child-turn identity findings are fixed and covered by regression tests.
- The related history, message-composition, Runtime adapter/projection, store, and activity suite
  passes 182/182.
- `npm run typecheck`, targeted ESLint, `git diff --check`, and `npm run build:smoke` pass.
- An isolated staged Windows package at `out-validation/win-unpacked` passes packaged boot smoke:
  KodaX 0.7.77 daemon ready, Runtime host ready, and renderer `app://space` ready.

### 117: Image attachment fails when the selected persisted Session has not been lazily resumed

- Priority: High
- Status: Resolved
- Introduced: v0.1.32
- Fixed: v0.1.33
- Created: 2026-07-27
- Resolution Date: 2026-07-27

#### Original Problem

Adding `C:\Users\ADMIN\Downloads\线束效应重塑企业级AI.png` to the composer through
either drag-and-drop or the `+` file picker fails with:

`HANDLER_ERROR: [clipboard.saveImage] handler threw: clipboard image owner Session does not exist`

Expected behavior:

- A valid image can be attached to a selected durable Session immediately after Space starts.
- Drag-and-drop, file selection, and clipboard image paste share the same safe behavior.
- Renderer-supplied Session IDs remain fail-closed unless they identify a real in-memory or
  persisted Session.

#### Context

- The supplied file is a valid PNG with a correct signature and a size of 5,171,342 bytes, below
  the 6 MiB decoded-image limit.
- Both reported entry points converge on `BottomBar.attachImages` and `clipboard.saveImage`, so the
  filename and individual picker/drop implementations are not the cause.
- A persisted Session appears in `session.list` without being instantiated in `kodaxHost` until a
  later operation lazily resumes it.

#### Root Cause

`clipboard.saveImage` and `clipboard.readImage` authorize ownership with
`kodaxHost.get(sessionId) !== undefined`. That checks only currently instantiated sessions.
`session.send` already calls `kodaxHost.tryResume(sessionId)` for a selected persisted Session, but
image preparation necessarily runs before send, so the same legitimate Session is rejected before
the lazy-resume path can execute.

#### Resolution

- Attachment ownership admission now uses a side-effect-free Host probe. It accepts an already
  loaded or persisted Session without instantiating provider/runtime state merely to save a draft.
- `tryResume` is single-flight per Session ID and coordinates with delete and shutdown, preventing
  duplicate instances or resurrection after a successful delete/dispose.
- Persisted-session reads carry a cache invalidation epoch, and ownership probes are single-flight
  and drained by delete/shutdown. An asynchronous pre-delete snapshot therefore cannot repopulate
  the cache or admit a deleted Session.
- Unsafe, unknown, and deleted Session IDs remain fail-closed at schema, handler, and Host layers.
- Both `clipboard.saveImage` and `clipboard.readImage` use the same admission helper, so paste,
  drag-and-drop, and file selection cannot diverge.

Files changed:

- `apps/desktop/electron/ipc/clipboard.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/kodax/host.ts`
- `apps/desktop/electron/kodax/session-store.ts`
- `apps/desktop/electron/test/clipboard-save-image.test.ts`
- `apps/desktop/electron/test/host-try-resume.test.ts`
- `apps/desktop/electron/test/_helpers/session-store-mock.ts`
- `packages/space-ipc-schema/src/channels/clipboard.ts`
- `packages/space-ipc-schema/test/registry.test.ts`
- `docs/KNOWN_ISSUES.md`

Validation:

- Regression coverage accepts persisted owners without Runtime construction, rejects unsafe and
  unknown IDs, shares concurrent resume/owner probes, and serializes resume and ownership reads
  against delete and shutdown. A deterministic post-read race proves that invalidation cannot cache
  a stale pre-delete snapshot.
- The attachment, host-resume, host lifecycle, IPC-schema, history, Runtime projection, and
  activity regression suite passes 298/299 with one Windows symlink-permission skip.
- `npm run typecheck`, targeted ESLint, and `git diff --check` pass.
- `npm run build:win`, packaged-content smoke, and packaged boot smoke pass; the rebuilt
  `out/win-unpacked` reaches KodaX 0.7.77 daemon ready, Runtime host ready, and renderer ready.

### 118: Space rejects large source images before KodaX can normalize them

- Priority: Medium
- Status: In Progress
- Introduced: v0.1.9
- Created: 2026-07-27

#### Original Problem

Space describes 6 MiB as an image upload limit even though it delegates image normalization to the
public KodaX media component. Both renderer validation and the main-process decoded-byte check reject
an original image above 6 MiB before `normalizePastedImage` runs.

Expected behavior:

- Space keeps a bounded source-file/IPC limit for local memory and denial-of-service protection.
- A source image within that bound is normalized by KodaX before the final provider-safe size is
  enforced.
- Only the normalized image must fit the durable/send limit; normalization failure never falls back
  to an oversized raw source.

#### Context

- KodaX 0.7.77 exports `normalizePastedImage`, `MAX_DIMENSION = 2000`, and
  `TARGET_RAW_SIZE_BYTES = 3,932,160` (3.75 MiB).
- Its normalizer decodes the image, clamps dimensions, tries PNG, then JPEG quality 80/60/40, and
  throws stable `IMAGE_TOO_LARGE` when the target still cannot be met.
- The reported 5,171,342-byte PNG normalized successfully to 3,011,687 bytes in an isolated Space
  persistence probe.

#### Root Cause

Space uses one 6 MiB constant for two different boundaries: untrusted source bytes crossing IPC and
normalized bytes written into the Session attachment sandbox. This reverses the intended processing
order and bypasses the SDK's existing conversion capability for larger originals.

#### Interim Mitigation

- Space now exports separate 12 MiB source and 6 MiB normalized-image boundaries from its IPC
  schema and reuses those constants in the renderer and main process.
- Sources within 12 MiB reach KodaX normalization before the final 6 MiB durable/send limit is
  enforced. A source above 12 MiB is rejected before normalization.
- Normalization failure cannot fall back to raw bytes when the raw source is above the final limit,
  and an unexpectedly oversized normalizer result is rejected.
- Current in-app help and the user manual describe 12 MiB as a temporary source-processing guard
  for the base64 IPC/main-process path, not as KodaX's compression capability or final image limit.

#### Review Findings and Remaining Work

- 12 MiB is intentionally finite but not a capability-derived threshold. A valid 12,588,868-byte
  PNG rejected by the temporary guard normalized successfully through KodaX to a 2,705,693-byte
  JPEG, proving that source size does not predict final size.
- KodaX 0.7.77 calls `Jimp.read` before resizing and exposes no `maxPixels`, decode-memory budget,
  abort signal, or terminable worker boundary. A highly compressed, high-pixel image below 12 MiB
  can still exhaust or block the Electron main process.
- Space retains original base64 data URLs for previews and copies base64 across IPC. Raising or
  removing the source guard before changing that transport would multiply renderer/main memory.
- KodaX should add pre-decode signature/container and dimension checks, explicit byte/pixel/memory
  budgets, WebP support, and serial decoding in a terminable Worker/utility process.
- Space should use a main-authorized file/stream channel without trusting arbitrary renderer paths,
  preview normalized files instead of original base64, and enforce a measured per-batch budget.
- Only after memory and latency benchmarks should the temporary source limit be raised; the exact
  replacement value is intentionally not committed yet. The final 6 MiB hard limit and KodaX
  3.75 MiB normalization target remain appropriate.

Files changed:

- `packages/space-ipc-schema/src/channels/clipboard.ts`
- `packages/space-ipc-schema/src/index.ts`
- `packages/space-ipc-schema/test/registry.test.ts`
- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `apps/desktop/electron/ipc/clipboard.ts`
- `apps/desktop/electron/test/clipboard-save-image.test.ts`
- `apps/desktop/electron/kodax/space-manual-topics.ts`
- `docs/USER_MANUAL.zh-CN.md`
- `docs/KNOWN_ISSUES.md`

Validation:

- The supplied 5,171,342-byte PNG normalizes successfully with the installed KodaX 0.7.77 media
  component.
- A valid 10,057,798-byte PNG generated from the supplied image passed the real
  `saveClipboardImage` → KodaX pipeline and persisted as a 2,900,396-byte PNG; the probe then
  removed its draft artifact.
- Tests cover the exact source limit, final-output limit, normalization failure, oversized
  normalizer output, and schema boundaries.
- No KodaX SDK source change was required for the reported 5.17 MiB image, but SDK hardening is
  required before Space can safely promise broad large-source normalization.
- The rebuilt `out/win-unpacked/resources/app.asar` contains both the new source-limit path and
  lazy-resume ownership path, and packaged-content/boot smoke checks pass.

### 119: Restored history exposes overlapping internal compaction summaries as giant yellow notices

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.x
- Fixed: v0.1.33
- Created: 2026-07-27
- Resolution Date: 2026-07-27

#### Original Problem

After restarting Space and reopening Session `s_ff753e37-9590-4779-8d5a-5cb3ce94f6d8`, the
conversation displayed multiple giant yellow `Conversation compacted` blocks. Their content
substantially repeated the same goals, progress, decisions, and next steps, and a single block
could consume most of the transcript viewport.

Expected behavior:

- Restoring a Session does not expose cumulative internal compaction prompts as ordinary readable
  transcript content.
- Distinct compaction lineage entries remain available for fork/rewind audit instead of being
  deleted from history based only on their active flag or timestamp.
- Visibly adjacent compactions collapse to one compact boundary while persisted token statistics
  continue to resolve to the latest entry.
- Branch-return summaries remain readable.

#### Context

- The Session contains two real compaction lineage entries rather than a byte-identical record
  written again during restart.
- The first entry at `2026-07-27T07:49:45.757Z` is inactive and contains 12,961 summary characters.
- The second entry at `2026-07-27T08:32:52.526Z` is active and contains 10,875 summary characters.
- The two cumulative summaries overlap heavily, but `active` alone does not prove ancestry after
  fork, rewind, or selection of an earlier lineage node.

#### Root Cause

`dedupeTranscriptEntries` correctly retained distinct lineage records, but the history renderer
prefixed every full internal summary with `Conversation compacted:` and rendered it as a
warning-colored system notice. It also emitted one visible notice for each otherwise adjacent
compaction. Restart therefore revealed cumulative internal summaries as large, visually duplicated
yellow transcript blocks.

#### Resolution

- Preserve every distinct compaction lineage entry. Do not infer that an inactive entry was
  superseded solely because an active compaction exists elsewhere in the append order.
- Keep compaction events as compact history boundaries but remove their internal summaries from
  visible message text.
- Coalesce only consecutive _visible_ compaction notices when no user, assistant, tool, branch, or
  workflow content appears between them. Underlying lineage records and `compact_stats` events
  remain intact.
- Render localized boundary labels (`Conversation compacted` / `上下文已压缩`) while leaving
  branch-return summary content readable.
- Add regressions for compactions on both sides of an active node, renderer suppression of
  cumulative summary text, and adjacent visible-notice coalescing across compact-stat events.

Validation:

- A probe against the reported Session retains both lineage records (`active:false`,
  `active:true`) but composes them into one compact visible notice; the latest `tokensAfter: 62551`
  statistic remains authoritative in the store.
- The same 216-entry lineage scan retains 154 entries after canonical folding. Its only remaining
  exact message-content pair is two `_synthetic` `compaction-context` carriers, which the history
  projector already hides and therefore cannot create visible duplicate bubbles.
- Related transcript-dedup, message-composition, store, and history-replay tests pass 107/107.
- Full project typecheck, targeted ESLint, targeted code Prettier, and Git whitespace checks pass.

### 120: Space custom Providers were invisible to the shared Coder daemon and failed as unknown Providers

- Priority: High
- Status: Resolved
- Introduced: v0.1.32
- Fixed: v0.1.33
- Created: 2026-07-27
- Resolution Date: 2026-07-27

#### Original Problem

An OpenAI-compatible Provider configured in Space for local Ollama could pass direct endpoint and
SDK Provider tests but fail every real Coder run with:

`Provider run failed while using a run-scoped credential.`

The underlying Runtime Session error was:

`Unknown provider: custom_….`

Expected behavior:

- A Space-created custom Provider is immediately runnable by the shared Coder daemon.
- Existing Space custom Providers are runnable after upgrading or restarting.
- Add, edit, and delete cannot leave the Space store and daemon catalog in a silent split-brain
  state.

#### Root Cause

Space persisted custom Providers in `~/.kodax/custom-providers.json` and registered them through
`registerConfiguredCustomProviders`, which only updated the Electron main process's SDK registry.
Coder runs execute in a separate KodaX Runtime daemon, whose Provider registry and process memory
are independent. The run-scoped credential lease worked, but the daemon failed Provider resolution
before it could use the credential; Runtime then deliberately replaced the detailed Provider error
with its credential-safe generic message.

The KodaX SDK already exposes the correct daemon-connected integration surface through
`runtime.catalog.upsertCustomProvider` and `deleteCustomProvider`, so no SDK change was required.

#### Resolution

- Added Runtime Host Adapter catalog methods and a Space-to-Runtime reconciliation layer using the
  public KodaX Runtime catalog API.
- Startup now awaits best-effort reconciliation of every existing Space custom Provider before
  Provider IPC and the main window become available.
- Add, edit, and delete operations are serialized through a separately tested transaction
  coordinator across the Space store and daemon catalog.
- Runtime updates merge only Space-owned fields into the daemon's complete record. CLI/SDK-only
  fields and retained model descriptors survive, and failed mutations restore an exact pre-write
  catalog snapshot.
- The Electron main-process SDK registry uses the same merge, so Coder, Partner, Provider tests,
  and context-window queries observe consistent advanced metadata.
- Store caches are published only after durable writes succeed. Removing a default custom Provider
  treats the Provider file and default-selection file as one compensated operation.
- Failed catalog or store writes trigger compensating Runtime/store mutations; incomplete rollback
  is reported as an aggregate failure instead of returning a false success.
- KodaX-config-defined custom Providers continue to use their existing config reload path, while
  Space-store Providers use the daemon catalog path intended for connected settings UIs.

Files changed:

- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/kodax/user-config.ts`
- `apps/desktop/electron/providers/config.ts`
- `apps/desktop/electron/providers/custom-provider-mutations.ts`
- `apps/desktop/electron/providers/runtime-catalog.ts`
- `apps/desktop/electron/ipc/provider.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/test/custom-provider-mutations.test.ts`
- `apps/desktop/electron/test/provider-config.test.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `apps/desktop/electron/test/runtime-provider-catalog.test.ts`
- `apps/desktop/electron/test/user-config.test.ts`

Validation:

- Catalog and transaction regression tests verify sequential startup reconciliation, daemon proxy
  calls, exact-snapshot rollback, failure aggregation, mutation ordering, durable-store failure
  atomicity, and preservation of Runtime-only Provider/model metadata.
- Direct local Ollama probes for `ornith:35b` previously passed `/v1/models`, chat completion,
  streaming, and tool-call execution; the failure was isolated to daemon catalog visibility.
- The focused Provider/Runtime/config regression suite passes 128/128.
- Full workspace tests, TypeScript checks, ESLint, Git whitespace checks, and the production build
  smoke test pass.

### 121: Custom Provider settings could not declare the endpoint context window

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.x
- Fixed: v0.1.33
- Created: 2026-07-27
- Resolution Date: 2026-07-27

#### Original Problem

Space's custom Provider form exposed protocol, endpoint, model, reasoning, and cache-affinity
settings but no context-window field. A local model could therefore run with a real endpoint
context different from KodaX's metadata or fallback, producing an incorrect context budget and
compaction threshold.

Expected behavior:

- Users can optionally declare the Provider-level context window in tokens.
- The value survives list/edit/restart and reaches both the main-process SDK registry and daemon
  Runtime catalog.
- Empty values preserve SDK inference/fallback behavior, while invalid or unreasonable values are
  rejected consistently.

#### Root Cause

KodaX 0.7.77 already models `KodaXCustomProviderConfig.contextWindow`, but Space's narrower custom
Provider schema omitted it from the renderer form, IPC contracts, durable store, config
normalization, Provider list projection, and SDK conversion.

#### Resolution

- Added an optional integer `contextWindow` field, bounded to 1,024–10,000,000 tokens, across the
  public IPC schema, durable Provider schema, KodaX config adapter, Provider list, and Runtime
  catalog conversion.
- Added a localized numeric form field that distinguishes an empty SDK-derived value from an
  explicit endpoint limit and validates before submission.
- Marked `contextWindow` as Space-form-modeled when editing KodaX config Providers, so clearing the
  field actually removes a prior value while unrelated CLI-only fields remain preserved.
- The existing model-context query now receives the declared value through the same SDK Provider
  resolution path used by compaction.

Files changed:

- `packages/space-ipc-schema/src/channels/provider.ts`
- `packages/space-ipc-schema/src/index.ts`
- `packages/space-ipc-schema/test/provider.test.ts`
- `apps/desktop/electron/providers/config.ts`
- `apps/desktop/electron/kodax/user-config.ts`
- `apps/desktop/electron/ipc/provider.ts`
- `apps/desktop/electron/providers/runtime-catalog.ts`
- `apps/desktop/renderer/src/features/provider/CustomProviderForm.tsx`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `apps/desktop/electron/test/provider-config.test.ts`
- `apps/desktop/electron/test/user-config.test.ts`
- `apps/desktop/electron/test/runtime-provider-catalog.test.ts`

Validation:

- Schema tests accept valid add/update values and reject fractional and out-of-range values.
- Store and config-adapter tests verify persistence, SDK registration, update, clear, and
  unmodeled-field preservation.
- The reported Ollama model currently runs with a 131,072-token loaded context, so `131072` is the
  correct explicit Space value unless the Ollama runtime is reconfigured.
- The focused Provider/Runtime/config regression suite passes 128/128.
- Full workspace tests, TypeScript checks, ESLint, Git whitespace checks, and the production build
  smoke test pass.

### 122: Cumulative Runtime snapshots replayed streamed assistant output, thinking, and active tools in the renderer

- Priority: High
- Status: Resolved
- Introduced: v0.1.33
- Fixed: v0.1.33
- Created: 2026-07-27
- Resolution Date: 2026-07-27

#### Original Problem

Coder replies could visibly repeat the same growing answer many times in v0.1.33. The problem
reproduced with both a local Ollama `ornith:9b` OpenAI-compatible Provider and a non-Ollama
`glm-5.2` Provider. Thinking receipts could also report far more visible text than the daemon
actually emitted, and active tool cards could be duplicated or left looking active.

Expected behavior:

- Every `assistant.delta` and `thinking.delta` is appended exactly once.
- Reading the authoritative cumulative live snapshot is side-effect free and idempotent.
- Renderer reload, focus recovery, revision gaps, Runtime reconnect, and terminal reconciliation
  still recover an in-progress Session without leaving it stuck as Processing.
- Transcript hot-path events do not rebuild and rebroadcast an unchanged Runtime connection
  profile for every token.

#### Investigation Evidence

- Direct non-streaming and streaming calls to Ollama returned one greeting. Ollama's OpenAI stream
  emitted normal incremental chunks rather than cumulative prefixes.
- The affected Ollama Session JSONL persisted one 17-character greeting even though the renderer
  showed it four times.
- The affected GLM Session persisted one 299-character answer. Its daemon journal contained 158
  assistant delta events whose concatenation was exactly those 299 characters and contained the
  repeated screenshot phrase once.
- The GLM daemon journal also contained 80 thinking delta events totaling 156 characters, while
  the polluted renderer showed a roughly 936-token thinking receipt.
- KodaX's observation contract defines live snapshot draft strings as cumulative and subscription
  events after the observation cursor as incremental. The daemon projection and durable transcript
  followed that contract.

#### Root Cause and Introduction Timeline

The failure was a Space feedback loop, not a Provider or model-streaming defect:

1. Commit `33447978` (shared daemon integration, first shipped in v0.1.32) added
   `publishLegacySnapshot()`. A `session.liveSnapshot` read therefore had an undocumented side
   effect: it pushed the snapshot's cumulative assistant/thinking drafts and active tools through
   the legacy incremental `session.event` channel.
2. The same adapter refreshed the whole Runtime profile for every daemon event and emitted
   `runtime.connectionChanged` even when only the profile cursor/timestamp advanced. This made a
   transition-named channel behave like a per-token level notification.
3. Commit `a776cb4` on 2026-07-27 fixed Issue 116 by reconciling the selected live snapshot on every
   ready/degraded connection push, focus boundary, and terminal event. That was released in
   v0.1.33.
4. Each streamed token consequently scheduled another profile refresh, emitted another unchanged
   connection notification, requested another snapshot, and replayed a larger cumulative prefix
   as fresh deltas. The renderer correctly appended those alleged deltas, producing the triangular
   repetition visible in the screenshots.

The unsafe snapshot side effect was latent in v0.1.32, but the v0.1.33 reconciliation change made
it systematic. Issue 116's recovery requirement remains valid, so simply removing reconciliation
would have restored the earlier stuck-Processing bug.

The Ollama `ornith:9b` run that hallucinated repository contents without using tools is a separate
model/agent-capability behavior. It explains that run's verifier retries and final error, but not
the duplicated visible text. No KodaX SDK change is required for this Space projection defect.

#### Resolution

- Made `session.liveSnapshot` a pure query: it ensures observation and returns the authoritative
  projection without pushing any legacy transcript events.
- Removed the cumulative-to-incremental `publishLegacySnapshot()` bridge.
- Added Runtime/run cursor provenance to daemon-backed transcript events. The renderer records the
  latest accepted snapshot cursor per Session/run and separate assistant/thinking draft coverage
  watermarks, so a terminal snapshot that intentionally cleared its drafts cannot discard queued
  output it never contained.
- Added a per-Session causal delivery barrier: while a snapshot request is in flight, that
  Session's events remain queued while unrelated Sessions continue flushing. On success, the held
  lifecycle, tool, and delta events drain in their raw causal order before snapshot reconciliation;
  on failure or the bounded 10-second timeout, the Session always resumes.
- Snapshot text recovery handles an already-delivered prefix, suffix, overlap, or non-contiguous
  chunk sequence and remains idempotent on repeated reads. Runtime deltas are not merged a second
  time in the store, so their cursor boundary remains observable during recovery.
- Active tools are restored in causal order, so an orphan progress event is placed after its
  reconstructed start. Covered unresolved tools absent from the authoritative active set are
  removed instead of remaining visibly running after reconnect or terminal recovery.
- Treats Runtime connection pushes as edge-triggered reconciliation: initial authority, Runtime
  identity changes, reconnect, and ready/degraded transitions request a snapshot; timestamp-only
  refreshes do not.
- Preserves the original connection `changedAt` and suppresses `runtime.connectionChanged` when
  Runtime identity, state, staleness, profile, reason, and capabilities are unchanged.
- Restricts expensive Runtime profile refreshes to Session/Run/interaction events that can
  actually change the profile. Assistant/thinking/tool/Todo/diagnostic hot-path events continue
  through their dedicated live projection and transcript channels.

Files changed:

- `apps/desktop/electron/ipc/runtime.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/renderer/src/App.tsx`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/store/runtimeProjectionState.ts`
- `apps/desktop/renderer/src/store/runtimeSnapshotHydration.ts`
- `apps/desktop/renderer/src/store/sessionEventBatcher.ts`
- `packages/space-ipc-schema/src/channels/session.ts`
- `apps/desktop/electron/test/app-store-runtime-projection.test.ts`
- `apps/desktop/electron/test/coder-daemon-projection.test.ts`
- `apps/desktop/electron/test/runtime-projection-controller.test.ts`
- `apps/desktop/electron/test/runtime-projection-state.test.ts`
- `apps/desktop/electron/test/session-event-batcher.test.ts`
- `packages/space-ipc-schema/test/session.test.ts`

Validation:

- Regression coverage verifies pure snapshot IPC, connection-edge classification, hot-path profile
  filtering, timestamp-insensitive connection equality, both push/snapshot delivery orders,
  suffix-first bootstrap, missing-middle recovery, covered-versus-post-cursor batching, run-scoped
  late-event rejection, cumulative text/thinking hydration, raw lifecycle/tool drain ordering,
  progress-before-start repair, stale-tool removal, terminal draft coverage, terminal tool
  ordering, and active-tool idempotency.
- Two independent sub-Agent reviews reproduced suffix-first and missing-middle text races,
  progress-before-start/stale-tool gaps, terminal draft loss, lifecycle/tool inversion, and a
  potentially permanent paused queue in successive revisions of the fix; the per-draft cursor
  barrier, ordered drain, timeout, and adversarial tests above close those findings before release.
- The focused projection suite passes.
- Full workspace tests, TypeScript checks, ESLint, Git diff checks, and the production build smoke
  test pass.
- The repository-wide Prettier check still reports the existing formatting baseline outside this
  fix; no unrelated files were reformatted.

### 123: Space ignored KodaX split integration files and replaced valuable SDK self-manual content

- Priority: High
- Status: Resolved
- Introduced: KodaX 0.7.77 adoption
- Fixed: v0.1.33
- Created: 2026-07-28
- Resolution Date: 2026-07-28

#### Original Problem

KodaX 0.7.77 separated MCP, filesystem Extension, and A2A declarations from the core
`~/.kodax/config.json` file, but several Space paths and documents still treated root
`mcpServers`/`extensions` fields as canonical:

- project MCP discovery read `<project>/.kodax/config.json` directly;
- the Runtime Settings overview and MCP panel pointed users to the old root file;
- managed `integrations/extensions.json` paths did not participate in Space's opt-in SDK Extension
  discovery;
- current README/manual/architecture/release docs described the old storage model; and
- Space configured `kodax_manual` with `baseTopics: []`, so the desktop white-label overlay removed
  valuable original SDK mechanism guidance for providers, configuration, permissions, tools,
  Skills, Extensions, MCP, A2A, repository intelligence, Sessions, compaction, and the SDK.

Expected behavior:

- Space follows the exact installed KodaX public integration reader/CRUD/migration contract.
- New writes and user guidance use independently versioned `integrations/*.json` files while the
  SDK's legacy fields remain a truthful read-only migration fallback.
- Space product guidance augments the original SDK manual and cannot silently discard an
  SDK-recommended underlying-capability topic.

#### Root Cause

The 0.7.77 dependency update verified Runtime/provider behavior but did not audit every Space-owned
configuration reader, Settings projection, Extension discovery path, UI string, and current
document against the SDK's new integration templates. Separately, the earlier white-label manual
decision used full replacement to avoid CLI-only UX topics; it did not distinguish product UX from
the SDK's reusable mechanism topics.

#### Resolution

- Global and project MCP discovery now use `readMcpIntegration()` and canonical
  `integrations/mcp.json` paths. Same-name project servers retain precedence, invalid strict
  documents fail visibly, and legacy root fields remain readable until migration.
- `.mcpb` MCP mutations continue through SDK CRUD and every current error/UI path names the
  canonical file.
- Runtime Settings projects dedicated/legacy/default source, canonical path, existence, and server
  count independently from the core `config.json` overview.
- Opt-in SDK Extension discovery merges default discovery with
  `readExtensionsIntegration(...).document.paths` and deduplicates by entrypoint. In-process
  Extension execution remains disabled unless `KODAX_SPACE_ENABLE_SDK_EXTENSIONS=1`.
- `kodax_manual` seeds `KODAX_UNDERLYING_CAPABILITY_TOPICS`. Same-id Space topics dynamically
  include the exact installed `MANUAL_REGISTRY` body, aliases, and sources; curated topics without
  a Space overlay remain entirely SDK-owned.
- Current English/Chinese README, documentation hub, usage/manual, PRD/HLD, capability/feature
  ledgers, changelog, known issues, release design, readiness record, Settings text, and manual
  topics now agree on the split configuration and migration workflow.

Files changed include:

- `apps/desktop/electron/mcp/kodax-user-config-loader.ts`
- `apps/desktop/electron/mcp/config-reader.ts`
- `apps/desktop/electron/kodax/sdk-extensions.ts`
- `apps/desktop/electron/kodax/space-manual-topics.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/kodax/user-config.ts`
- `apps/desktop/renderer/src/features/settings/SettingsModal.tsx`
- `apps/desktop/renderer/src/shell/popouts/McpPanel.tsx`
- `packages/space-ipc-schema/src/channels/settings.ts`
- current release and product documentation

Validation:

- Focused tests cover global/project split MCP files, project precedence, strict-document failures,
  legacy fallback, Settings source projection, managed Extension paths, opt-in execution, and
  entrypoint deduplication.
- The manual regression iterates the complete SDK curated topic list, requires every same-id Space
  topic to contain the exact installed SDK body and sources, and resolves the effective manual to
  prove no recommended underlying topic disappeared.
- TypeScript checks and the focused schema/main-process suites pass; full release gates remain
  recorded in the v0.1.33 readiness document.

## Summary

- Total: 111
- Open: 2
- In Progress: 2
- Resolved: 107
- High: 48
- Medium: 56
- Low: 7
- Next to resolve: 043
