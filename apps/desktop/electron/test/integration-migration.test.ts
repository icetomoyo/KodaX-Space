import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  applyKodaxIntegrationMigration,
  planKodaxIntegrationMigration,
} from '../kodax/integration-migration.js';

const temporaryHomes: string[] = [];

after(async () => {
  await Promise.all(
    temporaryHomes.map((directory) => fsp.rm(directory, { recursive: true, force: true })),
  );
});

test('KodaX migration preview and apply preserve legacy fields while creating split files', async () => {
  const configHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'kodax-space-migration-'));
  temporaryHomes.push(configHome);
  const coreConfigPath = path.join(configHome, 'config.json');
  await fsp.writeFile(
    coreConfigPath,
    `${JSON.stringify(
      {
        provider: 'anthropic',
        mcpServers: {
          local: {
            type: 'stdio',
            command: 'node',
            args: ['server.mjs'],
            env: { API_KEY: '${env:LOCAL_MCP_API_KEY}' },
          },
        },
        extensions: ['C:\\extensions\\example.mjs'],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const preview = await planKodaxIntegrationMigration(configHome);
  assert.equal(preview.mcp.action, 'create');
  assert.equal(preview.mcp.entries, 1);
  assert.equal(preview.extensions.action, 'create');
  assert.equal(preview.extensions.entries, 1);

  const result = await applyKodaxIntegrationMigration(configHome);
  assert.deepEqual(result.applied, ['mcp', 'extensions']);
  assert.equal(result.cleanedLegacy, false);

  const migratedMcp = JSON.parse(
    await fsp.readFile(path.join(configHome, 'integrations', 'mcp.json'), 'utf8'),
  ) as { version: number; servers: Record<string, unknown> };
  const migratedExtensions = JSON.parse(
    await fsp.readFile(path.join(configHome, 'integrations', 'extensions.json'), 'utf8'),
  ) as { version: number; paths: string[] };
  const preservedCore = JSON.parse(await fsp.readFile(coreConfigPath, 'utf8')) as {
    provider: string;
    mcpServers: Record<string, unknown>;
    extensions: string[];
  };

  assert.equal(migratedMcp.version, 1);
  assert.deepEqual(Object.keys(migratedMcp.servers), ['local']);
  assert.deepEqual(migratedExtensions, {
    version: 1,
    paths: ['C:\\extensions\\example.mjs'],
  });
  assert.equal(preservedCore.provider, 'anthropic');
  assert.deepEqual(Object.keys(preservedCore.mcpServers), ['local']);
  assert.deepEqual(preservedCore.extensions, ['C:\\extensions\\example.mjs']);

  const secondPreview = await planKodaxIntegrationMigration(configHome);
  assert.equal(secondPreview.mcp.action, 'none');
  assert.equal(secondPreview.mcp.reason, 'destination-exists');
  assert.equal(secondPreview.extensions.action, 'none');
  assert.equal(secondPreview.extensions.reason, 'destination-exists');
});
