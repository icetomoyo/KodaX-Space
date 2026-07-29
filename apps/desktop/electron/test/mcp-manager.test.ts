import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  disposeMcpManager,
  getMcpManager,
  reloadMcpManager,
  setMcpManagerTestDependencies,
} from '../mcp/manager.js';

class FakeManager {
  disposed = false;

  constructor(readonly revision: number) {}

  listServers(): readonly unknown[] {
    return [{ id: `server-${this.revision}` }];
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

afterEach(async () => {
  await disposeMcpManager();
  setMcpManagerTestDependencies(null);
});

test('failed MCP reload retains the previous usable manager until a valid replacement commits', async () => {
  let revision = 1;
  let invalid = false;
  setMcpManagerTestDependencies({
    loadModule: async () => ({}),
    loadGlobalServers: async () => {
      if (invalid) throw new Error('invalid mcp.json');
      return { revision };
    },
    loadProjectServers: async () => {
      throw new Error('project loader should not be used');
    },
    createManager: (_module, servers) =>
      new FakeManager((servers as { revision: number }).revision),
  });

  const first = (await getMcpManager()) as unknown as FakeManager;
  assert.equal(first.revision, 1);

  invalid = true;
  await assert.rejects(reloadMcpManager(), /invalid mcp\.json/);
  const retained = (await getMcpManager()) as unknown as FakeManager;
  assert.equal(retained, first);
  assert.equal(first.disposed, false);

  invalid = false;
  revision = 2;
  const replacement = (await reloadMcpManager()) as unknown as FakeManager;
  assert.equal(replacement.revision, 2);
  assert.notEqual(replacement, first);
  assert.equal(first.disposed, true);
  assert.equal(await getMcpManager(), replacement);
});
