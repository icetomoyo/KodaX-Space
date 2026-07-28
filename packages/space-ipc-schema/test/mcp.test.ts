// MCP IPC schema tests — FEATURE_036 alpha.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  invokeChannels,
  INVOKE_CHANNEL_NAMES,
  mcpDiscoverChannel,
  mcpLogsChannel,
  mcpReloadChannel,
  mcpServersChannel,
  mcpStartChannel,
  mcpStopChannel,
  mcpToolsChannel,
} from '../src/index.js';

test('mcp.discover channel is registered', () => {
  assert.ok(invokeChannels['mcp.discover']);
  assert.ok(INVOKE_CHANNEL_NAMES.has('mcp.discover'));
});

test('mcp.discover input requires projectRoot', () => {
  assert.equal(mcpDiscoverChannel.input.safeParse({ projectRoot: 'C:\\proj' }).success, true);
  assert.equal(mcpDiscoverChannel.input.safeParse({}).success, false);
  assert.equal(mcpDiscoverChannel.input.safeParse({ projectRoot: '' }).success, false);
});

test('mcp lifecycle inputs accept optional projectRoot scope', () => {
  assert.equal(mcpServersChannel.input.safeParse(undefined).success, true);
  assert.equal(mcpServersChannel.input.safeParse({ projectRoot: 'C:/proj' }).success, true);
  assert.equal(mcpServersChannel.input.safeParse({ projectRoot: '' }).success, false);

  const scopedServer = { serverId: 'gitnexus', projectRoot: 'C:/proj' };
  assert.equal(mcpStartChannel.input.safeParse(scopedServer).success, true);
  assert.equal(mcpStopChannel.input.safeParse(scopedServer).success, true);
  assert.equal(mcpLogsChannel.input.safeParse(scopedServer).success, true);
  assert.equal(
    mcpToolsChannel.input.safeParse({ ...scopedServer, forceRefresh: true }).success,
    true,
  );
  assert.equal(mcpReloadChannel.input.safeParse(undefined).success, true);
  assert.equal(mcpReloadChannel.input.safeParse({ projectRoot: 'C:/proj' }).success, true);
});

test('mcp.discover output accepts stdio + http transports', () => {
  const out = {
    servers: [
      {
        name: 'fs',
        transport: 'stdio' as const,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        envCount: 0,
        source: 'global' as const,
      },
      {
        name: 'http-tools',
        transport: 'http' as const,
        url: 'https://example.com/mcp',
        envCount: 2,
        source: 'project' as const,
      },
    ],
    errors: [],
  };
  assert.equal(mcpDiscoverChannel.output.safeParse(out).success, true);
});

test('mcp.discover output rejects unknown transport', () => {
  const out = {
    servers: [
      {
        name: 'x',
        transport: 'websocket',
        envCount: 0,
        source: 'global' as const,
      },
    ],
    errors: [],
  };
  assert.equal(mcpDiscoverChannel.output.safeParse(out).success, false);
});

test('mcp.discover output accepts errors array', () => {
  const out = {
    servers: [],
    errors: [
      {
        path: '/home/u/.kodax/integrations/mcp.json',
        error: 'invalid JSON: Unexpected token',
      },
    ],
  };
  assert.equal(mcpDiscoverChannel.output.safeParse(out).success, true);
});

test('mcp.discover output enforces servers max 128', () => {
  const servers = Array.from({ length: 129 }, (_, i) => ({
    name: `s${i}`,
    transport: 'stdio' as const,
    command: 'x',
    envCount: 0,
    source: 'global' as const,
  }));
  assert.equal(mcpDiscoverChannel.output.safeParse({ servers, errors: [] }).success, false);
});

test('mcp.discover output accepts source="mcpb" (v0.1.4 installed bundles)', () => {
  const out = {
    servers: [
      {
        name: 'filesystem',
        transport: 'stdio' as const,
        command: 'node',
        args: ['/home/u/.kodax/mcpb/extensions/filesystem@1.0.0/index.js'],
        envCount: 0,
        source: 'mcpb' as const,
      },
    ],
    errors: [],
  };
  assert.equal(mcpDiscoverChannel.output.safeParse(out).success, true);
});

test('mcp server name must be 1..128 chars', () => {
  const tooLong = 'x'.repeat(129);
  const out = {
    servers: [
      {
        name: tooLong,
        transport: 'stdio' as const,
        command: 'x',
        envCount: 0,
        source: 'global' as const,
      },
    ],
    errors: [],
  };
  assert.equal(mcpDiscoverChannel.output.safeParse(out).success, false);
});
