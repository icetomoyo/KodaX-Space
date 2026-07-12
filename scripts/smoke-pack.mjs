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

import { promises as fs, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'out');
const rootPackage = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const SPACE_VERSION = String(rootPackage.version ?? '').trim();
const KODAX_VERSION = String(rootPackage.dependencies?.['@kodax-ai/kodax'] ?? '').trim();
const SIZE_LIMIT_BYTES = 200 * 1024 * 1024;
const require = createRequire(import.meta.url);
const electronBin = require('electron');

function fail(msg) {
  console.error(`[smoke-pack] FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`[smoke-pack] OK: ${msg}`);
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
    '/node_modules/@kodax-ai/kodax/dist/sdk-runtime.js',
    '/node_modules/@kodax-ai/kodax/dist/sdk-experimental-memory.js',
    '/node_modules/@kodax-ai/kodax/dist/runtime-worker.js',
    '/node_modules/@kodax-ai/kodax/dist/constructed-handler-worker.js',
    '/node_modules/@kodax-ai/kodax/dist/semantic-worker.js',
    '/node_modules/@kodax-ai/kodax/dist/provider-capabilities.json',
    '/node_modules/@kodax-ai/kodax/scripts/kodax-bin.cjs',
  ];
  for (const req of kodaxRuntimeRequired) {
    if (!normalized.some((f) => f === req || f.endsWith(req))) {
      fail(`KodaX ${KODAX_VERSION} Runtime dependency missing from asar: ${req}`);
    }
    ok(`asar contains ${req}`);
  }

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
  const resourceNodeModulesDir = path.join(path.dirname(asarPath), 'node_modules');
  const resourceNodeModuleFiles = (await pathExists(resourceNodeModulesDir))
    ? (await listFilesRecursive(resourceNodeModulesDir)).map((f) => f.replace(/\\/g, '/'))
    : [];
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

function checkKodaxWorkersExecuteFromAsar(asarPath) {
  const runtimeModuleUrl = pathToFileURL(
    path.join(asarPath, 'node_modules', '@kodax-ai', 'kodax', 'dist', 'sdk-runtime.js'),
  ).href;
  const codingModuleUrl = pathToFileURL(
    path.join(asarPath, 'node_modules', '@kodax-ai', 'kodax', 'dist', 'sdk-coding.js'),
  ).href;
  const marker = 'KODAX_ASAR_WORKER_PROBE=';
  const probeSource = `
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKodaXRuntime } from ${JSON.stringify(runtimeModuleUrl)};
import { loadHandler } from ${JSON.stringify(codingModuleUrl)};

const homeDir = await mkdtemp(path.join(tmpdir(), 'kodax-space-asar-probe-'));
let runtime;
try {
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
  const result = {
    version: runtime.identity.version,
    mode: runtime.identity.mode,
    isolation: runtime.identity.isolation,
    workerThreadId: runtime.identity.workerThreadId,
    sessionRoundTrip: loaded.id === created.id,
    constructedHandlerIsMainThread: handlerResult,
  };
  if (
    result.version !== ${JSON.stringify(KODAX_VERSION)} ||
    result.mode !== 'embedded' ||
    result.isolation !== 'worker' ||
    !Number.isSafeInteger(result.workerThreadId) ||
    !result.sessionRoundTrip ||
    result.constructedHandlerIsMainThread !== 'false'
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
  for (const asarPath of await findAsarPaths()) {
    await checkAsarContents(asarPath);
    checkKodaxWorkersExecuteFromAsar(asarPath);
  }
  console.log('\n[smoke-pack] all checks passed');
}

main().catch((err) => {
  console.error('[smoke-pack] uncaught error:', err);
  process.exit(1);
});
