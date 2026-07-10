import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  promises as fs,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ArtifactStore } from '../artifact/store.js';
import { SessionLocalNoticeStore } from '../kodax/session-local-notice-store.js';
import { SessionTitleStore } from '../kodax/session-title-store.js';
import { WorkflowController } from '../kodax/workflow-controller.js';
import { WorkflowPolicyStore } from '../kodax/workflow-policy.js';
import {
  getMcpbStoragePaths,
  migrateLegacyMcpbStorage,
  type InternalMcpbEntry,
  type McpbKodaxMcpSyncDeps,
} from '../mcpb/registry.js';
import { createProjectStore } from '../projects/store.js';

function sessionMetadataPath(dir: string, sessionId: string): string {
  return join(dir, `${createHash('sha256').update(sessionId).digest('hex')}.json`);
}

async function withForcedReplacementFallback(
  name: string,
  targetPath: string,
  initialJson: string,
  run: () => Promise<void>,
): Promise<void> {
  const outsidePath = join(dirname(targetPath), `${name}-outside.json`);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(outsidePath, initialJson);
  linkSync(outsidePath, targetPath);

  const originalRename = fs.rename;
  let forcedFallback = false;
  fs.rename = (async (oldPath, newPath) => {
    if (!forcedFallback && resolve(String(newPath)) === resolve(targetPath)) {
      forcedFallback = true;
      throw Object.assign(new Error('forced Windows replacement fallback'), { code: 'EPERM' });
    }
    return originalRename(oldPath, newPath);
  }) as typeof fs.rename;

  try {
    await run();
    assert.equal(forcedFallback, true, `${name} must exercise the Windows replacement fallback`);
    assert.equal(readFileSync(outsidePath, 'utf8'), initialJson);
    const persisted = readFileSync(targetPath, 'utf8');
    assert.notEqual(persisted, initialJson);
    assert.doesNotThrow(() => JSON.parse(persisted));
  } finally {
    fs.rename = originalRename;
  }
}

