/**
 * Resolve a Markdown-authored relative URL against a project-relative document.
 * The main process still performs the authoritative realpath/symlink scope check.
 */
export function resolveMarkdownWorkspacePath(documentPath: string, rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  const normalizedAuthoredUrl = trimmed.replace(/\\/g, '/');
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    normalizedAuthoredUrl.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(trimmed)
  ) {
    return null;
  }

  const withoutFragment = trimmed.split('#', 1)[0]?.split('?', 1)[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutFragment).replace(/\\/g, '/');
  } catch {
    return null;
  }
  if (!decoded || decoded.includes('\0') || decoded.startsWith('//')) return null;

  const normalizedDocumentPath = documentPath.replace(/\\/g, '/');
  if (normalizedDocumentPath.startsWith('//') || /^[a-z]:\//i.test(normalizedDocumentPath)) {
    return null;
  }
  const base = normalizedDocumentPath.split('/');
  base.pop();
  const parts: string[] = [];
  if (!applyPathSegments(parts, base)) return null;
  if (decoded.startsWith('/')) parts.length = 0;
  if (!applyPathSegments(parts, decoded.replace(/^\/+/, '').split('/'))) return null;
  return parts.length > 0 ? parts.join('/') : null;
}

function applyPathSegments(parts: string[], segments: readonly string[]): boolean {
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return false;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return true;
}
