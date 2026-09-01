import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

test('packaged dependency smoke requires conversationHistory v2 and sandboxRuntime v9', async () => {
  const source = await readFile(
    new URL('../../../../scripts/smoke-pack.mjs', import.meta.url),
    'utf8',
  );

  assert.match(source, /KODAX_RUNTIME_SDK_CAPABILITIES\?\.conversationHistory\s*!==\s*2/);
  assert.match(source, /KODAX_RUNTIME_SDK_CAPABILITIES\?\.runtimeExitSettlement\s*!==\s*2/);
  assert.match(source, /KODAX_RUNTIME_SDK_CAPABILITIES\?\.sandboxRuntime\s*!==\s*9/);
  assert.match(source, /KODAX_RUNTIME_SDK_CAPABILITIES\?\.runtimeAutoModeGuardrail\s*!==\s*5/);
  assert.match(source, /KODAX_RUNTIME_SDK_CAPABILITIES\?\.sharedSessionSettings\s*!==\s*2/);
  assert.match(source, /daemonSandboxRuntime\.version\s*!==\s*9/);
  assert.match(source, /result\.daemonSandboxRuntime\s*!==\s*9/);
  assert.match(source, /result\.sandboxVersion\s*!==\s*9/);
  assert.match(source, /kodax-windows-sandbox\.exe/);
  assert.match(source, /kodax-windows-text-transaction\.node/);
  assert.match(source, /kodax-text-transaction\.node/);
  assert.match(source, /native artifact hash mismatch/);
});

test('electron-builder keeps the complete KodaX native authority on the physical filesystem', async () => {
  const source = await readFile(
    new URL('../../../../electron-builder.yml', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /asarUnpack:[\s\S]*['"]\*\*\/node_modules\/@kodax-ai\/kodax\/dist\/native\/\*\*['"]/,
  );
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
