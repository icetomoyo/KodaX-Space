// ArtifactContent — the discriminated union ArtifactView dispatches on (F056/F059).
// Kept in a JSX-free module so non-React code (toArtifactContent, node:test) can
// import the type without pulling ArtifactView.tsx (React/recharts) into scope.

import type { ArtifactHtmlPermissionsT } from '@kodax-space/space-ipc-schema';

export type ArtifactContent =
  | { kind: 'markdown'; content: string }
  | { kind: 'code'; content: string; filename?: string }
  | { kind: 'html'; content: string }
  | { kind: 'interactive-html'; content: string; permissions?: ArtifactHtmlPermissionsT }
  | { kind: 'svg'; content: string }
  | { kind: 'image'; src: string; alt?: string }
  | { kind: 'chart'; spec: unknown }
  | { kind: 'pdf' | 'docx' | 'xlsx'; projectRoot: string; path: string }
  | { kind: 'file'; projectRoot: string; path: string }
  // Interactive tier removed (LiveCanvas sandbox extracted to a future feature).
  // Kept as an inert variant so ArtifactView's exhaustive switch still covers it
  // (renders an "unavailable" placeholder); nothing constructs it anymore.
  | { kind: 'react' };