test('baseline durable stores never write through hard-link aliases on Windows fallback', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baseline-durable-atomic-'));
  try {
    await t.test('session title override', async () => {
      const dir = join(root, 'titles');
      const sessionId = 'title-session';
      const target = sessionMetadataPath(dir, sessionId);
      const initial = JSON.stringify({
        version: 1,
        sessionId,
        title: 'Outside title',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      await withForcedReplacementFallback('title', target, initial, async () => {
        await new SessionTitleStore(dir).set(sessionId, 'Updated title');
      });
      assert.equal(await new SessionTitleStore(dir).read(sessionId), 'Updated title');
    });

    await t.test('session local notices', async () => {
      const dir = join(root, 'notices');
      const sessionId = 'notice-session';
      const target = sessionMetadataPath(dir, sessionId);
      const initial = JSON.stringify({
        version: 1,
        sessionId,
        notices: [{ id: 'old', content: 'outside', sentAt: 1 }],
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      await withForcedReplacementFallback('notices', target, initial, async () => {
        await new SessionLocalNoticeStore(dir).append(sessionId, {
          id: 'new',
          content: 'new notice',
          sentAt: 2,
        });
      });
      assert.deepEqual(
        (await new SessionLocalNoticeStore(dir).list(sessionId)).map((notice) => notice.id),
        ['old', 'new'],
      );
    });

    await t.test('recent projects registry', async () => {
      const dir = join(root, 'projects');
      const target = join(dir, 'projects.json');
      const initial = JSON.stringify({ version: 1, projects: [] });
      await withForcedReplacementFallback('projects', target, initial, async () => {
        await createProjectStore(target, dir).addOrBump(join(root, 'workspace'));
      });
      assert.equal((await createProjectStore(target, dir).list()).length, 1);
    });

    await t.test('workflow policy', async () => {
      const target = join(root, 'workflow-policy', 'policy.json');
      const initial = JSON.stringify({
        schemaVersion: 2,
        maxAgents: 16,
        maxConcurrency: 8,
        tokenBudget: 0,
      });
      await withForcedReplacementFallback('workflow-policy', target, initial, async () => {
        await new WorkflowPolicyStore(target).set({ maxConcurrency: 4 });
      });
      assert.equal((await new WorkflowPolicyStore(target).load()).maxConcurrency, 4);
    });

    await t.test('workflow origins registry', async () => {
      const target = join(root, 'workflow-origins', 'origins.json');
      const initial = JSON.stringify({ version: 1, origins: {} });
      await withForcedReplacementFallback('workflow-origins', target, initial, async () => {
        const controller = new WorkflowController(() => {}, target, join(root, 'workflow-runs'));
        controller.registerOrigin('run-atomic', { sessionId: 's1', surface: 'partner' });
        await controller.flush();
      });
      const persisted = JSON.parse(readFileSync(target, 'utf8')) as {
        origins: Record<string, unknown>;
      };
      assert.ok(persisted.origins['run-atomic']);
    });

    await t.test('MCPB registry migration', async () => {
      const kodaxDir = join(root, 'kodax');
      const legacyHome = join(root, 'legacy-mcpb');
      const paths = getMcpbStoragePaths(kodaxDir, join(root, 'home'));
      const oldInstallDir = join(legacyHome, 'mcpb', 'filesystem@1.0.0');
      mkdirSync(oldInstallDir, { recursive: true });
      writeFileSync(join(oldInstallDir, 'index.js'), 'console.log("ok");');
      const entry: InternalMcpbEntry = {
        extensionId: 'filesystem@1.0.0',
        name: 'filesystem',
        displayName: 'Filesystem',
        version: '1.0.0',
        transport: 'stdio',
        toolCount: 1,
        installedAt: 1,
        installDir: oldInstallDir,
        server: { command: 'node', args: [join(oldInstallDir, 'index.js')] },
      };
      mkdirSync(legacyHome, { recursive: true });
      writeFileSync(
        join(legacyHome, 'mcpb-extensions.json'),
        JSON.stringify({ version: 1, extensions: [entry] }),
      );
      const initial = JSON.stringify({ version: 1, extensions: [] });
      const configs: Record<string, unknown> = {};
      const syncDeps: McpbKodaxMcpSyncDeps = {
        getMcpServerConfig: (name) => configs[name] as never,
        upsertMcpServer: (name, config) => {
          configs[name] = config;
          return config;
        },
        removeMcpServer: (name) => delete configs[name],
      };
      await withForcedReplacementFallback('mcpb', paths.registryPath, initial, async () => {
        const result = await migrateLegacyMcpbStorage({ legacyHome, kodaxDir, syncDeps });
        assert.equal(result.kind, 'migrated');
      });
      const persisted = JSON.parse(readFileSync(paths.registryPath, 'utf8')) as {
        extensions: unknown[];
      };
      assert.equal(persisted.extensions.length, 1);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('artifact legacy backup never follows a target raced into the fallback path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-backup-race-'));
  const legacyPath = join(root, 'artifacts.json');
  const backupPath = join(root, 'artifacts.v1.backup.json');
  const outsidePath = join(root, 'outside.json');
  const outside = 'external inode must remain unchanged';
  writeFileSync(
    legacyPath,
    JSON.stringify({
      version: 1,
      artifacts: [
        {
          id: 'legacy-a',
          sessionId: 's1',
          surface: 'partner',
          kind: 'markdown',
          title: 'Legacy',
          currentVersion: 1,
          versions: [{ v: 1, createdAt: 1, content: 'legacy content' }],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }),
  );
  writeFileSync(outsidePath, outside);

  const originalLink = fs.link;
  const originalRename = fs.rename;
  let racedTarget = false;
  fs.link = (async (oldPath, newPath) => {
    if (!racedTarget && resolve(String(newPath)) === resolve(backupPath)) {
      racedTarget = true;
      linkSync(outsidePath, backupPath);
      throw Object.assign(new Error('backup target raced into place'), { code: 'EEXIST' });
    }
    return originalLink(oldPath, newPath);
  }) as typeof fs.link;
  fs.rename = (async (oldPath, newPath) => {
    if (!racedTarget && resolve(String(newPath)) === resolve(backupPath)) {
      racedTarget = true;
      linkSync(outsidePath, backupPath);
      throw Object.assign(new Error('forced Windows backup fallback'), { code: 'EPERM' });
    }
    return originalRename(oldPath, newPath);
  }) as typeof fs.rename;

  const store = new ArtifactStore(legacyPath, root);
  try {
    assert.equal((await store.list({ sessionId: 's1' })).length, 1);
    assert.equal(racedTarget, true);
    assert.equal(readFileSync(outsidePath, 'utf8'), outside);
    assert.equal(readFileSync(backupPath, 'utf8'), outside);
    const uniqueBackup = readdirSync(root).find((name) =>
      name.startsWith('artifacts.v1.backup.json.'),
    );
    assert.ok(uniqueBackup);
    assert.match(readFileSync(join(root, uniqueBackup), 'utf8'), /legacy content/);
    assert.equal(await store.read('legacy-a').then((result) => result?.content), 'legacy content');
  } finally {
    store.invalidate();
    fs.link = originalLink;
    fs.rename = originalRename;
    rmSync(root, { recursive: true, force: true });
  }
});
