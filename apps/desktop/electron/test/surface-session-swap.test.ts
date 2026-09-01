// F046 — per-surface 当前 session 切换。
//
// Coder / Partner 会话列表彼此独立（F045），当前 session 也应按面记忆：切到另一面恢复那面
// 上次停留的 session，切回再恢复回来。setSurface 用 snapshot-on-leave（捕获离开面的实时
// currentSessionId），不需要连续同步。

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import { useSurfaceStore } from '../../renderer/src/store/surface.js';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';

function mkSession(
  sessionId: string,
  surface: SessionMeta['surface'],
  projectRoot = '/proj/x',
): SessionMeta {
  return {
    sessionId,
    projectRoot,
    provider: 'mock',
    reasoningMode: 'auto',
    permissionMode: 'accept-edits',
    agentMode: 'ama',
    surface,
    createdAt: 1700000000000,
    lastActivityAt: 1700000000000,
  };
}

beforeEach(() => {
  useAppStore.setState({
    sessions: [mkSession('code-A', 'code'), mkSession('partner-B', 'partner')],
    currentSessionId: null,
    currentProjectPath: '/proj/x',
  });
  useSurfaceStore.setState({
    currentSurface: 'code',
    sessionIdBySurface: { code: null, partner: null },
  });
});

test('setSurface snapshots leaving session and restores target surface session', () => {
  const surface = useSurfaceStore.getState();
  const app = useAppStore.getState();

  // 在 Coder 选 code-A
  app.setCurrentSession('code-A');
  assert.equal(useAppStore.getState().currentSessionId, 'code-A');

  // 切到 Partner → Coder 槽快照 code-A，currentSession 恢复成 Partner 槽（空 → null）
  surface.setSurface('partner');
  assert.equal(useSurfaceStore.getState().currentSurface, 'partner');
  assert.equal(useSurfaceStore.getState().sessionIdBySurface.code, 'code-A');
  assert.equal(useAppStore.getState().currentSessionId, null, 'Partner 面初次进入无 session');

  // 在 Partner 选 partner-B
  useAppStore.getState().setCurrentSession('partner-B');
  assert.equal(useAppStore.getState().currentSessionId, 'partner-B');

  // 切回 Coder → Partner 槽快照 partner-B，currentSession 恢复成 code-A
  useSurfaceStore.getState().setSurface('code');
  assert.equal(useSurfaceStore.getState().currentSurface, 'code');
  assert.equal(useSurfaceStore.getState().sessionIdBySurface.partner, 'partner-B');
  assert.equal(useAppStore.getState().currentSessionId, 'code-A', '切回恢复 Coder 的 code-A');

  // 再切 Partner → 恢复 partner-B
  useSurfaceStore.getState().setSurface('partner');
  assert.equal(useAppStore.getState().currentSessionId, 'partner-B', '切回恢复 Partner 的 partner-B');
});

test('setSurface to the same surface is a no-op (does not clobber current session)', () => {
  useAppStore.getState().setCurrentSession('code-A');
  useSurfaceStore.getState().setSurface('code'); // 同面
  assert.equal(useAppStore.getState().currentSessionId, 'code-A');
  assert.equal(useSurfaceStore.getState().currentSurface, 'code');
});

test('restoring a session that was deleted on the other surface falls back to null', () => {
  // review HIGH-1: 在 Partner 选 partner-B → 切到 Coder → partner-B 被删除 → 切回 Partner。
  // 恢复槽里的 partner-B 已不在 sessions 列表，应回退 null（该面 dashboard），不指 orphan id。
  useAppStore.getState().setCurrentSession('code-A');
  useSurfaceStore.getState().setSurface('partner');
  useAppStore.getState().setCurrentSession('partner-B');
  assert.equal(useSurfaceStore.getState().sessionIdBySurface.partner ?? null, null); // 尚未快照
  useSurfaceStore.getState().setSurface('code'); // 离开 Partner，快照 partner-B
  assert.equal(useSurfaceStore.getState().sessionIdBySurface.partner, 'partner-B');

  // partner-B 被删除（从 sessions 移除）
  useAppStore.setState({ sessions: [mkSession('code-A', 'code')] });

  // 切回 Partner → 恢复槽 partner-B 已失效 → null
  useSurfaceStore.getState().setSurface('partner');
  assert.equal(useAppStore.getState().currentSessionId, null, '已删除的 session 不应被恢复');
});

test('switching away with no current session records null, restores null', () => {
  // Coder 无 session → 切 Partner → 切回，Coder 仍是 dashboard（null）
  useSurfaceStore.getState().setSurface('partner');
  assert.equal(useSurfaceStore.getState().sessionIdBySurface.code, null);
  useSurfaceStore.getState().setSurface('code');
  assert.equal(useAppStore.getState().currentSessionId, null);
});

test('setSurface does not restore a remembered session from another project', () => {
  useAppStore.setState({
    sessions: [
      mkSession('code-A', 'code', '/proj/a'),
      mkSession('partner-B', 'partner', '/proj/a'),
    ],
    currentSessionId: null,
    currentProjectPath: '/proj/a',
  });
  useSurfaceStore.setState({
    currentSurface: 'code',
    sessionIdBySurface: { code: null, partner: 'partner-B' },
  });

  useAppStore.getState().setCurrentProject('/proj/b');
  useSurfaceStore.getState().setSurface('partner');

  const app = useAppStore.getState();
  assert.equal(app.currentProjectPath, '/proj/b');
  assert.equal(app.currentSessionId, null);
});
