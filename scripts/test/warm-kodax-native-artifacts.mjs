// Warm the KodaX Windows native artifact cache before unit suites.
//
// The protected write path (textTransaction) provisions its native binding on
// first use into %LOCALAPPDATA%\KodaXNativeArtifactsV3 through PowerShell
// helpers with hard 30s budgets. Fresh CI runners start with a cold cache, and
// mid-suite provisioning there has surfaced downstream as silent write-tool
// ENOENTs (kodax-permission-authority / kodax-runtime-control failures that
// never reproduced on warm dev machines). This script warms the cache the way
// the release workflow does — through the SDK's own sandbox setup entry — and
// then proves one real Runtime write lands, failing loudly with the actual
// tool error instead of a downstream ENOENT. It is a no-op off Windows.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setupKodaXSandbox } from '@kodax-ai/kodax/sandbox';
import { createKodaXRuntime } from '@kodax-ai/kodax/runtime';
import { KodaXBaseProvider, registerModelProvider } from '@kodax-ai/kodax/llm';

const providerName = 'space-native-warmup';
const keyName = 'SPACE_NATIVE_WARMUP_KEY';

async function warmOnce() {
  if (process.platform === 'win32') {
    const setup = await setupKodaXSandbox();
    if (!setup.ready) {
      throw new Error(`sandbox setup did not report ready: ${JSON.stringify(setup)}`);
    }
    console.log('sandbox setup ready');
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'space-native-warmup-'));
  const workspace = path.join(root, 'workspace');
  const target = path.join(workspace, 'warmup.txt');
  await fs.mkdir(workspace);
  const previousKey = process.env[keyName];
  process.env[keyName] = 'offline-fixture';
  let toolResultText;
  class Provider extends KodaXBaseProvider {
    name = providerName;
    supportsThinking = false;
    config = { apiKeyEnv: keyName, model: 'fixture', supportsThinking: false };
    async stream(messages) {
      if (toolResultText === undefined) {
        const last = messages[messages.length - 1];
        toolResultText = JSON.stringify(last?.content)?.slice(0, 800) ?? 'no follow-up message';
        return {
          textBlocks: [],
          thinkingBlocks: [],
          toolBlocks: [
            {
              type: 'tool_use',
              id: 'warmup-write',
              name: 'write',
              input: { path: target, content: 'warmup' },
            },
          ],
        };
      }
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
    let phase;
    let lastText;
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
      const result = await run.result;
      phase = result.phase;
      lastText = result.result?.lastText;
      assert.equal(await fs.readFile(target, 'utf8'), 'warmup');
    } catch (error) {
      throw new Error(
        `warmup write failed (phase=${phase}, lastText=${JSON.stringify(lastText)}, toolResult=${toolResultText}): ${error.message}`,
      );
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
