/** Return the UTF-8 byte length without allocating an encoded copy of the string. */
export function utf8ByteLength(value: string, stopAfter = Number.POSITIVE_INFINITY): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
    if (bytes > stopAfter) return bytes;
  }
  return bytes;
}

export function isUtf8WithinLimit(value: string, maxBytes: number): boolean {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return false;
  // Every UTF-16 code unit encodes to at least one UTF-8 byte. This avoids a
  // full scan for obviously oversized ASCII-heavy output.
  if (value.length > maxBytes) return false;
  return utf8ByteLength(value, maxBytes) <= maxBytes;
}
