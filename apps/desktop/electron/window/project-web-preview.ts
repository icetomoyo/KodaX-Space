import { randomBytes } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { WEB_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE } from '@kodax-space/space-ipc-schema';

const PREVIEW_HOST_PREFIX = 'preview-';
const TOKEN_PATTERN = /^[a-f0-9]{32}$/;
const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 32;

export const PROJECT_WEB_PREVIEW_RUNTIME_PATH = '/__kodax_preview_runtime__.js';
export const MAX_PROJECT_WEB_PREVIEW_FILE_BYTES = 50 * 1024 * 1024;

const PREVIEW_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.json',
  '.xml',
  '.txt',
  '.csv',
  '.tsv',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.wasm',
  '.map',
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.opus',
  '.ogg',
  '.mp4',
  '.m4v',
  '.mov',
  '.webm',
  '.ogv',
]);

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
};

interface Capability {
  readonly token: string;
  readonly scopeRoot: string;
  readonly cacheKey: string;
  readonly networkAccess: boolean;
  lastAccessedAt: number;
}

interface RegistryOptions {
  readonly now?: () => number;
  readonly tokenFactory?: () => string;
  readonly idleTtlMs?: number;
  readonly maxEntries?: number;
}

export interface ProjectWebPreviewCreateInput {
  readonly projectRoot: string;
  readonly entryPath: string;
  readonly networkAccess: boolean;
}

export interface ProjectWebPreviewCreated {
  readonly url: string;
  readonly networkAccess: boolean;
}

export interface ProjectWebPreviewSources {
  readonly script: readonly string[];
  readonly style: readonly string[];
  readonly img: readonly string[];
  readonly font: readonly string[];
  readonly media: readonly string[];
}

type PreviewFailureCode =
  | 'invalid-url'
  | 'invalid-method'
  | 'unknown-capability'
  | 'expired-capability'
  | 'non-canonical-path'
  | 'scope-escape'
  | 'sensitive-file'
  | 'unsupported-file'
  | 'too-large'
  | 'not-file'
  | 'not-found'
  | 'io-failure';

export type ProjectWebPreviewResolution =
  | {
      readonly ok: true;
      readonly kind: 'file';
      readonly filePath: string;
      readonly networkAccess: boolean;
    }
  | {
      readonly ok: true;
      readonly kind: 'runtime';
      readonly networkAccess: boolean;
    }
  | {
      readonly ok: false;
      readonly status: 400 | 403 | 404 | 405 | 413 | 500;
      readonly code: PreviewFailureCode;
    };

function failure(
  status: 400 | 403 | 404 | 405 | 413 | 500,
  code: PreviewFailureCode,
): ProjectWebPreviewResolution {
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

function defaultTokenFactory(): string {
  return randomBytes(16).toString('hex');
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%2F/gi, '%252F');
}

