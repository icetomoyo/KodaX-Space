import { expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { launchSpace } from './fixtures.js';

test('Settings previews and applies the SDK legacy integration migration non-destructively', async () => {
  const testId = `integration-migration-${Date.now()}`;
  const space = await launchSpace(testId);
  const coreConfigPath = path.join(space.testDataDir, 'config.json');

  try {
    await fs.writeFile(
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

    await space.page.getByTestId('settings-button').click();
    await space.page.locator('#settings-tab-runtime').click();

    await expect(space.page.getByText('Legacy integration configuration detected')).toBeVisible();
    await expect(space.page.getByText(/MCP: 1 entries/)).toBeVisible();
    await expect(space.page.getByText(/Extensions: 1 entries/)).toBeVisible();

    await space.page.getByRole('button', { name: 'Migrate integrations' }).click();
    await expect(space.page.getByText('Migrate legacy integrations?')).toBeVisible();
    await space.page.getByRole('button', { name: 'Migrate integrations' }).last().click();

    await expect(space.page.getByText('Legacy integration configuration detected')).toHaveCount(0);

    const mcp = JSON.parse(
      await fs.readFile(path.join(space.testDataDir, 'integrations', 'mcp.json'), 'utf8'),
    ) as { version: number; servers: Record<string, unknown> };
    const extensions = JSON.parse(
      await fs.readFile(path.join(space.testDataDir, 'integrations', 'extensions.json'), 'utf8'),
    ) as { version: number; paths: string[] };
    const core = JSON.parse(await fs.readFile(coreConfigPath, 'utf8')) as {
      mcpServers: Record<string, unknown>;
      extensions: string[];
    };

    expect(mcp.version).toBe(1);
    expect(Object.keys(mcp.servers)).toEqual(['local']);
    expect(extensions).toEqual({
      version: 1,
      paths: ['C:\\extensions\\example.mjs'],
    });
    expect(Object.keys(core.mcpServers)).toEqual(['local']);
    expect(core.extensions).toEqual(['C:\\extensions\\example.mjs']);
  } finally {
    await space.close();
  }
});
