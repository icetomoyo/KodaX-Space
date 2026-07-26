// toSkillMeta clamps fields to the IPC schema caps (regression: 2026-06-15).
//
// Real skills routinely ship long trigger descriptions (>512). Before the fix,
// toSkillMeta passed them through raw → skillMetaSchema rejected → because
// z.array fails on ANY element, the ENTIRE skill.discover output was OUTPUT_INVALID
// (empty picker + skills missing from the slash menu). toSkillMeta now clamps so
// every emitted meta validates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillMetaSchema } from '@kodax-space/space-ipc-schema';
import { mergeSkillMetas, toSkillMeta, type SkillMetadata } from '../skill/registry.js';

function fakeSkill(over: Partial<SkillMetadata>): SkillMetadata {
  // Minimal SkillMetadata shape; cast covers SDK-only fields the mapper ignores.
  return {
    name: 'my-skill',
    description: 'short',
    source: 'user',
    path: '/home/u/.kodax/skills/my-skill/SKILL.md',
    ...over,
  } as SkillMetadata;
}

test('toSkillMeta clamps an over-long description to 512 and still validates', () => {
  const meta = toSkillMeta(fakeSkill({ description: 'x'.repeat(5000) }));
  assert.equal(meta.description.length, 512);
  assert.ok(skillMetaSchema.safeParse(meta).success);
});

test('toSkillMeta clamps over-long argumentHint to 128', () => {
  const meta = toSkillMeta(fakeSkill({ argumentHint: 'a'.repeat(300) }));
  assert.equal(meta.argumentHint?.length, 128);
  assert.ok(skillMetaSchema.safeParse(meta).success);
});

test('toSkillMeta leaves an in-spec skill untouched', () => {
  const meta = toSkillMeta(fakeSkill({ name: 'codex:gpt-5-4-prompting', description: 'fine' }));
  assert.equal(meta.name, 'codex:gpt-5-4-prompting');
  assert.equal(meta.description, 'fine');
  assert.equal(meta.argumentHint, undefined);
  assert.ok(skillMetaSchema.safeParse(meta).success);
});

test('a skill with a missing description maps to "" (still valid)', () => {
  // SDK could omit description; mapper must not emit undefined into a required field.
  const meta = toSkillMeta(fakeSkill({ description: undefined as unknown as string }));
  assert.equal(meta.description, '');
  assert.ok(skillMetaSchema.safeParse(meta).success);
});

test('Space builtin metadata wins daemon name collisions without duplicate slash rows', () => {
  const spaceBuiltin = toSkillMeta(
    fakeSkill({
      name: 'frontend-slides',
      source: 'plugin',
      path: '/space/builtin-skills/frontend-slides',
    }),
  );
  const daemonDuplicate = toSkillMeta(
    fakeSkill({
      name: 'frontend-slides',
      source: 'builtin',
      path: '/daemon/builtin/frontend-slides',
    }),
  );
  const daemonOnly = toSkillMeta(
    fakeSkill({
      name: 'runtime-skill',
      source: 'builtin',
      path: '/daemon/builtin/runtime-skill',
    }),
  );

  const merged = mergeSkillMetas([spaceBuiltin], [daemonDuplicate, daemonOnly]);
  assert.deepEqual(
    merged.map((skill) => skill.name),
    ['frontend-slides', 'runtime-skill'],
  );
  assert.equal(merged[0].path, spaceBuiltin.path);
});

test('skill catalog merge reserves the IPC limit for preferred Space builtins', () => {
  const preferred = [
    toSkillMeta(fakeSkill({ name: 'frontend-slides' })),
    toSkillMeta(fakeSkill({ name: 'huashu-design' })),
  ];
  const daemon = [
    toSkillMeta(fakeSkill({ name: 'runtime-one' })),
    toSkillMeta(fakeSkill({ name: 'runtime-two' })),
  ];

  assert.deepEqual(
    mergeSkillMetas(preferred, daemon, 3).map((skill) => skill.name),
    ['frontend-slides', 'huashu-design', 'runtime-one'],
  );
  assert.deepEqual(mergeSkillMetas(preferred, daemon, 0), []);
});
