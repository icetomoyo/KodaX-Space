// MCP discovery channel — FEATURE_036 (read-only, alpha.1).
//
// 完整设计要 list 配置 + start/stop/log/tool-catalog (F036 设计文档)，但 KodaX SDK 0.7.40
// 公开 surface 没出 MCP 管理 API（`/mcp` 是 REPL-internal，SDK 不暴露 capability provider）。
// alpha.1 起展示 KodaX MCP 声明；0.1.33 跟随 SDK 改读 integrations/mcp.json。
// 完整版（启停/日志/工具目录）在 v0.1.7 F039 接 SDK 后做（与 F038 同模式）。

import { z } from 'zod';

// MCP transport 类型：stdio (本地子进程) / http (sse/streamable HTTP)
// KodaX 用户配置文件兼容 Anthropic MCP 标准格式
const mcpTransportSchema = z.enum(['stdio', 'http']);

// 单个 MCP server 配置投影 (Space 端关心的字段子集)。
// 不暴露 env 内容——环境变量可能含 secrets，main 端 redact 后再传 renderer。
const mcpServerMetaSchema = z.object({
  /** Server name (integrations/mcp.json `servers` 对象的 key) */
  name: z.string().min(1).max(128),
  transport: mcpTransportSchema,
  /** stdio: 命令。例 'npx' / 'python' / 绝对路径 */
  command: z.string().max(2048).optional(),
  /** stdio: 命令参数 */
  args: z.array(z.string().max(2048)).max(64).optional(),
  /** http: 完整 URL (https/sse) */
  url: z.string().max(2048).optional(),
  /** Env var 个数 (不暴露 key/value，只计数，让用户知道这个 server 用了多少 env) */
  envCount: z.number().int().nonnegative().max(1024),
  /**
   * 配置来源：
   *   - 'global'  ~/.kodax/integrations/mcp.json（KodaX CLI / 用户手配）
   *   - 'project' ${projectRoot}/.kodax/integrations/mcp.json（per-project 覆盖）
   *   - 'mcpb'    v0.1.4：通过 mcpb.install 装的 .mcpb / .dxt 扩展包
   *               （registry 在 ~/.kodax/mcpb/registry.json）
   *
   * UI badge 据此显示来源（"Global" / "Project" / "Extension"），让用户能区分
   * "我手配的 global server" vs "Space 装的 extension"。
   */
  source: z.enum(['global', 'project', 'mcpb']),
});

// ---- Invoke: mcp.discover ----
//
// 拉当前 projectRoot 对应的 MCP server 列表 (global + project 合并；同名 project 覆盖 global)。
// 每次走 disk read——KodaX REPL 改完 integrations/mcp.json 后立刻在 desktop popout 生效。
//
// projectRoot —— 不再要求 live SDK session：用户从 Recents 恢复历史会话时
// UI 有 sessionId 但 SDK 没 spin up；discover 是只读操作，绑 projectRoot 就够。
export const mcpDiscoverChannel = {
  name: 'mcp.discover',
  direction: 'invoke',
  input: z.object({
    projectRoot: z.string().min(1).max(4096),
  }),
  output: z.object({
    servers: z.array(mcpServerMetaSchema).max(128),
    /** 解析过程中跳过的错误（损坏 JSON / shape 不对的 server 条目），UI 给用户提示 */
    errors: z
      .array(
        z.object({
          // 通常是 ~/.kodax/integrations/mcp.json 或项目同名路径[#sanitized-name]
          // 文件系统路径上限保守取 1024（兼容 Windows 长路径 + #name 后缀），不暴露其他来源
          path: z.string().max(1024),
          error: z.string().max(512),
        }),
      )
      .max(32),
  }),
} as const;

export type McpServerMeta = z.infer<typeof mcpServerMetaSchema>;
export type McpTransport = z.infer<typeof mcpTransportSchema>;

// ============================================================================
// v0.1.x: McpManager lifecycle channels (Batch 3 #5 follow-up)
// ============================================================================
//
// Wraps `@kodax-ai/kodax/mcp` McpManager. main 端持有一个 process-singleton manager,
// 通过 IPC 暴露 list/start/stop/logs/tools/reload。McpPanel 渲染时调用以驱动 UI。
//
// 与 mcp.discover 的关系: discover 只读 config 文件展示 list (不触发任何 server 连接);
// 这里的 servers/start/... 才真正触发 SDK 与 server 进程通信。两者并存,语义不冲突。

// 对齐 SDK McpServerRuntimeDiagnostics.status (config.d.ts:52)
const mcpRuntimeStatusSchema = z.enum(['idle', 'connecting', 'ready', 'error', 'disabled']);
// 对齐 SDK McpConnectMode (config.d.ts:9)
const mcpConnectModeSchema = z.enum(['lazy', 'prewarm', 'disabled']);

