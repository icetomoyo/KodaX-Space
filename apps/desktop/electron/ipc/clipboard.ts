// Clipboard IPC handlers — OC-31 v0.1.9.
//
// 把 renderer 给的 base64 image 先落到隔离的草稿目录，返回绝对路径供
// session.send.artifacts 引用；send 接受前复制到持久目录。只有 durable Session
// 删除成功后才清掉历史附件子目录。
//
// 安全:
//   - sessionId 用作子目录名，先 strict regex 校验 ([A-Za-z0-9_-]+，最大 128 字符）
//     防 path traversal (`../` / NUL / 反斜杠等)
//   - 落盘文件名是单调时间戳，renderer 不能控制
//   - 草稿根目录 = app temp/kodax-space/pending-attachments/<profile>/<process>/
//   - 历史根目录 = <KODAX_HOME>/space/session-attachments/
//   - 旧版 app temp 路径只用于兼容已有历史附件
//   - 写盘体积上限同 schema (6 MiB) —— Zod 已先于此 handler 拦
//   - mediaType → 扩展名固定查表（png/jpg/webp），不让 renderer 指定文件后缀

import { constants as fsConstants, promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { registerChannel } from './register.js';
import { getKodaxRuntimeDir } from '../kodax/data-paths.js';

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

type NativeClipboardImage = {
  readonly buffer: Buffer;
  readonly mediaType: 'image/png' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
};

type NativeImageBlock = {
  readonly type: 'image';
  readonly path: string;
  readonly mediaType?: string;
};

type NormalizedImage = {
  readonly buffer: Buffer;
  readonly mediaType: 'image/png' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
};

type MediaSdk = {
  readAndNormalizeClipboardImage(): Promise<NativeClipboardImage | null>;
  persistImageAsBlock(
    image: NativeClipboardImage,
    options: { readonly directory: string; readonly fileNamePrefix: string },
  ): Promise<NativeImageBlock>;
  normalizePastedImage(input: Buffer): Promise<NormalizedImage>;
};

let mediaSdkCache: Promise<MediaSdk> | null = null;
function loadMediaSdk(): Promise<MediaSdk> {
  mediaSdkCache ??= (import('@kodax-ai/kodax/media') as Promise<MediaSdk>).catch((err) => {
    mediaSdkCache = null;
    throw err;
  });
  return mediaSdkCache;
}

const EXT_BY_MEDIA: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// 进程级单调计数器 — 同一毫秒多张粘贴避免文件名冲突。
// (Date.now() 在 Workflow harness 里被禁，但 IPC handler 跑在 main 进程，
//  Electron main 不在 Workflow 沙箱里 —— 这里 Date.now() 完全可用)
let monotonicCounter = 0;
const pendingProcessScope = `${process.pid}-${randomUUID()}`;

// 懒加载 `app` —— electron 模块在 node --test 没原生 binary 时不暴露 `app`，
// 而 host.test.ts → host.ts → 这里的 module load 链不应当因此而崩。registerClipboardChannels
// 才是会被 main 调的入口，到时候 electron 已经在 main 进程里跑起来了。
function durableClipboardRoot(): string {
  return path.join(getKodaxRuntimeDir(), 'space', 'session-attachments');
}

async function electronTempDir(): Promise<string> {
  if (process.env.KODAX_TEST_ONBOARDING) {
    return path.join(getKodaxRuntimeDir(), 'space', 'test-temp');
  }
  if (!process.versions.electron) {
    return os.tmpdir();
  }
  try {
    const electron = await import('electron');
    return electron.app.getPath('temp');
  } catch {
    return os.tmpdir();
  }
}

async function legacyClipboardRoot(): Promise<string> {
  if (process.env.KODAX_TEST_ONBOARDING) {
    return path.join(getKodaxRuntimeDir(), 'space', 'test-legacy-clipboard');
  }
  return path.join(await electronTempDir(), 'kodax-space', 'clipboard');
}

async function pendingClipboardBaseRoot(): Promise<string> {
  if (process.env.KODAX_TEST_ONBOARDING) {
    return path.join(getKodaxRuntimeDir(), 'space', 'test-pending-attachments');
  }
  const profileScope = createHash('sha256')
    .update(path.resolve(getKodaxRuntimeDir()))
    .digest('hex')
    .slice(0, 16);
  return path.join(await electronTempDir(), 'kodax-space', 'pending-attachments', profileScope);
}

async function pendingClipboardRoot(): Promise<string> {
  return path.join(await pendingClipboardBaseRoot(), pendingProcessScope);
}

function durableSessionDir(sessionId: string): string {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error('clipboard.saveImage: invalid sessionId');
  }
  return path.join(durableClipboardRoot(), sessionId);
}

