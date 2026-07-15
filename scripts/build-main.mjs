// Build Electron main + preload with esbuild.
//
// 输出：
//   dist-electron/main.js
//   dist-electron/preload.js
//   dist-electron/partner-source-extraction-worker.js
//
// main 进程为 CommonJS（Electron 当前更稳定）；preload sandbox 模式下也必须 CJS。

import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const electronDir = path.join(root, 'apps/desktop/electron');
const outDir = path.join(root, 'dist-electron');

fs.mkdirSync(outDir, { recursive: true });

// 根 package.json 是 "type": "module"，但 esbuild 这里输出 CJS。
// 在 dist-electron/ 放一个 package.json 把该目录标记为 CommonJS，
// 否则 Node 会按扩展名 .js + 父级 type=module 误判为 ESM。
// 注意：必须带 "main"，否则 Electron 会把入口当作非主进程脚本，
// 此时 require('electron') 仅返回 electron.exe 路径字符串而非 API 模块。
fs.writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify({ name: 'kodax-space-main', type: 'commonjs', main: 'main.js' }, null, 2) + '\n',
);

const watch = process.argv.includes('--watch');
// 默认 production：生产构建（本地 build:* / CI）即使不设 NODE_ENV 也出压缩产物，
// 不再依赖外层 shell 的全局 NODE_ENV（那是不可靠的隐式依赖）。
// dev 模式由 scripts/dev.mjs 的 esbuild watch spawn 显式传 NODE_ENV=development 触发。
const isDev = process.env.NODE_ENV === 'development';

/** @type {esbuild.BuildOptions} */
const sharedOptions = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: isDev ? 'inline' : false,
  minify: !isDev,
  // keytar 是原生模块（native binding），不能被 esbuild bundle；
  // 必须保持 require('keytar') 在运行时由 Node module 解析。
  // electron-builder 打包时会把 node_modules/keytar/build/Release/keytar.node 一并塞进。
  //
  // @kodax-ai/kodax 标 external：bundle 进 main.js 会让 main.js 从 880KB 涨到 53MB
  // （KodaX 自带 React/Ink/openai-sdk/anthropic-sdk 等大依赖）。external 后 require 时
  // 直接走 node_modules，electron-builder 把整个 @kodax-ai/kodax 塞进 asar——大小没变
  // 但 main.js 启动快很多，dev watch 重 bundle 也快。
  //
  // **注意**：SDK 的 subpath exports（/coding /skills /repl /session 等）只声明了
  // `"import"` 条件（ESM），没声明 `"require"`。Space main 输出 CJS，静态 require 会撞
  // ERR_PACKAGE_PATH_NOT_EXPORTED。修复办法：所有从 SDK subpath 的 import 必须用
  // 动态 `await import('@kodax-ai/kodax/coding')` —— 动态 import 走 ESM 解析规则，
  // 即使在 CJS 上下文也能命中 `"import"` 条件。static `import` 只能用类型 (typeof import())。
  // 详见 apps/desktop/electron/kodax/{user-config,mcp/config-reader}.ts 的 lazy 模式。
  external: [
    'electron',
    'keytar',
    'better-sqlite3',
    '@kodax-ai/kodax',
    '@kodax-ai/kodax/coding',
    '@kodax-ai/kodax/skills',
    '@kodax-ai/kodax/repl',
    '@kodax-ai/kodax/session',
    '@kodax-ai/kodax/mcp',
    '@kodax-ai/kodax/llm',
    '@kodax-ai/kodax/agent',
    '@kodax-ai/kodax/runtime',
    '@kodax-ai/kodax/experimental-memory',
    // ./media is dynamically imported by ipc/{session,clipboard}.ts — the base '@kodax-ai/kodax'
    // external does NOT cover subpaths in esbuild, so it must be listed or the packaged main.js
    // would try to bundle this ESM-only subpath (ERR_PACKAGE_PATH_NOT_EXPORTED at runtime).
    '@kodax-ai/kodax/media',
    'electron-updater',
  ],
  logLevel: 'info',
  // 双轨 require 模式（register/catalog/ptyHost/artifact 的 `typeof require !== 'undefined' ? ... : import.meta`）：
  // CJS bundle 里 `require` 永远有定义 → import.meta 分支是死代码、永不求值，仅供 tsx/esm 测试 loader 走。
  // esbuild 静态分析看不出这点，会对每处发 empty-import-meta warning（CJS 下 import.meta 被置空）。
  // 这是该 dual-runtime 模式的预期行为，显式静音以保持 dev/build 输出干净。
  logOverride: { 'empty-import-meta': 'silent' },
};

async function buildOne(entry, outfile) {
  /** @type {esbuild.BuildOptions} */
  const opts = {
    ...sharedOptions,
    entryPoints: [entry],
    outfile,
  };

  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
    console.log(`[build-main] watching ${path.basename(entry)}`);
  } else {
    await esbuild.build(opts);
    console.log(`[build-main] built ${path.relative(root, outfile)}`);
  }
}

await Promise.all([
  buildOne(path.join(electronDir, 'main.ts'), path.join(outDir, 'main.js')),
  buildOne(path.join(electronDir, 'preload.ts'), path.join(outDir, 'preload.js')),
  buildOne(
    path.join(electronDir, 'kodax', 'partner-source-extraction-worker.ts'),
    path.join(outDir, 'partner-source-extraction-worker.js'),
  ),
]);

if (!watch) {
  console.log('[build-main] done');
}
