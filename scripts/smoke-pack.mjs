// Post-build smoke check for installer artifacts (F010).
//
// 跑在 electron-builder 之后；目标：
//   1. 安装包文件存在
//   2. 文件大小 < 200 MB（F010 验收硬指标）
//   3. asar 内核心文件齐全（main.js / preload.js / renderer index.html）
//
// 不做：实际 install / launch—— Windows 上 NSIS 安装包是 GUI 流程，CI 里 driver 困难。
// 真正"装 → 启 → 退"的 e2e 留 v0.1.0-rc.1 用 spectron 或 playwright-electron 做（F010 设计 step 5）。
//
// 这层 smoke 抓的是 build 配置漂移：忘了 bundle main.js / files glob 把 dist 排除 / 误塞超大依赖。

import { constants as fsConstants, promises as fs, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
// Release candidates can be verified without replacing a developer's current
// out/ artifacts. Relative overrides remain anchored to the repository root.
const outDir = path.resolve(rootDir, process.env.SPACE_PACK_OUT_DIR || 'out');
const rootPackage = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const SPACE_VERSION = String(rootPackage.version ?? '').trim();
const KODAX_VERSION = String(rootPackage.dependencies?.['@kodax-ai/kodax'] ?? '').trim();
const SIZE_LIMIT_BYTES = 200 * 1024 * 1024;
const require = createRequire(import.meta.url);
const electronBin = require('electron');
const KODAX_PUBLIC_FACADE_FILES = [
  'index.js',
  'sdk-a2a.js',
  'sdk-agent.js',
  'sdk-coding.js',
  'sdk-experimental-memory.js',
  'sdk-llm.js',
  'sdk-mcp.js',
  'sdk-media.js',
  'sdk-repl.js',
  'sdk-runtime.js',
  'sdk-sandbox.js',
  'sdk-session.js',
  'sdk-skills.js',
];

function fail(msg) {
  console.error(`[smoke-pack] FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`[smoke-pack] OK: ${msg}`);
}

function resolvePackagedDependencyMetadata(files, fromMetadataPath, dependency) {
  const dependencyParts = dependency.split('/');
  let current = path.posix.dirname(fromMetadataPath);
  while (true) {
    const candidate = path.posix.join(current, 'node_modules', ...dependencyParts, 'package.json');
    const normalizedCandidate = candidate.startsWith('/') ? candidate : `/${candidate}`;
    if (files.has(normalizedCandidate)) return normalizedCandidate;
    const parent = path.posix.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursive(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  return out;
}

function keyringNativePatternForAsar(asarPath) {
  const normalizedPath = asarPath.replace(/\\/g, '/');
  if (normalizedPath.includes('/mac-arm64/')) {
    return /keyring\.darwin-arm64\.node$/;
  }
  if (normalizedPath.includes('/mac-universal/')) {
    return /keyring\.darwin-(universal|x64|arm64)\.node$/;
  }
  if (normalizedPath.includes('/mac/')) {
    // electron-builder may use out/mac for a single-arch mac build regardless
    // of the target arch. The DMG artifact name is the reliable release signal.
    const macArtifacts = safeReadOutEntries().filter((name) => /\.dmg$/i.test(name));
    const hasArm64Dmg = macArtifacts.some((name) => /-arm64\.dmg$/i.test(name));
    const hasX64Dmg = macArtifacts.some((name) => /-x64\.dmg$/i.test(name));
    if (hasArm64Dmg && !hasX64Dmg) return /keyring\.darwin-arm64\.node$/;
    if (hasX64Dmg && !hasArm64Dmg) return /keyring\.darwin-x64\.node$/;
    if (process.arch === 'arm64') return /keyring\.darwin-arm64\.node$/;
    if (process.arch === 'x64') return /keyring\.darwin-x64\.node$/;
    return /keyring\.darwin-x64\.node$/;
  }

  if (process.platform === 'win32') {
    if (process.arch === 'x64') return /keyring\.win32-x64-msvc\.node$/;
    if (process.arch === 'arm64') return /keyring\.win32-arm64-msvc\.node$/;
    if (process.arch === 'ia32') return /keyring\.win32-ia32-msvc\.node$/;
  }
  if (process.platform === 'darwin') {
    if (process.arch === 'x64') return /keyring\.darwin-x64\.node$/;
    if (process.arch === 'arm64') return /keyring\.darwin-arm64\.node$/;
    return /keyring\.darwin-(universal|x64|arm64)\.node$/;
  }
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return /keyring\.linux-x64-(gnu|musl)\.node$/;
    if (process.arch === 'arm64') return /keyring\.linux-arm64-(gnu|musl)\.node$/;
    if (process.arch === 'arm') return /keyring\.linux-arm-gnueabihf\.node$/;
    if (process.arch === 'riscv64') return /keyring\.linux-riscv64-gnu\.node$/;
  }
  return /keyring\..+\.node$/;
}

function nodePtyRuntimePatternsForAsar(asarPath) {
  const normalizedPath = asarPath.replace(/\\/g, '/');
  let platform = process.platform;
  let arch = process.arch;

  if (normalizedPath.includes('/win-unpacked/')) {
    platform = 'win32';
    arch = 'x64';
  } else if (normalizedPath.includes('/linux-unpacked/')) {
    platform = 'linux';
    arch = 'x64';
  } else if (normalizedPath.includes('/mac-arm64/')) {
    platform = 'darwin';
    arch = 'arm64';
  } else if (normalizedPath.includes('/mac/')) {
    platform = 'darwin';
    const macArtifacts = safeReadOutEntries().filter((name) => /\.dmg$/i.test(name));
    const hasArm64Dmg = macArtifacts.some((name) => /-arm64\.dmg$/i.test(name));
    const hasX64Dmg = macArtifacts.some((name) => /-x64\.dmg$/i.test(name));
    if (hasArm64Dmg && !hasX64Dmg) arch = 'arm64';
    else if (hasX64Dmg && !hasArm64Dmg) arch = 'x64';
  }

  if (platform === 'win32') {
    const dir = arch === 'arm64' ? 'win32-arm64' : 'win32-x64';
    return [
      new RegExp(`/node_modules/node-pty/prebuilds/${dir}/conpty\\.node$`),
      new RegExp(`/node_modules/node-pty/prebuilds/${dir}/pty\\.node$`),
      new RegExp(`/node_modules/node-pty/prebuilds/${dir}/conpty/conpty\\.dll$`),
      new RegExp(`/node_modules/node-pty/prebuilds/${dir}/conpty/OpenConsole\\.exe$`),
    ];
  }

  if (platform === 'darwin') {
    const dir = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    return [
      new RegExp(`/node_modules/node-pty/prebuilds/${dir}/pty\\.node$`),
      new RegExp(`/node_modules/node-pty/prebuilds/${dir}/spawn-helper$`),
    ];
  }

  // Linux: node-pty's JS computes a spawn-helper path for every Unix platform,
  // but node-pty 1.1.0's native code only uses that helper on macOS. Linux uses
  // forkpty(3) + execvp(3), and binding.gyp does not build spawn-helper there.
  // Requiring it in Linux packages would therefore block valid builds.
  const nativeDir = String.raw`node_modules/node-pty/(?:build/Release|prebuilds/linux-(?:x64|arm64|arm))`;
  return [new RegExp(`/${nativeDir}/pty\\.node$`)];
}

function safeReadOutEntries() {
  try {
    return readdirSync(outDir);
  } catch {
    return [];
  }
}

async function findInstaller() {
  let entries;
  try {
    entries = await fs.readdir(outDir);
  } catch (err) {
    fail(`out/ directory not found: ${err.message}`);
  }
  // 平台对应：Win .exe / mac .dmg / Linux .AppImage (future)
  const packageMetadata = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
  const currentVersion = String(packageMetadata.version ?? '').trim();
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(currentVersion)) {
    fail(`package.json has an invalid release version: ${currentVersion || 'empty'}`);
  }

  // Only current-version files count. Stale files in a developer's out/
  // directory must not mask a failed or incomplete package build.
  const candidates = entries.filter(
    (name) =>
      /\.(exe|dmg|AppImage|deb|zip)$/i.test(name) &&
      name.includes(currentVersion) &&
      !/^builder-/.test(name),
  );
  if (candidates.length === 0) {
    fail(`no installer artifact in out/ (entries: ${entries.join(', ') || 'empty'})`);
  }

  const requiredPatterns =
    process.platform === 'win32'
      ? [/Setup-.*\.exe$/i, /Portable-.*\.exe$/i]
      : process.platform === 'darwin'
        ? [/\.dmg$/i]
        : process.platform === 'linux'
          ? [/\.AppImage$/i, /\.deb$/i]
          : [];
  for (const pattern of requiredPatterns) {
    if (!candidates.some((name) => pattern.test(name))) {
      fail(
        `required ${currentVersion} platform artifact missing (expected ${pattern}; ` +
          `found: ${candidates.join(', ')})`,
      );
    }
  }
  return candidates.map((name) => path.join(outDir, name));
}

async function checkSize(installerPath) {
  const stat = await fs.stat(installerPath);
  const mb = (stat.size / (1024 * 1024)).toFixed(2);
  if (stat.size > SIZE_LIMIT_BYTES) {
    fail(`${path.basename(installerPath)} is ${mb} MB — exceeds 200 MB cap`);
  }
  ok(`${path.basename(installerPath)} = ${mb} MB (< 200 MB cap)`);
}

function readIcoImages(ico) {
  if (ico.length < 6 || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) {
    fail('resources/icon.ico is not a valid ICO file');
  }
  const count = ico.readUInt16LE(4);
  if (count === 0 || ico.length < 6 + count * 16) {
    fail('resources/icon.ico has no valid image entries');
  }

  const images = [];
  for (let index = 0; index < count; index++) {
    const entryOffset = 6 + index * 16;
    const width = ico[entryOffset] === 0 ? 256 : ico[entryOffset];
    const height = ico[entryOffset + 1] === 0 ? 256 : ico[entryOffset + 1];
    const size = ico.readUInt32LE(entryOffset + 8);
    const offset = ico.readUInt32LE(entryOffset + 12);
    if (size === 0 || offset + size > ico.length) {
      fail(`resources/icon.ico entry ${index} is out of bounds`);
    }
    images.push({ width, height, bytes: ico.subarray(offset, offset + size) });
  }
  return images;
}

async function checkWindowsExecutableIcons(installerPaths) {
  if (process.platform !== 'win32') return;

  const icoPath = path.join(rootDir, 'resources', 'icon.ico');
  const ico = await fs.readFile(icoPath);
  const images = readIcoImages(ico);
  const requiredSizes = [16, 32, 48, 256];
  for (const size of requiredSizes) {
    if (!images.some((image) => image.width === size && image.height === size)) {
      fail(`resources/icon.ico is missing required ${size}x${size} entry`);
    }
  }

  // NSIS and rcedit embed the PNG-compressed ICO image bytes unchanged in the
  // PE resource table. Requiring the 256px entry catches a portable launcher
  // that was produced without an application icon while avoiding shell-cache
  // dependent visual checks on CI.
  const marker = images.find((image) => image.width === 256 && image.height === 256)?.bytes;
  if (!marker) fail('resources/icon.ico is missing its 256x256 marker image');

  const executables = installerPaths.filter((installerPath) => /\.exe$/i.test(installerPath));
  const unpackedExecutable = path.join(outDir, 'win-unpacked', 'KodaX Space.exe');
  if (await pathExists(unpackedExecutable)) {
    executables.push(unpackedExecutable);
  }
  for (const executable of executables) {
    const bytes = await fs.readFile(executable);
    if (bytes.indexOf(marker) < 0) {
      fail(`${path.basename(executable)} does not contain the configured application icon`);
    }
    ok(`${path.basename(executable)} contains the configured application icon`);
  }
}

async function findAsarPaths() {
  // electron-builder 把 app.asar 放在不同位置：
  //   Win unpacked:   out/win-unpacked/resources/app.asar
  //   mac unpacked:   out/mac/KodaX Space.app/Contents/Resources/app.asar
  //   universal:      out/mac-universal/KodaX Space.app/Contents/Resources/app.asar
  //   Linux unpacked: out/linux-unpacked/resources/app.asar
  const candidates = [
    path.join(outDir, 'win-unpacked', 'resources', 'app.asar'),
    path.join(outDir, 'mac', 'KodaX Space.app', 'Contents', 'Resources', 'app.asar'),
    path.join(outDir, 'mac-arm64', 'KodaX Space.app', 'Contents', 'Resources', 'app.asar'),
    path.join(outDir, 'mac-universal', 'KodaX Space.app', 'Contents', 'Resources', 'app.asar'),
    path.join(outDir, 'linux-unpacked', 'resources', 'app.asar'),
  ];
  const asarPaths = [];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) asarPaths.push(candidate);
  }
  if (asarPaths.length === 0) {
    fail(`app.asar not found in any expected location (checked: ${candidates.join(', ')})`);
  }
  return asarPaths;
}

async function checkAsarContents(asarPath) {
  ok(`app.asar located at ${asarPath}`);

  const sourceBootIcon = await fs.readFile(path.join(rootDir, 'resources', 'icon.png'));
  const packagedBootIconPath = path.join(path.dirname(asarPath), 'icon.png');
  const packagedBootIcon = await fs.readFile(packagedBootIconPath).catch(() => null);
  if (!packagedBootIcon || !packagedBootIcon.equals(sourceBootIcon)) {
    fail(`Boot splash runtime icon is missing or differs: ${packagedBootIconPath}`);
  }
  ok('Boot splash runtime icon matches resources/icon.png');

  if (asarPath.replace(/\\/g, '/').includes('/win-unpacked/')) {
    const sourceIcon = await fs.readFile(path.join(rootDir, 'resources', 'icon.ico'));
    const packagedIconPath = path.join(path.dirname(asarPath), 'icon.ico');
    const packagedIcon = await fs.readFile(packagedIconPath).catch(() => null);
    if (!packagedIcon || !packagedIcon.equals(sourceIcon)) {
      fail(`Windows BrowserWindow runtime icon is missing or differs: ${packagedIconPath}`);
    }
    ok('Windows BrowserWindow runtime icon matches resources/icon.ico');
  }

  // 用 @electron/asar 的程序化 API 列内容——避免 spawn .cmd 的 Windows EUNKNOWN 坑
  // electron-builder 传递依赖了 @electron/asar
  let files = [];
  try {
    const asar = await import('@electron/asar');
    const list = asar.listPackage(asarPath);
    files = list;
  } catch (err) {
    // fallback：尝试 spawn asar CLI（shell: true on Windows for .cmd 兼容）
    const asarBin = path.join(
      rootDir,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'asar.cmd' : 'asar',
    );
    const result = spawnSync(asarBin, ['list', asarPath], {
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
      fail(
        `asar list failed: programmatic (${err.message}) + CLI (status=${result.status}, ` +
          `stderr=${result.stderr || 'empty'})`,
      );
    }
    files = result.stdout.split(/\r?\n/);
  }
  // 跨平台归一化：asar list 在 Windows 上返回 `\dist-electron\main.js`
  const normalized = files.map((f) => f.replace(/\\/g, '/'));
  const normalizedSet = new Set(normalized);
  const resourceRootDir = path.dirname(asarPath);
  const resourceNodeModulesDir = path.join(resourceRootDir, 'node_modules');
  const resourceNodeModuleFiles = (await pathExists(resourceNodeModulesDir))
    ? (await listFilesRecursive(resourceNodeModulesDir)).map((file) => file.replace(/\\/g, '/'))
    : [];
  const physicalResourceSet = new Set(
    resourceNodeModuleFiles.map(
      (file) => `/${path.relative(resourceRootDir, file).replace(/\\/g, '/')}`,
    ),
  );
  const devLinkMarker = '/node_modules/@kodax-ai/kodax/.kodax-space-dev-link';
  if (normalized.some((file) => file === devLinkMarker || file.endsWith(devLinkMarker))) {
    fail('KodaX development staging marker leaked into app.asar');
  }

  let packagedKodax;
  let asar;
  try {
    asar = await import('@electron/asar');
    packagedKodax = JSON.parse(
      asar
        .extractFile(
          asarPath,
          ['node_modules', '@kodax-ai', 'kodax', 'package.json'].join(path.sep),
        )
        .toString('utf8'),
    );
  } catch (error) {
    fail(
      `could not read packaged KodaX metadata: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (packagedKodax.version !== KODAX_VERSION) {
    fail(
      `app.asar contains @kodax-ai/kodax@${packagedKodax.version ?? '(unknown)'}; ` +
        `the root release manifest requires exact ${KODAX_VERSION}`,
    );
  }
  ok(`app.asar contains exact @kodax-ai/kodax@${KODAX_VERSION}`);
  if (packagedKodax.kodaxRuntimeContracts?.integrationConfigResilience !== 1) {
    fail('packaged KodaX metadata does not advertise integrationConfigResilience v1');
  }
  ok('packaged KodaX metadata advertises integrationConfigResilience v1');

  let packagedRendererHtml;
  try {
    packagedRendererHtml = asar
      .extractFile(asarPath, ['apps', 'desktop', 'dist', 'index.html'].join(path.sep))
      .toString('utf8');
  } catch (error) {
    fail(
      `could not read packaged renderer bootstrap document: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (/boot-splash|boot-spinner|Starting up/.test(packagedRendererHtml)) {
    fail('packaged renderer still contains the retired loading surface');
  }
  if (!/<div id="root"><\/div>/.test(packagedRendererHtml)) {
    fail('packaged renderer bootstrap root is not empty');
  }
  ok('packaged renderer cannot flash the retired loading surface');

  // Traverse every required dependency reachable from the packaged KodaX
  // package using Node's ancestor lookup shape. A similarly named dependency
  // nested under an unrelated package must not satisfy this check. This catches
  // the observed tsx -> get-tsconfig omission and future transitive gaps.
  const kodaxMetadataPath = '/node_modules/@kodax-ai/kodax/package.json';
  const packagedDependencyFiles = new Set([...normalizedSet, ...physicalResourceSet]);
  const metadataQueue = [kodaxMetadataPath];
  const metadataByPath = new Map([[kodaxMetadataPath, packagedKodax]]);
  const visitedMetadata = new Set();
  while (metadataQueue.length > 0) {
    const metadataPath = metadataQueue.shift();
    if (visitedMetadata.has(metadataPath)) continue;
    visitedMetadata.add(metadataPath);
    const metadata = metadataByPath.get(metadataPath);
    for (const dependency of Object.keys(metadata.dependencies ?? {})) {
      const dependencyMetadataPath = resolvePackagedDependencyMetadata(
        packagedDependencyFiles,
        metadataPath,
        dependency,
      );
      if (!dependencyMetadataPath) {
        fail(
          `${metadata.name ?? metadataPath}@${metadata.version ?? '(unknown)'} cannot resolve ` +
            `required dependency ${dependency} from app.asar`,
        );
      }
      if (!metadataByPath.has(dependencyMetadataPath)) {
        try {
          const metadataBytes = normalizedSet.has(dependencyMetadataPath)
            ? asar.extractFile(
                asarPath,
                dependencyMetadataPath.replace(/^\//, '').split('/').join(path.sep),
              )
            : await fs.readFile(
                path.join(
                  resourceRootDir,
                  ...dependencyMetadataPath.replace(/^\//, '').split('/'),
                ),
              );
          metadataByPath.set(
            dependencyMetadataPath,
            JSON.parse(metadataBytes.toString('utf8')),
          );
        } catch (error) {
          fail(
            `could not read dependency metadata at ${dependencyMetadataPath}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      metadataQueue.push(dependencyMetadataPath);
    }
  }
  ok(
    `packaged KodaX required dependency closure is ancestor-resolvable ` +
      `(${visitedMetadata.size} packages)`,
  );

  const required = [
    '/dist-electron/main.js',
    '/dist-electron/preload.js',
    '/dist-electron/partner-source-extraction-worker.js',
    '/apps/desktop/dist/index.html',
    '/package.json',
  ];
  for (const req of required) {
    if (!normalized.some((f) => f === req || f.endsWith(req))) {
      fail(`required file missing from asar: ${req}`);
    }
    ok(`asar contains ${req}`);
  }

  // KodaX's public Runtime facade uses Worker sidecars. The SDK
  // resolves these files relative to its installed dist directory, so an
  // installer that prunes any one of them can pass compilation and fail only
  // when Runtime or a constructed handler first starts.
  const kodaxRuntimeRequired = [
    ...KODAX_PUBLIC_FACADE_FILES.map((file) => `/node_modules/@kodax-ai/kodax/dist/${file}`),
    '/node_modules/@kodax-ai/kodax/dist/runtime-worker.js',
    '/node_modules/@kodax-ai/kodax/dist/constructed-handler-worker.js',
    '/node_modules/@kodax-ai/kodax/dist/semantic-worker.js',
    // Windows tray "quit completely" and stale-daemon recovery launch this
    // trusted CLI entry in Electron's Node mode after releasing Space's client.
    '/node_modules/@kodax-ai/kodax/dist/kodax_cli.js',
    '/node_modules/@kodax-ai/kodax/dist/provider-capabilities.json',
    '/node_modules/@kodax-ai/kodax/scripts/kodax-bin.cjs',
  ];
  for (const req of kodaxRuntimeRequired) {
    if (!normalized.some((f) => f === req || f.endsWith(req))) {
      fail(`KodaX ${KODAX_VERSION} Runtime dependency missing from asar: ${req}`);
    }
    ok(`asar contains ${req}`);
  }

  // Builtin skills are loaded from Markdown at runtime. The main files glob
  // intentionally removes package documentation, so verify the dedicated
  // KodaX builtin FileSet restored every shipped skill Markdown resource.
  const kodaxBuiltinSourceDir = path.join(
    rootDir,
    'node_modules',
    '@kodax-ai',
    'kodax',
    'dist',
    'builtin',
  );
  const kodaxBuiltinMarkdownFiles = (await listFilesRecursive(kodaxBuiltinSourceDir)).filter(
    (file) => /\.(?:md|markdown)$/i.test(file),
  );
  if (kodaxBuiltinMarkdownFiles.length === 0) {
    fail(`KodaX ${KODAX_VERSION} SDK contains no builtin skill Markdown resources`);
  }
  for (const sourceFile of kodaxBuiltinMarkdownFiles) {
    const relative = path.relative(kodaxBuiltinSourceDir, sourceFile).replace(/\\/g, '/');
    const req = `/node_modules/@kodax-ai/kodax/dist/builtin/${relative}`;
    if (!normalized.some((file) => file === req || file.endsWith(req))) {
      fail(`KodaX ${KODAX_VERSION} builtin skill resource missing from asar: ${req}`);
    }
  }
  ok(
    `asar contains all ${kodaxBuiltinMarkdownFiles.length} KodaX ${KODAX_VERSION} ` +
      'builtin skill Markdown resources',
  );

  // Space-owned builtins deliberately live beside app.asar, not inside it:
  // external tools must be able to execute their Python/Node/shell scripts and
  // read binary assets through normal filesystem paths. Compare every packaged
  // file against the checked-in integrity lock so broad documentation filters,
  // stale snapshots, or a lost watermark patch cannot silently ship.
  const spaceBuiltinLock = JSON.parse(
    await fs.readFile(path.join(rootDir, 'resources', 'builtin-skills.lock.json'), 'utf8'),
  );
  const packagedSpaceBuiltinRoot = path.join(path.dirname(asarPath), 'builtin-skills');
  const expectedSpaceBuiltinFiles = new Set();
  for (const skill of spaceBuiltinLock.skills ?? []) {
    for (const file of skill.files ?? []) {
      expectedSpaceBuiltinFiles.add(`${skill.name}/${file.path}`);
    }
  }
  const actualSpaceBuiltinFiles = new Set(
    (await listFilesRecursive(packagedSpaceBuiltinRoot)).map((file) =>
      path.relative(packagedSpaceBuiltinRoot, file).replace(/\\/g, '/'),
    ),
  );
  const missingSpaceBuiltinFiles = [...expectedSpaceBuiltinFiles].filter(
    (file) => !actualSpaceBuiltinFiles.has(file),
  );
  const unexpectedSpaceBuiltinFiles = [...actualSpaceBuiltinFiles].filter(
    (file) => !expectedSpaceBuiltinFiles.has(file),
  );
  if (missingSpaceBuiltinFiles.length > 0) {
    fail(`Space builtin resources missing outside asar: ${missingSpaceBuiltinFiles.join(', ')}`);
  }
  if (unexpectedSpaceBuiltinFiles.length > 0) {
    fail(
      `Unexpected Space builtin resources found outside asar: ` +
        unexpectedSpaceBuiltinFiles.join(', '),
    );
  }
  let verifiedSpaceBuiltinFiles = 0;
  for (const skill of spaceBuiltinLock.skills ?? []) {
    for (const file of skill.files ?? []) {
      const packagedFile = path.join(packagedSpaceBuiltinRoot, skill.name, file.path);
      let content;
      try {
        content = await fs.readFile(packagedFile);
      } catch (err) {
        fail(
          `Space builtin resource missing outside asar: ${skill.name}/${file.path} ` +
            `(${err instanceof Error ? err.message : String(err)})`,
        );
      }
      const digest = createHash('sha256').update(content).digest('hex');
      if (content.byteLength !== file.bytes || digest !== file.sha256) {
        fail(`Space builtin resource differs from lock: ${skill.name}/${file.path}`);
      }
      verifiedSpaceBuiltinFiles += 1;
    }
  }
  if (verifiedSpaceBuiltinFiles === 0) {
    fail('resources/builtin-skills.lock.json contains no Space builtin files');
  }
  ok(
    `filesystem resources contain all ${verifiedSpaceBuiltinFiles} locked Space builtin skill files`,
  );

  // Runtime dependency guards: fail the package smoke when dynamic/native
  // modules needed at app startup are missing from asar or app.asar.unpacked.
  // Keyring is loaded dynamically by the packaged main process; keep a hard
  // smoke guard so provider keys do not silently fall back to memory storage.
  const keyringRequired = [
    '/node_modules/@napi-rs/keyring/keytar.js',
    '/node_modules/@napi-rs/keyring/index.js',
    '/node_modules/@napi-rs/keyring/package.json',
  ];
  for (const req of keyringRequired) {
    if (!normalized.some((f) => f === req || f.endsWith(req))) {
      fail(
        `keychain runtime missing from asar: ${req}. ` +
          'Packaged provider keys will fall back to memory only.',
      );
    }
    ok(`asar contains ${req}`);
  }

  const nativePattern = keyringNativePatternForAsar(asarPath);
  const hasKeyringNativeInAsar = normalized.some(
    (f) => /\/node_modules\/@napi-rs\/keyring-[^/]+\/.+\.node$/.test(f) && nativePattern.test(f),
  );
  const unpackedDir = `${asarPath}.unpacked`;
  const unpackedFiles = (await pathExists(unpackedDir))
    ? (await listFilesRecursive(unpackedDir)).map((f) => f.replace(/\\/g, '/'))
    : [];
  const asrtAsarPrefix = '/node_modules/@anthropic-ai/sandbox-runtime/';
  if (normalized.some((file) => file.startsWith(asrtAsarPrefix))) {
    fail(
      '@anthropic-ai/sandbox-runtime leaked into app.asar. Its platform helpers must be ' +
        'resolved from physical resources/node_modules paths.',
    );
  }
  const requiredPhysicalSandboxFiles = [
    '/node_modules/@anthropic-ai/sandbox-runtime/package.json',
    '/node_modules/@anthropic-ai/sandbox-runtime/dist/index.js',
    '/node_modules/@anthropic-ai/sandbox-runtime/vendor/seccomp/arm64/apply-seccomp',
    '/node_modules/@anthropic-ai/sandbox-runtime/vendor/seccomp/x64/apply-seccomp',
    '/node_modules/@anthropic-ai/sandbox-runtime/vendor/srt-win/arm64/srt-win.exe',
    '/node_modules/@anthropic-ai/sandbox-runtime/vendor/srt-win/x64/srt-win.exe',
    '/node_modules/@anthropic-ai/sandbox-runtime/node_modules/commander/package.json',
    '/node_modules/@pondwader/socks5-server/package.json',
    '/node_modules/node-forge/package.json',
    '/node_modules/zod/package.json',
  ];
  for (const required of requiredPhysicalSandboxFiles) {
    if (!resourceNodeModuleFiles.some((file) => file.endsWith(required))) {
      fail(`sandbox runtime filesystem resource missing: ${required}`);
    }
  }
  if (process.platform === 'linux') {
    const helperArch =
      process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : undefined;
    if (!helperArch) {
      fail(`unsupported Linux architecture for sandbox helper verification: ${process.arch}`);
    }
    const applySeccompPath = path.join(
      resourceNodeModulesDir,
      '@anthropic-ai',
      'sandbox-runtime',
      'vendor',
      'seccomp',
      helperArch,
      'apply-seccomp',
    );
    try {
      await fs.access(applySeccompPath, fsConstants.X_OK);
    } catch (error) {
      fail(
        `sandbox runtime helper is not executable: ${applySeccompPath} ` +
          `(${error instanceof Error ? error.message : String(error)})`,
      );
    }
    ok(`ASRT ${helperArch} seccomp helper is executable`);
  }
  ok('ASRT and its runtime dependency chain are physical filesystem resources');
  const hasKeyringNativeUnpacked = unpackedFiles.some(
    (f) => /\/node_modules\/@napi-rs\/keyring-[^/]+\/.+\.node$/.test(f) && nativePattern.test(f),
  );
  if (!hasKeyringNativeInAsar && !hasKeyringNativeUnpacked) {
    fail(
      `current-platform @napi-rs/keyring native binding missing (expected ${nativePattern}). ` +
        'Packaged provider keys will fall back to memory only.',
    );
  }
  if (!hasKeyringNativeUnpacked) {
    fail(
      `@napi-rs/keyring native binding is present but not unpacked from asar (expected ${nativePattern}). ` +
        'Native .node modules must live under app.asar.unpacked.',
    );
  }
  ok('@napi-rs/keyring native binding present in app.asar.unpacked');

  const sqliteRequired = [
    '/node_modules/better-sqlite3/package.json',
    '/node_modules/better-sqlite3/lib/index.js',
    '/node_modules/bindings/package.json',
    '/node_modules/bindings/bindings.js',
    '/node_modules/file-uri-to-path/package.json',
    '/node_modules/file-uri-to-path/index.js',
  ];
  for (const req of sqliteRequired) {
    if (!normalizedSet.has(req)) {
      fail(`better-sqlite3 resolver chain missing from asar: ${req}`);
    }
  }
  const hasSqliteNativeUnpacked = unpackedFiles.some((file) =>
    /\/node_modules\/better-sqlite3\/build\/Release\/better_sqlite3\.node$/.test(file),
  );
  if (!hasSqliteNativeUnpacked) {
    fail(
      'better-sqlite3 native binding is missing from app.asar.unpacked; ' +
        'the packaged main process cannot open its artifact catalog.',
    );
  }
  ok('better-sqlite3 resolver chain and native binding are packaged');

  // yaml's dist/doc files are runtime code. A previous files glob stripped this
  // directory from node_modules and broke packaged startup.
  const yamlComposer = normalized.some((f) =>
    /\/node_modules\/yaml\/dist\/compose\/composer\.js$/.test(f),
  );
  if (yamlComposer) {
    const yamlDoc = normalized.some((f) =>
      /\/node_modules\/yaml\/dist\/doc\/directives\.js$/.test(f),
    );
    if (!yamlDoc) {
      fail(
        'yaml packed but yaml/dist/doc/directives.js missing — runtime doc/ stripped. ' +
          'Check electron-builder.yml files globs do not exclude **/doc/** under node_modules.',
      );
    }
    ok('yaml/dist/doc/directives.js present (runtime doc/ not stripped)');
  }

  // 只有 jest 约定的 __tests__/__mocks__ 才该被排除；它们若出现说明排除 glob 没生效（仅 WARN，体积问题）。
  // 注意：doc/docs/test/example 这类目录现在是“故意保留”的（可能是包的运行时代码），不再当泄漏报警。
  const leaks = normalized.filter((f) => /\/(__tests__|__mocks__)\//.test(f));

  // Terminal runtime: node-pty is required dynamically from the Electron main
  // process. It comes from the desktop workspace, so root-level packaging must
  // explicitly include it and unpack native bits.
  const allPackagedFiles = [...normalized, ...unpackedFiles, ...resourceNodeModuleFiles];
  const hasNodePtyEntrypoint = allPackagedFiles.some((f) =>
    /\/node_modules\/node-pty\/lib\/index\.js$/.test(f),
  );
  if (!hasNodePtyEntrypoint) {
    fail(
      'node-pty JS runtime missing from package. Built-in Terminal will fail ' +
        'with "Cannot find module node-pty".',
    );
  }
  ok('node-pty JS runtime present');

  const nativeFilesystemFiles = [...unpackedFiles, ...resourceNodeModuleFiles];
  for (const pattern of nodePtyRuntimePatternsForAsar(asarPath)) {
    if (!nativeFilesystemFiles.some((f) => pattern.test(f))) {
      fail(
        `node-pty native runtime missing from filesystem resources (expected ${pattern}). ` +
          'Built-in Terminal cannot create a PTY.',
      );
    }
  }
  ok('node-pty native runtime present in filesystem resources');

  if (leaks.length > 0) {
    console.warn(
      `[smoke-pack] WARN: ${leaks.length} __tests__/__mocks__ paths leaked into asar (first 5):`,
    );
    leaks.slice(0, 5).forEach((f) => console.warn(`  - ${f}`));
  } else {
    ok('no __tests__/__mocks__ leaked into asar');
  }
}

function checkPackagedSqliteExecutesFromAsar(asarPath) {
  const packageEntry = path.join(asarPath, 'package.json');
  const marker = 'PACKAGED_SQLITE_PROBE=ok';
  const probeSource = `
const { createRequire } = require('node:module');
try {
  const requireFromPackage = createRequire(${JSON.stringify(packageEntry)});
  const Database = requireFromPackage('better-sqlite3');
  const database = new Database(':memory:');
  const result = database.prepare('select 42 as value').get();
  database.close();
  if (result?.value !== 42) throw new Error('unexpected query result');
  process.stdout.write(${JSON.stringify(marker)});
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
`;
  const result = spawnSync(electronBin, ['-e', probeSource], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  });
  if (result.error) {
    fail(`packaged better-sqlite3 probe could not start: ${result.error.message}`);
  }
  if (result.status !== 0 || !result.stdout.includes(marker)) {
    fail(
      `packaged better-sqlite3 probe failed (status=${result.status}, ` +
        `signal=${result.signal ?? 'none'}): ` +
        `${(result.stderr || result.stdout || 'no output').slice(-4_000)}`,
    );
  }
  ok('better-sqlite3 opens and queries :memory: from packaged app.asar');
}

function checkKodaxWorkersExecuteFromAsar(asarPath) {
  const runtimeModuleUrl = pathToFileURL(
    path.join(asarPath, 'node_modules', '@kodax-ai', 'kodax', 'dist', 'sdk-runtime.js'),
  ).href;
  const codingModuleUrl = pathToFileURL(
    path.join(asarPath, 'node_modules', '@kodax-ai', 'kodax', 'dist', 'sdk-coding.js'),
  ).href;
  const sandboxModuleUrl = pathToFileURL(
    path.join(asarPath, 'node_modules', '@kodax-ai', 'kodax', 'dist', 'sdk-sandbox.js'),
  ).href;
  const publicFacadeUrls = KODAX_PUBLIC_FACADE_FILES.map(
    (file) =>
      pathToFileURL(path.join(asarPath, 'node_modules', '@kodax-ai', 'kodax', 'dist', file)).href,
  );
  const marker = 'KODAX_ASAR_WORKER_PROBE=';
  const probeSource = `
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createKodaXRuntime,
  getKodaXRuntimeOwnerState,
  KODAX_RUNTIME_SDK_CAPABILITIES,
} from ${JSON.stringify(runtimeModuleUrl)};
import { loadHandler } from ${JSON.stringify(codingModuleUrl)};
import {
  KODAX_ASRT_VERSION,
  doctorKodaXSandbox,
  getKodaXSandboxCapability,
} from ${JSON.stringify(sandboxModuleUrl)};

const homeDir = await mkdtemp(path.join(tmpdir(), 'kodax-space-asar-probe-'));
let runtime;
let daemonRuntime;
const daemonProfile = 'space-pack-lifecycle';
async function waitForDaemonOwnerRelease(runtimeId) {
  const deadline = Date.now() + 5_000;
  while (true) {
    const ownerState = getKodaXRuntimeOwnerState({ profile: daemonProfile, homeDir });
    if (ownerState.ownerStatus === 'unowned') return;
    if (ownerState.ownerStatus === 'unreadable') {
      throw new Error('packaged lifecycle probe owner state became unreadable');
    }
    if (ownerState.owner?.runtimeId !== runtimeId) {
      throw new Error('a different Runtime acquired the packaged lifecycle probe profile');
    }
    if (Date.now() >= deadline) {
      throw new Error('packaged lifecycle probe daemon did not release its owner state');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
try {
  await Promise.all(${JSON.stringify(publicFacadeUrls)}.map((moduleUrl) => import(moduleUrl)));
  const sandboxCapability = getKodaXSandboxCapability();
  if (
    sandboxCapability.version !== 1 ||
    sandboxCapability.asrtVersion !== KODAX_ASRT_VERSION ||
    sandboxCapability.unavailableBehavior !== 'structured-no-execution' ||
    sandboxCapability.ordinaryCallsTriggerSetup !== false
  ) {
    throw new Error(
      'packaged sandbox facade is not fail-closed: ' + JSON.stringify(sandboxCapability),
    );
  }
  const sandboxDoctor = await doctorKodaXSandbox({ refresh: true });
  const sandboxPathFailure = sandboxDoctor.diagnostics.find((diagnostic) =>
    /(?:(?:ENOENT|EACCES|EPERM).*(?:srt-win|apply-seccomp)|(?:srt-win|apply-seccomp).*(?:ENOENT|EACCES|EPERM)|app\\.asar.*(?:srt-win|apply-seccomp|vendor)|(?:srt-win|apply-seccomp|vendor).*app\\.asar)/i.test(
      diagnostic,
    ),
  );
  if (sandboxPathFailure) {
    throw new Error(
      'packaged sandbox runtime resolved a non-physical helper path: ' + sandboxPathFailure,
    );
  }
  runtime = await createKodaXRuntime({
    mode: 'embedded',
    isolation: 'worker',
    requirements: { hardDispose: true },
    homeDir,
    sessionsDir: path.join(homeDir, 'sessions'),
    worker: {
      resourceLimits: { maxOldGenerationSizeMb: 128 },
      shutdownTimeoutMs: 1500,
    },
    clientInfo: { name: 'kodax-space-pack-smoke', version: ${JSON.stringify(SPACE_VERSION)} },
  });
  const created = await runtime.sessions.create({
    title: 'Packaged Runtime compatibility probe',
    projectPath: process.cwd(),
    surface: 'release-probe',
  });
  const loaded = await runtime.sessions.load(created.id);
  const handler = await loadHandler(
    { name: 'pack-worker-check', version: '1.0.0', cwd: homeDir },
    {
      kind: 'script',
      language: 'javascript',
      code: "import { isMainThread } from 'node:worker_threads'; export async function handler() { return String(isMainThread); }",
    },
    { tools: [] },
    { timeoutMs: 5_000 },
  );
  const handlerResult = await handler({}, {
    backups: new Map(),
    executionCwd: homeDir,
  });
  if (KODAX_RUNTIME_SDK_CAPABILITIES?.daemonOrphanExit !== 1) {
    throw new Error('packaged SDK does not advertise daemonOrphanExit v1 before auto-start');
  }
  daemonRuntime = await createKodaXRuntime({
    mode: 'daemon',
    profile: daemonProfile,
    homeDir,
    sessionsDir: path.join(homeDir, 'daemon-sessions'),
    daemonOrphanExitMs: 1_000,
    requirements: {
      daemonManagement: 1,
      daemonOrphanExit: 1,
      integrationConfigResilience: 1,
      skillLearningLoop: 1,
      runtimeAutoModeGuardrail: 4,
    },
    clientInfo: {
      name: 'kodax-space-pack-lifecycle-smoke',
      version: ${JSON.stringify(SPACE_VERSION)},
    },
  });
  const daemonOrphanExit = daemonRuntime.capabilities?.daemonOrphanExit;
  if (
    typeof daemonOrphanExit !== 'object' ||
    daemonOrphanExit === null ||
    daemonOrphanExit.version !== 1
  ) {
    throw new Error(
      'packaged daemon did not negotiate daemonOrphanExit v1: ' +
        JSON.stringify(daemonOrphanExit),
    );
  }
  const management = await daemonRuntime.daemon.inspect();
  if (
    management.integrations?.state !== 'healthy' ||
    management.integrations.domains.length !== 3
  ) {
    throw new Error(
      'packaged daemon did not expose healthy integration state: ' +
        JSON.stringify(management.integrations),
    );
  }
  if (!management.preflight.canStop) {
    throw new Error(
      'packaged lifecycle probe daemon is not safely stoppable: ' +
        management.preflight.blockers.join(','),
    );
  }
  await daemonRuntime.daemon.stopForInline({
    expectedRuntimeId: management.runtimeId,
    expectedRevision: management.revision,
    expectedOwnerPolicyRevision: management.ownerPolicy.revision,
  });
  await daemonRuntime.close();
  daemonRuntime = undefined;
  await waitForDaemonOwnerRelease(management.runtimeId);
  const result = {
    version: runtime.identity.version,
    mode: runtime.identity.mode,
    isolation: runtime.identity.isolation,
    workerThreadId: runtime.identity.workerThreadId,
    sessionRoundTrip: loaded.id === created.id,
    constructedHandlerIsMainThread: handlerResult,
    daemonOrphanExit: daemonOrphanExit.version,
    integrationHealth: management.integrations.state,
    sandboxVersion: sandboxCapability.version,
    sandboxUnavailableBehavior: sandboxCapability.unavailableBehavior,
    sandboxDoctorReady: sandboxDoctor.ready,
    sandboxDoctorDiagnostics: sandboxDoctor.diagnostics.length,
  };
  if (
    result.version !== ${JSON.stringify(KODAX_VERSION)} ||
    result.mode !== 'embedded' ||
    result.isolation !== 'worker' ||
    !Number.isSafeInteger(result.workerThreadId) ||
    !result.sessionRoundTrip ||
    result.constructedHandlerIsMainThread !== 'false' ||
    result.daemonOrphanExit !== 1 ||
    result.integrationHealth !== 'healthy' ||
    result.sandboxVersion !== 1 ||
    result.sandboxUnavailableBehavior !== 'structured-no-execution'
  ) {
    throw new Error('unexpected packaged Worker result: ' + JSON.stringify(result));
  }
  await runtime.close();
  runtime = undefined;
  await rm(homeDir, { recursive: true, force: true });
  await new Promise((resolve) => {
    process.stdout.write(${JSON.stringify(marker)} + JSON.stringify(result), resolve);
  });
  // loadHandler intentionally keeps its Worker cached for reuse. This probe is
  // a disposable process, so terminate it after the result has been flushed.
  process.exit(0);
} catch (error) {
  if (daemonRuntime) {
    let cleanupRuntimeId;
    await daemonRuntime.daemon
      .inspect()
      .then((management) => {
        cleanupRuntimeId = management.runtimeId;
        return management.preflight.canStop
          ? daemonRuntime.daemon.stopForInline({
              expectedRuntimeId: management.runtimeId,
              expectedRevision: management.revision,
              expectedOwnerPolicyRevision: management.ownerPolicy.revision,
            })
          : undefined;
      })
      .catch(() => undefined);
    await daemonRuntime.close().catch(() => undefined);
    daemonRuntime = undefined;
    if (cleanupRuntimeId) {
      await waitForDaemonOwnerRelease(cleanupRuntimeId).catch(() => undefined);
    }
  }
  await runtime?.close().catch(() => undefined);
  await rm(homeDir, { recursive: true, force: true }).catch(() => undefined);
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
`;

  const result = spawnSync(electronBin, ['--input-type=module', '-'], {
    cwd: rootDir,
    input: probeSource,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60_000,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  });
  if (result.error) {
    fail(`packaged KodaX Worker probe could not start: ${result.error.message}`);
  }
  if (result.status !== 0 || !result.stdout.includes(marker)) {
    fail(
      `packaged KodaX Worker probe failed (status=${result.status}, signal=${result.signal ?? 'none'}): ` +
        `${(result.stderr || result.stdout || 'no output').slice(-4_000)}`,
    );
  }
  ok(`KodaX ${KODAX_VERSION} Runtime and constructed-handler Workers execute from packaged asar`);
}

async function main() {
  const installers = await findInstaller();
  for (const installer of installers) {
    await checkSize(installer);
  }
  await checkWindowsExecutableIcons(installers);
  for (const asarPath of await findAsarPaths()) {
    await checkAsarContents(asarPath);
    checkPackagedSqliteExecutesFromAsar(asarPath);
    checkKodaxWorkersExecuteFromAsar(asarPath);
  }
  console.log('\n[smoke-pack] all checks passed');
}

main().catch((err) => {
  console.error('[smoke-pack] uncaught error:', err);
  process.exit(1);
});