async function pendingSessionDir(sessionId: string): Promise<string> {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error('clipboard.saveImage: invalid sessionId');
  }
  return path.join(await pendingClipboardRoot(), sessionId);
}

async function legacySessionDir(sessionId: string): Promise<string> {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error('clipboard.saveImage: invalid sessionId');
  }
  return path.join(await legacyClipboardRoot(), sessionId);
}

// review HIGH-1 fix: 解码后 image 大小硬上限。schema 的 base64 string 上限会让上
// 一个 ~8 MiB 的 base64 串通过 — decoded 后落地约 6 MiB，超过 MAX_IMAGE_BYTES。
// 把 MAX_IMAGE_BYTES 与上面 schema 的 MAX_IMAGE_BYTES (6 MiB) 对齐，主进程 handler
// 再 enforce 一次 — schema 是 string 长度防 IPC 边界 DoS；这里是 decoded 防写盘 DoS。
const MAX_DECODED_IMAGE_BYTES = 6 * 1024 * 1024;

/** 单纯写盘逻辑 — registerClipboardChannels 和单元测试共用。sdk 参数供测试注入。*/
export async function saveClipboardImage(
  input: {
    readonly sessionId: string;
    readonly base64: string;
    readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  },
  sdk: Pick<MediaSdk, 'normalizePastedImage'> | undefined = undefined,
): Promise<{
  path: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: number;
}> {
  const dir = await pendingSessionDir(input.sessionId);
  // review HIGH-1 fix: 显式 0o700 而非依赖 umask —— 多用户系统下默认 0o755 让 sessionId
  // 文件名 (含时间戳泄露使用窗口) 在 ls 可见，是元数据泄露。0o700 仅 owner 可读/进入。
  // Windows 上 mode 不起 effect，但 POSIX 上必须。注意 `recursive: true` 只对**新建**
  // 目录设 mode；用户已存在的 parent 不会被改 mode (这是预期 — 不应主动 chmod 用户目录)。
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });

  const rawBuf = Buffer.from(input.base64, 'base64');
  if (rawBuf.length === 0) {
    throw new Error('clipboard.saveImage: empty image bytes after base64 decode');
  }
  if (rawBuf.length > MAX_DECODED_IMAGE_BYTES) {
    // review MEDIUM-5 fix: schema string max 算的是 base64 编码后的长度，decoded 后可能仍
    // 超过 6 MiB 上限 (base64 有 ~33% 膨胀)。这里再 enforce 真实字节数，硬拒。
    throw new Error(
      `clipboard.saveImage: image too large after decode: ${rawBuf.length} bytes (max ${MAX_DECODED_IMAGE_BYTES})`,
    );
  }

  // C6: 粘贴 / 拖拽路径过去只做体积上限、原样写盘，绕过了 SDK 的图片规范化（尺寸降采样到
  // MAX_DIMENSION、目标字节数、canonical mediaType）——与原生剪贴板读取路径不一致，一张全分辨率
  // 4K 截图会超规格发给模型。这里补跑 normalizePastedImage 对齐媒体契约。best-effort：媒体子包
  // 不可用（测试环境）或解码失败时回退原始 buffer，保证附图仍可用。
  let outBuf: Buffer = rawBuf;
  let outMediaType: 'image/png' | 'image/jpeg' | 'image/webp' = input.mediaType;
  try {
    const media = sdk ?? (await loadMediaSdk());
    const normalized = await media.normalizePastedImage(rawBuf);
    if (normalized?.buffer?.length) {
      outBuf = normalized.buffer;
      outMediaType = normalized.mediaType;
    }
  } catch (err) {
    console.warn(
      `[clipboard.saveImage] normalizePastedImage failed; writing raw buffer: ${err instanceof Error ? err.message : err}`,
    );
  }

  const ext = EXT_BY_MEDIA[outMediaType];
  if (!ext) {
    // enum 已限三选一，且 normalizePastedImage 只输出 png/jpeg —— 到这里说明 enum 与
    // EXT_BY_MEDIA 失配，是开发者改 schema 没改 handler 的 bug，不是用户输入。
    throw new Error(`clipboard.saveImage: unsupported mediaType ${outMediaType}`);
  }
  monotonicCounter = (monotonicCounter + 1) & 0xffff;
  const filename = `${Date.now().toString(36)}-${monotonicCounter.toString(36)}.${ext}`;
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, outBuf, { mode: 0o600 });

  return { path: filePath, mediaType: outMediaType, bytes: outBuf.length };
}

