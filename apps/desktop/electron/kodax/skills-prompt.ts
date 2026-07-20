// Natural-language skill activation — KodaX SDK global SkillRegistry wiring.
//
// What this closes: KodaX SDK (`@kodax-ai/kodax/skills` + `/coding`) already
// has all three pieces needed for the model to discover and invoke skills
// from natural-language prompts (no `/skill-name` slash required):
//
//   1. `getSkillRegistry(projectRoot)` — process-global SkillRegistry singleton
//   2. The coding `skill` tool — reads `getSkillRegistry()` at tool-invoke time
//   3. The prompt builder injects `context.skillsPrompt` as a
//      `skills-addendum` section (see KodaX
//      `agent/src/capabilities/skills/skill-registry.ts`
//      `getSystemPromptSnippet()` + `coding/src/prompts/capability-sections.ts`
//      `skills-addendum` branch).
//
// KodaX REPL wires all three (InkREPL: `initializeSkillRegistry(gitRoot)` at
// boot + `getSkillRegistry(gitRoot).getSystemPromptSnippet()` per turn).
// Space previously wired only the explicit `/skill discover|invoke` IPC path
// (apps/desktop/electron/ipc/skill.ts), so RealKodaXSession's runManagedTask
// `options.context` had no `skillsPrompt` — the model saw NO list of skills
// in its system prompt and could not auto-route by intent.
//
// Why we MUST use SDK's global getSkillRegistry (not Space's local
// `apps/desktop/electron/skill/registry.ts` wrapper that does
// `new SkillRegistry(projectRoot)`):
//   The coding `skill` tool's tool body calls `getSkillRegistry()` (no args
//   → returns current global instance). If Space's wrapper creates its own
//   instance but the global is uninitialized, the tool sees zero skills
//   even though the prompt addendum lists them. By going through the
//   global SDK getter we keep "what the model sees" and "what the tool can
//   invoke" in lock-step.
//
// Concurrency model: SDK global SkillRegistry holds ONE `_instance` per
// process and resets it whenever `getSkillRegistry` is called with a
// different `projectRoot` (KodaX `agent/src/capabilities/skills/skill-
// registry.ts:247`). Space supports multiple sessions for different project
// roots in the same Electron main process. Without serialization, two
// concurrent `buildSkillsPrompt` calls for different roots can thrash the
// singleton mid-flight — session A's `getSystemPromptSnippet()` ends up
// reading session B's freshly-reset (and not-yet-discovered) registry,
// silently emitting an empty addendum.
//
// We fix this with a single process-level serializing chain (`inFlight`).
// Every `buildSkillsPrompt` call atomically performs init + snippet-read
// under the lock, so the global state cannot be reset by another session
// between our init and our read. Lock cost is bounded by discover() — a
// few ms for cached `_instance`, tens of ms cold. Acceptable for the
// per-turn user-facing path.
//
// Failure policy: any failure (SDK subpath unreachable, discover throws on
// a broken SKILL.md, etc.) degrades to an empty prompt — the session still
// works, the model just doesn't get the skills addendum. We log to stderr
// but never throw out of the session boot path.

// `import type` keeps this a compile-time-only import — the dynamic
// `import('@kodax-ai/kodax/skills')` below is what actually loads the
// subpath at runtime (CJS-built main can't statically require subpath
// "import"-only conditional exports — same constraint that drove
// `loadSdkCoding` / `loadSdkLlm` in real-session.ts).
import type { Surface } from '@kodax-space/space-ipc-schema';
type SdkSkillsModule = typeof import('@kodax-ai/kodax/skills');
let sdkModuleCache: Promise<SdkSkillsModule | null> | null = null;

