// Map a stored artifact (ArtifactRef + read result) → ArtifactView's ArtifactContent
// (F059). Pure + testable. Returns null when the version can't be rendered
// (missing content / unsupported kind), so the panel shows a graceful fallback.

import type { ArtifactHtmlPermissionsT, ArtifactKindT } from '@kodax-space/space-ipc-schema';
import type { ArtifactContent } from './artifactContent';

export interface ArtifactVersionPayload {
  content?: string;
  path?: string;
}

/**
 * @param kind        artifact kind
 * @param payload     the resolved version (content for content kinds, path for doc kinds)
 * @param projectRoot the session's project root (needed by RichPreview for doc kinds)
 */
export function toArtifactContent(
  kind: ArtifactKindT,
  payload: ArtifactVersionPayload,
  projectRoot: string | null,
  permissions?: ArtifactHtmlPermissionsT,
): ArtifactContent | null {
  switch (kind) {
    case 'markdown':
      return payload.content !== undefined ? { kind: 'markdown', content: payload.content } : null;
    case 'code':
      return payload.content !== undefined ? { kind: 'code', content: payload.content } : null;
    case 'html':
      return payload.content !== undefined
        ? {
            kind: permissions !== undefined ? 'interactive-html' : 'html',
            content: payload.content,
            ...(permissions !== undefined ? { permissions } : {}),
          }
        : null;
    case 'interactive-html':
      return payload.content !== undefined
        ? {
            kind: 'interactive-html',
            content: payload.content,
            ...(permissions !== undefined ? { permissions } : {}),
          }
        : null;
    case 'svg':
      return payload.content !== undefined ? { kind: 'svg', content: payload.content } : null;
    case 'image':
      return payload.content !== undefined ? { kind: 'image', src: payload.content } : null;
    case 'chart': {
      if (payload.content === undefined) return null;
      // Stored as a JSON string; hand the parsed value to ChartArtifact (parseChartSpec
      // re-validates). On parse failure pass the raw string — the chart renderer's
      // validation rejects it into its own fallback rather than throwing here.
      let spec: unknown = payload.content;
      try {
        spec = JSON.parse(payload.content);
      } catch {
        /* leave raw; ChartArtifact will show its invalid-spec fallback */
      }
      return { kind: 'chart', spec };
    }
    case 'pdf':
    case 'docx':
    case 'xlsx':
    case 'file':
      return payload.path !== undefined && projectRoot
        ? { kind, projectRoot, path: payload.path }
        : null;
    case 'react':
      // Interactive tier is not rendered from the static store (gated; not
      // produced by F058). The panel shows an unsupported fallback.
      return null;
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return null;
    }
  }
}