/** Read a native OS clipboard image and persist it into the Space session sandbox. */
export async function readNativeClipboardImage(
  input: { readonly sessionId: string },
  sdk:
    | Pick<MediaSdk, 'readAndNormalizeClipboardImage' | 'persistImageAsBlock'>
    | undefined = undefined,
): Promise<{
  image: {
    path: string;
    mediaType: 'image/png' | 'image/jpeg';
    base64: string;
    bytes: number;
    width: number;
    height: number;
  } | null;
}> {
  const dir = await pendingSessionDir(input.sessionId);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });

  const media = sdk ?? (await loadMediaSdk());
  const image = await media.readAndNormalizeClipboardImage();
  if (image === null) return { image: null };
  if (image.buffer.length === 0) {
    throw new Error('clipboard.readImage: empty image bytes after native clipboard read');
  }
  if (image.buffer.length > MAX_DECODED_IMAGE_BYTES) {
    throw new Error(
      `clipboard.readImage: image too large after decode: ${image.buffer.length} bytes (max ${MAX_DECODED_IMAGE_BYTES})`,
    );
  }

  const block = await media.persistImageAsBlock(image, {
    directory: dir,
    fileNamePrefix: 'clipboard',
  });
  if (block.type !== 'image' || typeof block.path !== 'string' || block.path.length === 0) {
    throw new Error('clipboard.readImage: SDK returned an invalid image block');
  }
  if (block.mediaType !== image.mediaType) {
    throw new Error(`clipboard.readImage: SDK returned unexpected mediaType ${block.mediaType}`);
  }
  await assertArtifactPathInClipboardSandbox(input.sessionId, block.path);
  await fs.chmod(block.path, 0o600).catch(() => {});

  return {
    image: {
      path: block.path,
      mediaType: image.mediaType,
      base64: image.buffer.toString('base64'),
      bytes: image.buffer.length,
      width: image.width,
      height: image.height,
    },
  };
}

export async function cleanupClipboardSession(input: {
  readonly sessionId: string;
}): Promise<{ removed: number }> {
  const dir = await pendingSessionDir(input.sessionId);
  let removed = 0;
  try {
    const entries = await fs.readdir(dir);
    removed = entries.length;
    // rm -r 整个子目录；之后下次 saveImage 会重建。
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    // ENOENT = session 从没贴过图，正常路径
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return { removed };
}

export async function discardPendingClipboardImage(input: {
  readonly sessionId: string;
  readonly path: string;
}): Promise<{ removed: boolean }> {
  const location = await resolveArtifactLocation(input.sessionId, input.path);
  if (location.kind !== 'pending') {
    throw new Error('clipboard.discardImage: only pending images may be discarded');
  }
  await fs.rm(location.realArtifact, { force: true });
  await fs.rmdir(location.realSandbox).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY') throw err;
  });
  return { removed: true };
}

