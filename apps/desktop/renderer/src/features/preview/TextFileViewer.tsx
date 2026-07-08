import { useMemo } from 'react';
import { MonacoViewer } from '../code/MonacoViewer.js';
import { base64ToBytes } from './binaryUtils.js';

interface TextFileViewerProps {
  readonly base64: string;
  readonly path: string;
}

const MONACO_TEXT_LIMIT = 1_000_000;

function decodeUtf8(base64: string): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(base64ToBytes(base64));
}

export function TextFileViewer({ base64, path }: TextFileViewerProps): JSX.Element {
  const content = useMemo(() => decodeUtf8(base64), [base64]);

  if (content.length <= MONACO_TEXT_LIMIT) {
    return (
      <div className="h-full min-h-0" data-testid="text-file-viewer">
        <MonacoViewer path={path} content={content} />
      </div>
    );
  }

  return (
    <textarea
      data-testid="text-file-viewer"
      key={`${path}:${base64.length}`}
      aria-label={path}
      readOnly
      spellCheck={false}
      wrap="off"
      defaultValue={content}
      className="h-full w-full resize-none overflow-auto border-0 bg-surface p-3 font-mono text-[12px] leading-relaxed text-fg-primary outline-none selection:bg-accent/25"
    />
  );
}
