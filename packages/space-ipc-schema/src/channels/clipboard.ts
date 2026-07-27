// Clipboard channels — OC-31 v0.1.9.
//
// 唯一职责：renderer 把 clipboard / drag-drop / file-picker 拿到的 image bytes
// 交给 main 端落盘，main 端返回一个绝对 path。这个 path 之后在 session.send 的
// artifacts 字段里塞回去 → KodaX SDK 通过 KodaXContextOptions.inputArtifacts
// → buildPromptMessageContent 拼成 multimodal content block。
//
// 为什么不直接在 renderer 写盘：
//   - renderer 没有文件系统权限（CSP / sandbox）
//   - 写到哪里需要主进程决策 (Space data / per-session 目录) — 不让 renderer
//     传任意路径，避免 path traversal 攻击面
//
// 草稿先写到 main-owned pending temp sandbox；session.send 接受时复制到：
//   <KODAX_HOME>/space/session-attachments/<sessionId>/<timestamp>.<ext>
// 只有 durable Session 删除成功后，main 才清理历史附件目录。

import { z } from 'zod';

// Source bytes cross Electron IPC before KodaX can decode and normalize them, so keep a temporary,
// conservative local-memory ceiling distinct from the provider-safe persisted result. This is not
// a compression-capability threshold. KodaX 0.7.77 normalizes to a 3.75 MiB target; Space retains
// a 6 MiB hard ceiling for the final sandbox file.
export const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_NORMALIZED_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_SOURCE_IMAGE_BYTES / 3);
export const MAX_NORMALIZED_IMAGE_BASE64_LENGTH =
  4 * Math.ceil(MAX_NORMALIZED_IMAGE_BYTES / 3);
const clipboardSessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, {
  message: 'sessionId must be a safe Session token',
});

// ---- Invoke: clipboard.saveImage ----
//
// renderer 把 PNG/JPEG/WEBP buffer (base64 编码) + 该绑定的 sessionId 传过来。
// main 写到隔离的草稿目录，返回绝对路径。session.send 接受前会提升到持久目录。
export const clipboardSaveImageChannel = {
  name: 'clipboard.saveImage',
  direction: 'invoke',
  input: z.object({
    /** 绑定到哪个 session — main 用 sessionId 拆子目录，方便 dispose 清理。*/
    sessionId: clipboardSessionIdSchema,
    /** base64 编码的原始 image bytes (renderer 端 FileReader.readAsDataURL 后剥 data URI 头)。 */
    base64: z
      .string()
      .min(1)
      .max(MAX_SOURCE_IMAGE_BASE64_LENGTH),
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  }),
  output: z.object({
    /** main 写盘后的绝对路径；renderer 后续把它塞进 session.send.artifacts[].path */
    path: z.string().min(1).max(4096),
    /** SDK 规范化并落盘后的真实媒体类型；可能与 renderer 传入值不同。 */
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    /** 文件落盘后实际字节数 — UI 显示 "230 KB" 等。*/
    bytes: z.number().int().positive().max(MAX_NORMALIZED_IMAGE_BYTES),
  }),
} as const;

export const clipboardReadImageChannel = {
  name: 'clipboard.readImage',
  direction: 'invoke',
  input: z.object({
    sessionId: clipboardSessionIdSchema,
  }),
  output: z.object({
    image: z
      .object({
        path: z.string().min(1).max(4096),
        mediaType: z.enum(['image/png', 'image/jpeg']),
        base64: z
          .string()
          .min(1)
          .max(MAX_NORMALIZED_IMAGE_BASE64_LENGTH),
        bytes: z.number().int().positive().max(MAX_NORMALIZED_IMAGE_BYTES),
        width: z.number().int().positive().max(100_000),
        height: z.number().int().positive().max(100_000),
      })
      .nullable(),
  }),
} as const;

// ---- Invoke: clipboard.cleanupSession ----
//
// 清理当前进程中该 Session 尚未发送的草稿图片。它不会删除 legacy 或持久历史
// 附件；历史附件只能在 durable Session 删除成功后由 main 端 host.delete 清理。
export const clipboardCleanupSessionChannel = {
  name: 'clipboard.cleanupSession',
  direction: 'invoke',
  input: z.object({
    sessionId: clipboardSessionIdSchema,
  }),
  output: z.object({
    /** 删了多少个文件。0 表示该 session 没贴过图。*/
    removed: z.number().int().nonnegative(),
  }),
} as const;

// ---- Invoke: clipboard.discardImage ----
//
// 只允许移除当前进程 pending sandbox 内的一张草稿图片；持久和 legacy 历史附件
// 永远不能通过 renderer channel 删除。
export const clipboardDiscardImageChannel = {
  name: 'clipboard.discardImage',
  direction: 'invoke',
  input: z.object({
    sessionId: clipboardSessionIdSchema,
    path: z.string().min(1).max(4096),
  }),
  output: z.object({
    removed: z.boolean(),
  }),
} as const;