export function registerClipboardChannels(options: {
  readonly sessionExists: (sessionId: string) => boolean;
}): void {
  const assertSessionExists = (sessionId: string): void => {
    if (!options.sessionExists(sessionId)) {
      throw new Error('clipboard image owner Session does not exist');
    }
  };
  registerChannel('clipboard.saveImage', async (input) => {
    assertSessionExists(input.sessionId);
    return saveClipboardImage(input);
  });
  registerChannel('clipboard.readImage', async (input) => {
    assertSessionExists(input.sessionId);
    return readNativeClipboardImage(input);
  });
  registerChannel('clipboard.cleanupSession', cleanupClipboardSession);
  registerChannel('clipboard.discardImage', discardPendingClipboardImage);
  void cleanupStalePendingClipboardRoots();
}

/**
 * review HIGH-2 fix: session.send.artifacts[].path 由 renderer 传上来 —
 * 必须验证它确实指向 `<clipboardRoot>/<sessionId>/...` 之内的某个文件，
 * 否则恶意 / bug renderer 可以传 `/etc/passwd`，让 SDK 把任意文件
 * 灌进 multimodal content block 发到 LLM 提供商。
 *
 * sessionId 强制是当前 send 调用的 sessionId（不让 renderer 同时引用别 session 的图）。
 * 抛错时 caller (session.ts handler) 必须捕获 → 走 HANDLER_ERROR envelope。
 */
export async function assertArtifactPathInClipboardSandbox(
  sessionId: string,
  artifactPath: string,
): Promise<void> {
  await resolveArtifactLocation(sessionId, artifactPath);
}

type ArtifactLocation = {
  readonly kind: 'durable' | 'legacy' | 'pending';
  readonly realRoot: string;
  readonly realSandbox: string;
  readonly realArtifact: string;
};

async function resolveArtifactLocation(
  sessionId: string,
  artifactPath: string,
): Promise<ArtifactLocation> {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error('artifact validation: invalid sessionId');
  }
  if (!path.isAbsolute(artifactPath)) {
    throw new Error(`artifact path must be absolute: ${artifactPath}`);
  }
  const normalized = path.normalize(artifactPath);
  const sandboxes = [
    {
      kind: 'durable' as const,
      root: durableClipboardRoot(),
      sandbox: durableSessionDir(sessionId),
    },
    {
      kind: 'legacy' as const,
      root: await legacyClipboardRoot(),
      sandbox: await legacySessionDir(sessionId),
    },
    {
      kind: 'pending' as const,
      root: await pendingClipboardRoot(),
      sandbox: await pendingSessionDir(sessionId),
    },
  ];
  const selected = sandboxes.find((candidate) => isPathInside(candidate.sandbox, normalized));
  if (selected === undefined) {
    throw new Error(`artifact path outside clipboard sandbox (sid=${sessionId}): ${artifactPath}`);
  }

  const [realRoot, realSandbox, realArtifact] = await Promise.all([
    fs.realpath(selected.root),
    fs.realpath(selected.sandbox),
    fs.realpath(normalized),
  ]);
  // Resolving sandbox + artifact together is insufficient: a Session directory
  // junction could move both outside the application-owned root. Require the
  // resolved Session directory to remain the named direct child of that root.
  if (path.relative(realRoot, realSandbox) !== sessionId) {
    throw new Error(`artifact path outside clipboard sandbox (sid=${sessionId}): ${artifactPath}`);
  }
  if (!isPathInside(realSandbox, realArtifact)) {
    throw new Error(`artifact path outside clipboard sandbox (sid=${sessionId}): ${artifactPath}`);
  }
  const stat = await fs.stat(realArtifact);
  if (!stat.isFile()) {
    throw new Error(`artifact path must reference a file: ${artifactPath}`);
  }
  return { kind: selected.kind, realRoot, realSandbox, realArtifact };
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