const mcpManagerScopeInputSchema = z.object({
  /** Optional current project root; when present, lifecycle APIs include project-level MCP config. */
  projectRoot: z.string().min(1).max(4096).optional(),
});

const mcpServerStatusSchema = z.object({
  serverId: z.string().min(1).max(128),
  connect: mcpConnectModeSchema,
  status: mcpRuntimeStatusSchema,
  /** Tools 总数 (catalog 已加载时填,未连接时为 0) */
  tools: z.number().int().nonnegative().max(10_000),
  resources: z.number().int().nonnegative().max(10_000),
  prompts: z.number().int().nonnegative().max(10_000),
  /** SDK 内部 "config / catalog 待 refresh" 标志 */
  dirty: z.boolean(),
  /** ISO 时间戳; catalog 缓存生成时间 */
  cachedAt: z.string().max(64).optional(),
  /** 上一次错误消息 (status=error 时显示在 panel) */
  lastError: z.string().max(2048).optional(),
});

// ---- Invoke: mcp.servers ----
// 列出所有配置的 server + runtime 状态。listServers 是同步 + 廉价的快照,不触发 server 连接。
export const mcpServersChannel = {
  name: 'mcp.servers',
  direction: 'invoke',
  input: mcpManagerScopeInputSchema.optional(),
  output: z.object({
    servers: z.array(mcpServerStatusSchema).max(128),
  }),
} as const;

// ---- Invoke: mcp.start ----
// 强制启动 (lazy server 显式连接, prewarm 重新跑 prewarm 流程)。返回 post-start status。
const mcpServerLifecycleInputSchema = mcpManagerScopeInputSchema.extend({
  serverId: z.string().min(1).max(128),
});

export const mcpStartChannel = {
  name: 'mcp.start',
  direction: 'invoke',
  input: mcpServerLifecycleInputSchema,
  output: z.object({
    status: mcpServerStatusSchema,
  }),
} as const;

// ---- Invoke: mcp.stop ----
// 断开 server (保留配置,后续 start 可恢复)。
export const mcpStopChannel = {
  name: 'mcp.stop',
  direction: 'invoke',
  input: mcpServerLifecycleInputSchema,
  output: z.object({
    status: mcpServerStatusSchema,
  }),
} as const;

// ---- Invoke: mcp.logs ----
// 拿最近 diagnostic envelope (SDK v0.7.42 surface 比较保守,仅 status + lastError + cachedAt)。
export const mcpLogsChannel = {
  name: 'mcp.logs',
  direction: 'invoke',
  input: mcpServerLifecycleInputSchema,
  output: z.object({
    serverId: z.string().min(1).max(128),
    connect: mcpConnectModeSchema,
    status: mcpRuntimeStatusSchema,
    lastError: z.string().max(2048).optional(),
    cachedAt: z.string().max(64).optional(),
  }),
} as const;

// ---- Invoke: mcp.tools ----
// 列出 server 暴露的 tool 描述 (capability descriptors)。触发 lazy connect + catalog fetch。
const mcpToolDescriptorSchema = z.object({
  /** 完整 capability id, 格式 `mcp://<serverId>/tool/<name>` */
  id: z.string().min(1).max(512),
  name: z.string().min(1).max(256),
  description: z.string().max(4096).optional(),
});

const mcpToolsInputSchema = mcpServerLifecycleInputSchema.extend({
  /** true forces a catalog refresh instead of using cached tool descriptors. */
  forceRefresh: z.boolean().optional(),
});

export const mcpToolsChannel = {
  name: 'mcp.tools',
  direction: 'invoke',
  input: mcpToolsInputSchema,
  output: z.object({
    tools: z.array(mcpToolDescriptorSchema).max(1024),
    cachedAt: z.string().max(64).optional(),
  }),
} as const;

// ---- Invoke: mcp.reload ----
// 用户改了 ~/.kodax/integrations/mcp.json 后调,重建 Manager。
export const mcpReloadChannel = {
  name: 'mcp.reload',
  direction: 'invoke',
  input: mcpManagerScopeInputSchema.optional(),
  output: z.object({
    ok: z.boolean(),
    /** Reload 后服务器数 (用 listServers 数过)。0 = integration 里没有 server 或全 disabled */
    serverCount: z.number().int().nonnegative().max(128),
  }),
} as const;

export type McpServerStatusT = z.infer<typeof mcpServerStatusSchema>;
export type McpRuntimeStatusT = z.infer<typeof mcpRuntimeStatusSchema>;
