// Artifact kind taxonomy (F056).
//
//   - STATIC tier (LC-free, the only shipping tier): rendered entirely with Space's
//     own/already-shipping capability (react-markdown, Monaco, F024 RichPreview)
//     plus the Html + Chart renderers. NO @livecanvas/* dependency.
//   - INTERACTIVE REACT tier ('react'): the LiveCanvas sandbox runtime was removed
//     (it broke dev/build on any machine without LC linked). The 'react' kind is
//     retained only as an inert taxonomy entry; its sandbox machinery is being
//     re-integrated as a separate feature once LiveCanvas stabilizes.

export type ArtifactKind =
  | 'markdown'
  | 'code'
  | 'html'
  | 'interactive-html'
  | 'svg'
  | 'image'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'file'
  | 'chart'
  | 'react';

/** Kinds renderable without LiveCanvas — the shippable baseline. */
export const STATIC_ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'markdown',
  'code',
  'html',
  'interactive-html',
  'svg',
  'image',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'file',
  'chart',
];

/** Whether a kind is in the static (LC-free) baseline. */
export function isStaticArtifactKind(kind: ArtifactKind): boolean {
  return STATIC_ARTIFACT_KINDS.includes(kind);
}

/** Kinds whose inline content is meaningful to copy as text (shared by the
 * embedded ArtifactViewer + the standalone ArtifactWindow so they can't drift). */
export const TEXT_COPY_KINDS: ReadonlySet<string> = new Set([
  'markdown',
  'code',
  'html',
  'interactive-html',
  'svg',
  'chart',
]);
