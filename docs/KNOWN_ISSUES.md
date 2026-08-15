# Known Issues

Last Updated: 2026-08-15

> Historical issue details are preserved as investigation evidence. Resolved items older than 30 days move to [ISSUES_ARCHIVED.md](ISSUES_ARCHIVED.md) without losing their investigation record. The latest published Space [`v0.1.41`](https://github.com/icetomoyo/KodaX-Space/releases/tag/v0.1.41) baseline uses exact npm Registry KodaX 0.7.87 and requires `sandboxRuntime:3`. Start from the [documentation hub](README.md) for current behavior and status.

## Issue Index

| ID  | Priority | Status             | Title                                                                                                                              | Introduced                                                   | Created    |
| --- | -------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------- |
| 013 | High     | Resolved           | Restored KodaX sessions could pair assistant segments with the following user prompt after consecutive user messages               | v0.1.29                                                      | 2026-07-08 |
| 014 | Medium   | Resolved           | Session rename reverted after switching sessions because manual titles were not persisted outside memory                           | v0.1.29                                                      | 2026-07-08 |
| 015 | High     | Resolved           | Partner capability redesign drift allowed overly broad workspace delivery writes and stale output registry state                   | v0.1.30                                                      | 2026-07-09 |
| 016 | High     | Resolved           | Partner helper VM exposed host constructors and allowed escape to Node process and unrestricted filesystem                         | v0.1.30                                                      | 2026-07-10 |
| 017 | High     | Resolved           | Partner corrupted Unicode PDF output and could not read PDF or Office sources                                                      | v0.1.30                                                      | 2026-07-10 |
| 018 | High     | Resolved           | Active queue watcher deleted Partner follow-up overlay before dequeue returned it                                                  | v0.1.30                                                      | 2026-07-10 |
| 019 | High     | Resolved           | Partner KB could not search Chinese and could overwrite corrupt durable state                                                      | v0.1.30                                                      | 2026-07-10 |
| 020 | High     | Resolved           | Partner file paths, writes, decoding, hashing, and durable stores had unsafe edge cases                                            | v0.1.30                                                      | 2026-07-10 |
| 021 | Medium   | Resolved           | Partner advertised unavailable SDK Skills and Outputs lacked an in-app delivery preview loop                                       | v0.1.30                                                      | 2026-07-10 |
| 022 | Medium   | In Progress        | KodaX Runtime lacks a general per-invocation execution service for Partner helper migration                                        | KodaX 0.7.66 adoption                                        | 2026-07-10 |
| 023 | Medium   | Resolved           | Composer file picker opened the project-directory dialog and could not select images or files                                      | v0.1.30                                                      | 2026-07-11 |
| 024 | High     | Resolved           | ACP placeholder sessions consumed the 200-row Space history window and hid real project sessions                                   | v0.1.30                                                      | 2026-07-11 |
| 025 | High     | Resolved           | KodaX ACP tests persist fixture sessions into the real user session/runtime directories                                            | KodaX 0.7.66                                                 | 2026-07-11 |
| 026 | High     | Resolved           | Space E2E test mode isolated app data but left the SDK session home pointed at the real user directory                             | v0.1.30                                                      | 2026-07-11 |
| 027 | High     | Resolved           | A global 200-session window let one busy project make other project histories appear empty                                         | v0.1.30                                                      | 2026-07-11 |
| 028 | High     | Resolved           | External Agent event pagination could skip audit events after the first 512 entries                                                | v0.1.30                                                      | 2026-07-12 |
| 029 | High     | Resolved           | Renderer could supply a new opaque Agent identity to the Reference update path                                                     | v0.1.30                                                      | 2026-07-12 |
| 030 | Medium   | Resolved           | Workflow external-target wrapper lost method receiver and did not always audit the resolved revision                               | v0.1.30                                                      | 2026-07-12 |
| 031 | High     | Resolved           | Packaged smoke still expected KodaX 0.7.66 after the 0.7.67 integration                                                            | v0.1.30                                                      | 2026-07-12 |
| 032 | High     | Resolved           | External Agent task IPC trusted renderer ownership and Task Dock could show/control stale cross-session tasks                      | v0.1.30                                                      | 2026-07-12 |
| 033 | Low      | Resolved           | Project Session spinner remained visible over already-restored rows after switching surfaces                                       | v0.1.30                                                      | 2026-07-12 |
| 034 | Medium   | Resolved           | Task Dock width presets drifted from responsive default, explicit half, and full-workspace behavior                                | v0.1.30                                                      | 2026-07-12 |
| 035 | Medium   | Resolved           | Project Session refresh rescanned the full history tree and made empty Coder/Partner scopes slow                                   | v0.1.30                                                      | 2026-07-12 |
| 036 | Medium   | Resolved           | New Sessions ignored the provider/model most recently selected in the active Session                                               | v0.1.31                                                      | 2026-07-13 |
| 037 | Medium   | Resolved           | Partner output links lost their Delivery identity and were incorrectly resolved as project files                                   | v0.1.31                                                      | 2026-07-14 |
| 038 | Medium   | Resolved           | File-backed Markdown opened in Artifact as raw Monaco source instead of a document reading preview                                 | v0.1.31                                                      | 2026-07-14 |
| 039 | Medium   | Resolved           | Partner kept a duplicate collapsed-sidebar edge rail alongside the shared header toggle                                            | v0.1.31                                                      | 2026-07-14 |
| 040 | Low      | Resolved           | Adjacent command and thinking receipt chips render at different heights                                                            | v0.1.31                                                      | 2026-07-14 |
| 041 | Medium   | Resolved           | Every assistant text block in a user turn reuses the Query timestamp instead of its own output time                                | v0.1.31                                                      | 2026-07-14 |
| 042 | High     | Resolved           | Interactive HTML Artifact can show only its static shell and keep stale content after a new version                                | v0.1.31                                                      | 2026-07-14 |
| 043 | High     | In Progress        | Unsigned macOS releases repeatedly request the login password for Provider Keychain access                                         | v0.1.4                                                       | 2026-07-14 |
| 044 | Low      | Resolved           | Windows portable executable icon can render as missing or inconsistently across shell sizes                                        | v0.1.31                                                      | 2026-07-15 |
| 045 | Low      | Resolved           | New-conversation mode selectors append a confusing `next` suffix                                                                   | v0.1.x                                                       | 2026-07-15 |
| 046 | High     | Resolved           | F121 live projection and daemon lease lifecycles could diverge across attached Space clients                                       | v0.1.32 development                                          | 2026-07-15 |
| 047 | Low      | Resolved           | Long user queries consume excessive transcript height without an inline collapse control                                           | v0.1.x                                                       | 2026-07-16 |
| 048 | Low      | Resolved           | Legacy `tsx/esm` test registration corrupts CommonJS JSON imports from the KodaX SDK dependency graph                              | v0.1.x                                                       | 2026-07-17 |
| 049 | Medium   | Resolved           | Provider/model and mode changes rolled back before the first send because the daemon Session was not admitted                      | v0.1.32 development                                          | 2026-07-17 |
| 050 | Medium   | Resolved           | Reference Agent continuation can remain `working` after `sendInput` until an explicit reconcile                                    | KodaX 0.7.72                                                 | 2026-07-17 |
| 051 | Low      | Resolved           | Embedded Runtime omits the working `externalAgentAdmin` service from its public capability metadata                                | KodaX 0.7.72                                                 | 2026-07-17 |
| 052 | Medium   | Resolved           | Composer could send text before an asynchronously attached image entered the artifact payload                                      | v0.1.9                                                       | 2026-07-17 |
| 053 | Medium   | Resolved           | Restored daemon runs rejected queued prompts because the composer requested unsupported interrupt delivery                         | v0.1.32 development                                          | 2026-07-17 |
| 054 | High     | Resolved           | Daemon permission dialogs discarded command, directory, and operation context                                                      | v0.1.31                                                      | 2026-07-17 |
| 055 | High     | Resolved           | Ark multimodal follow-ups rejected supported model routes during artifact preflight                                                | <= v0.1.31                                                   | 2026-07-17 |
| 056 | High     | Resolved           | Restored daemon Sessions lost Auto mode, exposed an unwired plan exit, and reset AskUser choices                                   | v0.1.32 development                                          | 2026-07-17 |
| 057 | High     | Resolved           | Auto LLM sent an empty classifier model after daemon observation erased the provider default                                       | v0.1.32 development                                          | 2026-07-19 |
| 058 | High     | Resolved           | Auto LLM diagnosis exposed a stale 8-second process while Space did not seed daemon classifier defaults                            | v0.1.32 development                                          | 2026-07-19 |
| 059 | Medium   | Resolved           | KodaX Runtime does not publish complete effective Auto LLM settings or timeout-phase telemetry                                     | KodaX 0.7.72                                                 | 2026-07-19 |
| 060 | High     | Resolved           | Space restart during daemon run admission aborted the accepted Coder run and startup health failures did not reconnect             | v0.1.32 development                                          | 2026-07-20 |
| 061 | High     | Resolved           | No-Session File Viewer calls `artifact.previewFile` without legacy-required Session fields and cannot open project files           | v0.1.32 development                                          | 2026-07-20 |
| 062 | Medium   | Resolved           | Composer sent renderer `file://` attachment links to the model instead of exact native filesystem paths                            | v0.1.30                                                      | 2026-07-20 |
| 063 | Medium   | Resolved           | Pasted image normalization could send JPEG bytes with a stale PNG media type and make mixed image attachments fail                 | v0.1.32-hotfix.0                                             | 2026-07-20 |
| 064 | Medium   | Resolved           | Space ignored Runtime-issued concrete permission grants, so Always allow was absent or rejected                                    | KodaX 0.7.73 adoption                                        | 2026-07-20 |
| 065 | Medium   | Resolved           | Project Files sidebar hides file extensions and keeps a stale directory tree                                                       | v0.1.32                                                      | 2026-07-21 |
| 066 | Medium   | Resolved           | Changes panel displayed non-ASCII Git paths as octal escapes and could not open their diffs                                        | v0.1.4                                                       | 2026-07-21 |
| 067 | Medium   | Resolved           | Partner project-file rows select an attachment target but do not open the file viewer                                              | v0.1.32                                                      | 2026-07-21 |
| 068 | High     | Resolved           | Project HTML preview loses relative assets and hides sandbox/runtime failures that work in a browser                               | v0.1.32                                                      | 2026-07-21 |
| 069 | High     | Resolved           | Coder daemon converted interrupt follow-ups into separate sequential after-turn runs                                               | v0.1.32 development                                          | 2026-07-21 |
| 070 | High     | Resolved           | Large or dependency-backed HTML Artifacts can be misclassified as static and render blank or incomplete                            | v0.1.32                                                      | 2026-07-21 |
| 071 | High     | Resolved           | Daemon compaction telemetry is dropped, so `/compact` appears frozen and context usage grows past a stale threshold                | v0.1.32 development                                          | 2026-07-21 |
| 072 | High     | Resolved           | E2E cleanup hangs until timeout because the isolated shared daemon keeps Electron test pipes open                                  | v0.1.32 development                                          | 2026-07-21 |
| 073 | Medium   | Resolved           | Artifact HTML E2E scenarios focus Session-owned Artifacts before creating a Session                                                | v0.1.32 development                                          | 2026-07-21 |
| 074 | High     | Resolved           | Artifact bootstrap CSP blocks Blob workers that the in-document preview policy explicitly allows                                   | v0.1.32 development                                          | 2026-07-21 |
| 075 | High     | Resolved           | Runtime manual compaction duplicates canonical events and permits stale token projection                                           | v0.1.32 development                                          | 2026-07-21 |
| 076 | High     | Resolved           | Effective compaction threshold can be paired with a different fallback context window                                              | v0.1.32 development                                          | 2026-07-21 |
| 077 | High     | Resolved           | Repacked KodaX 0.7.74 leaves the release lockfile with stale integrity                                                             | v0.1.32 development                                          | 2026-07-21 |
| 078 | Medium   | Resolved           | History restore regression asserts the pre-canonical compaction token shape                                                        | v0.1.32 development                                          | 2026-07-21 |
| 079 | High     | Resolved           | Space compatibility gate did not prove the KodaX 0.7.74 Auto permission semantics                                                  | v0.1.32 development                                          | 2026-07-21 |
| 080 | Medium   | Resolved           | One clipboard image can enter the composer twice through duplicate Web clipboard representations                                   | v0.1.25                                                      | 2026-07-22 |
| 081 | Medium   | Resolved           | Project Files mode removes the persistent Settings row from the left sidebar                                                       | v0.1.29                                                      | 2026-07-22 |
| 082 | Medium   | Resolved           | Consumed daemon interrupt prompt can remain as a duplicate queued bubble when Runtime appends a prompt overlay                     | v0.1.32 development                                          | 2026-07-22 |
| 083 | High     | In Progress        | Late accepted daemon interrupt can be terminalized without delivery when its Run finishes during finalization                      | v0.1.32 development                                          | 2026-07-22 |
| 084 | High     | Resolved           | Daemon child-agent prose, thinking, and tools are merged into the parent transcript and live snapshot                              | v0.1.32 development                                          | 2026-07-22 |
| 085 | High     | Resolved           | Background Session prompts could block the visible Session while their sidebar owner remained hidden                               | v0.1.32 development                                          | 2026-07-23 |
| 086 | Medium   | Resolved           | Assistant/tool-leading restored history rendered a fabricated empty user message                                                   | v0.1.x                                                       | 2026-07-23 |
| 087 | Medium   | Resolved           | Windows 10/11 taskbar could ignore the live Space window icon or reuse stale Portable identity                                     | v0.1.x                                                       | 2026-07-23 |
| 088 | Medium   | Resolved           | Other KodaX instance indicator could route an unknown peer into a blank orphan Session                                             | v0.1.x                                                       | 2026-07-23 |
| 089 | High     | Resolved           | A same-version stale daemon could fail the required capability gate and leave Coder unusable                                       | v0.1.32 development                                          | 2026-07-23 |
| 090 | Medium   | Resolved           | Closing the last Space window left the daemon running without a visible or controllable background surface                         | v0.1.x                                                       | 2026-07-23 |
| 091 | Medium   | Resolved           | Ordinary Windows queries can flash several short-lived command windows from KodaX Runtime child processes                          | KodaX 0.7.74 adoption                                        | 2026-07-23 |
| 092 | Medium   | Resolved           | Isolated Electron tests leaked Runtime client credentials into the OS keychain                                                     | v0.1.32 development                                          | 2026-07-23 |
| 093 | Medium   | Resolved           | Artifact and File Viewer Markdown omitted Mermaid and document-local resource support                                              | v0.1.31                                                      | 2026-07-24 |
| 094 | Medium   | Resolved           | Failed interrupt bubble followed the transcript tail instead of staying at its failure-time position                               | v0.1.32 development                                          | 2026-07-24 |
| 095 | Medium   | Resolved           | Changes panel collapsed a fully untracked directory into one row and hid its individual files                                      | v0.1.x                                                       | 2026-07-24 |
| 096 | Medium   | Resolved           | Linux CI lacked an OS keychain and silently projected Runtime A2A as hidden                                                        | v0.1.32 development                                          | 2026-07-25 |
| 097 | Medium   | Resolved           | Successful document extraction forcibly terminated its Worker during Windows native-module cleanup                                 | v0.1.32 development                                          | 2026-07-25 |
| 098 | Medium   | Resolved           | A narrow Windows viewport required two clicks to open the right-side Task Dock                                                     | v0.1.32 development                                          | 2026-07-25 |
| 099 | Medium   | Resolved           | Clean Electron main builds omitted generated runtime icons and disabled the Windows tray                                           | v0.1.32 development                                          | 2026-07-25 |
| 100 | Medium   | Resolved           | Interactive HTML Artifact could accept its first click before document controls were initialized                                   | v0.1.32 development                                          | 2026-07-25 |
| 101 | Medium   | Resolved           | Project HTML File Viewer could accept its first click before module controls were initialized                                      | v0.1.32 development                                          | 2026-07-25 |
| 102 | Medium   | Resolved           | Partner PDF text Workers could unload an unused native Canvas module with a Windows access violation                               | v0.1.32 development                                          | 2026-07-25 |
| 103 | Medium   | Resolved           | Shared-daemon release probe started its event deadline before the peer performed its settings mutation                             | v0.1.32 development                                          | 2026-07-25 |
| 104 | Medium   | Resolved           | Interactive HTML could report ready before its out-of-process frame committed an interactive hit-test surface                      | v0.1.32 development                                          | 2026-07-25 |
| 105 | Medium   | Resolved           | Space builtin skills disappeared from slash completion when the Coder daemon runtime was selected                                  | v0.1.32                                                      | 2026-07-26 |
| 106 | Medium   | Resolved           | File Viewer fallback reported authorization-scope rejection as though an existing external file were missing                       | v0.1.32                                                      | 2026-07-26 |
| 107 | Medium   | Resolved           | Context-window popover mixed physical capacity, automatic-compaction headroom, and reserved response capacity                      | v0.1.32                                                      | 2026-07-26 |
| 108 | High     | Resolved           | Electron native-binding probe could report an incompatible better-sqlite3 ABI as healthy                                           | v0.1.32                                                      | 2026-07-26 |
| 109 | Medium   | Resolved           | Cross-Provider cache field semantics made a 25k Qwen input look like six ordinary tokens                                           | v0.1.32                                                      | 2026-07-26 |
| 110 | High     | Resolved           | Restored Session history can render one complete user/assistant turn twice                                                         | v0.1.32                                                      | 2026-07-26 |
| 111 | Medium   | Resolved           | Latest-request input was labeled as a still-pending queue while zero context categories disappeared                                | v0.1.32                                                      | 2026-07-26 |
| 112 | High     | Resolved           | Windows PTY and Coder command tools could not find runtimes initialized by the user's shell                                        | v0.1.x / KodaX 0.7.76                                        | 2026-07-27 |
| 113 | Medium   | Resolved           | Native child Agent lifecycle is not synchronized into Task Dock and right-sidebar status                                           | v0.1.32 / KodaX 0.7.72 adoption                              | 2026-07-27 |
| 114 | Medium   | Resolved           | Delivered mid-turn prompt could jump above the preceding interrupt response                                                        | v0.1.32                                                      | 2026-07-27 |
| 115 | High     | Resolved           | Missing temporary clipboard images can permanently poison restored Provider runs                                                   | v0.1.9                                                       | 2026-07-27 |
| 116 | High     | Resolved           | Completed daemon Session can remain stuck on Processing result in the renderer                                                     | v0.1.32                                                      | 2026-07-27 |
| 117 | High     | Resolved           | Image attachment fails when the selected persisted Session has not been lazily resumed                                             | v0.1.32                                                      | 2026-07-27 |
| 118 | Medium   | In Progress        | Space rejects large source images before KodaX can normalize them                                                                  | v0.1.9                                                       | 2026-07-27 |
| 119 | Medium   | Resolved           | Restored history exposes overlapping internal compaction summaries as giant yellow notices                                         | v0.1.x                                                       | 2026-07-27 |
| 120 | High     | Resolved           | Space custom Providers were invisible to the shared Coder daemon and failed as unknown Providers                                   | v0.1.32                                                      | 2026-07-27 |
| 121 | Medium   | Resolved           | Custom Provider settings could not declare the endpoint context window                                                             | v0.1.x                                                       | 2026-07-27 |
| 122 | High     | Resolved           | Cumulative Runtime snapshots replayed streamed assistant output, thinking, and active tools in the renderer                        | v0.1.33                                                      | 2026-07-27 |
| 123 | High     | Resolved           | Space ignored KodaX split integration files and replaced valuable SDK self-manual content                                          | KodaX 0.7.77 adoption                                        | 2026-07-28 |
| 124 | High     | Resolved           | Coder runtime-mode switching admitted new work and could persist an inconsistent owner state                                       | corrected v0.1.33                                            | 2026-07-28 |
| 125 | High     | Resolved           | Invalid optional integration config could abort Coder daemon startup without actionable diagnostics                                | v0.1.32 / KodaX 0.7.76                                       | 2026-07-28 |
| 126 | Medium   | Resolved           | Sent and restored image attachments disappear from visible user messages                                                           | v0.1.9                                                       | 2026-07-28 |
| 127 | High     | Resolved           | Runtime-mode recovery could reopen admission or forget the clean-profile migration state                                           | corrected v0.1.33                                            | 2026-07-28 |
| 128 | High     | Resolved           | Packaged Electron daemon shell probes fail before execution and Auto LLM reports Bash as disabled                                  | KodaX 0.7.86 adoption                                        | 2026-07-28 |
| 129 | High     | Resolved           | Packaged builds consumed nested KodaX development junctions and omitted transitive runtime dependencies                            | corrected v0.1.33                                            | 2026-07-28 |
| 130 | High     | Resolved           | Runtime-mode switching left Workflow, Slash, and External Agent executable entry points outside admission                          | corrected v0.1.33                                            | 2026-07-28 |
| 131 | Medium   | Resolved           | Complete exit leaves the main window visible during shutdown and appears to require a second close                                 | v0.1.33                                                      | 2026-07-28 |
| 132 | Low      | Resolved           | Retired renderer loading UI flashes between the randomized startup splash and the application shell                                | v0.1.33                                                      | 2026-07-28 |
| 133 | High     | In Progress        | macOS/Linux quit and failed Windows complete-exit could leave an invisible Coder daemon without a control surface                  | v0.1.32 daemon adoption                                      | 2026-07-28 |
| 134 | High     | Resolved           | Packaged sandbox helpers resolved inside app.asar and failed before command execution                                              | KodaX 0.7.78 sandbox adoption                                | 2026-07-29 |
| 135 | High     | Resolved           | Restored history could place the previous assistant reply below a newly sent query after a completed interrupt run                 | positional transcript projection                             | 2026-07-29 |
| 136 | High     | In Progress        | Restored transcript merging and legacy compaction reconciliation can relocate or physically duplicate conversation history         | KodaX 0.7.50 / Space v0.1.27; exposed more broadly by 0.7.74 | 2026-07-30 |
| 137 | Medium   | Resolved           | Live committed compactions omit the transcript boundary that history replay adds after reopen                                      | v0.1.27 history-notice projection                            | 2026-07-30 |
| 138 | Medium   | Resolved           | Session history silently retains the oldest 2,000 projected items and can omit the newest visible tail                             | bounded session.history IPC projection                       | 2026-07-30 |
| 139 | Low      | Resolved           | Pinned task metrics wrapped out of alignment and long header labels used clipped native tooltips                                   | v0.1.34 task summary header                                  | 2026-07-30 |
| 140 | Medium   | Resolved           | Session-cumulative Actor snapshots leaked previous-turn Agents into current task counts and cards                                  | v0.1.34 Runtime Actor task projection                        | 2026-07-30 |
| 141 | Medium   | Resolved           | `.agent` runtime artifacts consumed the Changes panel's 200-file limit before meaningful project files                             | v0.1.34 Git changes projection                               | 2026-07-30 |
| 142 | Medium   | In Progress        | Full-effects history restoration mounts and animates an entire long transcript beneath a live backdrop surface                     | current ConversationStreamV2 / full-effects renderer         | 2026-07-30 |
| 143 | High     | In Progress        | Per-fragment Runtime stream events saturate persistence, IPC, and long-Session renderer updates                                    | KodaX typed Runtime streaming + current Space event bridge   | 2026-07-30 |
| 144 | Medium   | Resolved           | Complete exit reports failure when daemon transport closes before its successful rollback reply                                    | KodaX 0.7.79 integration                                     | 2026-07-31 |
| 145 | High     | Resolved           | Session hover and selection can multiply full-history materialization before applying the UI window                                | v0.1.31 hover prefetch / Runtime paging integration          | 2026-08-01 |
| 146 | High     | In Progress        | Stop can cross a history writer boundary and Runtime cancellation can end as a credential failure                                  | v0.1.34 development / KodaX 0.7.79 integration               | 2026-08-01 |
| 147 | High     | Resolved           | Ordinary-conversation adoption could lose Space notices and use stale or inexact history boundaries                                | KodaX 0.7.79 Space integration                               | 2026-08-01 |
| 148 | High     | Resolved           | Blocked complete exit offered no force-close escape hatch and could trap the user in Space                                         | v0.1.34 F140 complete-exit hardening                         | 2026-08-01 |
| 149 | High     | Resolved           | A completed Runtime Run could leave a stale live projection and keep the Session spinner on Thinking                               | v0.1.34 / KodaX 0.7.79 Space integration                     | 2026-08-01 |
| 150 | High     | Resolved           | Packaged cold Coder daemon initialization can block the real renderer for 20-50 seconds                                            | v0.1.34 packaged build / KodaX 0.7.79                        | 2026-08-02 |
| 151 | Low      | Resolved           | Unlabeled fenced Markdown blocks were misclassified as inline code and rendered in the danger palette                              | v0.1.x conversation Markdown renderer                        | 2026-08-02 |
| 152 | Medium   | Resolved           | Pristine empty KodaX Sessions return different direct and paged canonical conversation boundaries                                  | KodaX 0.7.79 local test package                              | 2026-08-02 |
| 153 | Medium   | Resolved           | A newest canonical page beginning inside one multi-input Runtime turn lacks an exact live reconciliation identity                  | KodaX 0.7.81 canonical interrupt entry identity              | 2026-08-02 |
| 154 | Low      | Resolved           | Expanded right-sidebar plans kept additional steps permanently hidden behind a non-interactive count                               | v0.1.34 right-sidebar plan summary                           | 2026-08-03 |
| 155 | Medium   | Resolved           | First idle complete-exit request reopened Space after a recovered Runtime owner-transition race                                    | v0.1.34 / KodaX 0.7.79 complete-exit integration             | 2026-08-03 |
| 156 | Medium   | Resolved           | Renderer history cache could preserve a stale partial-lineage warning after canonical storage changed                              | v0.1.34 bounded canonical history paging                     | 2026-08-03 |
| 157 | Medium   | Resolved           | Fresh-start complete exit gave no visible feedback while startup admission drained                                                 | v0.1.34 complete-exit interaction                            | 2026-08-03 |
| 158 | High     | Resolved           | Embedded Auto tools were re-approved by Space after the KodaX guardrail had already allowed them                                   | v0.1.34 / KodaX 0.7.79 Auto permission integration           | 2026-08-03 |
| 159 | High     | Resolved           | Complete exit could release daemon ownership while the detached process still locked the packaged output directory                 | v0.1.34 / KodaX 0.7.79 complete-exit integration             | 2026-08-03 |
| 160 | High     | Resolved           | Pre-push review exposed history mutation, cache, notice persistence, and permission ownership gaps                                 | v0.1.34 development snapshot                                 | 2026-08-03 |
| 161 | Medium   | Resolved           | Space pinned the retired 20-second Auto LLM deadline over KodaX's corrected 30-second default                                      | v0.1.34 / KodaX 0.7.79 Auto integration                      | 2026-08-03 |
| 162 | Medium   | Resolved           | Space did not configure or project KodaX sandbox environment passthrough into SDK Runs                                             | v0.1.34 / refreshed KodaX 0.7.79 sandbox contract            | 2026-08-03 |
| 163 | High     | Resolved           | A newly sent query could temporarily take ownership of an older restored reply until Space restarted                               | v0.1.34 history/live transcript projection                   | 2026-08-04 |
| 164 | High     | Resolved           | Forked restored events were reclassified as live and replayed after the child-only query                                           | v0.1.34 fork/history hydration projection                    | 2026-08-04 |
| 165 | High     | Open               | Stop on a managed daemon Run left it stuck as stop_outcome_unconfirmed; spinner never cleared and sends failed with stale_run      | KodaX 0.7.79 managed-task Stop / Space run-phase projection  | 2026-08-04 |
| 166 | High     | Resolved           | One parallel Session's transcript content transiently appeared inside another Session's view while scrolling up                    | v0.1.34 renderer history and presentation isolation          | 2026-08-04 |
| 167 | High     | Resolved           | Send admission reread mutable Session history and surfaced transient topology changes as a raw HANDLER_ERROR                       | v0.1.34 Runtime admission boundary                           | 2026-08-04 |
| 168 | High     | Resolved           | Thinking output could stream while stale idle snapshots hid both the activity spinner and Stop button                              | v0.1.34 Runtime event/snapshot arbitration                   | 2026-08-04 |
| 169 | High     | Resolved           | A pre-admission failure could shift every later Run output one query to the left                                                   | v0.1.34 terminal compatibility segmentation                  | 2026-08-04 |
| 170 | Medium   | Resolved           | A transient data_changed during runs.start surfaced after optimistic acceptance instead of retrying safely                         | v0.1.34 managed Runtime admission                            | 2026-08-04 |
| 171 | High     | Resolved           | A bounded newest history page starting mid-turn could place the next answer above its query and the prior answer below it          | v0.1.34 history/live leading-page reconciliation             | 2026-08-04 |
| 172 | High     | Resolved           | Live transcript events dropped Runtime turn identity, so an overtaking history revalidation could duplicate and reorder a new turn | v0.1.34 Runtime bridge and ready-history revalidation        | 2026-08-04 |
| 173 | High     | Resolved           | Reopening or switching an active Session could lose its in-flight transcript and leave sidebar activity stale                      | v0.1.34 renderer Runtime observation bootstrap               | 2026-08-05 |
| 174 | High     | Resolved           | Interrupt or after-turn send could race active Session persistence and restore the draft with session_data_changed                 | v0.1.36 / KodaX 0.7.82 active-run admission                  | 2026-08-05 |
| 175 | High     | Resolved           | Safe close could reject an idle app after hiding it, then succeed only on a second close                                           | v0.1.37 complete-exit / Windows daemon cleanup               | 2026-08-06 |
| 176 | High     | Resolved           | Reactivating an invalidated active Session could duplicate or misplace its newest query and answer until Ctrl+R                    | v0.1.38 Session reactivation recovery                        | 2026-08-06 |
| 177 | High     | Resolved           | History reconciliation could duplicate a recovered answer or place compact notices after a later answer                            | v0.1.38 history/live and local-notice reconciliation         | 2026-08-08 |
| 178 | High     | Resolved in source | Actor durability unknown blocked input, dropped the live turn after Stop, and misreported self-fence as foreign ownership          | KodaX 0.7.85 / Space v0.1.39                                 | 2026-08-09 |
| 179 | Medium   | Resolved           | Idle Space exit reported running tasks when only other Runtime clients remained connected                                          | v0.1.39 complete-exit client protection                      | 2026-08-11 |
| 180 | High     | Resolved           | A crashed inline owner permanently blocked daemon startup until the customer deleted `~/.kodax`                                    | v0.1.38 / KodaX 0.7.84 owner-policy reconciliation           | 2026-08-14 |
| 181 | High     | Resolved           | Daemon Provider recovery could leave an abandoned answer attempt in the live transcript until Ctrl+R                               | v0.1.38 daemon Runtime recovery projection                   | 2026-08-14 |
| 182 | High     | Resolved in source | A bounded newest page could pair an earlier live answer with the next query until Ctrl+R                                           | v0.1.41 canonical/live leading-page reconciliation           | 2026-08-15 |
| 183 | High     | Resolved in source | A successful no-retry Run could render both canonical and unacknowledged live copies until Ctrl+R                                  | v0.1.41 terminal live-owner identity reconciliation          | 2026-08-15 |
| 184 | High     | In Progress        | A continued Run could attach cumulative prior-turn output to the latest query while ambiguous compaction survived reload           | v0.1.38 daemon live projection / KodaX 0.7.87 compaction     | 2026-08-15 |
| 185 | High     | Resolved in source | A delayed old Run terminal could close the current query while a Session-level notification reported another Run                   | v0.1.38 daemon transcript / completion notifications         | 2026-08-15 |

## Issue Details

### 180: A crashed inline owner permanently blocked daemon startup until the customer deleted `~/.kodax`

- Priority: High
- Status: Resolved
- Introduced: v0.1.38 / KodaX 0.7.84 owner-policy reconciliation
- Fixed: v0.1.40 / KodaX 0.7.86
- Created: 2026-08-11
- Resolution Date: 2026-08-14

#### Problem and root cause

Daemon-mode startup treated every parseable owner snapshot under inline policy
as active and rejected it before calling the SDK. If the prior inline owner had
crashed, the stale fence therefore had no protocol-safe recovery path. Deleting
`~/.kodax` removed the fence but also risked deleting unrelated sessions and
configuration.

#### Resolution

- Space now delegates every readable inline-policy transition to the existing
  SDK daemon-enable command and continues only after that command succeeds.
- KodaX performs stale-inline proof, exact deletion, and policy commit inside
  its owner-policy critical section; Space does not parse or delete SDK files.
- Active, malformed, daemon-kind, legacy-kind, and unverifiable owners still
  block startup.
- Failed inline close retains its handle so release remains retryable.

See
[ISSUE_180_UNRELEASED_REGRESSION_GUIDE.md](test-guides/ISSUE_180_UNRELEASED_REGRESSION_GUIDE.md).

### 178: Actor durability unknown blocked input, dropped the live turn after Stop, and misreported self-fence as foreign ownership

- Priority: High
- Status: Resolved in source
- Introduced: KodaX 0.7.84 / Space v0.1.38
- Fixed target: KodaX v0.7.85 / Space v0.1.39
- Created: 2026-08-09

#### Problem

During a live multi-Agent Run, delayed Actor snapshot persistence moved the Run
to `unknown` while the root provider continued working. Space then rejected all
normal sends as `stale_run`. Manual Stop could make the optimistic query and
streamed output disappear when canonical history lacked that incomplete turn.
Further `spawn_agent` calls reported `actor_owner_conflict` even though the
controller had self-fenced inside the same Runtime rather than lost ownership
to a foreign process.

#### Resolution

- Space now resolves the exact npm Registry KodaX 0.7.85 bytes and requires
  both `actorSettlementConvergence:1` and `sessionEventJournal:1`; it cannot
  claim this UX from the package version alone.
- All composer paths convert input during `unknown` to one acknowledged
  after-turn continuation. Runtime retains it behind the exact fenced Run and
  starts it only after same-owner repair and a durable prior terminal.
- Stop transports the visible exact Run ID end-to-end and validates the receipt
  before presenting success.
- Live transcript pruning now needs exact canonical folding proof; a terminal
  event alone cannot erase a query/output turn whose Session commit is absent.
- KodaX fail-closes root and child work, automatically repairs only exact
  same-owner state, and reports causal `actor_settlement_not_persisted` for
  self-fence. A real foreign owner still reports `actor_owner_conflict`.
- Space retains the complete Session journal cursor and resets watermarks on
  epoch rollover, so stale active state cannot survive a daemon restart merely
  because an older or different Session had a higher sequence number.

#### Release boundary

The source fix and exact dependency pin are complete. Production Windows
packaging, package smoke, and packaged boot smoke pass against the official
0.7.85 bytes. The packaged Windows fault-injection run and the tagged v0.1.39
release workflow are complete; the public release is recorded in the
release-readiness document and the Issue 178 regression guide.

### 179: Idle Space exit reported running tasks when only other Runtime clients remained connected

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.38 complete-exit client protection
- Fixed: v0.1.39 source maintenance
- Created: 2026-08-11
- Resolution Date: 2026-08-11

#### Original Problem

When Space had no active or queued work, complete exit still showed “tasks are running” whenever
the shared Runtime reported only `connected_clients`. The user had to choose a misleading force
close action even though exiting Space could safely leave the shared Runtime available to those
other clients.

Expected behavior: `connected_clients` alone should keep the shared Runtime alive without blocking
Space exit. Space-owned work and other Runtime work blockers must retain the existing confirmation
and preservation behavior.

#### Context

- The Runtime stop preflight correctly treats multiple logical clients as a daemon-stop blocker.
- Space merged daemon-stop blockers with Space-owned work blockers and presented all of them as
  running tasks.

#### Root Cause

Complete exit did not distinguish “Space cannot exit safely” from “the shared Runtime cannot stop
safely.” It therefore routed a daemon-retention condition through the task-cancellation prompt.

#### Resolution

- Complete-exit preflight now distinguishes a daemon-stop blocker from a Space-exit blocker.
- When `connected_clients` is the only Runtime blocker and Space owns no active work, Space commits
  an exit that disconnects its Runtime client but does not cancel work or stop the shared daemon.
- The committed preserve-Runtime path bypasses the second `before-quit` admission check while still
  running the existing bounded local cleanup.
- Space-owned work and every Runtime work blocker retain the existing confirmation path; an idle
  Runtime with no blockers still uses the verified daemon-stop path.

#### Verification

- Added policy regression coverage for connected-client-only exit, mixed Space/Runtime blockers,
  Runtime work blockers, idle daemon stop, and second-pass `before-quit` admission.
- `node --test --test-concurrency=1 --import tsx apps/desktop/electron/test/complete-exit-policy.test.ts`
  passed: 15/15.
- Desktop typecheck, lint, and smoke build passed. The full Desktop test run had one unrelated
  transient F118 daemon-integration failure; its isolated rerun passed.

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
- Status: In Progress
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
The last-resort dangerous-command fence described above was later removed from the successfully
bootstrapped Auto path by Issue 158; it remains only as a bootstrap-failure fallback.

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
  count independently from the core `config.json` overview. It also previews the SDK migration plan
  and applies it through a validated main-process action that creates only missing files, retains
  legacy fields, and reloads live MCP state.
- Opt-in SDK Extension discovery merges default discovery with
  `readExtensionsIntegration(...).document.paths` and deduplicates by entrypoint. In-process
  Extension execution remains disabled unless `KODAX_SPACE_ENABLE_SDK_EXTENSIONS=1`.
- `kodax_manual` seeds `KODAX_UNDERLYING_CAPABILITY_TOPICS`. Same-id Space topics dynamically
  include the exact installed `MANUAL_REGISTRY` body, aliases, and sources; curated topics without
  a Space overlay remain entirely SDK-owned.
- The manual is composed after the ESM-only `/coding` export is dynamically loaded. No static
  subpath value import remains in the CommonJS Electron main bundle, and packaged startup is a
  release regression gate for `ERR_PACKAGE_PATH_NOT_EXPORTED`.
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
  legacy fallback, Settings source/plan/apply projection, non-destructive SDK migration, managed
  Extension paths, opt-in execution, and entrypoint deduplication.
- The manual regression iterates the complete SDK curated topic list, requires every same-id Space
  topic to contain the exact installed SDK body and sources, and resolves the effective manual to
  prove no recommended underlying topic disappeared.
- The built Electron main starts under the package's ESM-only subpath export contract without
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- TypeScript checks and the focused schema/main-process suites pass; full release gates remain
  recorded in the v0.1.33 readiness document.

### 124: Coder runtime-mode switching admitted new work and could persist an inconsistent owner state

- Priority: High
- Status: Resolved
- Introduced: withdrawn v0.1.33 candidate
- Fixed: corrected v0.1.33
- Created: 2026-07-28
- Resolution Date: 2026-07-28

#### Original Problem

The new Settings switch between daemon and embedded Coder hosts had several unsafe transition and
recovery edges:

- a Coder create, resume, send, or queued input could enter after the active-task check but before
  the owner transition completed;
- another mode request could reverse the persisted preference during the delayed restart window
  without restoring the corresponding owner policy;
- daemon-to-embedded persistence failure restored daemon policy but left the adapter closed while
  the UI claimed the previous mode remained active;
- failed embedded owner initialization could not recover to verified daemon policy;
- v1/v2 settings were upgraded only in memory, so removing the legacy environment override could
  change the selected host on the next launch;
- the new Settings action was absent from the frozen Coder action manifest; and
- the custom radio cards did not implement native radio keyboard behavior.

Expected behavior:

- mode switching and Space task admission are serialized in the main process;
- no second switch or new task can enter once a restart has been scheduled;
- every partial owner transition either remains usable or schedules a recovery restart;
- persisted settings and owner policy agree across launches; and
- the Settings control is keyboard- and screen-reader-operable.

#### Root Cause

The initial implementation treated the active-task check, settings write, owner transition, and
restart scheduling as independent operations. It had no process-wide single-flight coordinator or
admission drain. Migration reused the normalized in-memory value without writing a versioned
document, while the Settings UI used ARIA roles on ordinary buttons instead of native grouped radio
inputs.

#### Resolution

- Added a main-process runtime-mode coordinator that closes admission synchronously, drains
  already-admitted Session work, rechecks active tasks, serializes switches, and keeps the gate
  closed after any scheduled restart.
- Runtime-touching Session, Slash, Workflow, External Agent, MCP, and Settings operations now
  participate in the same process-wide gate.
- The final active-work check includes ManagedSessions, running/paused Workflows, non-terminal
  External Agent tasks, pending permission/AskUser interactions, queued Coder prompts, daemon
  work, and other clients.
- A failed embedded preference write restores daemon policy and schedules a recovery restart.
- Failed/unowned embedded initialization can enable daemon policy only after verifying that the
  owner state is unowned; occupied or unreadable states still fail closed.
- Startup reconciles persisted Daemon preference with owner policy before Runtime connection.
  `daemon + unowned inline policy` is repaired; active/unreadable inline ownership fails closed.
- The initialized Space client version is retained for reconnects instead of falling back to a
  hard-coded previous release number.
- v1/v2 settings migrate atomically to v3 with the selected `coderRuntimeMode`, while unknown
  forward-compatible fields remain preserved.
- Added `settings.setCoderRuntimeMode` to the frozen action manifest as a Space host-provider
  action.
- Replaced the custom ARIA buttons with native same-name radio inputs and a fieldset/legend group.
- Updated failure copy so it no longer promises that a closed previous host is still active.

Files changed include:

- `apps/desktop/electron/kodax/coder-runtime-mode-switch.ts`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/settings/store.ts`
- `apps/desktop/electron/kodax/runtime/coder-action-manifest.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/renderer/src/features/settings/SettingsModal.tsx`
- `apps/desktop/renderer/src/i18n/messages.ts`
- focused main-process regression tests

Validation:

- Focused mode-switch, owner-recovery, settings-migration, action-manifest, and IPC schema suites
  pass, including concurrent admission, reverse-switch, recovery-restart, failed embedded owner,
  cross-launch migration, and forward-compatible field preservation cases.
- Focused Runtime mode/owner suites pass (83 tests), including startup reconciliation, global
  activity blockers, reconnect version retention, inline-acquire compensation, and
  recovery-restart admission closure.
- Full workspace and packaged release gates use the exact npm Registry KodaX 0.7.77 package; no
  unpublished SDK candidate is part of the correction.

### 125: Invalid optional integration config could abort Coder daemon startup without actionable diagnostics

- Priority: High
- Status: Resolved
- Introduced: v0.1.32 / KodaX 0.7.76
- Fixed: corrected v0.1.34 source + KodaX 0.7.78
- Created: 2026-07-28
- Resolution Date: 2026-07-29

#### Original Problem

On one reported Windows machine, both the portable and extracted v0.1.32 builds
started Space and kept Partner usable, but every Coder request failed with:

`Runtime daemon child exited before becoming healthy (code 1).`

The customer had no `~/.kodax/runtime` directory, the same package worked on
other machines, and the pre-daemon v0.1.28 build worked on the affected
machine. Asking the customer to delete all of `~/.kodax/config.json` and
`~/.kodax/integrations` could have hidden the trigger, but would destroy
unrelated valid settings and was not an acceptable product fix.

#### Root Cause

Coder v0.1.32 moved execution into the KodaX daemon, while Partner remained on
its independent inline path. KodaX treated strict MCP, A2A, and filesystem
Extension documents as mandatory during daemon cold start. A machine-specific
malformed or incompatible optional integration file could therefore terminate
the child before health and before normal Runtime logging. Space surfaced only
the parent's generic code-1 error and did not distinguish core Runtime health
from optional integration degradation.

The separate `Cannot find module 'better-sqlite3'` dialog seen from one
administrator-mode portable launch is an extraction/native-module/endpoint
protection signal in Electron's main process. It is not conflated with
integration validation. If Electron fails before spawning the Runtime child,
the visible dialog and Space main-process logs remain the evidence.

#### Resolution

- Space now requires the explicit `integrationConfigResilience:1` Runtime
  capability. KodaX 0.7.78 isolates MCP, A2A, and Extension configuration
  failures from core daemon health, retains last-known-good configuration, and
  returns bounded per-domain diagnostics.
- KodaX watchers do not currently publish a management-change event, so Space
  performs a bounded two-second management-health poll while connected. It
  rebuilds the profile only when the integration-health fingerprint changes,
  automatically showing both degradation and recovery without reconnecting
  Coder.
- Poll failures retain the last known integration projection and emit one
  bounded warning. They do not mark the core Runtime unavailable.
- Space identifies the exact `integrations/mcp.json`,
  `integrations/extensions.json`, or `integrations/a2a.json` path and preserves
  non-destructive SDK migration. It never deletes `config.json` or the
  integrations directory.
- Runtime attachment is governed by negotiated capabilities rather than a
  second semantic-version gate.

Files changed:

- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `apps/desktop/electron/kodax/space-manual-topics.ts`
- `docs/USAGE.md`
- `docs/USER_MANUAL.zh-CN.md`

Tests added:

- Integration health changes from healthy to degraded and back to healthy
  without changing Runtime readiness.
- A lower identity version with every required capability is accepted, while
  the dedicated orphan-exit capability remains mandatory.
- Space's own MCP manager now validates and constructs every candidate before
  atomically replacing the cached last-known-good managers. An invalid global
  or project document leaves the previous managers live instead of presenting
  an empty MCP surface while the daemon retains different state.
- Settings writes and split-integration migration return an explicit Runtime
  reload result (`applied`, `not-required`, or `failed`). The renderer warns
  when a file was saved but the running Runtime did not apply it, and MCP
  reload reports local and daemon failure rather than collapsing them into a
  misleading success.
- The Settings integration-health view now exposes the Runtime revision and
  last valid reload timestamp. Diagnostic export records
  `runtime-integration-health-unavailable` when health inspection itself fails.

### 126: Sent and restored image attachments disappear from visible user messages

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.9
- Fixed: corrected v0.1.33
- Created: 2026-07-28
- Resolution Date: 2026-07-28

#### Original Problem

A user sent three images with the first query in Session
`s_084731de-2f67-4c46-b28e-004ac166e64e`. KodaX persisted all three image
content blocks and the durable files still exist, but the Space transcript
shows only the query text. There is no attachment indicator, clickable link,
or thumbnail in either the optimistic live message or restored history.

Expected behavior:

- the sent user bubble immediately shows every attached image;
- switching Sessions or restarting Space restores the same attachment list;
- clicking a thumbnail opens an in-app preview;
- missing historical files degrade to an explicit unavailable tile instead of
  disappearing; and
- history transport does not embed large base64 payloads or expose unrestricted
  local-file reads.

#### Context

Affected components include composer send projection, `session.history`, the
shared IPC schema, renderer message state/composition, user bubbles, and the
main-process `app://` protocol.

#### Root Cause

Image artifacts are passed separately to `session.send`, while the optimistic
`UserMessage`, history `user` item, `ConversationMessage`, and `UserBubble`
retain only string content. History calls `extractUserText()` and discards the
persisted image blocks even though their Session-owned files remain available.

#### Resolution

- The Session schema now carries bounded, path-free image descriptors for live,
  queued, and restored user messages, including explicit missing and unsupported
  states instead of silently dropping an image.
- The main process issues revocable `app://space/session-attachment/...`
  capabilities and revalidates Session ownership, real paths, file size, and
  detected image signatures on every no-store response.
- Optimistic data URLs are replaced by durable capabilities after the send
  acknowledgement, including the delivery-before-ack queued-message race.
- User bubbles render lazy thumbnails outside the collapsed query text. Clicking
  one opens Task Dock, whose transient snapshot is scoped to both project and
  Session and is cleared on Session deletion or switch.
- Forked Sessions receive their own attachment copies plus a bounded ownership
  manifest, so their restored thumbnails survive source-Session deletion.

#### Validation

- The reported Session
  `s_084731de-2f67-4c46-b28e-004ac166e64e` restores all three images as available
  descriptors without exposing native paths.
- The shared IPC schema suite passes all 287 tests.
- The focused Desktop regression suite passes 112 tests with one existing skip,
  covering history, fork ownership, MIME recovery, cache policy, queued
  promotion, and Task Dock scoping.
- The Playwright attachment flow passes both tests, including rendering a sent
  image thumbnail and opening it in Task Dock.
- TypeScript checks, renderer/main builds, targeted lint/format checks, and
  `git diff --check` pass.

### 127: Runtime-mode recovery could reopen admission or forget the clean-profile migration state

- Priority: High
- Status: Resolved
- Introduced: withdrawn v0.1.33 candidate
- Fixed: corrected v0.1.33
- Created: 2026-07-28
- Resolution Date: 2026-07-28

#### Original Problem

A second review of FEATURE_141 found additional clean-profile and partial-recovery edges:

- when `settings.json` did not exist, the legacy environment selected the first in-memory mode but
  no version 3 file was created, so the next launch could select a different host;
- after clean-profile creation, ordinary settings updates replaced the now-existing file with a
  fixed `.tmp` rename that intermittently failed with `EPERM` on Windows;
- if daemon policy enable and inline-owner reacquisition both failed, the switch coordinator
  reopened Coder admission even though no usable owner had been proven;
- embedded `session.send()` could return accepted before its asynchronous stream discovered that
  the inline owner was unavailable, leaving an unhandled rejected Promise;
- generic failure copy claimed that no new mode was saved even when daemon preference persistence
  had succeeded and its compensation write had failed; and
- renderer files pulled into the Electron type project depended on renderer-only global JSX and
  Vite declarations, making the current release type gate fail.

#### Resolution

- A missing settings file is now created exclusively and atomically with the selected migration
  mode. If another Space process wins the create race, the store re-reads and normalizes that
  committed document instead of overwriting it.
- Ordinary updates use the shared Windows-safe atomic replacement helper with unique sibling files
  instead of renaming a fixed `.tmp` path over an existing settings file. The fallback rejects
  pre-existing directories and symbolic links without displacing them, and records any entry moved
  during a race so Windows can restore it on failure.
- Owner recovery failures carry a dedicated restart-required error. The switch coordinator schedules
  a recovery restart and keeps its admission gate closed even when preference compensation also
  fails.
- The typed restart-required marker is preserved through ready-daemon inline rollback wrappers, and
  the coordinator's outer catch provides a final restart-scheduling fallback before it can reopen
  admission.
- Embedded `send()` verifies the inline owner while the main-process admission is still held.
  Fire-and-forget stream preflight failures also emit one bounded `session_error` instead of becoming
  unhandled rejections.
- Failure copy now describes the state neutrally and asks the customer to confirm the selected mode
  after Space reopens. Mode cards separately mark the current saved mode and the pending radio
  selection.
- Cross-project renderer dependencies use explicit React and structural `ImportMeta` types, while
  Runtime diagnostic degradation projections retain explicit result typing.

Files changed include:

- `apps/desktop/electron/settings/store.ts`
- `apps/desktop/electron/kodax/coder-owner-recovery-error.ts`
- `apps/desktop/electron/kodax/coder-runtime-mode-switch.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `apps/desktop/renderer/src/shell/FileActionMenu.tsx`
- `apps/desktop/renderer/src/shell/inputBridge.ts`
- focused settings, coordinator, adapter, and real-session tests

Validation:

- Clean-profile migration is tested across a second launch after the environment changes.
- Settings replacement is tested through the Windows `EPERM` fallback, and the settings test file
  passes repeated runs without the former intermittent rename failure.
- Double owner-recovery failure is tested with successful and failed preference compensation; both
  cases schedule restart and reject later Coder admissions. The ready-daemon path also covers a
  committed daemon stop followed by inline acquisition and daemon restoration failure.
- Embedded owner loss rejects `send()` before acceptance, and escaped stream preflight failures emit
  exactly one terminal error.
- TypeScript, lint, focused tests, build smoke, and diff checks pass.

### 128: Packaged Electron daemon shell probes fail before execution and Auto LLM reports Bash as disabled

- Priority: High
- Status: Resolved
- Introduced: v0.1.33 / KodaX 0.7.77 shell-execution adoption
- Fixed: v0.1.40 / npm-published KodaX 0.7.86
- Created: 2026-07-28
- Resolution Date: 2026-08-14

#### Original Problem

In Session `s_6d037f64-c0c9-4f0a-a2b5-78d9f560ef3d`, three ordinary command
tool calls failed before the requested command started:

`shell environment probe did not return a valid framed payload`

After the user asked whether PowerShell was actually unavailable, the Agent
submitted a fourth call through the Windows `bash` tool that wrapped the full
PDF-generation side effect in PowerShell instead of running a minimal
read-only capability probe. Auto LLM had a valid reason to reject that scope
expansion, but its denial also claimed that Bash was explicitly unavailable in
the Session and that invoking PowerShell was circumvention. The Agent then
repeated that classifier-generated claim as though it were authoritative
Runtime configuration and told the user that every shell channel was disabled.

Expected behavior:

- a packaged Electron daemon resolves the selected PowerShell environment and
  executes the requested command;
- Space's preflight canary validates the same helper path used by the Runtime
  probe, so a passing canary cannot be followed by a fail-closed command tool;
- infrastructure failures remain distinguishable from permission or policy
  denials; and
- Auto LLM does not reinterpret a user's diagnostic question as a Session
  prohibition or invent an unavailable-tool policy.

#### Evidence

- The affected Session remained configured with `permissionMode: auto`,
  `autoModeEngine: llm`, `shell.kind: powershell`, the absolute Windows
  PowerShell executable, and `environment.windowsPath: registry`.
- The effective tool scope included `bash`; no persisted setting disabled it.
- The first three calls failed in the Runtime shell-environment probe before
  command execution. Only the fourth call reached and was blocked by the
  Auto LLM guardrail.
- The user's PowerShell profile contains only the fnm initialization command.
  Direct profile-aware PowerShell capture returns a framed PATH successfully,
  which explains why Space's canary kept the `profile: default` contract.
- The live packaged daemon is `KodaX Space.exe` running the KodaX CLI through
  Electron's bounded Node bootstrap. Its long-lived environment correctly no
  longer contains `ELECTRON_RUN_AS_NODE`.
- The same framed-payload failure appears in nine Runtime runs across four
  Sessions, covering both v0.1.32-development and v0.1.33 clients. This is not
  isolated to the reported command or Provider.

#### Root Cause

There are two distinct failures:

1. Space's preflight canary captures the PowerShell environment with an encoded
   PowerShell script. KodaX Runtime's formal probe instead asks the selected
   shell to launch `process.execPath -e ...` as a Node helper. In the packaged
   daemon, `process.execPath` is the Electron application executable, not an
   ordinary `node.exe`. Because the daemon bootstrap intentionally consumed
   `ELECTRON_RUN_AS_NODE`, the nested helper launch re-enters normal Electron
   application mode and emits no sentinel frame. KodaX already exposes
   `prepareInternalNodeLaunch()` for trusted internal `process.execPath`
   children, but the shell-environment resolver does not use that contract.
2. The later Auto LLM permission review received a Windows `bash` tool call
   whose payload invoked PowerShell and performed the previously discussed PDF
   generation, while the immediate user intent asked only for confirmation.
   Blocking that side effect was defensible, but the classifier converted the
   question into a nonexistent policy fact, labeled PowerShell as
   circumvention, and returned misleading denial prose. The root Agent then
   overgeneralized that secondary denial into a false Session-level capability
   diagnosis instead of retrying with a read-only probe.

No requested Edge, PowerShell, CMD, Python, or other user command was able to
start while the primary probe defect was active.

#### Proposed Resolution

- Make the Runtime environment helper use the existing bounded internal Node
  launch contract whenever `process.execPath` is Electron.
- Add a packaged Electron/asar regression that exercises the actual
  `shellExecution` probe and a command tool, not only daemon bootstrap and
  ordinary-Node compatibility.
- Align Space's canary with the Runtime probe or add a Runtime-owned preflight
  endpoint so the two checks cannot validate different execution paths.
- Emit structured shell-resolution failure metadata so Agents and UI copy
  cannot confuse an infrastructure probe failure with a permission setting.
- Add Auto LLM regression coverage for diagnostic confirmation prompts and the
  Windows `bash`-tool/PowerShell naming boundary. A scope-mismatch denial must
  cite the actual side effect without inventing an unavailable-tool policy, and
  a minimal read-only capability probe must remain distinguishable from the
  previously proposed write operation.

#### Resolution

- KodaX's formal shell-environment probe now routes its nested
  `process.execPath` helper through the existing bounded Electron Node-launch
  contract. `ELECTRON_RUN_AS_NODE=1` is scoped to that helper invocation, and a
  preload scrub removes it before the helper serializes the environment used by
  the requested command.
- The packaged Electron daemon smoke now executes the real `toolBash`
  `shellExecution` path with Windows PowerShell and verifies that the probe
  succeeds while the Electron bootstrap switch remains absent from daemon,
  ordinary child, and user-command environments.
- Auto LLM's compact-review prompt now treats diagnostic questions as evidence,
  not policy declarations. Scope-mismatch denials must name the actual
  unrequested operation and may not invent tool availability or label normal
  PowerShell dispatch as circumvention.
- KodaX 0.7.86 stages the Windows sandbox runner outside ASAR, isolates the
  Electron Node bootstrap from user commands, coordinates policy ownership
  machine-wide, and retains a fail-closed fence until process-tree termination
  and ACL cleanup are proven. Lifecycle failures are surfaced and commands
  that may have started are never replayed.
- Space now pins the exact npm-published 0.7.86 bytes, requires
  `sandboxRuntime:3` before daemon auto-start and after connection, updates the
  Settings sandbox contract to facade v3, and rejects a stale v1/v2 daemon.
- The packaged Space smoke verifies the v3 facade and daemon capability and,
  whenever sandbox doctor reports ready, executes a real contained command
  from the packaged Electron/ASAR process. KodaX's release smoke additionally
  covers 20 cold Shell calls and an immediate same-executable restart call.

Files changed:

- `../KodaX/packages/coding/src/shell-execution/resolver.ts`
- `../KodaX/packages/coding/src/shell-execution/resolver.test.ts`
- `../KodaX/packages/coding/src/guardrails/auto-mode/classifier-prompt.ts`
- `../KodaX/packages/coding/src/guardrails/auto-mode/classifier-prompt.test.ts`
- `../KodaX/scripts/test-electron-daemon-smoke.mjs`
- `../KodaX/tests/fixtures/electron-daemon-smoke/main.cjs`
- `package.json`
- `apps/desktop/package.json`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/kodax/kodax-sdk-probe.ts`
- `scripts/smoke-pack.mjs`

Verification:

- Related KodaX Vitest suites passed: 47/47.
- KodaX package build passed.
- The packaged Electron daemon smoke passed against Electron 42.5.0.
- Space compatibility coverage passes against exact KodaX 0.7.86 and rejects
  SDK/daemon sandbox capability versions below v3.
- JavaScript syntax checks and `git diff --check` passed.

### 129: Packaged builds consumed nested KodaX development junctions and omitted transitive runtime dependencies

- Priority: High
- Status: Resolved
- Introduced: withdrawn v0.1.33 candidate
- Fixed: corrected v0.1.33
- Created: 2026-07-28
- Resolution Date: 2026-07-28

#### Original Problem

After `npm run clean; npm run build`, launching
`out/win-unpacked/KodaX Space.exe` failed before the renderer opened:

`Cannot find package 'get-tsconfig' imported from <path>`

Expected behavior:

- a local package build must either use the exact Registry KodaX package from
  `package-lock.json` or fail before electron-builder creates artifacts;
- no development junction, private SDK source, or incomplete external
  dependency tree may enter `app.asar`; and
- the development KodaX staging layout must be restored after the packaging
  attempt, whether the published-package gate passes or fails.

#### Root Cause

`link-kodax.mjs` creates a Space-local staging directory at
`node_modules/@kodax-ai/kodax` and places junctions to the sibling KodaX
checkout under its `dist`, `node_modules`, and `scripts` children.
`pack.mjs` checked only `realpath()` of the top-level SDK directory. Because
that staging root itself is inside Space, the packer misclassified it as a
published package and let electron-builder traverse the nested development
junctions.

The resulting asar contained an unpublished sibling KodaX development package
and its `tsx`, but not `tsx`'s externally linked `get-tsconfig`
dependency. Electron main therefore failed during startup module resolution.
Adding `get-tsconfig` directly to Space would only hide the dependency leak and
would still package an unpublished SDK, so it is not the fix.

#### Resolution

- `link-kodax.mjs` now writes a non-sensitive staging marker only after all
  development junctions are ready.
- The packer recognizes both the marker and pre-marker staging directories by
  inspecting nested junction realpaths. Direct top-level SDK links remain
  supported.
- Staging restoration runs `link-kodax.mjs` again instead of incorrectly
  replacing the staging directory with a link to one child target.
- A detected development package is removed before `npm ci`; packaging then
  requires the exact lockfile Registry package.
- The corrected `v0.1.33` build accepts the published KodaX 0.7.77 baseline when
  the root/desktop manifests, both lock views, installed package, Registry URL,
  and integrity all agree. It does not require or package any unpublished SDK.

Files changed:

- `scripts/kodax-dev-link-state.mjs`
- `scripts/kodax-runtime-release-gate.mjs`
- `scripts/link-kodax.mjs`
- `scripts/pack.mjs`
- `scripts/smoke-pack.mjs`
- `e2e/boot-smoke-packaged.mjs`
- `scripts/test/kodax-dev-link-state.test.mjs`
- `scripts/test/kodax-runtime-release-gate.test.mjs`

Required reissue verification:

- Development-link and release-dependency tests cover internal root/nested junctions,
  manifest/lock/installed-version drift, Registry tarball source, and integrity validation.
- The formal build starts from npm Registry KodaX 0.7.77 with no local staging.
- Every build imports all public facades, walks ancestor-aware transitive dependencies, verifies
  native bytes live outside asar, loads packaged `better-sqlite3`, and boots the real Windows
  unpacked application.
- The final executed commands and artifact evidence are recorded in the v0.1.33 readiness record.

### 130: Runtime-mode switching left Workflow, Slash, and External Agent executable entry points outside admission

- Priority: High
- Status: Resolved
- Introduced: withdrawn v0.1.33 candidate
- Fixed: corrected v0.1.33
- Created: 2026-07-28
- Resolution Date: 2026-07-28

#### Original Problem

FEATURE_141 initially connected the runtime-mode switch coordinator only to
`session.create` and `session.send`. While a mode switch had synchronously
closed those two paths, a customer action could still start or resume
executable Coder work through:

- a Slash command that starts or reruns a Workflow;
- Workflow panel `start`, `rerun`, or `resume`; or
- Runtime External Agent task `start` or `sendInput`.

Expected behavior:

- every operation that touches the Coder Runtime owner must enter one coordinator gate;
- a switch drains already-admitted work and rejects every later executable
  entry until the owner is safely restored or the new process starts; and
- Space-only diagnostics remain available so failures can be inspected without
  racing the Runtime owner transition.

#### Root Cause

The coordinator was created correctly in Electron main, but its optional
admission callback was injected only into Session IPC registration. Workflow,
Slash, and Agent channel registrars had no shared admission dependency, so the
active-work check and daemon owner stop could race a different executable IPC
surface.

Read-only `tryResume()` calls in Artifact, Memory, and Skill metadata paths do
not acquire the Coder owner or start work; treating all lazy hydration as an
execution admission would have blocked unrelated inspection without closing
the actual launch side doors.

#### Resolution

- Added one exception-safe `runWithCoderAdmission()` helper over the mode-switch
  coordinator's synchronous gate.
- Electron main injects the same gate into Session, Slash, Workflow, External
  Agent, MCP, and Runtime-affecting Settings channel registrars.
- Slash execution is admitted as one operation because builtins can launch or
  rerun Workflows.
- Workflow `start`, `rerun`, and `resume`, plus External Agent task `start` and
  `sendInput`, now hold admission until their launch/control acknowledgement
  settles.
- Runtime list/control/mutation routes participate in the gate. Space-only
  diagnostics, Artifact, Memory, Skill parsing, and lazy hydration remain
  outside because they do not acquire or mutate the Coder owner.
- The F141 design, human regression guide, source documentation, user manual,
  and `kodax_manual` explain the complete entry-point boundary.

Files changed:

- `apps/desktop/electron/kodax/coder-runtime-mode-switch.ts`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/ipc/slash.ts`
- `apps/desktop/electron/ipc/workflow.ts`
- `apps/desktop/electron/ipc/agent.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/test/coder-runtime-mode-switch.test.ts`

Verification:

- The shared helper releases exactly once on both success and failure.
- The focused coordinator, owner, settings, integration-health, and embedded
  send suites pass with the existing Windows symlink skip only.
- TypeScript checks pass after all four production channel registrars receive
  the same injected gate.

### 131: Complete exit leaves the main window visible during shutdown and appears to require a second close

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.33
- Fixed: v0.1.34
- Created: 2026-07-28
- Resolution Date: 2026-07-28

#### Original Problem

On Windows, a customer using the withdrawn v0.1.33 candidate clicked the main
window close button, left **Remember my choice** clear, and selected the
complete-close action. The native choice dialog disappeared, but the main
window remained visible. Clicking the title-bar close button a second time made
the window disappear.

Expected behavior:

- confirming complete exit should make the main window disappear immediately;
- Runtime and child-process cleanup may continue for its existing bounded
  shutdown period without making the action appear ignored; and
- the remembered-choice checkbox must affect only persistence, not whether the
  one-time action executes.

#### Root Cause

The close-choice parser correctly returns `quit-completely` whether or not the
checkbox is selected. That action calls `app.quit()`. The global
`before-quit` handler then sets `_quitting`, prevents Electron's default quit,
and awaits asynchronous subsystem disposal plus the safe daemon-stop attempt.
For complete exit, the watchdog allows this sequence up to eight seconds.

Preventing the quit also prevents Electron from closing the BrowserWindow, but
the handler does not hide or destroy the main window while cleanup runs. A
second title-bar close enters the same window `close` listener after
`_quitting` is already true, bypasses the close-choice policy, and therefore
closes the still-visible window. This exactly produces the reported two-click
behavior. The close implementation is unchanged in the current corrected
v0.1.33 source, so withdrawing and rebuilding the package did not remove this
UI lifecycle defect.

#### Resolution

- Added a small shutdown-window helper that synchronously hides every live
  application window and isolates individual `hide()` failures.
- The global `before-quit` handler now invokes that helper immediately after
  committing `_quitting` and preventing Electron's default quit. Runtime,
  child-process, tracing, tray, and watchdog cleanup retain their existing
  bounded asynchronous lifecycle.
- Shutdown intent now stops the remaining startup chain at safe checkpoints,
  and asynchronous disposal waits for startup to settle before closing Runtime
  resources. This prevents an early close from racing `initialize()` and
  spawning resources after cleanup.
- The close-choice behavior remains unchanged: selecting complete exit executes
  the action once whether or not **Remember my choice** is selected; the
  checkbox controls persistence only.

Files changed:

- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/window/shutdown-window.ts`
- `apps/desktop/electron/test/shutdown-window.test.ts`

Verification:

- Focused shutdown and close-choice coverage passes 5/5, including one-time
  complete exit with the remember checkbox clear, immediate hiding of every
  live window, destroyed-window skipping, and failure isolation.
- Focused Electron renderer boot, Windows close-preference, and background-tray
  lifecycle coverage passes 3/3.
- Electron main-process TypeScript checks, focused ESLint, and the production
  main bundle build pass.
- Windows directory packaging, packaged dependency/resource smoke checks, and
  the packaged renderer/Runtime boot smoke pass.

### 132: Retired renderer loading UI flashes between the randomized startup splash and the application shell

- Priority: Low
- Status: Resolved
- Introduced: v0.1.33
- Fixed: v0.1.34
- Created: 2026-07-28
- Resolution Date: 2026-07-28

#### Original Problem

After the new randomized startup animation completed, the previous small
`KodaX Space / Starting up` panel and spinner appeared for a fraction of a
second before the real application shell became visible.

#### Root Cause

The first fix removed the retired static panel from `apps/desktop/index.html`,
but the randomized splash and React still occupied the same BrowserWindow
`webContents`. Navigating that one renderer from the trusted `data:` splash to
`app://space` necessarily destroyed the splash document before the React bundle
could mount and paint. The theme-matched empty root reduced the contrast, but it
could not make the two-document navigation atomic and a background frame could
still appear briefly.

The renderer-ready signal was also mounted beside `App`, so two animation
frames only proved that the bootstrap React tree had committed. It did not
prove that the actual `Shell` root had measurable layout.

#### Resolution

- Moved the trusted randomized splash into an independent, sandboxed
  `WebContentsView` attached above the BrowserWindow content view.
- The BrowserWindow renderer now loads and paints React underneath that overlay.
  Only an IPC signal from the exact main renderer, sent after the real `Shell`
  root has measurable layout and two paint opportunities, removes and closes
  the overlay. There is no document navigation between the visible splash and
  the visible application.
- Initial reveal waits for the splash document itself to complete two animation
  frames. The application renderer can still load underneath as soon as the
  splash DOM is ready, while second-instance activation is queued until the
  painted splash is safe to show.
- The overlay tracks content bounds during resize/fullscreen transitions and
  keeps the covered main renderer unthrottled until reveal.
- Fatal startup and renderer crash-loop states retain or recreate the overlay
  with trusted retry/close controls. Retry actions are explicitly typed as
  renderer reload, application restart, or complete-exit recovery; restart is
  committed before the quit bypass is enabled, and fail-closed recovery cannot
  accidentally reveal a partially disposed Shell. Overlay navigation is locked
  to the exact generated `data:` URL plus main-process-intercepted action URLs.
- Synchronous view creation/attachment failures now reject through the
  overlay's Promise contract and clean up any half-created WebContentsView.
- Renderer crash, navigation rejection, and `did-fail-load` recovery signals
  now converge through one latest-generation scheduler, preventing duplicate
  renderer loads for a single failure.
- Shutdown coordination now also waits for non-blocking initialization tasks
  launched by the main startup chain before resource disposal begins. Queue and
  workflow shutdown errors are isolated so daemon-stop confirmation still runs.
- Added unit coverage for overlay attach/resize/dispose/recreation and an
  Electron E2E regression that holds the initial splash before its paint gate,
  verifies second-instance activation cannot reveal it early, then holds the
  painted Shell behind the overlay and verifies atomic overlay removal.

Files changed:

- `apps/desktop/index.html`
- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/window/boot-splash.ts`
- `apps/desktop/electron/window/boot-splash-overlay.ts`
- `apps/desktop/electron/test/boot-splash-overlay.test.ts`
- `apps/desktop/electron/test/renderer-bootstrap-document.test.ts`
- `apps/desktop/electron/window/renderer-load-scheduler.ts`
- `apps/desktop/electron/test/renderer-load-scheduler.test.ts`
- `apps/desktop/electron/window/startup-shutdown-coordinator.ts`
- `apps/desktop/renderer/src/main.tsx`
- `apps/desktop/renderer/src/shell/Shell.tsx`
- `tests/e2e/startup-overlay.spec.ts`

Verification:

- Boot splash/overlay, renderer bootstrap-document, startup-gate, renderer-load
  scheduling, and startup/shutdown coordination tests pass.
- Electron TypeScript, focused lint, renderer/main builds, and the held-overlay
  Electron E2E transition test pass.

### 133: macOS/Linux quit and failed Windows complete-exit could leave an invisible Coder daemon without a control surface

- Priority: High
- Status: In Progress
- Introduced: v0.1.32 daemon adoption
- Hardened: corrected v0.1.34 source + KodaX 0.7.78 `daemonOrphanExit:1`
- Created: 2026-07-28
- Last reviewed: 2026-07-30

#### Original Problem

The detached Coder daemon intentionally outlived its launching Electron
process. Windows normally retained a visible tray owner, but macOS and Linux
had no tray. `Cmd+Q`, Linux last-window exit, tray-disabled fallback, or a
Windows complete-exit stop failure could therefore terminate Space while the
daemon remained alive with no product-visible way to stop it.

The older tray also exposed **Quit Space, keep Runtime**, explicitly creating
the same invisible-owner state. The complete-exit watchdog always called
`app.exit(0)` after a bounded delay even when the CLI safe-stop returned a
blocker, command failure, timeout, or malformed result.

Expected behavior:

- every real Windows, macOS, and Linux application exit stops the Space-owned
  daemon before Space disappears;
- active work and other clients are never force-killed;
- a blocked or failed stop keeps or restores a visible Space control surface;
- a Space crash/SIGKILL has a daemon-side recovery path; and
- ordinary CLI-started persistent daemons keep their existing semantics.

#### Root Cause

F136/Issue 090 solved only the Windows window-close case by retaining Electron
main and a notification-area tray. It did not change macOS/Linux `app.quit`,
tray-disabled fallback, or the final stop-result decision. Runtime preflight
also ran before closing the Coder admission gate, so a new executable request
could race the stop attempt.

The daemon had no opt-in owner-loss policy. Its process was detached, and the
only parent-death watcher was a test-only environment variable. Consequently,
an abnormal Space termination could not distinguish a deliberately persistent
CLI daemon from a Space-launched daemon that had lost its only visible owner.

#### Implemented Hardening

- All ordinary `before-quit` paths now enter one complete-exit coordinator.
  Internal mode restarts and the losing single-instance process are the only
  bypasses. A mode restart registers `app.relaunch()` synchronously before the
  bypass is enabled, so a concurrent OS quit cannot win before relaunch exists.
- The Coder admission gate closes synchronously and drains admitted operations
  before Runtime preflight. Drain is bounded to 10 seconds; timeout atomically
  reopens admission and restores the main window instead of hanging after a
  Linux last-window exit. A blocker also restores the window and cancels exit.
- The tray no longer offers **Quit Space, keep Runtime**. Close-to-tray remains
  safe because the visible tray and Electron Runtime client remain alive.
- Complete exit checks Space-local Partner/Workflow work, permissions,
  AskUser requests, queued prompts, and External Agent tasks in addition to
  daemon work. It keeps the visible control plane alive while the current
  Runtime connection performs the revision-fenced stop.
- A stop result is confirmed only by `stopped:true`, or by an independently
  verified unowned Runtime profile when daemon state is missing. Missing or
  unreadable state alone is never treated as proof that no owner process
  remains. Command failure, timeout, malformed output, a late blocker, or an
  occupied owner schedules one relaunch with a visible recovery warning.
- KodaX adds opt-in `daemonOrphanExitMs` and advertises the dedicated
  `daemonOrphanExit:1` capability only when the current host actually enabled
  it. Space supplies 30 seconds only when it auto-starts the
  `coder` daemon. The ready host arms bootstrap grace before the first client
  initialize, closing the launcher-crash gap. After the final logical client
  disconnects, the daemon waits for active/queued/workflow/Agent/interaction
  work to become idle, then stops. Any other connected client cancels the
  reaper, and attach/detach during preflight receives a fresh full grace.
- If Electron cannot even register the recovery relaunch after irreversible
  disposal, it force-shows a fail-closed window outside the normal startup
  reveal gate, keeps Coder admission closed, and offers a bounded restart retry.
- The user manual, `kodax_manual`, usage guide, architecture, feature design,
  and human test guide document macOS/Linux behavior and safe recovery for
  0.1.32/0.1.33 (`kodax daemon stop`, or PID identity verification followed by
  `SIGTERM`; never broad `killall`).
- The process-distinct compatibility probe now emits and validates an exact
  owner marker containing the host PID, generated `space-f121-*` profile, and
  bounded temporary home. Normal completion performs a graceful exact-profile
  stop and waits for the recorded daemon PID to exit before deleting that home.
  Timeout/error cleanup first repeats the exact-profile stop and only escalates
  after the remaining PID's command line proves the same daemon/profile/home
  identity. It never terminates a generic `node.exe` process by name.
- The probe passes its host PID through the Runtime's test-parent watchdog as a
  second bounded cleanup path. Both successful and exceptional test paths
  assert that the recorded daemon PID is gone.

#### Additional Windows Evidence

On 2026-07-30, process sampling found 15 detached
`kodax_cli.js daemon serve --profile space-f121-<pid>` processes created by
the process-distinct compatibility probe. Every recorded parent PID was gone,
the probe's temporary home directory no longer existed, and the observed
command lines did not include `--orphan-exit-ms`. Each process continuously
used approximately 4.4% of a 24-logical-processor machine (about one complete
logical core) and approximately 190 MB of private memory. Together they
consumed approximately 67% CPU and 2.85 GB of private memory before the active
packaged app did any work.

This confirms that the remaining cleanup gap is not only an invisible-process
problem. Repeated compatibility-test timeout/cleanup failures can accumulate
enough orphan daemons to make the entire desktop unresponsive. The exact
profile prefix originates in `kodax-runtime-compat.test.ts`; these processes
are not Coder workers spawned by the user's active query.

#### Remaining Work

- Run packaged process-level acceptance on macOS and Linux, including ordinary
  quit, last-window exit, active-work blockers, another client attaching during
  exit, and actual PID/state/lock removal after orphan recovery.
- KodaX currently accepts an idle orphan stop request before asynchronous host
  cleanup has necessarily succeeded. If that cleanup fails after the socket and
  orphan controller close, the 0.7.78 host does not publish a bounded retry
  guarantee. This requires an upstream host-level close retry/verification
  contract; Space must not claim that `daemonOrphanExit:1` alone proves eventual
  process exit.
- An attached existing opt-in daemon may have been spawned with a different
  grace interval. Until Runtime publishes the effective grace value, Space
  documents 30 seconds only for a daemon it starts itself and does not infer
  the interval from the capability version.
- A daemon whose control directory disappears must not enter a one-core busy
  loop. Add a process-level regression that deletes or loses the test home
  during shutdown and proves bounded CPU use plus eventual exact-PID exit.

Files changed:

- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/kodax/coder-runtime-mode-switch.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/window/complete-exit-policy.ts`
- `apps/desktop/electron/window/shutdown-window.ts`
- `apps/desktop/electron/window/background-tray-model.ts`
- `src/runtime-daemon/management.ts` (KodaX)
- `src/runtime-daemon/host.ts` (KodaX)
- `src/runtime-daemon/manager.ts` (KodaX)
- `src/runtime-daemon/process.ts` (KodaX)
- `src/sdk-runtime.ts` and `src/kodax_cli.ts` (KodaX)
- `apps/desktop/electron/test/kodax-runtime-compat.test.ts`

Verification:

- Space focused exit/admission/adapter/tray/manual tests cover local blockers,
  revision-fenced stop, missing-plus-owned fail-closed behavior, and recovery.
- KodaX focused daemon management/process/server/upgrade tests: 71 passed.
- Two real process-distinct smokes cover both final-client disconnect and the
  bootstrap case where the daemon becomes ready but no client ever initializes;
  both observe idle orphan self-stop, PID exit, and state/lock removal.
- The real Windows compatibility probe passed after the ownership cleanup
  change, and a post-test process/temp-directory audit found zero
  `space-f121-*` daemons and zero compatibility homes.
- A process-level abnormal-path regression deliberately hangs the probe after
  publishing its exact owner marker, lets the outer timeout fire, skips the
  graceful CLI stop, verifies the remaining PID's full CLI/profile/home
  identity, terminates that exact process tree, and proves both PID exit and
  temporary-home removal.
- KodaX production build, Space Electron typecheck, and Space main bundle pass.
- The issue remains In Progress until packaged macOS/Linux verification and
  the orphan cleanup retry/verification gap are closed.

### 134: Packaged sandbox helpers resolved inside app.asar and failed before command execution

- Priority: High
- Status: Resolved
- Introduced: KodaX 0.7.78 sandbox adoption
- Fixed: corrected v0.1.34 source
- Created: 2026-07-29
- Resolution Date: 2026-07-29

#### Original Problem

The packaged KodaX sandbox facade loaded successfully and advertised its
fail-closed contract, but Windows sandbox doctor failed with an `ENOENT` path
under:

`resources/app.asar/node_modules/@anthropic-ai/sandbox-runtime/vendor/srt-win/...`

The executable physically existed only below `app.asar.unpacked`. ASRT derives
the helper path from its own module URL and passes it directly to
`child_process.spawn`; Electron's transparent asar reads cannot translate that
operating-system process path. The prior package smoke checked only facade
metadata, so it missed the unusable helper.

Separately, Runtime already projected structured `tool.sandbox` observations
through IPC, but the renderer discarded them. Users therefore could not tell
whether containment was applied, unavailable with normal-permission fallback,
or not selected.

#### Resolution

- Electron packaging excludes ASRT from `app.asar` and ships ASRT, its platform
  helpers, nested Commander runtime, SOCKS server, node-forge, and Zod below
  physical `resources/node_modules`.
- Package smoke rejects any ASRT copy in asar, verifies every platform helper
  and direct runtime dependency on disk, calls the public sandbox doctor, and
  fails on `app.asar`/`ENOENT` helper diagnostics.
- The lifecycle smoke now waits for the daemon owner state to become unowned
  after an accepted `stopForInline` response before deleting its temporary
  profile, closing the asynchronous host-shutdown race.
- The active-tool indicator renders `Sandboxed`, `Sandbox fallback`, or
  `No sandbox`. Fallback copy explicitly says execution continues under the
  normal permission policy; the observation remains outside model-visible
  transcript content.

Files changed:

- `electron-builder.yml`
- `scripts/smoke-pack.mjs`
- `apps/desktop/renderer/src/shell/ActivitySpinner.tsx`
- `apps/desktop/electron/test/activitySpinner.test.ts`

Tests added:

- Applied, fallback, and not-selected sandbox presentation coverage.
- Packaged physical-resource and public-doctor assertions.

### 135: Restored history could place the previous assistant reply below a newly sent query after a completed interrupt run

- Priority: High
- Status: Resolved
- Introduced: positional transcript projection (present by v0.1.32)
- Fixed: corrected v0.1.34 source
- Created: 2026-07-29
- Resolution Date: 2026-07-29

#### Original Problem

After reopening a completed Session, a newly sent query could render above the
previous assistant reply. Repeating the send repeated the displacement: each
new query consumed the event segment that belonged to the preceding query.

The factual Session
`s_ca10d118-fb1c-495c-b00b-5d26d3ac80e5` began with one Runtime run containing
an initial canonical turn followed by an interrupt delivered as a second
canonical turn. Several independent completed runs followed. The durable JSONL
kept every user and assistant entry in append order, while the renderer showed
the 22:21 query above the 19:51 reply and later showed the 22:55 query above the
22:27 reply.

Expected behavior:

- restored and live projections render every canonical prompt/reply pair once;
- a delivered interrupt or queued follow-up remains the first event in the
  segment owned by its user message;
- restoring history never changes the owner of a later assistant segment; and
- sending a new query never consumes an older assistant segment.

#### Root Cause

Strong-identity reconciliation correctly matched durable and live copies by
`(turnId, turnUserOrdinal)`, but `mergeCanonicalTurnProjections` rebuilt a
matched segment by placing durable assistant events before live-only events.
`mid_turn_user_prompt` and `queued_user_prompt_started` were treated as ordinary
live-only events even though they are positional segment-start boundaries.

For an interrupted turn, folding therefore produced:

`durable reply -> delivered-prompt boundary -> terminal`

The next reconciliation scan split at that interior boundary. All following
assistant segments shifted to later user owners, and the unmatched tail became
visible below the next query. Existing tests covered interrupt segmentation,
strong-identity folding, and later sends independently, but not their completed
multi-run composition.

Review found two adjacent structural failures in the same reconciliation path:

- a live segment with no assistant output could be closed only by the following
  prompt boundary. Relocating that segment to its durable owner discarded the
  implicit closure; a lifecycle-only segment then consumed a later answer;
- the renderer inferred a delivered prompt's ordinal from its visible text.
  After a matching live row folded into history, a later legal same-text prompt
  could therefore reuse the old `(turnId, turnUserOrdinal)` and be deleted as a
  false duplicate.

The merge also collapsed a compatibility sequence such as
`session_error -> session_complete -> session_error` to its final terminal,
discarding the first error notice. Review additionally found that a daemon
connection loss retained the old per-turn ordinal counter, so a same-adapter
reconnect without a replayed `turn.started` could manufacture another false
strong identity.

#### Resolution

- Classified delivered interrupt and queued-follow-up events as prompt-segment
  boundaries during canonical projection merging.
- Removed boundary markers from the durable/live event bodies and retained at
  most one marker at index zero of the merged segment.
- Preserved the marker itself so queue replay deduplication, delivery metadata,
  activity state, and reconnect behavior keep their existing semantics.
- Preserved the closure of every relocated non-empty segment with a
  renderer-only delimiter when its original closure came from the following
  prompt marker. Empty canonical turns can no longer consume a later answer.
- Added an optional bounded `turnUserOrdinal` to the two delivered-prompt IPC
  events and assigned it at the Runtime adapter, where canonical lifecycle
  identity is known. An initial turn begins delivered inputs at ordinal one;
  a queued Runtime turn assigns its first delivered input ordinal zero.
- Removed text-based ordinal reuse from the renderer. Exact adapter ordinals are
  honored; when the adapter attached too late to observe `turn.started`, the
  renderer fails open with a fresh ordinal instead of deleting a legal prompt.
- Cleared connection-scoped ordinal counters on turn/run termination, daemon
  connection loss, and adapter close. A same-adapter reconnect that lacks a
  replayed `turn.started` now omits the unprovable ordinal.
- Kept the Runtime's complete consecutive terminal sequence during projection
  folding, preserving both raw and wrapped error notices.
- Added a regression modeled on the factual Session: one run with two canonical
  turns, three later completed runs, full history restoration, and a sixth
  query. It asserts exact prompt/reply order, one durable user per canonical
  identity, one retained interrupt marker before its answer, structural
  owner/segment parity, and no previous reply below the sixth query.
- Strengthened the queued-follow-up regression to require exactly one retained
  delivery marker at the start of its folded segment.
- Added regressions for consecutive empty interrupt turns, an empty
  queued-after-turn owner followed by another completed send, legal same-text
  prompts in one Runtime turn, ambiguous same-text fail-open behavior, and
  multi-terminal error preservation.

Files changed:

- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/test/history-replay-no-popout.test.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `packages/space-ipc-schema/src/channels/session.ts`
- `packages/space-ipc-schema/test/session.test.ts`
- `docs/KNOWN_ISSUES.md`

Verification:

- Focused history replay suite: 35 passed.
- Message history, composition, queue, spinner, Runtime adapter, and IPC schema
  regression set: 174 passed.
- Complete desktop Electron unit/integration suite: 1,973 passed, 4 skipped,
  0 failed.
- Renderer, Electron, and IPC schema TypeScript checks passed.
- Two independent sub-Agent reviews passed after closing connection-loss and
  unknown-delivery-kind ordinal gaps; their additional deterministic stress
  matrices covered 1,000 history/live interleavings, 200 reconnect cases,
  62 multi-terminal sequences, and empty/history-first combinations.
- Production source build, package smoke, packaged Runtime/Worker execution,
  and packaged application boot smoke passed. The resulting `app.asar` was
  also inspected directly for the strict delivery-kind guards, disconnect
  cleanup, IPC ordinal payload, and renderer boundary handling.

### 136: Restored transcript merging and legacy compaction reconciliation can relocate or physically duplicate conversation history

- Priority: High
- Status: In Progress
- Introduced: KodaX 0.7.50 / Space v0.1.27; exposed more broadly by KodaX 0.7.74
- Created: 2026-07-30

#### Original Problem

After reopening Session `s_60717080-1d27-42fd-ac6a-be27319d9503`, the P0/P1
query sent at `2026-07-29T13:41:32.593Z` no longer appeared between its
predecessor and answer near the visible `Conversation compacted` boundary.
The query-jump rail still exposed its preview as query `#1`, which made the
query look deleted from the expected location.

Expected behavior:

- genuine pre-compaction main-conversation queries, assistant output,
  thinking, tool cards, and visible workflow notices remain visible exactly
  once after compaction and application restart;
- internal/synthetic carriers, storage markers, and abandoned branch detail
  may remain durable without becoming ordinary main-chat bubbles;
- full-history recovery preserves the original visible append order across
  main JSONL and island-sidecar storage;
- compaction boundaries remain at their actual chronological/lineage position;
- a selected canonical pre-compaction history segment cannot be split across
  the transcript merely because one physical copy is active and another is in
  side storage; and
- query ordinals, assistant ownership, tool-result pairing, and workflow
  notices remain stable after reopen.

#### Context

The query is not physically lost. Its complete body survives independently in:

- archived entry `entry_a1a31ba8b1d5` in the Session `.islands.jsonl`;
- compaction entry `entry_7f7789e601f7`'s exact user-query ledger as
  `query_9010b90a7d58adbb`; and
- archive marker `entry_6a8e521f7e65`'s summary in the main JSONL.

#### Terminology and Visibility Boundary

`archived child` was an ambiguous shorthand and must not be read as
`child-Agent content that Space should display forever`. In this issue:

- `child` means only a lineage entry whose `parentId` points to another lineage
  entry;
- `.islands.jsonl` is compaction old-island side storage, not a user archive and
  not proof that an entry belongs to an abandoned branch; and
- KodaX `loadFullTranscript()` is the raw append-order host scrollback/audit
  source. It deliberately includes inactive and sidecar entries, while Space
  owns the decision to show, fold, branch, or hide them in the main chat.

Space adopted `loadFullTranscript()` in v0.1.27 specifically so real
pre-compaction turns would remain visible instead of disappearing when
compaction creates a new active root. It must not render every raw entry as an
ordinary bubble. The intended classification is:

- show once: genuine main-conversation user queries, assistant/thinking output,
  and tool cards that became inactive only because compaction re-rooted the
  context;
- branch UI or a compact boundary, not ordinary main-line bubbles: detail from
  a branch actually abandoned by rewind/fork;
- hide: synthetic user/system carriers and storage-only
  `archive_marker`/`label`/`goal` entries;
- attach rather than render as a user bubble: user-role tool-result carriers;
  and
- render as compact notices: `compaction` and `branch_summary`, without exposing
  their internal summary bodies.

The factual P0 query belongs to the first category. The Session rewound at
`13:35:29` to assistant entry `entry_1236c786ad96`; P0 was then newly sent at
`13:41:32` as that retained entry's child, followed by the visible
assistant/tool stream and the `14:41:32` compaction. It is not the abandoned
pre-rewind child and not child-Agent output. Its later inactive/sidecar status
is only a consequence of compaction, so it should remain in main scrollback at
its original 13:41 position.

The archived query keeps its original parent `entry_1236c786ad96` and original
timestamp. That parent and the `13:35:29` rewind marker remain in the main
JSONL even though the marker is physically stored after the parent.
Nevertheless, KodaX 0.7.78 `loadFullTranscript()` returns the query at raw
transcript index `0`; Space's inactive-island folding retains it at visible
history index `0`. In the latest inspected 426-entry snapshot, five sidecar
entries precede parents that are still present in main; the first compaction is
at raw index `230`. Space folding reduces the transcript to 147 entries and
moves that first compaction to folded index `113`.

The displacement also changes the visible query ordinals rather than merely
inserting an extra row. A projection using the same Space history filters
starts its real-user query rail in this order before the later follow-ups:

1. the archived P0/P1 query from `13:41:32` (`#1`);
2. the archived writing-great-skills constraint from `13:55:18` (`#2`);
3. the Session's original opening query from `13:10:45` (`#3`);
4. the original smart-context follow-up from `13:14:49` (`#4`); and
5. the next-day成果 query (`#5`).

The original opening query `entry_d4ba4936048d` is therefore still durable and
visible, but it has been pushed from `#1` to `#3`. This is why hovering `#1` in
the screenshot shows P0/P1 and can make both the P0/P1 query at its expected
location and the original opening query appear to have disappeared.

The disorder is not limited to user queries. The single archived batch for
this Session contains 44 message entries: 27 user carriers and 17 assistant
messages. Those assistant messages contain 17 thinking blocks, 17 text blocks,
64 tool-use blocks, and 64 matching tool-result blocks.

After applying the same inactive-island folding as Space:

- 11 assistant messages, their thinking/text, and 50 complete tool-use/result
  pairs are moved into the visible prefix ahead of the original opening query;
- the other 6 assistant messages, their thinking/text, and 14 complete tool
  pairs are retained only through later active physical clones and therefore
  appear after the compaction boundary even though their timestamps precede
  it; and
- task-result entries move with those fragments. The factual task results are
  child-task completions that Space intentionally hides, but a recognized
  workflow result would be restored at the same wrong data position.

All 64 tool calls still find their corresponding results: there is no missing
or orphan result in this Session, and the local order inside each surviving
fragment remains coherent. The defect is global chronology and branch
placement, not evidence that the model output was deleted or that a tool result
was attached to a different `tool_use_id`. The renderer's global tool-result
pre-scan masks the severity of the storage-order defect but does not repair it.

The existing timestamps are useful evidence but are not an authoritative total
order. This remains true even if every timestamp is unique: a retained message
can be re-materialized as the child of a newer compaction entry while preserving
its earlier message timestamp. For example, `entry_73fedf7f0caf` retains
timestamp `14:22:46.212Z`, while its newly created compaction parent
`entry_7f7789e601f7` is timestamped `14:41:32.645Z`. A timestamp sort therefore
puts the child before its parent. Shared milliseconds are expected for
single-message block groups and batch persistence; they are not an independent
root cause and do not justify a new timestamp or global sequence requirement.

The independent long Session
`s_11be2ee5-54f4-4740-84ce-b22f1577db73` isolates the Space-side amplifier.
Unlike `s_607...`, its raw 322-entry SDK transcript is in the correct append
order: old-island entries `0..145`, the persisted compaction at index `146`,
then the retained-tail clones. Its compaction occurred at
`2026-07-29T07:06:50.278Z`, after the `请移动过去` query at `07:05:30.740Z`.
Space's active-wins content folding deletes the earlier inactive originals and
keeps later active clones, moving the visible boundary to about folded index
`62`; the query then appears near the visible tail. This Session must not be
used as evidence that the SDK returned the wrong order.

The earlier reported Session
`s_ca10d118-fb1c-495c-b00b-5d26d3ac80e5` currently has 51 raw transcript
entries, no island sidecar, no compaction entry, and no child-before-parent
violation. Its present persisted order is correct. Because the file was
subsequently resumed and rewritten, the observed UI state cannot now be
reconstructed from disk; it may have been a transient history/live-store or
running-binary projection fault, but this Session is not evidence for the
sidecar merge defect. It remains a required pass-through fixture: already
correct SDK input must remain in byte order.

#### Introduction and Exposure Timeline

- Space v0.1.31 (released `2026-07-12`) embeds KodaX 0.7.68 and already calls
  `loadFullTranscript()` for restored history.
- The sidecar-first full-transcript merge originated in KodaX commit
  `deb38d1d` (`2026-06-16`) and shipped from KodaX 0.7.50.
- KodaX 0.7.68 already reads `.islands.jsonl` and
  `mergeTranscriptLineageEntries()` appends all sidecar entries before all main
  entries. Its own test expects the simple all-old-sidecar/all-current-main
  case, but does not cover a sidecar entry whose `parentId` still points to an
  entry retained in main. `archiveOldIslands()` can retain a non-message entry
  and its ancestor while moving a message subtree to side storage, so the
  mixed-file parent/child trigger is already representable in that version.
- Space commit `408a226` (`2026-07-04`, before v0.1.31) introduced the
  content-hash inactive-island fold and the active-wins policy. The commit's
  assumption that equal inactive content is necessarily a clone is disproven;
  that implementation remained unchanged from v0.1.31 through the affected
  packaged build and is removed by the current Issue 136 fix.
- KodaX 0.7.74 commit `6debae56` (`2026-07-22`) moved full-lineage merging from
  the public API into storage and added durable exact pre-compaction archiving,
  but preserved the same sidecar-first merge. It did not create the ordering
  algorithm defect; it made the relevant compaction sidecars more complete and
  consistently durable, increasing the frequency and visibility of the defect
  after Space upgraded beyond v0.1.31.
- v0.1.31 therefore cannot be treated as a known-good control. The defect was
  latent on both sides before that release, while the current Sessions were
  written after the broader KodaX 0.7.74 recovery path was available.

#### Root Cause

KodaX 0.7.78 `FileSessionStorage.loadFullLineage()` calls
`mergeFullLineageEntries(archivedEntries, mainEntries)`. The equivalent
sidecar-first helper was already present in KodaX 0.7.68's
`loadFullTranscript()` implementation. Both insert every archived sidecar
entry first, then main-file entries. Replacing an existing entry does not
restore its original position, and entries unique to the sidecar remain ahead
of every surviving main entry.

The merge therefore does not preserve the public API's documented raw
append-order contract when a sidecar island has a surviving parent or sibling
in the main lineage. This remains an SDK contract defect even if Space later
hides some raw entries from the main chat; visibility filtering cannot make a
child-before-parent raw transcript ordered.

A second, independent mechanism creates physical replay branches. KodaX
0.7.78 restores each compaction's native `postCompactAttachments` into the
flat model context and then passes that flat context through
`createSessionLineage()`. The reconciler persisted the restored
`compaction-context` attachment as an ordinary navigable message. That changed
the parent path, prevented the retained tail from matching its old branch, and
allocated a new physical entry plus a new `logicalId` for every replayed
message. Repeating restore/reconcile appended the attachment and tail again.

The factual `s_607...` transcript now contains 930 distinct physical entry
IDs. Comparing complete business payloads while excluding physical lineage
identity finds 113 repeated-payload groups containing 702 entries, or 589
extra physical occurrences; the largest group has 12 copies. It also contains
96 persisted `_synthetic` / `compaction-context` carrier messages. There are
no repeated entry IDs, so renderer reconciliation, paging, or React repaint
cannot by themselves explain these copies: they are distinct durable lineage
nodes.

KodaX 0.7.79 correctly skips post-compact attachments during reconciliation
and makes a clean compaction lineage idempotent. It does not yet make handoff
from an already polluted 0.7.78 lineage safe. Against the factual 682-entry
main lineage, reconciling the existing 85 active messages creates 61 new
physical entries, all copies of existing messages, all with a fresh
`logicalId` and no `sourceEntryId`. Reconciling those messages plus one real
new query creates 62 entries: the same 61 old copies plus the one genuine
query. A second reconciliation of the newly re-rooted in-memory lineage is
stable, but the first post-upgrade write can still enlarge persisted history.
Repeated `loadSession()` / `loadFullTranscript()` calls do not write or grow
the files. Any persistence path that invokes full lineage reconciliation can
grow the old lineage; compaction persistence is a confirmed caller. Ordinary
display-only restore is not the trigger, and not every normal next-turn
snapshot path has been dynamically proven to invoke the full reconciler.

The affected Space build then fell back to content hashes in
`dedupeTranscriptEntries()`. Because it suppressed an inactive copy whenever
a same-content active copy existed, it kept the active clone at its later
physical position instead of preserving the first canonical display position.
That amplified `s_607...`'s upstream disorder and was the first ordering
failure in `s_11be...`, whose raw SDK order is otherwise correct. The current
tree removes this content-based deletion path.

Runtime transcript paging and `readPagedRuntimeTranscript()` preserve the order
they receive; `prependSessionHistory()` then normalizes restored user
timestamps monotonically in that order. These layers make the wrong order
stable but are not the first source of it. This is upstream of the renderer
reconciliation fixed by Issue 135 and is not a regression of that
interrupt-turn ownership fix.

#### Required Resolution

- KodaX must make `loadFullTranscript()` honor its existing documented raw
  append-order contract across main JSONL and archive sidecars. This request
  does not ask KodaX to force every archived/inactive entry into Space's main
  chat. It only requires every entry that the raw API returns to keep its
  canonical order. Space does not require a new public timestamp, sequence, or
  particular storage representation to achieve that observable behavior.
- When compaction or legacy handoff represents an existing logical message in
  a new physical record, KodaX must preserve enough exact structural identity
  for a host to distinguish that relation from a legitimate repeated message.
  The SDK owns the internal representation; equal content or timestamps alone
  cannot satisfy this requirement.
- Add a legacy-pollution reconciliation gate. With an existing transcript and
  no new messages, reconciliation must add **0** entry IDs. With exactly one
  new user message, it must add exactly **1** entry ID. Cover a clean sibling
  branch plus a physical `compaction-context` carrier branch, a suffix that
  extends only the polluted branch, JSON round-trip, and repeated resume.
- Existing KodaX 0.7.78 physical replay generations must not be silently
  deleted or merged merely because their payloads are equal. If an exact
  identity relation cannot be established, the data must remain available and
  ambiguous rather than be mislabeled as a clone.
- Add KodaX regressions where a sidecar entry's parent remains in the main file,
  including rewind plus compaction and multiple archive batches, identical
  timestamps, partial sidecar tails, and repeated compaction/resume cycles.
- Verify the paged Runtime transcript exposes the same corrected order as
  direct `loadFullTranscript()`.
- Space must apply an explicit pipeline in this order: classify raw entries for
  main-chat/branch/hidden presentation, preserve canonical order for the
  selected occurrence, fold only proven clones without moving the first slot,
  then project UI items. Storage location or `active: false` alone is not a
  visibility decision.
- Space must stop treating active same-content entries as permission to delete
  or relocate inactive entries. Dedupe must select authoritative payload
  independently from display position, retain the first canonical slot for a
  proven clone, and fail open for ambiguous legacy entries.
- Space must retain `entryId`, `parentId`, `turnId`, `logicalId`,
  `sourceEntryId`, and a canonical history position through Electron, IPC, and
  renderer projection. Assistant/thinking/tool items need the same turn
  envelope as their user entry. Canonical position controls display order;
  `sentAt` controls time presentation only.
- Clone proof in Space is limited to repeated physical `entryId`, repeated
  `logicalId`, or an explicit `sourceEntryId` relation. Equal role/content,
  timestamp, turn ID, parent-clone ancestry, or a nearby
  `compaction-context` carrier can identify a suspicious legacy replay but
  cannot prove identity. Ambiguous legacy rows remain visible.
- Space defensively validates parent-before-child order without a global
  timestamp sort. Timestamp remains presentation/evidence metadata and cannot
  override topology or authorize folding.
- Add a factual Space history-replay regression for both Sessions above,
  asserting query, assistant text, thinking, multi-tool/result pairing,
  task-result/workflow notice, rewind, and compaction-boundary order.
- Cover active/inactive clones, repeated identical legitimate content,
  synthetic hidden carriers, consecutive user prompts, multiple resume clones,
  and history paging. Fail open rather than delete or merge content when clone
  identity is ambiguous.

#### Implementation Status (2026-07-31)

The non-destructive Space-owned portion is implemented on the current tree:

- restored entries first receive a stable parent-before-child repair without a
  global timestamp sort;
- storage markers, exact rewind-abandoned paths, placeholders, visible lineage,
  and ordinary transcript rows are classified before clone folding;
- repeated `entryId`, `logicalId`, and `sourceEntryId` are the only clone
  proofs. The earlier inactive/active content fallback and the experimental
  compaction-carrier path fallback were removed after adversarial examples
  showed that both can delete a legitimate retry or imported replay;
- the first canonical slot is retained while an independently selected exact
  body may become authoritative; children of a folded physical clone are
  remapped to the canonical parent;
- canonical and authoritative identity now reaches history IPC and renderer
  ownership reconciliation; composition preserves canonical order and unique
  render IDs, while fork/rewind turn selectors use the same full-history
  projection as the visible UI; and
- factual `s_607...`, `s_11be...`, and pass-through `s_ca...` models cover
  opening-query order, thinking/text, multi-tool/result pairing, workflow and
  compaction notices, rewind filtering, legal repeated content, ambiguous
  legacy data, placeholder restoration, and unique rendered IDs. Legacy rows
  without provenance deliberately fail open instead of moving or deleting an
  original query.

The local KodaX `0.7.79` test package has now been installed with `--no-save`
and exercised through the same module path the desktop resolves. The current
`out/win-unpacked/resources/app.asar` also embeds 0.7.79, while the root,
desktop, and lockfile declarations still pin 0.7.78; the test build is therefore
not yet reproducible from the committed dependency graph. Package-level probes
confirm stable topology-aware island recovery, exact-main overlap authority,
bounded corrupt-cycle fallback, archive/unarchive collision protection, clean
retained-clone provenance, and direct/paged entry-ID order. Space also consumes a still-fresh
`sessions.observe()` transcript tail as the first history page, eliminating the
extra pre-observation `sessions.load()` and the duplicate initial transcript
materialization. Receipt of any later Runtime event permanently invalidates
that immutable seed; subsequent history reads start a fresh revision instead
of risking stale replay.

#### Updated 0.7.79 Candidate Validation (2026-08-01)

The rebuilt local candidate
`C:\Works\GitProj\KodaX-AI\KodaX\kodax-ai-kodax-0.7.79.tgz` (SHA-256
`BE8F17C95AE1EBF794171F2C3BA25F391285290918D4CFBAD33F09BEF232F5C4`) closes
the factual legacy-handoff defect that kept this issue blocked:

- all 140 installed package files are byte-identical to the candidate tarball;
  the packaged `app.asar` declares KodaX 0.7.79 and its 82 packaged KodaX
  runtime files are byte-identical to the installed candidate;
- against the unchanged factual 682-entry main lineage and 85 active messages,
  zero-input reconciliation adds **0** entry IDs, one controlled new user
  message adds exactly **1**, and repeating either reconciliation adds **0**;
- a clean compaction fixture is also idempotent on first and repeated
  reconciliation, persists no synthetic attachment carrier as an ordinary
  lineage message, and keeps exact `logicalId`/`sourceEntryId` provenance on
  both retained-tail clones;
- the strict transcript contains 930 unique entry IDs with no
  parent-before-child violation. The opening query is canonical index 0 and
  the formerly displaced P0 query is index 35;
- Runtime direct history matches the strict direct transcript. Traversing all
  930 one-entry pages newest-to-oldest and prepending each page reconstructs
  the direct append order entry-for-entry, including the oversized descriptor;
- five rounds through legacy and strict Session/full-transcript reads leave the
  main and island files unchanged in size, modification time, and SHA-256;
- zero-input reconciliation also returns a byte-for-byte equivalent 682-entry
  active lineage. It prevents new pollution but does not rewrite or delete the
  already persisted 949-entry full lineage, so ambiguous historical copies
  remain a separate conservative recovery concern;
- the Space transcript/order/compose/fork/rewind/store suites pass 175/175,
  the Runtime adapter and compatibility suites pass all 96 functional checks,
  and full TypeScript typecheck passes.

The issue stays **In Progress** for two independent gates. The npm Registry
does not yet contain 0.7.79, while root/desktop manifests and the lockfile
intentionally remain pinned to 0.7.78; Space still needs a reproducible released
dependency build. Separately, 0.7.79 prevents new replay pollution but cannot
reconstruct canonical identities missing from already polluted 0.7.78 history.
Until a supported legacy classification/migration boundary exists, Space
continues to preserve ambiguous old physical copies rather than risk another
missing/relocated-query regression.

#### Superseding Conversation-History Contract Validation (2026-08-01)

The later rebuilt local `0.7.79` package has SHA-256
`6EB5A2A475509E8523BB4FB054EC05E324CA7141E0772DA82D8F3D3F349C14DE` and
adds the SDK-owned ordinary-conversation projection that Space had been
missing. The standalone `readConversationHistory()` result and Runtime
`sessions.conversation()`, `conversationPage()`, and
`conversationEntryChunk()` paths were compared on the factual Session. Direct
and paged reads have identical bodies, order, revision, source revision,
status, and issues; newest-first pages prepend back to the direct order, and a
245,588-byte oversized entry reconstructs byte-for-byte from chunks. The
daemon advertises `conversationHistory: 1`, and fork/rewind accept an exact
returned boundary fenced by `sourceRevision`.

That transport result is a **GO**, but it does not prove that the factual
legacy duplicates were recovered. For
`s_60717080-1d27-42fd-ac6a-be27319d9503`, the SDK currently returns
`status: ambiguous`, 956 ordinary-conversation candidates, and the issues
`compaction_boundary_invalid` and `compaction_predecessor_missing`. Every
candidate has a one-element `auditEntryIds` list, so no legacy replay
generation was proven equivalent and folded. The known `/add-feature ...`
query still appears at 11 distinct returned boundaries. This is correct
fail-open behavior for uncertain evidence, but it means Issue 136 is not
resolved for this historical Session.

Space now consumes this conversation projection for the main chat and keeps
the full transcript as an audit/legacy-fallback surface only. It does not run
the old content/role/timestamp/turn dedupe over the SDK projection. The IPC
preserves `resolved` / `partial` / `ambiguous`, `sourceRevision`, and bounded
issue counts; the renderer explicitly warns for non-resolved histories.
Repeated equal-content candidates remain visible. Fork/rewind binds only the
exact visible candidate boundary plus `sourceRevision`; it never substitutes a
content match, and a stale or unknown boundary fails closed. Standalone and
Runtime paths follow the same rule.

The remaining KodaX question is factual rather than prescriptive: determine
whether the real compaction topology around `entry_93b8a7b49cef` can prove a
lossless canonical interpretation. If it can, the ordinary projection should
return the proven interaction once with all corresponding physical copies in
`auditEntryIds`; if it cannot, it must remain `ambiguous` and retain every
candidate. Space requests no timestamp, sequence, public sorting field, UI
policy, or internal storage algorithm. Registry publication and an exact
manifest/lock pin remain separate release gates.

#### Factual Legacy Repair and Resume Validation (2026-08-01)

The later duplicate-content report is persisted-history pollution, not a React
double render. The `/add-feature ... /complete-feature` query occurs at 11
different physical transcript entries. Every occurrence has a unique
`entryId` and `logicalId`, no `sourceEntryId`, and the same factual turn,
timestamp, and content. At least seven following assistant/thinking/tool/result
chains are byte-identical. Space therefore has no authoritative identity with
which to fold them, and the current fail-open projection correctly exposes the
old physical copies instead of silently deleting a potentially real retry.

The legacy KodaX reconciler caused this pollution during resume. It cloned the
previous lineage but restarted reconciliation with no active parent, then
reprocessed the already-active flat message list as a new root chain. Existing
messages consequently received new physical and logical IDs, so each resume or
compaction handoff could persist another complete generation. KodaX 0.7.79's
active-prefix/suffix reconciliation prevents that new growth and preserves
provenance for newly re-materialized retained entries; it cannot reconstruct
identity that older files never stored.

The full 930-entry audit and the active model-resume context have different
repair boundaries. The active lineage has 82 entries and expands to 85 model
messages because the latest compaction's three `postCompactAttachments` also
exist as six standalone `_synthetic: true`, `_source: compaction-context`
messages. Those six are exact redundant context carriers. The 11 old query
generations are inactive audit history and cannot be permanently collapsed by
content, timestamp, or turn ID without guessing.

An earlier Space repair experiment used KodaX's native `forkSession()` and
incorrectly called the result a repaired Session. Native fork is an
active-context operation: it copied only the selected active path, not the full
append-order audit lineage. Consequently `s_repaired_60717080_20260801` has 76
transcript entries while the source then had 930. The roughly 867 omitted
inactive/audit entries explain the user's observation that the repair lost a
large amount of information. Stability across repeated reads proved only that
the smaller target was stable; it did **not** prove losslessness.

This target is therefore classified as an incomplete active-context recovery,
not a valid full-history repair. The original Session was never overwritten or
deleted, and its exact main/islands backup remains at
`C:\Users\ADMIN\.kodax\session-repair-backups\20260801T022802Z-s_60717080-1d27-42fd-ac6a-be27319d9503`.

The repair utility now fails closed before backup, fork, or target creation
whenever full-lineage and active-lineage counts differ. Against the later
factual state it refused 983 full-history entries versus 31 active-path entries
and created no target. It still never content-deduplicates ordinary
query/assistant/tool records. A genuinely lossless canonical repair of the
old 0.7.78 replay generations remains unavailable until an authoritative
legacy classification/migration boundary exists; Space must not guess it from
content, timestamp, `turnId`, or storage location.

### 137: Live committed compactions omit the transcript boundary that history replay adds after reopen

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.27 history-notice projection
- Created: 2026-07-30

#### Original Problem

A long Session can compact successfully while it is open without showing
`Conversation compacted` / `上下文已压缩` in the transcript. Reopening the same
Session then inserts that visible boundary retroactively. Users therefore see
different transcript semantics before and after restart and may reasonably
infer either that compaction did not happen live or that reopen invented a new
event.

Expected behavior:

- every committed root-context compaction has exactly one compact transcript
  boundary at the point where it commits;
- live projection and history replay reconcile to the same boundary identity
  and position;
- a no-op compaction with `committed: false` does not claim that the
  conversation was compacted; and
- child-context compactions do not leak into the root conversation.

#### Context

Session `s_11be2ee5-54f4-4740-84ce-b22f1577db73` provides direct event evidence.
Its Runtime journal records:

- `context.compaction.started` at `2026-07-29T07:05:31.274Z`;
- `context.compaction.finished` at `07:06:50.321Z`, with
  `committed: true`, source `automatic_threshold`, context revision `1`, and
  tokens reduced from `326228` to `110766`; and
- `context.compaction.ended` at `07:06:50.325Z`.

The persisted compaction lineage entry was created at
`2026-07-29T07:06:50.278Z`, so the Session did compact while live. Its absence
from the live transcript is a projection gap, not absence of the Runtime
operation. Issue 136 independently explains why the restored boundary is also
placed at the wrong position.

#### Root Cause

Space has two disconnected compaction presentation paths:

- live Runtime events are mapped to `compact_start`, `compact_stats`, and
  `compact_end`; the activity spinner and context gauges consume those events,
  but `composeMessages()` does not render any of them as transcript content;
- `session.history` maps persisted `compaction` lineage entries to
  `lineage_notice`, which `composeMessages()` renders as the localized compact
  boundary and coalesces only when adjacent.

The semantic mismatch shipped in v0.1.27 when commit `ff34907`
(`2026-07-05`) introduced structured restored transcript notices without a
matching live transcript row. v0.1.31 already rendered restored `compaction`
entries but did not render live compaction lifecycle events into the
transcript. Commit `61b9bd1` (`2026-07-27`) changed the restored presentation
from an English label plus the full internal summary to the compact localized
`上下文已压缩` boundary shown in the screenshot. That later UI change made the
mismatch much easier to notice; it did not introduce the live/history
inconsistency.

The live `context.compaction.finished` payload does not currently expose the
persisted compaction entry id, while the history projection does not carry a
stable reconciliation identity into the renderer. Simply rendering
`compact_stats` would therefore risk duplicate boundaries after history replay
or false boundaries for `committed: false` and child contexts.

#### Required Resolution

- Unify live and restored compaction boundaries behind one canonical transcript
  item with stable identity, timestamp, context identity/revision, committed
  state, source, and token statistics.
- Implement reconciliation in Space from canonical Runtime data: project the
  committed finish immediately with its Runtime event ID,
  then carry any authoritative persisted `entryId` through Space IPC, history
  replay, store reconciliation, and rendering. A physical entry ID on the live
  event is not required to show the live boundary; it is required before Space
  may collapse that provisional with a durable history row.
- Emit the visible boundary only for `committed: true` root-context
  compactions. Continue to use start/end for activity and stats for gauges
  without treating those telemetry events as independent transcript rows.
- With authoritative physical identity, reconcile live-first, history-first,
  switch/reopen, and reconnect delivery exactly once. Without that identity,
  keep provisional or ambiguous facts in place rather than guessing or deleting
  one; the adjacent presentation layer may still coalesce them visually.
  Preserve one stable boundary position after Issue 136 restores authoritative
  transcript ordering.
- Add regressions for manual, automatic-threshold, and physical-capacity
  compaction; committed false; child contexts; adjacent compactions; crash
  between lifecycle events; history/live duplicate delivery; and token-stat
  restoration.

#### Resolution

- A committed root finish now inserts one provisional `lineage_notice`
  synchronously at the Runtime event slot. It uses the stable Runtime event ID
  and carries available context revision, source, token facts, and event time.
  A paging failure can no longer make the live boundary disappear.
- Durable entry binding is optional and runs outside the serialized Runtime
  event queue only when a compatible Runtime finish supplies the exact
  `compactionEntryId`. It scans at most two newest transcript pages / 128
  descriptors and decodes at most two oversized entries per attempt, with the
  existing narrow retry schedule. Current Runtime events omit that field, so
  Space keeps the already-visible provisional and performs no heuristic scan.
- Binding rejects child/no-op events, legacy rewind compactions, tokenless or
  partially populated historical rows, token-mismatched rows, duplicate
  physical IDs, and every candidate whose `entryId` is not the ID named by the
  finish event. Token pairs, timestamps, active state, and transcript proximity
  never lend physical identity.
- When the durable entry becomes visible, Space emits the same provisional ID
  with `entryId`, lineage identity, canonical index, persisted timestamp, and
  an explicit `displayId`. The renderer upgrades the existing array slot in
  place rather than appending or moving the notice; live-first and history-first
  rows retain the display identity that was already mounted.
- History-first and live-first paths delete or replace a boundary only by
  physical entry ID or provisional ID. Token counts, timestamps, context facts,
  and summary text are never treated as unique identity. Ambiguous boundaries
  fail open, and distinct adjacent compactions remain separate stored facts
  while the existing presentation rule may coalesce only visibly adjacent
  notices.

Validation covers successful two-page binding after a stale mismatched row,
all paging retries failing while later output continues, replay, no-op and child
contexts, legacy rewind exclusion, tokenless-candidate rejection, same-token
distinct compactions including a stale row only 20 ms away, missing physical-ID
fail-open behavior with zero transcript-page reads, unblocked later output,
history-first exact-ID reconciliation with stable renderer identity, in-place
upgrade, token restoration, adjacent presentation coalescing, and the full
s_607-style renderer projection.

#### Main-chat Policy Supersession (2026-08-01)

KodaX 0.7.79 separates SDK-owned ordinary conversation from raw audit lineage.
Space therefore no longer renders `compaction` or `branch_summary` lineage
records as durable rows in the ordinary main chat. Live compaction remains
visible through explicit activity/context state, while raw lineage and its
reconciliation identities remain available to audit/details. This makes live
and reopened ordinary-chat semantics consistent and prevents internal summaries
or restored-only “context compacted” rows from being mistaken for user/model
conversation. The earlier reconciliation machinery remains available for audit
integrity; `ConversationStreamV2` simply opts out of that audit projection.

### 138: Session history silently retains the oldest 2,000 projected items and can omit the newest visible tail

- Priority: Medium
- Status: Resolved
- Introduced: bounded `session.history` IPC projection
- Fixed: corrected v0.1.34 source
- Created: 2026-07-30
- Resolved: 2026-07-30

#### Problem

The history projection is capped at 2,000 items, but the current producer keeps
the prefix when the cap is reached. A sufficiently long Session can therefore
restore its oldest visible rows while silently omitting its newest query,
assistant output, tools, and completion tail. The durable Runtime transcript is
not deleted, but Space presents an incomplete conversation without a truncation
notice.

This is independent of Issues 136 and 137. The three factual Sessions used for
the ordering repair remain below the cap after current projection (approximately
1,094, 179, and 85 items), so the cap did not cause their observed disorder and
does not block that repair.

#### Required Resolution

- Preserve the newest coherent visible tail within the current bounded IPC
  contract and surface an explicit truncation boundary.
- Start at a complete user turn whenever one fits. If one turn alone exceeds
  the window, keep its owning query and newest assistant/tool tail, and mark the
  omitted middle explicitly; never orphan a tool result from its call.
- Keep fork/rewind selectors, query ordinals, history/live reconciliation, and
  renderer ordering on the same loaded window.
- Add regressions above 2,000 projected items, including a multi-tool turn
  crossing the boundary and history reload while live events arrive.

#### Resolution

- `session.history` still enforces the 2,000-item IPC bound, but projection no
  longer stops on the oldest prefix. It builds the canonical visible sequence,
  keeps the newest complete-turn window, and prepends a typed
  `history_truncation` boundary with the exact omitted item count.
- When one final turn itself exceeds the window, Space retains the original
  query, adds a second in-turn truncation boundary at the actual gap, and keeps
  the newest paired tool cards/results. The query and latest outcome therefore
  remain visible without claiming the missing middle is complete.
- Every restored user boundary now carries its absolute pre-window
  `historyTurnIndex`. Renderer composition continues that index for later live
  turns. Bubble actions, session menus, slash commands, and context menus all
  use that absolute selector; fork/rewind resolve it back to the bounded
  message/event buffer with the same segment-ownership model before changing
  local state.
- Fork and rewind now fail closed when the requested persisted selector does
  not exist. In particular, an invalid/no-user rewind is rejected before
  cancelling a running Session or calling a disk mutator. The IPC selector
  bound is shared with `historyTurnIndex`, so valid turns above 10,000 are not
  rejected at the renderer/main boundary.
- Replaying an identical truncated history window is idempotent: its synthetic
  hidden owner and truncation notices have stable internal reconciliation
  identity, while remaining hidden from the transcript and selector count.
  The newest Space-owned side-store notices receive a bounded 32-item reserve,
  so a full 2,000-item conversation cannot make every durable notice disappear.
  The remaining conversation budget still selects a coherent newest-turn
  window with explicit truncation markers; older notices cannot consume more
  than the fixed reserve.
- English and Chinese UI labels distinguish omitted history from an omitted
  middle of an oversized turn. Tests cover a complete retained tail, a
  2,100-tool single turn, assistant-only history, no-op under the limit,
  history-to-renderer ordering, repeated hydration, absolute selector
  continuation, same-length selector replacement, no-assistant segments,
  capped local-notice pressure, fail-closed host mutation, and fork/rewind of a
  truncated buffer.
- Cursor-based incremental loading remains a future scalability enhancement;
  it is no longer required to prevent silent wrong-tail presentation.

### 139: Pinned task metrics wrapped out of alignment and long header labels used clipped native tooltips

- Priority: Low
- Status: Resolved
- Introduced: v0.1.34 task summary header
- Fixed: corrected v0.1.34 source
- Created: 2026-07-30
- Resolved: 2026-07-30

#### Problem

The pinned task header allowed the Agent metric value to wrap independently
from its chip, producing a two-line counter inside a single-line title bar.
Breadcrumb and task-summary labels relied on native `title` bubbles, so long
Session names and paths could be constrained or clipped by the window and
overflow boundaries.

#### Resolution

The header now uses a fixed single-row grid with non-wrapping metric chips and
predictable shrink behavior for the descriptive text. Long project, Session,
and task labels use a portal tooltip that wraps and clamps to the viewport,
including keyboard-focus access.

### 140: Session-cumulative Actor snapshots leaked previous-turn Agents into current task counts and cards

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.34 Runtime Actor task projection
- Fixed: corrected v0.1.34 source
- Created: 2026-07-30
- Resolved: 2026-07-30

#### Problem

The Runtime Actor tree is intentionally cumulative for a Session, but the
pinned task summary, Task Dock, and right sidebar treated the full tree as the
current turn. In Session `s_11be2ee5-54f4-4740-84ce-b22f1577db73`, completed
`md-to-html` and `html-to-pdf` Actors from earlier turns inflated the current
Beijing/Shanghai task counts. The sidebar then rendered only the first four
cards while displaying the five-Actor aggregate.

#### Resolution

All three task surfaces now share a current-turn Actor projection. It scopes
the cumulative snapshot at the latest root `session_start`, retains Actors
referenced by this turn's spawn/follow-up results plus live Actors, and keeps
the matching completed Actors so current-turn completion remains visible.
The sidebar no longer applies an independent four-card slice.

### 141: `.agent` runtime artifacts consumed the Changes panel's 200-file limit before meaningful project files

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.34 Git changes projection
- Fixed: corrected v0.1.34 source
- Created: 2026-07-30
- Resolved: 2026-07-30

#### Problem

An unborn but valid Git repository could contain thousands of untracked
`.agent/managed-tasks` runtime files. The Changes IPC collected and capped
those files before user-authored outputs, so the panel showed `200+` internal
records while hiding the small meaningful change set.

#### Resolution

Git status collection now excludes `.agent` with a root-relative pathspec
before porcelain output is produced, and the parser independently rejects the
directory before applying the 200-file guard. The lightweight dirty-status
query uses the same visible-worktree scope. This changes only Space's Git
projection and does not write a `.gitignore` into the user's project.

### 142: Full-effects history restoration mounts and animates an entire long transcript beneath a live backdrop surface

- Priority: Medium
- Status: In Progress
- Introduced: current ConversationStreamV2 / full-effects renderer
- Hardened: corrected v0.1.34 source
- Created: 2026-07-30

#### Problem

Opening Session `s_60717080-1d27-42fd-ac6a-be27319d9503` from the packaged
Windows build can freeze the desktop for several seconds in Full visual
quality, while the lower visual-quality modes avoid the severe stall. This
Session is a material outlier rather than an ordinary long conversation: its
durable JSONL is 9,083,571 bytes, approximately 4.85 times the next-largest
persisted Session inspected, and restores approximately 850 transcript
entries. Assistant thinking alone accounts for approximately 5.5 MB and more
than 71,000 newlines.

A warm in-process Runtime history load takes approximately 260 ms for this
Session. That parsing and allocation burst is significant, but it does not
explain the observed multi-second Full-only freeze. The remaining dominant
work occurs while the renderer constructs, lays out, paints, and composites
the restored conversation.

#### Root Cause

- `ConversationStreamV2` composes the complete restored transcript, builds
  every render item, and mounts it through one `renderItems.map(...)`; it has
  no row virtualization or offscreen content containment.
- Restored assistant output runs through the Markdown/GFM/highlight pipeline,
  and every standard restored row is wrapped in the same `Reveal` path used
  for newly arriving content. Collapsed thinking and tool bodies do not all
  become visible DOM, but their large strings remain an allocation and garbage
  collection multiplier.
- Full quality keeps a viewport-sized `backdrop-filter: blur(24px)` on the
  center pane while three large aurora blobs animate beneath it. The existing
  interaction guard disables this work for wheel, scroll, drag, and resize,
  but Session hydration is not considered an interaction, so the most
  expensive visual path remains enabled during the largest DOM/Markdown mount.
- Overflow clipping limits what is finally visible; it does not eliminate
  React construction, Markdown parsing, style calculation, scroll-height
  layout, DOM memory, or compositor bookkeeping for offscreen descendants.
  Message length and Full effects therefore multiply each other's cost in the
  current architecture even though the final blurred pixels are
  viewport-local.

The startup diagnostic that reports software-disabled GPU features is not
reliable root-cause evidence: it is sampled before GPU readiness, while the
packaged app's GPU process is subsequently visible on the NVIDIA 3D engine.
The Session parses without corrupt-record errors, and disk/Runtime loading
alone is too short to account for the freeze.

Intermittent freezes after sending a new query in Balanced quality have a
separate primary cause and are tracked in Issue 143. Full-effects compositing
amplifies initial restoration work, but it is not required for the live
Runtime event storm.

#### Required Resolution

- Treat history hydration separately from live output. While a large restored
  window mounts, temporarily pause aurora/spotlight and remove the center-pane
  backdrop; restore Full quality after layout settles. Do not replay entry
  animations for restored rows, while preserving animation for genuinely new
  messages.
- Virtualize variable-height `ConversationRenderItem` rows with pixel
  overscan, stable keys, measured-height caching, and a total-height spacer.
  Preserve the continuous scrollbar, bottom anchoring, live follow, query
  jumps, search, fork/rewind selectors, and expansion-driven height changes.
- Progressively hydrate Markdown and fetch large thinking/tool bodies only
  for the viewport, overscan, or explicit expansion. Keep searchable metadata
  and token counts in the lightweight initial projection.
- `content-visibility: auto` with measured intrinsic sizes is an acceptable
  bridge for native scrolling, but it is not the final fix because it retains
  every React component, DOM node, and payload in renderer memory.
- Add packaged performance coverage using the factual outlier Session (or an
  equivalent generated fixture), recording history-load time, renderer long
  tasks, first stable paint, peak renderer memory, and scroll-anchor
  correctness in all three visual-quality modes.

#### Space Mitigation

- Restored conversation rows use the browser's native `content-visibility`
  occlusion with content-derived intrinsic-height estimates. The complete
  native scroll range, DOM order, anchors, browser search, query navigation,
  and expansion behavior remain intact while offscreen layout/paint work is
  skipped and scrollbar estimates are substantially closer than one fixed
  placeholder height.
- Continuous cumulative text/thinking updates patch only the open assistant
  tail when the event prefix and Runtime sequence remain continuous. Stable
  historical messages and render items retain object identity, and memoized
  rows therefore skip historical Markdown, grouping, and bubble work on each
  live fragment. Structural or non-tail changes fail back to the canonical
  full composer.
- Historical thinking token estimates use a bounded per-entry cache rather
  than rescanning multi-megabyte thinking strings on each delta. Render reads
  only the committed cache; misses are merged after layout commit so an
  abandoned concurrent render cannot clear or pollute another Session's cache.
- Intrinsic-height estimation samples at most 4,096 characters per text block,
  so cumulative live output does not repeatedly rescan its complete prefix.
  Expanded/force-expanded thinking and tool receipts use content-related
  estimates, bounded to the same capped presentation height.
- Scroll/query anchoring samples the row at the viewport point and reads one
  relevant geometry target instead of querying and measuring every transcript
  row on each scroll event. Scroll synchronization is animation-frame
  throttled.
- Only the newest 24 render items are eligible for entry animation. History
  restoration therefore does not replay hundreds of `Reveal` animations, while
  newly arriving messages retain their visual treatment.
- Collapsed assistant thinking is now lazy-mounted. Multi-megabyte thinking
  strings remain available in projection state, but the Markdown/text DOM is
  not created until the user expands the section.
- Space marks history hydration as render-busy until two animation frames after
  the store commit. During that interval Full quality pauses aurora animation,
  removes the center-pane backdrop blur, and disables reveal transitions.
  The same compositor guard remains active during live Runtime streaming,
  queued Runs, and compaction, then restores the configured visual quality
  automatically when all work settles.
- The live tail explicitly opts out of occlusion so streaming output and bottom
  follow remain immediately visible.

This is a bounded mitigation, not final closure. Issue 142 remains In Progress
until the factual outlier Session (or an equivalent fixture) has packaged
renderer long-task, first-stable-paint, peak-memory, and scroll-anchor metrics
in all quality modes, and until viewport virtualization/progressive hydration
is implemented if those measurements still exceed the interaction budget.

Files changed:

- `apps/desktop/renderer/src/components/Reveal.tsx`
- `apps/desktop/renderer/src/features/session/messages/bubbles.tsx`
- `apps/desktop/renderer/src/shell/ConversationStreamV2.tsx`
- `apps/desktop/renderer/src/shell/conversationStreamIncremental.ts`
- `apps/desktop/renderer/src/shell/GlassAurora.tsx`
- `apps/desktop/renderer/src/shell/Shell.tsx`
- `apps/desktop/renderer/src/shell/auroraActivity.ts`
- `apps/desktop/renderer/src/styles.css`
- `apps/desktop/electron/test/conversation-stream-incremental.test.ts`

Verification:

- Focused Runtime/render-policy tests pass.
- Electron and renderer TypeScript checks pass.
- The full desktop suite passes with 2,043 passing and 4 platform-conditional
  skipped tests.
- The production smoke build passes.
- An isolated packaged Windows build boots with KodaX 0.7.78, initializes the
  Runtime host, and reaches `app://space` renderer-ready without replacing the
  developer's running `out/win-unpacked` build.

### 143: Per-fragment Runtime stream events saturate persistence, IPC, and long-Session renderer updates

- Priority: High
- Status: In Progress
- Introduced: KodaX typed Runtime streaming + current Space event bridge
- Created: 2026-07-30

#### Original Problem

While Session `s_60717080-1d27-42fd-ac6a-be27319d9503` was running in Balanced
visual quality, sending a new query could leave the whole Space window
unresponsive for more than 10 seconds. The same active Session then froze
intermittently for additional multi-second periods. This behavior does not
require Full visual effects and therefore is not explained by Issue 142 alone.

The factual Run `run_ms7m99gl_d9210f61` started at
`2026-07-30T14:36:02.561Z`. One retained event-log window inspected during the
Run contained 25,689 valid JSON records over 191 seconds, all
`thinking.delta`, carrying only 96,924 text characters in total. The average
payload was approximately 3.8 characters and the largest only 15 characters,
yet every fragment was a separate Runtime event. Earlier in the same Run,
consecutive `tool.progress` records for `write` tool-input fragments also
shared the exact same millisecond timestamp. The event file repeatedly grew
toward its 16 MB trim threshold.

At the same time, the active packaged renderer used more than one logical
core, the Coder daemon approached another core, and the renderer's private
memory exceeded 950 MB. The independent orphan-daemon load recorded under
Issue 133 magnified the wall-clock stalls, but it did not create this
Session-specific event stream.

#### Root Cause

- KodaX emits one typed `assistant.delta`, `thinking.delta`, or
  `tool.progress` event for every provider/tool fragment. Creating each event
  synchronously allocates the global sequence through a file lock and atomic
  sequence-file rewrite. Event-line persistence is buffered, but sequence
  persistence is still paid per fragment.
- Space main bridges every Runtime fragment individually. Each event is
  projected, validated through the push schema, serialized, and sent through
  a separate `webContents.send` call; there is no main-process coalescing or
  renderer backpressure.
- The renderer batcher queues every raw IPC event and normally merges adjacent
  text/thinking fragments once per animation frame. A live-snapshot barrier,
  however, can drain a paused Session in original raw order without
  coalescing, so a delayed snapshot can turn a backlog into thousands of
  synchronous store writes.
- Even on the normal batched path, Runtime-tagged deltas are retained as
  separate event-bucket entries rather than one replaceable live draft. Every
  update immutably copies the growing bucket and invalidates the Session's
  transcript composition. The non-virtualized long conversation from Issue
  142 magnifies that update and garbage-collection cost.

The periodic nature follows from this pipeline: fragment bursts build queues
and short-lived arrays, snapshot reconciliation can release a large raw
backlog, and garbage collection or React/layout work then blocks the renderer
until it catches up.

#### Required Resolution

- Separate transient stream transport from durable semantic Runtime events.
  Coalesce text/thinking/tool-input fragments by Session, Run, context, tool,
  and event kind on a short bounded interval or byte threshold. Persist a
  sequence range and periodic draft checkpoint rather than locking and
  atomically rewriting the global sequence cursor for every few characters.
- Batch the Runtime-to-renderer bridge into bounded IPC envelopes. Preserve
  structural event order, but merge adjacent stream fragments and retain only
  the latest replaceable progress update before schema validation and
  `webContents.send`.
- Store active assistant/thinking/tool-input drafts separately from the
  immutable transcript event list. Update each draft at a capped visual rate,
  commit one final semantic entry at its finish boundary, and prevent a
  per-frame event bucket from growing for the duration of a Run.
- Replace raw paused-queue drain with boundary-aware coalescing. Structural
  lifecycle/tool events remain ordered, while adjacent deltas on the same side
  of the accepted snapshot cursor carry an explicit first/last sequence range.
- Add backpressure and observability: queue depth, events and characters per
  second, IPC batch size, snapshot-drain size, renderer long tasks, event-file
  trim rate, and dropped/replaced progress counts. A pathological provider
  stream must remain bounded without losing final text or cursor correctness.
- Add a packaged Windows regression using a long restored Session and a
  generated one-to-five-character delta stream. Balanced and Full modes must
  stay interactive during send, stream, snapshot reconciliation, tool-input
  assembly, and completion.

#### Space Mitigation

- The renderer batcher now coalesces continuous same-stream assistant text and
  thinking deltas, including paused queues released by snapshot hydration.
  Merging is capped at 256 KB and requires continuous Runtime sequences (or
  legacy events with no Runtime provenance), so a missing middle event remains
  recoverable.
- The accepted/incoming snapshot draft watermarks are passed into queue drain.
  Deltas on opposite sides of the snapshot boundary are never merged.
- Continuous tool-input JSON fragments are concatenated only when both events
  carry the same explicit `toolId`; optional/ambiguous IDs remain separate.
  Adjacent replaceable tool-progress events retain only the latest state.
  Structural events preserve their original order.
- Store-level cross-frame coalescing applies the same continuity, size, and
  snapshot-side checks, bounding event-bucket growth when the stream spans
  multiple animation frames.
- A 10,000-fragment regression collapses to one exact-text batch; snapshot
  boundary, missing-middle recovery, tool-input, progress, and cursor tests
  pass.

#### KodaX 0.7.79 release-candidate validation

- The local 0.7.79 package advertises `runtimeEventCoalescing:1` as both a
  pre-start SDK fact and a connected Runtime capability. Space now requires
  both surfaces and includes the requirement in its daemon handshake; it no
  longer treats `daemonOrphanExit:1` as sufficient proof that the stream source
  is bounded.
- The upstream implementation coalesces before sequence allocation and checks
  the 8 KiB threshold before aggregation. The release-candidate tests cover
  25,000 tiny thinking fragments, 7 KiB + 7 KiB ordering, structural flushes,
  reconnect/replay, snapshot watermarks, cancellation and shutdown.
- Space exposes `runtime.events.coalescing` in its capability projection while
  retaining renderer-frame batching, sequence continuity and snapshot-side
  checks as an independent consumer safety layer.

The pathological source event amplification is fixed in the 0.7.79 release
candidate. Issue 143 remains In Progress only until the exact Registry package
is pinned in both Space manifests and packaged long-Session acceptance confirms
the end-to-end CPU/latency improvement. The contract and evidence are recorded
in `docs/KODAX_RUNTIME_STREAM_PERFORMANCE_HANDOFF.md`.

Files changed:

- `apps/desktop/renderer/src/App.tsx`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/store/sessionEventBatcher.ts`
- `apps/desktop/electron/test/app-store-runtime-projection.test.ts`
- `apps/desktop/electron/test/session-event-batcher.test.ts`
- `docs/KODAX_RUNTIME_STREAM_PERFORMANCE_HANDOFF.md`

Verification:

- Focused event batching, store projection, hydration, and aurora policy tests
  pass.
- Against the local 0.7.79 release candidate, the SDK/adapter suite passes 96/97;
  the sole failure is the intentional exact-pin guard because the Registry and
  both Space manifests still name 0.7.78. TypeScript, focused lint/formatting,
  and the production smoke build pass.
- The formal full desktop suite and isolated packaged boot remain release gates
  after Registry 0.7.79 can be pinned atomically in both manifests and the lock,
  followed by a clean install.

### 144: Complete exit reports failure when daemon transport closes before its successful rollback reply

- Priority: Medium
- Status: Resolved
- Introduced: KodaX 0.7.79 integration
- Fixed: v0.1.34 source
- Created: 2026-07-31
- Resolution Date: 2026-07-31

#### Original Problem

On Windows, choosing complete exit while no task was running always displayed
the warning **The complete-exit preparation did not finish safely**. Dismissing
that warning and requesting exit a second time closed Space normally.

Expected behavior:

- one complete-exit request should stop an idle, unshared Coder daemon and close
  Space;
- an active task, another client, or an unverifiable owner transition must still
  keep Space open; and
- a successfully stopped daemon must not be reported as a shutdown failure just
  because its final RPC response raced the transport close.

#### Root Cause

Structured Space diagnostics recorded the first failure as
`Runtime daemon transport closed.`. At the same timestamp, the daemon control
journal recorded `daemon.rollbackToInline` as `applied`, and the daemon log
recorded the requested stop, stopping phase, and final stopped state. The owner
policy then advanced from inline rollback policy back to daemon policy when the
second exit completed.

The rollback transaction stops the daemon carrying its own response. With the
affected transport timing, socket closure rejected `stopForInline()` before the
successful response reached Space. `prepareInlineRollback()` treated that
ambiguous boundary error as a failed stop and reopened the UI even though the
daemon and owner fence had already been released. The next exit used the
already-stopped fallback path and therefore succeeded.

#### Resolution

- Complete exit now recognizes only the specific daemon transport-closure
  boundary and treats it as an ambiguous result, never as success by itself.
- Space re-establishes the rollback transition guard, waits for the exact
  Runtime owner ID to be released through the authoritative owner-state API,
  acquires the inline fence, restores daemon policy, and verifies the final
  unowned daemon policy before committing application exit.
- A different, unreadable, or unreleased owner still fails closed and preserves
  the existing recovery behavior.
- If daemon-policy restoration and inline-fence recovery both fail, the
  restart-required error code survives reconciliation so Electron schedules the
  existing visible recovery restart instead of reopening admission.
- The common post-stop owner transition was extracted so the normal reply path
  and the verified lost-reply path use the same fencing and compensation logic.

Files changed:

- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `docs/KNOWN_ISSUES.md`

Verification:

- Focused rollback and complete-exit coverage passes 8/8.
- The complete Runtime host adapter suite passes 85/85.
- Electron main-process TypeScript, focused ESLint, and Prettier checks pass.
- Regression coverage proves both the applied-stop/lost-reply success path and
  the fail-closed path where exact owner release cannot be established.

### 145: Session hover and selection can multiply full-history materialization before applying the UI window

- Priority: High
- Status: Resolved
- Introduced: v0.1.31 hover prefetch / Runtime paging integration
- Hardened: v0.1.34 corrected source
- Created: 2026-08-01
- Resolved: 2026-08-02

#### Problem

Opening Sessions became slow after the 0.7.79 test build, and moving across the
left Session list could leave unrelated history reads running. The factual
`s_607...` transcript is approximately 15 MB before projection and about 45 MB
as the complete SDK result object. Space projected roughly 1,245 UI items and
13 MB of renderer payload. The 2,000-item history cap was applied only after
the complete transcript had already been paged, materialized, projected, and
transferred.

#### Root Cause

- Every Session row called `session.history` on `mouseenter`. The comment
  claimed this warmed the five-entry `session-store.ts` cache, but the current
  Coder Runtime path goes through `RuntimeHostAdapter.transcript()` and never
  consumes that cache. The hover result was discarded.
- Clicking the same row issued another full history request. There was no
  per-Session in-flight sharing, and renderer cancellation only ignored the
  late result; it did not cancel daemon/main work.
- History and `session.liveSnapshot` raced independent Session loads and
  transcript materializations. Without an observation snapshot, Space also
  loaded the same Session once for ownership and again inside paging.
- Runtime paging was bounded per response but Space still traversed every page
  before applying its item limit. The problem is request amplification and
  eager full materialization, not a KodaX 0.7.79 paging regression. KodaX
  0.7.79 actually reuses one immutable snapshot across continuation pages,
  unlike the older per-page full re-read behavior.

Issue 136 explains why the factual Session is abnormally large. Issue 142
tracks renderer mount/layout/compositor cost after payload delivery. This issue
tracks the earlier read/transport amplification and remains independently
observable with lower visual quality.

#### Current Mitigation

- Remove full-history hover prefetch from the Session list.
- Coalesce concurrent transcript calls per Session around one immutable page
  traversal; this is an in-flight promise only, not a stale result cache.
- Prioritize `session.history` over live/Actor bootstrap on selection. A
  terminal historical Session does not need the expensive observation plane at
  all: canonical history plus the lightweight Runtime profile is sufficient.
  Active, queued, pending-interaction, and cursor-gap Sessions still request an
  authoritative live/Actor snapshot after the newest history page settles.
  This also prevents a previous terminal Session's unnecessary background
  observation from blocking the next click on the shared Runtime transport.
- Pass the already ownership-validated loaded Session into paging, reducing the
  no-observation path from two Session loads to one.
- Keep every identity-only/fail-open history rule from Issue 136; performance
  mitigation must not reintroduce content or timestamp deletion.
- Clamp truncation markers inside the IPC schema budget instead of slicing to
  the exact maximum and then exceeding it with the marker.

Focused Runtime regressions prove that two concurrent callers perform one
load and one page traversal, a fresh observation performs no extra load, and a
post-invalidation read performs one rather than two loads. Final closure still
requires a rebuilt packaged application measurement and a later lazy-history
contract: newest complete turn plus item/byte budgets and explicit load-older
pagination, so first paint no longer requires the entire audit transcript.

#### Packaged 0.7.79 Candidate Acceptance (2026-08-01)

The freshly regenerated `out/win-unpacked/KodaX Space.exe` was exercised
against the real Session store, not a fixture. Selecting the repaired factual
Session rendered 77 conversation rows from 125 projected history items with no
renderer/page errors. The former `/add-feature` chain appears once inside the
authoritative compaction summary rather than as 7-11 copied user/assistant/tool
chains. Three repeated history calls in one process returned the same 125-item,
1,007,345-character JSON response with FNV-32 fingerprint `e90bf501`; three further cold
packaged-app launches and the final rebuilt candidate returned that same count,
response length, and fingerprint again. Hovering the row did not enter history-loading
state, and source inspection confirms the discarded `mouseenter`
`session.history` request no longer exists.

The repaired file's SHA-256 changed across cold starts, but a structural diff
proved that only `meta.actorSnapshot.revision` advanced (15 to 18 in the
captured comparison). The file stayed at one meta record, 76 lineage entries,
and 69 artifact-ledger entries; every lineage identity, parent, body, and the
125-item Space projection remained unchanged. The original polluted Session's
main-file SHA-256 stayed
`19132cf08356865f09650f3304a3df949765ec3d135d32f498591d992e9c739b`.
A final repair dry-run reported 76 active transcript entries, 79 active model
messages, and zero redundant compaction-context carriers.

An adversarial subagent review initially found three hardening gaps: a Runtime
event could cross an in-flight transcript read, the repair preflight compared
candidate counts rather than exact provenance, and an oversized truncation
marker could exceed its own text budget. All three were corrected and the same
reviewer closed them with no new blockers. The final Runtime/text regression
set passes 100/100, repair-core tests pass 7/7, full TypeScript and targeted
lint/format checks pass, and the rebuilt packaged Windows application completed
the real-profile acceptance above without changing lineage count or content.

A second adversarial pass found that the repair's earlier stability digest did
not include message bodies and that plan/export/fork crossed separate read
boundaries. The strengthened capture/revision/semantic checks above closed both
findings. A fresh isolated apply against the 930-entry factual input again
produced 76 entries and 79 active messages, with identical SDK and Runtime
results across repeated reads. The same reviewer reported no remaining
Critical, High, or Medium finding.

For that earlier candidate, standard `out` and five historical `out-*` verification
directories were deleted before compilation. `win-unpacked`, Setup, and
Portable were all generated after the same build-start boundary; the asar was
inspected directly and contains KodaX 0.7.79. The packaged app reached Runtime
and renderer readiness and the real-profile UI again rendered 77 rows, 8 user
bubbles, and 125 items while preserving the exact 76-entry lineage hash. The
formal boot gate at that time intentionally rejected the local preview because both
Space manifests and the lock remained pinned to 0.7.78 pending the Registry
0.7.79 release.

That candidate validated the amplification fix but did not close the issue.
The exact 0.7.79 dependency pin and bounded load-older contract were completed
and revalidated in the 2026-08-02 resolution below.

#### Follow-up Regression Found in the Local Test Build (2026-08-01)

The blanket packaged-acceptance conclusion above was too broad. The exact
`out/win-unpacked/resources/app.asar` exercised in the later report contains
`await runtimeHostAdapter.ensureObserved(sessionId)` in `session.history`.
That observation setup performs Runtime Session, settings, Actor, and persisted
ownership work before the transcript request can return. Direct strict SDK
reads of the tiny `20260729_214237` Session are millisecond-scale, so its slow
selection is not caused by transcript size or KodaX paging. Removing this
cross-plane wait restores the intended concurrent history/live loading model.

The very large factual Session remains a separate scaling case: Space still
materializes the complete raw audit before applying the 2,000 projected-item
window. That cannot be safely changed into an arbitrary newest-entry slice
without also preserving absolute turn selectors and exposing load-older/raw
audit semantics. Issue 145 therefore remains In Progress after the small-
Session regression is fixed.

#### Conversation Projection Integration Update (2026-08-01)

Space no longer loads the raw audit transcript to build the ordinary Coder
chat when `conversationHistory: 1` is available. It traverses the SDK-owned
immutable conversation pages, reconstructs oversized entries through the
revision-bound chunk endpoint, shares one in-flight traversal per Session, and
rejects any page whose revision, source revision, status, issue set, or entry
boundary differs from the first immutable snapshot. This removes Space's raw
lineage classification/dedupe work from the normal restore path and prevents a
cross-page mixture from being rendered as valid history.

This is not yet the final lazy-history fix. The factual conversation projection
is still approximately 14.5 MB and 956 entries; a fresh local Runtime read was
roughly 226-383 ms even though the newest 50-entry page is only about 345 KB.
The current Space API still traverses all pages before returning the bounded UI
window, and KodaX currently builds the full conversation snapshot internally
before serving the first page. Small Sessions no longer wait for observation
setup, but arbitrarily large Sessions still require a later end-to-end
newest-window/load-older contract. No performance optimization may discard
`ambiguous` candidates or infer identity from equal content.

#### Bounded Newest-First Resolution (2026-08-02)

Space now consumes the KodaX 0.7.79 canonical conversation page contract
without first materializing the full Session:

- main requests exactly one immutable newest SDK page for first paint. The
  adapter reduces the requested entry count when needed so a materialized page
  stays within 32 MiB, while oversized individual entries use the SDK's
  revision-bound chunk reader;
- older history is requested only after upward navigation. Each SDK page is
  prepended to the already visible newer pages, producing one continuous native
  scroll surface. Stable canonical DOM anchors preserve the exact viewport as
  content grows above it. If one SDK page
  projects past the 2,000-item IPC cap, Space exposes bounded synthetic slices
  until every projected row in that immutable page is reachable;
- a tool use split from its result at an SDK-page seam receives only the exact
  matching result from the immediately newer page. The page plus this bounded
  seam stays within 64 MiB; main retains at most 16 browsing windows and the
  renderer retains at most 32 Session histories, evicting restored store rows
  together with cache metadata;
- Coder history requested while Runtime is starting returns an explicit
  retryable state. It no longer falls back to a persisted full-body read or
  permanently installs that direct-read projection;
- `data_changed` clears the browsing window and restarts from the newest
  canonical page. Revision/source-revision fences remain unchanged;
- newest history reconciles against an independent live baseline. Prepending an
  older page retains that live tail exactly once; the legacy replacement-window
  seam fallback remains only for compatibility with an older main process;
- every fork/rewind entry point forwards the exact SDK history boundary when a
  prefix is omitted. Renderer and main both fail closed if that boundary is not
  available, preventing a page-local turn index from truncating an unrelated
  early portion of the durable Session; and
- reconciliation uses only strong identity. The remaining multi-input partial-
  turn identity contract is tracked separately as Issue 153 and deliberately
  fails open instead of deleting a candidate by content, timestamp, position,
  or `turnId` guesswork.

#### Session-switch contention and continuous-prepend correction (2026-08-02)

The remaining 2-4 second delay on tiny Sessions was not conversation paging.
Instrumented real-profile runs measured the direct KodaX newest page at roughly
3-12 ms and Space's bounded `session.history` work at roughly 5-151 ms, while a
real row selection could still take 3.4-4.2 seconds. `session.history`,
`session.liveSnapshot`, and `agent.actor.snapshot` were starting together; the
latter two install Runtime observation and can occupy the same transport needed
by the visible history request.

Gating only the newly selected Session was insufficient. It reduced one cold
selection to 32 ms, but selecting another Session about 250 ms later still took
3,458 ms because the previous terminal Session began its now-unnecessary
observation after its own history settled. The corrected policy therefore has
two independent parts:

- the visible newest history page settles before live/Actor bootstrap; and
- terminal historical Sessions do not install observation. Active/queued work,
  pending Runtime interactions, and explicit snapshot-gap recovery continue to
  observe and therefore keep the existing live-state safety boundary.

This is a Space scheduling/projection defect, not a remaining KodaX canonical
conversation defect and not a request for another SDK ordering field. The same
change converts continuation rendering from replacement windows to canonical
prepend. Main still holds one bounded SDK browsing window at a time; the
renderer accumulates the explicit pages, retains local notices and the live
tail by identity, and uses stable DOM anchors plus per-message browser
occlusion to provide continuous upward scrolling. `data_changed`, immutable
revision/source-revision fences, exact fork/rewind boundaries, and strong-only
identity rules are unchanged.

The first six-frame anchor restoration was still too short for browser
occlusion. Packaged timing proved that the selected canonical row was accurate
around 50 ms, moved by a delayed intrinsic-height correction around 100 ms, and
then remained 75.3 px away. A separate continuous-wheel probe also showed that
an upward wheel at the physical top could cancel restoration even though the
scroll position could not move, shifting the old viewport by the height of the
new page. Space now replays the frozen canonical anchor at ten sparse frame
checkpoints across one bounded settling window. An actual gesture away from the
top still cancels immediately; repeated upward wheel, keyboard, or touch input
at the top preserves restoration until the new page is reachable. Session
switches and stale paging lifecycles cancel every remaining callback.

Cross-layer pagination, composition, Runtime-observation, projection, and
activity regressions pass 240/240. The final adversarial reviewer independently
passes 66/66 focused assertions plus TypeScript and diff checks, and reports no
remaining P0-P2 finding. The earlier complete desktop run contains 2,214 tests:
2,209 pass, four platform-conditional tests skip, and the sole failure is the
independently recorded pristine-empty KodaX boundary mismatch in Issue 152;
there is no Space failure.

The final clean `build:test-kodax` completed at 2026-08-03 01:25 CST and
produced `win-unpacked`, Setup, and Portable artifacts from the exact local
KodaX 0.7.79 package (vendor SHA-256
`226B6FB80E05727BC35A000F43D5A59230C105581993F53093FD393AA1D75582`).
Packaged smoke verified exact KodaX 0.7.79, its Runtime/constructed-handler
workers, native SQLite, ASRT, dependency closure, and all locked Space/KodaX
skills. Packaged Chromium/Electron E2E then measured the large newest page at
115-118 ms ready / 264 ms painted and `20260729_214237` at 73-74 ms ready /
116-122 ms painted. The long transcript grew from 56 to 96 rows in one native
scroll surface. Both stationary waiting and an adversarial repeated upward
wheel at the top converged to a `-0.1 px` canonical-anchor delta and remained
stable through the one-second sample; neither reproduced the former page jump.

### 146: Stop can cross a history writer boundary and Runtime cancellation can end as a credential failure

- Priority: High
- Status: In Progress
- Introduced: v0.1.34 development / KodaX 0.7.79 integration
- Created: 2026-08-01

#### Problem

In Session `s_60717080-1d27-42fd-ac6a-be27319d9503`, pressing Stop could:

- fail with `Session data changed during the read boundary: ...lock`;
- leave the header/sidebar saying the Worker was active while the composer
  temporarily lost both spinner and Stop;
- reappear later as `Recovering...`;
- remain in automatic compaction for several minutes after Stop; and
- terminate as `Provider run failed while using a run-scoped credential`
  instead of a user cancellation.

#### Root Cause

This is a chain of separate defects, not one UI race:

1. Space put `assertPersistedCoderOwnership()` in front of Runtime run-status
   lookup and `runs.abort()`. That assertion performs a history-grade persisted
   Session read. An active daemon Run legitimately owns and changes the same
   Session boundary, so Stop could fail before it ever reached the authoritative
   Run.
2. Space clears an invalid session-live projection before asynchronously
   reopening its observation. The composer used only that projection for
   spinner/Stop, while the header and sidebar used the independently durable
   Runtime profile. Observation recovery also repeated the full persisted
   ownership read and could fail against the same active writer. This produced
   the visible split-brain interval.
3. KodaX accepted Stop during provider-backed automatic compaction but did not
   promptly terminate the compaction request; the factual run continued for
   about 202 seconds and committed the compaction after the first Stop request.
4. KodaX `normalizeRuntimeRunError()` currently replaces every error from a
   run that had a run-scoped credential with a generic provider-credential
   failure. It does so even when the underlying terminal cause is the user's
   `AbortError`, erasing cancellation semantics.

The first two are Space regressions. The last two are SDK Runtime behavior and
cannot be repaired by renderer inference without contradicting the daemon's
own receipt/status/result contract.

#### Space Resolution

- Run status and Stop no longer read persisted transcript ownership before
  `sessions.status`, `runs.list`, or `runs.abort`; the daemon Runtime/Session/
  Run identities fence those control calls. Space validates the returned
  Session identity, every listed Run identity, and the still-current Runtime
  before the first abort side effect; a cross-Session response fails closed.
- First-time observation still validates persisted Coder ownership. Recovery
  of an already validated observation on the same Runtime uses the fresh daemon
  Session snapshot instead of crossing the active writer boundary again.
- The composer compares the Runtime profile cursor with the detailed
  session-live cursor before choosing the Run boundary. An absent,
  non-comparable, equal, or older profile cannot override live state, so stale
  profile data cannot resurrect Stop after confirmed idle. A causally newer
  profile is authoritative for both newly active and newly terminal state,
  preventing an older live object from hiding or retaining spinner/Stop. A
  local pending send is preserved until Runtime admission, and a causal
  terminal event still fences its own Run. Profile state is accepted only from
  a fresh connection. Failed observation recovery reconciles the profile once
  from the Runtime: a successful read stays fresh and retains a factual active
  Stop (or clears a factual terminal Run); if that read also fails, the
  connection is marked degraded and rejects the old profile instead of
  retaining an orphaned Stop indefinitely. A validated Stop receipt also
  schedules profile refresh. Late reads from a replaced Runtime attachment are
  fenced before they can overwrite the new profile.
- Observation invalidation reason and sanitized message are logged before
  resync, replacing the prior silent gap with usable evidence.
- `session.cancel` returns the structured Runtime Stop receipt. The renderer
  distinguishes confirmed cancellation, already-terminal, no-active-run, and
  unknown outcome; it does not claim success from an IPC acknowledgement.
- A Runtime-selected Session whose daemon is unavailable now fails Stop
  explicitly (or reconnects through the Runtime authority); absence of a local
  connection object is no longer misreported as factual `no-active-run`.

#### 2026-08-04 Follow-up: delivered interrupt inputs hid active controls

Session `20260803_083817_9b45db6ce73db5`, Run
`run_msdfdma4_61844089`, exposed a remaining form of the same UI split. The Run
was active after a model switch. Interrupt inputs queued at
`2026-08-03T16:11:35.959Z` and `2026-08-03T16:12:26.629Z` were delivered
together by `run.input.delivered` at `16:12:30.725Z`; the next root turn had
already started. While a local send was pending, spinner and Stop temporarily
reappeared. Once delivery cleared that optimistic marker, both disappeared even
though the daemon profile still reported the Run as active.

The selector previously suppressed profile fallback whenever any session-live
object existed, including a causally older idle object. In addition,
`mid_turn_user_prompt` was treated as a transcript boundary but not as an
activity lifecycle start. Space now:

- treats delivered mid-turn prompts as a new active event boundary after an
  older terminal event;
- uses same-Runtime cursor ordering to let a newer profile settle an older live
  Run boundary in either direction;
- preserves detailed live state whenever the profile is not provably newer;
- preserves optimistic pending state until admission, then clears it on the
  canonical delivered-input lifecycle boundary;
- prevents a newer-but-stale profile from resurrecting a Run already fenced by
  its causal terminal event; and
- serializes profile reads per Runtime attachment while tracking the causal
  cursor per Runtime identity, so an in-flight status read cannot borrow a
  later observation cursor and a replacement Runtime cannot inherit another
  authority's sequence.

Focused regression coverage now includes the reported active-profile/idle-live
race, its terminal inverse, older and non-authoritative profile protection,
pending admission and delivery handoff, terminal fencing, observation recovery,
serialized profile reads, Runtime-identity cursor isolation, and delivered
mid-turn activity. The five focused activity, store, adapter, and Runtime
projection suites pass 247/247. The complete Desktop suite executes 2,307 tests:
2,303 pass, four platform-conditional tests skip, and zero fail. TypeScript,
targeted ESLint, Prettier, and diff checks pass. An independent sub-Agent review
found no remaining P0-P2 issue.

#### Remaining KodaX Requirement

KodaX must preserve one coherent user-cancellation outcome across
`runs.abort()`, Session status/events, and `RunHandle.result`, including while
automatic compaction is in a provider call. Stop must either promptly cancel
that work or return an explicit non-terminal/unknown stop state that remains
observable; a continued and later committed compaction must not be presented
as confirmed cancellation. A user-originated abort must retain its cancellation
or interruption classification even when a run-scoped credential was used;
credential redaction may sanitize provider errors but must not replace an
`AbortError` with an unrelated provider-failure terminal cause.

The refreshed local `kodax-ai-kodax-0.7.79.tgz` was reinstalled and inspected on
2026-08-01. Its packaged Runtime still applies the generic
`Provider run failed while using a run-scoped credential.` replacement whenever
the Run held a scoped credential, without first preserving an underlying
`AbortError`. The history/conversation API requirements are satisfied, but this
independent cancellation requirement therefore remains open in the exact test
package used by Space.

Space does not require new timestamps, sequence fields, or SDK-owned main-chat
visibility for this issue.

### 147: Ordinary-conversation adoption could lose Space notices and use stale or inexact history boundaries

- Priority: High
- Status: Resolved
- Introduced: KodaX 0.7.79 Space integration
- Fixed: corrected v0.1.34 source
- Created: 2026-08-01
- Resolution Date: 2026-08-01

#### Original Problem

After Space switched its ordinary main chat from the raw audit transcript to
KodaX 0.7.79 `conversationHistory`, several integration assumptions were no
longer valid:

- `client_notice`, `compaction`, and `branch_summary` are intentionally absent
  from ordinary conversation, but legacy history mapping still assumed those
  entry types could arrive;
- a successful persisted SDK audit append did not always mirror a Space-owned
  notice to the Space side-store, so restart could make that visible notice
  disappear;
- when the final visible entry in a selected turn lacked `boundaryId`, Space
  reused an earlier boundary and could silently truncate the selected answer;
- a successful Runtime rewind depended on a later observation event to
  invalidate an in-flight history traversal; and
- paged history accepted incomplete issue evidence, duplicate/non-contiguous
  indexes, repeated cursors, unsupported chunk encoding, mismatched byte
  lengths, and unbounded materialization.

The ambiguity warning was also a short toast. Once it expired, the still-loaded
Session gave no durable indication that every candidate had been retained
because the old history could not be interpreted uniquely.

#### Root Cause

Space treated the new ordinary-conversation projection as a drop-in structural
replacement for the raw audit transcript. It did not fully separate the three
owners: KodaX ordinary conversation, KodaX raw audit/lineage, and Space-owned
visible notices. Mutation and paging code also trusted optional or cross-page
metadata beyond the exact guarantees it had validated.

#### Resolution

- Ordinary main chat consumes only SDK conversation entries. Raw compaction and
  branch lineage remains audit data and is excluded explicitly by
  `ConversationStreamV2`; live compaction continues through activity/context
  state rather than a durable chat row.
- Every Space-owned local notice is written to the Space side-store before its
  optional SDK audit append. Restore reserves at most 32 rows for the newest
  such notices even when the 2,000-item history window is full. A primary
  side-store failure propagates to IPC and prevents the optional audit append,
  so Space cannot acknowledge a record that will disappear after restart.
  The persisted newest suffix also has an 8 MiB UTF-8 file budget, preventing
  the append/restore path from growing to roughly 250 MiB of full-file JSON I/O.
  Mutation reads fail closed on corrupt existing JSON rather than treating it
  as an empty store and overwriting recoverable evidence. The notice currently
  being appended is a required retained record even if its timestamp is older
  than existing rows (for example after clock rollback), including when the
  1,000-row persistence or 32-row renderer limit is already full; otherwise the
  append is rejected before audit. Restored and explicit notice timestamps also
  advance the renderer's monotonic clock. Pre-budget legacy files are stat-checked against a
  16 MiB migration read ceiling before allocation/parsing, and live renderer
  state is capped at the same 32 notices the history window can restore.
- Renderer append/replace failures now produce a persistent error toast while
  leaving the optimistic notice visible, explicitly warning that it may be
  lost after restart instead of silently swallowing persistence failure.
  Repeated failures share one bounded toast across Sessions. Failed append
  payloads are retained by stable notice ID and replayed idempotently; a later
  unrelated append success does not claim recovery. Each Session clears only
  after every failed payload is durably replayed or a full replace/reconcile
  succeeds, and the toast is dismissed only after all affected Sessions recover.
  The retry set is itself bounded to the same 32-row visible recovery window and
  an 8 MiB UTF-8 budget, so a prolonged outage cannot create an unbounded memory
  queue or recovery-time IPC/write storm; an individually uncacheable payload
  keeps the warning latched until a full reconcile.
- Runtime and standalone fork/rewind boundary selection now fail closed if the
  selected visible turn tail lacks an exact `boundaryId`. Runtime rewind
  success immediately advances the history generation and detaches callers
  from pre-rewind in-flight reads.
- Conversation paging now requires immutable issue evidence including exact
  `entryIds`, unique contiguous indexes, non-repeating page and chunk cursors,
  `base64-json` chunks, exact declared byte lengths, and bounded per-entry,
  total-byte, and entry-count materialization.
- `ambiguous` and `partial` history status is retained per Session and rendered
  as a persistent in-workspace warning instead of an expiring toast. Space does
  not infer identity or remove same-content candidates.

#### Files Changed

- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/kodax/session-store.ts`
- `apps/desktop/electron/kodax/session-local-notice-store.ts`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/ipc/history-window.ts`
- `apps/desktop/renderer/src/features/session/composeMessages.ts`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `apps/desktop/renderer/src/shell/ConversationStreamV2.tsx`
- `apps/desktop/renderer/src/shell/conversationHistoryWarning.ts`
- `apps/desktop/renderer/src/shell/Shell.tsx`
- `apps/desktop/renderer/src/store/appStore.ts`

#### Tests Added

Regression coverage includes missing turn-tail boundaries in Runtime and
standalone modes, rewind versus an in-flight history generation, exact issue
evidence, duplicate indexes, repeated page/chunk cursors, invalid chunk
encoding, bounded local-notice reservation, audit-success notice persistence,
primary-store failure propagation, total local-notice byte budget, Session-
scoped warning transitions, required-current-append retention, oversized legacy
read rejection, renderer persistence-failure feedback and memory bounds, Stop
during Runtime unavailability, and ordinary-chat lineage exclusion. TypeScript
typecheck and the targeted history/runtime/renderer suites pass.

No KodaX SDK change is required for this resolved Space integration issue. A
factual legacy Session may still be returned as `ambiguous`; Issue 136 tracks
that separate conservative SDK classification rather than hiding it here.

### 148: Blocked complete exit offered no force-close escape hatch and could trap the user in Space

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 F140 complete-exit hardening
- Fixed: corrected v0.1.34 source
- Created: 2026-08-01
- Resolution Date: 2026-08-01

#### Original Problem

When complete exit found `active_agent_turns`, `active_agent_tasks`, another
Runtime blocker, or Space-local work, its warning exposed only **Keep Space
open**. The title-bar close button and dialog dismissal returned to the same
running application, so a user who intentionally wanted to abandon the task
had no in-product way to stop it and fully exit KodaX Space.

Expected behavior was a conservative two-action choice: keep Space running, or
explicitly force-close it. Force close needed to stop work owned by the current
Space without cancelling work owned by another client attached to the shared
Runtime, and cleanup failure could not reopen the same blocker loop.

#### Root Cause

F140 deliberately made complete exit fail closed and had no second,
user-confirmed terminal branch. The Runtime preflight was used only as a stop
gate; Space had no orchestration that combined Session Run cancellation,
Actor/Turn interruption, Workflow/external-Agent cancellation, interaction and
queue cleanup, daemon retention for other clients, and a process-exit bypass.

#### Resolution

- The blocker dialog now exposes exactly **Keep Space open** and **Force
  close**. Keep/open remains the default and cancel/dismiss action.
- Force close closes Coder admission, hides the control surface, cancels
  Space-owned Session Runs, Runtime Agent Turns, Runtime/local Workflows,
  external-Agent tasks, pending permission/AskUser requests, and queued input.
- Runtime mutations are filtered by the authenticated Space principal and
  exact Run/Agent identities accepted through Space. Workflow ownership is
  proven from its source Run; Session ID alone is never treated as client
  ownership. Other clients' work is preserved
  even when they attach to the same Session.
- After cancellation, Space attempts the existing revision-fenced daemon stop
  only when Runtime preflight is stoppable. Each force-close stage has a
  four-second bound. Failure is logged, but the explicit user choice commits
  Electron exit and bypasses complete-exit admission on `before-quit`, so the
  user cannot be trapped in another warning.
- Forced shutdown detaches Session facades after the ownership-filtered stop
  and uses a short process-cleanup watchdog. A forced watchdog timeout exits
  directly and can never schedule Runtime recovery or relaunch Space; the
  normal safe path retains its visible recovery behavior.
- If inspection, daemon stop, or Coder admission shutdown fails before the
  normal blocker prompt, the failure dialog exposes the same default Keep open
  and explicit Force close actions instead of returning to a one-button loop.

#### Files Changed

- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/window/complete-exit-policy.ts`
- `apps/desktop/electron/window/background-tray-model.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/kodax/space-manual-topics.ts`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `README.md`, `README_CN.md`, `docs/USAGE.md`
- `docs/FEATURE_LIST.md`, `docs/features/v0.1.33-close-behavior.md`

#### Tests Added

Regression coverage proves forced-exit cleanup order, terminal exit after
cancellation/daemon failures, terminal watchdog behavior, `before-quit` bypass,
and Runtime ownership filtering across same-Session Runs, queued Runs, Agent
Turns, and Workflows. The focused
exit/Runtime suites, close-policy/tray/queue/broker regressions, ESLint, and
main-process build pass. The repository-wide Electron typecheck remains blocked
by the pre-existing locally installed KodaX declaration mismatch tracked in the
current cancellation/history integration work; it reports no isolated error in
the force-close additions.

### 149: A completed Runtime Run could leave a stale live projection and keep the Session spinner on Thinking

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 / KodaX 0.7.79 Space integration
- Fixed: corrected v0.1.34 source
- Created: 2026-08-01
- Resolution Date: 2026-08-01

#### Original Problem

Session `20260801_185528_v970b9b971812` displayed an authoritative **Run
complete** status and a complete assistant response while the message-level
spinner continued to display **Thinking**. The stale spinner could persist for
minutes, then disappear after the next query completed. The Runtime Run itself
had already ended and had no active subtasks, so this was not continuing model
or Agent work.

Expected behavior is one causal terminal result: after the accepted Run emits a
terminal event, no older live projection for that same Runtime and Run may keep
the Session active. A transient profile-management read conflict also must not
be presented as a Runtime connection loss when the live observation stream is
still valid.

#### Root Cause

During the affected Run, a KodaX profile refresh received the structured
`conflict` result while daemon preflight/management state was being inspected.
Space treated that background read conflict as a connection failure and
published `reconnecting`, even though the SDK connection lifecycle and Session
observation remained healthy. Main and renderer projection reducers then
retained different pieces of state: the terminal `session_complete` event was
accepted, but the renderer's previous `activeRun` snapshot remained cached.
The task status used the terminal event and showed complete, while
`ActivitySpinner` preferred the stale live snapshot and showed Thinking. A
later query replaced that cache, which explains the apparent self-recovery.

#### Resolution

- Background profile reads now handle structured snapshot conflicts as bounded,
  retryable read races. A management-only conflict retains the last known
  integration health while independently refreshed profile fields continue to
  update.
- Background read failures no longer manufacture a `reconnecting` lifecycle
  transition. Only the SDK's explicit connection lifecycle can remove live
  authority; failures remain observable through bounded warning logs.
- Main and renderer projection reducers define the same live-authority rule:
  the connection must be `ready` or `degraded` and not stale. Runtime changes or
  authority loss synchronously discard cached live projections, cursors, and
  resync requirements, and stale connections cannot accept new live or Actor
  snapshots. Snapshot bootstrap uses the same authority rule.
- The app-store connection reducer now commits the reducer's cleared live maps;
  previously it wrote only the connection object and accidentally preserved the
  stale `activeRun` cache.
- Full snapshots rejected for old revisions, Runtime mismatch, or lost authority
  cannot update settings, interactions, event hydration, cursor barriers, or
  pending-send state through a secondary app-store path.
- `ActivitySpinner` applies a final causal fence: a Runtime-backed terminal
  event supersedes an older active projection only for the same Runtime and Run.
  A later Run with a different identity remains visible from either the detailed
  live projection or the profile fallback, so the safeguard cannot hide a newly
  submitted query.

#### Files Changed

- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/kodax/runtime/runtime-projection-controller.ts`
- `apps/desktop/renderer/src/store/runtimeProjectionState.ts`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/shell/ActivitySpinner.tsx`
- `apps/desktop/renderer/src/App.tsx`

#### Tests Added

Regression coverage reproduces a management-inspection conflict between Run
start and terminal delivery; proves that no false reconnect is published and
that the terminal live projection is accepted; proves main, pure renderer, and
app-store caches clear on stale/degraded or reconnecting authority; and proves
that a same-Run terminal event fences an older active projection without hiding
a later Run. It also rejects late Actor and full snapshots from updating
secondary state after authority loss or revision rollback. The 194-test focused
suite, renderer and Electron TypeScript checks, and targeted ESLint pass. The
final full desktop run executed 2,168 tests: 2,162 passed and four environment
tests skipped. The exact-version guard intentionally failed because the local
KodaX 0.7.79 test package differs from the repository's still-formal 0.7.78
dependency pin. One shared-daemon forced-timeout cleanup also exceeded its bound
under the 204-second full-suite load; that unchanged compatibility test passed
twice consecutively in isolation. Neither result is suppressed or attributed to
the spinner state-machine fix.

### 150: Packaged cold Coder daemon initialization can block the real renderer for 20-50 seconds

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 packaged build / KodaX 0.7.79
- Fixed: v0.1.35 development
- Created: 2026-08-02
- Resolution Date: 2026-08-02

#### Original Problem

Starting `out/win-unpacked/KodaX Space.exe` can leave the user on the boot
surface for an unusually long and variable interval. The two most recent
observed launches took 23.311 seconds and 51.733 seconds from diagnostics
initialization to renderer visual readiness. The renderer itself needed only
229 ms and 289 ms respectively from load attempt to visual readiness.

Expected behavior is for the application renderer and its non-Coder surfaces
to become interactive independently of a cold or recovering shared Coder
Runtime. Coder may report a bounded connecting state until the daemon becomes
ready, but its initialization should not hold the whole UI behind the startup
gate.

#### Context

Observed packaged-startup evidence:

- On the 09:07 launch, the boot window appeared after 1.706 seconds, shell PATH
  hydration completed after 1.947 seconds, Runtime host initialization
  completed after 23.000 seconds, and the renderer became visually ready after
  23.311 seconds.
- The packaged daemon process was created at approximately 09:07:12, wrote its
  ownership lock at 09:07:27, reported Runtime ready at 09:07:31.757, and Space
  reported `host_initialized` at 09:07:32.997. This separates roughly 15
  seconds of pre-lock process/module bootstrap, 4.4 seconds from lock to daemon
  readiness, and 1.24 seconds of post-ready client initialization.
- On the 08:40 launch, the daemon reported ready after approximately 23.8
  seconds, but Space did not report `host_initialized` for another 26.2
  seconds. Existing diagnostics do not time the individual post-connect steps,
  so that second outlier cannot yet be assigned to a single SDK request.
- Recent v0.1.34 launch history shows the Runtime-gated segment growing from a
  typical 5-8 seconds to 11.8, 48.0, and 21.1 seconds, while renderer
  load-to-visual time remains below 0.4 seconds.

Affected components:

- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- packaged KodaX daemon launcher under
  `out/win-unpacked/resources/app.asar/node_modules/@kodax-ai/kodax`

#### Root Cause

The Electron startup chain awaits `runtimeHostAdapter.initialize()` inside the
same `Promise.all` that must finish before IPC registration and
`rendererStartupGate.release()`. A cold daemon therefore becomes a global UI
startup dependency even though a trusted boot window and pending Runtime
projection already exist.

The packaged daemon is launched through the Electron executable in Node mode
and loads the KodaX CLI/module graph from `app.asar` before it publishes its
lock and endpoint. That cold bootstrap accounts for most of the current
23-second launch. Runtime host initialization then synchronously awaits daemon
attachment, capability/scopes checks, host-tool registration, connection and
workflow subscription readiness, credential-lease restoration, profile
refresh, and desired-observation restoration. The 08:40 outlier proves one of
those post-ready steps can add another 26 seconds, but the current logging has
no per-stage markers to identify which one.

A follow-up adversarial review found one reconnect-only extension of the same
startup lifecycle problem. When an initialization attempt lost its connection
while restoring an already desired Session observation, `openObservation()`
could re-enter `initialize()` through `requireRuntime()`. Because the outer
initialization was already waiting for that observation restore, both paths
waited on the same `initializePromise` and neither could reach the final
authority fence or a later reconnect.

#### Resolution

- Shell PATH hydration and Runtime owner-policy reconciliation remain ordered
  startup prerequisites. The expensive `RuntimeHostAdapter.initialize()` call
  now starts immediately afterward as a shutdown-tracked background task; IPC
  registration and `rendererStartupGate.release()` no longer await it.
- Owner-policy reconciliation is fail-closed: a refusal publishes an explicit
  `incompatible` projection, leaves the adapter failed, and fences every later
  initialization attempt in the same process from bypassing the rejected
  startup policy.
- The pending Runtime projection now reports `connecting` without inventing a
  Runtime identity. Successful attachment replaces it with the authoritative
  profile, while initialization failure keeps Coder unavailable without
  preventing the rest of Space from becoming interactive.
- Space custom-provider registration still completes locally during startup,
  while daemon catalog reconciliation runs after every authoritative Runtime
  ready generation, including internal reconnects. Startup reconciliation and
  UI add/update/remove operations share one process-wide mutation queue, and
  reconciliation reads the latest provider store only after entering that
  queue, so a cold-start snapshot cannot overwrite a newer UI mutation.
- Runtime readiness is authority-fenced after the asynchronous credential,
  profile, and observation warm-up. A connection lost during those awaits
  rejects the superseded initialization without emitting `host_initialized` or
  notifying dependent provider work.
- Desired-observation restoration now uses the exact Runtime attachment owned
  by its initialization attempt instead of re-entering the public
  `requireRuntime()` single-flight path. If that attachment loses authority,
  observation recovery fails immediately, the existing final fence rejects the
  superseded initialization, and a later reconnect can start and restore the
  observation normally.
- Runtime readiness refreshes diagnostic redaction after late SDK/provider
  hydration. Both Runtime initialization and its dependent provider sync stay
  registered with `StartupShutdownCoordinator`, so complete exit cannot race a
  half-created Runtime resource.
- Runtime startup has opt-in monotonic stage timing for owner reconciliation,
  identity, attach, capability validation, host-tool registration,
  subscriptions, credential leases, profile refresh, and observation restore.
- The packaged Windows boot smoke applies KodaX's internal 20-second daemon
  ready hold, gives Runtime a separate 90-second cold budget, and requires the
  real renderer to become interactive within 15 seconds. First observation and
  post-loop checks both enforce the deadlines, and Runtime must not report ready
  before the hold elapses. This deterministically fails if the old renderer
  coupling is reintroduced, independent of incidental daemon startup speed.

Files changed:

- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/kodax/background-runtime-startup.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/kodax/runtime-startup-timing.ts`
- `apps/desktop/electron/kodax/runtime/runtime-projection-controller.ts`
- `apps/desktop/electron/ipc/provider.ts`
- `apps/desktop/electron/providers/custom-provider-mutations.ts`
- `apps/desktop/electron/test/background-runtime-startup.test.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `apps/desktop/electron/test/runtime-startup-timing.test.ts`
- `apps/desktop/electron/test/runtime-projection-controller.test.ts`
- `e2e/boot-smoke-packaged.mjs`
- `docs/KNOWN_ISSUES.md`

Verification:

- Runtime host/projection/startup regressions passed 182/182. The new
  double-disconnect regression fails against the old implementation by timing
  out on the Promise cycle, then proves that the fixed initialization rejects
  promptly and a third Runtime attachment restores the desired observation.
- Electron and renderer TypeScript checks, targeted ESLint, Prettier, and the
  production main/renderer builds passed.
- The complete Desktop suite passed 2,201 tests with 4 platform skips. Its only
  failure is the separately tracked KodaX Issue 152 direct-versus-paged empty
  conversation boundary mismatch; the focused 0.7.79 compatibility run
  reproduced that same single assertion with its other 7 checks passing.
- A real `win-unpacked` build containing the local KodaX 0.7.79 test tarball
  passed dependency/native/Worker smokes. With a fresh isolated profile, the
  renderer became ready in 8.609 seconds while Runtime became ready separately
  in 29.079 seconds under the deterministic 20-second daemon hold; both
  independent budgets passed.

### 151: Unlabeled fenced Markdown blocks were misclassified as inline code and rendered in the danger palette

- Priority: Low
- Status: Resolved
- Introduced: v0.1.x conversation Markdown renderer
- Created: 2026-08-02
- Fixed: v0.1.34 development
- Resolution Date: 2026-08-02

#### Original Problem

Conversation Markdown rendered an unlabeled fenced block as a full-width code
container, but its inner `<code>` element received the same red danger styling
as inline code. Plain diagrams, command output, and other LLM-authored text
therefore appeared to be errors even though the model had emitted an ordinary
fenced block rather than a quote or citation.

Expected behavior:

- Every fenced block remains block-level even when no language is declared.
- Unlabeled fences use a neutral plain-text treatment and “Copy text”.
- Explicit-language fences expose the language and use “Copy code”.
- Inline code uses a cool neutral treatment rather than the error palette.
- Blockquotes remain visually distinct without forcing all quoted text italic.

#### Root Cause

The conversation renderer inferred block code only from whether the code
element's class started with `language-`. Unlabeled fences have no language
class, while highlighted fences can start with `hljs`; both shapes could fall
through to the inline-code branch and inherit `bg-danger` / `text-danger`.

#### Resolution

- Classify code by structural `<pre>` ancestry through a React context instead
  of using language metadata as the block/inline signal.
- Preserve language metadata only for the optional label and copy semantics.
- Added separate light/dark semantic tokens for block code, inline code, and
  blockquotes; explicit syntax-highlight layers now keep a transparent inner
  background so the block remains one coherent surface.
- Added localized “Copy text” labels and matching clipboard accessibility text.
- Kept Partner citations and their current interaction behavior unchanged.

Files changed:

- `apps/desktop/renderer/src/features/session/messages/Markdown.tsx`
- `apps/desktop/renderer/src/styles.css`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `apps/desktop/electron/test/markdown-rendering.test.ts`
- `docs/KNOWN_ISSUES.md`

Tests added:

- Inline code remains inline and does not use danger tokens.
- Unlabeled and streaming-unclosed fences remain neutral block content with
  “Copy text”.
- Explicit-language fences expose their language and use “Copy code”.
- Blockquotes keep normal text styling and preserve nested inline code.

Verification:

- Markdown and Partner-reference tests: 13 passed.
- Renderer TypeScript, targeted ESLint, Prettier, and production build passed.
- Independent code review reported no actionable findings and exercised
  indented blocks, unknown languages, and quoted fenced blocks.

### 152: Pristine empty KodaX Sessions return different direct and paged canonical conversation boundaries

- Priority: Medium
- Status: Resolved
- Affected: KodaX 0.7.79 local test package
- Fixed: updated KodaX 0.7.79 local test package
- Created: 2026-08-02
- Resolution Date: 2026-08-03

#### Problem

Space's package compatibility test creates a pristine empty Session and reads
the canonical ordinary conversation through both public SDK entry points. For
the same `sourceRevision` and unchanged Session, the direct read reports an
empty `partial` conversation with one revision while the first paged read
reports an empty `resolved` conversation with another revision. The public SDK
contract says direct and paged reads share the same content-derived identity.

Once any failed Run has added persisted conversation state, the two reads align;
the mismatch is specific to the untouched empty Session. It does not break
Space's bounded history implementation because that path uses page-to-page
boundaries only and never mixes a direct snapshot into a paged window. It does,
however, remain a real SDK contract failure and keeps the corresponding
compatibility assertion red.

#### Requirement

For one unchanged Session/source revision, the direct and paged canonical
conversation APIs must report the same conversation status, revision, and entry
order, including the pristine empty-Session case. No new timestamp, sequence,
visibility, or UI capability is requested.

#### Resolution

The updated KodaX 0.7.79 test package now treats an explicitly persisted empty
v2 Session, and an accepted Run whose canonical conversation has not yet
materialized, as a valid resolved empty boundary. A conversation is partial
only when persisted bodies exist but their lineage cannot be recovered.

Space installed the exact updated local tarball and ran a public Runtime probe
through `@kodax-ai/kodax/runtime`: direct and paged reads both returned
`resolved`, zero entries, no issues, and identical revision/sourceRevision for
the same newly created Session.

### 153: A newest canonical page beginning inside one multi-input Runtime turn lacks an exact live reconciliation identity

- Priority: Medium
- Status: Resolved
- Affected: KodaX 0.7.79 bounded conversation integration
- Fixed: KodaX 0.7.81 / current Space source
- Created: 2026-08-02
- Resolution Date: 2026-08-05

#### Problem

A bounded newest conversation page can begin in the middle of a Runtime turn
that contains more than one real user input. Canonical conversation entries
currently expose the shared `turnId`, while the corresponding live delivery
projection can identify its individual input only inside the Runtime delivery
lifecycle. Space cannot prove which live user row matches the leading canonical
user entry when the older user inputs in that turn are outside the page.

Content, timestamps, page position, and `turnId` alone are not identities. A
previous attempted right-edge/content match was rejected by adversarial review
because it could merge a different prompt and delete real history. Space now
fails open in this narrow case: it can transiently preserve both candidates,
but never guesses and deletes one. Older replacement windows do not mix in the
newer live projection, which contains the ambiguity to the newest partial-turn
window.

#### Requirement

For each delivered interrupt input, expose the canonical physical entry
reference created by the durable input-persistence boundary. The reference
must equal the corresponding conversation entry's `boundaryId` or one of its
`auditEntryIds`; compaction may select another proven physical copy as the
display boundary. One-sided legacy absence remains fail-open; pairs with no
entry evidence on either side retain the existing guarded compatibility path. No new identity system,
ordinal contract, lifecycle field, event replay, or SDK-owned paging mechanism
is required.

#### Resolution

KodaX 0.7.81 adds optional `entryId` to each newly delivered Runtime interrupt
event/status and guarantees that canonical persistence completes first. The
reference survives event replay, compaction, and Runtime restart; legacy
records may omit it. Space now projects the field through both daemon and
embedded delivery paths, preserves it on the promoted live user row, retains
the conversation entry's bounded `auditEntryIds`, and treats exact physical-ID
membership as authoritative even when an embedded terminal lacks `turnId`. If
both projections carry disjoint identity sets, Space fails open and does not
fall back to content, time, position, or ordinal matching.

### 154: Expanded right-sidebar plans kept additional steps permanently hidden behind a non-interactive count

- Priority: Low
- Status: Resolved
- Introduced: v0.1.34 right-sidebar plan summary
- Fixed: corrected v0.1.34 source
- Created: 2026-08-03
- Resolution Date: 2026-08-03

#### Original Problem

When a plan contained more than six steps, opening the right-sidebar Plan
section still rendered only a four-step window around the active item. The last
row reported the remaining open steps as “N more” / “还有 N 项”, but that row
was plain text and could not reveal the hidden steps.

Expected behavior is to preserve the compact initial summary while making the
“N more” row an explicit control. Activating it should reveal every plan step
for the current Session without requiring the separate full-panel view.

#### Context

Affected components:

- `apps/desktop/renderer/src/shell/sidebarPlanView.ts`
- `apps/desktop/renderer/src/shell/RightSidebar.tsx`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `apps/desktop/electron/test/sidebar-plan-view.test.ts`
- `tests/e2e/right-sidebar-popouts.spec.ts`

#### Root Cause

The compact plan projection deliberately emitted a `more-summary` row after
selecting at most four visible todo items. `PlanRow` rendered that summary as a
non-interactive `<li>`, and `PlanSection` had no expanded-list state or way to
request an unwindowed plan projection.

#### Resolution

- Added an explicit expanded option to the sidebar plan projection. Compact
  plans retain the existing active-item window; expanded plans return every
  todo item in source order without summary rows.
- Replaced the non-interactive “N more” row with a full-width button that has
  hover, keyboard-focus, tooltip, and localized accessible-label states.
- Scoped expansion to the current Session ID. Plan updates within that Session
  remain expanded, while switching Sessions immediately restores the compact
  preview for the newly selected task.

#### Files Changed

- `apps/desktop/renderer/src/shell/sidebarPlanView.ts`
- `apps/desktop/renderer/src/shell/RightSidebar.tsx`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `apps/desktop/electron/test/sidebar-plan-view.test.ts`
- `tests/e2e/right-sidebar-popouts.spec.ts`
- `docs/KNOWN_ISSUES.md`

#### Tests Added

- The pure plan projection returns every item and no summary rows when expanded.
- The Electron Playwright regression seeds seven plan steps, verifies the
  compact “3 more” control, clicks it, and verifies all seven steps are visible.

#### Verification

- Sidebar plan unit tests passed: 4/4.
- The targeted Electron Playwright interaction passed: 1/1.
- Renderer TypeScript, targeted ESLint, diff whitespace validation, and
  production renderer/main builds passed.

### 155: First idle complete-exit request reopened Space after a recovered Runtime owner-transition race

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.34 / KodaX 0.7.79 complete-exit integration
- Fixed: corrected v0.1.34 source
- Created: 2026-08-03
- Resolution Date: 2026-08-03

#### Original Problem

With no task running, selecting **Quit completely** from the Windows tray could
hide every Space window, reopen the application, and display the safe-exit
failure dialog. Choosing **Keep Space open** and selecting **Quit completely**
a second time then exited normally.

Expected behavior is for one complete-exit request to close an idle, unshared
Space instance. A genuine unverified owner state must still fail closed, but a
successfully compensated and authoritatively verified transition must not make
the user repeat the request.

#### Context

The packaged `out/win-unpacked` build used Space v0.1.34 with the KodaX 0.7.79
test package. Structured diagnostics recorded the first failure at
`2026-08-03T01:41:48.336Z` as `Runtime owner transition is already in progress.`
No executable-work blocker was present.

#### Root Cause

The daemon had already stopped and released its owner. While Space attempted to
acquire the short-lived replacement inline fence, another owner-policy
coordination operation briefly held the lock. The rollback helper correctly
compensated by restoring the profile to an unowned daemon policy, but then
re-threw the original fence-contention error because embedded-mode switching
would still require inline ownership.

Complete exit reused that helper without recognizing its different terminal
condition. It therefore restored the hidden windows and showed a failure even
though the authoritative final state was already safe for process exit. The
second request succeeded because the compensated daemon policy was now stable.

A later renderer-recovery variant had the same first-close/second-close symptom without an owner
transition. Read-only `session.list` and `session.history` hydration had been wrapped in the Coder
executable-admission counter. A slow project list or bounded history read therefore looked like
work that had to drain before shutdown; the first close could time out and reopen the gate, while
the completed read made the second close succeed. Those reads do not acquire a Coder owner and do
not start or mutate a Run.

#### Resolution

- Complete exit now distinguishes a compensated terminal state from an
  incomplete owner transition.
- If rollback preparation throws after compensation, Space re-reads the
  authoritative owner state. It accepts the exit only when the adapter is
  closed, rollback is no longer in progress, the profile is unowned, and the
  policy is daemon.
- Failed or unreadable verification remains fail-closed and preserves both the
  original transition error and verification error for diagnostics.
- Embedded-mode switching semantics are unchanged: that path still requires
  acquisition of the inline owner fence and cannot use the complete-exit
  exception.
- Read-only Session list/history requests no longer enter executable Coder admission. History keeps
  its per-Session single-writer queue, revision/sourceRevision/cursor fences, and cross-Session
  parallelism; create/send/queue/fork/rewind/settings and other executable or mutating paths remain
  admitted. Complete exit also keeps its visible progress surface until daemon shutdown is
  authoritatively verified, then hides and commits adjacently.

#### Files Changed

- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/window/complete-exit-policy.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `apps/desktop/electron/test/session-read-admission.test.ts`
- `apps/desktop/electron/test/complete-exit-policy.test.ts`
- `docs/KNOWN_ISSUES.md`

#### Tests Added

- A successful daemon stop followed by replacement-fence contention and
  verified daemon-policy compensation completes on the first exit request.
- Existing lost-reply, unreadable-owner, restart-required, and normal atomic
  complete-exit regressions continue to enforce fail-closed behavior.
- Static admission-boundary regressions require both Session list and history to stay outside the
  executable counter, while existing history serialization tests require same-Session ordering and
  different-Session parallelism.

#### Verification

- Focused complete-exit Runtime tests passed 6/6.
- The full Runtime host adapter suite passed 132/132.
- The complete-exit policy suite passed 12/12.
- Electron TypeScript, targeted ESLint, and diff whitespace validation passed.
- A clean `build:test-kodax` completed successfully. Packaged smoke verified
  exact KodaX 0.7.79 content and the packaged boot test reached Runtime ready.
- The 2026-08-06 recurrence passed the combined history/paging/Runtime/mode-switch/exit suite
  (366 passing assertions), TypeScript, full ESLint, and the production renderer/main smoke build
  against exact KodaX 0.7.82.

### 156: Renderer history cache could preserve a stale partial-lineage warning after canonical storage changed

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.34 bounded canonical history paging
- Fixed: corrected v0.1.34 source
- Created: 2026-08-03
- Resolution Date: 2026-08-03

#### Original Problem

Space cached the newest canonical page and its `partial` / `ambiguous`
conversation diagnostic for up to 32 Sessions. Once the page reached `ready`,
selecting that Session again skipped the SDK read indefinitely. A Run terminal
event or committed lineage change could make the stored diagnostic obsolete,
but the banner remained bound to the old page generation.

The KodaX empty-v2 fix prevents the newly observed false diagnostic at its SDK
source. Space still needed its own cache-coherence rule so an uncertain or
superseded diagnostic could never become permanent renderer authority.

#### Root Cause

`hasReadySessionHistory()` checked only the local phase and presence of loaded
items. The cache had no generation associated with Runtime persistence
boundaries, and `partial` / `ambiguous` were treated as equally reusable as a
resolved canonical page. An IPC response already in flight when a Run ended
could also install the older page after the terminal event.

#### Resolution

- Added a per-Session invalidation epoch driven only by canonical persistence
  boundaries: Run completion/error and committed lineage notices. Token,
  thinking, and tool streaming fragments do not invalidate history.
- A page is reusable only when its loaded epoch still matches the Session epoch
  and its conversation diagnostic is resolved (or absent for a non-Coder
  surface). Uncertain diagnostics are re-read when the Session is selected.
- A persistence boundary that overtakes an IPC read prevents that stale page
  and diagnostic from entering the store. Space restarts from the newest
  canonical boundary using the existing bounded retry path.
- An older-page gesture after invalidation cannot follow the former cursor and
  re-certify an immutable old snapshot as current; it becomes an immediate
  newest-page replacement read.
- If the replacement read must wait for Runtime, Space keeps the uncertain
  diagnostic attached to the still-visible old rows until a fresh canonical
  page replaces them.
- An uncertain diagnostic already visible in the active Session triggers one
  bounded newest-page revalidation at the persistence boundary. Resolved pages
  and inactive Sessions remain lazy so normal terminal events do not reset an
  actively scrolled transcript or add background reads.
- The invalidation map records only Sessions that already own paging state, so
  unrelated background events cannot create an unbounded renderer-side map.
- No timestamp sorting, content deduplication, inferred lineage, or warning
  suppression was introduced.

Files changed:

- `apps/desktop/renderer/src/App.tsx`
- `apps/desktop/renderer/src/shell/sessionHistoryPaging.ts`
- `apps/desktop/electron/test/session-history-paging.test.ts`
- `docs/KNOWN_ISSUES.md`

Verification:

- Paging regressions passed 22/22, including active-warning revalidation,
  uncertain-status reuse,
  post-terminal invalidation, stale-continuation rejection, warning retention,
  and an adversarial terminal/IPC response race.
- The updated KodaX package empty-Session direct/paged probe passed with one
  shared resolved boundary.
- The complete Desktop suite passed 2,227 tests with 4 platform skips, and all
  8 published-package Runtime compatibility checks passed.
- A clean local-test-package build passed pack/native/Worker smokes and the
  packaged boot probe. Independent adversarial review found no remaining
  P0-P3 issue after its three cache-race findings were fixed and rechecked.

### 157: Fresh-start complete exit gave no visible feedback while startup admission drained

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.34 complete-exit interaction
- Fixed: corrected v0.1.34 source
- Created: 2026-08-03
- Resolution Date: 2026-08-03

#### Original Problem

Immediately after opening KodaX Space, a remembered complete-exit action could
leave the window fully visible and apparently unchanged for several seconds.
Repeated close clicks were ignored while the original request eventually
completed, making the user reasonably conclude that the close control had not
worked.

#### Root Cause

The request was correctly deduplicated, but Space did not hide the window until
Coder admission had drained and both Runtime and Space preflight checks had
finished. The startup admission drain is bounded at ten seconds, yet there was
no renderer feedback or Windows taskbar progress during that interval.

#### Resolution

- The first accepted request now immediately publishes a typed complete-exit
  progress state and starts indeterminate Windows taskbar progress.
- The renderer displays a blocking, accessible, localized overlay explaining
  that Space is checking active work and safely stopping Runtime.
- Repeated clicks remain deduplicated while the visible progress state confirms
  that the original request is active.
- Blocked, cancelled, or failed safe exit clears the progress state before the
  existing keep-open / force-close dialog is presented. Safety admission and
  force-close semantics are unchanged.
- Complete-exit diagnostics now record request acceptance and preflight latency
  so a future slow close can be distinguished from an unhandled click.

#### Files Changed

- `packages/space-ipc-schema/src/channels/window.ts`
- `packages/space-ipc-schema/src/channels/index.ts`
- `packages/space-ipc-schema/src/index.ts`
- `packages/space-ipc-schema/test/window.test.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/renderer/src/App.tsx`
- `apps/desktop/renderer/src/i18n/messages.ts`
- `apps/desktop/renderer/src/shell/CompleteExitOverlay.tsx`
- `apps/desktop/electron/test/complete-exit-overlay.test.ts`
- `docs/KNOWN_ISSUES.md`

#### Tests Added

- Window IPC schema registration and boolean payload validation.
- Visible/accessibility markup and inactive-state regressions for the exit
  overlay.

#### Verification

- Window IPC schema tests passed 6/6.
- Complete-exit overlay tests passed 2/2.
- Complete-exit policy tests passed 12/12.
- Startup admission shutdown regressions passed 2/2.
- Renderer and Electron TypeScript, targeted ESLint, Prettier, and diff
  whitespace checks passed.
- The full IPC Schema suite passed 307/307. The full Desktop suite passed
  2,230 tests with 4 platform skips and no failures.
- A clean `build:test-kodax` completed after the previous test instance released
  `out/win-unpacked`; packaged smoke and the Runtime-ready boot probe passed.

### 158: Embedded Auto tools were re-approved by Space after the KodaX guardrail had already allowed them

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 / KodaX 0.7.79 Auto permission integration
- Fixed: corrected v0.1.34 source with the latest KodaX 0.7.79 test package
- Created: 2026-08-03
- Resolution Date: 2026-08-03

#### Original Problem

The updated KodaX Auto[LLM] contract makes the classifier's legal `allow` or
`ask` the final permission decision. In Space's embedded path, an allowed tool
still proceeded to `events.beforeToolExecute`, which always called the legacy
Space `PermissionBroker`. Commands matching Space's static `dangerous` patterns
therefore opened a second permission modal even though the SDK had already
reviewed and allowed the exact call.

This made project writes, Git stash operations, and other normal automation
appear to require approval merely because a local static pattern classified the
command as dangerous, contradicting the intended Auto behavior.

#### Root Cause

Space injected `AutoModeToolGuardrail` but did not retain a run-scoped ownership
fact after bootstrap. The event hook therefore could not distinguish a call
already reviewed by the SDK from a fallback call that still needed the local
broker. The broker's dangerous-command fence was valid for its own fallback
path, but became a divergent second decision owner on the normal Auto path.

The first correction exposed three adjacent integration gaps: Auto bootstrap
failure broadly allowed every command not matched by Space's static dangerous
patterns instead of using the Accept-edits boundary; Skill dynamic-context
commands were not wired to the embedded guardrail and could fall back to the
SDK trusted-CLI executor; and the run-owned decision path still consulted the
Session's mutable live mode after a UI mode switch.

#### Resolution

- Track successful Auto guardrail installation for each embedded run.
- Keep the Partner tool whitelist ahead of all permission short-circuits.
- When the current mode is Auto and the run's guardrail is installed, return
  from `beforeToolExecute` without invoking the Space broker. The SDK verdict is
  the sole decision.
- Snapshot permission mode at run start and carry that mode through the Host
  permission bridge, so a mid-run UI toggle affects the next run rather than
  changing the current run's decision owner.
- When Auto bootstrap fails, reuse the Accept-edits fallback exactly: edits and
  known read-only tools may proceed, while ordinary shell and dangerous calls
  retain the broker boundary instead of failing open.
- Route Coder Skill dynamic-context commands through the same run-owned Auto
  guardrail with the persisted transcript, current prompt, and trusted
  run-scoped permission intent intact. Disable dynamic-context shell execution
  on Partner, including the manual Skill path, so the SDK trusted-CLI fallback
  is never reachable.
- Pin the supplied KodaX 0.7.79 tarball by exact lockfile SRI and extend the
  installed-package compatibility probe to prove both final `allow` and explicit
  `ask` behavior.

#### Files Changed

- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/kodax/host.ts`
- `apps/desktop/electron/kodax/session-adapter.ts`
- `apps/desktop/electron/ipc/skill.ts`
- `apps/desktop/electron/permission/decision-owner.ts`
- `apps/desktop/electron/permission/broker.ts`
- `apps/desktop/electron/skill/dynamic-context-executor.ts`
- `apps/desktop/electron/test/host.test.ts`
- `apps/desktop/electron/test/permission-decision-owner.test.ts`
- `apps/desktop/electron/test/permission-mode-policy.test.ts`
- `apps/desktop/electron/test/skill-dynamic-context-executor.test.ts`
- `apps/desktop/electron/test/kodax-runtime-compat.test.ts`
- `package-lock.json`
- `vendor/kodax-ai-kodax-0.7.79.tgz`
- Permission architecture and user documentation

#### Verification

- The supplied, vendored, and installed packages all report KodaX 0.7.79 and
  the lockfile SRI matches the exact tarball bytes.
- Direct installed-package probes show LLM `allow` returns `action: allow` with
  zero user prompts, while LLM `ask` reaches the user bridge exactly once.
- Permission ownership, broker fallback, run-mode bridge, Skill intent
  propagation, and installed-package compatibility regressions passed 62/62.
- The aggregate Desktop run reached all 2,243 tests; its two intermittent
  Windows native-process failures (`F118 learning daemon` and PTY
  `AttachConsole`) both passed when isolated (1/1 and 9/9). Release tests passed
  33/33, and Electron TypeScript and targeted ESLint checks passed.
- A clean local-test-package production build passed. Packaged smoke verified
  exact KodaX 0.7.79 content, all Runtime/Worker resources, native bindings,
  installer limits, and a packaged boot that reached Runtime ready.

### 159: Complete exit could release daemon ownership while the detached process still locked the packaged output directory

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 / KodaX 0.7.79 complete-exit integration
- Fixed: corrected KodaX 0.7.79 test package and v0.1.34 Space source
- Created: 2026-08-03
- Resolution Date: 2026-08-03

#### Original Problem

After the user had confirmed that every Session was idle, **Quit completely**
could remove the Space window and main process while leaving the detached Coder
daemon alive. The surviving process retained files under `out/win-unpacked`, so
the next `npm run clean` failed with `EBUSY` even though no task or other client
was expected to keep Runtime available.

The daemon log could already contain `stop requested`, `stopping`, and
`stopped`, making the remaining operating-system process and directory lock
look inconsistent with the reported shutdown result.

#### Root Cause

The KodaX daemon host released its owner fence before all process-wide resources
were guaranteed to be closed. Its detached serve entry point could finish the
logical host shutdown without an explicit process exit, and the stop caller did
not require both the original process to disappear and a matching durable
cleanup outcome before reporting success.

Space's ready-Runtime path had a complementary verification gap. It waited for
the daemon owner record to become unowned and then restored daemon policy, but
did not retain the PID returned by the atomic management inspection or prove
that this operating-system process had actually exited. The fallback CLI path
also allowed only four seconds for the full cleanup contract.

#### Resolution

- Installed the corrected KodaX 0.7.79 test package. KodaX now closes A2A, hot
  reload, extensions, LSP, managed child processes, and tracing; writes a
  durable shutdown outcome; explicitly exits the detached serve process; and
  reports success only after the original process has exited with a matching
  successful outcome. Timeout recovery validates the original process identity
  before reclaiming its process tree and detects a replacement daemon.
- Space now retains the daemon PID from the same revisioned management
  inspection used by `stopForInline`. After owner release it holds the temporary
  inline fence until that exact inspected PID is no longer alive, preventing a
  replacement owner from entering the transition window.
- Space never kills an unverified PID. If exit cannot be confirmed within 15
  seconds, it restores daemon policy, fails closed, and leaves the existing
  **Keep Space open / Force close** decision to the user.
- The disconnected/idle CLI fallback passes a 15-second cleanup window to
  KodaX and gives the subprocess a 50-second outer budget, covering the
  connection/handshake window, RPC reserve, post-accept cleanup, and final
  process-tree verification. It preserves
  `cleanup_failed`, `cleanup_unverified`, and `replacement_running` diagnostics
  instead of reducing them to a generic stop failure.

#### Files Changed

- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/kodax/runtime-daemon-control.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `apps/desktop/electron/test/runtime-daemon-control.test.ts`
- `docs/KNOWN_ISSUES.md`

#### Verification

- The corrected source package and Space vendor package have the same SHA-256,
  and both root/Desktop dependency edges resolve to the installed 0.7.79 bytes.
- KodaX's real daemon shutdown smoke suite passed 21/21, including cleanup
  failure, hung close, blocked final cleanup, replacement-owner, and stale-stop
  regressions.
- Space Runtime host and daemon-control tests passed 138/138, including PID
  ordering, transient fence reacquisition, persistent-contention rejection,
  cleanup diagnostics, fail-closed policy recovery, and restart-required error
  propagation when recovery authority cannot be restored.
- Published-package compatibility tests passed 8/8.
- Electron TypeScript and targeted ESLint passed.
- A clean `build:test-kodax` completed successfully. Packaged smoke confirmed
  exact KodaX 0.7.79 content and Worker/native dependency execution, and the
  packaged boot probe reached renderer and Runtime ready.

### 160: Pre-push review exposed history mutation, cache, notice persistence, and permission ownership gaps

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 development snapshot
- Fixed: v0.1.34 source
- Created: 2026-08-03
- Resolution Date: 2026-08-03

#### Original Problem

The final pre-push review found several correctness gaps that targeted feature
tests had not exercised together:

- Partner fork/rewind could reinterpret a canonical conversation entry index as
  a visible-user ordinal even when the renderer supplied an exact revisioned
  history boundary. A page seam splitting a user from its assistant/tool tail
  could also leave the otherwise complete turn without a mutation boundary;
  tails spanning three SDK pages and very large same-page presentation slices
  exposed two additional ways to lose the exact boundary.
- Project switching did not clear every renderer paging/live-baseline cache,
  ready Session reactivation could reuse stale history, and a 32-bit history ID
  hash had a practical collision risk in long Sessions.
- Rewind sent the renderer's bounded 32-row local-notice projection back as a
  replacement for the main process's 1,000-row durable store. Separate Space
  processes also performed append as an unfenced read-modify-write, allowing a
  later writer to overwrite an earlier notice. An initial compare-and-swap
  implementation still displaced the canonical path briefly, so a competing
  writer could mistake transaction-only `ENOENT` for a new empty store.
- The SDK watcher invalidated only list caches in Space, and KodaX 0.7.79's
  Windows ID-set poll plus Linux flat fallback do not report content changes to
  existing per-project JSONL files. Cached Session, transcript, canonical
  conversation, and list projections could therefore remain stale after an
  external process changed the same Session.
- One embedded run could mix its captured permission mode with the Session's
  mutable setting. Ordinary Auto bash then entered a second Space broker,
  waited five minutes, and returned `deny` instead of the KodaX guardrail's
  `allow_once` outcome. Follow-up review also found that Auto bootstrap failure
  did not really enforce the announced `accept-edits` fallback, while an
  over-broad run snapshot could overwrite a newer live daemon setting.

The review also found a stale 0.7.78 capability-ledger statement and an
untracked placeholder `pnpm-workspace.yaml` that must not be included in an npm
workspace commit.

#### Root Cause

The history implementation mixed canonical storage identity with UI-relative
indexes and treated renderer caches/projections as mutation authority. Durable
notice writes had process-local serialization but no no-gap cross-process
transaction boundary. File-watch invalidation stopped at the sidebar cache and
assumed SDK events covered every platform/content change. Permission mode was
captured at the wrong admission point and embedded run ownership was conflated
with the daemon's live next-tool-call setting contract.

#### Resolution

- Partner mutations now prefer the exact `{ boundaryId, sourceRevision }` and
  use ordinal fallback only for legacy requests without a boundary. Paged
  conversation windows carry the real turn-tail boundary across any number of
  SDK pages, while same-page presentation continuation remains distinct from
  actually omitting a newer SDK page.
- Project reset clears paging state, loaded windows, epochs, in-flight
  generations, and live baselines. Ready Session reactivation performs a
  generation-fenced canonical refresh without blanking the current view.
  History user IDs now use a lossless length-prefixed identity tuple rather
  than a 32-bit hash.
- Rewind sends only a scalar notice cutoff and main truncates the complete
  durable store after a successful disk rewind. Every notice read and mutation
  now participates in a bounded cross-process file lease before exact-byte CAS;
  dead owners recover displaced backups, live owners cannot be age-stolen,
  post-displacement I/O failures restore canonical bytes, and competing targets
  are preserved fail-closed.
- Space adds a content-sensitive JSONL/sidecar watcher on Windows and Linux to
  compensate for the 0.7.79 SDK gaps. Its recursive size/mtime/ctime fingerprint
  scan is asynchronous, bounded in filesystem concurrency, and self-scheduled
  without overlap. Cache/list first fill waits for a bounded initial baseline;
  persistent scan failure fails open after two seconds, and later recovery
  clears all projections before caching can remain stale.
- Every embedded-run permission, plan, dynamic-context, and Space-control path
  uses the same admission-time permission-mode snapshot. An installed Auto
  guardrail remains the sole decision owner for ordinary tools; bootstrap
  failure explicitly degrades the Space broker to `accept-edits`, and dangerous
  tools still fail closed to explicit approval. Daemon settings deliberately do
  not reuse that snapshot: serialized current-mode/corrective updates preserve
  their live next-tool-call contract.
- The capability ledger distinguishes the published 0.7.78 release baseline
  from the vendored 0.7.79 test candidate. The incomplete pnpm placeholder is
  preserved locally but excluded from the commit.

#### Files Changed

- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/kodax/host.ts`
- `apps/desktop/electron/kodax/atomic-file.ts`
- `apps/desktop/electron/kodax/session-content-watcher.ts`
- `apps/desktop/electron/kodax/session-store.ts`
- `apps/desktop/electron/kodax/session-local-notice-store.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/permission/decision-owner.ts`
- `apps/desktop/electron/permission/broker.ts`
- `apps/desktop/electron/space-control/tools.ts`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/shell/sessionHistoryPaging.ts`
- `packages/space-ipc-schema/src/channels/session.ts`
- Related regression tests and documentation

#### Verification

- The final integrated review passed 708 focused Runtime, history, permission,
  watcher, complete-exit, configuration, IPC, release-gate, and persistence
  regressions. The notice/atomic suite passed 40/40 and then passed ten
  consecutive stress repetitions without a failure.
- The full repository suite passed: release checks 33/33, Desktop 2,289 passed
  with four environment skips and zero failures, and IPC schema 307/307.
- Full ESLint, renderer/Electron/package TypeScript, and `git diff --check`
  passed.
- A final clean local-test-package build passed. Packaged smoke verified exact
  KodaX 0.7.79 bytes, Workers and native bindings, and the packaged boot probe
  reached renderer and Runtime ready.

### 161: Space pinned the retired 20-second Auto LLM deadline over KodaX's corrected 30-second default

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.34 / earlier KodaX Auto default pin
- Fixed: corrected v0.1.34 source with the latest KodaX 0.7.79 test package
- Created: 2026-08-03
- Resolution Date: 2026-08-03

#### Original Problem

The refreshed KodaX 0.7.79 package raises the default Auto LLM classifier
deadline from 20 seconds to 30 seconds and reserves a separate low-thinking
budget for models that cannot disable reasoning. Space still exported
`KODAX_AUTO_MODE_DEFAULT_TIMEOUT_MS = 20_000` and deliberately materialized it
into every Runtime Session without an explicit user override. As a result, the
Space path silently replaced the corrected package default and retained the
shorter deadline.

Expected behavior:

- An absent user/config/environment override uses the package-aligned 30-second
  deadline in both embedded and daemon Runtime Sessions.
- Explicit timeout overrides remain authoritative.
- Space diagnostics report the same default that the Session receives.

#### Root Cause

Space correctly pins Auto defaults at the Session boundary so a stale daemon
cannot choose behavior implicitly, but the pinned constant and `/auto-stats`
fallback were not refreshed with the same-version KodaX test tarball. The IPC
schema comment also continued to document the older 0.7.72 default.

#### Resolution

- Updated the single Space-owned Auto timeout constant to 30 seconds and kept
  Runtime Session reconciliation bound to that constant.
- Reused the same constant in `/auto-stats` and updated the IPC documentation,
  removing the independent 20-second diagnostic fallback.
- Replaced the vendored 0.7.79 candidate with the exact supplied tarball,
  refreshed the lockfile SRI, and updated the capability ledger.
- Strengthened the installed-package compatibility probe so a pristine Session
  must return matching direct and paged `resolved` conversation projections
  with zero entries and zero issues.
- Reviewed the package's MCP cleanup, daemon outcome retention, bounded fork
  projection, and resume-scan fixes. They do not change Space's public SDK
  calls; the existing fail-closed daemon verification remains compatible.

#### Files Changed

- `apps/desktop/electron/kodax/user-config.ts`
- `apps/desktop/electron/slash/builtin.ts`
- `apps/desktop/electron/test/user-config.test.ts`
- `apps/desktop/electron/test/kodax-runtime-compat.test.ts`
- `packages/space-ipc-schema/src/channels/kodax.ts`
- `package-lock.json`
- `vendor/kodax-ai-kodax-0.7.79.tgz`
- `docs/KODAX_CAPABILITY_LEDGER.md`
- `docs/KNOWN_ISSUES.md`

#### Tests Added

- Updated the Auto-default regression to require 30 seconds when config is
  absent.
- Extended the real installed-package Worker probe with exact empty canonical
  conversation status/count assertions.

#### Verification

- The supplied, vendored, and lockfile-pinned tarball has SHA-256
  `1e8bdd3c20510e4d14d819878fd2c97abed1fcc9022ec8f5da2d9bfce9559703` and
  SRI `sha512-q0IK/KUzW+7Iyjp5tIIWeebqGrW3qisXqpFxbktm4B5Nz3Lc1Z8Oqpkhsw92Zw1KrzBqloSxxGiCUBGK7+RNAg==`.
  All 139 extracted payload files match the installed package.
- Auto/default, slash, and installed-package compatibility regressions passed
  86/86; Runtime host and daemon-control regressions passed 138/138.
- Package, renderer, and Electron TypeScript checks passed, along with targeted
  ESLint, Prettier, and diff whitespace validation.
- `build:test-kodax` passed. Packaged smoke verified the exact KodaX 0.7.79
  facade/Workers/native closure, and the packaged boot probe reached renderer
  ready in 8.967 seconds and Runtime ready in 29.452 seconds under the
  deterministic daemon hold.

### 162: Space did not configure or project KodaX sandbox environment passthrough into SDK Runs

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.34 / refreshed KodaX 0.7.79 sandbox contract
- Fixed: corrected v0.1.34 source with the latest KodaX 0.7.79 test package
- Created: 2026-08-03
- Resolution Date: 2026-08-03

#### Original Problem

The refreshed KodaX 0.7.79 package adds user-level `sandbox.envPass` and the
Run-scoped `KodaXOptions.sandbox` / daemon transport contract. Space neither
exposed the configuration nor projected it into embedded, Partner, legacy
Coder, or daemon Coder Runs. Required host environment variables therefore
remained unavailable to model-issued command targets, while an omitted Run
option could also fall back to unrelated process-global configuration.

Expected behavior:

- Space edits the same user-level `~/.kodax/config.json` `sandbox.envPass`
  field as KodaX and persists names only.
- Every Space-started SDK Run passes an explicit allow-list, including an empty
  list, so permissions are Run-scoped and deterministic.
- Values are read only on the command-execution host; built-in execution-control
  variables remain blocked by KodaX.
- The refreshed package's unchanged-revision A2A reload fix requires no Space
  API migration and suppresses false reload notices after config writes.

#### Root Cause

Space's config overview and mutation IPC modeled compaction, integrations, and
Skill storage but not the new sandbox field. Coder/Partner Run construction and
the independent Workflow launcher continued to pass only the older option set,
and the SDK startup probe did not assert the new sandbox parsing export.

#### Resolution

- Added a bounded, strict sandbox config schema and an admitted
  `settings.kodaxConfig.setSandbox` mutation with Runtime reload reporting.
  Sandbox and compaction saves submit only their edited top-level domain into
  KodaX's lock-protected shallow-merge writer, so stale Space snapshots cannot
  overwrite concurrent CLI changes in unrelated domains.
- Added a bilingual Runtime settings editor for environment names. It
  normalizes standard variable names, deduplicates them, never reads values,
  documents KodaX's blocked control variables, and warns that attached
  persistent daemons must restart after host values change. KodaX's unbounded
  Run policy remains intact when CLI-authored input exceeds the IPC editor's
  128-item/256-character bounds; Space marks that projection read-only instead
  of silently truncating and re-saving it.
- Added one run-config snapshot loader and projected its explicit
  `sandbox.envPass` into embedded/Partner, daemon Coder, legacy, and all
  independently launched Workflow options. Empty configuration is materialized
  as `{ envPass: [] }` to override ambient process fallback safely.
- Added the new mutation to the typed channel registry and Coder action
  manifest, and required `parseSandboxEnvironmentPass` in the startup SDK
  shape probe.
- Audited all changes after the prior 0.7.79 tarball. The other behavioral
  change is KodaX's internal A2A unchanged-revision reconciliation fix; Space's
  existing integration-health projection needs no API or schema change.

#### Files Changed

- `packages/space-ipc-schema/src/channels/settings.ts`
- `packages/space-ipc-schema/src/channels/index.ts`
- `packages/space-ipc-schema/src/index.ts`
- `apps/desktop/electron/ipc/settings.ts`
- `apps/desktop/electron/kodax/user-config.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/kodax/workflow-controller.ts`
- `apps/desktop/electron/kodax/kodax-sdk-probe.ts`
- `apps/desktop/electron/kodax/runtime/coder-action-manifest.ts`
- `apps/desktop/renderer/src/features/settings/SettingsModal.tsx`
- `apps/desktop/renderer/src/i18n/messages.ts`
- User/capability documentation, related regression tests, `package-lock.json`,
  and the vendored tarball

#### Tests Added

- Added IPC coverage for the new channel, output projection, exact variable
  name grammar, item bound, and rejected invalid values.
- Added config read/write coverage for normalization, deduplication, explicit
  empty policy, domain-only concurrent-write preservation, lossless oversized
  Run policy, bounded read-only projection, and combined Run snapshots.
- Extended the daemon Run regression to require the configured names in
  `options.sandbox.envPass`; TypeScript checks both daemon and direct SDK option
  surfaces against the installed package.
- Added Workflow launch regressions for configured and explicit-empty
  `sandbox.envPass` projection.

#### Verification

- Source and vendor tarballs have SHA-256
  `20168b912b8b203614e408f35361b74197a55c6041016c6b68915e3ef499942a`
  and SRI
  `sha512-Ywf1Dm5ex/8eIYB1uoFUdtXWTeY4+ULbN8ACyhZAmdrBfAnZi4JZ/eyN7mz25H/n+r5Qpz1f55MuL+tMAg1sMA==`.
  All 139 extracted payload files match the installed package byte-for-byte.
- Targeted schema, config, daemon projection, manifest, and real-SDK probe
  regressions passed; full repository tests passed with zero failures.
- Full package/renderer/Electron TypeScript, targeted ESLint, smoke build, and
  `git diff --check` passed.
- A second read-only sub-Agent review after the fixes found no P0-P3 issue and
  independently confirmed Workflow coverage, top-level patch semantics, and
  lossless oversized Runtime policy.
- `build:test-kodax` and packaged smoke passed. The packaged app contained the
  exact 0.7.79 SDK/Workers/native dependency closure and reached renderer ready
  in 6.875 seconds and Runtime ready in 27.459 seconds.

### 163: A newly sent query could temporarily take ownership of an older restored reply until Space restarted

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 bounded history/live projection
- Fixed: corrected v0.1.34 source
- Created: 2026-08-04
- Resolution Date: 2026-08-04

#### Original Problem

In Session `20260803_083817_9b45db6ce73db5`, the newly submitted query
`Issue 256 是什么问题？` temporarily appeared immediately before output from an
older Run. Fully quitting Space and reopening the same Session restored the
query to its correct position.

The persisted evidence was not corrupt. The query occurs once at physical
line 525 (`entry_ca720cb46c18`, `2026-08-03T16:30:01.334Z`) after the prior
Run's final assistant entry at line 523. KodaX 0.7.79 direct and paged
canonical history also agree: the older `继续推进` assistant record is at
canonical index 537, while the reported query is at index 566. Restarting
cleared only Space's renderer projection and reproduced the canonical order.

#### Root Cause

Space correctly used transcript order when reconstructing canonical history,
but `composeMessages()` still merged user rows and notices through a shared
`sentAt` sort before assigning positional assistant-event segments. A bounded
newest page can begin inside an assistant/tool sequence, so history replay
creates an invisible user owner for that leading segment. That owner used the
Session-list `createdAt` fallback. For an in-flight resumed Session this value
can describe the current Runtime attachment rather than the first record in
the bounded page.

When the fallback was later than a concurrently submitted query, restored
users were monotonically placed after that fallback while the new optimistic
query retained its earlier wall-clock value. The sort therefore inserted the
new query between the leading anchor and older restored users. Positional
composition then paired that query with an old assistant segment. After a
restart the query itself was canonical and the whole window was rebuilt in
transcript order, which is why the symptom disappeared without changing any
Session file.

This was a Space ordering-authority bug, not a KodaX sidecar merge regression,
not a same-millisecond tie, and not duplicate Session content.

#### Resolution

- A leading history anchor now takes the first available canonical history-item
  time. Session `createdAt` remains only the fallback for records that provide
  no timestamp.
- Every newly appended root user row is normalized monotonically after the
  existing user stream. An explicit time is preserved whenever it is already
  compatible with transcript order; otherwise it advances only enough to keep
  user ownership stable.
- The change is intentionally limited to user/reply ownership. Local and
  workflow notices retain their real times for UI interleaving, and no content,
  timestamp, or entry is deduplicated or globally re-sorted.

#### Tests Added

- Added the reported shape: a bounded page beginning with assistant output,
  one Runtime Run with two batched interrupt deliveries, canonical/live
  reconciliation, a resume-time fallback later than the new query, and a
  subsequent completed root Run.
- The regression requires the leading output, every query, both interrupt
  boundaries, and both answers to remain in exact transcript order, and checks
  that closed event-segment ownership stays balanced.

#### Verification

- History replay, message composition, history paging, and queued/cancel event
  suites pass: 154/154.
- The complete Desktop suite executes 2,307 tests: 2,303 pass, four
  platform-conditional tests skip, and zero fail.
- Full package, renderer, and Electron TypeScript checks pass.
- Targeted ESLint, Prettier, and `git diff --check` pass.
- The local KodaX 0.7.79 package build and packaged smoke pass. The packaged
  renderer reached ready in 8.366 seconds and Runtime ready in 28.721 seconds
  under the deterministic daemon hold.

The fork-specific recurrence reported later the same day is tracked separately
as Issue 164. Its persisted canonical order was also correct, but it entered the
renderer through a different event-ownership cloning path.

### 164: Forked restored events were reclassified as live and replayed after the child-only query

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 fork/history hydration projection
- Fixed: corrected v0.1.34 source
- Created: 2026-08-04
- Resolution Date: 2026-08-04

#### Original Problem

After forking Session `20260804_075116_7yd74779e022ea` into
`20260804_080033_121f01478b8a15`, the child-only query
`先上 32px统一的方案进行处理。` appeared above assistant/tool output inherited
from the source Session. The source Session correctly did not contain that
query.

The persisted child transcript was also correct. Its inherited records occupy
physical lines 2-22 with explicit `sourceEntryId` provenance, the child-only
query occurs once at line 23, and the child response follows it. The complete
parent chain and timestamps are ordered correctly. This excluded KodaX fork
copying, canonical paging, duplicate persistence, and timestamp ties.

#### Root Cause

Space paints a fork immediately by cloning the selected source renderer buffer,
then replaces that optimistic copy with the child's canonical history when
hydration completes. History/live ownership is deliberately tracked outside the
public event schema by object identity. `forkSessionBuffers()` created new event
objects while remapping their `sessionId`, so already-restored events lost that
identity. More generally, even source-live rows become an inherited, durable
prefix in the child after a successful fork and must not retain their source
classification there.

Canonical child hydration therefore classified the copied source-history
events as child-live events. It built the correct canonical prefix and then
appended the misclassified inherited event stream again. Because replies are
assigned to positional user owners, the first duplicated old segment was
consumed by the child-only query. This made the query look moved even though
neither persisted Session had been reordered.

#### Resolution

- Every optimistic row copied through the fork boundary is now classified as
  inherited child history: user rows are cloned with `restoredFromHistory` and
  remapped events receive the renderer-only restored-history ownership marker.
- Canonical child hydration can therefore replace the optimistic inherited
  prefix while retaining only events and queries created in the child after the
  fork.
- Source buffers remain isolated, child-only queries never enter the parent,
  and no content/timestamp deduplication or global sorting was added.
- KodaX requires no change for this incident because its source and child
  transcripts, provenance, parent chain, and canonical order were correct.

#### Files Changed

- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/electron/test/history-replay-no-popout.test.ts`
- `docs/KNOWN_ISSUES.md`

#### Tests Added

- Added the exact hydration-first fork sequence: restored source buffer, child
  canonical hydration, then a child-only query and response.
- Added the inverse race: the child-only query completes before canonical child
  hydration resolves.
- Added a source-live compatibility prefix without strong turn identity and a
  mixed restored/source-live prefix. These adversarial cases ensure correctness
  does not depend on identity folding to hide duplicate rows.
- All four tests require exact inherited/query/reply order and closed segment
  ownership. The original hydration-first test was observed failing before the
  source fix with both inherited assistant segments appended after the child
  query; independent review also reproduced duplicate source-live rows before
  the final classification fix.

#### Verification

- History replay, message composition, history paging, and queued/cancel event
  suites pass: 158/158.
- The complete Desktop suite executes 2,311 tests: 2,307 pass, four
  platform-conditional tests skip, and zero fail.
- Full package, renderer, and Electron TypeScript checks, targeted ESLint,
  Prettier, and `git diff --check` pass.

### 165: Stop on a managed daemon Run left it stuck as stop_outcome_unconfirmed; spinner never cleared and sends failed with stale_run

- Priority: High
- Status: Open
- Introduced: KodaX 0.7.79 managed-task Stop / Space run-phase projection
- Created: 2026-08-04

#### Problem

Session `20260804_075304_d2d3820c29bebd`, Run `run_msdws10q_43b6e914` (a
managed task that had spawned three audit sub-agents):

- User pressed Stop at `2026-08-04T00:24:14.818Z`. The daemon immediately
  transitioned the Run to phase `unknown`, stage `unknown`, error
  `stop_outcome_unconfirmed`, and emitted the stop receipt with
  `state: unknown / outcome: unknown / reason: "runtime run aborted"`.
- The provider request aborted 0.3s later (`Request aborted`,
  `lastErrorTime` 00:24:15.109Z in the Session meta), but the managed worker
  kept executing: the Run streamed **2,733 more assistant deltas over
  ~9 minutes** until 00:33:26Z, then sat silent for 4 minutes, and finally
  settled at 00:37:23Z as `failed` with
  `Provider run failed while using a run-scoped credential.` — the SDK's
  credential redaction replaced the underlying user AbortError.
- During the whole 00:24:15–00:37:23 window the Session showed a permanent
  spinner while the agent appeared not to run; the interrupt button did
  nothing (re-Stop is a no-op on an already-stopping Run); and every queued
  send briefly showed a yellow queue bubble that then vanished with
  `HANDLER_ERROR: [session.send] handler threw: The daemon rejected the
interrupt input: stale_run`.
- Restarting Space restored the Session's canonical history, but the failed
  Run's final output was lost (the Run never completed).

#### Root Cause

A chain of three independent defects, only the first two of which Space can
repair:

1. **KodaX SDK (Issue 146 remaining requirement):** Stop on a non-queued Run
   immediately flips it to phase `unknown` / `stop_outcome_unconfirmed` and
   aborts the abort signal, but the managed executor / spawned sub-agents keep
   working for minutes and only terminalize much later — here 793 seconds
   after Stop. During that window the Run is neither active nor terminal, and
   its eventual failure is masked by the run-scoped credential redaction, so
   cancellation semantics are erased.
2. **Space projected phase `unknown` as indefinitely active:** `ACTIVE_PHASES`
   in `apps/desktop/electron/kodax/runtime/coder-daemon-projection.ts`
   (L35-42) includes `'unknown'`, so the Session live projection kept
   `activeRun` set for the whole stuck window: spinner + Stop persisted, and
   nothing could converge until the daemon terminalized on its own. There is
   no recovery affordance (timeout, "stop unconfirmed" state, force-idle) for
   a Run that is provably stopping but not terminal.
3. **Admission rejection surfaced as a hard error:** while phase is `unknown`
   the SDK's `submitInput` admission returns
   `{ accepted: false, reason: 'stale_run' }`. The main build that ran during
   the incident (`dist-electron/main.js`, `RealKodaXSession.send()`) converted
   every `!accepted` result into a **throw** — `The daemon rejected the
interrupt input: stale_run` — which `registerChannel` wrapped into the
   `HANDLER_ERROR` the user saw and removed the optimistic queue bubble.

#### Current State

Space now stops throwing for factual admission rejection:
`real-session.ts` returns `{ accepted: false, reason, queueMode }`,
`ipc/session.ts` forwards the rejection, and
`BottomBar.restoreUnacceptedSend()` removes the optimistic bubble, restores the
composer, and shows a per-reason message (`bottom.sendRejected.*`). Runtime
projection also preserves causal start/terminal ordering and presents an
unconfirmed Stop as such rather than inventing an idle terminal state. What
remains open is the executor-side cancellation outcome:

- The daemon-side stop-stuck window (SDK) and its 13-minute duration.
- Repeated Stop during that window must return a factual receipt or terminal
  outcome from the daemon. Space must not force-idle a Run that the Runtime
  still reports as nonterminal because doing so could admit overlapping work.
- A dedicated regression still needs to prove that the refreshed KodaX
  package propagates Stop through the managed executor and all child work to a
  bounded terminal outcome. Until then, this issue remains open.

A second captured Stop on Run `run_mse3lo21_75253af3` confirms that the
terminal classification is also inconsistent on a short failure path. Space
requested Stop at 03:28:17.900Z; KodaX reported `runtime run aborted` in the
turn failure, then terminalized the same Run as
`Provider run failed while using a run-scoped credential.` at 03:28:17.958Z.
Space must continue to display the authoritative outcome and cannot rewrite it
as cancellation; KodaX still needs one consistent terminal reason for a
user-initiated Stop.

#### 2026-08-06 recurrence and upstream fix status

Session `20260806_200641_l181e74214d29d` exposed a second entry into the same
stuck boundary on KodaX `0.7.83`: fire-and-forget child progress snapshot writes
backlogged the Actor mutation queue, a completed child missed the five-second
terminal-persistence deadline, and the controller self-fenced with
`actor_settlement_not_persisted`. That Actor health projection changed the Run
to `unknown` before the user pressed Stop. `requestRunStop()` then rejected both
Stop attempts as `accepted: false`, so no abort signal or cooperative child
quiescence was delivered. Space kept the nonterminal Run visible and restored
follow-up drafts rejected as `stale_run`; those behaviors preserved facts and
input, but the SDK offered no transition that could restore the Session.

KodaX Issue 282 is fixed in the v0.7.84 development source across the complete
chain: bounded/coalesced progress projection that no longer waits indefinitely
at the terminal boundary, exact same-owner reconciliation of a late Actor
snapshot, first-Stop delivery for a live same-owner unknown Run, and idempotent
repair-effect redelivery when a repeated Stop finds the first repair still
unknown. Durable quiescence of remaining children and confirmed terminal
cleanup then release the Session for a later Run. If the executor Promise had
already returned while durability was unknown, its saved success or
credential-safe failure fact is applied only after repair and remains
authoritative over fallback callbacks. A stale durable unknown status also
cannot rewind an in-process terminal Run; no-op quiescence avoids an
unnecessary Session lock window. Foreign/ownerless ownership, missing terminal
evidence, and genuine persistence failure remain unknown rather than being
force-idled.

Space first consumed that fix through the exact npm Registry KodaX `0.7.84`
package. Current v0.1.40 source has advanced both manifests, every lock view,
and installed deduplicated bytes to exact Registry KodaX `0.7.86`, which retains
the fix and adds the explicit Actor-settlement and Session-journal contracts.
The exact-package Runtime Worker, shared-daemon,
host Stop-receipt, input-admission, external-Agent, typecheck, and release
dependency gates pass. This issue remains Open only for a packaged application
fault-injection rerun of the original progress-backlog/late-settlement incident
and the broader pre-existing Issue 146 cancellation-convergence boundary; the
published v0.1.37 artifact remains historical KodaX `0.7.83` evidence.

#### Evidence

- Daemon Run status `runs/run_msdws10q_43b6e914/status.json`: phase `failed`,
  `stop.requestedAt` 00:24:14.818Z, `stop.outcome failed`, error
  `Provider run failed while using a run-scoped credential.`
- Daemon Run events: `run.updated` to `phase=unknown / error=stop_outcome_unconfirmed`
  at 00:24:14Z, 2,733 deltas after Stop until 00:33:26Z, `run.failed` at 00:37:23Z.
- Session meta `errorMetadata.lastError: "Request aborted"` at 00:24:15.109Z.

### 166: One parallel Session's transcript content transiently appeared inside another Session's view while scrolling up

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 renderer history and presentation isolation
- Fixed: v0.1.34 development
- Created: 2026-08-04
- Resolution Date: 2026-08-04

#### Problem

While Session `20260804_075304_d2d3820c29bebd` was open (and its Run 4 stuck
per Issue 165), scrolling up in its transcript revealed content that belongs
to the parallel Session `20260804_075116_7yd74779e022ea` (the scroll-dead-zone
analysis conversation, later forked as `20260804_080033_121f01478b8a15`).
Switching away and back still showed the same mixed transcript. A full Space
restart restored both Sessions to their correct canonical history.

#### Root Cause

The mixing was transient Space state, not persisted KodaX history:

- The target JSONL, canonical conversation cache, and daemon Run events contain
  none of the leaked text. The text exists only in the source/fork Sessions,
  and restarting Space restored the correct transcript.
- A history request and reply had no end-to-end request owner. A late reply
  could therefore be accepted without proving that it belonged to that exact
  Session and request generation.
- Multiple history operations for one Session could mutate the shared paging
  window concurrently. An older continuation could overwrite a newer browsing
  window after a switch or refresh.
- `ConversationStreamV2` survived Session switches. Its DOM and local refs,
  including scroll/follow and expandable-row state, could outlive the Session
  whose rows created them. Row identities are only meaningful inside one
  Session, so retaining that component crossed an ownership boundary.

The exact live heap was gone after restart, so evidence cannot identify which
unfenced write won in this occurrence. The root defect is the absence of all
three ownership boundaries, not hot reload itself and not a timestamp or
content-deduplication problem.

#### Resolution

- `session.history` now carries a renderer-generated `requestId`; the main
  process echoes both `sessionId` and `requestId`, and the renderer fail-closes
  before installing a mismatched response. Diagnostics contain metadata only.
- History window reads and mutations are serialized per Session. Different
  Sessions still load concurrently, while an older continuation cannot replace
  a newer window for the same Session.
- Coder and Partner conversation components are keyed by Session id, so local
  refs and DOM state are destroyed at the ownership boundary.
- No global timestamp sort, content-based deduplication, or persisted Session
  rewrite was introduced. KodaX requires no change for this incident.

#### Verification

- Tests reject a foreign Session/request response before store installation.
- Tests prove same-Session history operations are single-writer while
  different Sessions remain parallel.
- The complete Desktop suite and TypeScript/build verification cover the
  remount and paging integration.

### 167: Send admission reread mutable Session history and surfaced transient topology changes as a raw HANDLER_ERROR

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 Runtime admission boundary
- Fixed: v0.1.34 development
- Created: 2026-08-04
- Resolution Date: 2026-08-04

#### Problem

After the full restart that followed the Issue 165 incident, Session
`20260804_075304_d2d3820c29bebd` restored its history correctly but can no
longer send at all. Every query shows the pending spinner for a few seconds,
then fails with:

```
HANDLER_ERROR: [session.send] handler threw: Session location topology could not be verified for 20260804_075304_d2d3820c29bebd
```

Other Sessions in the same project send normally.

#### Root Cause

KodaX correctly reports `data_changed` when a strict canonical-history read
cannot prove one stable Session topology. Space turned that recoverable read
conflict into a permanent control-plane failure:

- Send admission called `ensureSession()` and loaded the complete Session only
  to re-prove surface/project ownership, even though Runtime initialization
  already held a fresh, ready profile for the exact Runtime and Session.
- Observation, settings synchronization, managed-run start, and input submit
  repeated variants of the history-grade validation. This increased races
  with actor/settings writers and made the target fail every admission.
- Exhausted `data_changed` escaped as an exception. IPC converted it to raw
  `HANDLER_ERROR` after the renderer had inserted an optimistic query bubble.

The absent location hint exposed the redundant Space read, but it was not a
valid reason to require a mutable transcript before every control operation.
This issue does not require a KodaX SDK change.

#### Resolution

- Admission first verifies fresh persisted ownership, then accepts an exact
  fresh Runtime profile only when Runtime id, Session id, surface, and project
  root all match. Missing or inconclusive profile fields fail closed into the
  strict canonical fallback.
- Strict fallbacks use bounded retry for explicit
  `data_changed`/`resync_required` results and are singleflighted per exact
  Session identity. Identity conflicts still fail closed.
- Redundant full-history reads were removed from observation, settings sync,
  managed-run start, and input submit. The daemon's `runs.start()` and
  `submitInput()` remain the authoritative admission boundary.
- If topology still changes before admission, Space returns
  `{ accepted:false, reason:"session_data_changed" }`. The renderer restores
  query text and attachments and shows a retryable message instead of a raw
  error.
- The catch boundary ends before `runs.start()`/`submitInput()`. Space never
  automatically retries after Runtime admission may have accepted input, so
  this repair cannot duplicate a query.

#### Evidence

- Error text reproduced verbatim from the SDK throw site in `kodax_cli.js` /
  `runtime-worker.js` (`Session location topology could not be verified for ${t}`).
- Strict callers: daemon `read` (`readSession strict`), `readConversationPageCache`,
  `readConversationPageBoundary`, `prepareConversationPageCache`,
  `readFullSnapshot`; Space reaches it via `runtime.sessions.load` in
  `runtime-host-adapter.ensureSession` (send path).
- `.location-index` has no entry for `075304` but does for `075116`/`080033`
  (working Sessions short-circuit via the hint).
- Session file `ctime` churn (09:15:33 / 09:30:18) + `.write-locks`
  `45430136af...lock.queue` toggling at 09:28-09:31 while sends were attempted.

#### Verification

- Runtime tests prove exact-profile admission avoids a history load, while a
  missing root, stale profile, surface mismatch, project mismatch, or
  persisted-owner mismatch cannot use the shortcut.
- Tests prove same-identity singleflight, bounded transient retry, and
  conflict fail-closed behavior.
- A real-session regression injects a pre-admission topology conflict and
  proves that no observation, `runs.start()`, `submitInput()`, query event, or
  run event occurs before the factual rejection is returned.

### 168: Thinking output could stream while stale idle snapshots hid both the activity spinner and Stop button

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 Runtime event/snapshot arbitration
- Fixed: v0.1.34 development
- Created: 2026-08-04
- Resolution Date: 2026-08-04

#### Problem

After a query was accepted, thinking content continued to stream and the
sidebar showed the root Agent as running, but the activity row disappeared and
the composer showed Send instead of Stop. The Run was real; only its control
surface was missing.

#### Root Cause

Runtime bridge events and `session.live`/profile snapshots arrive through
independent IPC paths. `session_start` correctly cleared the optimistic
`pendingSend` marker, but `selectActivitySnapshot()` then gave an older idle
snapshot unconditional precedence over the streaming event lifecycle. During
the observation delay this produced a gap:

1. pending Send was cleared because canonical `session_start` arrived;
2. the latest live/profile snapshot still described the previous idle boundary;
3. thinking/text events continued to render, but the activity selector returned
   the stale idle snapshot, hiding both spinner and Stop.

The first repair added a symmetric start/streaming fence, but the packaged
regression exposed a deeper arbitration mistake: it required the latest active
event sequence to be at least as new as both independently delivered snapshot
cursors. An idle profile/live update can advance for reasons that do not prove
this Session's Run terminal. As those idle cursors and new thinking events
alternated, the selector alternated between active and idle, making spinner and
Stop repeatedly disappear and return while output kept streaming.

#### Resolution

- The selector now reads Runtime provenance only from the currently open root
  activity span. Restored content, child activity, and content without Runtime
  provenance cannot claim control authority.
- Positive activity from any current-Runtime plane (`session.live`, profile,
  or an open root event span) now keeps spinner and Stop visible. Absence of an
  active Run in another independently delivered snapshot is not treated as a
  terminal fact.
- Activity clears only when the same Run has an explicit terminal event or
  `lastTerminalRun` fact. A terminal for an older Run cannot hide a newer Run.
- Events from a previous Runtime id cannot resurrect activity after reconnect.
- Active detailed projections still provide the richer status when available.

#### Verification

- Regression covers `session_start + thinking_delta` while idle live/profile
  cursors repeatedly advance past the event cursor and requires activity to
  remain continuously visible.
- The same regression then supplies an explicit same-Run terminal fact and
  requires spinner and Stop to clear immediately.
- A separate regression proves high-sequence events from an old Runtime id do
  not resurrect spinner/Stop.
- Existing terminal fencing, profile arbitration, pending admission,
  compaction, and stale-connection tests remain green.

### 169: A pre-admission failure could shift every later Run output one query to the left

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 terminal compatibility segmentation
- Fixed: corrected v0.1.34 source
- Created: 2026-08-04
- Resolution Date: 2026-08-04

#### Problem

In Session `20260804_075304_d2d3820c29bebd`, a query with an image remained at
the bottom of the transcript while its thinking/tool/assistant output rendered
above it under the previous query. As more output arrived the query bubble kept
moving down with the tail. Submitting another query repeated the pattern: the
new query occupied the final row while the new Run's output attached to the
preceding query.

This was a live Space projection error. It did not rewrite the canonical KodaX
transcript, and it is distinct from the fork hydration and cross-Session
isolation defects in Issues 164 and 166.

#### Root Cause

Space previously defended against a legacy embedded error path that emitted
`session_error -> session_complete -> session_error` for one failed turn by
merging every adjacent terminal event into one assistant segment.

The incident produced a different adjacency:

1. restored history ended with `session_complete`;
2. the next optimistic query failed before Runtime admission with
   `session_error` and therefore had no `session_start` or Runtime turn id;
3. the compatibility merger treated those two terminals as one old segment;
4. one user owner was left without a segment, so all later outputs were paired
   with the previous query and the current query stayed at the tail.

The moving bubble was therefore a deterministic one-owner deficit, not a
timestamp race, DOM reordering, content duplicate, or SDK canonical-order
regression.

#### Resolution

- A live pre-admission terminal without a Runtime turn id receives a
  renderer-local turn identity bound to the latest unbound optimistic root
  query. This identity is projection-only and does not enter KodaX storage.
- Adjacent terminal events are merged only when they share the same turn
  identity. The exact legacy error-first compatibility family remains
  supported, while a successful completion can no longer swallow an unowned
  failure from the next prompt.
- No global sort, text matching, timestamp heuristic, or message deletion was
  added.

#### Verification

- Added the exact restored-complete -> pre-admission failure -> stopped Run ->
  new streaming Run sequence. It failed before the fix with the current answer
  above the current query and passes after the fix.
- Two consecutive pre-admission cancellations without any `session_start`
  retain two distinct owners; the following successful answer remains under
  its third query.
- The legacy no-id `error -> complete -> wrapped error` family stays under its
  original query after renderer-local ownership is applied.
- A cancellation receipt rejected as a duplicate is also excluded from the
  history-live baseline, so a later canonical hydration cannot resurrect it.
- Existing multi-terminal compatibility regressions still preserve both legacy
  error notices in their original turn.
- History replay, composition, activity, and Runtime queue focused suites pass
  together with full renderer/Electron TypeScript checks.

### 170: A transient data_changed during runs.start surfaced after optimistic acceptance instead of retrying safely

- Priority: Medium
- Status: Resolved
- Introduced: v0.1.34 managed Runtime admission
- Fixed: corrected v0.1.34 source
- Created: 2026-08-04
- Resolution Date: 2026-08-04

#### Problem

The same Session intermittently displayed
`Session data changed during the read boundary: <hash>.lock`. Retrying once or
twice later succeeded. Daemon control evidence showed no `run.start` record for
the failed attempt: the conflict happened inside `startManagedRun()` before a
Run handle or admission acknowledgement existed.

Issue 167 already handled `data_changed` in the earlier Session/observation
preflight. It did not cover this later but still factually pre-admission
boundary, so the optimistic query was accepted by the renderer and then ended
as a visible error.

#### Resolution

- `startManagedRun()` now has a small bounded retry only for the explicit
  `data_changed` / `resync_required` classifications and only while no Run
  handle has been returned.
- Cancellation/disposal stops retrying. Exhausted conflicts still fail
  factually and are owned by the correct query through Issue 169's boundary.
- Unknown transport failures are attempted once. Space never retries after a
  handle exists or when Runtime acceptance could be uncertain, so the repair
  cannot duplicate a prompt.

#### Verification

- A regression injects two classified read-boundary conflicts followed by one
  successful admission and requires exactly three attempts with no terminal UI
  error.
- A separate regression injects an unclassified start failure and requires
  exactly one attempt and one error.
- Cancellation during the bounded retry delay prevents any later admission
  attempt and does not emit a misleading Session error.
- Both detach-dispose and abort-dispose during the retry delay prevent another
  admission attempt; abort-dispose still issues its one factual Stop request.

### 171: A bounded newest history page starting mid-turn could place the next answer above its query and the prior answer below it

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 bounded history projection
- Fixed: corrected v0.1.34 source
- Created: 2026-08-04
- Resolution Date: 2026-08-04

#### Problem

Session `20260804_114722_2w61e690e24c48` showed a completed answer at the top,
its query below it, and output from the preceding turn below that query. The
visible timestamps made the inversion explicit. The same shape also explained
the earlier live-only query bubbles that moved downward as new output arrived.

The persisted KodaX conversation cache was already correct: canonical indexes
56, 57, and 58 were prior answer, current query, and current answer. Restarting
Space also restored the correct order. This excluded timestamp sorting,
canonical storage corruption, and the KodaX sidecar merge from the incident.

#### Root Cause

The bounded newest conversation page can legally begin inside an older Runtime
turn. In this incident its first retained row was that older turn's assistant
tail; the older user row was just outside the page, while Space's live baseline
still contained it.

Space inserted an invisible owner for an assistant-leading page so positional
composition stayed structurally closed. However, that owner used a synthetic
hash identity even though the retained assistant row carried the authoritative
Runtime `turnId`. History/live reconciliation therefore could not join the
canonical assistant tail to its one live user owner. The user and event buffers
then represented different logical turn orders, causing positional composition
to render `new answer -> new query -> old answer`.

#### Resolution

- An assistant-leading bounded page now gives its invisible owner the
  authoritative leading `turnId` only when every ownership-bearing leading row
  identifies that same turn. A mixed legacy/current prefix remains ambiguous.
- A leading history-scope truncation notice keeps a separate invisible prefix
  owner, so recovering the omitted query cannot move that notice into the
  query's turn or below it.
- Reconciliation may promote the omitted live query into that canonical slot
  only when exactly one closed live user turn has that `turnId`, it is ordinal
  zero, and the retained canonical response is a verified suffix of its live
  projection. This supports a page cut inside an older reasoning/tool/text turn
  without accepting unrelated output. A sole later mid-turn prompt is explicit
  counter-evidence and remains separate.
- Once that suffix proof succeeds, Space preserves the complete live projection
  in its original order rather than feeding the truncated durable suffix through
  the ordinary durable-first merger. This keeps omitted early text and tool
  events before the retained final answer and prevents the overlapping answer
  from being appended twice.
- When a later older page reveals the real canonical user with a `turnId` but
  no provable ordinal, Space retains its canonical content/index/fork boundary
  and may inherit only the ordinal of one uniquely matching live owner with the
  same stable user payload. Attachment capability URLs are intentionally
  excluded because live and history independently sign them; stable attachment
  identity, status, media type, and byte count still participate. The optimistic
  display label is also excluded because the canonical history path does not
  persist it. This enrichment is allowed only after pagination has reached the
  complete canonical prefix; while any truncation marker remains, Space does not
  guess among possibly omitted same-turn prompts.
- A hidden leading-partial owner cannot claim a live user when the retained page
  already contains another real canonical user for that Runtime turn. The real
  row gets the opportunity to reconcile; otherwise both candidates remain.
- Repeated identical canonical prompts in one Runtime turn remain ambiguous
  when their ordinals are absent. One live row is never guessed to represent the
  first or second identical boundary.
- If several real user prompts share the Runtime turn, the omitted ordinal is
  ambiguous. Space preserves every candidate and the hidden partial owner
  instead of guessing, deleting, or content-matching a query. The complete
  same-turn live user/event group moves as one topology-preserving unit before
  the next different-turn canonical boundary. If a retained same-turn ordinal
  provides a narrower boundary, only live ordinals proven earlier than that
  boundary move; equal or newer live prompts remain in place. Its renderer-only
  ordering coordinate is bounded below the proven anchor because
  `composeMessages` merges user rows by that coordinate; it is never used to
  infer record equality or ownership.
- When that ambiguity also prevents the suffix proof, Space keeps both old
  projections. An unresolved old copy can therefore never cross a later
  canonical user boundary or make a newly sent query appear inside old output.
- Even an exact visible suffix cannot bypass this boundary rule when a retained
  same-turn user lacks an ordinal and therefore blocks authoritative folding.
  Space keeps that weak candidate fail-open, but stabilizes the proven live
  prefix before the next different Runtime turn so assistant segments cannot be
  assigned to the wrong queries.
- A retained canonical follow-up from the same Runtime turn is not a reason to
  skip that positional stabilization. Space relocates the complete live group
  before the next different-turn canonical boundary when no earlier same-turn
  boundary exists. At a retained same-turn boundary, Space relocates only the
  proven ordinal prefix and leaves the exact/fresher suffix available for normal
  folding and tail order. An exact assistant suffix with one proven ordinal-zero
  owner also continues down the ordinary strong-fold path when every retained
  same-turn user has a later strong ordinal; later live prompts are not alternate
  owners of that prefix. This prevents the exact root answer from being retained
  once canonically and once live.
- That fail-open rule can temporarily show both canonical and live copies while
  an older prefix is still unloaded. This is the explicit non-destructive
  boundary that was tracked by Issue 153; Issue 171 fixed the proven two-turn
  inversion, while KodaX 0.7.81 later closed the multi-input identity gap.
- Legacy history without a usable `turnId` retains the stable synthetic anchor
  behavior. No global sort, timestamp heuristic, or text-based deduplication was
  added. No KodaX SDK change is required for this defect.

#### Verification

- A regression reproduces the exact bounded-page shape: canonical older answer
  followed by canonical current query/answer, overlapping complete live turns.
  It requires `old query -> old answer -> new query -> new answer`, each once.
- The regression then performs the real second cursor read that reveals the
  omitted canonical user. It requires the same order while preserving the
  user's canonical index and fork/rewind boundary.
- A tool-rich variant uses live `early text -> tool start -> tool result -> final
text` with only the final text retained canonically. It requires the entire
  live prefix to remain in place and the final text to appear exactly once.
- An adversarial regression supplies two live user prompts with the same
  Runtime `turnId` and requires fail-open ambiguity: neither prompt may be
  guessed away and the partial canonical owner remains explicit.
- Another adversarial regression mixes an unidentified leading assistant row
  with a later identified row and requires Space not to claim both for the
  later live turn.
- A weak same-turn canonical user plus a subsequent different-turn user requires
  the live ordinal-zero prefix to stay before both boundaries without deleting
  the weak candidate or swapping either answer segment.
- Same-turn regressions cover a hidden partial prefix followed by a retained
  canonical user, for both equal and different live payloads, plus two identical
  weak canonical prompts competing for one live ordinal.
- A sole ordinal-one live prompt with a different response cannot be absorbed by
  a same-turn leading assistant tail; both response segments remain distinct.
- A differing canonical/live tail remains non-destructive, but both candidates
  stay before the next canonical query; a subsequent fresh query and answer must
  append after the complete retained window.
- A multi-input variant requires root and follow-up live prompts from one
  ambiguous Runtime turn, both owned response segments, and the retained
  canonical partial tail to remain together before the next canonical query;
  a subsequent fresh query still appends at the end.
- A retained same-turn canonical follow-up followed by a different Runtime turn
  requires the relocated root/follow-up live segments to remain structurally
  aligned and wholly before that next turn.
- A page-end variant omits that later Runtime turn but retains the same-turn
  follow-up with ordinal one. It requires the ordinal-zero root response to stay
  before the follow-up query rather than being shifted below it, and requires
  the exact root answer to appear once.
- A snapshot race adds a fresh ordinal-two live prompt after that retained
  ordinal-one boundary. It requires only the ordinal-zero prefix to move, exact
  ordinal-one overlap to reconcile normally, and the fresh prompt to remain the
  final turn.
- Image paging coverage uses one stable attachment ID with two separately signed
  capability URLs plus a live-only display label and requires one canonical
  query; a different attachment ID must fail open as two distinct queries.
- The complete history replay suite remains green, including repeated truncated
  hydration, fork/rewind ownership, multi-user turns, empty turns, compaction,
  and history-first/live-first races.

## Issue 172: Live transcript events dropped Runtime turn identity, so an overtaking history revalidation could duplicate and reorder a new turn

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 Runtime bridge and ready-history revalidation
- Fixed: corrected v0.1.34 source
- Created: 2026-08-04
- Resolution Date: 2026-08-04

#### Problem

After one completed turn, sending the next query could make that query and its
answer appear above older output, duplicate the query, or make the query bubble
move downward while new output streamed. `Ctrl+R` immediately restored the
correct order. Session `20260804_152219_jw4e99443a2aee` reproduced the defect.

The KodaX JSONL and Runtime run records were already canonical: the latest query
and answer were adjacent, parented correctly, and shared one `turnId`. This
excluded timestamp sorting, persisted transcript order, and SDK sidecar merging.
Space diagnostics instead showed an observation invalidation at the handoff
boundary (`delivery_failed: Session data changed during read boundary`).

#### Root Cause

KodaX attaches the stable Runtime `turnId` to every root transcript event once a
turn exists. Space forwarded that identity on the dedicated `turn.started`
lifecycle event, but dropped it from thinking, assistant, and tool events.
`run.started` cannot supply it because the Runtime has not allocated the turn yet.

If observation handoff missed `turn.started`, the optimistic live query therefore
remained anonymous even though its output continued streaming. At the same time,
a ready-history revalidation could overtake the next active run and install the
canonical copy of that same query and partial answer. Space correctly refused to
guess that an anonymous live owner equalled a canonical owner. The resulting two
owner rows and one positional event stream produced the visible inversion and
moving query bubble. Reload removed the transient live copy and rebuilt solely
from canonical history, explaining why `Ctrl+R` repaired the display.

#### Resolution

- The Runtime bridge now preserves `turnId` on root thinking, assistant, tool
  start, and tool result events.
- Fresh Runtime admission now returns its authoritative `runId` through the
  existing `session.send` acknowledgement. The renderer binds that identifier
  to the exact optimistic message ID created by that send, including slash-skill
  sends and the narrow race where a locally queued row is synchronously promoted
  by immediate admission. Surviving transcript events may then enrich the same
  row with `turnId`, but a delayed event from an older Run can no longer claim
  the newest anonymous query.
- An accepted after-turn queue item carries its exact admitted Runtime `runId`
  into the promoted user owner before transcript events arrive. Interrupt queue
  IDs are not treated as Runtime run IDs. Observation-snapshot and terminal
  recovery paths retain that same identifier instead of emitting an anonymous
  continuation marker.
- Slash-skill sends use the same late-admission contract as ordinary sends. A
  renderer timeout leaves the optimistic owner intact; a later factual result
  either binds the admitted Run or restores the rejected input without creating
  an ownerless live turn. Store mutation remains scoped to the original Session;
  prompt, draft, attachment, and error state change only if that Session still
  owns the composer, so a delayed result cannot overwrite another Session after
  the user switches views. If an ordinary or skill send instead fails after the
  user has switched away, the original Session receives a local failure notice
  containing the unsent input and any attachment labels; the active Session's
  composer remains untouched. The same protection also applies within one
  Session: a late rejection restores the old draft only while the composer is
  still empty. If the user has already started a newer text or attachment
  draft, Space records the failed request as a local notice instead of mixing
  two draft generations.
- A background revalidation that began from an already-painted ready history
  window cannot replace that window while Space still has authoritative live or
  lifecycle evidence of an active Run. The live turn remains continuously
  visible; the terminal persistence
  boundary invalidates the page and permits the canonical generation to replace
  it afterward.
- A deferred terminal refresh keeps its marker until a replacement page is
  installed, including when a second Run starts before that read returns. It
  retries transient failures, ignores stale scoped and unscoped start events
  while the Runtime snapshot is explicitly invalidated, and never jumps an
  explicitly older browsing window back to newest. An immediate warning repair
  uses the same guard, so a new Run that overtakes the read cannot replace the
  ready transcript underneath its live projection.
- Conservative ambiguity rules remain unchanged. In particular, a different
  canonical/live rendering is not treated as proof that two records are equal.
- No KodaX SDK change is required: the persisted canonical order and the shared
  Runtime identity were already present; the defect was in Space's bridge and
  live/history admission timing.

#### Verification

- A bridge regression requires the same Runtime `turnId` on thinking, assistant,
  tool-start, and tool-result Session events.
- A handoff regression drops the identity-bearing start, then proves that a live
  transcript event repairs ownership while the Run is still active and after
  the exact admission acknowledgement binds the optimistic row.
- Admission regressions prove that an acknowledgement binds the intended query
  even when events arrive first, and that a delayed prior-Run start cannot steal
  the next acknowledged query. Queue regressions cover exact after-turn Run
  identity and synchronous local promotion returning the owner ID needed by the
  acknowledgement path, including snapshot and terminal recovery markers.
- Composer regressions cover timeout followed by late accepted and factual
  rejected results, plus the cross-Session ownership gate for visible draft and
  error state. They also require a late same-Session failure with an occupied
  newer draft to take the local-notice path. Read-only review verifies that
  background failure rollback and its notice remain scoped to the original
  Session.
- A terminal fallback regression proves that completion repairs ownership if no
  earlier identity-bearing event survived.
- A paging race regression holds a ready-history revalidation in flight, starts a
  new Run, and returns a canonical partial copy. It requires the old canonical
  window plus the complete live turn to remain ordered and visible, then permits
  the terminal canonical generation to replace it after the Run closes.
- Paging regressions cover a failed deferred refresh followed by retry, an older
  browsing window, stale scoped and unscoped `session_start` events with no
  matching active Runtime Run, a next Run overtaking either a terminal or
  partial-warning refresh, and a snapshot-required projection that must not
  block canonical replacement.
- Existing leading-partial, multi-input, fork/rewind, history-first/live-first,
  and repeated-prompt ambiguity tests remain unchanged and green.

## Issue 173: Reopening or switching an active Session could lose its in-flight transcript and leave sidebar activity stale

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 renderer Runtime observation bootstrap
- Fixed: v0.1.36 development
- Created: 2026-08-05
- Resolution Date: 2026-08-06

#### Original Problem

With several Runtime Sessions running concurrently, repeatedly switching between them could make
already-rendered assistant content disappear, leave completed Sessions spinning, or remove the
sidebar spinner from a Session that was still running. Closing the Space window while leaving the
daemon alive and reopening it could show only `Working` with no in-flight transcript; `Ctrl+R`
repeated the same blank state.

Expected behavior: selecting or reopening an active Session restores its cumulative Runtime
snapshot immediately, background active Session status converges after missed pushes, and an idle
historical Session keeps the cheaper history-first load path.

#### Root Cause

- The selected Session's `session.liveSnapshot` request was gated by canonical history reaching
  `ready` or `error`. Runtime startup outcomes such as `waiting`, `runtime_unavailable`, or repeated
  `data_changed` could therefore block the only cumulative in-flight transcript source forever.
- An existing live projection was treated as sufficient even after switching away and back, so a
  partial or stale projection did not get activation reconciliation.
- Snapshot failures were silently swallowed and the paused event batch had no bounded recovery
  attempt. A missed terminal `session.liveChanged` could leave a stale active projection until the
  renderer was reloaded.
- Sidebar status ignored the fresh Runtime profile's positive active/queued evidence, while history
  cache eviction did not protect background Runtime work.
- The first v0.1.35 recovery correction accidentally put `daemon.inspect()` on the Runtime profile
  refresh path, then made both bounded history and live-snapshot reads refresh that full profile
  whenever the persisted Session file changed. With several active writers, one unstable management
  inspection serialized every Session behind the same queue; `Ctrl+R` then cleared the renderer
  cache faster than main could repopulate it.
- The same correction routed every `surface === 'code'` history read through Runtime, even when the
  selected host was Embedded. Embedded intentionally has no ready daemon, so those Sessions returned
  `runtime_unavailable` forever instead of restoring the persisted conversation.
- Rapid activation of several cold active Sessions could enter `sessions.observe()` concurrently.
  In the packaged app this saturated the shared Runtime transport and delayed an otherwise
  independent history read behind the observation burst.
- Selecting a Session from another project synchronously changed `currentProjectPath`. The sidebar
  treated that ordering change as a cache invalidation and reissued `session.list` for every known
  project, creating an unrelated sidecar-read and React-render burst beside the target history/live
  requests.
- The SDK status snapshot bounded recent Session summaries to 50 while retaining the complete Run
  index. Space ignored active Runs whose Session summary fell outside that page, then interpreted
  every profile omission as a reason to open a cold observation after history. An idle historical
  click could therefore start several seconds of background transport work and delay the next
  cross-project history click.
- A failed/interrupted Run acknowledgement was kept only in renderer memory. Reload reconstructed
  the same authoritative terminal evidence as unseen, so a dismissed red error dot reappeared.

#### Resolution

- Active, queued, interaction-pending, and snapshot-required selected Sessions now request an
  atomic live snapshot immediately, independent of history phase and independent of an older live
  projection. Idle Sessions retain history-first observation.
- Runtime profile and live-snapshot bootstrap errors are logged and retried with bounded backoff.
  Live failures retain the snapshot-required marker and release the paused event batch.
- Canonical `session.history` reads have a 10-second renderer deadline; a hung main-process read
  transitions paging to `error` instead of leaving the observation gate in `loading` forever.
- Equal-revision authoritative snapshots clear a retained requirement. Active-Run snapshots can
  rehydrate cumulative drafts/tools after the renderer transcript buffer was rebuilt without
  replacing or downgrading the existing live projection; terminal snapshots never hydrate drafts.
- Focus, visibility, Runtime reconnection, and profile conflicts reconcile the cached Runtime
  profile and already-observed active Sessions. The 30-second low-frequency pass immediately reads
  the main cache while scheduling a single-flight core status refresh; it never waits for or calls
  the management inspection lane. It also retries the selected Coder Session when exact current
  evidence shows `snapshotRequired`, active/queued work, or a pending interaction even if no live
  projection was installed. Bounded-profile omission alone never creates a periodic observation.
  Focus and visibility hints are collapsed to one inactive-to-active edge so one window activation
  cannot create a redundant profile/live rerun.
- Fresh profile active/queued state can positively mark sidebar activity but bounded-profile
  absence never clears stronger live evidence or creates eager observation. Main supplements the
  bounded recent summaries with active/queued Sessions found in the complete Runtime Run index
  only after independently verifying an out-of-page Session's persisted Coder identity. Unknown
  and Partner identities fail closed, while an omitted idle Session no longer opens an expensive
  observation after history. Exact activity, interaction, or snapshot-required evidence still
  makes the live snapshot urgent. When
  the Runtime becomes ready, a waiting history read is woken immediately instead of waiting for its
  startup retry timer. A terminal snapshot fences a missed same-Run `session_start`, allowing stale
  spinners to stop without `Ctrl+R`.
- History LRU eviction prefers idle Sessions, then active Sessions, while retaining its hard
  32-Session bound. Eviction removes canonical restored rows but preserves independent live state.
- The independent live baseline records canonical indexes only within one exact
  `sourceRevision`; a revision change clears those coordinate watermarks rather than comparing
  indexes across an append, compaction, or re-root. Exact live owners whose complete content was
  already proven equivalent to a durable turn retain a separate identity proof. A later resolved,
  authoritative newest window may prune that proven shadow when its bounded prefix has advanced
  past the owner, even when the append also changed `sourceRevision`. Conflicting or divergent
  identities remain fail-open.
- A resolved newest page that was requested for exact terminal `runtimeId + runId` evidence can
  also prune a live owner from that settled Run when the bounded page has already advanced past it,
  even if no intermediate page ever folded that owner. This proof requires matching runtime-event
  identity and stable entry/turn identity. Partial or ambiguous history, entry conflicts, older
  browsing pages, missing identities, and newer Runs remain fail-open.
- An open live projection may replace a canonical user-only shell or extend a non-empty canonical
  assistant/tool prefix only when its ordered event-level text, thinking, tool identities, inputs,
  and existing results cumulatively cover that prefix. Space retains canonical-only workflow,
  lineage, sidecar, compaction, and truncation metadata, then appends only the proven live suffix in
  its original text/tool order. A canonical prefix therefore cannot move text around a tool call or
  erase a durable notice. Divergent projections remain visible and separate; a synthetic history
  terminal cannot hide the only live suffix.
- Temporarily hidden live duplicates preserve their original ordering timestamp. Removing the
  hidden marker restores that timestamp, so an old interrupted turn cannot inherit a recent
  durable timestamp and move to the end of the conversation.
- No KodaX SDK change, main-process event ring, synthetic turn identity, terminal `turnId`, or new
  ordinal contract was added.
- Runtime terminal evidence is merged by exact `runtimeId + runId`; profile and observation cursors
  are treated as causal lower bounds rather than a total order. Each exact terminal Run generation
  is satisfied by one newest-history request that starts after the evidence exists. The request
  captures its `runtimeId + runId + generation` scope, so evidence that overtakes an in-flight read
  invalidates that read and is handled by the next request instead of being certified retroactively.
  `managedRunDurability` v1 makes one post-evidence canonical read sufficient; Space does not poll
  on unchanged revisions or infer persistence strength from `transcriptRevision`. Duplicate
  terminal evidence is idempotent, failed reads remain retryable, an older terminal cannot close a
  newer Run, and an explicitly older paging window is never forced back to newest.
- A pending send records a renderer-local request generation and its Runtime cursor baseline, then
  binds the exact admitted `runId` through an action independent of the optimistic transcript row.
  With no fresh Runtime authority it starts from a real `-1` cursor rather than an undefined
  wildcard. A cold undefined-to-fresh connection preserves and rebases that request, while a known
  Runtime replacement retires it. Activity or terminal evidence that raced ahead of the
  acknowledgement is reconciled when the acknowledgement arrives; unscoped terminals cannot clear
  it. Delayed acknowledgements and events from a previous request/Run cannot clear a newer pending
  generation. Queued or compatibility acknowledgements without a fresh `runId` explicitly retire
  only their own temporary pending state.
- Runtime profile IPC immediately returns the main-process projection and independently schedules a
  coalesced core refresh using only Runtime status and pending-input state. Auxiliary
  `daemon.inspect()` integration health runs in a Runtime-scoped background lane and cannot block
  history, live snapshots, or profile bootstrap—even if an inspection from a retired connection
  never settles.
- Active/queued Runtime ownership reconciliation uses positive observation/profile evidence and the
  full Coder membership cached by the latest core status projection. Persisted-file changes therefore
  do not trigger a global status read while a Session is actively writing. An idle Session instead
  performs the persisted fallback, capped at two attempts, so an external Partner retag is rejected
  before the Runtime page or cached live projection is exposed even when profile status is stale.
  A temporary active-Run bypass never certifies the changed persisted ownership token, so the
  post-terminal read still performs that strict verification.
- Session history routing now considers both surface and selected host: Daemon Coder waits for the
  bounded Runtime conversation API, while Embedded Coder and Partner restore through the persisted
  conversation projection.
- Persisted Session, transcript, and conversation reads now fence only their own Session generation.
  File activity from other concurrently running Sessions cannot restart or starve an idle Session's
  recovery boundary.
- Only the cold `sessions.observe()` attach RPC is serialized per attached Runtime instance.
  History, snapshot installation, settings/lease work, Actor telemetry, already-open observations,
  and event delivery remain outside that queue. Failed opens release the next Session, while a
  retired Runtime's queue and late result cannot block or overwrite its replacement.
- Reconnect publishes core Runtime readiness before restoring desired observations in the
  background. The recovery pump submits only one not-yet-started cold observation at a time, so a
  newly selected foreground Session can enter after the one attach already running instead of
  waiting behind the complete reconnect backlog. Runtime observation remains single-concurrency,
  and the pump skips a Session already restored or retired in the foreground. The immutable live
  projection is installed before credential/host-tool/settings recovery. Known credential leases
  and optional Actor bootstrap are best-effort, Runtime-fenced background work and cannot hold core
  profile, history, or either the same or another Session's live recovery. Explicit Actor snapshots
  share one whole-Session bootstrap, wait for the initial Actor observer to become ready, and start
  only after the live projection exists; renderer waiting is bounded without spawning retries that
  the current SDK Agent read API cannot cancel.
- Profile revisions advance above the main controller's current watermark, so reconnecting to the
  same stable Runtime ID cannot leave the profile stale and reject the replacement live snapshot.
- Persisted Embedded reads retry a same-Session invalidation at most once. A second changing but
  internally consistent history/transcript snapshot is returned without caching, while strict
  ownership reads fail closed with `data_changed` instead of spinning forever.
- Equal-revision terminal hydration remains a narrow paint repair: it may retire a causally matched
  residual tool/spinner, but it is not used to recover or synthesize a missing assistant tail. The
  latter converges only through the canonical terminal-history refresh above.
- Sidebar project Session scopes are loaded once per project and surface. Merely selecting a
  Session in another already-loaded project no longer rereads every project; explicit refresh and a
  newly discovered scope retain their existing load paths. Status selection uses shallow result
  equality, so streamed text that does not change any Session status no longer repaints the whole
  project tree.
- Acknowledged failed/interrupted Runtime `runId`s are persisted in a bounded renderer preference.
  Reloaded history suppresses only the exact acknowledged terminal error; a different Run still
  produces a new red error dot, and deleting the Session removes its acknowledgement record.
- The 2026-08-06 multi-Session regression had two exact renderer ownership failures. Runtime
  projected a queued `turn.started` as `session_start` immediately before the authoritative
  `run.input.delivered` boundary, allowing positional fallback to claim an older anonymous owner.
  Separately, a newest canonical page containing only the active user row marked that row as having
  no assistant segment, then hid the exact open live duplicate and therefore hid the only streamed
  answer until reload rebuilt canonical order.
- Queued turns now defer their user boundary to `run.input.delivered`, which already carries the
  KodaX 0.7.82 turn, input, and entry identities; Space assigns the observed turn-local ordinal.
  Prompt-delivery boundaries create their own owner and no longer run the initial-owner repair that
  could bind an older anonymous query first. An exact canonical user-only tail adopts the still-open
  live segment without a synthetic terminal; the canonical row remains the sole visible owner and
  later deltas continue under it. When either side of an interrupt reconciliation carries a
  canonical entry reference, a missing or disjoint counterpart remains fail-open instead of falling
  back to the locally synthesized ordinal. Fully legacy pairs with no entry evidence on either side
  retain the guarded strong-turn compatibility path. Complete canonical turns retain the existing
  closed-fold behavior.
- History-cache eviction restores the independent live baseline before discarding canonical rows
  and removes renderer-only hidden-duplicate markers from that baseline. A completed shadow already
  proven equivalent to durable history is pruned before eviction, so dropping the canonical window
  cannot resurrect it at the tail; open and divergent owners remain available for recovery. A
  history-first active canonical owner also keeps a live baseline shadow for later page replacement
  or eviction. Entry reference conflicts remain fail-open even while the live projection is open.
  Passive selection and profile bootstrap hints upgrade and join an in-flight live snapshot instead
  of scheduling a redundant trailing read. No new SDK contract, polling loop, IPC method, full
  transcript read, or main-process event buffer was added.
- Complete-exit preflight shares one authoritative Runtime status read between Runtime blockers and
  local Session checks. When the selected daemon reports ready and idle, a stale local daemon-Coder
  stream no longer causes a false first-close warning; Partner, Embedded, and unavailable Runtime
  paths still fail closed, and mode switching continues to count every local active Session.

#### Files Changed

- `apps/desktop/renderer/src/App.tsx`
- `apps/desktop/renderer/src/lib/ipcInvokeWithTimeout.ts`
- `apps/desktop/renderer/src/store/appStore.ts`
- `apps/desktop/renderer/src/store/runtimeProjectionState.ts`
- `apps/desktop/renderer/src/store/runtimeSnapshotHydration.ts`
- `apps/desktop/renderer/src/features/session/useSessionStatus.ts`
- `apps/desktop/renderer/src/shell/BottomBar.tsx`
- `apps/desktop/renderer/src/shell/LeftSidebar.tsx`
- `apps/desktop/renderer/src/shell/sidebarSessionLoading.ts`
- `apps/desktop/renderer/src/shell/composerInvoke.ts`
- `apps/desktop/renderer/src/shell/sessionHistoryPaging.ts`
- `apps/desktop/electron/ipc/runtime.ts`
- `apps/desktop/electron/ipc/session.ts`
- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/kodax/runtime/coder-daemon-projection.ts`
- Targeted renderer, bridge, schema, and paging regression tests

#### Tests Added

- Active selected Sessions bypass history and stale-projection gates; idle Sessions remain
  history-first.
- Fresh profile activity is positive-only status evidence.
- Equal authoritative snapshots clear retained reconciliation requirements.
- Equal authoritative snapshots rehydrate missing renderer-only draft rows.
- Terminal snapshots fence same-Run lifecycle starts when the terminal push was missed.
- Runtime profile bootstrap and live reconciliation use three bounded retries.
- A hung canonical history IPC times out and releases the observation gate.
- User boundary events retain Runtime causal identity.
- Background active Session history is preferred under pressure while the cache remains bounded.
- History-first, terminal-first, profile-first, snapshot-first, and terminal-overtakes-in-flight
  orderings converge through the request-scoped post-evidence newest read. Evidence arriving during
  an older request requires exactly one follow-up read; duplicate terminal evidence causes no extra
  read, stale evidence cannot terminate a newer Run, and `hasNewer` browsing windows remain
  unchanged.
- A delayed duplicate terminal cannot clear a newly pending send, and profile-only newer activity
  preserves waiting state despite an older queued terminal. Regressions cover the cold authority
  edge, an exact Run already observed before its acknowledgement, acknowledgement without an
  optimistic row, and a timed-out old acknowledgement racing a retry generation. Queued/no-Run
  acknowledgements cannot leave pending state behind.
- Equal terminal hydration removes only a causally covered residual tool while preserving existing
  assistant text byte-for-byte, even if a malformed terminal projection carries draft fields.
- Runtime ownership verification performs no status or management read while active persisted
  history changes; 20 concurrent history and 20 concurrent live recoveries complete while
  management inspection is deliberately held forever. Idle retags are rejected without requiring a
  profile refresh.
- Embedded Coder selects persisted history, while Daemon Coder retains the bounded Runtime and
  `runtime_unavailable` startup paths.
- An unrelated noisy Session cannot restart another Session's ownership, transcript, or
  conversation read.
- A gated two-Session cold-observation burst proves only one open enters Runtime at a time while an
  intervening canonical history read completes before the first observation is released.
- Reconnect recovery with several desired Sessions proves a selected foreground live snapshot
  overtakes background attaches that have not started, remains single-concurrency, and is not
  reopened when the background pump later reaches the same desired ID. Periodic policy tests prove
  exact `snapshotRequired` and profile activity are retried while idle rows, profile omission, and
  stale authority are not.
- Regressions also cover failed-open queue release, same-Session single-flight, a blocked Actor tree,
  whole-bootstrap Actor single-flight, history during gated reconnect restoration, a late
  observation result from a retired Runtime, an Actor result from an attachment replaced under the
  same stable Runtime ID,
  permanently gated known/snapshot credential recovery, same-Runtime-ID active restoration, cold
  active interrupt admission, and bounded Embedded reads under continuous same-Session writes.
- Cross-project selection does not reload settled project Session scopes; new/surface-specific
  scopes still load once. Terminal error acknowledgements survive renderer reload by exact Run
  identity and do not suppress a later failure.
- Runtime-ready recovery cancels a waiting history retry and performs exactly one current-generation
  newest read. If an unavailable read is already in flight, the wake joins it before retrying; the
  existing token, epoch, request ID, and revision fences remain authoritative.
- Profile projection regressions require an active Run omitted from the recent Session page to stay
  visible after exact Coder identity verification, while an unverified or Partner out-of-page Run
  fails closed and an omitted Session with no local or Runtime activity does not open a cold live
  observation after canonical history.
- The 2026-08-06 regression tests reproduce queued `turn.started` before input delivery, a canonical
  user-only newest page overtaking an open thinking/text draft in both arrival orders, continued
  post-history deltas, terminal canonical convergence without duplication, an entry-reference
  conflict, prompt delivery after an anonymous same-Run owner, active/terminal LRU eviction, a
  hidden live owner returning to its original timestamp, a previously canonicalized live turn
  moving outside the bounded newest window across an append revision, durable-proof survival across
  LRU eviction, a never-folded settled Run already omitted by its first post-terminal page, a
  source-revision change, and a non-empty canonical prefix with an interleaved live text/tool suffix.
  The suite also covers one-sided delivered-entry absence, divergent open content remaining visible,
  durable workflow metadata between a canonical prefix and its live suffix, live-only notices before
  and between covered content runs (including one notice splitting a canonical same-kind text run),
  exact content-offset insertion for simultaneous durable/live notices, occurrence-safe notice
  reconciliation, and exact root compaction-stat deduplication. Partial terminal
  history is verified not to prune the live fallback. Exit tests also cover the authoritative-daemon-
  idle/stale-local-state race while retaining fail-closed fallbacks.
- The final focused history/paging/Runtime/mode-switch/exit suite passed 381 assertions with no
  failures. TypeScript, ESLint, `git diff --check`, and the production renderer/main smoke build
  passed. The repository-wide run exposed a separate KodaX 0.7.82 compatibility-probe shutdown
  failure; the transcript/history/exit regressions in this issue remained green.

#### Verification

- The current issue-focused suite passes 381 assertions. A repository-wide run reached 2,491
  passes and 4 environment skips; four transient SDK-build artifact failures passed on targeted
  rerun. The remaining KodaX Runtime compatibility probe cannot verify daemon shutdown against the
  locally installed development/test SDK package, so repository-wide release qualification remains
  open until the shutdown-verification contract is published and the exact Registry dependency is
  installed.
- TypeScript typecheck, full ESLint, `git diff --check`, and `npm run build:smoke` pass.
- The targeted KodaX Runtime compatibility probe remains 6/8: its two daemon-shutdown cases cannot
  verify outer-timeout reclamation / final PID exit against the locally linked development candidate.
  This is independent of the transcript, paging, performance, and close-policy regressions above and
  remains a release gate until the shutdown-verification contract is available from the Registry SDK.
- `npm run build:win` passes packaging and smoke checks with exact KodaX 0.7.82; the packaged
  renderer reached ready in 6,967 ms and Runtime reached ready in 27,407 ms after the smoke test's
  deterministic 20-second hold.
- Direct history reads from the final packaged executable for the three reported legacy Sessions
  completed in 44 ms, 48 ms, and 31 ms and returned 39, 44, and 73 entries. Cold cross-project UI
  switches completed in 34 ms, 90 ms, and 113 ms; the cached return completed in 10 ms. The path
  that previously took about 4.4 seconds completed in 90 ms.
- After `Ctrl+R`, the shell restored in 143 ms and manually reselecting the same historical Session
  restored 23 rendered rows in 164 ms. Current Session selection is not persisted by the existing UI,
  so an idle Session is intentionally not auto-selected after renderer reload.
- A final independent read-only review confirmed the out-of-page Partner isolation finding is
  closed and found no remaining merge blocker. The existing 500-row profile cap remains an explicit
  extreme boundary only when more than 500 Sessions are simultaneously active or queued.

## Issue 174: Interrupt or after-turn send could race active Session persistence and restore the draft with session_data_changed

- Priority: High
- Status: Resolved
- Introduced: v0.1.34 Runtime send admission
- Fixed: v0.1.35 development with KodaX 0.7.82
- Created: 2026-08-05
- Resolution Date: 2026-08-05

### Original Problem

Immediately after interrupting a turn, or while submitting an interrupt/after-turn follow-up, the
composer intermittently reported that the persisted Session boundary had changed, restored the
draft, and asked the user to retry. The prompt had not been lost, but normal active-Run writes were
being mistaken for an ownership or topology conflict.

### Root Cause

- KodaX 0.7.80 `runs.submitInput()` crossed a canonical Session read before resolving the target
  active Run, so the target Run's own writer could produce `data_changed` during valid input
  admission.
- Space reopened history-grade reads after an authoritative observation: settings reconciliation
  discarded the observed revision, while an observed idle state still fell back to strict
  `sessions.status()`.
- When a fresh `runs.start()` exhausted its factual pre-handle boundary retries, Space settled the
  local admission as not admitted but still returned `accepted:true`, preventing draft restoration.
- The first fix cached settings and provider state behind the ordered projection queue. A blocked
  event handler could therefore make a stale settings snapshot look unchanged or bind an after-turn
  credential to an old provider. It also treated internally dequeued prompts like renderer sends,
  even though no caller existed to consume a restored-draft rejection.

### Resolution

- Verified the KodaX 0.7.81 test package, then pinned the formal KodaX 0.7.82 release. Its
  active-Run admission resolves `afterRunId` first, reuses the Runtime-owned admitted Session
  context, admits interrupt without a
  canonical Session read, and queues after-turn work without rereading executable history.
- Observation callbacks advance their small active-Run and settings boundaries synchronously before
  ordered projection work. Observed active and idle states therefore avoid strict Session status
  without waiting on an unrelated RPC, while queued settings events cannot cause a stale no-op.
  Equal structured settings, including `shellExecution`, issue no redundant CAS write; a real
  revision conflict still reloads through the SDK.
- Bootstrap events join the ordered queue before optional Actor telemetry attaches, so a slow Actor
  read cannot expose and prematurely retire a false-idle observation.
- After-turn credential setup reads the fresh provider from KodaX 0.7.82's active-Run record. That
  endpoint now reuses cached Runtime admission and does not reopen canonical history for an active
  Runtime-owned Run.
- Exhausted, explicitly classified pre-handle boundary conflicts now return
  `{ accepted:false, reason:'session_data_changed' }` only for a renderer send that can restore its
  draft. Internally started/dequeued prompts retain the existing visible `session_error` path rather
  than failing silently.

### Files Changed

- `apps/desktop/electron/kodax/runtime-host-adapter.ts`
- `apps/desktop/electron/kodax/real-session.ts`
- `apps/desktop/electron/test/runtime-host-adapter.test.ts`
- `apps/desktop/electron/test/real-session-runtime-queue.test.ts`

### Tests Added

- Observed active and idle states avoid fallback Session status; a queued `run.started` event is
  immediately positive evidence even while its projection handler is blocked.
- Settings reuse the observed revision/value and structurally equal shell policy without a read or
  write, while a queued newer settings event prevents a stale no-op.
- After-turn submission obtains the provider from the SDK active-Run record instead of an
  unversioned Space cache.
- Runtime preparation conflicts and exhausted fresh-Run boundary retries (`data_changed` and
  `resync_required`) both return a factual draft rejection and no Session error.
- An internally started prompt reports its boundary failure instead of entering the renderer-only
  restored-draft path, and buffered Runtime events become visible before Actor bootstrap can block.
- KodaX's focused active-Run admission regression and the shipped 0.7.82 bundle prove interrupt and
  after-turn admission use the Runtime-owned context instead of canonical Session history.

## Issue 175: Safe close could reject an idle app after hiding it, then succeed only on a second close

- Priority: High
- Status: Resolved
- Introduced: v0.1.36 complete-exit / Windows daemon cleanup
- Fixed: v0.1.36 development with a KodaX test build exposing daemon-containment verification
- Created: 2026-08-06
- Resolution Date: 2026-08-06

### Original Problem

With no visible task running, the first close request hid the Space window. After a delay, Space
restored the window and reported that it could not close safely. Choosing Keep Open and closing a
second time often succeeded. The warning could list many unresolved managed children even though
their recorded roots had already exited.

### Root Cause

- Space hid its control surface before daemon cleanup was verified, so a fail-closed result looked
  like the application exited and reopened.
- Space treated daemon PID exit as its final proof. That could not prove the exact durable cleanup
  result or that Windows descendants were gone.
- KodaX correctly retained incomplete child-registry evidence when snapshot ancestry could no
  longer be proven. A daemon with many historical short-lived children could therefore fail strict
  final cleanup even though killing those old PIDs would be unsafe.
- After a successful rollback, the Runtime control plane was already closed. Reopening Coder
  admission in the same process was not a valid Keep Open recovery.

### Resolution

- Space waits for KodaX's exact `waitForRuntimeDaemonShutdown()` result before hiding its window and
  committing exit. The verifier combines the durable runtimeId/PID cleanup outcome with daemon and
  containment-supervisor exit, and reports replacement, failure, and unverified states explicitly.
- KodaX starts the Windows daemon suspended, assigns it to a kill-on-close Job Object, and resumes
  it only after assignment. Its supervisor exits only after the Job is empty. Under that kernel
  boundary, final cleanup may safely retire incomplete current-owner registry evidence without a
  bare-PID kill.
- Space requires the SDK-side verifier API, but does not make the connected capability a Session
  attachment requirement. An already-running legacy daemon may still restore Sessions; complete
  exit remains fail-closed until that daemon is explicitly stopped and relaunched under the Job
  boundary. The SDK never attempts an unsafe lock-only in-place migration.
- A failed cleanup keeps the window visible. If Runtime control was already committed closed,
  choosing Keep Open schedules a controlled application relaunch; if relaunch cannot be scheduled,
  Coder admission remains closed rather than pretending recovery succeeded.

The KodaX change resolves the daemon-owned slice only. It does not claim that KodaX Issue 256's
separate Worker owner-lease boundary is complete.

### Verification

- Complete-exit policy tests prove the window remains visible through verification and is hidden
  only immediately before a successful commit.
- Runtime adapter tests prove the exact owner/config/profile reaches the SDK verifier, failed
  durable cleanup requires recovery, and replacement-fence ambiguity fails closed.
- KodaX Windows Job tests prove pre-execution containment and descendant reclamation; verifier tests
  prove an exact durable success is insufficient while the containment supervisor remains alive.
- The real daemon start/restart/stop smoke proves both Windows supervisors exit at their respective
  shutdown boundaries. All work is confined to daemon startup and complete-exit paths; Session
  switching, transcript restoration, renderer streaming, and steady-state UI IPC are unchanged.

## Issue 176: Reactivating an invalidated active Session could duplicate or misplace its newest query and answer until Ctrl+R

- Priority: High
- Status: Resolved
- Introduced: v0.1.38 Session reactivation recovery
- Fixed: v0.1.38 release maintenance
- Created: 2026-08-06
- Resolution Date: 2026-08-06

### Original Problem

When several Sessions were running, switching away from an active Session and returning after its
history cache had been invalidated could show its newest query in an older turn, repeat the final
answer, or render the newest query-and-answer pair twice. Ctrl+R restored the correct order. The
canonical Session log and Runtime conversation page remained complete, distinct, and correctly
ordered.

### Root Cause

`revalidateNewestSessionHistory` already retained a resolved rendered page when a new open Run
overtook its history read, deferring canonical replacement until terminal convergence.
`restoreNewestSessionHistory` did not use that guard. Cache invalidation made the Shell choose the
restore entry point even though a resolved page was still painted, so an in-flight canonical copy
could be installed beside the same turn's live projection. The two renderer-owned copies could
then be paired or sorted independently. Ctrl+R cleared the live copy and rebuilt only from the
canonical source, masking the race.

### Resolution

- Reactivation retains an already-painted `ready` projection and reuses the existing open-Run
  deferral boundary. Cold activation still installs history immediately.
- `partial` and `ambiguous` conversation pages remain in the direct restore path so uncertainty is
  neither hidden nor retained as durable authority.
- Terminal convergence performs the existing single deferred newest-history refresh. The fix adds
  no polling, SDK request, content-based deduplication, or steady-state renderer work.

### Verification

- A regression test invalidates a resolved inactive page, starts an exact identified live turn,
  reactivates the Session while a stale canonical copy arrives, and proves the rendered query and
  answer remain single and ordered.
- The same test terminates the Run, refreshes canonical history, and proves the final query and
  answer each occur exactly once.
- The complete history-paging suite and TypeScript checks pass; existing partial and ambiguous
  recovery behavior remains covered.

## Issue 177: History reconciliation could duplicate a recovered answer or place compact notices after a later answer

- Priority: High
- Status: Resolved
- Introduced: v0.1.38 history/live and local-notice reconciliation
- Fixed: v0.1.38 release maintenance
- Created: 2026-08-08
- Resolution Date: 2026-08-08

### Original Problem

Two deterministic restore defects affected the rendered transcript while the persisted canonical
history remained correct:

- After a mid-stream Provider recovery, terminal reconciliation could append the abandoned live
  attempt and the successful retry to the canonical final answer. Ctrl+R cleared the live
  projection and temporarily restored the single canonical answer.
- When the newest bounded history page started with an assistant entry, restored `/compact` command
  and result notices could appear below that later answer. Reloading reconstructed the same order
  because both data sources were persisted.

### Root Cause

- A `stable_boundary_retry` starts a new Provider text attempt, but canonical/live folding compared
  canonical text against every live `text_delta`, including the abandoned pre-retry draft. With no
  valid prefix relation, the whole live projection was retained beside the canonical answer.
- A leading partial history page needs a hidden user owner for assistant/tool events. Its timestamp
  was taken from the first merged history item, which could be a local notice from the side store.
  The hidden owner then tied that notice and sorted before it, carrying the later assistant segment
  above both compact notices.

### Resolution

- Text and thinking reconciliation now projects only events after the last exact
  `mid_stream_text` / `stable_boundary_retry` boundary. Recovery diagnostics remain in the event
  stream, and an exact-entry live extension produced after the retry is still retained.
- Hidden history anchors now derive time only from canonical conversation items. Local notices keep
  their own side-store times and therefore remain before a genuinely later leading assistant.
- No global content deduplication or sort rule changed; both fixes are scoped to the provenance
  boundaries that made the previous ordering invalid.

### Verification

- Recovery regressions prove the abandoned attempt is removed, the canonical retry answer renders
  once after repeated authoritative reconciliation, the diagnostic event survives, and a proven
  post-retry live extension is preserved.
- A lifecycle regression advances the authoritative newest window past that recovered turn and
  proves its already-canonical live baseline cannot reappear at the transcript tail.
- A bounded-page regression starts with two compact notices followed by a canonical assistant and
  proves the hidden owner inherits canonical time and composes after both notices.
- The complete history replay suite passes. See
  [ISSUE_177_v0.1.38_REGRESSION_GUIDE.md](test-guides/ISSUE_177_v0.1.38_REGRESSION_GUIDE.md)
  for packaged-app acceptance coverage.

## Issue 181: Daemon Provider recovery could leave an abandoned answer attempt in the live transcript until Ctrl+R

- Priority: High
- Status: Resolved
- Fixed: v0.1.41
- Introduced: v0.1.38 daemon Runtime recovery projection
- Created: 2026-08-14

### Original Problem

After a Provider emitted assistant text and then recovered by retrying the same turn, the Space
conversation could show both the abandoned attempt and the successful replacement as one repeated
answer. Reloading with Ctrl+R restored the single canonical answer.

Expected behavior is that a recovery which replaces the current Provider attempt immediately
invalidates that attempt's provisional assistant and thinking text, while retaining the recovery
diagnostic and the successful replacement output. Live display, Session switching, observation
reconnect, terminal history reconciliation, and Ctrl+R must converge to the same transcript.

### Context

The npm Registry KodaX 0.7.87 Runtime already emits ordered `provider.recovery` events with
Session/Run/Turn/cursor identity and exposes the durable Session event journal through
`runtime.events.replay`. This issue is scoped to Space consuming those existing contracts; it does
not require a new SDK event, payload field, capability, or KodaX live-projection change.

### Root Cause

- The daemon Runtime adapter bridges `assistant.delta` into `text_delta` but drops
  `provider.recovery`, unlike the Embedded Coder path.
- The daemon live projection reducer appends every assistant/thinking delta and has no recovery
  invalidation boundary.
- The renderer's Issue 177 boundary is applied only while reconciling canonical history with live
  events, not while composing the pure live event stream.
- A newly opened Runtime observation hydrates text from the cumulative live snapshot without
  reconstructing the active attempt from the existing journal.

### Resolution

- The daemon bridge now projects the existing Runtime `provider.recovery` event with exact Runtime
  provenance and rejects malformed or transient-child variants.
- The daemon and renderer projections reset provisional assistant/thinking drafts only for recovery actions that replace the current
  attempt; do not clear pre-delta fresh retries or terminal `manual_continue` decisions.
- Active observation hydration reconstructs the current attempt from the existing Session event
  journal at the captured cursor, while retaining completed tool boundaries, journal prefixes,
  and all non-draft live state. If supplemental replay is missing, malformed, or unavailable,
  Space still installs the Runtime snapshot but does not publish a Run-cumulative draft as the
  identified current turn without a causal journal boundary.
- After an observation invalidation, renderer hydration replaces covered draft events with the
  recovered authoritative draft instead of appending it to the abandoned pre-disconnect attempt.
  Space-internal recovery and stable-checkpoint coordinates retain text/tool/text order without
  adding any KodaX contract.
- Renderer history reconciliation retains the recovery diagnostic at its causal boundary before
  canonical replacement output. Legitimate repeated text remains unchanged because no string
  deduplication is used.
- Root and Desktop now use KodaX 0.7.87. No KodaX SDK event, field, capability, or projector change
  was required. Automated regressions cover live retry/fallback/thinking recovery, daemon bridge
  isolation, active reconnect, history folding, cursor fencing, tools, and non-replacing actions.
- See
  [ISSUE_181_v0.1.41_REGRESSION_GUIDE.md](test-guides/ISSUE_181_v0.1.41_REGRESSION_GUIDE.md)
  for packaged-app acceptance coverage.

## Issue 182: A bounded newest page could pair an earlier live answer with the next query until Ctrl+R

- Priority: High
- Status: Resolved in source
- Fixed: v0.1.41 post-release maintenance
- Introduced: v0.1.34 history/live leading-page reconciliation
- Created: 2026-08-15

### Original Problem

In Session `20260815_095421_p88e3b8680f28a`, an interrupted review Run was followed by a
successful review Run and then the query `请提交并推送`. While the Session remained open, the final
query was rendered with the preceding Run's answer above it and older review output below it.
Ctrl+R immediately restored the canonical order. The persisted Session JSONL, Runtime events, and
canonical conversation cache were already complete and correctly ordered.

The deterministic trigger was a bounded newest page that began inside the successful review Run's
assistant/tool segment while an earlier interrupted live Run was still present in the renderer
baseline. The page also contained the later commit query and its answer.

### Root Cause

- The renderer keeps user owners and their event segments in parallel positional buffers.
- Leading-page reconciliation proved that the successful live review was the owner of the
  canonical assistant suffix, but did not account for an unrelated earlier live turn between that
  suffix anchor and its live owner.
- Folding or relocating only the matched review turn left the earlier live owner on the opposite
  side of the canonical boundary. `composeMessages()` then ordered user owners by `sentAt` while
  consuming event segments in buffer order, pairing each later answer with the wrong query.
- Ctrl+R cleared the live baseline and rebuilt solely from canonical history, which is why reload
  concealed the transient Space-side reconciliation defect.

This was not a timestamp collision, KodaX persistence-order defect, or missing SDK identity field.

### Resolution

- Leading-page stabilization now treats every earlier non-restored live turn and its complete event
  segment as one ordered prefix. If a later live suffix must reconcile with a canonical leading
  anchor, that earlier prefix moves atomically instead of leaving owners and segments on opposite
  sides of the boundary.
- For an exact suffix, the matching live owner stays after the durable anchor so the existing
  strong-identity fold removes that one duplicate projection exactly once. Ambiguous ordinal paths
  remain fail-open, but any prefix relocation preserves the same owner/segment lockstep.
- No global timestamp sort, content-based deduplication, polling, or KodaX SDK change was added.

### Verification

- A dedicated regression reproduces the real three-Run topology: interrupted A, tool-rich completed
  B, completed C, followed by a canonical newest page beginning inside B and containing C. It
  asserts strict `A -> B -> C` query/answer ownership and exact-once rendering of B.
- The complete history replay and history paging suites cover exact suffixes, ambiguous fail-open
  projections, retained ordinals, fork/rewind, terminal repair, and subsequent sends.
- See
  [ISSUE_182_v0.1.41_REGRESSION_GUIDE.md](test-guides/ISSUE_182_v0.1.41_REGRESSION_GUIDE.md)
  for packaged-app acceptance coverage.

## Issue 183: A successful no-retry Run could render both canonical and unacknowledged live copies until Ctrl+R

- Priority: High
- Status: Resolved in source
- Fixed: v0.1.41 post-release maintenance
- Introduced: daemon canonical/live reconciliation
- Created: 2026-08-15

### Original Problem

Session `20260815_094944_bo4d9a9bb19e31` rendered the final successful answer twice while the
Session stayed open. Ctrl+R immediately restored one copy. The affected Run had two assistant
blocks separated by tools and contained no Provider recovery.

The Runtime journal held one strictly ordered event lineage and the canonical conversation held
one copy of each assistant block. The duplication therefore existed only in Space's in-memory
composition of canonical history and optimistic live events.

### Root Cause

- An optimistic user owner can remain without `runtimeRunId` when its send acknowledgement is late,
  missed, or overtaken by observation/history reconciliation.
- A daemon terminal event and terminal snapshot carry authoritative `runId` and `turnId`, but Space
  previously required the optimistic owner to already carry the same `runtimeRunId` before it
  could bind that turn identity.
- Canonical history then had strong turn identity while the equivalent live owner remained
  anonymous. Strong-identity folding could not prove they were the same turn, so both projections
  were rendered. Ctrl+R removed the in-memory live projection and concealed the defect.

This was not Provider retry leakage, duplicate Runtime persistence, or a missing KodaX SDK field.

### Resolution

- Runtime-origin lifecycle events reconcile only an owner already bound to the same `runId` by the
  send acknowledgement. A start boundary, content, and terminal arriving beside an anonymous
  query are still positional evidence and cannot establish ownership across an observation gap.
- Legacy originless `session_start` delivery retains its positional compatibility repair; it cannot
  be confused with replayed Runtime lifecycle events because it has no Runtime origin.
- Full-snapshot and incremental-terminal paths may alternatively use the Run's authoritative
  `startedAt`: the unique owner must predate that boundary and its segment must contain same-Run
  content.
- Full snapshots reconcile the terminal Run and a concurrently active Run independently. Terminal
  changes explicitly target `lastTerminalRun`, so a newer active Run cannot shadow the completed
  owner.
- Ambiguous owners, missing send acknowledgement, terminals without authoritative `startedAt`, and
  delayed old start/content/terminal delivery remain fail-open. No content comparison, polling,
  synthetic SDK event, or KodaX change was added.

### Verification

- Regression coverage includes the observed multi-iteration successful turn, direct terminal
  events, full terminal snapshots, incremental terminal changes, a concurrently active next Run,
  multiple anonymous owners, canonical revalidation racing a new query, and delayed old
  start/content/event/snapshot terminals arriving before or after that revalidation.
- TypeScript, lint, focused transcript suites, and the complete repository test suite pass.
- See
  [ISSUE_183_v0.1.41_REGRESSION_GUIDE.md](test-guides/ISSUE_183_v0.1.41_REGRESSION_GUIDE.md)
  for packaged-app acceptance coverage.

## Issue 184: A continued managed Run could attach cumulative prior-turn output to the latest query, while an ambiguous compaction survived reload

- Priority: High
- Status: In Progress (Space projection fix in source; KodaX canonical compaction boundary pending)
- Introduced: v0.1.38 daemon live projection / KodaX 0.7.87 compaction
- Created: 2026-08-15

### Original Problem

Session `20260815_094944_bo4d9a9bb19e31` continued one managed Runtime Run through two delivered
interrupt inputs and therefore three root turns. During the latest turn, a large answer from the
preceding turn appeared after the latest query. Unlike Issue 182, Ctrl+R did not reliably repair
the display.

The Runtime event journal itself remained ordered by root `turnId`. The same Session then completed,
but its canonical conversation cache remained `ambiguous`, reporting
`compaction_boundary_invalid` and `compaction_predecessor_missing` for the automatic full-prefix
compaction committed during the third root turn.

### Root Cause

Two independent boundaries failed:

- Space projected `assistantTextByRun` and `thinkingTextByRun` as one cumulative Run draft. A
  continued managed Run can contain several root turns, but initial observation hydration attached
  that cumulative draft to the newest `session_start`. The live reducer reset drafts when the Run
  changed or terminated, not when a new root `turn.started` began inside the same Run. Reloading
  recreated the same wrong projection, so Ctrl+R could not fix it while the Run stayed active.
- KodaX committed a successful full-prefix compaction whose new boundary had no topology-proven
  predecessor and whose retained suffix conflicted with every predecessor branch. The canonical
  conversation therefore remained ambiguous after the Run terminated. Space cannot invent that
  missing durable order or safely delete one of the candidates.

This is not a timestamp collision, global sort defect, or a reason to deduplicate equal text.

### Space Resolution

- Observation replay now includes root `turn.started` and `thinking.finished` boundaries. Initial
  hydration reconstructs assistant/thinking drafts only from the active root turn instead of
  assigning a whole Run's cumulative text to that turn.
- A new root turn resets drafts, recovery checkpoints, tools, task state, and interactions even if
  an earlier `run.updated` event has already advanced the Run's public `turnId`. The reducer tracks
  draft ownership separately from Run status for this reason.
- An explicit next root `turnId` in a newer same-Run snapshot advances renderer ownership instead
  of being overwritten by the previous root identity.
- Transient child turn starts remain excluded, including the SDK's top-level child-context payload
  shape. Replay can establish draft ownership only from the current root boundary inside the
  captured snapshot's Session, journal epoch, and sequence cursor. Missing identity (including an
  active Run without a current `turnId`), future, foreign-epoch, malformed, or unavailable
  boundaries keep the observation available but omit the causally unscoped cumulative draft rather
  than displaying prior-turn output after the current query.
- Existing canonical/live reconciliation remains identity-based and fail-open. No content equality
  deduplication, timestamp sort, or synthetic transcript entry was added.

### Remaining KodaX Requirement

A successfully committed automatic compaction inside a continued managed Run must preserve a
topology-proven canonical boundary for all preceding user/assistant turns. After the Run terminates,
direct and paged canonical conversation must resolve to the same authoritative order. If that
boundary cannot be established, compaction must not replace the last resolvable canonical history.
Space needs no new public timestamp, sequence, visibility, or UI contract for this requirement.

### Verification

- Unit regressions cover cumulative old/current answer and thinking text, observation replay,
  `run.updated` overtaking `turn.started`, explicit same-Run root advancement, root/child isolation,
  missing/future/foreign-epoch/anonymous replay boundaries, replay failure, and current-turn
  continuation after reset.
- Existing Provider recovery, canonical/live reconciliation, paging, and Runtime observation suites
  remain green.
- See
  [ISSUE_184_v0.1.41_REGRESSION_GUIDE.md](test-guides/ISSUE_184_v0.1.41_REGRESSION_GUIDE.md)
  for packaged-app acceptance coverage.

## Issue 185: A delayed old Run terminal could close the current query while a Session-level notification reported another Run

- Priority: High
- Status: Resolved in source
- Fixed: v0.1.41 post-release maintenance
- Introduced: v0.1.38 daemon transcript / completion notifications
- Created: 2026-08-15

### Original Problem

Session `20260815_104533_f87ed64d76932c` displayed `Runtime run interrupted` beneath the current
query while also showing `Session done`. The current Run had in fact completed and its full answer
was already canonical; the interruption belonged to an older, explicitly stopped Run in the same
Session. The live view attached the old terminal to the current query and made the successful Run
look unfinished.

This is separate from KodaX's Actor settlement persistence defect. KodaX commit `70a030f2` fixes
that storage contract and advertises `actorSettlementConvergence:2`, but it cannot repair a
renderer that associates already-correct Runtime events by array position or Session alone.

### Root Cause

- The Runtime adapter preserved `runtimeId`, `runId`, `seq`, and terminal `turnId`, and the store
  refused to bind a delayed old terminal to a newer user owner. `composeMessages()`, however, still
  advanced one global event cursor and treated the first `session_complete` or `session_error` as
  the current user segment's boundary without checking its Runtime owner.
- Completion notifications remembered one active prompt per `sessionId`. Any later terminal in
  that Session deleted the active record and could settle the notification even when its Run/Turn
  identity belonged to older work.
- Space accepted `actorSettlementConvergence:1`, so a build could still attach to the daemon
  contract that KodaX replaced in the upstream persistence repair.

### Resolution

- Before positional composition, a Runtime event with a unique visible `runtimeRunId`/`turnId`
  owner is moved out of a foreign segment and rendered with that owner in original event order.
  Delivery markers remain positional so multi-prompt Runs still split correctly. Ambiguous and
  originless legacy events retain the existing fallback; duplicate-terminal bursts still consume
  only one segment.
- Completion tracking now records Runtime/Run/Turn identity from the live start. A foreign terminal
  neither clears the active prompt nor produces its notification; exact modern identity settles it,
  while fully originless legacy starts and terminals remain Session-compatible.
- Space now requires `actorSettlementConvergence:2` from both the installed SDK and connected
  Runtime and requests v2 during connection. This prevents a v2 Space build from silently reusing a
  v1 daemon. Release packaging still requires an npm package containing KodaX commit `70a030f2`;
  the currently published 0.7.87 artifact advertises v1.

### Verification

- Regression coverage reproduces canonical old output, a current Run start/content, a delayed old
  interruption, mixed identity-bearing/legacy current content, and the current successful terminal.
  The old error stays above the current query and current content retains causal order.
- Notification tests cover different Run, different Turn in one continued Run, exact-owner success,
  and originless legacy compatibility.
- Runtime compatibility tests require v2 and reject the previous v1 SDK contract.
- See
  [ISSUE_185_v0.1.41_REGRESSION_GUIDE.md](test-guides/ISSUE_185_v0.1.41_REGRESSION_GUIDE.md)
  for packaged-app acceptance coverage.

## Summary

- Total: 173
- Open: 1
- Ready: 0
- In Progress: 10
- Deferred: 0
- Resolved: 162
- High: 89
- Medium: 73
- Low: 11
- Next to resolve: 165
