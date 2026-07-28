// MCP config-reader tests — KodaX 0.7.77 split integration config.
//
// global config 来源 = SDK listMcpServers()，测试用 setMcpStoreImpl mock 注入。
// project config 来源 = SDK readMcpIntegration(`${root}/.kodax`)，测试用真文件 IO。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverMcpServers, setMcpStoreImpl, type McpStoreImpl } from '../mcp/config-reader.js';

let tmpProjectRoot: string;

beforeEach(() => {
  tmpProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kodax-mcp-proj-'));
});

afterEach(() => {
  if (tmpProjectRoot && fs.existsSync(tmpProjectRoot)) {
    fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
  }
  setMcpStoreImpl(null); // restore default
});

/** 注入 mock 模拟 SDK 的 global listMcpServers 返回值 */
function mockGlobalMcpServers(servers: Record<string, unknown>): void {
  const impl: McpStoreImpl = {
    listMcpServers: () => servers as never,
  };
  setMcpStoreImpl(impl);
}

function writeProjectMcpIntegration(content: object | string): void {
  const dir = path.join(tmpProjectRoot, '.kodax', 'integrations');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'mcp.json'),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

function writeLegacyProjectConfig(content: object | string): void {
  const dir = path.join(tmpProjectRoot, '.kodax');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

test('no config anywhere → empty servers + empty errors', async () => {
  mockGlobalMcpServers({});
  const r = await discoverMcpServers({ projectRoot: tmpProjectRoot });
  assert.deepEqual(r.servers, []);
  assert.deepEqual(r.errors, []);
});

test('global stdio server (from SDK) is discovered', async () => {
  mockGlobalMcpServers({
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
  });
  const r = await discoverMcpServers({ projectRoot: tmpProjectRoot });
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].name, 'filesystem');
  assert.equal(r.servers[0].transport, 'stdio');
  assert.equal(r.servers[0].command, 'npx');
  assert.deepEqual(r.servers[0].args, ['-y', '@modelcontextprotocol/server-filesystem']);
  assert.equal(r.servers[0].source, 'global');
  assert.equal(r.servers[0].envCount, 0);
});

test('http server (url; SDK) is discovered', async () => {
  mockGlobalMcpServers({
    'remote-tools': { url: 'https://example.com/mcp' },
  });
  const r = await discoverMcpServers({ projectRoot: tmpProjectRoot });
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].transport, 'http');
  assert.equal(r.servers[0].url, 'https://example.com/mcp');
});

test('env count is reported, env values are NOT exposed', async () => {
  mockGlobalMcpServers({
    'with-env': {
      command: 'python',
      env: { SECRET_KEY: 'shh', API_TOKEN: 'also-secret', LOG_LEVEL: 'debug' },
    },
  });
  const r = await discoverMcpServers({ projectRoot: tmpProjectRoot });
  assert.equal(r.servers[0].envCount, 3);
  // server meta 不应包含原始 env 值
  const serialized = JSON.stringify(r.servers[0]);
  assert.equal(serialized.includes('SECRET_KEY'), false);
  assert.equal(serialized.includes('shh'), false);
});

test('project-level config overrides global (same name)', async () => {
  mockGlobalMcpServers({
    shared: { command: 'global-version' },
  });
  writeProjectMcpIntegration({
    version: 1,
    servers: {
      shared: { command: 'project-version' },
    },
  });
  const r = await discoverMcpServers({ projectRoot: tmpProjectRoot });
  assert.equal(r.servers.length, 1, 'duplicate name → single entry (project wins)');
  assert.equal(r.servers[0].command, 'project-version');
  assert.equal(r.servers[0].source, 'project');
});

test('project + global non-overlapping → both appear', async () => {
  mockGlobalMcpServers({ g: { command: 'gcmd' } });
  writeProjectMcpIntegration({ version: 1, servers: { p: { command: 'pcmd' } } });
  const r = await discoverMcpServers({ projectRoot: tmpProjectRoot });
  assert.equal(r.servers.length, 2);
  const names = r.servers.map((s) => s.name).sort();
  assert.deepEqual(names, ['g', 'p']);
});

test('invalid JSON in project integration config → errors with path; global still parses', async () => {
  mockGlobalMcpServers({ g: { command: 'gcmd' } });
  writeProjectMcpIntegration('{ this is not json');
  const r = await discoverMcpServers({ projectRoot: tmpProjectRoot });
  assert.equal(r.servers.length, 1, 'global still parses');
  assert.equal(r.servers[0].name, 'g');
  assert.ok(
    r.errors.some((e) => /invalid JSON/i.test(e.error)),
    'broken project JSON should appear in errors',
  );
});

test('invalid project server rejects the split document with a file-level error', async () => {
  mockGlobalMcpServers({});
  writeProjectMcpIntegration({
    version: 1,
    servers: {
      good: { command: 'ok' },
      bad: {
        /* no command, no url */
      },
    },
  });
  const r = await discoverMcpServers({ projectRoot: tmpProjectRoot });
  assert.deepEqual(r.servers, []);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].path, /[\\/]integrations[\\/]mcp\.json$/);
  assert.match(r.errors[0].error, /integration config load failed/);
});

test('empty project integration document → no error, empty servers', async () => {
  mockGlobalMcpServers({});
  writeProjectMcpIntegration({ version: 1, servers: {} });
  const r = await discoverMcpServers({ projectRoot: tmpProjectRoot });
  assert.deepEqual(r.servers, []);
  assert.deepEqual(r.errors, []);
});

test('relative projectRoot is rejected', async () => {
  mockGlobalMcpServers({});
  const r = await discoverMcpServers({
    projectRoot: 'not/absolute',
  });
  assert.deepEqual(r.servers, []);
  assert.equal(r.errors.length, 1);
  assert.ok(r.errors[0].error.includes('absolute'));
});

test('project servers field is not an object → error, no crash', async () => {
  mockGlobalMcpServers({});
  writeProjectMcpIntegration({ version: 1, servers: ['not', 'an', 'object'] });
  const r = await discoverMcpServers({ projectRoot: tmpProjectRoot });
  assert.deepEqual(r.servers, []);
  assert.ok(r.errors.some((e) => e.error.includes('integration config load failed')));
});

test('SDK-side server without command or url → entry skipped + error pushed (MEDIUM-1)', async () => {
  // reviewer MEDIUM-1: 之前 readGlobalServersFromSdk 静默丢 shape 异常的 SDK entry，
  // 现在统一进 errors[]，跟 project-level shape 异常的行为对称
  mockGlobalMcpServers({
    good: { command: 'gcmd' },
    bad: {
      /* no command, no url */
    },
  });
  const r = await discoverMcpServers({ projectRoot: tmpProjectRoot });
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].name, 'good');
  assert.ok(
    r.errors.some((e) => e.path.includes('#bad')),
    'malformed global server should appear in errors with #key suffix',
  );
});

test('legacy project config remains readable until migration', async () => {
  mockGlobalMcpServers({ g: { command: 'gcmd' } });
  writeLegacyProjectConfig({ mcpServers: { legacy: { command: 'legacy-project' } } });
  const r = await discoverMcpServers({ projectRoot: tmpProjectRoot });
  assert.deepEqual(
    r.servers.map((server) => [server.name, server.source, server.command]),
    [
      ['g', 'global', 'gcmd'],
      ['legacy', 'project', 'legacy-project'],
    ],
  );
  assert.deepEqual(r.errors, []);
});
