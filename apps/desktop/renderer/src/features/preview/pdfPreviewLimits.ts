export const PDF_MAX_PAGE_COUNT = 2_000;

export function isPdfPageCountSupported(pageCount: number): boolean {
  return Number.isSafeInteger(pageCount) && pageCount >= 1 && pageCount <= PDF_MAX_PAGE_COUNT;
}
