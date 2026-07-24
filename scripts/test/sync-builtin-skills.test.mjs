import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
let fixtureRoot;
let fixtureScript;
let fixtureLockPath;

const sha256 = (content) => createHash('sha256').update(content).digest('hex');

function runCheck(...extraArgs) {
  return spawnSync(process.execPath, [fixtureScript, '--check', ...extraArgs], {
    cwd: fixtureRoot,
    encoding: 'utf8',
  });
}

async function writeLock(
  revision,
  skillContent = '---\nname: test-skill\ndescription: fixture skill\n---\nfixture body\n',
  forbiddenText = [],
) {
  const sources = {
    schemaVersion: 1,
    skills: [
      {
        name: 'test-skill',
        repository: 'https://example.invalid/test-skill.git',
        forbiddenText,
      },
    ],
  };
  await fs.writeFile(
    path.join(fixtureRoot, 'resources', 'builtin-skills.sources.json'),
    `${JSON.stringify(sources, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(fixtureRoot, 'resources', 'builtin-skills', 'test-skill', 'SKILL.md'),
    skillContent,
    'utf8',
  );
  await fs.writeFile(
    fixtureLockPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourcesSha256: sha256(JSON.stringify(sources)),
        skills: [
          {
            name: 'test-skill',
            repository: sources.skills[0].repository,
            revision,
            patches: [],
            files: [
              {
                path: 'SKILL.md',
                bytes: Buffer.byteLength(skillContent),
                sha256: sha256(skillContent),
              },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

before(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(repositoryRoot, '.sync-builtin-test-'));
  fixtureScript = path.join(fixtureRoot, 'scripts', 'sync-builtin-skills.mjs');
  fixtureLockPath = path.join(fixtureRoot, 'resources', 'builtin-skills.lock.json');
  await fs.mkdir(path.dirname(fixtureScript), { recursive: true });
  await fs.mkdir(path.join(fixtureRoot, 'resources', 'builtin-skills', 'test-skill'), {
    recursive: true,
  });
  await fs.copyFile(path.join(repositoryRoot, 'scripts', 'sync-builtin-skills.mjs'), fixtureScript);
});

after(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

test('release check accepts an exact snapshot pinned to an auditable Git commit', async () => {
  await writeLock('a'.repeat(40));
  const result = runCheck();
  assert.equal(result.status, 0, result.stderr);
});

test('release check rejects installed snapshots unless explicitly allowed for preview', async () => {
  await writeLock(`installed:${'b'.repeat(64)}`);
  const releaseResult = runCheck();
  assert.notEqual(releaseResult.status, 0);
  assert.match(releaseResult.stderr, /not an auditable Git commit/);

  const previewResult = runCheck('--allow-installed');
  assert.equal(previewResult.status, 0, previewResult.stderr);
});

test('snapshot check rejects unmanaged files at the vendored root', async () => {
  await writeLock('c'.repeat(40));
  const unexpectedPath = path.join(fixtureRoot, 'resources', 'builtin-skills', 'unexpected.txt');
  try {
    await fs.writeFile(unexpectedPath, 'not managed by the lock\n', 'utf8');
    const result = runCheck();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unmanaged top-level files: unexpected\.txt/);
  } finally {
    await fs.rm(unexpectedPath, { force: true });
  }
});

test('snapshot check rejects broken local Markdown links', async () => {
  const skillContent =
    '---\nname: test-skill\ndescription: fixture skill\n---\n[missing](references/missing.md)\n';
  await writeLock('d'.repeat(40), skillContent);
  const result = runCheck();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /broken local Markdown link.*references\/missing\.md/);
});

test('snapshot check rejects forbidden text regardless of letter case', async () => {
  const skillContent =
    '---\nname: test-skill\ndescription: fixture skill\n---\nCREATED BY HUASHU-DESIGN\n';
  await writeLock('e'.repeat(40), skillContent, ['created by huashu-design']);
  const result = runCheck();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /forbidden text "created by huashu-design"/);
});
