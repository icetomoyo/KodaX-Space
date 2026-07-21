// Clipboard channels — OC-31 v0.1.9.
//
// 唯一职责：renderer 把 clipboard / drag-drop / file-picker 拿到的 image bytes
// 交给 main 端落盘，main 端返回一个绝对 path。这个 path 之后在 session.send 的
// artifacts 字段里塞回去 → KodaX SDK 通过 KodaXContextOptions.inputArtifacts
// → buildPromptMessageContent 拼成 multimodal content block。
//
// 为什么不直接在 renderer 写盘：
//   - renderer 没有文件系统权限（CSP / sandbox）
//   - 写到哪里需要主进程决策 (app.getPath('temp') / per-session 目录) — 不让 renderer
//     传任意路径，避免 path traversal 攻击面
//
// 临时文件位置：
//   Electron app.getPath('temp')/kodax-space/clipboard/<sessionId>/<timestamp>.<ext>
//   session dispose 时由 main 端清理整个 sessionId 子目录。

import { z } from 'zod';

// 6 MiB 是 Anthropic / OpenAI 对 base64 image 的常见上限分位 (≈8 MiB base64
// 编码后) — 留点余量。过大的截图 / 高分辨率照片这里直接拒绝，让用户先压缩。
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

// ---- Invoke: clipboard.saveImage ----
//
// renderer 把 PNG/JPEG/WEBP buffer (base64 编码) + 该绑定的 sessionId 传过来。
// main 写到 app temp dir，返回绝对路径。
export const clipboardSaveImageChannel = {
  name: 'clipboard.saveImage',
  direction: 'invoke',
  input: z.object({
    /** 绑定到哪个 session — main 用 sessionId 拆子目录，方便 dispose 清理。*/
    sessionId: z.string().min(1).max(128),
    /** base64 编码的原始 image bytes (renderer 端 FileReader.readAsDataURL 后剥 data URI 头)。 */
    base64: z
      .string()
      .min(1)
      .max(MAX_IMAGE_BYTES * 2),
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  }),
  output: z.object({
    /** main 写盘后的绝对路径；renderer 后续把它塞进 session.send.artifacts[].path */
    path: z.string().min(1).max(4096),
    /** SDK 规范化并落盘后的真实媒体类型；可能与 renderer 传入值不同。 */
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    /** 文件落盘后实际字节数 — UI 显示 "230 KB" 等。*/
    bytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
  }),
} as const;

export const clipboardReadImageChannel = {
  name: 'clipboard.readImage',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(128),
  }),
  output: z.object({
    image: z
      .object({
        path: z.string().min(1).max(4096),
        mediaType: z.enum(['image/png', 'image/jpeg']),
        base64: z
          .string()
          .min(1)
          .max(MAX_IMAGE_BYTES * 2),
        bytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
        width: z.number().int().positive().max(100_000),
        height: z.number().int().positive().max(100_000),
      })
      .nullable(),
  }),
} as const;

// ---- Invoke: clipboard.cleanupSession ----
//
// session dispose 时调用 — 删该 sessionId 下所有暂存 image 文件。
// renderer 当前不调，main 端 host.dispose 路径调；声明 channel 是为了未来
// renderer 端关闭 session 选项 ("delete + cleanup attachments") 也能用。
export const clipboardCleanupSessionChannel = {
  name: 'clipboard.cleanupSession',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(128),
  }),
  output: z.object({
    /** 删了多少个文件。0 表示该 session 没贴过图。*/
    removed: z.number().int().nonnegative(),
  }),
} as const;
