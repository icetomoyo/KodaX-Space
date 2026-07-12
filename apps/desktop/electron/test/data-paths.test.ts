// data-paths tests — OC-12 + 便携版数据目录一致性
//
// 跨平台(win/mac/linux):路径断言全部用 os.homedir()/os.tmpdir() + path.join 动态构造,
// 不硬编码 `c:\...` 或 `/home/...`,故同一份用例在三个平台都成立。KODAX_PROFILE_DIR 的
// 绝对路径判定走 path.isAbsolute(当前 OS 语义)。
//
// 验收：
//   1. 默认 (无 env) → os.homedir()/.kodax
//   2. KODAX_TEST_ONBOARDING=<id> → tmpdir/kodax-test-<id>
//   3. KODAX_TEST_ONBOARDING=1 → tmpdir/kodax-test-<uuid> (auto)
//   4. 便携版(PORTABLE_EXECUTABLE_DIR) **不再**重定向 → 仍走 ~/.kodax（回归:便携版看不到 workflow）
//   5. KODAX_PROFILE_DIR=<abs> → <abs> 本身（不再拼 .kodax；含 SDK sessions 同步）
//   6. 非绝对路径的 KODAX_PROFILE_DIR 被忽略 → 回落 ~/.kodax
//   7. 同 process 多次调返同路径（缓存）

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
// Lighter subpath than the main entry (which pulls the REPL/ink stack and breaks the tsx
// loader). /agent re-exports getAgentConfigHome — the real SDK resolver for its session/config
// home — so the test below round-trips through actual SDK code, not just Space's own env write.
import { getAgentConfigHome } from '@kodax-ai/kodax/agent';
import {
  getKodaxDir,
  getKodaxRuntimeDir,
  getScopedUserDataDir,
  getSpaceDataDir,
  applySdkHomeEnv,
  _resetDataPathsCacheForTesting,
} from '../kodax/data-paths.js';

const ENV_KEYS = [
  'KODAX_TEST_ONBOARDING',
  'PORTABLE_EXECUTABLE_DIR',
  'KODAX_PROFILE_DIR',
  'KODAX_HOME',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  _resetDataPathsCacheForTesting();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _resetDataPathsCacheForTesting();
});

function clearAllDataEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

const homeKodax = (): string => path.join(os.homedir(), '.kodax');

test('no env → ~/.kodax', () => {
  clearAllDataEnv();
  assert.equal(getKodaxDir(), homeKodax());
  assert.equal(getSpaceDataDir(), path.join(homeKodax(), 'space'));
  assert.equal(getScopedUserDataDir(), null);
  assert.equal(getKodaxRuntimeDir(), homeKodax());
});

test('Runtime data follows an explicit absolute KODAX_HOME', () => {
  clearAllDataEnv();
  const sdkHome = path.join(os.tmpdir(), 'kodax-runtime-home-fixture');
  process.env.KODAX_HOME = sdkHome;
  assert.equal(getKodaxRuntimeDir(), sdkHome);
});

test('onboarding isolation takes precedence over inherited KODAX_HOME for Runtime data', () => {
  clearAllDataEnv();
  process.env.KODAX_TEST_ONBOARDING = 'runtime-home-isolation';
  process.env.KODAX_HOME = path.join(os.tmpdir(), 'must-not-be-used-by-runtime');
  assert.equal(getKodaxRuntimeDir(), path.join(os.tmpdir(), 'kodax-test-runtime-home-isolation'));
});

test('KODAX_TEST_ONBOARDING=fixture-1 → tmpdir/kodax-test-fixture-1', () => {
  clearAllDataEnv();
  process.env.KODAX_TEST_ONBOARDING = 'fixture-1';
  const expected = path.join(os.tmpdir(), 'kodax-test-fixture-1');
  assert.equal(getKodaxDir(), expected);
  assert.equal(getSpaceDataDir(), path.join(expected, 'space'));
  assert.equal(getScopedUserDataDir(), path.join(expected, 'space', 'electron-user-data'));
});

test('KODAX_TEST_ONBOARDING=1 → auto uuid suffix (stable across calls)', () => {
  clearAllDataEnv();
  process.env.KODAX_TEST_ONBOARDING = '1';
  const first = getKodaxDir();
  assert.ok(first.startsWith(path.join(os.tmpdir(), 'kodax-test-')));
  const second = getKodaxDir();
  assert.equal(first, second);
});

test('cache survives between getKodaxDir and getSpaceDataDir calls', () => {
  clearAllDataEnv();
  process.env.KODAX_TEST_ONBOARDING = '1';
  const dir1 = getKodaxDir();
  const dir2 = getSpaceDataDir();
  assert.equal(path.dirname(dir2), dir1, 'space dir should sit under same kodax dir');
});

