const PROJECT_FILE_PREVIEW_SESSION_PREFIX = '__project_file_preview__';

export function projectFilePreviewSessionId(projectRoot: string | null | undefined): string | null {
  if (!projectRoot) return null;
  const normalized = projectRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (!normalized) return null;

  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${PROJECT_FILE_PREVIEW_SESSION_PREFIX}_${hash.toString(36)}`;
}

export function artifactSessionForProjectFiles(
  currentSessionId: string | null | undefined,
  projectRoot: string | null | undefined,
): string | null {
  return currentSessionId ?? projectFilePreviewSessionId(projectRoot);
}
