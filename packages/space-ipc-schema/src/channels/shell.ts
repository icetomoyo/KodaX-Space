// Shell channels — "open a path / URL from the system shell".
//
// 背景：renderer 里到处展示文件路径 / URL（聊天 tool 卡、右侧 Context 栏、MCP 面板、
// diff 头）却全是死文本——用户点不动（用户反馈 2026-06-18）。这两个 channel 给 renderer
// 一条**安全**的"触达系统 shell"出口：
//   - shell.revealPath   → shell.showItemInFolder：在系统文件管理器里定位高亮该文件。
//   - shell.openExternal → shell.openExternal：用系统浏览器打开 http(s) URL。
//
// 为什么只做 reveal + openExternal，不做 shell.openPath（用默认程序打开任意文件）：
//   showItemInFolder 只是"在 Explorer/Finder 里选中"——**永不执行**目标，哪怕它是 .exe。
//   openPath 会用 OS 默认程序打开，对 .exe / .bat 等于执行，是 RCE 面，故本版不开。
//   "在 App 内预览网页" 走 File Viewer 的 files.read（沙盒 iframe），不碰 shell。
//
// 安全：
//   - revealPath：path 必须绝对（或配 projectRoot 解析为绝对）；main 端 fs.access 存在才 reveal。
//     reveal 不执行目标，风险面仅"暴露某路径存在"——paths 来自本进程自己的 session/config，可接受。
//   - openExternal：main 端只放行 http/https（schema + handler 双重）；其它协议（file:/javascript:/
//     vbscript: 等）一律拒，杜绝 openExternal 被当作本地命令执行入口。

import { z } from 'zod';

// 共享 path 形态校验：非空、限长、拒控制字符（\0 \r \n）。真正的"在不在 projectRoot 内"
// 由 main 端 path.resolve + isPathInside 语义校验，schema 这层只兜底形态。
const safePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !/[\x00\r\n]/.test(s), { message: 'path contains control chars' });

// ---- Invoke: shell.revealPath ----
//
// 在系统文件管理器里定位高亮一个文件/目录。两种入参形态：
//   - 绝对 path：直接 reveal（MCP config 路径等可能在项目外，如 ~/.kodax/mcp.json）。
//   - 相对 path + projectRoot：main 端 resolveInsideProject 解析为项目内绝对路径再 reveal。
// found=false：文件不存在 / 解析失败（renderer 据此可提示或静默）。
export const shellRevealPathChannel = {
  name: 'shell.revealPath',
  direction: 'invoke',
  input: z.object({
    path: safePathSchema,
    /** 相对 path 时用于解析；绝对 path 时忽略。 */
    projectRoot: safePathSchema.optional(),
  }),
  output: z.object({
    /** true=已 reveal；false=文件不存在或路径非法（main 端静默不抛）。 */
    revealed: z.boolean(),
  }),
} as const;

// ---- Invoke: shell.openDirectory ----
//
// Open an allowlisted directory itself in Explorer/Finder. The main process
// verifies that the resolved target exists and is a directory before calling
// Electron shell.openPath, so this channel cannot execute arbitrary local files.
export const shellOpenDirectoryChannel = {
  name: 'shell.openDirectory',
  direction: 'invoke',
  input: z.object({
    path: safePathSchema,
    projectRoot: safePathSchema.optional(),
  }),
  output: z.object({
    opened: z.boolean(),
  }),
} as const;

// ---- Invoke: shell.openExternal ----
//
// 用系统默认浏览器打开一个 http(s) URL（MCP server URL、provider baseUrl 等）。
// 非 http/https 一律拒（opened=false），不让本 channel 变成任意协议跳板。
export const shellOpenExternalChannel = {
  name: 'shell.openExternal',
  direction: 'invoke',
  input: z.object({
    url: z
      .string()
      .min(1)
      .max(2048)
      .refine((s) => /^https?:\/\//i.test(s), { message: 'only http(s) URLs allowed' }),
  }),
  output: z.object({
    /** true=已交给系统打开；false=协议不被放行。 */
    opened: z.boolean(),
  }),
} as const;
