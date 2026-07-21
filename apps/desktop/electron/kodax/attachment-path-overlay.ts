export interface AttachmentPathForOverlay {
  readonly kind: 'file' | 'directory';
  readonly path: string;
}

/**
 * Build model-only context for non-image attachments. The visible/persisted
 * user prompt keeps its renderer file link; filesystem tools receive the exact
 * native path through this overlay instead.
 */
export function buildAttachmentPathOverlay(
  paths: readonly AttachmentPathForOverlay[] | undefined,
): string | undefined {
  if (!paths || paths.length === 0) return undefined;

  return [
    'Attached local paths are exact absolute paths from the operating system.',
    'JSON-decode each `path` value before passing it to filesystem tools.',
    '<attached_paths>',
    JSON.stringify(paths, null, 2),
    '</attached_paths>',
  ].join('\n');
}
