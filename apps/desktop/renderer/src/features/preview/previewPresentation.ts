export type TextFilePresentation = 'source' | 'markdown';

/** Artifact is a reading surface: file-backed Markdown should render, not look editable. */
export function textFilePresentation(path: string): TextFilePresentation {
  return /\.(?:md|markdown)$/i.test(path.trim()) ? 'markdown' : 'source';
}
