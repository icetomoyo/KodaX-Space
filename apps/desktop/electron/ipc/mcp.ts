// MCP IPC handlers — FEATURE_036 + v0.1.x lifecycle (Batch 3 #5 follow-up).
//
//   mcp.discover    读 integrations/mcp.json + project (Space 投影, 不触发连接)
//   mcp.servers     McpManager.listServers — runtime 状态快照 + catalog 大小
//   mcp.start       强制连接 + catalog refresh
//   mcp.stop        断开 + drop pending queue, 保留配置
//   mcp.logs        最近 diagnostic envelope (status + lastError + cachedAt)
//   mcp.tools       拿 tool descriptors (lazy connect if needed)
//   mcp.reload      用户改 config 后调, dispose 现有 Manager + 重建

import { registerChannel } from './register.js';
import { discoverMcpServers } from '../mcp/config-reader.js';
import { getMcpManager, reloadMcpManager } from '../mcp/manager.js';
import { invalidateSpaceSdkExtensionRuntimes } from '../kodax/sdk-extensions.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';
import type { McpServerStatusT, McpRuntimeStatusT } from '@kodax-space/space-ipc-schema';

/** SDK McpServerStatus → IPC McpServerStatusT 投影。两端 shape 几乎一致,只把 number 字段
 *  clamp 到 IPC schema 上限防御异常值。 */
function projectStatus(s: import('@kodax-ai/kodax/mcp').McpServerStatus): McpServerStatusT {
  return {
    serverId: s.serverId,
    connect: s.connect,
    status: s.status as McpRuntimeStatusT,
    tools: Math.min(s.tools, 10_000),
    resources: Math.min(s.resources, 10_000),
    prompts: Math.min(s.prompts, 10_000),
    dirty: s.dirty,
    ...(s.cachedAt !== undefined ? { cachedAt: s.cachedAt } : {}),
    ...(s.lastError !== undefined ? { lastError: s.lastError } : {}),
  };
}

function managerOptions(input?: {
  readonly projectRoot?: string;
}): { readonly projectRoot?: string } | undefined {
  return input?.projectRoot ? { projectRoot: input.projectRoot } : undefined;
}

export function registerMcpChannels(): void {
  registerChannel('mcp.discover', async (input) => {
    return discoverMcpServers({ projectRoot: input.projectRoot });
  });

  registerChannel('mcp.servers', async (input) => {
    const manager = await getMcpManager(managerOptions(input));
    const list = manager.listServers();
    // schema cap is 128
    const projected = list.slice(0, 128).map(projectStatus);
    return { servers: projected };
  });

  registerChannel('mcp.start', async (input) => {
    const manager = await getMcpManager(managerOptions(input));
    const status = await manager.startServer(input.serverId);
    return { status: projectStatus(status) };
  });

  registerChannel('mcp.stop', async (input) => {
    const manager = await getMcpManager(managerOptions(input));
    const status = await manager.stopServer(input.serverId);
    return { status: projectStatus(status) };
  });

  registerChannel('mcp.logs', async (input) => {
    const manager = await getMcpManager(managerOptions(input));
    const logs = manager.getServerLogs(input.serverId);
    return {
      serverId: logs.serverId,
      connect: logs.connect,
      status: logs.status as McpRuntimeStatusT,
      ...(logs.lastError !== undefined ? { lastError: logs.lastError } : {}),
      ...(logs.cachedAt !== undefined ? { cachedAt: logs.cachedAt } : {}),
    };
  });

  registerChannel('mcp.tools', async (input) => {
    if (runtimeHostAdapter.isRuntimeSelected()) {
      try {
        const list = await runtimeHostAdapter.listRuntimeMcpTools(
          input.serverId,
          input.forceRefresh,
        );
        return {
          tools: list.tools.slice(0, 1024).map((tool) => ({
            id: tool.id,
            name: tool.name,
            ...(tool.summary !== undefined ? { description: tool.summary } : {}),
          })),
          ...(list.cachedAt !== undefined ? { cachedAt: list.cachedAt } : {}),
        };
      } catch (error) {
        console.warn(
          '[mcp.tools] Coder daemon catalog unavailable; using Space host provider:',
          error instanceof Error ? error.message : error,
        );
      }
    }
    const manager = await getMcpManager(managerOptions(input));
    const list = await manager.listTools(input.serverId, {
      forceRefresh: input.forceRefresh,
    });
    // SDK 给出全 capability descriptor; 投影到 IPC schema (id/name/description), cap 1024
    const tools = list.tools.slice(0, 1024).map((t) => ({
      id: t.id,
      name: t.name,
      ...(t.summary !== undefined ? { description: t.summary } : {}),
    }));
    return {
      tools,
      ...(list.cachedAt !== undefined ? { cachedAt: list.cachedAt } : {}),
    };
  });

  registerChannel('mcp.reload', async (input) => {
    await reloadMcpManager();
    await invalidateSpaceSdkExtensionRuntimes().catch((err) => {
      console.warn(
        '[mcp] SDK extension runtime invalidation after reload failed:',
        err instanceof Error ? err.message : err,
      );
    });
    if (runtimeHostAdapter.isRuntimeSelected()) {
      try {
        const runtime = await runtimeHostAdapter.reloadRuntimeMcp();
        return { ok: true, serverCount: Math.min(runtime.servers.length, 128) };
      } catch (error) {
        console.warn(
          '[mcp.reload] Coder daemon reload unavailable; retaining Space reload result:',
          error instanceof Error ? error.message : error,
        );
      }
    }
    // reload 后 lazy: 调一次 listServers 拿当前 count
    try {
      const manager = await getMcpManager(managerOptions(input));
      const count = manager.listServers().length;
      return { ok: true, serverCount: Math.min(count, 128) };
    } catch {
      return { ok: false, serverCount: 0 };
    }
  });
}
