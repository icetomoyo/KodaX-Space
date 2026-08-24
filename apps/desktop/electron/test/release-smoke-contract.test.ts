import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

test('packaged dependency smoke requires conversationHistory v2', async () => {
  const source = await readFile(
    new URL('../../../../scripts/smoke-pack.mjs', import.meta.url),
    'utf8',
  );

  assert.match(source, /KODAX_RUNTIME_SDK_CAPABILITIES\?\.conversationHistory\s*!==\s*2/);
  assert.match(source, /KODAX_RUNTIME_SDK_CAPABILITIES\?\.runtimeExitSettlement\s*!==\s*2/);
  assert.match(source, /KODAX_RUNTIME_SDK_CAPABILITIES\?\.sandboxRuntime\s*!==\s*5/);
  assert.match(source, /daemonSandboxRuntime\.version\s*!==\s*5/);
});

test('external-agent gateway preserves the Electron CJS require boundary', async () => {
  const gatewayUrl = new URL('../kodax/external-agent-gateway.ts', import.meta.url);
  const gatewayPath = fileURLToPath(gatewayUrl);
  const bundle = await build({
    bundle: true,
    entryPoints: [gatewayPath],
    external: ['@kodax-ai/kodax', '@kodax-ai/kodax/*'],
    format: 'cjs',
    logLevel: 'silent',
    platform: 'node',
    target: 'node24',
    write: false,
  });
  const output = bundle.outputFiles[0];
  assert.ok(output);

  const bundledModule: { exports: Record<string, unknown> } = { exports: {} };
  const requireFromGateway = createRequire(gatewayUrl);
  const evaluateCommonJs = new Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    output.text,
  );

  assert.doesNotThrow(() => {
    evaluateCommonJs(
      requireFromGateway,
      bundledModule,
      bundledModule.exports,
      gatewayPath,
      path.dirname(gatewayPath),
    );
  });
  assert.equal(typeof bundledModule.exports.ExternalAgentGateway, 'function');
});
