import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const resourcesRoot = path.join(repoRoot, 'resources');
const sourcesPath = path.join(resourcesRoot, 'builtin-skills.sources.json');
const lockPath = path.join(resourcesRoot, 'builtin-skills.lock.json');
const vendorRoot = path.join(resourcesRoot, 'builtin-skills');
const args = new Set(process.argv.slice(2));
const update = args.has('--update');
const check = args.has('--check');
const fromInstalled = args.has('--from-installed');
const allowInstalled = args.has('--allow-installed');

if (
  update === check ||
  (fromInstalled && !update) ||
  (allowInstalled && !check) ||
  [...args].some(
    (arg) => !['--update', '--check', '--from-installed', '--allow-installed'].includes(arg),
  )
) {
  console.error(
    'Usage: node scripts/sync-builtin-skills.mjs ' +
      '(--check [--allow-installed] | --update [--from-installed])',
  );
  process.exit(2);
}

const toPosix = (value) => value.split(path.sep).join('/');
const sha256 = (content) => createHash('sha256').update(content).digest('hex');

function safeJoin(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes its root: ${relativePath}`);
  }
  return resolved;
}

function assertManagedDestination(target) {
  if (
    path.resolve(path.dirname(target)) !== path.resolve(resourcesRoot) ||
    path.basename(target) !== 'builtin-skills'
  ) {
    throw new Error(`Refusing to replace unmanaged destination: ${target}`);
  }
}

function runGit(commandArgs, cwd) {
  const result = spawnSync('git', commandArgs, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${commandArgs.join(' ')} failed (${result.status}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

function isExcluded(relativePath, patterns) {
  return patterns.some((pattern) => {
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
    }
    return relativePath === pattern;
  });
}

async function listFiles(root, exclude = []) {
  const files = [];
  async function walk(current, prefix) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isExcluded(relativePath, exclude)) continue;
      const absolutePath = path.join(current, entry.name);
      const stat = await fs.lstat(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in builtin skills: ${relativePath}`);
      }
      if (stat.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (stat.isFile()) {
        files.push({ absolutePath, relativePath, mode: stat.mode });
      }
    }
  }
  await walk(root, '');
  return files;
}

async function copyTree(sourceRoot, destinationRoot, exclude) {
  const files = await listFiles(sourceRoot, exclude);
  for (const file of files) {
    const destination = safeJoin(destinationRoot, file.relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(file.absolutePath, destination);
    await fs.chmod(destination, file.mode & 0o777);
  }
}

async function hashFiles(root) {
  const files = await listFiles(root);
  const records = [];
  for (const file of files) {
    const content = await fs.readFile(file.absolutePath);
    records.push({
      path: file.relativePath,
      bytes: content.byteLength,
      sha256: sha256(content),
    });
  }
  return records;
}

function validateFrontmatter(skillName, markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${skillName}: SKILL.md has no YAML frontmatter`);
  const frontmatter = YAML.parse(match[1]);
  if (frontmatter?.name !== skillName) {
    throw new Error(
      `${skillName}: frontmatter name must match the directory (got ${frontmatter?.name ?? 'none'})`,
    );
  }
  if (typeof frontmatter.description !== 'string' || frontmatter.description.trim() === '') {
    throw new Error(`${skillName}: frontmatter description must be a non-empty string`);
  }
}

async function validateMarkdownLinks(skillName, skillRoot, files) {
  const skillRootPath = path.resolve(skillRoot);
  const linkPattern = /!?\[[^\]]*\]\((<[^>\r\n]+>|[^)\s]+)(?:\s+["'][^)\r\n]*["'])?\)/g;
  for (const file of files) {
    if (!file.relativePath.toLowerCase().endsWith('.md')) continue;
    const markdown = await fs.readFile(file.absolutePath, 'utf8');
    for (const match of markdown.matchAll(linkPattern)) {
      const rawTarget = match[1].startsWith('<') ? match[1].slice(1, -1) : match[1];
      if (/^(?:https?:|mailto:|data:|app:|#)/i.test(rawTarget)) continue;
      const pathTarget = rawTarget.split(/[?#]/, 1)[0];
      if (pathTarget === '') continue;
      let decodedTarget;
      try {
        decodedTarget = decodeURIComponent(pathTarget);
      } catch {
        throw new Error(
          `${skillName}: invalid encoded Markdown link in ${file.relativePath}: ${rawTarget}`,
        );
      }
      const resolvedTarget = path.resolve(path.dirname(file.absolutePath), decodedTarget);
      const relativeToSkill = path.relative(skillRootPath, resolvedTarget);
      if (relativeToSkill.startsWith('..') || path.isAbsolute(relativeToSkill)) {
        throw new Error(
          `${skillName}: Markdown link escapes the builtin skill in ${file.relativePath}: ${rawTarget}`,
        );
      }
      try {
        await fs.stat(resolvedTarget);
      } catch {
        throw new Error(
          `${skillName}: broken local Markdown link in ${file.relativePath}: ${rawTarget}`,
        );
      }
    }
  }
}

async function validateSkill(skillName, skillRoot, forbiddenText = []) {
  const skillMarkdownPath = path.join(skillRoot, 'SKILL.md');
  const markdown = await fs.readFile(skillMarkdownPath, 'utf8');
  validateFrontmatter(skillName, markdown);
  if (/!`[^`]+`/.test(markdown)) {
    throw new Error(
      `${skillName}: dynamic-context shell tokens are not allowed in Space builtin skills`,
    );
  }
  const files = await listFiles(skillRoot);
  await validateMarkdownLinks(skillName, skillRoot, files);
  for (const file of files) {
    const lower = file.relativePath.toLowerCase();
    if (
      lower === '.env' ||
      lower.endsWith('.key') ||
      lower.endsWith('.pem') ||
      lower === 'credentials.json' ||
      lower === 'secrets.json'
    ) {
      throw new Error(`${skillName}: sensitive file is not allowed: ${file.relativePath}`);
    }
  }
  if (forbiddenText.length > 0) {
    for (const file of files) {
      if (
        !/\.(?:md|html?|jsx?|mjs|cjs|py|sh|css|json|ya?ml|txt|example)$/i.test(file.relativePath)
      ) {
        continue;
      }
      const content = await fs.readFile(file.absolutePath, 'utf8');
      const normalizedContent = content.toLocaleLowerCase('en-US');
      for (const forbidden of forbiddenText) {
        const normalizedForbidden = forbidden.toLocaleLowerCase('en-US');
        if (normalizedContent.includes(normalizedForbidden)) {
          throw new Error(
            `${skillName}: forbidden text "${forbidden}" remains in ${file.relativePath}`,
          );
        }
      }
    }
  }
}

async function readSources() {
  const parsed = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.skills)) {
    throw new Error('Unsupported builtin-skills.sources.json schema');
  }
  const names = new Set();
  for (const skill of parsed.skills) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)) {
      throw new Error(`Invalid builtin skill name: ${skill.name}`);
    }
    if (names.has(skill.name)) throw new Error(`Duplicate builtin skill name: ${skill.name}`);
    names.add(skill.name);
  }
  return parsed;
}

