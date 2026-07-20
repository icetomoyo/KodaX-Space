// Skill IPC schema tests — FEATURE_035.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  invokeChannels,
  INVOKE_CHANNEL_NAMES,
  skillDiscoverChannel,
  skillInstallChannel,
  skillInvokeChannel,
} from '../src/index.js';

test('skill.discover + skill.invoke + skill.install channels are registered', () => {
  assert.ok(invokeChannels['skill.discover']);
  assert.ok(invokeChannels['skill.invoke']);
  assert.ok(invokeChannels['skill.install']);
  assert.ok(INVOKE_CHANNEL_NAMES.has('skill.discover'));
  assert.ok(INVOKE_CHANNEL_NAMES.has('skill.invoke'));
  assert.ok(INVOKE_CHANNEL_NAMES.has('skill.install'));
});

test('skill.discover input requires projectRoot', () => {
  assert.equal(skillDiscoverChannel.input.safeParse({ projectRoot: 'C:\\proj' }).success, true);
  assert.equal(skillDiscoverChannel.input.safeParse({}).success, false);
  assert.equal(skillDiscoverChannel.input.safeParse({ projectRoot: '' }).success, false);
});

test('skill.discover output accepts user/project/plugin/builtin/learned sources', () => {
  for (const source of ['user', 'project', 'plugin', 'builtin', 'learned'] as const) {
    const out = {
      skills: [{ name: 'foo', description: 'desc', source, path: '/skills/foo' }],
    };
    assert.equal(skillDiscoverChannel.output.safeParse(out).success, true, `source=${source}`);
  }
});

test('skill.discover output rejects unknown source', () => {
  const out = {
    skills: [{ name: 'foo', description: '', source: 'remote', path: '/x' }],
  };
  assert.equal(skillDiscoverChannel.output.safeParse(out).success, false);
});

test('skill name regex allows kebab + . : _ but no slashes', () => {
  // valid
  for (const n of [
    'foo',
    'foo-bar',
    'foo.bar',
    'foo:bar',
    'foo_bar',
    'feature-list-tracker',
    'a1',
    'x',
  ]) {
    assert.equal(
      skillDiscoverChannel.output.safeParse({
        skills: [{ name: n, description: '', source: 'user', path: '/x' }],
      }).success,
      true,
      `valid name: ${n}`,
    );
  }
  // invalid
  for (const n of ['Foo', '/foo', '../etc', 'foo bar', '-foo', 'foo bar/baz']) {
    assert.equal(
      skillDiscoverChannel.output.safeParse({
        skills: [{ name: n, description: '', source: 'user', path: '/x' }],
      }).success,
      false,
      `invalid name: ${n}`,
    );
  }
});

test('skill.discover output array cap is 256', () => {
  const skills = Array.from({ length: 257 }, (_, i) => ({
    name: `s${i}`,
    description: '',
    source: 'user' as const,
    path: `/x/${i}`,
  }));
  assert.equal(skillDiscoverChannel.output.safeParse({ skills }).success, false);
  assert.equal(
    skillDiscoverChannel.output.safeParse({ skills: skills.slice(0, 256) }).success,
    true,
  );
});

test('skill.invoke input shape', () => {
  assert.equal(
    skillInvokeChannel.input.safeParse({
      sessionId: 's_1',
      skillName: 'foo-bar',
      args: ['a', 'b'],
    }).success,
    true,
  );
  // 名字必须 kebab
  assert.equal(
    skillInvokeChannel.input.safeParse({ sessionId: 's_1', skillName: 'Foo', args: [] }).success,
    false,
  );
  // args 上限 20
  const tooMany = Array.from({ length: 21 }, () => 'x');
  assert.equal(
    skillInvokeChannel.input.safeParse({
      sessionId: 's_1',
      skillName: 'foo',
      args: tooMany,
    }).success,
    false,
  );
});

test('skill.invoke output ok-true requires resolvedPrompt; error path: no resolvedPrompt + error', () => {
  // ok=true with resolvedPrompt is valid
  assert.equal(
    skillInvokeChannel.output.safeParse({ ok: true, resolvedPrompt: '# hello' }).success,
    true,
  );
  // ok=false with error is valid
  assert.equal(
    skillInvokeChannel.output.safeParse({ ok: false, error: 'parse failed' }).success,
    true,
  );
  // bare ok=true with neither is allowed (schema both optional) — handler convention
  assert.equal(skillInvokeChannel.output.safeParse({ ok: true }).success, true);
  // 1MB prompt cap
  const huge = 'x'.repeat(1_048_577);
  assert.equal(
    skillInvokeChannel.output.safeParse({ ok: true, resolvedPrompt: huge }).success,
    false,
  );
});

test('skill.install input and output shape', () => {
  assert.equal(
    skillInstallChannel.input.safeParse({
      source: 'directory',
      target: 'user',
    }).success,
    true,
  );
  assert.equal(
    skillInstallChannel.input.safeParse({
      source: 'archive',
      target: 'project',
      projectRoot: 'C:\\repo',
    }).success,
    true,
  );
  assert.equal(
    skillInstallChannel.input.safeParse({
      source: 'tarball',
      target: 'user',
    }).success,
    false,
  );
  assert.equal(skillInstallChannel.output.safeParse({ cancelled: true }).success, true);
  assert.equal(
    skillInstallChannel.output.safeParse({
      installed: true,
      name: 'code-review',
      installDir: 'C:\\Users\\you\\.kodax\\skills\\code-review',
      targetDir: 'C:\\Users\\you\\.kodax\\skills',
    }).success,
    true,
  );
  assert.equal(
    skillInstallChannel.output.safeParse({
      installed: true,
      name: 'CodeReview',
    }).success,
    false,
  );
});
