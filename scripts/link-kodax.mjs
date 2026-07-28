// link-kodax — 把本地 KodaX 仓库挂接进 Space 的 node_modules/@kodax-ai/kodax
//
// 为什么不是 `npm link`：
//   KodaX 仓库 root package.json 的 name 是 "kodax"（publish 时 release.mjs 把它
//   改成 "@kodax-ai/kodax" 再发包，并注入 SDK subpath exports）。所以直接
//   `npm link` 创建的是 "kodax" 这个 link；Space 端 `npm link @kodax-ai/kodax`
//   找不到。
//
// 为什么不是直接 fs.symlink 整个 KodaX 仓库：
//   会让 Space 端 import('@kodax-ai/kodax/coding') 找不到子路径——KodaX 仓库的
//   package.json 只有 "." export，子路径 './coding' / './session' 等是 release.mjs
//   publish 时才注入的。
//
// 本脚本做法：
//   1. 在 Space/node_modules/@kodax-ai/kodax/ 建一个 staging 目录（不污染 KodaX 仓库）
//   2. 写一个自己的 package.json — name=@kodax-ai/kodax + 镜像 subpath exports
//      （与 KodaX/scripts/release.mjs 完全一致；改一次时同步两边）
//   3. 把 dist/ symlink 到 KodaX/dist/（KodaX `npm run build` 后立即被 Space 看到）
//   4. 把 node_modules/ symlink 到 KodaX/node_modules/（SDK 内部依赖能找到）
//
// 用法：
//   npm run link:kodax    # 创建 staging
//   npm run unlink:kodax  # 撤回，再 `npm ci` 还原 lockfile 中的 npm 包

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KODAX_DEV_LINK_MARKER } from './kodax-dev-link-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPACE_ROOT = path.resolve(__dirname, '..');
const KODAX_REPO = path.resolve(SPACE_ROOT, '..', 'KodaX');
const STAGING = path.join(SPACE_ROOT, 'node_modules', '@kodax-ai', 'kodax');

const unlinkMode = process.argv.includes('--unlink');