function attribute(attrs: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = attrs.match(
    new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

function addHttpsOrigin(target: Set<string>, raw: string | null | undefined): void {
  if (!raw || target.size >= 12) return;
  try {
    const normalized = raw.trim().startsWith('//') ? `https:${raw.trim()}` : raw.trim();
    const url = new URL(normalized);
    if (url.protocol === 'https:') target.add(url.origin);
  } catch {
    // Invalid and relative URLs are handled by the local capability origin.
  }
}

function addSrcsetOrigins(target: Set<string>, raw: string | null): void {
  for (const candidate of raw?.split(',') ?? []) {
    addHttpsOrigin(target, candidate.trim().split(/\s+/)[0]);
  }
}

function isFontResource(raw: string): boolean {
  try {
    const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
    return /\.(?:woff2?|ttf|otf|eot)$/i.test(new URL(normalized).pathname);
  } catch {
    return false;
  }
}

/**
 * Discover only HTTPS resources already authored into the document. Local-only
 * mode may load these presentation dependencies, but it still blocks arbitrary
 * fetch/WebSocket connections until the user enables full network access.
 */
export function inferProjectWebPreviewSources(html: string): ProjectWebPreviewSources {
  const sets = {
    script: new Set<string>(),
    style: new Set<string>(),
    img: new Set<string>(),
    font: new Set<string>(),
    media: new Set<string>(),
  };

  for (const match of html.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const tag = match[1]?.toLowerCase();
    const attrs = match[2] ?? '';
    if (tag === 'script') {
      addHttpsOrigin(sets.script, attribute(attrs, 'src'));
    } else if (tag === 'link') {
      const rel = (attribute(attrs, 'rel') ?? '').toLowerCase();
      const as = (attribute(attrs, 'as') ?? '').toLowerCase();
      const href = attribute(attrs, 'href');
      if (rel.includes('stylesheet') || as === 'style') {
        addHttpsOrigin(sets.style, href);
        try {
          const normalized = href?.startsWith('//') ? `https:${href}` : href;
          if (normalized && new URL(normalized).origin === 'https://fonts.googleapis.com') {
            sets.font.add('https://fonts.gstatic.com');
          }
        } catch {
          // Ignore invalid authored URLs.
        }
      } else if (as === 'font') addHttpsOrigin(sets.font, href);
      else if (rel.includes('icon') || as === 'image') addHttpsOrigin(sets.img, href);
      else if (as === 'audio' || as === 'video') addHttpsOrigin(sets.media, href);
    } else if (tag === 'img' || tag === 'image') {
      addHttpsOrigin(sets.img, attribute(attrs, 'src'));
      addSrcsetOrigins(sets.img, attribute(attrs, 'srcset'));
    } else if (tag === 'video' || tag === 'audio') {
      addHttpsOrigin(sets.media, attribute(attrs, 'src'));
      addHttpsOrigin(sets.img, attribute(attrs, 'poster'));
    } else if (tag === 'source') {
      addHttpsOrigin(sets.media, attribute(attrs, 'src'));
      addSrcsetOrigins(sets.img, attribute(attrs, 'srcset'));
    }
  }

  const importedStyles = new Set<string>();
  for (const match of html.matchAll(
    /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^'"\s;)]+))\s*\)?/gi,
  )) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw) continue;
    importedStyles.add(raw);
    addHttpsOrigin(sets.style, raw);
  }
  for (const match of html.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'" ]+))\s*\)/gi)) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw || importedStyles.has(raw)) continue;
    addHttpsOrigin(isFontResource(raw) ? sets.font : sets.img, raw);
  }

  return {
    script: Array.from(sets.script),
    style: Array.from(sets.style),
    img: Array.from(sets.img),
    font: Array.from(sets.font),
    media: Array.from(sets.media),
  };
}

function isSensitivePath(segments: readonly string[]): boolean {
  return segments.some((segment) => {
    const lower = segment.toLowerCase();
    return (
      lower.startsWith('.') ||
      lower === 'private.pem' ||
      lower === 'id_rsa' ||
      lower === 'id_ed25519' ||
      /\.(?:pem|key|p12|pfx|crt|cer)$/i.test(lower)
    );
  });
}

function isSupportedPreviewFile(filePath: string): boolean {
  return PREVIEW_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isProjectWebPreviewUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'app:' &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      url.host.startsWith(PREVIEW_HOST_PREFIX) &&
      TOKEN_PATTERN.test(url.host.slice(PREVIEW_HOST_PREFIX.length))
    );
  } catch {
    return false;
  }
}