function loadSdkSkills(): Promise<SdkSkillsModule | null> {
  if (sdkModuleCache === null) {
    sdkModuleCache = import('@kodax-ai/kodax/skills').catch((err) => {
      console.warn(
        `[skills-prompt] failed to load @kodax-ai/kodax/skills subpath; ` +
          `natural-language skill activation will be disabled for this session: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    });
  }
  return sdkModuleCache;
}

/**
 * C7 (security): the SDK `skill` tool expands `` !`cmd` `` dynamic-context tokens via execSync,
 * bypassing Space's F029/F030 permission broker — this is exactly why Space's EXPLICIT /skill path
 * refuses such skills (skill/registry.ts#refuseIfUnsafeContent). The natural-language auto-invocation
 * path (this file) previously advertised EVERY discovered skill, so a skill carrying these tokens
 * could be auto-invoked by the model and run unmediated shell. We enforce the same policy here by
 * setting `disableModelInvocation=true` on any unsafe skill, which the SDK honors in BOTH places:
 *   (a) `getSystemPromptSnippet()` filters `disableModelInvocation` skills out of the prompt, and
 *   (b) the `skill` tool refuses to invoke a skill whose loaded form has the flag set.
 * `loadFull` caches and returns the same Skill reference the tool later reads, so mutating it closes
 * the tool path too. Safe skills are untouched — no regression to the dynamic-context-free majority.
 */
const DYNAMIC_CONTEXT_TOKEN = /!`[^`]+`/;

interface MutableSkillMetadata {
  readonly name: string;
  readonly source: string; // 'project' | 'user' | 'plugin' | 'builtin'
  disableModelInvocation: boolean;
}

// Untrusted skill sources: `project` = the opened repo's .kodax/skills (may come from a cloned repo
// the user didn't author), `plugin` = externally-installed. `user` (~/.kodax/skills) and `builtin`
// (KodaX-shipped) are treated as trusted.
//
// ACCEPTED-SCOPE NOTE (security review, owner decision 2026-07): `user` is a deliberately NARROWER
// scope. `~/.kodax/skills` CAN hold a downloaded skill pack (a supply-chain vector comparable to a
// cloned repo), so a malicious user-level dynamic-context skill is a KNOWN RESIDUAL that this
// suppression does not cover. It is left trusted because (a) Space's explicit /skill path already
// refuses ALL dynamic-context skills regardless of source (skill/registry.ts#refuseIfUnsafeContent),
// so such a skill is already non-functional there, and (b) widening to `user` would couple this
// path to whatever global skills the running machine happens to have. Full closure of the residual
// is an SDK ask (route the skill tool's dynamic-context through the host broker), tracked separately.
const UNTRUSTED_SKILL_SOURCES: ReadonlySet<string> = new Set(['project', 'plugin', 'learned']);
interface MutableFullSkill {
  content?: string;
  rawContent?: string;
  disableModelInvocation?: boolean;
}
export interface SafetyScannableRegistry {
  readonly skills: ReadonlyMap<string, MutableSkillMetadata>;
  loadFull(name: string): Promise<MutableFullSkill>;
}

/** Exported for unit testing the trust-boundary + flag-setting logic with a mock registry. */
export async function enforceSkillSafetyPolicy(
  registry: SafetyScannableRegistry,
): Promise<{ untrustedUnsafeSkills: string[] }> {
  const untrustedUnsafeSkills: string[] = [];
  for (const meta of registry.skills.values()) {
    let unsafe = false;
    let full: MutableFullSkill;
    try {
      full = await registry.loadFull(meta.name);
      unsafe = DYNAMIC_CONTEXT_TOKEN.test(`${full.content ?? ''}\n${full.rawContent ?? ''}`);
      if (unsafe) {
        // Belt: flag the metadata + cached full skill so the SDK drops it from the snippet and the
        // skill tool refuses it in the common (no-race) single-registry case.
        meta.disableModelInvocation = true;
        full.disableModelInvocation = true;
      }
    } catch {
      unsafe = true; // can't verify the content → fail safe
      meta.disableModelInvocation = true;
    }
    // Suspenders: flagging alone can't survive the SDK global-singleton re-discover race, and the
    // exfil threat is an UNTRUSTED (cloned-repo / plugin) skill. When one is present, suppress the
    // whole snippet (below) — trusted builtin/user skills using dynamic-context (e.g. `!`git status``)
    // stay flagged-only and do not nuke advertisement for the session.
    if (unsafe && UNTRUSTED_SKILL_SOURCES.has(meta.source)) {
      untrustedUnsafeSkills.push(meta.name);
    }
  }
  return { untrustedUnsafeSkills };
}

// Process-level serializing chain. Each `buildSkillsPrompt` call waits
// for the previous one to complete before touching the SDK global
// SkillRegistry. We chain on Promise resolution rather than rejection so
// a failed call (e.g. SKILL.md syntax error) does NOT permanently block
// the queue — the next call still gets to retry.
let inFlight: Promise<unknown> = Promise.resolve();

/**
 * Build the `skills-addendum` system-prompt fragment for the given
 * `projectRoot`. Returns an empty string on any failure (subpath
 * unreachable, init throws, etc.) so the caller can unconditionally
 * spread the result into `options.context.skillsPrompt` and the prompt
 * builder will skip the section when empty.
 *
 * Side effects:
 *   - Triggers `initializeSkillRegistry(projectRoot)` on every call
 *     (the SDK short-circuits the singleton lookup when `_instance`
 *     already matches `projectRoot`, but `discover()` still re-scans).
 *     Cost is amortized over the LLM round-trip.
 *   - Populates the SDK's process-global SkillRegistry — needed so the
 *     coding `skill` tool can invoke skills the model picks. Runs under
 *     the process serializing lock so cross-projectRoot concurrent
 *     callers cannot thrash the singleton mid-read.
 */
export async function buildSkillsPrompt(projectRoot: string): Promise<string> {
  const previous = inFlight;
  let releaseLock!: () => void;
  const myTurn = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  inFlight = myTurn;

  // `await previous.catch(() => {})` — wait for whatever was in flight,
  // but if it rejected we still want to take our turn. Without the
  // `.catch`, a single failed predecessor would surface here as a throw
  // and we'd skip our own init/read entirely.
  await previous.catch(() => {});

  try {
    const sdk = await loadSdkSkills();
    if (sdk === null) return '';
    let stage: 'init' | 'snapshot' = 'init';
    try {
      // initializeSkillRegistry: get-or-create + discover. SDK
      // `getSkillRegistry(projectRoot)` resets `_instance` if the
      // previous lock-holder used a different projectRoot — and since
      // we now own the lock, the reset/init/read sequence is atomic
      // from the caller's perspective.
      await sdk.initializeSkillRegistry(projectRoot);
      stage = 'snapshot';
      const registry = sdk.getSkillRegistry(projectRoot);
      // C7 (security review HIGH): the SDK `skill` tool re-discovers a FRESH, unflagged registry
      // whenever a concurrent session on another project root thrashes the process-global
      // SkillRegistry singleton, and its dynamic-context expansion runs `!`cmd`` via execSync
      // WITHOUT the permission broker. Per-skill flagging can't survive that race. The exploit
      // requires the model to know the unsafe skill's name — which Space only ever supplies via this
      // snippet — so when a project contains ANY dynamic-context skill we suppress the ENTIRE
      // natural-language snippet for it. The model is then never told a skill name for this project
      // and cannot auto-invoke the unsafe one, race or not. Safe skills in the same project lose NL
      // auto-invocation until the `!`...` token is removed; explicit /skill is unaffected and
      // independently blocks unsafe skills (skill/registry.ts#refuseIfUnsafeContent). Full closure
      // needs an SDK change (route the skill tool's dynamic-context through the host broker).
      const { untrustedUnsafeSkills } = await enforceSkillSafetyPolicy(
        registry as unknown as SafetyScannableRegistry,
      );
      if (untrustedUnsafeSkills.length > 0) {
        console.warn(
          `[skills-prompt] project '${projectRoot}' has ${untrustedUnsafeSkills.length} untrusted ` +
            `skill(s) with dynamic-context shell tokens (${untrustedUnsafeSkills.join(', ')}); ` +
            'natural-language skill auto-invocation is disabled for this project (KodaX Space ' +
            'safety policy). Remove the `!`...` tokens to re-enable.',
        );
        return '';
      }
      return registry.getSystemPromptSnippet();
    } catch (err) {
      // `stage` is set to 'init' at entry and only flipped after
      // initializeSkillRegistry resolves successfully; this makes the
      // failure-source unambiguous in the log without depending on
      // post-hoc registry-state heuristics.
      console.warn(
        `[skills-prompt] ${stage}(${projectRoot}) failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return '';
    }
  } finally {
    releaseLock();
  }
}

/**
 * Partner deliberately does not receive the SDK skills addendum yet. Its tool
 * policy blocks the SDK `skill` executor, so advertising discovered skills
 * would instruct the model to call a capability it cannot use. Partner's
 * workbench capability packs are prompt playbooks, not SDK/plugin skills.
 */
export function buildSkillsPromptForSurface(
  surface: Surface,
  projectRoot: string,
): Promise<string> {
  return surface === 'partner' ? Promise.resolve('') : buildSkillsPrompt(projectRoot);
}

/**
 * Test helper: drop the SDK-module cache and reset the SDK global
 * SkillRegistry. Not used in production. Tests need this between
 * scenarios so a stale singleton from a previous tmp projectRoot does
 * not leak into the next test's expectations.
 *
 * Also clears `inFlight` to defuse any unresolved lock left over from
 * a test that panicked mid-call — without this a single failed test
 * would deadlock every subsequent test in the suite.
 */
export async function _resetSkillsPromptForTests(): Promise<void> {
  inFlight = Promise.resolve();
  const sdk = await loadSdkSkills();
  sdk?.resetSkillRegistry();
}
