// pack.mjs — link-safe electron-builder packaging.
//
// 为什么需要这层包装：
//   开发期 `@kodax-ai/kodax` 通常 dev-link 到 ../KodaX（symlink/junction，见 link-kodax.mjs）。
//   electron-builder 有条硬规则——打进 asar 的文件必须在项目根目录之下；而 link 状态下
//   SDK 全部文件 realpath 都在 Space 根之外，会直接抛
//     "C:\...\KodaX\.agent\heap-analysis.cjs must be under C:\...\KodaX-Space\"。
//   即便绕过该报错，也会把 KodaX 私有源码 + .kodax/config.json 密钥打进安装包，
//   违反 HLD §18「不内嵌 KodaX-private 任何代码」。
//
//   唯一正解：打包时 node_modules/@kodax-ai/kodax 必须是发布版实体拷贝，不是 symlink。
//
// 本脚本做法（对开发者无感）：
//   1. 检测 SDK 是否 dev-link（realpath 落在 Space 根之外）
//   2. 若是：记下原 link 目标 → 拆链 → `npm ci` 装回 lockfile 声明的发布版
//   3. 跑 electron-builder（透传平台参数，如 --win / --mac / --linux）
//   4. finally：把原 link 原样重建（无论打包成功失败都恢复联调链路）
//   5. 本来就不是 link（干净 CI/release checkout）→ 直接打包，零额外动作
//
// 用法：node scripts/pack.mjs [electron-builder 透传参数...]

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertKodaxReleaseDependencyState } from './kodax-runtime-release-gate.mjs';
import { inspectKodaxDevLink } from './kodax-dev-link-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPACE_ROOT = path.resolve(__dirname, '..');
const SDK_DIR = path.join(SPACE_ROOT, 'node_modules', '@kodax-ai', 'kodax');
const MANIFEST_FILES = ['package.json', 'package-lock.json'];

function readManifestSnapshot() {
  return new Map(
    MANIFEST_FILES.map((name) => [name, fs.readFileSync(path.join(SPACE_ROOT, name), 'utf8')]),
  );
}

function assertManifestUnchanged(snapshot, phase) {
  for (const [name, before] of snapshot.entries()) {
    const after = fs.readFileSync(path.join(SPACE_ROOT, name), 'utf8');
    if (after !== before) {
      throw new Error(
        `[pack] ${phase} changed ${name}; build scripts must not mutate dependency manifests.`,
      );
    }
  }
}

