export type InlineImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp';

const INLINE_IMAGE_MIME_TYPES: Readonly<Record<string, InlineImageMediaType>> = {
  'image/png': 'image/png',
  'image/x-png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/webp': 'image/webp',
};

const INLINE_IMAGE_EXTENSION_TYPES: Readonly<Record<string, InlineImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Resolve the image type accepted by the KodaX input-artifact contract. */
export function inlineImageMediaType(
  file: Pick<File, 'name' | 'type'>,
): InlineImageMediaType | null {
  const mime = file.type.trim().toLowerCase().split(';', 1)[0] ?? '';
  const byMime = INLINE_IMAGE_MIME_TYPES[mime];
  if (byMime) return byMime;
  if (mime && mime !== 'application/octet-stream' && mime !== 'binary/octet-stream') return null;

  const dot = file.name.lastIndexOf('.');
  if (dot < 0) return null;
  return INLINE_IMAGE_EXTENSION_TYPES[file.name.slice(dot).toLowerCase()] ?? null;
}

export function isSupportedInlineImage(file: Pick<File, 'name' | 'type'>): boolean {
  return inlineImageMediaType(file) !== null;
}

export interface PendingAttachmentGate {
  begin(): () => void;
  isPending(): boolean;
}

/**
 * Tracks asynchronous attachment preparation without relying on a React render
 * to make the pending state observable to keyboard handlers.
 */
export function createPendingAttachmentGate(
  onPendingChange: (pending: boolean) => void,
): PendingAttachmentGate {
  let pendingCount = 0;

  return {
    begin(): () => void {
      pendingCount += 1;
      if (pendingCount === 1) onPendingChange(true);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        pendingCount = Math.max(0, pendingCount - 1);
        if (pendingCount === 0) onPendingChange(false);
      };
    },
    isPending(): boolean {
      return pendingCount > 0;
    },
  };
}
