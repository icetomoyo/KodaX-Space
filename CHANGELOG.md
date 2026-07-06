# Changelog

All notable changes to KodaX-Space will be documented in this file.

KodaX-Space is the Electron desktop client for the [KodaX SDK](https://github.com/icetomoyo/KodaX) — Claude Desktop-style interactive surface, GUI alternative to the `kodax` REPL.

> **Historical gap note**: this file 0.1.3 / 0.1.4 / 0.1.5 / 0.1.6 没有正式 section。
> 期间 ship 的 features (F019/F020/F021/F022 + F005 sidebar overhaul / F011 / F026 / F038 等)
> 见 `docs/FEATURE_LIST.md` 真理源 + `git log v0.1.2..v0.1.7`。本 v0.1.7 起恢复正常 changelog 流程。
>
> **v0.1.7 状态**：tagged 但**release 撤回**(installer 白屏 + sessions 加载 bug)。
> v0.1.7 内容 (F011/F023/F024/F026/F038) 跟 v0.1.8 一起发。GitHub Releases 顶部仍是 v0.1.5，
> 0.1.7 这条 section 留作历史记录、git log 引用入口。

## [Unreleased]

### Changed

- **Project license switched to KAI-FCL** - Current and future official KodaX-AI distributions for KodaX Space 0.1.27 and later use the source-available KodaX-AI Fair Core License (`KAI-FCL`) or accompanying customer terms when distributed with that notice. Historical tags, source archives, installers, or other copies already distributed with Apache-2.0 notices remain under Apache-2.0 for those specific copies; dependency license metadata is unchanged.

## [0.1.28] - 2026-07-06

### Theme

**React 19 upgrade + KodaX 0.7.61 SDK catch-up — with a packaged-build Terminal fix (node-pty) and bash-output-compression rendering, plus a full documentation refresh.**

This release upgrades the renderer to React 19, catches up to KodaX SDK `0.7.61`, surfaces the SDK's new bash-output compression in the tool cards, and fixes the built-in Terminal in packaged installers. Documentation was refreshed across the per-version feature docs, `FEATURE_LIST`, and a new Chinese user manual.

### Changed

- **React 19** - The desktop renderer and `@kodax-space/space-ui-kit` now run on React `19.2.7` / react-dom `19.2.7` (up from 18.3), with `@types/react` / `@types/react-dom` on 19.x and the UI-kit's React peer range widened to `^18.0.0 || ^19.0.0`. A small ambient `JSX`-namespace shim (`apps/desktop/renderer/src/types/react-jsx-compat.d.ts`) preserves the pre-19 global `JSX.Element` types the renderer relies on, so the upgrade is type-transparent to existing components.
- **KodaX 0.7.61 SDK catch-up** - Root and desktop workspaces resolve `@kodax-ai/kodax` `0.7.61`.
- **Smaller installer** - `.pdb` native debug symbols are excluded from the packaged bundle.

### Added

- **Bash output compression surfaced in tool cards** - When KodaX (`0.7.61`) compresses a bash tool's output, the tool card now shows a "compressed" marker with the filter(s) that applied, and — when the full raw output was saved to disk — a clickable link to open it. The recovery-hint boilerplate is stripped from the displayed result so the card stays clean.
- **Chinese user manual** - A new `docs/USER_MANUAL.zh-CN.md`, alongside a refreshed pass over the per-version feature docs and `docs/FEATURE_LIST.md`.

### Fixed

- **Built-in Terminal works in packaged installers** - `node-pty` and its conpty/winpty helper binaries are now shipped under `resources/node_modules/node-pty` on Node's runtime module path, instead of being left to electron-builder's native rebuild (which skips this workspace-only dependency and left the packaged Terminal unable to spawn a shell). `scripts/smoke-pack.mjs` now asserts the node-pty prebuilds are present in the built installer so this can't silently regress.

## [0.1.27] - 2026-07-05

### Theme

**KodaX 0.7.57 → 0.7.60 SDK catch-up — workflow engine + Workflow Harness GUI, license-gated repo-intelligence, sandboxed interactive HTML artifacts, multi-select `ask_user`, and a focus/confirm-dialog fix — plus portable-build and release hardening. (The Partner surface ships but is disabled behind a flag until its deliverable chain lands.)**

This release consumes the KodaX `0.7.57` through `0.7.60` SDK surfaces. It lands the workflow-engine wiring with a hard Coder-only spawn fence, restores workflow result notices in-place from the SDK transcript, gates repo-intelligence behind license activation (closing a `/workflow` bypass), and fixes the portable build so workflows are visible. The Partner three-column workspace is built as a capability-composed surface on the shared runtime (per [ADR-007](docs/ADR/ADR-007-partner-surface-model.md)) but is disabled (`PARTNER_ENABLED=false`) until complete. Reviewed by code-reviewer + security-reviewer before tagging; all HIGH findings were fixed.

### Added

- **Partner Sources** - Attach workspace files/directories to a Partner session; the agent reads them through a read-only `partner_source_read` tool that re-validates the Partner surface and matching `projectRoot` from the trusted run context on every read. New `partner.sources.*` IPC channels validate paths (control-char rejection, project containment via `resolveInsideProject` + `assertAllowed`).
- **Partner Knowledge Base** - A local, per-project persistent knowledge store (`partner-kb`) with dedicated tools, scoped by canonicalized `projectRoot` and persisted atomically to Space's data dir.
- **Partner agent profile** - Partner runs bind a distinct identity + tool-visibility policy via the SDK `agentProfile` surface (KodaX FEATURE_247); `run_workflow`/subagent-spawning tools are excluded from the Partner tool schema.
- **Multi-select `ask_user`** - The ask-user modal supports single- and multi-select questions with `min_selections` / `max_selections` bounds and an optional (`min_selections: 0`) mode (KodaX FEATURE_222), with schema-level consistency validation.
- **Interactive HTML artifacts** - A new `interactive-html` artifact kind renders in a sandboxed iframe (`allow-scripts` without `allow-same-origin`, `no-referrer`) behind an injected `default-src 'none'` CSP. External scripts are HTTPS-only and require SRI; the permission schema is enforced both at the renderer→main IPC boundary and inside the `create_artifact` tool handler.
- **Custom provider reasoning effort** - The custom-provider credential form can declare a reasoning-effort default, round-tripped through the provider config without dropping it on edit.

### Changed

- **KodaX 0.7.60 SDK catch-up** - Root and desktop workspace dependencies now resolve `@kodax-ai/kodax` `0.7.60`. Space maps its existing five effort choices to the SDK's canonical `effort` field at the real-session and workflow boundaries, and reads the KodaX config `effort` default before falling back to legacy `reasoningCeiling` / `reasoningMode`. Workflow host policy forwards `tokenBudget` unconditionally (0 = unlimited, treated as unbounded by 0.7.59+, no longer clamped to a 1-token run).
- **Workflow host limits** - The workflow policy section now exposes only runtime caps (max agents / concurrency / token budget, clamped to KodaX ceilings). Host-side natural-language workflow auto-start was removed in 0.7.58 — that decision now happens inside AMAW — and the Partner surface is fenced out of every workflow-spawn path (`assertCoderSurface` at the controller `start`/`create`/`rerun` methods, the `/workflow` slash command, and the trusted server-resolved surface at the IPC layer).
- **White-label manual topics** - Space Manual topics can be white-labeled per the KodaX `0.7.58` manual surface (FEATURE_221).
- **Built-in repo-intelligence diagnostics** - `/repointel status` uses the KodaX built-in repo-intelligence inspection API for worker/cache/mode diagnostics, and `/repointel warm` triggers the SDK's best-effort prewarm path for the current project.
- **Transcript artifacts derived incrementally** - Transient (transcript-only) artifacts are now maintained in a per-session store table updated on `create_artifact` results, instead of re-scanning the full event log on every streamed token in the always-mounted right sidebar (fixes an O(n²) hot path; matches the existing derived-table pattern).
- **Partner surface temporarily disabled** - The `[Partner]` surface tab is greyed out (`PARTNER_ENABLED=false`) until its end-to-end deliverable chain is complete; the underlying Partner code (profile, sources, knowledge base) ships but is not user-reachable this release. Re-enabling is a single flag flip.
- **Repo-intelligence gated behind license** - Repointel (`/repointel` status/warm and background repo indexing) now activates only under a valid license, aligning the feature with entitlement policy.
- **Workflow token-budget policy** - The per-run token budget defaults to `0` (unlimited) and only an explicit user cap is bounded, now to a `100,000,000` ceiling (was 200k); max agents (64) and max concurrency (16) ceilings are unchanged.

### Fixed

- **Confirmation dialogs no longer trap keyboard focus** - Native `window.confirm` steals the renderer's keyboard focus under Electron's `sandbox: true` and never returns it, leaving the composer unusable after confirming. All confirmation prompts (custom-provider delete, workflow run/saved-workflow delete, workflow preflight, project context-menu actions) now use the in-app `ConfirmDialog`, which returns focus to the composer on close. The dialog also renders above every other overlay (raised above the Settings modal) so confirmations triggered from within a modal stay visible and clickable.
- **Partner Sources / Knowledge Base i18n** - The Partner Sources panel and workspace toggles are now fully bilingual (en / zh-CN) instead of English-only.
- **Repo-intelligence trace compatibility** - `session.event` accepts the built-in repo-intelligence modes (`off` / `light` / `full`) while preserving older Repointel mode values for historical events.
- **Workflow transcript ordering & dedup** - Workflow notices keep chronological position (session messages carry real per-message timestamps again), live run progress (agent spawned / phase started) is no longer duplicated into the transcript (it stays in the right-sidebar live ticker), per-agent summaries dedupe to exactly one keyed notice per agent, and phase grouping is corrected. AMAW runs are restored after an app restart.
- **Workflow result notices restore in-place** - On reopen, a workflow run's result/failure notice is restored from the SDK transcript's `<task-completed>` synthetic message at its real position, instead of being re-merged from a side-store by wall-clock time — which mis-ordered or pinned notices to the top after SDK compaction flattens transcript timestamps.
- **Portable build shows workflows** - The portable executable no longer forks Space's data directory away from `~/.kodax` (the old `PORTABLE_EXECUTABLE_DIR` redirect left workflow state in an empty folder next to the exe while the SDK still read the real home, so sessions looked fine but workflows were empty). A new `KODAX_PROFILE_DIR` override keeps Space data and the SDK's sessions dir in sync.
- **GLM-5.2 context window** - KodaX `0.7.59` fixed the `resolveModelCapabilities` default-model bug (GLM-5.2 on coding-plan providers now reports its real 1M window); Space's runtime cascade already resolved this correctly and remains the source of truth.
- **e2e stabilization** - The language-switch spec asserts on the still-present "Workflow host" section (the autostart control was removed upstream); notifications-surface hover/geometry checks are hardened; provider-delete specs drive the in-app `ConfirmDialog`; workflow-events / token-budget expectations track the new behavior; and Partner-surface specs are skipped while `PARTNER_ENABLED=false`. Mock-turn-dependent specs remain skipped on Windows CI only (they stall under CI load), with Linux CI + local retaining coverage.

### Security

- **Partner workflow spawn fence (verified)** - Confirmed the Partner surface cannot spawn workflows/subagents: the controller-level `assertCoderSurface` gate, the `/workflow` slash guard, the server-side (non-renderer-forgeable) session surface at the IPC layer, and the Partner tool-visibility policy all enforce it, backed by a dedicated test.
- **Interactive HTML sandbox** - Scripted artifacts execute only in an opaque-origin sandboxed iframe (no `allow-same-origin`) under a strict injected CSP with HTTPS-only, SRI-pinned external scripts, so a hostile artifact cannot reach the host renderer, Node, or Electron APIs.
- **Repo-intelligence license gate (closed `/workflow` bypass)** - Repo-intelligence is a licensed capability; previously only the chat-turn path was gated, so the Workflow Harness (`/workflow`, Workflow Panel IPC, generate/revise/module launches — which build their own runtime context) gave unlicensed users full repo-intel on every workflow sub-agent. The controller launch path is now gated fail-closed, and all license checks (`real-session`, `version`, `ipc/repointel`, `slash/builtin`) fail closed on a license-subsystem I/O error rather than rejecting the handler or hanging the turn.

## [0.1.26] - 2026-06-27

### Theme

**Release hardening — Electron security pin + reproducible installs, with composer drag/drop completion, an optional sprite mascot, and desktop responsiveness/i18n polish.**

This release closes out the F107 SDK catch-up / F108 composer-file-reference batch and focuses on release readiness: Electron is pinned to a CVE-clean version while preserving the existing Linux compatibility floor (Debian 10 / glibc 2.28, which keeps 麒麟/Kylin V10 enterprise targets supported), installs are made reproducible (`npm ci` + exact-pinned native dependencies), and a round of UI/navigation/artifact hardening lands.

### Added

- **Sprite mascot mode** - The composer mascot now has a three-way mode (`legacy` / `sprite` / `off`, persisted) with a new pixel-sheet sprite renderer (see [ADR-008](docs/ADR/ADR-008-mascot-soft-rig-animation.md)). The previous on/off toggle is preserved as a backward-compatible view of the new mode.
- **Native clipboard image fallback** - Pasting an image with no usable text payload now persists the bitmap through the main-process clipboard sandbox and attaches it as an image artifact, reusing the OC-31 image path. Non-image `Files` paste interception is intentionally not added.

### Changed

- **Electron pinned to 42.5.0** - The desktop runtime is pinned to an exact, currently-supported Electron version. This keeps the documented Linux runtime floor at Debian 10 / glibc 2.28 (verified by Electron's own platform-support matrix across 33/40/42), so Kylin V10 (麒麟, glibc 2.28) and other enterprise Linux targets continue to run, while clearing the security advisories below. The esbuild main-process target stays aligned with the bundled Node runtime (`node24`).
- **Reproducible installs** - CI and release prefer `npm ci` (lockfile-exact, with an `npm install` fallback for resilience), a repo-level `.npmrc` enforces `save-exact=true`, `better-sqlite3` is exact-pinned (`12.11.1`) for native-ABI stability, and the lockfile is regenerated under the CI npm major so `npm ci` stays in sync across platforms. `scripts/pack.mjs` uses `npm ci` for the published-SDK swap and asserts that `package.json` / `package-lock.json` are not mutated during packaging.
- **Desktop responsiveness & i18n polish** - Shell, session picker, theme toggle, and bottom-bar layout adapt better to narrow widths, with added/aligned zh/en strings.
- **Smaller installers** - Trimmed the packaged bundle without changing behavior: `better-sqlite3` now ships only its runtime binding plus JS API (dropping ~44 MB of MSVC build residue — intermediate `obj`/`pdb`/`lib`, the sqlite amalgamation, and test artifacts; only `build/Release/better_sqlite3.node` is loaded at runtime), and only the `en-US` / `zh-CN` Electron locales are bundled instead of all ~55. The Windows installer drops from ~133 MB to ~118 MB, with comparable reductions on macOS and Linux. (This is the part of the 0.1.25 → 0.1.26 size jump that was avoidable; the rest is the Electron 33 → 42 security upgrade.)

### Fixed

- **Navigation guard exact-match** - Trusted main-process `data:` URLs (the boot splash page) are now matched against an exact allow-list instead of a `startsWith` prefix, removing a class of prefix-appended-payload bypass. Covered by a new `navigation-guards` test.
- **Artifact cross-session isolation** - The artifact store now rejects reusing an artifact id that belongs to a different session, preventing one session from appending versions to another session's artifact.
- **Media SDK cache invalidation** - A failed dynamic import of `@kodax-ai/kodax/media` no longer poisons the cache permanently; the next clipboard image operation retries the import.
- **Long session operations no longer time out** - `/delete`, `/fork`, and `/rewind` run without the composer IPC timeout so an in-app confirmation can take as long as needed without a spurious timeout failure.
- **Runtime diagnostics Escape close**, **shortcut-hint behavior**, and **right-sidebar popout e2e stability** are corrected.

### Security

- **Electron CVE pin (18 HIGH advisories cleared)** - Pinning Electron to `42.5.0` removes a set of known Chromium/Electron security advisories (use-after-free in permission/PowerMonitor/offscreen callbacks, renderer command-line-switch injection, HTTP response-header injection in custom protocol/`webRequest`, `clipboard.readImage` crash on malformed data, named `window.open` scope, ASAR integrity bypass, and more). `npm audit` reports 0 vulnerabilities. The advisory fix floor is Electron `39.8.5`; `42.5.0` was chosen as the currently-supported, already-shipped (v0.1.25) baseline, and it does not raise the Linux glibc floor.
- **Navigation guard tightening** - As above, the trusted `data:` URL check is now exact-match.
- **Artifact ownership guard** - As above, cross-session artifact id reuse is rejected.

## [0.1.25] - 2026-06-25

### Theme

**KodaX 0.7.56 SDK catch-up — image artifact source provenance and Kimi K2.7 Code coverage.**

This release resolves `@kodax-ai/kodax` `^0.7.56` and threads the new image-artifact source provenance through the composer and managed-session send path, refreshes Kimi K2.7 Code context-window coverage, and records the public SDK media helpers as Space-owned follow-up work.

### Changed

- **KodaX 0.7.56 SDK catch-up** - Root and desktop workspace dependencies now resolve `@kodax-ai/kodax` `^0.7.56`. Image artifacts carry source provenance (`clipboard` for pasted images, `drag-drop` for dropped images) through `inputArtifacts` instead of a hardcoded `user-inline` label, with the legacy default preserved for callers that omit it. Kimi K2.7 Code (256k) is added to the context-window fallback table, and the new public SDK media helpers are recorded as planned Space-owned follow-up for native clipboard fallback, GIF direct-path handling, file artifacts, and capability preflight.

### Security

- **File-picker source reserved, not yet wired** - The `file-picker` artifact source value is reserved in the schema but has no emitter; a documented guard requires any future file-picker flow to copy picked paths into the main-owned clipboard sandbox before send, so the existing path-traversal protection cannot be bypassed.

## [0.1.24] - 2026-06-24

### Theme

**Offline customer entitlement MVP, plus streaming-scroll, session-isolation, and queued-prompt fixes.**

This release adds an offline, signed license entitlement system for managed customer deployments (no telephone-home, no prompt for community/education/research/personal use), unlocks the transcript scroll during streaming, hardens session isolation across project switches, and clarifies the queued-prompt lifecycle in the composer.

### Added

- **Offline customer timebox entitlement (F105)** - Offline signed entitlement import/verification (Ed25519, build-embedded issuer key), managed-required mode driven by signed package policy, customer trial/timebox support with `issuedAt`/`expiresAt`, and license status surfaced in Settings / About / Diagnostics. Community, education, research, and personal use are never prompted for a license.

### Changed

- **KodaX 0.7.55 SDK catch-up** - Root and desktop workspace dependencies now resolve `@kodax-ai/kodax` `^0.7.55`. This upstream release is a concurrency-safety hardening patch for same-directory sessions: per-session scratch isolation, owner-scoped managed-task checkpoints, per-process extension-store temp writes, and stricter runtime tool gating. Space already passes stable session ids into `runManagedTask`, so no additional host API wiring is required for the baseline integration.

### Fixed

- **Streaming transcript scroll unlock** - During active streaming the transcript no longer feels locked to the bottom: a wheel/keyboard/touch scroll-up now disengages auto-follow immediately (bypassing the programmatic-scroll guard that streaming kept refreshing), and auto-follow re-engages only when the user returns to the bottom or clicks Jump to bottom.
- **Session isolation on project switch** - Switching projects unconditionally clears the current session and validates both surface and project before restoring one, so a session from a previous project can no longer leak into a newly opened project, even under rapid switching.
- **Queued prompt lifecycle UI** - The composer's queued-prompt add / cancel / promote states stay consistent between main and renderer, with no orphaned queued bubbles after history reloads or session errors.

### Security

- **License signature verification hardening** - Entitlement verification is Ed25519-only; the algorithm is derived from the pinned public key, never from the envelope, and the post-failure SHA-256 fallback was removed to eliminate an algorithm-confusion footgun. Verification is fail-closed on every error path.
- **Clock-rollback floor** - The clock-rollback guard now also enforces a stateless floor from the signed `issuedAt`, so a rolled-back system clock degrades the entitlement even if the user-writable rollback baseline (`state.json`) is deleted.

## [0.1.23] - 2026-06-24

### Theme

**Durable runtime preferences, KodaX 0.7.54 SDK catch-up, and composer file references — with a green CI baseline restored.**

This release makes the Plan / Accept edits / Auto selector a durable Space preference, brings Space in line with KodaX SDK 0.7.54, adds drag-and-drop file references to the composer, and folds in the review/hardening pass. CI (typecheck + unit + cross-platform e2e) is green again after a long red stretch.

### Added

- **Runtime defaults and mode persistence (F106)** - Plan / Accept edits / Auto and the Auto engine now persist as Space-owned runtime defaults; resumed sessions prefer a per-session runtime sidecar, then Space defaults, then a read-only `~/.kodax/config.json` fallback, then safe built-ins. A main-process resolver owns precedence and exposes value sources for diagnostics.
- **KodaX 0.7.54 SDK catch-up (F107)** - Dependency + GLM 5.2/4.7 refresh, learning inbox and ledger slash commands (`/learn pending|ledger|diff|approve|reject`, `/skill|workflow|memory pending`), session recovery preview (`/recover candidate|prompt|seed`), opt-in SDK extension discovery/runtime (`/extensions sdk [load]`), a Space extensions manual topic, and completed-turn learning lifecycle wiring.
- **Composer dropped file references (F108)** - Dropping files into the composer inserts safe `@relative/path` (in-project) or `file://` (external) references with removable chips; PNG/JPEG/WEBP also attach as inline image artifacts.

### Fixed

- **Mode selector responsiveness** - The bottom mode selector no longer holds its busy lock across the global-default persistence IPC, so rapid Shift+Tab cycling through Plan / Accept edits / Auto stays responsive.
- **Session runtime sidecar safety** - Per-session sidecar writes are serialized per session with unique temp files, reject colon session ids (Windows ADS), and preserve still-valid runtime fields when one field is invalid.
- **SDK extension runtime disposal** - Extension runtimes dedupe disposal via a per-runtime guard, avoiding double-dispose races on invalidation.
- **MCPB storage migration** - The legacy `~/.kodax-space` → KodaX-home migration copies to a temp dir and atomically renames into place, re-validating the destination stays inside the extract base.
- **Provider key rename hygiene** - Renaming a custom provider moves its key transactionally with rollback, and provider error messages no longer echo caller-supplied ids.
- **Session scope guards** - Sends and slash commands assert the expected project/surface so a stale renderer cannot drive a session in the wrong project after a switch.
- **Composer dropped-image dedup** - Dropped images no longer produce both a `file://` reference and an inline image artifact for the same file.
- **Continuous integration** - Restored a fully green CI baseline (typecheck + unit tests + Windows/Linux e2e).

## [0.1.22] - 2026-06-22

### Theme

**Provider trust-path patch: internal custom providers, per-session follow-up queue, and release hygiene.**

This patch keeps the v0.1.20/v0.1.21 baseline intact while fixing the custom-provider regression for trusted internal gateways, closing the cross-session follow-up queue risk found during review, and aligning release metadata for the next patch build.

### Fixed

- **Trusted internal custom providers** - The custom-provider form can explicitly skip URL safety checks for trusted internal HTTP/IP gateways, while the default path still enforces HTTPS and dangerous-scheme guards.
- **Config-provider compatibility** - Custom providers loaded directly from KodaX config keep the trusted path so existing internal provider entries continue to run as they did before the stricter UI validation.
- **Per-session follow-up queue** - User follow-up prompts no longer enter the SDK main-thread queue; Space stores them in a session-owned queue and starts the next prompt only after the same session's current turn settles.
- **Resume model/provider pairing** - Resumed sessions only reuse a configured model when it belongs to the selected provider, avoiding stale provider/model combinations.
- **Title sanitization source hygiene** - Escaped the control-character ranges used by title sanitization so the source file no longer contains an embedded NUL byte.
- **Ask-user bridge coverage** - SDK `ask_user_question`, select, and input prompts are wired through the Space IPC modal path.
- **MCP manager lifecycle races** - Hardened init, reload, and dispose paths against overlapping lifecycle operations.
- **Playwright single-instance isolation** - E2E launches now scope Electron `userData` to the `KODAX_TEST_ONBOARDING` sandbox before acquiring the single-instance lock, so Settings interaction tests can launch reliably beside an existing app or another test process.
- **Streaming spinner caret cleanup** - Removed the v0.1.16 streaming caret from the conversation tail so the Thinking spinner no longer shows a blinking cursor on the next line.
- **Streaming spinner frame stability** - Replaced the React timer-driven text spinner with a CSS comet spinner so streaming rerenders no longer throttle animation frames.
- **Diff popout loading path** - Diff opens with path-aware loading UI and races cached tool diffs with git file diffs so the first paint is no longer a long blank state.
- **Artifact transcript surfacing** - `create_artifact` results are promoted out of collapsed command clusters into a standalone clickable Artifact callout with right-panel focus and separate-window open actions.

### Changed

- **Version alignment** - Root, desktop, IPC schema, UI kit, lockfile, docs, and `space.version` capability contract are aligned to `0.1.22` / `space-v0.1.22`.
- **View menu appearance shortcuts** - The app View menu now exposes localized Theme (`Light` / `Dark` / `System`) and Visual Quality (`Minimal` / `Balanced` / `Full`) choices alongside the language switch.
- **Right sidebar expansion** - The right sidebar width toggle now balances against the current workspace width, so Artifact focus and review flows open into a readable panel without crowding the main transcript.
- **Build verification path** - `npm run typecheck` now builds workspace packages first so generated package artifacts are available before TypeScript checks run.
- **macOS packaging script** - macOS release builds pass explicit `--x64 --arm64` architecture flags.
- **Patch-lane planning** - `v0.1.22` is consumed by this provider/queue patch; `v0.1.23` and `v0.1.25` remain patch lanes, and `v0.1.24` remains the customer timebox entitlement MVP lane.

### Verified

- `npm run typecheck`
- `$env:SKIP_PTY_TESTS='1'; npm test`
- `npm run build:smoke`
- `npx playwright test tests/e2e/settings-modal-interactions.spec.ts`

## [0.1.21] - 2026-06-22

### Theme

**Patch lane release: workflow transcript recovery, release artifact resilience, and patch-lane reset.**

This patch release keeps the v0.1.20 feature baseline intact while fixing the highest-risk post-release issues found in workflow transcript recovery, Settings e2e stability, packaged keychain inclusion, and Windows release artifact fallbacks. It also formally opens the v0.1.21 patch lane and keeps planned feature work deferred to v0.1.26+.

### Fixed

- **Workflow transcript restore notices** - Restored completed workflow child summaries and final reports into the transcript after renderer reload, without turning workflow notices into user-message bubbles.
- **Workflow final report rendering** - Preserved readable markdown in workflow completion notices and kept final reports visible instead of collapsing them into one-line summaries.
- **Workflow manager history details** - Restored completed workflow runs now show their final summary directly in the manager detail pane before users expand the durable artifact body.
- **Workflow notice affordances** - Added stable footer controls/timestamps for workflow system notices so copied/restored workflow messages behave like other transcript entries.
- **Settings modal e2e stability** - Stabilized Settings tests with scoped selectors, a dedicated settings button test id, English e2e fixture language, and a more specific "Close settings" accessibility label.
- **Packaged keychain runtime** - Included `@napi-rs/keyring` and its native bindings in Electron packaging, unpacked native `.node` modules correctly, split macOS x64/arm64 release jobs onto matching runner architectures, and extended packaged smoke checks to fail if keychain runtime files are missing.
- **Windows release downloads** - Added zipped Windows release fallbacks so users can download `Setup.zip` / `Portable.zip` when direct unsigned `.exe` downloads are blocked.

### Changed

- **Version alignment** - Root, desktop, IPC schema, UI kit, lockfile, and `space.version` capability contract are aligned to `0.1.21` / `space-v0.1.21`.
- **Release notes pipeline** - Release notes now prioritize the matching `CHANGELOG.md` section, so tag-triggered GitHub Releases publish the curated changelog first.
- **Patch reserve planning** - `v0.1.21` ships as the first patch-only release; `v0.1.22-v0.1.25` remain reserved for patch-only releases, F103 Pinned Runtime Summary moves to `v0.1.26`, and planned 0.1.x feature lanes move to `v0.1.36-v0.1.39`.

### Verified

- `npm run typecheck`
- `npm run build:smoke`
- `npm run e2e:run -- tests/e2e/settings-modal.spec.ts tests/e2e/settings-modal-interactions.spec.ts tests/e2e/workflow-events.spec.ts`

## [0.1.20] - 2026-06-22

### Theme

**KodaX capability catch-up + Display Language MVP + release cohesion.**

This release closes the post-v0.1.19 continuity lane: Space now exposes KodaX SDK capability state more honestly, consumes the KodaX 0.7.53 host events, adds the Space-side CLI handoff receiver, and ships the first user-visible English / Simplified Chinese display-language switch. It also includes workflow UI recovery fixes and release-readiness hardening found during the v0.1.20 review pass.

### Added

- **F081 capability ledger and diagnostics** — Added `docs/KODAX_CAPABILITY_LEDGER.md`, extended `space.version` with KodaX SDK version/spec, capability contract, and degraded capability states.
- **F082 Repointel status and trace surface** — Added `repointel.status`, `/repointel status`, `/repointel trace`, and chip popover diagnostics. Standalone warm remains SDK-gated and is reported as such.
- **F083 Quick Ask continuity** — Quick Ask now captures temporary-session events locally and can promote a useful answer into a normal Coder session with provenance. True no-session `sideQuery` remains SDK-gated.
- **F084 Space-side handoff receiver** — Added handoff IPC, watcher push, titlebar inbox UI, accept/dismiss flow, stale/invalid handling, and session-id guarded cleanup for `~/.kodax/handoffs/*.json`.
- **F104 Display Language MVP** — Added persisted `languageMode`, effective-locale resolution, Settings language control, top-menu language switching, and English / Simplified Chinese coverage for menu chrome, Settings, sidebar headings, right-sidebar headings, provider settings, common modal/toast text, and frequent controls.
- **KodaX 0.7.53 host events** — `onSidecarMessage` now flows through typed `sidecar_message` events and renders verifier revise/blocked output as system notices; `onTodoDriftWarning` now flows through `todo_drift_warning` and raises session-scoped notifications.
- **Workflow management surfaces** — Added workflow capability channels, workflow management panel, workflow flow graph / pattern graph, workflow summaries in transcript, and persisted workflow history detail recovery.

### Changed

- **`@kodax-ai/kodax` 0.7.52 -> 0.7.53** — Space now consumes the 0.7.53 SDK baseline from both root and desktop workspace package specs.
- **Version alignment** — Root, desktop, IPC schema, UI kit, and lockfile versions are aligned to `0.1.20`.
- **Menu and Settings UX** — The custom titlebar menu now includes localized File/Edit/View/Help entries, a View > Language quick switch, and a non-transparent menu popup layer for readability over glass panels.
- **Provider settings localization** — Provider cards, custom provider form, key-state labels, and provider settings summaries now participate in Display Language MVP coverage.

### Fixed

- **Workflow lifecycle and history recovery** — Hardened workflow lifecycle IPC, restored persisted workflow history/detail rendering, kept workflow details after completion, stabilized progress UI, recovered workflow reports/artifacts, and hardened generated workflow rerun inputs.
- **Session completion notification replay guard** — Background completion notifications now ignore restored historical prompt timestamps and only notify for fresh live prompts.
- **Settings entry ambiguity** — The left sidebar footer now keeps `KodaX Space` as the app label and exposes `gear + Settings/设置` as one clickable settings button.
- **Menu popup contrast** — The titlebar menu dropdown now uses an opaque floating surface instead of a transparent/blurred layer that allowed underlying panel text to overlap visually.

### Security / Hardening

- **Shell and handoff IPC hardening** — Shell reveal/open-external and handoff file flows now have explicit tests around path allowlists, invalid/stale payloads, and destructive operations.
- **Provider guard closure** — The v0.1.18/v0.1.19 custom-provider SSRF/env-injection risk is closed by `apiKeyEnv` and `baseUrl` validation across Space custom providers, KodaX config providers, and connection tests.
- **Workflow path defense in depth** — Generated workflow run IDs are validated before controller filesystem joins.

### Planning Notes

- `kodax sessions dedupe` remains CLI-only for now; desktop exposure is deferred until session hygiene/doctor UX.
- 0.7.53 extension/MCP resume-state preservation is tracked under F090 rather than expanded into v0.1.20 scope.
- v0.1.21-v0.1.25 are intentionally left open for patch-only releases before the next planned feature lane.
- v0.1.26 planning lane now targets F103 Pinned Runtime Summary; the previous v0.1.26-v0.1.29 planned 0.1.x features move to v0.1.36-v0.1.39.

### Verified

- `node --test --import tsx/esm apps\desktop\electron\test\session-complete-notification.test.ts`
- `node --test --import tsx/esm packages\space-ipc-schema\test\settings.test.ts apps\desktop\electron\test\settings-store.test.ts`
- `npm test -w @kodax-space/space-ipc-schema`
- `npm test --workspace @kodax-space/desktop`
- `npm run typecheck`
- `npm run build:smoke`
- `npm run build:win`
- `npm run smoke:pack`
- `npm run smoke:boot`
- `git diff --check` (Windows LF/CRLF warnings only)

## [0.1.19] - 2026-06-18

### Theme

**修掉错误/取消后的会话历史错位 + popout 浮层掉位，并升 SDK。**

紧急维护版：收口会话终止事件，修掉「500 报错后历史气泡错乱、回复被甩到列表底部」与取消后界面卡顿；顺带兜回 F060 起 popout 浮层掉到输入框下方的回归。SDK 升到 `@kodax-ai/kodax` 0.7.52（OpenAI-compat provider 健壮性 + Node floor 20）。

### Fixed

- **终止事件单点收口** — SDK AMA 错误路径一轮会触发 `onError` + `onComplete` + 外层 catch 多次，naive 实现会往事件流塞多个终止事件，让 renderer 的 user↔event 段配对整体错位（错误挂错气泡 / 回复甩到列表底部）。改为每轮至多发一个终止事件：`onError` 仅暂存、`onComplete` 见暂存错误则不报完成、`session_error` 由 `emitTerminalError` 统一发（latch 去重 + 富文案 + retry 倒计时）；renderer `findSegmentEnd` 再兜一道并入连续终止事件。
- **取消即时反馈** — 点 Stop 立刻在本地 append 一个 `cancelled` 终止事件让 UI 马上停，`session.cancel` IPC 改 fire-and-forget；`appStore` 对同轮重复的 `cancelled` 去重；竞态下与 cancel 同时到达的 SDK error 落 main 日志而非无声蒸发。
- **popout 浮层定位回归** — `.glass`（裸规则 `position: relative`）级联压过 Tailwind `.absolute`，使 plan / diff 浮层退回文档流、掉到输入框下方；用 `!absolute` important utility 精准压回（仅此一处冲突，零波及其它 glass 面板）。

### Changed

- **`@kodax-ai/kodax` 0.7.51 → 0.7.52** — 维护版：OpenAI-compat provider 健壮性（forced `tool_choice` 在 5xx / 不支持参数时回退、重放前修复畸形 tool history）、Node runtime floor 抬到 20、跨平台 CI 测试清理。无新功能、无 LLM-facing prompt 变更。
- **workflow stop 本地兜底** — `WorkflowController.stop()` 在 lifecycle 未即时回执时，本地合成一个 cancelled 快照推给 renderer（running→cancelled / pending→skipped，重算 counts/progress），避免取消 workflow 后进度树停在旧状态。

## [0.1.18] - 2026-06-17

### Theme

**打通 KodaX CLI 自定义 provider。**

让 Space 直接识别并使用 KodaX CLI 在 `~/.kodax/config.json` 的 `customProviders` 里配置的自定义 provider（如 `newapi-anthropic`、`openrouter-*`），不必再在 Space 里重复添加。之前 Space 只认自己的 `~/.kodax/custom-providers.json`，CLI 配的 provider 在 Space 完全不可见。

### Added

- **读取 KodaX `config.json` 的 customProviders** — `loadKodaxCustomProviders()` 读取并归一化 CLI 配置中的自定义 provider；provider 列表、`session.create/setProvider`、`/provider <name>` slash 命令均识别该来源，并按需注册进 SDK runtime LLM registry。

### Changed

- **`registerKodaxCustomProviders()` 合并来源** — 同时注册 config.json customProviders + Space store 自定义 provider。
- **IPC `providerId` schema 放宽** — 接受 SDK 风格的 provider 名（字母/数字/`.`/`_`/`:`/`-`），main 端仍校验 provider 真实存在。

> ⚠️ **已知安全项（紧急发版未修）**：config.json 来源的 provider 的 `apiKeyEnv` 未经 `RESERVED_ENV_VARS` 黑名单校验、`baseUrl` 未经 `validateBaseUrl` SSRF 校验。后续版本补。

## [0.1.17] - 2026-06-17

### Theme

**凭据存储去 keytar 化 + 桌面级 UI 打磨。**

修掉一类隐蔽的启动崩溃（开发机系统 Node ABI 与 Electron 内置 Node 不一致时 keytar native 崩、拖垮 app），换成自带 prebuild 的 `@napi-rs/keyring`；外加 macOS 式自动隐藏滚动条、dashboard 与 titlebar 细节打磨。

### Changed

- **凭据存储 keytar → @napi-rs/keyring** — keytar 已 archived 停维护且走 node-gyp 源码编译，开发机系统 Node ABI 与 Electron 内置 Node ABI 不一致时会编出错 ABI 的 native 模块、`require` 即 native 崩（exit `0xFFFF7003`，try/catch 拦不住）。换成纯 N-API + Rust、各平台自带 prebuild 的 `@napi-rs/keyring`：装下来即匹配运行时，不走 node-gyp、不需构建工具、无 ABI 崩溃。keychain 封装逻辑零改动（动态 import + memory fallback + probe 全保留）。新增 `.nvmrc`（Node 20）对齐 Electron 内置 Node。
- **KodaX SDK 升级 0.7.50 → 0.7.51**。

### Added

- **macOS 式自动隐藏圆角滚动条** — 滚动时浮现、停止后淡出的圆角滚动条；dashboard 缩高、titlebar 按钮间距打磨。

### Fixed

- **主题 / 特效 titlebar 图标改用 Lucide 并彻底错开** — 消除两个图标"撞脸"。

---

## [0.1.16] - 2026-06-17

### Theme

**Workflow 支持链路 + 对话流全量交互动画。**

本版本把 v0.1.15 Workflow Harness 批次落地为可用 UI/事件/结果桥接，并补上 F068 对话流 motion layer：CSS-first、无新 runtime 动画依赖、复用视觉质量三档与 reduced-motion 门控。

### Added

- **F060-F066 Workflow Harness 支持** — main→renderer workflow 事件管线、进度面板、run 生命周期控制、workflow 库/启动/preflight、AMAW 自然语言自启与 Host policy、子 agent 活动遥测面、workflow 结果桥进 artifactStore。
- **F068 对话流全量交互动画系统** — 新增 `motion.ts` 单一配置源、`Reveal`/`Collapse` 通用组件、消息入场 stagger、timeline marker pop、工具/思考折叠动画、tool running→done 高光、复制脉冲、系统通知入场、流式光标与 jump-to-bottom 图标化反馈。

### Changed

- **Recharts v3.8.1 升级** — 将 renderer 图表依赖从 v2.15.4 升到 v3.8.1。
- **LiveCanvas artifact sandbox 暂时移除** — 移除不稳定的 LC 交互 sandbox tier 与 dev 自愈噪音，保持无 LC 依赖时 install/build/typecheck 可复现。
- **F068 文档与 feature tracker** — 新增 `docs/features/v0.1.16.md`，`docs/FEATURE_LIST.md` 链接到 v0.1.16 真理源。

### Fixed

- **F068 motion 无障碍门控** — CSS reduced-motion 现在以同等选择器 + `!important` 覆盖所有 F068 动画；WAAPI 完成高光在 JS 侧同步检查 `prefers-reduced-motion` 与 `q-minimal`。
- **F068 Collapse 可访问性** — 折叠态内容用 `aria-hidden` + `inert` 移出 accessibility tree 与键盘 Tab 序，避免视觉隐藏但仍可聚焦。
- **CSP theme bootstrap hash drift** — 同步 theme-bootstrap inline hash，避免 F060 Liquid Glass 预挂载脚本与生产 CSP 不匹配。

### Verified

- `npm run typecheck`
- targeted renderer ESLint for changed TS/TSX files
- `npm run build:smoke`

## [0.1.11] - 2026-06-17

### Theme

**Liquid Glass 视觉刷新 + Windows 启动/构建修复。**

视觉质量三档（极简 / 均衡 / 全特效）+ Apple Liquid Glass / visionOS 风格的光向描边、光标 specular 高光、分层柔影、作用域微交互；修复 Windows 下 dev 窗口不显示的根因；新增 Windows portable 构建；KodaX SDK 升 0.7.50。

> **Gap note**：[0.1.10] 未单独写 section（内容为 F056–F059 Artifact 子系统：数据层 / 生成 / Panel / 三级展示 / 导出），见 `git log v0.1.9..v0.1.10` + `docs/features/`。

### Added

- **F060 Liquid Glass 视觉质量档** ([2fb9420](https://github.com/icetomoyo/KodaX-Space/commit/2fb9420)) — minimal / balanced / full 三档，localStorage 持久化 + index.html 预挂载防闪。立体感来自光·影·材质而非运动：`.glass::before` 光向渐变描边（左上亮→右下暗）、`.glass::after` 光标 specular 高光（`useSpotlight` 写 `--mx/--my`，`pointer-events:none` 不挡点击 / 不移动布局）、分层柔影 `.lift` + hover 抬升、极淡 2 团 CSS 柔光背景；full 档中央阅读区半透明。
  - 性能护栏：`backdrop-filter` 仅用于静止 chrome（标题栏 / 侧栏 / 输入框 / 模态 / 命令面板 / Popout），对话滚动区绝不挂 `.glass`。
  - 标题栏 `✦` 下拉切档，浅色模式光标高光提亮可见。
- **F060 `.ix-zone` 作用域微交互** ([63ef180](https://github.com/icetomoyo/KodaX-Space/commit/63ef180) / [164d823](https://github.com/icetomoyo/KodaX-Space/commit/164d823)) — 容器标 `.ix-zone` → 区内所有 `button`/`[role=button]` 自动获 hover 浮起 + active 按下（纯 transform，GPU，无 JS）；`.no-ix` 豁免、`.ix-pop` 图标放大、`.monaco-editor`/`.xterm` 硬豁免。
- **F010 Windows portable 免安装单文件构建 target** ([66d61ca](https://github.com/icetomoyo/KodaX-Space/commit/66d61ca)) — electron-builder portable，随安装包一起出。

### Fixed

- **Windows 下 dev 启动 Electron 窗口不显示** ([0588f71](https://github.com/icetomoyo/KodaX-Space/commit/0588f71)) — 根因：`scripts/dev.mjs` spawn Electron 时 `windowsHide: true` 让 Windows 按隐藏方式启动 GUI 进程（窗口创建并 `show()` 但永不可见，DevTools 偶尔激活才带出来，误导成 GPU / 渲染 / 离屏问题）。仅对 Electron GUI 进程传 `windowsHide: false`（vite/esbuild console 进程仍 true）。`main.ts` 加 ready-to-show / did-finish-load / did-fail-load / 超时 多路兜底显示 + did-fail-load / render-process-gone 大声报错。
- **before-quit 子进程清理** ([6f6fffa](https://github.com/icetomoyo/KodaX-Space/commit/6f6fffa)) — 统一 `await` 四路 disposal（`Promise.allSettled`）+ watchdog（`.unref()`）+ `app.exit(0)`，消除孤儿进程残留。

### Changed

- **KodaX SDK 0.7.50** ([a2aa9b8](https://github.com/icetomoyo/KodaX-Space/commit/a2aa9b8) / [73d01f6](https://github.com/icetomoyo/KodaX-Space/commit/73d01f6)) — 0.7.50 上架 npm 后从本地 tarball 切到 registry `^0.7.50`（他机 `npm ci` 可复现，lockfile 锁 registry + integrity）。
- 构建链 typecheck 与 LiveCanvas 解耦 ([c356a6f](https://github.com/icetomoyo/KodaX-Space/commit/c356a6f)) — 仓库零 LC 依赖即可 install / build / typecheck。

## [0.1.9] - 2026-06-08

### Theme

**Multimodal input + smart popout director + Codex parity polish.**

合并 release: SDK 0.7.46 publish 解锁了 v0.1.8 的 tag 阻塞,本版本同时带 9 项新增。
**v0.1.8 不单独 tag** — 内容见下方 [0.1.8] section,功能同样进 v0.1.9 binary。

详细 design doc: [`docs/features/v0.1.9.md`](docs/features/v0.1.9.md)

### Added

- **OC-31 image paste 多模态输入** ([a0933f5](https://github.com/icetomoyo/KodaX-Space/commit/a0933f5)) — composer 直接粘贴 PNG/JPEG/WEBP 截图,缩略图 chip 在 textarea 上方,发送时 SDK 通过 `KodaXContextOptions.inputArtifacts` 拼成 multimodal content block 喂给 LLM。
  - 新 IPC `clipboard.saveImage` + `clipboard.cleanupSession`: app temp dir per-session 子目录,dir 0o700 / file 0o600
  - 6 MiB / 张 + 8 张 / turn 上限;decoded buffer 主进程二次 enforce 防 base64 编码 inflation 绕过
  - `assertArtifactPathInClipboardSandbox` 在 `session.send` 处校验 artifacts[].path 在 `<root>/<本次 sid>/` 之内,防恶意 renderer 传 `/etc/passwd` 让 SDK 读任意文件
  - 12 个 clipboard 单测 (sandbox / path traversal / mime / 0o600 mode / decoded size)
- **KX-I-02 Smart Popout Director** ([708a108](https://github.com/icetomoyo/KodaX-Space/commit/708a108)) — session events 首次出现 plan/diff/tasks 信号时**自动展开**对应 right popout,每 (session, kind) 一次。
  - 优先级 tasks > plan > diff;activePopout 非 null 不抢;用户手动开/关 popout 也 mark promoted (不打扰)
  - PreferencesPanel 加 toggle, lsKey `kodax-space.smartPopoutEnabled` 持久化
  - rules.ts pure function + 20 单测
- **Sidebar resize + 宽度持久化 (Codex parity)** ([d22c935](https://github.com/icetomoyo/KodaX-Space/commit/d22c935)) — 左/右侧栏可拖,默认 260/320 px,上下限 180-520 clamp,双击 reset,Esc 取消;aside 默认基础字号 [13px] 对齐 Codex 视觉。
- **F040 项目拖排 + Archived 折叠持久化** ([5cc44ed](https://github.com/icetomoyo/KodaX-Space/commit/5cc44ed)) — LeftSidebar 项目 row HTML5 DnD 拖排,`projectOrder` 持久化 lsKey;"Archived (N)" 折叠状态走 store + LS 重启保留;projectOrder 非空时仍 pin current 到最顶。9 reducer 单测。
- **F040 项目 session cap 8 + ProjectSessionPicker** ([a57df0e](https://github.com/icetomoyo/KodaX-Space/commit/a57df0e)) — sidebar 单项目默认显示 8 条,超出 "+N more" 弹覆层全量搜索;切到那条自动归属对应 project。
- **OC-29 unified Settings modal** ([7d5f459](https://github.com/icetomoyo/KodaX-Space/commit/7d5f459)) — 旧 SettingsPopover + ProviderSettings 合并到 2-tab modal (Preferences / Providers);切 tab 用 `hidden` 不 unmount,保留 in-progress 编辑;正确 ARIA tablist/tab/aria-selected。
- **OC-21 result-side ToolRegistry** ([5cb281a](https://github.com/icetomoyo/KodaX-Space/commit/5cb281a)) — tool result 区也走 registry,跟 v0.1.8 ship 的 input-side 对称;本版不注册内置 (零行为变更),纯留扩展位。
- **8 个 e2e 测试** ([d32808a](https://github.com/icetomoyo/KodaX-Space/commit/d32808a)) — settings-modal x2, sidebar-resize x2, project-reorder x3 + 1。13/13 e2e 全绿。

### Fixed

- **SDK 0.7.46 cross-project filter** ([23ffa5e](https://github.com/icetomoyo/KodaX-Space/commit/23ffa5e) / [d410032](https://github.com/icetomoyo/KodaX-Space/commit/d410032) / [304e638](https://github.com/icetomoyo/KodaX-Space/commit/304e638)) — SDK 0.7.45 listSessions fast-path 在 caller 不传 gitRoot 时 fallback 到 process.cwd → Space 只看到自家项目 session,KodaX 项目下数百 session 消失。
  - v0.1.9 三次迭代:`includeArchived: true` workaround → `before: '2999-...'` sentinel → SDK 0.7.46 storage.list 加 `this.hostCwd ?` 守门后撤掉所有 workaround,纯净调用
- **Markdown code block copy 按钮看不清 + 缩进闪烁** ([ee91e18](https://github.com/icetomoyo/KodaX-Space/commit/ee91e18)) — hover 出来对比度太弱;包 `M packages/...` 等纯文本被 rehype-highlight 误识别成 diff/perl 让第一行变粉红。copy 按钮 opacity-60 + border 常驻;detect:false 防纯文本误识别。
- **Release review HIGH** ([69ed136](https://github.com/icetomoyo/KodaX-Space/commit/69ed136)):
  - removeSession 漏清 `inputHistoryBySession / pendingSendBySession / sessionFlags`, long-lived 累积
  - ResizeHandle 拖动中 unmount, 3 个 window listener 不 detach → closure leak
- **setCurrentSession 不同步 currentProjectPath** ([f2310c9](https://github.com/icetomoyo/KodaX-Space/commit/f2310c9)) — 用户报: 在 KodaX 项目打开下点 KodaX-Space session, RightSidebar Changes/Working folder/ChipBar 仍指着 KodaX 显示错的 git changes。
  - Store action 兜底: 找 session 对应 projectRoot canonProjectRoot 比较, 不一致就同步 + 写 LS
  - 6 个新单测覆盖 sid race / projectRoot 空 / canon trailing slash 等边界
- **文件修改 tool 卡默认折叠 + RightSidebar 按钮太小** ([dd0b119](https://github.com/icetomoyo/KodaX-Space/commit/dd0b119)):
  - write/edit/multi_edit/str_replace/insert_after_anchor 默认 expanded=true, 卡片打开即看 diff 摘要;Monaco 大块保留二级折叠不影响性能
  - RightSidebar Section ⤢ 改 toggle: active 时换 × icon 再点关闭;w-5 h-5 大点击区 + hover 反馈;Unicode ⤢/⌃/⌄ 换 Lucide-style SVG (popout / X / chevron) 易辨
  - Shell 本地 activePopout ↔ store activePopoutKind 双向同步, 守门防回路

### SDK 升级

- `@kodax-ai/kodax`: `^0.7.45` → `^0.7.46`
  - FEATURE_219 真实 archive (archiveSession / unarchiveSession + SessionSummary.archived/projectKey)
  - listSessions cross-project bug 修了 (见上方 Fixed)
  - 自动迁移 flat → `<sessionsDir>/<projectKey>/<sid>.jsonl` per-project 目录布局,Space 透明感知

### Verified

- typecheck pass
- 553/553 unit tests pass (本版 +41: 12 clipboard / 20 director / 9 reorder)
- 13/13 e2e tests pass (本版 +8)
- build:smoke pass
- renderer-boot e2e pass (Linux CI leg)
- code-reviewer: 0 CRITICAL / 0 HIGH (本版 2 HIGH 已 fix)
- security-reviewer: 0 CRITICAL / 0 HIGH (image paste sandbox + cross-project list 都 clean)

## [0.1.8] - 2026-06-07 (released as part of v0.1.9 — see above)

### Theme

**v0.1.7 dogfood 修复 + polish + project menu + tool registry + permission batch.**

v0.1.7 broken release 后立刻锁回 main，累积 7 项工作 + 把白屏类回归装上 CI gate。
原本 v0.1.6 (F011 + F026 + F038) + v0.1.7 (F023 + F024) 计划的 ship 内容随本 release 一起发。

### Added

- **CSP inline-script hash** ([0169316](https://github.com/icetomoyo/KodaX-Space/commit/0169316)) — `apps/desktop/electron/csp-config.ts` 抽常量 `THEME_BOOTSTRAP_INLINE_HASH`，注入 prod CSP `script-src`。带启动期 drift guard 单测：动 inline script 忘改 hash → CI fail + 打印新期望值。
- **HelpOverlay 跨平台快捷键显示** ([95b151f](https://github.com/icetomoyo/KodaX-Space/commit/95b151f)) — `Mod`/`Alt`/`Shift`/`Meta` sentinel，按 `window.kodaxSpace.platform` 翻译。Mac 显示 ⌘/⌥/⇧，Win/Linux 显示 Ctrl/Alt/Shift。6 个 formatKey 单测。
- **Release pipeline renderer-boot last gate** ([108c434](https://github.com/icetomoyo/KodaX-Space/commit/108c434)) — `tests/e2e/renderer-boot.spec.ts` 用 launchSpace fixture + 4 个断言（no React error / no pageerror / `#root` 有 child / preload bridge 存在）。listeners 在 `domcontentloaded` 之前挂（抓 React #310 同步首屏崩）。release.yml ubuntu leg 跑，fail 拦 release job。
- **F043 项目级 contextmenu** ([0e929a8](https://github.com/icetomoyo/KodaX-Space/commit/0e929a8) + [1dbdaa2](https://github.com/icetomoyo/KodaX-Space/commit/1dbdaa2)) — 右键项目节点：Rename (inline edit) / Archive / Remove from Space。
  - 2 新 IPC：`project.recent.rename` + `project.recent.setArchived`；都走 `projectStore.assertAllowed` （path-probing 防御）
  - `archived=false` 时 omit 字段（清洁序列化）；Archived 项目折叠到底部 "Archived (N)" 分组，opacity-60
  - Inline rename：blur=cancel, Enter=commit (review HIGH 双 fire 已修)
  - Remove 走 confirm dialog 二次确认，body 明示"不动文件夹"
  - 11 个 ProjectStore 单测
- **OC-21 ToolRegistry** ([a6ec112](https://github.com/icetomoyo/KodaX-Space/commit/a6ec112)) — `bubbles.tsx` 的 `if (toolName === ...)` if-chain 重构成 registry-driven lookup。新工具加渲染只需 `registerToolInputRenderer(toolName, fn)`，不改 bubbles。
  - Renderer 是 pure function 返 `JSX.Element | null`，需要 hooks 的 renderer (multi_edit) 让返回 JSX 内嵌使用 hooks 的子组件
  - 内置 write/edit/multi_edit 通过 side-effect import 注册
  - 任意未注册工具走 raw-JSON collapse fallback（带 Show full / Collapse）
  - 7 个 registry 单测
- **KX-I-05 智能权限批处理 modal** ([57333c1](https://github.com/icetomoyo/KodaX-Space/commit/57333c1)) — 队列头部 ≥ 2 个同 session 非 danger 请求合并成 batch view。
  - 顶部 Allow all (N) / Deny all (N) + 每行独立 Allow/Deny 兜底
  - DANGER request 永远不入 batch（hard rule）
  - 答复用 Promise.all 并发；try/finally 防 IPC throw 让 busy 卡死（review HIGH 修）
  - 10 个 selectPermissionBatch 单测

### Fixed (v0.1.7 dogfood 收尾)

- **ProjectTree React Rules of Hooks 违例** ([a74fc02](https://github.com/icetomoyo/KodaX-Space/commit/a74fc02), GPT 协助诊断) — early-return 卡在 useMemo + useCallback 中间，第一次启动空 project 时不调后续 hooks，project 加载后 hooks 顺序变 → React error #310 → renderer 崩 → 白屏。修法：early return 挪到所有 hooks 后面。
- **dev.mjs Vite 5173 端口守卫** ([a74fc02](https://github.com/icetomoyo/KodaX-Space/commit/a74fc02), GPT 协助) — 旧 vite 进程占着 5173 时 wait-on 通过、新 vite 失败，electron 加载旧 server 的状态出现白屏。`isPortOpen` 预检 + 清晰错误 + Win PowerShell 帮助命令。
- **CI `SKIP_PTY_TESTS=1`** ([1ca85be](https://github.com/icetomoyo/KodaX-Space/commit/1ca85be)) — F011 PTY spec 在 GitHub Actions headless 环境（特别是 macOS）spawn 真 shell 不稳。CI 跳过这 8 个；本地 dev + smoke-pack + 用户实际运行验证。

### Diagnostics

- **`scripts/diag-sessions-load.mjs`** ([f94bc7a](https://github.com/icetomoyo/KodaX-Space/commit/f94bc7a)) — Playwright 启 prod build Electron 指向真 `~/.kodax`，读 zustand store 也调 IPC，dump JSON。Read-only 不动用户数据。任何 release 前一键确认 renderer 真起得来 + sessions 真路径不是占位 `/`。

### Acknowledged but not fixed in 0.1.8

- F042 NAPI native helpers — 仍 deferred 等真实性能数据
- F018 PRD 全集 Quick Ask / F015 Repointel warm API — 等 KodaX SDK 暴露
- 累计 LOW 项（z-index 不一致、a11y treeitem role、HelpOverlay 静态 array key 等）— polish pass 一次性收

### Pending before tag

- KodaX SDK 0.7.46 npm publish — listSessions fast-path 漏 `gitRoot` 字段 + hard cap 10 修复在源码已 ready 但还没 publish。Space 锁回 `^0.7.46` 后 bump + tag。

## [0.1.7] - 2026-06-06

### Theme

**Terminal + Preview + Command palette.** 把 v0.1.4 / v0.1.6 plan 里"等 SDK 出 X API 才能做"的
三条主线（真 PTY 终端、多 tab、富文件预览）一次性带上，并把命令面板顺带做了。同步解决 F018 vs F026
快捷键冲突 + 大幅 FEATURE_LIST 账本校准。

v0.1.6（F011 + F026 + F038）是内部里程碑，**不单独 tag**，合并进本 release。

### Added

- **F011 真 PTY 单 tab 终端** ([6844f1f](https://github.com/icetomoyo/KodaX-Space/commit/6844f1f)) — Terminal popout 从 "bash 工具历史 viewer" 升级为真 xterm.js + node-pty shell。
  - 4 IPC channels：`terminal.create` / `.write` / `.resize` / `.kill` + push `.output` / `.exit`
  - PtyHost 单例 Map<uuid, IPty>；UUID 服务端 mint，renderer 不能伪造
  - 跨平台 shell：Win cmd.exe / Mac+Linux $SHELL；renderer 不能注 arg
  - ENV 白名单（PATH/HOME/USER/TERM/LANG/Win 必备）：剥所有 `*_KEY` `*_TOKEN`，secret 不进 PTY
  - assertAllowed + fs.realpath 双层 cwd symlink-safe
  - SIGTERM → 3s grace → POSIX SIGKILL；Windows 走 conpty close
  - before-quit disposeAll 强杀防 zombie
  - 8 单测 spawn 真 shell 验证生命周期
  - hotfix [d984719](https://github.com/icetomoyo/KodaX-Space/commit/d984719)：xterm CJS 包让 vite 二次 reload 触发 renderer 白屏；改 lazy import + optimizeDeps.include

- **F023 终端多 tab** ([160fbb3](https://github.com/icetomoyo/KodaX-Space/commit/160fbb3)) — Tab bar + 多 PTY 并存。
  - 单 useReducer 管 tabs/activeId/counter；pure reducer 抽 `tabsReducer.ts`
  - 非 active tab 用 `display:none` 隐藏，PTY 保活
  - Terminal.tsx ResizeObserver 加 0×0 guard，防 hidden tab 收到 1×1 SIGWINCH 炸 scrollback
  - MAX_TABS=10 UI cap + main 端 IPC 硬上限双层防御
  - 关闭最后一个 tab 自动开新；关 popout 走顶栏 ×
  - 12 reducer 单测

- **F024 文件富预览 PDF / docx / xlsx** ([a570c37](https://github.com/icetomoyo/KodaX-Space/commit/a570c37)) — Preview popout 按 ext 路由。
  - 新 IPC `files.readBinary`：assertAllowed + resolveInsideProject + maxBytes 兜底
  - 3 个 lazy viewer，main bundle 不变（PDF 335KB / Docx 504KB / Xlsx 368KB chunk）
  - PdfViewer: pdfjs-dist 4.10 ESM; `isEvalSupported:false` + `disableAutoFetch:true` 硬化；DPI 上限 2
  - DocxViewer: mammoth → 自写 DOMParser allowlist sanitizer（tag/attr/href scheme 三层）
  - XlsxViewer: SheetJS CE → sheet_to_json → React 渲染 table，**不**用 sheet_to_html
  - 大小上限：PDF 50MB / docx 10MB / xlsx 10MB
  - 11 utils 单测 + 4 binary-read 单测

- **F026 ⌘Shift+P 命令面板** ([85d0bf5](https://github.com/icetomoyo/KodaX-Space/commit/85d0bf5)) — 全局快捷键召出模糊搜索。
  - 4 group 候选：Actions / Sessions / Files / Slash
  - JS fzf-lite scorer 抽到 `lib/fuzzy.ts`，FuzzyMatcher 抽象方便未来 F042 NAPI 替换
  - 多起点 scan + 连续匹配累计 ramp + boundary bonus；11 单测
  - 模块私有 `inputBridge` registry 替 window CustomEvent（消除 ambient injection cap）
  - 复用 `session.list` / `project.fileSearch` / `slash.discover` 三个已有 IPC，**0 新 channel**

- **F038 Sessions 持久化升级** ([c98d4ef](https://github.com/icetomoyo/KodaX-Space/commit/c98d4ef) + review fix [1003011](https://github.com/icetomoyo/KodaX-Space/commit/1003011)) — F033 in-memory → 接 KodaX SDK 0.7.42+ 持久化 API（共享 `~/.kodax/sessions/`）。
  - in-flight session 仍 in-memory，historical session 走 SDK 持久化
  - 解决 KodaX REPL 与 Space 之间 session 共享
  - review fix：process-level 锁 + SkillPathsConfig 类型

### Changed

- **F026 命令面板快捷键 ⌘K → ⌘Shift+P** — F018 Quick Ask 早就占了 ⌘K，两个 modal 抢同键会同时弹。
  让命令面板换到 ⌘Shift+P（VS Code/GitHub/Cursor 同款 muscle memory），⌘K 留给 Quick Ask（Linear/Slack 语义）。
  Cross-platform：`e.metaKey || e.ctrlKey` 已处理；HelpOverlay 同步加 2 行 hint。

- **FEATURE_LIST.md 账本校准** — 把"实际 ship 但状态写 Planned 的项"全部纠正：
  - **Completed (newly correctly labeled)**: F015 chip 部分 / F016 lineage / F019 主题 / F020 通知 / F022 auto-update
  - **Superseded**: F012 → F037 Subagent tree / F013 → F036+F039 MCP 管理
  - **Deferred**: F014 NAPI tokenizer → 并入 F042 / F017 CLI teleport 等 SDK
  - **Partial**: F015 warm API 缺 / F018 PRD 全集留 v0.1.8

### Fixed

- **F018 Quick Ask vs F026 命令面板快捷键冲突** — 两个 listener 都听 ⌘K 同时 fire；通过 F026 改键解决（见 Changed）。

### Deps

- `node-pty` ^1.0 (F011) — Win conpty + POSIX；asarUnpack `**/node_modules/node-pty/**`
- `@xterm/xterm` / `@xterm/addon-fit` / `@xterm/addon-web-links` ^5.5 / ^0.10 / ^0.11
- `pdfjs-dist` ^4.10 (F024)
- `mammoth` ^1.8 (F024)
- `xlsx` 0.20.3 from `cdn.sheetjs.com` (F024) — SheetJS CE 官方分发渠道；npm `xlsx` 包已 deprecated

## [0.1.2] - 2026-06-01

### Theme

**KodaX ecosystem wiring.** Surfaces 4 existing-but-hidden KodaX capabilities directly in the Space UI — repo-intelligence status, fork lineage, CLI peer discovery, and one-shot Quick Ask — plus adds a CI pipeline that runs the e2e suite on every commit.

### Added

- **`⚡ Quick Ask` popover** (F018) — press `Cmd/Ctrl+K` anywhere to open a centered modal, type a one-shot question, get a markdown reply, `Esc` to close. Uses an ephemeral plan-mode session so it can't accidentally write files or run bash. Reuses your current project's provider + model.
- **`● Repointel · <mode>` chip** (F015) — repo-intelligence status pill in the ChipBar showing the resolved SDK mode (`OSS` / `Premium (shared)` / `Premium` / `off` / `idle`). Click for the last 3 trace events with engine / latency / cache-hit metadata. Color-coded dot at a glance.
- **`🌳 Show lineage` in session menu** (F016) — keyboard shortcut `L`. Expands the session menu to show the full fork tree the current session lives in (root + all descendants), indented by depth, annotated with `@turn N` for each fork point. Click any node to jump to that session.
- **`Running · N` peers panel** (F017) — shows other live KodaX processes (CLI, other Space windows, REPL) at the top of the LeftSidebar. Click a peer with a sessionId to teleport into its conversation (read-only resume via SDK session storage). 10s polling + window-focus refresh. Auto-hides when there are no other peers.
- **GitHub Actions CI** — new `ci.yml` runs typecheck + unit tests + Playwright e2e on every PR and push to `main`, across Windows + Linux runners (~3 min each). The 5-spec e2e suite (~20s) now blocks regressions automatically.

### Changed

- **`@kodax-ai/kodax` pin bumped to `^0.7.45`** (now published on npm); the catalog reads provider-capabilities.json from the live SDK package.

### Fixed

- **S2 e2e false-fail on CI** — was asserting that the isolated data dir exists right after Space launches; Space mkdir's lazily on first write. The spec now triggers a `project.recent.add` IPC call and then asserts both the dir and `projects.json` exist — a stronger isolation-alive signal that works on clean CI runners.

## [0.1.1] - 2026-06-01

### Theme

**Stability + UX hardening.** First patch release after v0.1.0 — locks in user-visible fixes from real-world dogfooding, adds a Playwright e2e suite covering 5 critical flows, switches the provider catalog to the SDK as single source of truth, and bumps `@kodax-ai/kodax` to 0.7.45.

### Added

- **Friendly SDK error envelope** (OC-11): SDK exceptions now surface as user-readable categories (`rate_limit` / `auth` / `quota` / `network` / `model_unavailable` / `bad_request` / `server_error` / `cancelled` / `unknown`) with action buttons (`Retry` / `Provider settings`) instead of raw stack frames in the conversation stream.
- **Rate-limit retry countdown** (OC-23): when the provider sends `Retry-After`, the SystemNotice shows a live `Retry in 28s` ticker and disables the button until the window passes. Works for both `429` and `5xx` responses.
- **Single-instance lock** (OC-01): double-clicking the launcher brings the existing window forward instead of starting a duplicate process (which could race-write `~/.kodax/`).
- **IPC schema error truncation** (OC-09): Zod error envelopes now keep only `{path, code, message}` per issue, redact `invalid_enum_value` / `unrecognized_keys` messages that would otherwise embed user values, and binary-search-trim to 1KB max.
- **Test-isolation env var** (OC-12): setting `KODAX_TEST_ONBOARDING` redirects `~/.kodax` to `$TMPDIR/kodax-test-<id>` so e2e specs and onboarding tests can run without polluting real user data.
- **Per-code-block copy button** (OC-25): hover any fenced code block in markdown to reveal a `📋 copy` button.
- **StashNotice realtime refresh**: the "uncommitted changes" bar in BottomBar now refreshes on window focus, visibility change, and every 30s — picks up external `git commit` immediately without re-selecting project.
- **Zero-config provider auto-activation** (KX-I-01): on first launch, if any provider API key env var is set (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / etc.), the corresponding provider is auto-set as default — no Settings detour needed.
- **Playwright e2e suite (5 specs)**: first-launch UI, isolated data dir, send-prompt + mock-reply roundtrip, Shift+Tab mode cycle, and `/clear` slash command. Runs in ~20s on Windows; foundation for future regression coverage. `npm run e2e` / `npm run e2e:headed`.

### Changed

- **Provider catalog reads SDK truth** (`provider-capabilities.json` directly), with a hardcoded fallback so a broken `npm link` no longer crashes the main process. Future KodaX upstream provider additions propagate automatically on the next launch.
- **Markdown rendering perf** (OC-19): module-level LRU cache (cap 500) + `React.memo` on the Markdown component — re-renders of stable content (theme switch, history scroll-back) drop from 10-30ms to near-zero.
- **Auto-scroll guard** (OC-18): the conversation stream no longer false-detects "user scrolled up" during its own programmatic scroll animations (400ms guard using `performance.now()`).
- **Conversation layout**: Claude Desktop-style two-level tool cluster (`Ran 6 commands ⌄ → sub-cluster → individual tool call`), left-aligned narrow user pill, drop the `<bubble>` wrapper around assistant markdown, rose-pill inline code styling.
- **Tool card colors are status-driven** (was tool-kind based): bash success no longer reads as "error" because of a red body. Card body = `done`/`running` status color; tool kind moves to the tool name text color.
- **Provider env name updates** (KodaX upstream sync from `0.7.45`-line). `@kodax-ai/kodax` published-version pin stays at `^0.7.42` until `0.7.45` lands on npm; local dev uses `npm run link:kodax` to get the upcoming version.

### Fixed

- **Provider env name drift**: 5 coding-plan providers (kimi-code / zhipu-coding / minimax-coding / mimo-coding / ark-coding) had outdated env var names. Now mirrored from KodaX SDK.
- **PermissionModal "Always allow" UX**: was a checkbox + Allow-once button (two clicks); now a third dedicated button. Danger-class commands hide the Always button (cannot silently whitelist).
- **auto[LLM] mode double-prompting**: broker no longer pops permission modals for non-dangerous tools in `auto` mode — lets the SDK guardrail (F030) own that path. Dangerous tools (rm -rf etc.) still pop the modal.
- **skill.discover / mcp.discover from historical sessions**: switched from requiring a live SDK session to taking `projectRoot` directly. Recents-restored sessions no longer throw `session not found`.
- **Model selection persistence**: last-used model now persists across reloads via localStorage.
- **Stop-confirm toast contrast**: light-mode toasts had dark-on-dark text; all 4 tones now dual-themed.
- **Inline copy icon visibility**: replaced the near-invisible `⎘` Unicode glyph with an inline Lucide-style SVG icon.

### Security

- **API keys cannot leak via IPC error envelopes** (OC-09): Zod `invalid_enum_value` / `unrecognized_keys` issue messages — which embed the user's raw value in the template — are now redacted before flowing through the IpcError `details` field.

### Known limitations

- **`@kodax-ai/kodax@0.7.45` not yet on npm**: published-version pin stays at `^0.7.42` for installable CI/release builds. OC-23 retry-after extraction uses `parseRetryAfter` / `extractHeadersFromError` from the SDK's `/llm` subpath — if the installed SDK lacks them, `extractRetryAfterMs()` catches the load failure and returns `undefined`, gracefully degrading to a plain Retry button (no countdown). Local dev uses `npm run link:kodax` to point at the bleeding-edge KodaX repo.
- **`change_model` / `check_network` action buttons** in error notices: text tells you what to do, but the action buttons themselves are not wired yet (followups OC-37 / KX-I-02).

## [0.1.0] - 2026-05-30

### Theme

**First public release.** Claude Desktop-shape conversational shell wrapping `@kodax-ai/kodax` v0.7.44 with full coverage of the SDK's user-facing surface: streaming conversation, tool call visualization, multi-provider key management, permission gating, AGENTS.md context loading, skill + markdown-agent invocation, MCP server lifecycle, session fork/rewind/history, and rich at-input pickers (`/slash`, `@path`, `@agent`). Cross-platform distribution packages for Windows / macOS / Linux via the GitHub Releases page — unsigned in v0.1.0 (signing tracked as FEATURE_027 for v0.1.5+).

### Added

#### Conversation experience

- **Streaming response UI** — text deltas + thinking deltas + tool call cards composed into a Claude Desktop-style bubble flow; markdown rendering with code fence syntax highlighting via `rehype-highlight`
- **Tool call cards** with status icons (running / done / error), expandable input + result with diff awareness, "Ran N commands" aggregation for consecutive tool calls
- **Message footer**: always-visible relative time (`6h ago`) + copy button (icon + on-hover label) on every user / assistant bubble
- **Activity spinner** with real-time status string (`Thinking…`, `Writing…`, `Running tool…`, `Verifying…`, `Compacting context…`), elapsed seconds, iteration counter `iter N/max`, cumulative tokens + tokens/s rate, character count for thinking + tool input partial JSON
- **History restore on session click**: pulls persisted conversation from SDK storage and replays it as `text_delta` + `thinking_delta` + `tool_start` + `tool_result` events. Loading skeleton during the IPC wait. Hover-prefetch on Recents items warms the LRU cache
- **Race-safe history prepend**: if a user sends a new prompt while history is loading, the historical messages are atomically prepended rather than appended — order stays correct

#### Slash commands (11)

- `/mode <plan | accept-edits | auto>` — switch permission mode (Ctrl+M cycles)
- `/auto-engine <llm | rules>` — switch auto-mode classifier (LLM SideQuery vs rule-based)
- `/model [name | default | list]` — set / clear model override; lists provider models with current marker and "did you mean" suggestion on typo
- `/provider <id>` — switch provider mid-session
- `/reasoning <off | auto | quick | balanced | deep>` — reasoning depth ceiling
- `/thinking <on | off>` — toggle thinking output
- `/clear` — clear conversation buffer (session retained)
- `/help` — list all registered commands
- `/memory` — open Agents popout in Edit mode for `~/.kodax/AGENTS.md` or `<project>/AGENTS.md`
- `/compact` — request context compaction on next turn (spike `contextTokenSnapshot.currentTokens` to force SDK trigger)
- `/cost` — show estimated token usage / cost (renderer-side aggregation)
- `/tree` — show session fork lineage tree
- `/history` — list user messages in current session
- `/agent-mode <ama | sa>` — switch agent orchestration mode
- `/copy` — copy last assistant message
- `/new` — create new session
- `/repointel` — RepoIntelligence trace inspection
- `/doctor` — provider diagnostics (key configured + HTTP probe + latency)
- `/status` — list sibling KodaX peer instances (other Space windows / CLI / REPL)
- `/review` — pull `git diff HEAD` and insert a structured review template into the input box

#### Input box affordances

- **`@path` file autocomplete** — Tab/Enter to accept, ↑↓ to navigate, Esc to dismiss. Backed by `project.fileSearch` IPC with 30s cache; ignores `node_modules` / `.git` / `dist` etc; alphabetical ranking with basename hits prioritized
- **`@agent` markdown agent picker** — button next to attach menu lists user-level + project-level agents from `~/.kodax/agents/` and `<project>/.kodax/agents/`; click inserts `@agent-name ` at caret
- **`/slash` command picker** — fuzzy-filter popover, Tab/Enter accept, arg hint per command
- **Input history** — ↑/↓ navigation through previous prompts (per-session, in-memory)
- **Auto-grow textarea** up to 12 rows
- **Ctrl+F** transcript search with ring highlight + ↑↓ match navigation
- **Ctrl+\\** focus mode (hide both sidebars)
- **?** help overlay

#### Status surfaces (above input)

- **NotificationsSurface** — persistent inline notices (auto-mode engine fell back to rules etc), dismissable per-id
- **StashNotice** — git working tree dirty indicator (`● Uncommitted: 3 modified · 1 staged on main`) with debounced refresh on write/edit/bash tool results
- **RetryBanner** — provider 429 / overloaded / recovery countdown timer; reads `retry_after` + `provider_recovery` session events
- **AmaWorkStrip** — active AMA worker title + harness profile + round number + child fanout count + budget approval flag
- **BackgroundTaskBar** — chip strip per subagent worker with status icon (progress / completed / notification / warning)
- **QueueIndicator** — KodaX SDK MessageQueue snapshot badge (hidden when empty); popover with All / Prompts / Tasks / System filter tabs

#### Provider management

- **13 built-in providers**: Anthropic, OpenAI, DeepSeek, Kimi (Moonshot), Kimi for Coding, Qwen (Alibaba), Zhipu, Zhipu Coding Plan, MiniMax Coding, MiMo (Xiaomi), Volcengine Ark Coding, Gemini CLI, Codex CLI
- **Custom providers** (Anthropic-compat / OpenAI-compat) via UI; persisted to `~/.kodax/custom-providers.json` (shared with KodaX CLI)
- **OS keychain integration** (keytar): macOS Keychain / Windows CredMgr / Linux libsecret with in-memory fallback warning when libsecret missing
- **Shell-exported API keys** auto-detected at startup (ANTHROPIC_API_KEY / KIMI_API_KEY / ARK_API_KEY etc) — no double-config required
- **HTTP probe** ("test connection") for each provider before relying on it
- **SDK-driven context window indicator** — pulls per-provider per-model context size via `resolveContextWindow`, falls back to renderer hardcoded table when SDK unavailable
- **Auto-injection of keys** to `process.env` on default-provider change and on add/remove
- **Custom providers from `~/.kodax/config.json`** registered into SDK runtime at startup (shared with `kodax` CLI's `/provider <name>` flow)

#### Permission system (FEATURE_029)

- **Canonical 3-mode** matching KodaX REPL: `plan` (deny mutating tools) / `accept-edits` (auto-allow edit/write, gate bash/network) / `auto` (AutoModeToolGuardrail)
- **Auto-mode sub-engine** (`llm` LLM classifier / `rules` AGENTS.md + auto-rules.jsonc)
- **Denial threshold fallback**: 3 consecutive denies → auto switches `llm` to `rules`
- **Circuit breaker**: 5 LLM-classifier errors / 10min → auto fallback
- **Always-allow rules** persisted to `~/.kodax/auto-rules.jsonc` with pattern matching at broker layer
- **Risk assessment**: tool name + input keys scanned for dangerous patterns (rm -rf, sudo, fork bomb, etc); typed-confirm modal for high-risk tools
- **Plan mode hard-block** via `planModeBlockCheck` predicate passed to KodaX runtime; `exit_plan_mode` LLM-initiated escalation **always rejected** (user must manually switch mode)

#### AGENTS.md context

- Loader walks `~/.kodax/AGENTS.md` + `<project>/AGENTS.md` (KodaX SDK `loadAgentsFiles`)
- Popout viewer with file tab switcher + Edit mode (textarea + Save / Cancel + character counter)
- Create Global / Create Project buttons appear when respective scope is absent
- Atomic writeback (tmp → rename, 0o600 perms)

#### Skills + markdown agents

- Skill discovery from `~/.kodax/skills/`, `<project>/.kodax/skills/`, plugin paths, builtin paths
- Slash popover lists user-invocable skills alongside built-in commands
- Skill invocation via SDK `SkillRegistry.invoke` returning resolved prompt → injected into conversation
- **`!`cmd`` dynamic context** routed through Space's permission broker (each shell command requires user approval; shell-spawn with PATH-only env, 30s timeout, 1MB stdout cap)
- **Markdown agent discovery** (FEATURE_197) from `~/.kodax/agents/*.md` and `<project>/.kodax/agents/*.md`; provenance dots in picker UI + failed-file banner

#### MCP server lifecycle

- Read-only listing (`mcp.discover`) of servers from `~/.kodax/config.json` + `<project>/.kodax/config.json` with merge precedence
- Manager singleton (`mcp.servers`) exposing runtime status (idle / connecting / ready / error / disabled) + tool / resource / prompt counts + lastError + cachedAt
- Start / Stop buttons per server; lazy-connect on demand
- Expandable Tools list per server (capability descriptors with id + name + description)
- Reload config (dispose + reconstruct manager) for live edits to `~/.kodax/config.json`
- Concurrent-init race protection via in-flight promise guard
- Dispose hook on app quit (stdio transport children released)

#### Session management (FEATURE_033 + FEATURE_038)

- **Fork**: branch from any turn into a child session (in-memory metadata + disk lineage via SDK `forkSession`)
- **Rewind**: roll back active entry; renderer truncates event buffer
- **Delete**: graceful in-flight cancel + disk delete
- **Rename**: inline edit (double-click session title)
- **In-memory + persisted unified view**: `session.list` merges live and disk sessions; on-click resume loads disk via lazy `tryResume`
- **/status** command lists sibling KodaX peer instances (multi-window awareness via SDK `listRunningSessions`)

#### Welcome dashboard

- Sessions / messages / tokens / streak / heatmap stats
- 26-week activity heatmap (today-anchored, no trailing column bug)
- Favorite model with provider sub-label
- 30-day commit bar chart per project
- Git stats per project (commits / files changed / lines added/deleted / contributors / current branch)
- Tabs: Overview / Models / Project

#### Diagnostics

- **FileTracingProcessor** opt-in via `SPACE_TRACE_DIR` env (writes JSONL spans for offline analysis)
- **Application menu**: View (Reload / Toggle DevTools / Zoom / Fullscreen) + Window (Minimize / Close); DevTools no longer auto-opens (opt-in via `SPACE_AUTO_DEVTOOLS=1`)
- **Themes**: dark / light / system (Ctrl+Shift+T cycles), synced to OS titlebar overlay on Windows
- **Hover-prefetch** of session history on Recents items
- **Plan-mode auto-toggle** of right sidebar based on todo list state

#### Platform packaging (FEATURE_010)

- **Windows**: NSIS installer (`KodaX-Space-Setup-${version}.exe`)
- **macOS**: DMG for x64 + arm64 (universal-build via electron-builder)
- **Linux**: AppImage (portable) + deb (apt-installable)
- **Auto-update manifests** (`latest*.yml`) uploaded as release artifacts; no update server configured in v0.1.0
- **Cross-platform smoke check** (`smoke-pack.mjs`) validates installer existence, size cap (< 200MB), and asar contents

### Fixed

Pre-release internal review cycles addressed across ~20 review batches; representative items included:

- Atomic `prependSessionHistory` store action eliminated history-restore race that re-ordered messages when user sent during IPC wait
- StashNotice tool-result scan continues past non-write tool results instead of early-exiting at the first one
- AtPathPopover Esc actually closes (dismissed-key state tracks per `@token`)
- AtPathPopover 120ms debounce on per-keystroke `project.fileSearch` IPC
- Project file walker explicitly skips symlinks to prevent monorepo cycle infinite-loop
- McpManager concurrent-init race wrapped with in-flight promise guard
- RetryBanner countdown actually decrements (was recomputing `retryAt` per render)
- Skill `!`cmd`` dynamic context routed through Space permission broker instead of blanket refuse; shell-spawned with PATH-only env + 30s timeout + 1MB stdout cap
- WelcomeDashboard decoupled from `eventsBySession` (subscribes to derived `tokensBySession` slice) — background streaming no longer triggers full dashboard recompute
- `loadKodaxUserDefaults` cached at module level (was hit on every `session.list` call)
- `loadPersistedSession` 5-entry LRU cache with auto-invalidation on fork / rewind / delete
- Main startup `hydrateShellEnv` + `probeKodaxSdk` + `probeSkillRegistry` parallelized (saves 300-800ms to window-visible)
- Cancel button force-emits `session_error` so spinner doesn't hang
- Restored sessions ref moved to module-level Set (survives HMR / Shell remount)
- `/model` autocomplete with did-you-mean + truncated display for large model lists (OpenRouter-style 200+)
- `project.gitDiff` distinguishes "no changes" from "git command failed" via explicit `error` field

### Known limitations

- **No code signing**: Windows SmartScreen and macOS Gatekeeper will warn on first launch. See the release body for documented workaround. Signing tracked as FEATURE_027 for v0.1.5+.
- **No auto-update server**: `latest*.yml` manifests are uploaded but no update server is configured. Users must manually download the new release for upgrades.
- **No PTY terminal**: TerminalPanel shows bash tool history (KodaX-invoked commands), not an interactive shell. A real PTY is tracked for v0.1.x+.
- **Exit-plan-mode**: LLM-initiated plan mode escalation is unconditionally rejected. User must manually switch the Mode selector to `accept-edits` or `auto` to execute the plan. This is intentional — preserves the trust boundary that LLM cannot escalate its own permissions.
- **MCP project-scope servers**: McpManager currently only loads global `~/.kodax/config.json`. Project-level MCP servers (`<project>/.kodax/config.json`) are visible via `mcp.discover` but not actually managed.
- **No SDK-driven cost ($) display**: `/cost` shows token totals only. Real dollar amounts would require integrating SDK `calculateCost` + per-provider rate cards; deferred.
- **TypeScript errors don't block release CI**: `typecheck` is `continue-on-error: true` in the release workflow; manually verify locally before tagging.
