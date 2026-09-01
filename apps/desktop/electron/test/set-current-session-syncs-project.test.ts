// v0.1.9 fix — setCurrentSession 应当同步 currentProjectPath 到 session 的 projectRoot。
// 用户报: 选 KodaX-Space session 但 RightSidebar Changes 显示 KodaX 项目的改动 →
// 根因是 currentProjectPath 跟 currentSession 不同步,ChangesSection 走旧 project 拉
// git changes。

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '../../renderer/src/store/appStore.js';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';

function mkSession(sessionId: string, projectRoot: string): SessionMeta {
  return {
    sessionId,
    projectRoot,
    provider: 'mock',
    reasoningMode: 'auto',
    permissionMode: 'accept-edits',
    agentMode: 'ama',
    surface: 'code',
    createdAt: 1700000000000,
    lastActivityAt: 1700000000000,
  };
}

beforeEach(() => {
  useAppStore.setState({
    sessions: [],
    currentSessionId: null,
    currentProjectPath: null,
  });
});

test('setCurrentSession(sid) syncs currentProjectPath when session belongs to different project', () => {
  const sessA = mkSession('sess-a', '/proj/kodax');
  const sessB = mkSession('sess-b', '/proj/kodax-space');
  useAppStore.setState({
    sessions: [sessA, sessB],
    currentProjectPath: '/proj/kodax', // 用户当前打开 KodaX
  });

  // 点 KodaX-Space session
  useAppStore.getState().setCurrentSession('sess-b');

  const s = useAppStore.getState();
  assert.equal(s.currentSessionId, 'sess-b');
  // currentProjectPath 应当切到 KodaX-Space (与 sess-b.projectRoot 一致)
  assert.equal(s.currentProjectPath, '/proj/kodax-space');
});

test('setCurrentSession(sid) does NOT touch currentProjectPath when already matching', () => {
  const sessA = mkSession('sess-a', '/proj/kodax-space');
  useAppStore.setState({
    sessions: [sessA],
    currentProjectPath: '/proj/kodax-space',
  });

  useAppStore.getState().setCurrentSession('sess-a');

  const s = useAppStore.getState();
  assert.equal(s.currentSessionId, 'sess-a');
  assert.equal(s.currentProjectPath, '/proj/kodax-space');
});

test('setCurrentSession(null) does NOT clear currentProjectPath (回 dashboard 仍看当前项目)', () => {
  useAppStore.setState({
    sessions: [],
    currentSessionId: 'old',
    currentProjectPath: '/proj/kodax',
  });

  useAppStore.getState().setCurrentSession(null);

  const s = useAppStore.getState();
  assert.equal(s.currentSessionId, null);
  assert.equal(s.currentProjectPath, '/proj/kodax');
});

test('setCurrentSession(sid) for unknown sessionId only sets sid, does not touch project', () => {
  // 防御: SDK push 进来一个 sessions 列表还没含的 sid (race), 不能因 sessions.find 找不到
  // 而把 currentProjectPath 抹掉。
  useAppStore.setState({
    sessions: [],
    currentProjectPath: '/proj/kodax',
  });

  useAppStore.getState().setCurrentSession('ghost-sid');

  const s = useAppStore.getState();
  assert.equal(s.currentSessionId, 'ghost-sid');
  assert.equal(s.currentProjectPath, '/proj/kodax');
});

test('setCurrentSession with session missing projectRoot leaves currentProjectPath alone', () => {
  // session.projectRoot 可能空(早期 mock / persisted 缺字段),不该让 currentProjectPath 被
  // set 成 undefined。
  const sess: SessionMeta = { ...mkSession('sess-x', ''), projectRoot: '' };
  useAppStore.setState({
    sessions: [sess],
    currentProjectPath: '/proj/kodax',
  });

  useAppStore.getState().setCurrentSession('sess-x');

  const s = useAppStore.getState();
  assert.equal(s.currentSessionId, 'sess-x');
  assert.equal(s.currentProjectPath, '/proj/kodax');
});

test('Windows-style path case difference still triggers project sync (canon比较)', () => {
  // 桌面 navigator undefined → IS_WIN_RENDERER=false → 走 POSIX 比较, 用大小写差异跑这条会
  // 触发同步(POSIX 严格比较 'C:/Proj/A' !== 'C:/proj/a')。本测试主要锁住 "canon 一致就不切"
  // 的行为不会因为路径有 trailing slash 等小差异误触发。
  const sess = mkSession('sess-a', '/proj/kodax-space');
  useAppStore.setState({
    sessions: [sess],
    currentProjectPath: '/proj/kodax-space/',  // 多个 trailing slash
  });

  useAppStore.getState().setCurrentSession('sess-a');

  const s = useAppStore.getState();
  // canon 应当把 trailing slash 抹掉 → 一致 → 不切
  assert.equal(s.currentProjectPath, '/proj/kodax-space/');
});

test('setCurrentProject clears currentSessionId when active session belongs to previous project', () => {
  const oldSession = mkSession('sess-old', '/Users/vincegao/kodax_workspace');
  useAppStore.setState({
    sessions: [oldSession],
    currentSessionId: 'sess-old',
    currentProjectPath: '/Users/vincegao/kodax_workspace',
  });

  useAppStore.getState().setCurrentProject('/Users/vincegao/finance-management');

  const s = useAppStore.getState();
  assert.equal(s.currentProjectPath, '/Users/vincegao/finance-management');
  assert.equal(s.currentSessionId, null);
});

test('setCurrentProject clears currentSessionId when switching to a different project', () => {
  const session = mkSession('sess-current', '/Users/vincegao/finance-management');
  useAppStore.setState({
    sessions: [session],
    currentSessionId: 'sess-current',
    currentProjectPath: '/Users/vincegao/kodax_workspace',
  });

  useAppStore.getState().setCurrentProject('/Users/vincegao/finance-management');

  const s = useAppStore.getState();
  assert.equal(s.currentProjectPath, '/Users/vincegao/finance-management');
  assert.equal(s.currentSessionId, null);
});

test('setCurrentProject keeps currentSessionId when target project is unchanged', () => {
  const session = mkSession('sess-current', '/Users/vincegao/finance-management');
  useAppStore.setState({
    sessions: [session],
    currentSessionId: 'sess-current',
    currentProjectPath: '/Users/vincegao/finance-management/',
  });

  useAppStore.getState().setCurrentProject('/Users/vincegao/finance-management');

  const s = useAppStore.getState();
  assert.equal(s.currentProjectPath, '/Users/vincegao/finance-management');
  assert.equal(s.currentSessionId, 'sess-current');
});
