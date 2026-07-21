import { useEffect, useMemo, useState } from 'react';
import { base64ToBytes, mimeForPath, type RichPreviewKind } from './binaryUtils.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import { FileNameText } from '../../components/FileNameText.js';

interface MediaFileViewerProps {
  readonly base64: string;
  readonly path: string;
  readonly kind: Extract<RichPreviewKind, 'image' | 'video' | 'audio'>;
}

interface GifStats {
  readonly width: number;
  readonly height: number;
  readonly frames: number;
}

const MAX_ANIMATED_GIF_DECODE_PIXELS = 180_000_000;

function basename(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | ((bytes[offset + 1] ?? 0) << 8);
}

function skipGifSubBlocks(bytes: Uint8Array, offset: number): number {
  let cursor = offset;
  while (cursor < bytes.length) {
    const size = bytes[cursor];
    cursor += 1;
    if (size === undefined || size === 0) return cursor;
    cursor += size;
  }
  return cursor;
}

function gifStats(bytes: Uint8Array, path: string): GifStats | null {
  if (!/\.gif$/i.test(path) || bytes.length < 13) return null;
  const isGif =
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61;
  if (!isGif) return null;

  const width = readU16(bytes, 6);
  const height = readU16(bytes, 8);
  const packed = bytes[10] ?? 0;
  let cursor = 13;
  if ((packed & 0x80) !== 0) {
    cursor += 3 * 2 ** ((packed & 0x07) + 1);
  }

  let frames = 0;
  while (cursor < bytes.length) {
    const marker = bytes[cursor];
    cursor += 1;
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      cursor += 1;
      cursor = skipGifSubBlocks(bytes, cursor);
      continue;
    }
    if (marker !== 0x2c || cursor + 9 > bytes.length) break;

    frames += 1;
    const imagePacked = bytes[cursor + 8] ?? 0;
    cursor += 9;
    if ((imagePacked & 0x80) !== 0) {
      cursor += 3 * 2 ** ((imagePacked & 0x07) + 1);
    }
    cursor += 1; // LZW minimum code size
    cursor = skipGifSubBlocks(bytes, cursor);
  }

  return { width, height, frames };
}

function isLargeAnimatedGif(stats: GifStats | null): boolean {
  if (stats === null || stats.frames <= 1) return false;
  return stats.width * stats.height * stats.frames > MAX_ANIMATED_GIF_DECODE_PIXELS;
}

function useBlobUrl(bytes: Uint8Array<ArrayBuffer> | null, mime: string): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (bytes === null) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([bytes], { type: mime }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, mime]);

  return url;
}

export function MediaFileViewer({ base64, path, kind }: MediaFileViewerProps): JSX.Element {
  const { t } = useI18n();
  const bytes = useMemo(() => base64ToBytes(base64), [base64]);
  const stats = kind === 'image' ? gifStats(bytes, path) : null;
  const suppressAnimatedGif = isLargeAnimatedGif(stats);
  const mime = mimeForPath(path, kind);
  const url = useBlobUrl(suppressAnimatedGif ? null : bytes, mime);
  const label = basename(path);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url, kind]);

  if (kind === 'image') {
    return (
      <div
        className="relative h-full min-h-0 overflow-auto bg-surface-2 p-3"
        data-testid="media-image-viewer"
      >
        {suppressAnimatedGif && stats !== null ? (
          <LargeAnimatedGifFallback label={label} stats={stats} />
        ) : url === null ? (
          <div className="p-3 text-xs text-fg-muted">{t('preview.loadingViewer')}</div>
        ) : (
          <div className="flex min-h-full items-center justify-center">
            <img
              src={url}
              alt={label}
              onError={() => setFailed(true)}
              className="block max-h-full max-w-full rounded-sm bg-white shadow-lg"
            />
          </div>
        )}
        {failed && <MediaError message={t('preview.mediaUnsupported')} />}
      </div>
    );
  }

  if (url === null) {
    return <div className="p-3 text-xs text-fg-muted">{t('preview.loadingViewer')}</div>;
  }

  if (kind === 'video') {
    return (
      <div
        className="relative flex h-full min-h-0 items-center justify-center bg-surface-2 p-3"
        data-testid="media-video-viewer"
      >
        <div className="flex h-full w-full max-w-6xl items-center justify-center">
          <video
            src={url}
            controls
            preload="metadata"
            onError={() => setFailed(true)}
            className="max-h-full max-w-full rounded bg-black shadow-lg"
          />
        </div>
        {failed && <MediaError message={t('preview.mediaUnsupported')} />}
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 items-center justify-center bg-surface-2 p-6"
      data-testid="media-audio-viewer"
    >
      <div className="w-full max-w-2xl rounded-md border border-border-default bg-surface p-4 shadow-sm">
        <FileNameText name={label} className="mb-3 text-sm font-medium text-fg-primary" />
        <audio
          src={url}
          controls
          preload="metadata"
          onError={() => setFailed(true)}
          className="w-full"
        />
        {failed && <div className="mt-3 text-xs text-danger">{t('preview.mediaUnsupported')}</div>}
      </div>
    </div>
  );
}

function LargeAnimatedGifFallback({
  label,
  stats,
}: {
  readonly label: string;
  readonly stats: GifStats;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div
      className="flex min-h-full items-center justify-center p-6"
      data-testid="media-large-gif-fallback"
    >
      <div className="max-w-md rounded-md border border-border-default bg-surface p-4 text-center shadow-sm">
        <FileNameText name={label} className="justify-center text-sm font-medium text-fg-primary" />
        <div className="mt-2 text-xs leading-relaxed text-fg-muted">
          {t('preview.largeAnimatedGif', {
            width: stats.width,
            height: stats.height,
            frames: stats.frames,
          })}
        </div>
      </div>
    </div>
  );
}

function MediaError({ message }: { readonly message: string }): JSX.Element {
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 max-w-[80%] -translate-x-1/2 rounded border border-border-default bg-surface px-3 py-1.5 text-xs text-danger shadow">
      {message}
    </div>
  );
}