export function mimeTypeForProjectWebPreview(filePath: string): string {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function projectWebPreviewCsp(
  networkAccess: boolean,
  authoredSources?: ProjectWebPreviewSources,
): string {
  const remote = (sources: readonly string[]): string =>
    Array.from(new Set(networkAccess ? ['https:'] : sources)).join(' ');
  const scriptRemote = remote(authoredSources?.script ?? []);
  const styleRemote = remote(authoredSources?.style ?? []);
  const imgRemote = remote(authoredSources?.img ?? []);
  const fontRemote = remote(authoredSources?.font ?? []);
  const mediaRemote = remote(authoredSources?.media ?? []);
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:${scriptRemote ? ` ${scriptRemote}` : ''}`,
    `worker-src 'self' blob:${networkAccess ? ' https:' : ''}`,
    `style-src 'self' 'unsafe-inline'${styleRemote ? ` ${styleRemote}` : ''}`,
    `img-src 'self' data: blob:${imgRemote ? ` ${imgRemote}` : ''}`,
    `font-src 'self' data:${fontRemote ? ` ${fontRemote}` : ''}`,
    `media-src 'self' data: blob:${mediaRemote ? ` ${mediaRemote}` : ''}`,
    `connect-src 'self'${networkAccess ? ' https: wss:' : ''}`,
    "frame-src 'none'",
    "child-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function projectWebPreviewResponseHeaders(
  filePath: string,
  networkAccess: boolean,
  authoredSources?: ProjectWebPreviewSources,
): Readonly<Record<string, string>> {
  return {
    'content-type': mimeTypeForProjectWebPreview(filePath),
    'content-security-policy': projectWebPreviewCsp(networkAccess, authoredSources),
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  };
}

export const PROJECT_WEB_PREVIEW_RUNTIME = `(() => {
  const type = ${JSON.stringify(WEB_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE)};
  const clean = (value) => String(value ?? '').replace(/[\\r\\n]+/g, ' ').slice(0, 240);
  const send = (kind, message, directive) => {
    try { parent.postMessage({ type, kind, message: clean(message), directive: clean(directive) }, '*'); } catch {}
  };
  const guardedInteractions = [
    'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend',
    'click', 'dblclick', 'contextmenu', 'keydown', 'keyup', 'beforeinput',
    'input', 'change', 'submit', 'wheel'
  ];
  const blockInteraction = (event) => {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const eventName of guardedInteractions) {
    addEventListener(eventName, blockInteraction, { capture: true, passive: false });
  }
  addEventListener('error', (event) => {
    const target = event.target;
    if (target && target !== window) {
      const tag = clean(target.tagName || 'resource').toLowerCase();
      const raw = target.src || target.href || '';
      let name = '';
      try { name = new URL(raw, location.href).pathname.split('/').pop() || ''; } catch {}
      send('resource', name ? tag + ': ' + name : tag);
      return;
    }
    send('runtime', event.message || 'Script error');
  }, true);
  addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    send('runtime', reason && reason.message ? reason.message : reason || 'Unhandled promise rejection');
  });
  addEventListener('securitypolicyviolation', (event) => {
    send('policy', '', event.effectiveDirective || event.violatedDirective || 'content-security-policy');
  });
  const ready = () => {
    for (const eventName of guardedInteractions) {
      removeEventListener(eventName, blockInteraction, { capture: true });
    }
    send('ready', '');
  };
  const scheduleReady = () =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ready, 0)));
  if (document.readyState === 'loading') {
    addEventListener('DOMContentLoaded', scheduleReady, { once: true });
  } else {
    scheduleReady();
  }
})();`;

export function injectProjectWebPreviewRuntime(html: string): string {
  if (html.includes(PROJECT_WEB_PREVIEW_RUNTIME_PATH)) return html;
  const tag = `<script src="${PROJECT_WEB_PREVIEW_RUNTIME_PATH}" data-kodax-preview-runtime></script>`;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head?.index !== undefined) {
    const offset = head.index + head[0].length;
    return `${html.slice(0, offset)}${tag}${html.slice(offset)}`;
  }
  const body = /<body(?:\s[^>]*)?>/i.exec(html);
  if (body?.index !== undefined)
    return `${html.slice(0, body.index)}${tag}${html.slice(body.index)}`;
  return `${tag}${html}`;
}

export class ProjectWebPreviewRegistry {
  readonly #now: () => number;
  readonly #tokenFactory: () => string;
  readonly #idleTtlMs: number;
  readonly #maxEntries: number;
  readonly #byToken = new Map<string, Capability>();
  readonly #byCacheKey = new Map<string, string>();

  constructor(options: RegistryOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#tokenFactory = options.tokenFactory ?? defaultTokenFactory;
    this.#idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (this.#idleTtlMs <= 0 || this.#maxEntries <= 0) {
      throw new Error('project preview registry limits must be positive');
    }
  }

  #remove(token: string): void {
    const capability = this.#byToken.get(token);
    if (!capability) return;
    this.#byToken.delete(token);
    if (this.#byCacheKey.get(capability.cacheKey) === token) {
      this.#byCacheKey.delete(capability.cacheKey);
    }
  }

  #pruneExpired(now: number): void {
    for (const capability of this.#byToken.values()) {
      if (now - capability.lastAccessedAt > this.#idleTtlMs) this.#remove(capability.token);
    }
  }

  #evictForInsert(): void {
    while (this.#byToken.size >= this.#maxEntries) {
      let oldest: Capability | undefined;
      for (const capability of this.#byToken.values()) {
        if (!oldest || capability.lastAccessedAt < oldest.lastAccessedAt) oldest = capability;
      }
      if (!oldest) break;
      this.#remove(oldest.token);
    }
  }

  #newToken(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const token = this.#tokenFactory().toLowerCase();
      if (!TOKEN_PATTERN.test(token)) throw new Error('invalid project preview capability token');
      if (!this.#byToken.has(token)) return token;
    }
    throw new Error('unable to allocate project preview capability token');
  }

  async create(input: ProjectWebPreviewCreateInput): Promise<ProjectWebPreviewCreated> {
    const canonicalProjectRoot = await realpath(path.resolve(input.projectRoot));
    const candidate = path.resolve(canonicalProjectRoot, input.entryPath);
    if (!staysInside(canonicalProjectRoot, candidate)) {
      throw new Error('project preview entry escapes project root');
    }
    const canonicalEntry = await realpath(candidate);
    if (!staysInside(canonicalProjectRoot, canonicalEntry)) {
      throw new Error('project preview entry escapes project root via symlink');
    }
    const entryStat = await stat(canonicalEntry);
    if (!entryStat.isFile() || !/\.html?$/i.test(canonicalEntry)) {
      throw new Error('project web preview requires an HTML file');
    }

    const scopeRoot = path.dirname(canonicalEntry);
    const now = this.#now();
    this.#pruneExpired(now);
    const cacheKey = `${scopeRoot}\u0000${input.networkAccess ? 'network' : 'local'}`;
    let token = this.#byCacheKey.get(cacheKey);
    let capability = token ? this.#byToken.get(token) : undefined;
    if (!capability) {
      this.#evictForInsert();
      token = this.#newToken();
      capability = {
        token,
        scopeRoot,
        cacheKey,
        networkAccess: input.networkAccess,
        lastAccessedAt: now,
      };
      this.#byToken.set(token, capability);
      this.#byCacheKey.set(cacheKey, token);
    } else {
      capability.lastAccessedAt = now;
    }

    return {
      url: `app://${PREVIEW_HOST_PREFIX}${capability.token}/${encodePathSegment(path.basename(canonicalEntry))}`,
      networkAccess: capability.networkAccess,
    };
  }

  async resolve(rawUrl: string, method: string): Promise<ProjectWebPreviewResolution> {
    if (method !== 'GET' && method !== 'HEAD') return failure(405, 'invalid-method');
    const match = /^app:\/\/([^/?#]+)([^?#]*)(?:\?[^#]*)?(?:#.*)?$/.exec(rawUrl);
    if (!match) return failure(400, 'invalid-url');
    const [, authority, encodedPath = ''] = match;
    if (
      !authority.startsWith(PREVIEW_HOST_PREFIX) ||
      !TOKEN_PATTERN.test(authority.slice(PREVIEW_HOST_PREFIX.length))
    ) {
      return failure(404, 'unknown-capability');
    }
    if (/%(?:2e|2f|5c)/i.test(encodedPath)) return failure(400, 'non-canonical-path');

    const token = authority.slice(PREVIEW_HOST_PREFIX.length);
    const capability = this.#byToken.get(token);
    if (!capability) return failure(404, 'unknown-capability');
    const now = this.#now();
    if (now - capability.lastAccessedAt > this.#idleTtlMs) {
      this.#remove(token);
      return failure(404, 'expired-capability');
    }
    capability.lastAccessedAt = now;

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
    if (decodedPath === PROJECT_WEB_PREVIEW_RUNTIME_PATH) {
      return { ok: true, kind: 'runtime', networkAccess: capability.networkAccess };
    }

    const segments = decodedPath.slice(1).split('/');
    if (
      segments.length === 0 ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      path.posix.normalize(decodedPath) !== decodedPath
    ) {
      return failure(400, 'non-canonical-path');
    }
    if (isSensitivePath(segments)) return failure(403, 'sensitive-file');

    const candidate = path.resolve(capability.scopeRoot, ...segments);
    if (!staysInside(capability.scopeRoot, candidate)) return failure(403, 'scope-escape');
    if (!isSupportedPreviewFile(candidate)) return failure(403, 'unsupported-file');

    try {
      const [canonicalCandidate, candidateStat] = await Promise.all([
        realpath(candidate),
        stat(candidate),
      ]);
      if (!staysInside(capability.scopeRoot, canonicalCandidate)) {
        return failure(403, 'scope-escape');
      }
      if (!candidateStat.isFile()) return failure(403, 'not-file');
      if (candidateStat.size > MAX_PROJECT_WEB_PREVIEW_FILE_BYTES) {
        return failure(413, 'too-large');
      }
      return {
        ok: true,
        kind: 'file',
        filePath: canonicalCandidate,
        networkAccess: capability.networkAccess,
      };
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ENOENT' || code === 'ENOTDIR') return failure(404, 'not-found');
      if (code === 'EACCES' || code === 'EPERM') return failure(403, 'not-file');
      return failure(500, 'io-failure');
    }
  }
}

export const projectWebPreviewRegistry = new ProjectWebPreviewRegistry();
