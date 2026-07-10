// FEATURE_038: skills-prompt helper tests — natural-language skill activation.
//
// Covers `buildSkillsPrompt(projectRoot)` and its contract with the
// SDK global SkillRegistry singleton:
//   - empty project → returns a string (may be empty OR contain
//     dev-machine ~/.kodax/skills + bundled builtins; we don't pin
//     content, just shape)
//   - project with a `.kodax/skills/<name>/SKILL.md` → snippet
//     mentions that skill's name (so the model sees it and can route
//     by natural language)
//   - SDK global registry is populated as a side effect (verifies
//     "what tool can invoke" matches "what model sees")
//   - **cross-projectRoot concurrency safety**: two interleaved calls
//     for different roots must not thrash each other's snippet read
//     (the process-level serializing lock in skills-prompt.ts)
//
// Test style mirrors `skill-registry.test.ts`: real SDK calls, real
// tmp fs, no module mocking (Node's built-in test runner doesn't have
// it). We assume SDK `SkillRegistry.discover()` is snapshot-only — no
// fs auto-watch (createSkillWatcher exists in the SDK but is a REPL-
// only hot-reload helper, not invoked by `discover()` itself); if the
// SDK ever adds auto-watch to the registry the snapshot-time
// assertions here may flip to flaky.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSkillsPrompt,
  buildSkillsPromptForSurface,
  enforceSkillSafetyPolicy,
  _resetSkillsPromptForTests,
  type SafetyScannableRegistry,
} from '../kodax/skills-prompt.js';

let tmpRootA: string;
let tmpRootB: string;

beforeEach(async () => {
  await _resetSkillsPromptForTests();
  tmpRootA = fs.mkdtempSync(path.join(os.tmpdir(), 'kodax-skills-prompt-test-A-'));
  tmpRootB = fs.mkdtempSync(path.join(os.tmpdir(), 'kodax-skills-prompt-test-B-'));
});

