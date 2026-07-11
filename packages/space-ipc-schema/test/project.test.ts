// Schema tests for project.* channels.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  invokeChannels,
  INVOKE_CHANNEL_NAMES,
  projectListChannel,
  projectOpenDialogChannel,
  projectRecentAddChannel,
  projectRecentRemoveChannel,
  sessionListChannel,
  sessionSetTitleChannel,
} from '../src/index.js';

test('all 4 project channels are registered', () => {
  for (const name of [
    'project.list',
    'project.openDialog',
    'project.recent.add',
    'project.recent.remove',
  ]) {
    assert.ok(invokeChannels[name as keyof typeof invokeChannels], `${name} should be registered`);
    assert.ok(INVOKE_CHANNEL_NAMES.has(name));
  }
});

test('project.list input is void; output requires projects array', () => {
  assert.equal(projectListChannel.input.safeParse(undefined).success, true);
  assert.equal(projectListChannel.output.safeParse({ projects: [] }).success, true);
});

test('project.openDialog output: path can be string or null', () => {
  assert.equal(
    projectOpenDialogChannel.output.safeParse({ path: '/Users/foo/proj' }).success,
    true,
  );
  assert.equal(projectOpenDialogChannel.output.safeParse({ path: null }).success, true);
  assert.equal(projectOpenDialogChannel.output.safeParse({}).success, false);
});

test('project.recent.add requires path; rejects empty or oversize', () => {
  assert.equal(projectRecentAddChannel.input.safeParse({ path: '/r' }).success, true);
  assert.equal(projectRecentAddChannel.input.safeParse({ path: '' }).success, false);
  const tooLong = 'x'.repeat(4097);
  assert.equal(projectRecentAddChannel.input.safeParse({ path: tooLong }).success, false);
});

test('project.recent.add output: project object with all fields', () => {
  const valid = {
    project: {
      path: '/r',
      name: 'r',
      addedAt: 1700000000000,
      lastUsedAt: 1700000000000,
    },
  };
  assert.equal(projectRecentAddChannel.output.safeParse(valid).success, true);
  // 缺一个字段就 fail
  const missing = { project: { path: '/r', name: 'r', addedAt: 0 } };
  assert.equal(projectRecentAddChannel.output.safeParse(missing).success, false);
});

test('project.recent.remove: simple boolean output', () => {
  assert.equal(projectRecentRemoveChannel.output.safeParse({ removed: true }).success, true);
  assert.equal(projectRecentRemoveChannel.output.safeParse({ removed: false }).success, true);
});

test('session.list now accepts optional { projectRoot } filter', () => {
  // 不传 input：仍然有效（向后兼容）
  assert.equal(sessionListChannel.input.safeParse(undefined).success, true);
  // 传 {} 也行
  assert.equal(sessionListChannel.input.safeParse({}).success, true);
  // 传 projectRoot 也行
  assert.equal(sessionListChannel.input.safeParse({ projectRoot: '/r' }).success, true);
  assert.equal(
    sessionListChannel.input.safeParse({ projectRoot: '/r', limit: 50_000 }).success,
    true,
  );
  assert.equal(sessionListChannel.input.safeParse({ limit: 50_001 }).success, false);
  assert.equal(sessionListChannel.input.safeParse({ limit: 0 }).success, false);
});

test('session.list output: SessionMeta now allows optional title', () => {
  const withTitle = {
    sessions: [
      {
        sessionId: 's_1',
        projectRoot: '/r',
        provider: 'mock',
        reasoningMode: 'auto',
        title: 'Read package.json',
        createdAt: 0,
        lastActivityAt: 0,
      },
    ],
  };
  assert.equal(sessionListChannel.output.safeParse(withTitle).success, true);

  // 没 title 也 OK（之前的 SessionMeta 兼容）
  const noTitle = {
    sessions: [
      {
        sessionId: 's_1',
        projectRoot: '/r',
        provider: 'mock',
        reasoningMode: 'auto',
        createdAt: 0,
        lastActivityAt: 0,
      },
    ],
  };
  assert.equal(sessionListChannel.output.safeParse(noTitle).success, true);
});

test('session.setTitle: requires sessionId + non-empty title', () => {
  assert.equal(
    sessionSetTitleChannel.input.safeParse({ sessionId: 's_1', title: 'hello' }).success,
    true,
  );
  assert.equal(
    sessionSetTitleChannel.input.safeParse({ sessionId: 's_1', title: '' }).success,
    false,
  );
  const tooLong = 'x'.repeat(257);
  assert.equal(
    sessionSetTitleChannel.input.safeParse({ sessionId: 's_1', title: tooLong }).success,
    false,
  );
});