type ClipboardArtifact = {
  readonly kind: 'image';
  readonly path: string;
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly source?: 'user-inline' | 'clipboard' | 'drag-drop' | 'file-picker';
};

/**
 * Copy draft/legacy images into the durable Session sandbox before handing
 * them to KodaX. Draft sources remain available for a retry until send()
 * confirms acceptance.
 */
export async function prepareClipboardArtifactsForSend<T extends ClipboardArtifact>(
  sessionId: string,
  artifacts: readonly T[],
): Promise<T[]> {
  const durableDir = durableSessionDir(sessionId);
  const prepared: T[] = [];

  for (const artifact of artifacts) {
    const location = await resolveArtifactLocation(sessionId, artifact.path);
    if (location.kind === 'durable') {
      prepared.push(artifact);
      continue;
    }

    await fs.mkdir(durableDir, { recursive: true, mode: 0o700 });
    const sourceKey = createHash('sha256')
      .update(path.normalize(location.realArtifact))
      .digest('hex')
      .slice(0, 16);
    const destination = path.join(
      durableDir,
      `${sourceKey}-${path.basename(location.realArtifact)}`,
    );
    try {
      await fs.copyFile(location.realArtifact, destination, fsConstants.COPYFILE_EXCL);
      await fs.chmod(destination, 0o600).catch(() => {});
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const [sourceBytes, destinationBytes] = await Promise.all([
        fs.readFile(location.realArtifact),
        fs.readFile(destination),
      ]);
      if (!sourceBytes.equals(destinationBytes)) {
        throw new Error('clipboard artifact promotion collision');
      }
    }
    await resolveArtifactLocation(sessionId, destination);
    prepared.push({ ...artifact, path: destination });
  }

  return prepared;
}

/** Remove accepted draft copies; durable copies remain Session-owned. */
export async function finalizePendingClipboardArtifacts(
  sessionId: string,
  artifacts: readonly ClipboardArtifact[],
): Promise<void> {
  for (const artifact of artifacts) {
    let location: ArtifactLocation;
    try {
      location = await resolveArtifactLocation(sessionId, artifact.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    if (location.kind !== 'pending') continue;
    await fs.rm(location.realArtifact, { force: true });
  }
  await fs.rmdir(await pendingSessionDir(sessionId)).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY') throw err;
  });
}

/** App shutdown removes only draft files owned by this process. */
export async function cleanupPendingClipboardArtifacts(): Promise<void> {
  await fs.rm(await pendingClipboardRoot(), { recursive: true, force: true });
}

async function cleanupStalePendingClipboardRoots(): Promise<void> {
  const base = await pendingClipboardBaseRoot();
  let entries: Array<{ readonly name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(base, { withFileTypes: true, encoding: 'utf8' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    console.warn(
      `[clipboard.cleanup] failed to inspect stale draft attachments: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== pendingProcessScope)
      .map((entry) => fs.rm(path.join(base, entry.name), { recursive: true, force: true })),
  ).catch((err: unknown) => {
    console.warn(
      `[clipboard.cleanup] failed to remove stale draft attachments: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });
}

/** Main host calls this only after the durable Session was successfully deleted. */
export async function cleanupClipboardForSession(sessionId: string): Promise<void> {
  if (!SESSION_ID_RE.test(sessionId)) return;
  const dirs = [
    durableSessionDir(sessionId),
    await legacySessionDir(sessionId),
    await pendingSessionDir(sessionId),
  ];
  const results = await Promise.allSettled(
    dirs.map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, 'failed to remove all Session attachments');
  }
}