test('便携版 PORTABLE_EXECUTABLE_DIR 不再重定向 → 仍走 ~/.kodax (regression: 便携版看不到 workflow)', () => {
  // 根因回归:便携版曾把 Space 数据(含 workflow-runs)重定向到 <exe>/.kodax(空目录),
  // 而 SDK sessions 仍在真实 ~/.kodax → "session 正常、workflow 全空"。现在便携版一律走
  // ~/.kodax,和 dev / SDK 一致。(portable target 仅 Windows 有;mac/linux 从来就走 ~/.kodax。)
  clearAllDataEnv();
  process.env.PORTABLE_EXECUTABLE_DIR = path.join(os.tmpdir(), 'kodax-portable-fixture');
  assert.equal(getKodaxDir(), homeKodax());
  assert.equal(getSpaceDataDir(), path.join(homeKodax(), 'space'));
  assert.equal(
    getScopedUserDataDir(),
    null,
    '便携版用 Electron 默认 userData,不再 scope 到 exe 目录',
  );
});

test('KODAX_PROFILE_DIR=<abs> → 该目录本身即数据根 (sessions/space 直接在其下)', () => {
  clearAllDataEnv();
  const profileDir = path.join(os.tmpdir(), 'kodax-profile-fixture');
  process.env.KODAX_PROFILE_DIR = profileDir;

  // 数据根 = profileDir 本身,不再拼 .kodax
  assert.equal(getKodaxDir(), profileDir);
  assert.equal(getSpaceDataDir(), path.join(profileDir, 'space'));
  assert.equal(getScopedUserDataDir(), path.join(profileDir, 'space', 'electron-user-data'));
});

test('非绝对路径的 KODAX_PROFILE_DIR 被忽略 → 回落 ~/.kodax', () => {
  // 'relative/kodax' 在 win/mac/linux 上都非绝对路径 → path.isAbsolute=false → 忽略。
  clearAllDataEnv();
  process.env.KODAX_PROFILE_DIR = path.join('relative', 'kodax');
  assert.equal(getKodaxDir(), homeKodax());
});

test('applySdkHomeEnv: KODAX_PROFILE_DIR 时设 KODAX_HOME,SDK getAgentConfigHome 随之指向独立数据档', () => {
  // 真 SDK round-trip:验证我们设的是 SDK 真正会读的那个 env —— KODAX_HOME —— 而不是 SDK 从不读的
  // KODAX_SESSIONS_DIR(旧实现设错了、只在 Space 侧断言,给了假信心)。getAgentConfigHome() 动态读
  // process.env.KODAX_HOME,是 SDK session/config 目录的根;node --test 按文件隔离进程,故此处 SDK 的
  // setAgentConfigHome 未被别处污染,读的就是 env。**不拼 /sessions**:getAgentConfigHome 返回 .kodax 根本身。
  clearAllDataEnv();
  const profileDir = path.join(os.tmpdir(), 'kodax-profile-fixture');
  process.env.KODAX_PROFILE_DIR = profileDir;

  applySdkHomeEnv();
  assert.equal(
    process.env.KODAX_HOME,
    profileDir,
    'must set KODAX_HOME to the .kodax root itself (not <root>/sessions)',
  );
  assert.equal(
    getAgentConfigHome(),
    profileDir,
    'SDK getAgentConfigHome() must resolve to the profile dir — proves KODAX_HOME is the env the SDK actually reads',
  );
});

test('applySdkHomeEnv: 默认 / 便携版是 no-op (不碰 KODAX_HOME)', () => {
  clearAllDataEnv();
  process.env.PORTABLE_EXECUTABLE_DIR = path.join(os.tmpdir(), 'kodax-portable-fixture');
  applySdkHomeEnv();
  assert.equal(process.env.KODAX_HOME, undefined, '便携版/默认不覆盖 SDK 自己的 home 默认');
});

test('applySdkHomeEnv: 测试模式强制隔离 SDK home，不继承用户 KODAX_HOME', () => {
  clearAllDataEnv();
  process.env.KODAX_TEST_ONBOARDING = 'sdk-home-isolation';
  process.env.KODAX_HOME = path.join(os.tmpdir(), 'must-not-be-used');

  applySdkHomeEnv();

  const expected = path.join(os.tmpdir(), 'kodax-test-sdk-home-isolation');
  assert.equal(process.env.KODAX_HOME, expected);
  assert.equal(getAgentConfigHome(), expected);
});

test('applySdkHomeEnv: 尊重用户已设的 KODAX_HOME,不覆盖', () => {
  clearAllDataEnv();
  process.env.KODAX_PROFILE_DIR = path.join(os.tmpdir(), 'kodax-profile-fixture');
  const userDir = path.join(os.tmpdir(), 'user-chosen-home');
  process.env.KODAX_HOME = userDir;
  applySdkHomeEnv();
  assert.equal(process.env.KODAX_HOME, userDir);
});

test('KODAX_TEST_ONBOARDING rejects path traversal suffixes', () => {
  clearAllDataEnv();
  process.env.KODAX_TEST_ONBOARDING = '../../escape';
  assert.throws(() => getKodaxDir(), /safe \[A-Za-z0-9_-\] suffix/);
});
