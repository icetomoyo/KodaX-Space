import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { SessionImageAttachment } from '@kodax-space/space-ipc-schema';
import { resolveSessionAttachmentPreviewFile } from '../ipc/clipboard.js';
import { APP_PROTOCOL_HOST, APP_PROTOCOL_ORIGIN } from './app-protocol-policy.js';

const ROUTE_PREFIX = '/session-attachment/';
const MAX_PREVIEW_CAPABILITIES = 32_768;

interface PreviewCapability {
  readonly sessionId: string;
  readonly artifactPath: string;
}

const previewCapabilities = new Map<string, PreviewCapability>();

function stableAttachmentId(sessionId: string, artifactPath: string, ordinal: number): string {
  return createHash('sha256')
    .update(sessionId)
    .update('\0')
    .update(artifactPath)
    .update('\0')
    .update(String(ordinal))
    .digest('hex')
    .slice(0, 32);
}

function issueToken(capability: PreviewCapability): string {
  const token = randomBytes(24).toString('base64url');
  previewCapabilities.set(token, capability);
  while (previewCapabilities.size > MAX_PREVIEW_CAPABILITIES) {
    const oldest = previewCapabilities.keys().next().value;
    if (typeof oldest !== 'string') break;
    previewCapabilities.delete(oldest);
  }
  return token;
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export async function issueSessionImageAttachment(input: {
  readonly sessionId: string;
  readonly artifactPath: string;
  readonly declaredMediaType?: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly ordinal: number;
  readonly label?: string;
}): Promise<SessionImageAttachment> {
  const base = {
    id: stableAttachmentId(input.sessionId, input.artifactPath, input.ordinal),
    kind: 'image' as const,
    ...(input.declaredMediaType !== undefined ? { mediaType: input.declaredMediaType } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
  };
  try {
    const resolved = await resolveSessionAttachmentPreviewFile(input.sessionId, input.artifactPath);
    const token = issueToken({
      sessionId: input.sessionId,
      artifactPath: input.artifactPath,
    });
    const root = `${APP_PROTOCOL_ORIGIN}${ROUTE_PREFIX}${token}`;
    return {
      ...base,
      mediaType: resolved.mediaType,
      bytes: resolved.bytes,
      status: 'available',
      thumbnailUrl: `${root}?variant=thumbnail`,
      previewUrl: `${root}?variant=original`,
    };
  } catch (error) {
    const code = errorCode(error);
    return {
      ...base,
      status: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unsupported',
    };
  }
}

export function revokeSessionAttachmentPreviews(sessionId: string): void {
  for (const [token, capability] of previewCapabilities) {
    if (capability.sessionId === sessionId) previewCapabilities.delete(token);
  }
}

function responseHeaders(mediaType?: string, bytes?: number): Record<string, string> {
  return {
    ...(mediaType !== undefined ? { 'content-type': mediaType } : {}),
    ...(bytes !== undefined ? { 'content-length': String(bytes) } : {}),
    'x-content-type-options': 'nosniff',
    // A revoked/deleted Session must not remain readable from Chromium's image cache.
    'cache-control': 'no-store',
  };
}

function failure(status: number, code: string): Response {
  return new Response(code, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Handle the private image route. null means the URL belongs to another app:// route.
 * Thumbnail currently relies on Chromium's lazy image decode and CSS sizing; keeping a distinct
 * variant in the URL leaves room for main-process downsampling without changing message state.
 */
export async function handleSessionAttachmentProtocolRequest(
  requestUrl: string,
  method: string,
): Promise<Response | null> {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'app:' || url.host !== APP_PROTOCOL_HOST) return null;
  if (!url.pathname.startsWith(ROUTE_PREFIX)) return null;
  if (method !== 'GET' && method !== 'HEAD') return failure(405, 'method-not-allowed');
  if (url.username || url.password || url.port || url.hash) return failure(400, 'invalid-url');
  const token = url.pathname.slice(ROUTE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token) || token.includes('/')) {
    return failure(400, 'invalid-token');
  }
  const params = [...url.searchParams.entries()];
  if (
    params.length !== 1 ||
    params[0]?.[0] !== 'variant' ||
    (params[0]?.[1] !== 'thumbnail' && params[0]?.[1] !== 'original')
  ) {
    return failure(400, 'invalid-variant');
  }
  const capability = previewCapabilities.get(token);
  if (capability === undefined) return failure(404, 'not-found');
  try {
    const resolved = await resolveSessionAttachmentPreviewFile(
      capability.sessionId,
      capability.artifactPath,
    );
    if (method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: responseHeaders(resolved.mediaType, resolved.bytes),
      });
    }
    const bytes = await readFile(resolved.filePath);
    if (bytes.length !== resolved.bytes) return failure(409, 'file-changed');
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: responseHeaders(resolved.mediaType, bytes.length),
    });
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return failure(404, 'not-found');
    if (code === 'EACCES' || code === 'EPERM') return failure(403, 'forbidden');
    return failure(415, 'unsupported-image');
  }
}
