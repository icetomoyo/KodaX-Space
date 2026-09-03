import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

// appStore reads LS_KEY_PROJECT at module init, so the fake window/localStorage
// must exist before the store module is imported.
type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};
const storage = new Map<string, string>();
const fakeStorage: StorageLike = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => void storage.set(key, value),
  removeItem: (key) => void storage.delete(key),
};
(globalThis as { window?: { localStorage?: StorageLike } }).window = {
  localStorage: fakeStorage,
};
// appStore also reads the bare localStorage global (theme) during init.
(globalThis as { localStorage?: StorageLike }).localStorage = fakeStorage;

const { useAppStore } = await import('./appStore.js');

const LS_KEY_PROJECT = 'kodax-space.currentProjectPath';

const session = (sessionId: string, projectRoot: string) => ({
  sessionId,
  projectRoot,
  provider: 'mock',
  reasoningMode: 'auto' as const,
  permissionMode: 'accept-edits' as const,
  agentMode: 'ama' as const,
  surface: 'code' as const,
  createdAt: 1,
  lastActivityAt: 1,
});

beforeEach(() => {
  storage.clear();
  useAppStore.setState({
    currentProjectPath: 'C:\\project-a',
    currentSessionId: null,
    sessions: [session('a1', 'C:\\project-a'), session('b1', 'C:\\project-b')],
  });
  fakeStorage.setItem(LS_KEY_PROJECT, 'C:\\project-a');
});

test('switching project persists the selection to localStorage', () => {
  useAppStore.getState().setCurrentProject('C:\\project-b');
  assert.equal(useAppStore.getState().currentProjectPath, 'C:\\project-b');
  assert.equal(fakeStorage.getItem(LS_KEY_PROJECT), 'C:\\project-b');
});

test('opening a session of another project persists that project as the selection', () => {
  useAppStore.getState().setCurrentSession('b1');
  assert.equal(useAppStore.getState().currentSessionId, 'b1');
  assert.equal(useAppStore.getState().currentProjectPath, 'C:\\project-b');
  assert.equal(fakeStorage.getItem(LS_KEY_PROJECT), 'C:\\project-b');
});

test('opening a session of the current project keeps the persisted selection', () => {
  useAppStore.getState().setCurrentSession('a1');
  assert.equal(useAppStore.getState().currentSessionId, 'a1');
  assert.equal(fakeStorage.getItem(LS_KEY_PROJECT), 'C:\\project-a');
});
