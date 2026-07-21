// File panel channels — FEATURE_009.
//
// 只读文件视图 + diff。所有读取都是 main 主动校验 path 在 projectRoot 子树内
// （schema 层只能做形态校验，不能做"path 是否真在 projectRoot 下"的语义校验——
// 后者必须在 main handler 用 path.resolve + startsWith + realpath 三重防线）。
//
// 为什么 path 不限制更严格的 regex：
//   - Windows 路径含驱动器 / 反斜杠；macOS/Linux 含 unicode 中文目录名
//   - 用规则限制会误伤合法路径；真正的防线是 main 端 path.resolve 后的 prefix 检查
//   - schema 只兜底：拒空、限长度、拒明显的 control char

import { z } from 'zod';

// 5 MB 文件大小上限——再大让用户用外部编辑器看，Monaco 加载超大文件会卡死 renderer
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

// 单次 tree 请求最大节点数——防 monorepo 巨型仓库一次拉爆 renderer
export const MAX_TREE_NODES = 5000;

/** Structured-clone message emitted by isolated HTML preview diagnostics. */
export const WEB_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE = 'kodax-space.web-preview-diagnostic';

// path 字段共享 schema：长度限制 + 拒控制字符 (\0 \r \n) + 不允许结尾点/空白（Windows trap）
const safePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !/[\x00\r\n]/.test(s), { message: 'path contains control chars' });

// ---- FileNode (recursive) ----
//
// 递归结构：dir 节点的 children 可能未展开（lazy load）——空数组 ≠ "无子节点"，
// 用 expanded 字段区分。前端展开时再发一次 files.tree 拉子树
const baseFileNodeSchema = z.object({
  name: z.string().min(1).max(256),
  path: safePathSchema, // 相对 projectRoot 的 posix-style 路径（'/' 分隔，跨平台一致）
  kind: z.enum(['file', 'dir']),
  size: z.number().int().nonnegative().optional(), // file only；dir 不给
});

type FileNode = z.infer<typeof baseFileNodeSchema> & {
  children?: FileNode[];
};

export const fileNodeSchema: z.ZodType<FileNode> = baseFileNodeSchema.extend({
  children: z.lazy(() => z.array(fileNodeSchema)).optional(),
});

// ---- files.tree ----
//
// 拉项目根的文件树。depth 默认 1（只列直接子节点）；点击展开时前端再请求 depth+1 子目录。
// 为什么不一次返回全树：超过 5k 节点 renderer 卡顿，且 90% 的目录用户不会展开
export const filesTreeChannel = {
  name: 'files.tree',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
    // 相对 projectRoot 的子路径——展开子目录用；空串/undefined = 项目根
    subPath: z.string().max(4096).optional(),
    depth: z.number().int().positive().max(5).optional(),
  }),
  output: z.object({
    tree: z.array(fileNodeSchema),
    truncated: z.boolean(), // 超过 MAX_TREE_NODES 时为 true，前端显示提示
  }),
} as const;

// ---- files.read ----
//
// 读单个文件。content 一律 utf-8（base64 编码模式 v0.1.0 不支持——二进制文件
// main 端直接返回 isBinary: true，前端显示占位）
export const filesReadChannel = {
  name: 'files.read',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
    path: safePathSchema, // 相对 projectRoot 的 posix-style
  }),
  output: z.object({
    content: z.string(), // 上限由 MAX_FILE_BYTES 在 main 端 enforce
    encoding: z.literal('utf-8'),
    size: z.number().int().nonnegative(),
    isBinary: z.boolean(), // true 时 content 为空，前端显示 binary file 占位
    truncated: z.boolean(), // true 表示超 MAX_FILE_BYTES 被拒（content 为空）
  }),
} as const;

// ---- files.readBinary ---- (FEATURE_024 富预览)
//
// 读单个二进制文件，返回 base64 编码 + size + truncated。
// renderer 按文件 ext 路由到 PDF / docx / xlsx 三个 lazy 加载的 viewer。
//
// 安全：
//   - main 端按 maxBytes 兜底（防 renderer 漏过 cap 拉超大文件炸 IPC channel）。
//     现实上限按文件类型分（PDF 50MB / docx+xlsx 10MB），由 renderer 在 input.maxBytes 指定；
//     main 自己再 cap 到 HARD_MAX_BINARY_BYTES 防 renderer 漏过 cap 误传 1GB。
//   - path traversal / projectStore.assertAllowed 同 files.read，handler 端复用相同防御
//
// 与 files.read 区别：
//   - read 返回 utf-8 文本，不超 5MB；超过时 truncated=true + content=''
//   - readBinary 返回 base64，cap 用户传 + main 兜底 50MB
// 拆两个 channel 而非合并：file ext 路由在 renderer 自己做，binary 必须显式请求避免
// 误把巨大 jpg 当文本拉。

const HARD_MAX_BINARY_BYTES = 50 * 1024 * 1024; // 50 MB - renderer previews use base64 IPC, so keep this bounded

export const filesReadBinaryChannel = {
  name: 'files.readBinary',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
    path: safePathSchema,
    /** renderer 期望上限；main 兜底到 HARD_MAX_BINARY_BYTES */
    maxBytes: z.number().int().positive().max(HARD_MAX_BINARY_BYTES),
  }),
  output: z.object({
    /** base64 编码内容；truncated=true 时为空字符串 */
    base64: z.string(),
    size: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
} as const;

const fileStatKindSchema = z.enum(['file', 'dir', 'other']);

// ---- files.stat ----
//
// Lightweight existence/type probe for UI surfaces that render historical file
// references. Missing files return exists=false instead of throwing.
export const filesStatChannel = {
  name: 'files.stat',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
    path: safePathSchema,
  }),
  output: z.object({
    exists: z.boolean(),
    kind: fileStatKindSchema.nullable(),
    size: z.number().int().nonnegative().optional(),
  }),
} as const;

// ---- files.webPreview ----
//
// Creates an in-memory capability URL for a workspace HTML file. The URL does not
// reveal the native project path; Electron main validates and scopes every request.
export const filesWebPreviewChannel = {
  name: 'files.webPreview',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
    path: safePathSchema,
    networkAccess: z.boolean(),
  }),
  output: z.object({
    url: z
      .string()
      .max(8192)
      .regex(/^app:\/\/preview-[a-f0-9]{32}\//, 'invalid project web preview URL'),
    networkAccess: z.boolean(),
  }),
} as const;

// ---- files.diff ----
//
// v0.1.0 alpha：beforeRef 暂不接 git——只支持 KodaX tool_call write/edit 完成时
// adapter 主动把 before/after pair 推到 main 端的 in-memory cache，前端 invoke
// files.diff 时直接 lookup 这个 cache。Real adapter 接入后扩展 beforeRef 含义。
//
// path 仍然要校验在 projectRoot 子树内（防 attacker 用 diff cache 探测系统路径）
export const filesDiffChannel = {
  name: 'files.diff',
  direction: 'invoke',
  input: z.object({
    projectRoot: safePathSchema,
    path: safePathSchema,
  }),
  output: z.object({
    before: z.string(),
    after: z.string(),
    available: z.boolean(), // false：cache miss / 不在最近的 tool_call 记录里
  }),
} as const;

export type FileNodeT = FileNode;
export type FileStatKindT = z.infer<typeof fileStatKindSchema>;