function rimrafSafe(p) {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || st.isFile()) {
      fs.unlinkSync(p);
    } else if (st.isDirectory()) {
      fs.rmSync(p, { recursive: true, force: true });
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

if (unlinkMode) {
  rimrafSafe(STAGING);
  console.log(`[link-kodax] removed staging at ${STAGING}`);
  console.log(`[link-kodax] run \`npm ci\` to restore the npm tarball from package-lock.json.`);
  process.exit(0);
}

if (!fs.existsSync(KODAX_REPO)) {
  console.error(`[link-kodax] KodaX repo not found at ${KODAX_REPO}`);
  process.exit(1);
}
const kodaxPkgPath = path.join(KODAX_REPO, 'package.json');
const kodaxPkg = JSON.parse(fs.readFileSync(kodaxPkgPath, 'utf-8'));

// 1. Fresh staging dir
rimrafSafe(STAGING);
fs.mkdirSync(STAGING, { recursive: true });

// 2. Write Space-owned package.json — mirror release.mjs subpath exports + name rewrite.
//    publishConfig / bin / version 直接 borrow KodaX 的，保持版本号一致。
const stagingPkg = {
  name: '@kodax-ai/kodax',
  version: kodaxPkg.version,
  description: kodaxPkg.description,
  type: kodaxPkg.type,
  main: kodaxPkg.main,
  types: kodaxPkg.types,
  bin: kodaxPkg.bin,
  kodaxRuntimeContracts: kodaxPkg.kodaxRuntimeContracts,
  // exports: 直接 borrow KodaX 自己的 exports map（它已指向 ./dist/sdk-*.js，与本 staging 的
  // dist 符号链接一致）。这样 KodaX 新增子路径（如 0.7.58 的 ./media）自动跟上，不再手 sync 漂移
  // —— 缺 ./media 曾导致 dev-link 下 import('@kodax-ai/kodax/media') 抛 ERR_PACKAGE_PATH_NOT_EXPORTED。
  // kodaxPkg.exports 缺失时回退到显式清单（含 ./runtime，与当前 KodaX Runtime 对齐）。
  exports: kodaxPkg.exports ?? {
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    './agent': { types: './dist/sdk-agent.d.ts', import: './dist/sdk-agent.js' },
    './llm': { types: './dist/sdk-llm.d.ts', import: './dist/sdk-llm.js' },
    './coding': { types: './dist/sdk-coding.d.ts', import: './dist/sdk-coding.js' },
    './media': { types: './dist/sdk-media.d.ts', import: './dist/sdk-media.js' },
    './repl': { types: './dist/sdk-repl.d.ts', import: './dist/sdk-repl.js' },
    './skills': { types: './dist/sdk-skills.d.ts', import: './dist/sdk-skills.js' },
    './mcp': { types: './dist/sdk-mcp.d.ts', import: './dist/sdk-mcp.js' },
    './session': { types: './dist/sdk-session.d.ts', import: './dist/sdk-session.js' },
    './runtime': { types: './dist/sdk-runtime.d.ts', import: './dist/sdk-runtime.js' },
    './a2a': { types: './dist/sdk-a2a.d.ts', import: './dist/sdk-a2a.js' },
    './experimental-memory': {
      types: './dist/sdk-experimental-memory.d.ts',
      import: './dist/sdk-experimental-memory.js',
    },
    './package.json': './package.json',
  },
  // 保留 dependencies — Node ESM resolution 需要它们存在以找子依赖
  dependencies: kodaxPkg.dependencies,
};
fs.writeFileSync(path.join(STAGING, 'package.json'), JSON.stringify(stagingPkg, null, 2));

// 3. Symlink dist/ — KodaX `npm run build` 后产物在这；Space 立即看到新代码
const distSrc = path.join(KODAX_REPO, 'dist');
const distLink = path.join(STAGING, 'dist');
if (fs.existsSync(distSrc)) {
  fs.symlinkSync(distSrc, distLink, process.platform === 'win32' ? 'junction' : 'dir');
} else {
  console.warn(
    `[link-kodax] WARN: ${distSrc} doesn't exist — run \`cd ${KODAX_REPO} && npm run build\` first.`,
  );
}

// 4. Symlink node_modules/ — SDK 内部 require('react') 等要找到子依赖
const nmSrc = path.join(KODAX_REPO, 'node_modules');
const nmLink = path.join(STAGING, 'node_modules');
if (fs.existsSync(nmSrc)) {
  fs.symlinkSync(nmSrc, nmLink, process.platform === 'win32' ? 'junction' : 'dir');
}

// 5. Symlink scripts/ — bin entries (kodax-bin.cjs) 引用
const scriptsSrc = path.join(KODAX_REPO, 'scripts');
const scriptsLink = path.join(STAGING, 'scripts');
if (fs.existsSync(scriptsSrc)) {
  fs.symlinkSync(scriptsSrc, scriptsLink, process.platform === 'win32' ? 'junction' : 'dir');
}

// Written last so an interrupted staging build is never mistaken for a
// complete local SDK package. pack.mjs also recognizes pre-marker staging by
// inspecting the nested junctions.
fs.writeFileSync(path.join(STAGING, KODAX_DEV_LINK_MARKER), '', 'utf8');

console.log(`[link-kodax] staging at:`);
console.log(`  ${STAGING}`);
console.log(`  • package.json — Space-owned (name=@kodax-ai/kodax + subpath exports)`);
console.log(`  • dist/        — junction → ${distSrc}`);
console.log(`  • node_modules/ — junction → ${nmSrc}`);
console.log(``);
console.log(`Live SDK iteration workflow:`);
console.log(`  1. Edit KodaX source under ${KODAX_REPO}/src/`);
console.log(`  2. cd ${KODAX_REPO} && npm run build`);
console.log(`  3. Restart Space dev — picks up new dist via junction.`);
console.log(``);
console.log(`Restore npm-published package:`);
console.log(`  npm run unlink:kodax && npm ci`);