function run(cmd, args, label, envOverride) {
  console.log(`[pack] $ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: SPACE_ROOT,
    shell: process.platform === 'win32', // win 下 npm/npx 是 .cmd，需 shell
    // 关键：不强设 NODE_ENV=production。否则 `npm ci` 会丢掉 devDependencies
    // （electron / electron-builder），打包随即失败。各步按需传 envOverride。
    env: { ...process.env, ...envOverride },
  });
  if (r.status !== 0) {
    throw new Error(`${label ?? cmd} exited with code ${r.status}`);
  }
}

function restoreLink(link) {
  // SDK_DIR 是模块顶层静态常量（SPACE_ROOT/node_modules/@kodax-ai/kodax），不接受外部输入；
  // 删除范围恒定锁死在 Space 自己的 node_modules 下，不会触及 repo 外路径。
  // 先清掉刚装上的发布版实体目录，再恢复原开发布局。
  fs.rmSync(SDK_DIR, { recursive: true, force: true });
  if (link.layout === 'staging') {
    run('node', ['scripts/link-kodax.mjs'], 'restore KodaX dev staging');
    console.log('[pack] restored KodaX dev staging.');
    return;
  }
  fs.mkdirSync(path.dirname(SDK_DIR), { recursive: true });
  fs.symlinkSync(link.target, SDK_DIR, link.type);
  console.log(`[pack] restored dev link: @kodax-ai/kodax → ${link.target}`);
}

async function verifyReleaseSdk(allowLocalTarball) {
  const dependency = await assertKodaxReleaseDependencyState(SPACE_ROOT, SDK_DIR, {
    allowLocalTarball,
  });
  const sourceLabel = dependency.source === 'registry' ? 'Registry' : 'local test tarball';
  console.log(
    `[pack] verified exact ${sourceLabel} dependency @kodax-ai/kodax@${dependency.version}.`,
  );
  return dependency;
}

function runProductSmokes() {
  run('node', ['scripts/smoke-pack.mjs'], 'packaged dependency smoke');
  if (process.platform === 'win32') {
    run('node', ['e2e/boot-smoke-packaged.mjs'], 'packaged Windows boot smoke');
    run('node', ['e2e/complete-exit-packaged.mjs'], 'packaged Windows complete-exit smoke');
  }
}

// 透传给 electron-builder 的参数走白名单 —— 只允许已知的平台/架构标志。
// 否则 electron-builder 接受 `--config.publish[0]...` / `--config.extraResources[0]=...` /
// `--extraMetadata.*` 这类能在运行时覆盖 electron-builder.yml 任意字段的参数，
// 在被污染的 CI 或误操作下可变成"把任意文件打进包 / 改自动更新源"的供应链向量。
const ALLOWED_PASSTHROUGH = new Set([
  '--win',
  '--mac',
  '--linux',
  '--dir',
  '--x64',
  '--arm64',
  '--ia32',
  '--armv7l',
]);
const LOCAL_TARBALL_FLAG = '--allow-local-kodax';
const packArgs = process.argv.slice(2);
const allowLocalTarball = packArgs.includes(LOCAL_TARBALL_FLAG);
const passthrough = packArgs.filter((arg) => {
  if (arg === LOCAL_TARBALL_FLAG) return false;
  if (ALLOWED_PASSTHROUGH.has(arg)) return true;
  console.warn(`[pack] 忽略不在白名单内的参数: ${arg}`);
  return false;
});
const manifestSnapshot = readManifestSnapshot();
const link = inspectKodaxDevLink(SPACE_ROOT, SDK_DIR);
if (allowLocalTarball) {
  console.warn('[pack] explicit local KodaX test-tarball mode enabled; not for formal releases.');
}

if (!link.linked) {
  await verifyReleaseSdk(allowLocalTarball);
  // 干净状态：直接打包（CI / 已 unlink 的 release checkout）
  run(
    'node',
    ['scripts/ensure-sqlite-native.mjs', 'electron'],
    'ensure better-sqlite3 electron ABI',
  );
  run('npx', ['electron-builder', '-p', 'never', ...passthrough], 'electron-builder');
  runProductSmokes();
  assertManifestUnchanged(manifestSnapshot, 'pack');
  process.exit(0);
}

console.log(
  link.layout === 'staging'
    ? '[pack] @kodax-ai/kodax is a local dev staging package.'
    : `[pack] @kodax-ai/kodax is dev-linked (→ ${link.target}).`,
);
console.log(
  '[pack] swapping to the locked physical package for packaging (HLD §18: no KodaX-private code).',
);

try {
  run('node', ['scripts/link-kodax.mjs', '--unlink'], 'unlink:kodax');
  // NODE_ENV=development + --include=dev：否则(用户 shell 常 export NODE_ENV=production)
  // npm 会丢掉 electron / electron-builder 等 devDeps，打包随即失败。
  run('npm', ['ci', '--no-audit', '--no-fund', '--include=dev'], 'npm ci (locked SDK)', {
    NODE_ENV: 'development',
  });
  assertManifestUnchanged(manifestSnapshot, 'npm ci (locked SDK)');
  await verifyReleaseSdk(allowLocalTarball);
  run(
    'node',
    ['scripts/ensure-sqlite-native.mjs', 'electron'],
    'ensure better-sqlite3 electron ABI',
  );
  run('npx', ['electron-builder', '-p', 'never', ...passthrough], 'electron-builder');
  // Run against the exact locked install before finally restoring the local
  // development staging package.
  runProductSmokes();
  assertManifestUnchanged(manifestSnapshot, 'pack');
} finally {
  try {
    restoreLink(link);
  } catch (err) {
    console.error('[pack] WARN: failed to restore dev link — run `npm run link:kodax` manually.');
    console.error(`[pack]   ${err.message}`);
  }
}
