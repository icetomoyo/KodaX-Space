import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  _resetSpaceBuiltinSkillsForTests,
  isSpaceBuiltinSkillPath,
  registerSpaceBuiltinSkills,
  resolveSpaceBuiltinSkillsPath,
} from '../skill/space-builtins.js';
import { toSkillMeta } from '../skill/registry.js';
import { enforceSkillSafetyPolicy, type SafetyScannableRegistry } from '../kodax/skills-prompt.js';

let temporaryRoot: string;
let builtinRoot: string;

beforeEach(() => {
  _resetSpaceBuiltinSkillsForTests();
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kodax-space-builtins-'));
  builtinRoot = path.join(temporaryRoot, 'builtin-skills');
  const skillRoot = path.join(builtinRoot, 'space-test-skill');
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(
    path.join(skillRoot, 'SKILL.md'),
    '---\nname: space-test-skill\ndescription: test builtin\n---\nbody\n',
  );
});

afterEach(() => {
  _resetSpaceBuiltinSkillsForTests();
  if (temporaryRoot && fs.existsSync(temporaryRoot)) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('resolveSpaceBuiltinSkillsPath selects repository resources in dev and installed resources when packaged', () => {
  assert.equal(
    resolveSpaceBuiltinSkillsPath({
      isPackaged: false,
      mainDirectory: path.join(temporaryRoot, 'app', 'dist-electron'),
      resourcesPath: path.join(temporaryRoot, 'installed-resources'),
    }),
    path.join(temporaryRoot, 'app', 'resources', 'builtin-skills'),
  );
  assert.equal(
    resolveSpaceBuiltinSkillsPath({
      isPackaged: true,
      mainDirectory: path.join(temporaryRoot, 'installed-resources', 'app.asar'),
      resourcesPath: path.join(temporaryRoot, 'installed-resources'),
    }),
    path.join(temporaryRoot, 'installed-resources', 'builtin-skills'),
  );
});

test('registerSpaceBuiltinSkills is idempotent and makes the installer-owned path discoverable', async () => {
  const first = await registerSpaceBuiltinSkills(builtinRoot);
  const second = await registerSpaceBuiltinSkills(builtinRoot);
  assert.deepEqual(first.skillNames, ['space-test-skill']);
  assert.deepEqual(second, first);

  const sdk = await import('@kodax-ai/kodax/skills');
  assert.ok(sdk.listPluginSkillPaths().includes(path.resolve(builtinRoot)));
  assert.equal(isSpaceBuiltinSkillPath(path.join(builtinRoot, 'space-test-skill')), true);
  assert.equal(isSpaceBuiltinSkillPath(`${builtinRoot}-sibling/space-test-skill`), false);
});

test('registerSpaceBuiltinSkills rejects an empty or damaged resource tree without trusting it', async () => {
  fs.rmSync(path.join(builtinRoot, 'space-test-skill', 'SKILL.md'));

  await assert.rejects(registerSpaceBuiltinSkills(builtinRoot), /no SKILL\.md found/);
  assert.equal(isSpaceBuiltinSkillPath(path.join(builtinRoot, 'space-test-skill')), false);
});

test('Space maps its registered SDK plugin path to builtin metadata', async () => {
  await registerSpaceBuiltinSkills(builtinRoot);
  const sdk = await import('@kodax-ai/kodax/skills');
  const registry = new sdk.SkillRegistry(temporaryRoot);
  await registry.discover();
  const discovered = registry.get('space-test-skill');
  assert.ok(discovered);
  assert.equal(discovered.source, 'plugin');
  assert.equal(discovered.path, path.join(builtinRoot, 'space-test-skill'));

  const mapped = toSkillMeta(discovered);
  assert.equal(mapped.source, 'builtin');
});

test('Space builtin plugin sources remain conservatively untrusted at the safety boundary', async () => {
  await registerSpaceBuiltinSkills(builtinRoot);
  const skillPath = path.join(builtinRoot, 'space-test-skill');
  const metadata = {
    name: 'space-test-skill',
    source: 'plugin',
    path: skillPath,
    disableModelInvocation: false,
  };
  const registry: SafetyScannableRegistry = {
    skills: new Map([[metadata.name, metadata]]),
    loadFull: async () => ({
      content: 'unsafe syntax is still disabled: !`git status`',
      rawContent: '',
      disableModelInvocation: false,
    }),
  };

  const result = await enforceSkillSafetyPolicy(registry);
  assert.deepEqual(result.untrustedUnsafeSkills, ['space-test-skill']);
  assert.equal(metadata.disableModelInvocation, true, 'dynamic context remains disabled');
});
