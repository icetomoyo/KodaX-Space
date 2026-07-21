export interface FileNameParts {
  readonly leading: string;
  readonly trailing: string;
}

/** Split at the final dot so the file-type suffix can remain visible during truncation. */
export function splitFileName(name: string): FileNameParts {
  const finalSeparator = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const finalDot = name.lastIndexOf('.');
  if (finalDot <= finalSeparator + 1 || finalDot === name.length - 1) {
    return { leading: name, trailing: '' };
  }
  return {
    leading: name.slice(0, finalDot),
    trailing: name.slice(finalDot),
  };
}
