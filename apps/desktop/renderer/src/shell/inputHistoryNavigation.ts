export type InputHistoryDirection = 'up' | 'down';

export function isAtInputHistoryBoundary(
  direction: InputHistoryDirection,
  value: string,
  selectionStart: number,
  selectionEnd: number,
): boolean {
  if (selectionStart !== selectionEnd) return false;
  return direction === 'up' ? selectionStart === 0 : selectionEnd === value.length;
}

export function inputHistoryTargetIndex(
  direction: InputHistoryDirection,
  historyIndex: number,
  historyLength: number,
): number | null {
  if (historyLength <= 0) return null;

  if (direction === 'up') {
    if (historyIndex === -1) return historyLength - 1;
    return historyIndex > 0 ? historyIndex - 1 : null;
  }

  if (historyIndex === -1) return null;
  if (historyIndex >= historyLength - 1) return -1;
  return historyIndex + 1;
}