async function checkSnapshot(sources) {
  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.skills)) {
    throw new Error('Unsupported builtin-skills.lock.json schema');
  }
  const sourcesSha256 = sha256(JSON.stringify(sources));
  if (lock.sourcesSha256 !== sourcesSha256) {
    throw new Error(
      'builtin-skills.sources.json differs from the lock file; run npm run skills:update',
    );
  }
  const sourceNames = sources.skills.map((skill) => skill.name).sort();
  const lockNames = lock.skills.map((skill) => skill.name).sort();
  const vendorEntries = await fs.readdir(vendorRoot, { withFileTypes: true });
  const unexpectedTopLevelEntries = vendorEntries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (unexpectedTopLevelEntries.length > 0) {
    throw new Error(
      `vendored root contains unmanaged top-level files: ${unexpectedTopLevelEntries.join(', ')}`,
    );
  }
  const actualNames = vendorEntries.map((entry) => entry.name).sort();
  for (const [label, names] of [
    ['lock', lockNames],
    ['vendored directory', actualNames],
  ]) {
    if (JSON.stringify(names) !== JSON.stringify(sourceNames)) {
      throw new Error(
        `${label} skill list differs from sources: expected ${sourceNames.join(', ')}, got ${names.join(', ')}`,
      );
    }
  }
  for (const locked of lock.skills) {
    const source = sources.skills.find((skill) => skill.name === locked.name);
    if (!source) throw new Error(`${locked.name}: missing source declaration`);
    if (locked.repository !== source.repository) {
      throw new Error(`${locked.name}: locked repository differs from source declaration`);
    }
    const auditableGitRevision =
      typeof locked.revision === 'string' &&
      /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(locked.revision);
    if (!auditableGitRevision && !(allowInstalled && locked.revision?.startsWith('installed:'))) {
      throw new Error(
        `${locked.name}: lock revision is not an auditable Git commit; ` +
          'regenerate with npm run skills:update before release',
      );
    }
    const patches = [];
    for (const patchPath of source.patches ?? []) {
      const absolutePath = safeJoin(resourcesRoot, patchPath);
      patches.push({
        path: patchPath,
        sha256: sha256(await fs.readFile(absolutePath)),
      });
    }
    if (JSON.stringify(patches) !== JSON.stringify(locked.patches ?? [])) {
      throw new Error(`${locked.name}: builtin patch set differs from the lock file`);
    }
    const skillRoot = safeJoin(vendorRoot, locked.name);
    await validateSkill(locked.name, skillRoot, source.forbiddenText ?? []);
    const actual = await hashFiles(skillRoot);
    if (JSON.stringify(actual) !== JSON.stringify(locked.files)) {
      throw new Error(
        `${locked.name}: vendored files differ from resources/builtin-skills.lock.json`,
      );
    }
  }
  console.log(`Builtin skill snapshot verified: ${sourceNames.join(', ')}`);
}

