import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  ARTIFACT_HTML_FRAME_MESSAGE_TYPE,
  ARTIFACT_HTML_FRAME_URL,
} from '@kodax-space/space-ipc-schema';

export const APP_PROTOCOL_SCHEME = 'app';
export const APP_PROTOCOL_HOST = 'space';
export const APP_PROTOCOL_ORIGIN = `${APP_PROTOCOL_SCHEME}://${APP_PROTOCOL_HOST}`;
export const APP_PROTOCOL_INDEX_URL = `${APP_PROTOCOL_ORIGIN}/index.html`;

// This response belongs only to the sandboxed child frame. It is intentionally
// broad enough for the child document's injected, permission-specific CSP to be
// authoritative; it must never be used for the main renderer document.
export const ARTIFACT_HTML_FRAME_BOOTSTRAP_CSP = [
  "default-src 'none'",
  "script-src * 'unsafe-inline'",
  'worker-src blob:',
  "style-src * 'unsafe-inline'",
  'img-src * data: blob:',
  'font-src * data:',
  'media-src * data: blob:',
  'connect-src *',
  'frame-src *',
  "object-src 'none'",
  "base-uri 'none'",
  'form-action *',
].join('; ');

export const ARTIFACT_HTML_FRAME_BOOTSTRAP = `<!doctype html>
<html><head><meta charset="utf-8"><title>Artifact HTML sandbox</title></head>
<body><script>
window.addEventListener('message', function receiveArtifact(event) {
  var payload = event.data;
  if (event.source !== parent || !payload || payload.type !== ${JSON.stringify(ARTIFACT_HTML_FRAME_MESSAGE_TYPE)} || typeof payload.documentHtml !== 'string') return;
  window.removeEventListener('message', receiveArtifact);
  document.open();
  document.write(payload.documentHtml);
  document.close();
});
</script></body></html>`;

export function isArtifactHtmlFrameUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const expected = new URL(ARTIFACT_HTML_FRAME_URL);
    if (
      url.protocol !== expected.protocol ||
      url.host !== expected.host ||
      url.pathname !== expected.pathname ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      return false;
    }
    return Array.from(url.searchParams.keys()).every((key) => key === 'v');
  } catch {
    return false;
  }
}

export function artifactHtmlFrameResponseHeaders(): Readonly<Record<string, string>> {
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': ARTIFACT_HTML_FRAME_BOOTSTRAP_CSP,
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  };
}

export type AppProtocolResolution =
  | { readonly ok: true; readonly filePath: string }
  | {
      readonly ok: false;
      readonly status: 400 | 403 | 404 | 500;
      readonly code:
        | 'invalid-url'
        | 'invalid-authority'
        | 'non-canonical-path'
        | 'root-escape'
        | 'not-file'
        | 'not-found'
        | 'io-failure';
    };

function failure(
  status: 400 | 403 | 404 | 500,
  code: Exclude<AppProtocolResolution, { ok: true }>['code'],
): AppProtocolResolution {
  return { ok: false, status, code };
}

function staysInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

/** Resolve one immutable packaged renderer request without importing Electron. */
export async function resolveAppProtocolPath(
  requestUrl: string,
  rendererRoot: string,
): Promise<AppProtocolResolution> {
  const match = /^app:\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(requestUrl);
  if (!match) return failure(400, 'invalid-url');
  const [, authority, encodedPath = '', query, fragment] = match;
  if (authority !== APP_PROTOCOL_HOST) return failure(403, 'invalid-authority');
  // Electron forwards URL fragments to custom protocol handlers. Allow them only on the
  // renderer document, where they are client-side routes and cannot change the served file.
  if (query !== undefined || (fragment !== undefined && encodedPath !== '/index.html')) {
    return failure(400, 'invalid-url');
  }
  if (/%(?:2e|2f|5c)/i.test(encodedPath)) return failure(400, 'non-canonical-path');

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(encodedPath || '/');
  } catch {
    return failure(400, 'non-canonical-path');
  }
  if (
    !decodedPath.startsWith('/') ||
    decodedPath.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(decodedPath) ||
    (decodedPath !== '/' && decodedPath.includes('//'))
  ) {
    return failure(400, 'non-canonical-path');
  }

  const requestedPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const segments = requestedPath.slice(1).split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return failure(400, 'non-canonical-path');
  }
  if (path.posix.normalize(requestedPath) !== requestedPath) {
    return failure(400, 'non-canonical-path');
  }

  const absoluteRoot = path.resolve(rendererRoot);
  const candidate = path.resolve(absoluteRoot, ...segments);
  if (!staysInside(absoluteRoot, candidate)) return failure(403, 'root-escape');

  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(absoluteRoot);
  } catch {
    return failure(500, 'io-failure');
  }

  try {
    const [canonicalCandidate, candidateStat] = await Promise.all([
      realpath(candidate),
      stat(candidate),
    ]);
    if (!staysInside(canonicalRoot, canonicalCandidate)) return failure(403, 'root-escape');
    if (!candidateStat.isFile()) return failure(403, 'not-file');
    return { ok: true, filePath: canonicalCandidate };
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return failure(404, 'not-found');
    if (code === 'EACCES' || code === 'EPERM') return failure(403, 'not-file');
    return failure(500, 'io-failure');
  }
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

export function mimeTypeForAppAsset(filePath: string): string {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function appAssetResponseHeaders(filePath: string): Readonly<Record<string, string>> {
  const isIndex = path.basename(filePath).toLowerCase() === 'index.html';
  return {
    'content-type': mimeTypeForAppAsset(filePath),
    'x-content-type-options': 'nosniff',
    'cache-control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
  };
}
