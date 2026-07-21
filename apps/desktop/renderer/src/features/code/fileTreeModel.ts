import type { FileNodeT } from '@kodax-space/space-ipc-schema';

export interface FileTreeLabelParts {
  readonly leading: string;
  readonly trailing: string;
}

/**
 * Keep the final file extension visible while allowing the descriptive basename
 * to consume the remaining row width. Directories and extensionless files use
 * the conventional leading-name truncation.
 */
export function splitFileTreeLabel(name: string, kind: FileNodeT['kind']): FileTreeLabelParts {
  if (kind === 'dir') return { leading: name, trailing: '' };
  const finalDot = name.lastIndexOf('.');
  if (finalDot <= 0 || finalDot === name.length - 1) {
    return { leading: name, trailing: '' };
  }
  return {
    leading: name.slice(0, finalDot),
    trailing: name.slice(finalDot),
  };
}

/** Root is represented by null; expanded directories retain insertion order. */
export function fileTreeRefreshPaths(expandedPaths: Iterable<string>): readonly (string | null)[] {
  return [null, ...new Set(expandedPaths)];
}