async function updateSnapshot(sources) {
  const temporaryRoot = await fs.mkdtemp(path.join(tmpdir(), 'kodax-space-builtin-skills-'));
  const stagingRoot = path.join(resourcesRoot, `.builtin-skills-stage-${process.pid}`);
  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.mkdir(stagingRoot, { recursive: true });
  const lockSkills = [];
  try {
    for (const skill of sources.skills) {
      let checkoutRoot;
      let revision;
      if (fromInstalled) {
        checkoutRoot = safeJoin(path.join(homedir(), '.agents', 'skills'), skill.installedPath);
        revision = `installed:${sha256(await fs.readFile(path.join(checkoutRoot, 'SKILL.md')))}`;
      } else {
        checkoutRoot = path.join(temporaryRoot, skill.name);
        await fs.mkdir(checkoutRoot, { recursive: true });
        runGit(['init', '--quiet'], checkoutRoot);
        runGit(['remote', 'add', 'origin', skill.repository], checkoutRoot);
        runGit(
          [
            '-c',
            'core.autocrlf=false',
            '-c',
            'core.eol=lf',
            'fetch',
            '--depth',
            '1',
            'origin',
            skill.ref,
          ],
          checkoutRoot,
        );
        runGit(
          [
            '-c',
            'core.autocrlf=false',
            '-c',
            'core.eol=lf',
            'checkout',
            '--quiet',
            '--detach',
            'FETCH_HEAD',
          ],
          checkoutRoot,
        );
        revision = runGit(['rev-parse', 'HEAD'], checkoutRoot);
        if (revision !== skill.ref) {
          throw new Error(
            `${skill.name}: fetched revision ${revision} differs from pinned ref ${skill.ref}`,
          );
        }
      }

      const licenseSource = safeJoin(checkoutRoot, skill.license.sourcePath);
      const licenseHash = sha256(await fs.readFile(licenseSource));
      if (licenseHash !== skill.license.sha256) {
        throw new Error(
          `${skill.name}: license changed (${licenseHash}); review it before updating the approved hash`,
        );
      }

      const sourceRoot = safeJoin(checkoutRoot, skill.sourceSubdir);
      const destinationRoot = safeJoin(stagingRoot, skill.name);
      await fs.mkdir(destinationRoot, { recursive: true });
      await copyTree(sourceRoot, destinationRoot, skill.exclude ?? []);
      const licenseDestination = safeJoin(destinationRoot, skill.license.destinationPath);
      await fs.mkdir(path.dirname(licenseDestination), { recursive: true });
      await fs.copyFile(licenseSource, licenseDestination);
      const patches = [];
      for (const patchPath of skill.patches ?? []) {
        const absolutePatchPath = safeJoin(resourcesRoot, patchPath);
        const destinationPrefix = toPosix(path.relative(repoRoot, destinationRoot));
        runGit(
          [
            'apply',
            '--check',
            '--unidiff-zero',
            '--whitespace=nowarn',
            `--directory=${destinationPrefix}`,
            absolutePatchPath,
          ],
          repoRoot,
        );
        runGit(
          [
            'apply',
            '--unidiff-zero',
            '--whitespace=nowarn',
            `--directory=${destinationPrefix}`,
            absolutePatchPath,
          ],
          repoRoot,
        );
        patches.push({
          path: patchPath,
          sha256: sha256(await fs.readFile(absolutePatchPath)),
        });
      }
      await validateSkill(skill.name, destinationRoot, skill.forbiddenText ?? []);
      lockSkills.push({
        name: skill.name,
        repository: skill.repository,
        revision,
        patches,
        files: await hashFiles(destinationRoot),
      });
      console.log(`Prepared ${skill.name} at ${revision}`);
    }

    assertManagedDestination(vendorRoot);
    await fs.rm(vendorRoot, { recursive: true, force: true });
    await fs.rename(stagingRoot, vendorRoot);
    const lock = {
      schemaVersion: 1,
      sourcesSha256: sha256(JSON.stringify(sources)),
      skills: lockSkills,
    };
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    console.log(`Updated ${lockSkills.length} builtin skill snapshot(s).`);
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

const sources = await readSources();
if (check) {
  await checkSnapshot(sources);
} else {
  await updateSnapshot(sources);
}
