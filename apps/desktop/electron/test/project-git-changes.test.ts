import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GIT_CHANGES_STATUS_ARGS, parseGitChangesStatus } from '../ipc/project-git-changes.js';

let testRoot: string;

function runGit(cwd: string, args: readonly string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    const child = spawn('git', args, { cwd, shell: false, windowsHide: true });
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => resolve({ ok: false, stdout }));
    child.on('close', (code) => resolve({ ok: code === 0, stdout }));
  });
}

async function initRepo(): Promise<void> {
  await runGit(testRoot, ['init', '--quiet', '-b', 'main']);
  await runGit(testRoot, ['config', 'user.email', 'test@example.com']);
  await runGit(testRoot, ['config', 'user.name', 'Test User']);
  await runGit(testRoot, ['config', 'core.autocrlf', 'false']);
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-git-changes-'));
  await initRepo();
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
});

test('preserves an untracked Unicode path with spaces', async () => {
  const relativePath = 'docs/中文 报告(v1).txt';
  await fs.mkdir(path.join(testRoot, 'docs'));
  await fs.writeFile(path.join(testRoot, 'docs', 'seed.txt'), 'tracked\n');
  await runGit(testRoot, ['add', '.']);
  await runGit(testRoot, ['commit', '-m', 'init', '--quiet']);
  await fs.writeFile(path.join(testRoot, relativePath), 'new\n');

  const status = await runGit(testRoot, GIT_CHANGES_STATUS_ARGS);
  assert.equal(status.ok, true);

  const parsed = parseGitChangesStatus(status.stdout);
  assert.equal(parsed.branch, 'main');
  assert.deepEqual(parsed.files, [{ path: relativePath, status: 'U', staged: false }]);
  assert.equal(parsed.truncated, false);
});

test('expands a fully untracked directory into its individual files', async () => {
  const relativePaths = ['docs/HLD.md', 'docs/PRD.md', 'docs/ProductDraft.md', 'docs/UI_DESIGN.md'];
  await fs.mkdir(path.join(testRoot, 'docs'));
  await Promise.all(
    relativePaths.map((relativePath) => fs.writeFile(path.join(testRoot, relativePath), 'new\n')),
  );

  const status = await runGit(testRoot, GIT_CHANGES_STATUS_ARGS);
  assert.equal(status.ok, true);

  const parsed = parseGitChangesStatus(status.stdout);
  assert.deepEqual(
    parsed.files,
    relativePaths.map((relativePath) => ({
      path: relativePath,
      status: 'U',
      staged: false,
    })),
  );
  assert.equal(parsed.truncated, false);
});

test('keeps the 200-file response guard after expanding untracked directories', async () => {
  const relativePaths = Array.from(
    { length: 205 },
    (_, index) => `generated/file-${String(index).padStart(3, '0')}.txt`,
  );
  await fs.mkdir(path.join(testRoot, 'generated'));
  await Promise.all(
    relativePaths.map((relativePath) => fs.writeFile(path.join(testRoot, relativePath), 'new\n')),
  );

  const status = await runGit(testRoot, GIT_CHANGES_STATUS_ARGS);
  assert.equal(status.ok, true);

  const parsed = parseGitChangesStatus(status.stdout);
  assert.equal(parsed.files.length, 200);
  assert.equal(parsed.truncated, true);
  assert.equal(
    parsed.files.every((file) => file.status === 'U' && file.staged === false),
    true,
  );
});

test('uses the destination path for a staged Unicode rename', async () => {
  const originalPath = '旧 文件.txt';
  const renamedPath = '新 文件.txt';
  await fs.writeFile(path.join(testRoot, originalPath), 'tracked\n');
  await runGit(testRoot, ['add', '.']);
  await runGit(testRoot, ['commit', '-m', 'init', '--quiet']);
  await fs.rename(path.join(testRoot, originalPath), path.join(testRoot, renamedPath));
  await runGit(testRoot, ['add', '-A']);

  const status = await runGit(testRoot, GIT_CHANGES_STATUS_ARGS);
  assert.equal(status.ok, true);

  const parsed = parseGitChangesStatus(status.stdout);
  assert.deepEqual(parsed.files, [{ path: renamedPath, status: 'R', staged: true }]);
});
