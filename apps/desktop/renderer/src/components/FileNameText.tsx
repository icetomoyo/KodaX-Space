import type { JSX } from 'react';
import { splitFileName } from '../lib/fileName.js';

interface FileNameTextProps {
  readonly name: string;
  readonly className?: string;
  readonly title?: string;
}

/** Truncate the descriptive part of a file name while keeping its final extension visible. */
export function FileNameText({
  name,
  className = '',
  title = name,
}: FileNameTextProps): JSX.Element {
  const label = splitFileName(name);
  return (
    <span className={`flex min-w-0 items-baseline overflow-hidden ${className}`} title={title}>
      <span className="min-w-0 flex-1 truncate">{label.leading}</span>
      {label.trailing && <span className="flex-shrink-0">{label.trailing}</span>}
    </span>
  );
}