afterEach(async () => {
  await _resetSkillsPromptForTests();
  for (const dir of [tmpRootA, tmpRootB]) {
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function writeSkill(baseDir: string, name: string, frontmatter: string, body: string): void {
  const dir = path.join(baseDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}\n`);
}

test('buildSkillsPrompt: returns a string for an empty project root', async () => {
  const out = await buildSkillsPrompt(tmpRootA);
  assert.equal(typeof out, 'string', 'must return string even when no project skills found');
  // We don't pin content because dev machines have ~/.kodax/skills.
  // The point is it must be safe to spread into context.skillsPrompt
  // without injecting an undefined/null value mid-spread.
});

test('buildSkillsPromptForSurface: Partner does not advertise an unavailable SDK skill tool', async () => {
  const skillsDir = path.join(tmpRootA, '.kodax', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  const name = `tmp-partner-hidden-${Date.now()}`;
  writeSkill(skillsDir, name, `name: ${name}\ndescription: must remain hidden`, 'body');

  assert.equal(await buildSkillsPromptForSurface('partner', tmpRootA), '');
  assert.match(await buildSkillsPromptForSurface('code', tmpRootA), new RegExp(name));
});

test('buildSkillsPrompt: includes project-discovered skill name + description in snippet', async () => {
  const skillsDir = path.join(tmpRootA, '.kodax', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  // Use a unique name so we don't false-positive against any user-level
  // skill that happens to be installed on the dev machine.
  const name = `tmp-nl-trigger-${Date.now()}`;
  const description = `Activate when the user wants to ${name}-test something specific`;
  writeSkill(skillsDir, name, `name: ${name}\ndescription: ${description}`, 'body');

  const out = await buildSkillsPrompt(tmpRootA);
  assert.ok(
    out.includes(name),
    `expected snippet to list skill "${name}"; got snippet of length ${out.length}`,
  );
  assert.ok(
    out.includes(description.slice(0, 30)),
    `expected snippet to include the skill description (first 30 chars)`,
  );
});

test('buildSkillsPrompt: excludes skills with dynamic-context shell tokens from auto-invocation (C7)', async () => {
  const skillsDir = path.join(tmpRootA, '.kodax', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  const stamp = Date.now();
  const unsafe = `tmp-unsafe-${stamp}`;
  const safe = `tmp-safe-${stamp}`;
  // The unsafe skill embeds a `!`cmd`` dynamic-context token; the SDK would execSync it, bypassing
  // Space's permission broker — so it must be dropped from the natural-language snippet.
  writeSkill(
    skillsDir,
    unsafe,
    `name: ${unsafe}\ndescription: activate for ${unsafe} tasks`,
    'Current status: !`git status`',
  );
  writeSkill(
    skillsDir,
    safe,
    `name: ${safe}\ndescription: activate for ${safe} tasks`,
    'plain body',
  );

  // Security policy: a project containing ANY dynamic-context skill gets its ENTIRE natural-language
  // snippet suppressed (the per-skill flag can't survive the SDK global-singleton re-discover race,
  // so we never advertise a skill name the model could use to auto-invoke the unsafe one).
  const out = await buildSkillsPrompt(tmpRootA);
  assert.equal(out, '', 'snippet fully suppressed when the project has a dynamic-context skill');
  assert.ok(!out.includes(unsafe), 'unsafe skill not advertised');
  assert.ok(!out.includes(safe), 'sibling skills also suppressed while an unsafe skill is present');
});

test('enforceSkillSafetyPolicy: only untrusted (project/plugin) dynamic-context skills trigger suppression', async () => {
  // Deterministic mock registry (no real SDK / dev-machine ~/.kodax/skills coupling) — verifies both
  // the trust-boundary (Q3 owner decision: user/builtin trusted) and the belt-flag on ALL unsafe skills.
  const specs = [
    { name: 'proj-unsafe', source: 'project', body: 'x !`cat .env`' },
    { name: 'plugin-unsafe', source: 'plugin', body: 'y !`whoami`' },
    { name: 'user-unsafe', source: 'user', body: 'z !`git status`' }, // trusted → no suppression
    { name: 'builtin-unsafe', source: 'builtin', body: 'w !`git log`' }, // trusted → no suppression
    { name: 'proj-safe', source: 'project', body: 'plain, no tokens' },
  ];
  const skills = new Map(
    specs.map((s) => [s.name, { name: s.name, source: s.source, disableModelInvocation: false }]),
  );
  const bodyByName = new Map(specs.map((s) => [s.name, s.body]));
  const registry: SafetyScannableRegistry = {
    skills,
    loadFull: async (name: string) => ({
      content: bodyByName.get(name) ?? '',
      rawContent: bodyByName.get(name) ?? '',
      disableModelInvocation: false,
    }),
  };

  const { untrustedUnsafeSkills } = await enforceSkillSafetyPolicy(registry);
  assert.deepEqual(
    [...untrustedUnsafeSkills].sort(),
    ['plugin-unsafe', 'proj-unsafe'],
    'only project/plugin dynamic-context skills gate the snippet',
  );
  // Belt: EVERY unsafe skill (any source) is flagged out of model invocation.
  assert.equal(skills.get('user-unsafe')?.disableModelInvocation, true);
  assert.equal(skills.get('builtin-unsafe')?.disableModelInvocation, true);
  // Safe skill is left invokable.
  assert.equal(skills.get('proj-safe')?.disableModelInvocation, false);
});

test('buildSkillsPrompt: re-discovers on subsequent calls (no stale cache)', async () => {
  // After dropping the per-projectRoot Promise cache (HIGH-1 fix), each
  // call goes through initializeSkillRegistry → discover. This test
  // confirms a SKILL.md change between calls IS picked up — the helper
  // does not stale-cache. (Trade-off: 5-50ms discover per turn vs. the
  // cross-projectRoot thrash risk the old cache enabled.)
  const skillsDir = path.join(tmpRootA, '.kodax', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  const name = `tmp-fresh-${Date.now()}`;
  writeSkill(skillsDir, name, `name: ${name}\ndescription: first version`, 'body');

  const first = await buildSkillsPrompt(tmpRootA);
  assert.ok(first.includes('first version'), 'first call shows initial description');

  fs.writeFileSync(
    path.join(skillsDir, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: second version\n---\nbody\n`,
  );

  const second = await buildSkillsPrompt(tmpRootA);
  assert.ok(
    second.includes('second version'),
    'second call re-discovers and picks up the mutated description',
  );
});

test('buildSkillsPrompt: populates the SDK global registry (parity with skill tool)', async () => {
  // The point of going through the SDK global getSkillRegistry — not
  // Space's local `apps/desktop/electron/skill/registry.ts` wrapper —
  // is that the coding `skill` tool reads the same global. This test
  // verifies: after buildSkillsPrompt fires, importing the SDK's
  // global getter returns a registry that lists the project skill.
  const skillsDir = path.join(tmpRootA, '.kodax', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  const name = `tmp-global-${Date.now()}`;
  writeSkill(skillsDir, name, `name: ${name}\ndescription: global parity`, 'body');

  await buildSkillsPrompt(tmpRootA);

  const sdk = await import('@kodax-ai/kodax/skills');
  const global = sdk.getSkillRegistry(tmpRootA);
  const found = global.list().find((s) => s.name === name);
  assert.ok(found, 'SDK global registry must list the project skill after buildSkillsPrompt');
  assert.equal(found.source, 'project');
});

test('buildSkillsPrompt: concurrent cross-projectRoot calls do not thrash the global singleton', async () => {
  // Reproduce HIGH-1 from the code review: without the process-level
  // serializing chain, two concurrent buildSkillsPrompt calls for
  // different roots can race. Session A's getSystemPromptSnippet()
  // ends up reading session B's freshly-reset (post-discover-but-
  // matching-different-projectRoot) registry — silently returning a
  // snippet that lists session B's skills, not A's.
  //
  // After the lock fix: even when we race them, each call sees its
  // own projectRoot's skills.
  const skillsA = path.join(tmpRootA, '.kodax', 'skills');
  const skillsB = path.join(tmpRootB, '.kodax', 'skills');
  fs.mkdirSync(skillsA, { recursive: true });
  fs.mkdirSync(skillsB, { recursive: true });
  const nameA = `tmp-projA-${Date.now()}`;
  const nameB = `tmp-projB-${Date.now()}`;
  writeSkill(skillsA, nameA, `name: ${nameA}\ndescription: belongs to A`, 'body');
  writeSkill(skillsB, nameB, `name: ${nameB}\ndescription: belongs to B`, 'body');

  // Fire interleaved without await between them — both buildSkillsPrompt
  // calls touch the SDK process-global SkillRegistry.
  const [snippetA, snippetB] = await Promise.all([
    buildSkillsPrompt(tmpRootA),
    buildSkillsPrompt(tmpRootB),
  ]);

  assert.ok(
    snippetA.includes(nameA),
    `A's snippet must list nameA (${nameA}); got snippet length ${snippetA.length}`,
  );
  assert.ok(
    !snippetA.includes(nameB),
    `A's snippet must NOT contain nameB (${nameB}) — that would mean B thrashed A`,
  );
  assert.ok(
    snippetB.includes(nameB),
    `B's snippet must list nameB (${nameB}); got snippet length ${snippetB.length}`,
  );
  assert.ok(
    !snippetB.includes(nameA),
    `B's snippet must NOT contain nameA (${nameA}) — that would mean A thrashed B`,
  );
});

test('buildSkillsPrompt: previous failure does not block subsequent calls', async () => {
  // The serializing chain awaits `previous.catch(() => {})` — if a prior
  // call throws (e.g. malformed SKILL.md), the chain still releases the
  // lock and the next call gets to run. This is the queue's poison-pill
  // resistance.
  const skillsDir = path.join(tmpRootA, '.kodax', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  // Write a deliberately weird SKILL.md path: an empty SKILL.md inside
  // a skill folder. SDK is robust — this won't throw — but exercises
  // the discover path with a no-op input first.
  fs.mkdirSync(path.join(skillsDir, 'tmp-junk'), { recursive: true });
  fs.writeFileSync(path.join(skillsDir, 'tmp-junk', 'SKILL.md'), '');

  // First call: should complete (returns empty or partial).
  const first = await buildSkillsPrompt(tmpRootA);
  assert.equal(
    typeof first,
    'string',
    'first call must resolve to a string even with empty SKILL.md',
  );

  // Now add a valid skill and call again. The chain must not be stuck.
  const goodName = `tmp-recovers-${Date.now()}`;
  writeSkill(skillsDir, goodName, `name: ${goodName}\ndescription: recovers ok`, 'body');
  const second = await buildSkillsPrompt(tmpRootA);
  assert.ok(
    second.includes(goodName),
    'queue is not blocked after prior call; second call discovers new skill',
  );
});
