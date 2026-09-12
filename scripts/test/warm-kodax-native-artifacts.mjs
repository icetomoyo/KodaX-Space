// Warm the KodaX Windows native artifact cache before unit suites.
//
// The protected write path (textTransaction) provisions its native binding on
// first use into %LOCALAPPDATA%\KodaXNativeArtifactsV3 through a PowerShell
// helper with a hard 30s budget. Fresh CI runners start with a cold cache and
// Defender-contended PowerShell, so mid-suite provisioning can fail or time
// out and surface downstream as silent write-tool ENOENTs. This script boots
// one throwaway Runtime and performs one full-access write up front, so the
// suite always runs against a warm cache. It is a no-op off Windows.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createKodaXRuntime } from '@kodax-ai/kodax/runtime';
import { KodaXBaseProvider, registerModelProvider } from '@kodax-ai/kodax/llm';

const providerName = 'space-native-warmup';
const keyName = 'SPACE_NATIVE_WARMUP_KEY';

async function warmOnce() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'space-native-warmup-'));
  const workspace = path.join(root, 'workspace');
  const target = path.join(workspace, 'warmup.txt');
  await fs.mkdir(workspace);
  const previousKey = process.env[keyName];
  process.env[keyName] = 'offline-fixture';
  class Provider extends KodaXBaseProvider {
    name = providerName;
    supportsThinking = false;
    config = { apiKeyEnv: keyName, model: 'fixture', supportsThinking: false };
    async stream() {
      return {
        textBlocks: [{ type: 'text', text: 'warmup' }],
        toolBlocks: [],
        thinkingBlocks: [],
      };
    }
  }
  const unregister = registerModelProvider(providerName, () => new Provider());
  try {
    const runtime = await createKodaXRuntime({
      homeDir: path.join(root, 'home'),
      sessionsDir: path.join(root, 'sessions'),
      defaultProvider: providerName,
      defaultModel: 'fixture',
    });
    try {
      const session = await runtime.sessions.create({ projectPath: workspace });
      await runtime.sessions.updateSettings(session.id, { permissionMode: 'full-access' });
      const run = await runtime.runs.start({
        sessionId: session.id,
        prompt: 'Warm the native artifact cache.',
        options: {
          lsp: false,
          toolInvocation: { name: 'write', input: { path: target, content: 'warmup' } },
        },
      });
      await run.result;
      assert.equal(await fs.readFile(target, 'utf8'), 'warmup');
    } finally {
      await runtime.close();
    }
  } finally {
    unregister();
    if (previousKey === undefined) delete process.env[keyName];
    else process.env[keyName] = previousKey;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (process.platform === 'win32') {
  for (let attempt = 1; ; attempt += 1) {
    const started = performance.now();
    try {
      await warmOnce();
      console.log(`native artifact cache warm in ${(performance.now() - started).toFixed(0)}ms`);
      break;
    } catch (error) {
      console.error(`native artifact warmup attempt ${attempt} failed:`, error);
      if (attempt >= 2) throw error;
    }
  }
}
