type Platform = string;

export interface ParsedFileReference {
  readonly kind: 'file';
  readonly raw: string;
  readonly label: string;
  readonly href: string;
  readonly path: string;
  readonly detail: string;
}

export type FileReferencePart =
  { readonly kind: 'text'; readonly text: string } | ParsedFileReference;

export interface AbsoluteAttachmentPath {
  readonly kind: 'file' | 'directory';
  readonly path: string;
}

const MARKDOWN_FILE_LINK_RE = /\[((?:\\.|[^\]\\]){1,500})\]\s*\(<(file:\/\/[^>]+)>\)/gi;

function unescapeMarkdownLabel(value: string): string {
  return value.replace(/\\([\\[\]])/g, '$1');
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function basenameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/g, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || normalized;
}

export function fileUrlToPath(href: string, platform: Platform): string | null {
  if (!/^file:\/\//i.test(href)) return null;
  try {
    const url = new URL(href);
    const host =
      url.hostname && url.hostname.toLowerCase() !== 'localhost'
        ? decodeUrlComponent(url.hostname)
        : '';
    const pathname = decodeUrlComponent(url.pathname);

    if (platform === 'win32') {
      if (host) return `\\\\${host}${pathname.replace(/\//g, '\\')}`;
      return pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\');
    }

    return host ? `//${host}${pathname}` : pathname;
  } catch {
    return null;
  }
}

export function compactPathForDisplay(filePath: string, maxChars = 72): string {
  if (filePath.length <= maxChars) return filePath;
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const tail = parts.slice(-2).join('/');
  const prefix = normalized.startsWith('/') ? '/' : parts[0]?.endsWith(':') ? `${parts[0]}/` : '';
  const compact = tail ? `${prefix}.../${tail}` : `...${filePath.slice(-(maxChars - 3))}`;
  if (compact.length <= maxChars) return compact;
  return `...${filePath.slice(-(maxChars - 3))}`;
}

export function parseFileReferences(
  content: string,
  platform: Platform = 'win32',
): FileReferencePart[] {
  const parts: FileReferencePart[] = [];
  let lastIndex = 0;
  MARKDOWN_FILE_LINK_RE.lastIndex = 0;

  for (const match of content.matchAll(MARKDOWN_FILE_LINK_RE)) {
    const raw = match[0];
    const labelMatch = match[1];
    const href = match[2];
    const index = match.index ?? 0;
    if (!labelMatch || !href) continue;

    if (index > lastIndex) {
      parts.push({ kind: 'text', text: content.slice(lastIndex, index) });
    }

    const path = fileUrlToPath(href, platform);
    if (path === null || path.length === 0) {
      parts.push({ kind: 'text', text: raw });
    } else {
      const label = unescapeMarkdownLabel(labelMatch) || basenameFromPath(path);
      parts.push({
        kind: 'file',
        raw,
        label,
        href,
        path,
        detail: compactPathForDisplay(path),
      });
    }
    lastIndex = index + raw.length;
  }

  if (lastIndex < content.length) {
    parts.push({ kind: 'text', text: content.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ kind: 'text', text: content }];
}

/**
 * Collect the native paths that must accompany a renderer-friendly prompt.
 *
 * Attachment chips need a `file://` Markdown link, but that URL is not a local
 * filesystem path. In particular, a Windows drive URL starts with
 * `file:///C:/...`, while filesystem tools need the native `C:\\...` path.
 * Electron already gives us the exact OS path for a dropped File, so pass that
 * value separately instead of asking the model to decode the display URL.
 */
export function collectAbsoluteAttachmentPaths(
  displayPrompt: string,
  attachedPaths: readonly AbsoluteAttachmentPath[],
  platform: Platform = 'win32',
): readonly AbsoluteAttachmentPath[] {
  const paths: AbsoluteAttachmentPath[] = [];
  const seen = new Set<string>();

  const addPath = (kind: 'file' | 'directory', filePath: string): void => {
    const normalized = filePath.replace(/\\/g, '/');
    const key = platform === 'win32' ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) return;
    seen.add(key);
    paths.push({ kind, path: filePath });
  };

  for (const attached of attachedPaths) {
    addPath(attached.kind, attached.path);
  }

  // Input history can restore a rendered file link after its PendingFileRef is
  // gone. Recover those links too so retries retain the native path overlay.
  for (const part of parseFileReferences(displayPrompt, platform)) {
    if (part.kind === 'file') addPath('file', part.path);
  }

  return paths;
}
