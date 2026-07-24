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

function runUpdate(extraEnv = {}) {
  return spawnSync(process.execPath, [fixtureScript, '--update'], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}

function runGit(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
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
  if (fixtureRoot) {
    await fs.rm(fixtureRoot, {
      recursive: true,
      force: true,
      maxRetries: process.platform === 'win32' ? 8 : 2,
      retryDelay: 100,
    });
  }
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

test('snapshot update checks out an exact commit with canonical LF bytes on Windows', async () => {
  const sourceRoot = path.join(fixtureRoot, 'source-repository');
  const skillContent =
    '---\nname: test-skill\ndescription: fixture skill\n---\ncanonical line endings\n';
  const licenseContent = 'fixture license\n';
  await fs.mkdir(sourceRoot, { recursive: true });
  runGit(sourceRoot, 'init', '--quiet');
  runGit(sourceRoot, 'config', 'user.name', 'KodaX Space Test');
  runGit(sourceRoot, 'config', 'user.email', 'test@kodax.space');
  runGit(sourceRoot, 'config', 'core.autocrlf', 'true');
  await fs.writeFile(path.join(sourceRoot, 'SKILL.md'), skillContent, 'utf8');
  await fs.writeFile(path.join(sourceRoot, 'LICENSE'), licenseContent, 'utf8');
  runGit(sourceRoot, 'add', 'SKILL.md', 'LICENSE');
  runGit(sourceRoot, 'commit', '--quiet', '-m', 'fixture');
  const revision = runGit(sourceRoot, 'rev-parse', 'HEAD');
  const sources = {
    schemaVersion: 1,
    skills: [
      {
        name: 'test-skill',
        repository: sourceRoot,
        ref: revision,
        installedPath: 'test-skill',
        sourceSubdir: '.',
        license: {
          sourcePath: 'LICENSE',
          destinationPath: 'LICENSE',
          sha256: sha256(licenseContent),
        },
        exclude: ['.git/**'],
      },
    ],
  };
  await fs.writeFile(
    path.join(fixtureRoot, 'resources', 'builtin-skills.sources.json'),
    `${JSON.stringify(sources, null, 2)}\n`,
    'utf8',
  );

  const updateResult = runUpdate({
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.autocrlf',
    GIT_CONFIG_VALUE_0: 'true',
  });
  assert.equal(updateResult.status, 0, updateResult.stderr);

  const installedSkill = await fs.readFile(
    path.join(fixtureRoot, 'resources', 'builtin-skills', 'test-skill', 'SKILL.md'),
  );
  assert.equal(installedSkill.includes(Buffer.from('\r\n')), false);
  assert.equal(installedSkill.toString('utf8'), skillContent);
  const lock = JSON.parse(await fs.readFile(fixtureLockPath, 'utf8'));
  assert.equal(lock.skills[0].revision, revision);
  assert.equal(runCheck().status, 0);
});
