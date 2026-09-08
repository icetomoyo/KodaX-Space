import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../..', import.meta.url));
const config = parse(readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'));
const sdkRequire = createRequire(path.join(root, 'node_modules/@kodax-ai/kodax/package.json'));
const asrtManifest = sdkRequire.resolve('@anthropic-ai/sandbox-runtime/package.json');
const asrtRequire = createRequire(asrtManifest);

test('physical sandbox resources use the exact runtime and dependencies resolved by the published SDK', () => {
  for (const name of [
    '@anthropic-ai/sandbox-runtime',
    '@pondwader/socks5-server',
    'node-forge',
    'zod',
  ]) {
    const entry = config.extraResources.find((item) => item.to === `node_modules/${name}`);
    assert.ok(entry, `missing physical resource for ${name}`);
    const sourceManifest = path.join(root, entry.from, 'package.json');
    assert.equal(
      realpathSync(sourceManifest),
      realpathSync(asrtRequire.resolve(`${name}/package.json`)),
    );
  }
  const commander = config.extraResources.find(
    (item) => item.to === 'node_modules/@anthropic-ai/sandbox-runtime/node_modules/commander',
  );
  assert.ok(commander);
  assert.equal(
    realpathSync(path.join(root, commander.from, 'index.js')),
    realpathSync(asrtRequire.resolve('commander')),
  );
});
