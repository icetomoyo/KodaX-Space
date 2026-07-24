// Map a stored artifact (ArtifactRef + read result) → ArtifactView's ArtifactContent
// (F059). Pure + testable. Returns null when the version can't be rendered
// (missing content / unsupported kind), so the panel shows a graceful fallback.

import {
  looksLikeInteractiveHtml,
  type ArtifactHtmlPermissionsT,
  type ArtifactKindT,
} from '@kodax-space/space-ipc-schema';
import type { ArtifactContent } from './artifactContent';

export interface ArtifactVersionPayload {
  content?: string;
  path?: string;
  fileSource?: 'workspace' | 'artifact-store' | 'delivery-store';
  deliveryId?: string;
  contentHash?: string;
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
  artifactIdentity?: { id: string; version: number },
): ArtifactContent | null {
  switch (kind) {
    case 'markdown':
      return payload.content !== undefined
        ? {
            kind: 'markdown',
            content: payload.content,
            ...(payload.path !== undefined &&
            projectRoot !== null &&
            (payload.fileSource === undefined || payload.fileSource === 'workspace')
              ? { resourceContext: { projectRoot, path: payload.path } }
              : {}),
          }
        : null;
    case 'code':
      return payload.content !== undefined
        ? {
            kind: 'code',
            content: payload.content,
            ...(payload.path !== undefined ? { filename: payload.path } : {}),
          }
        : null;
    case 'html':
      return payload.content !== undefined
        ? {
            kind:
              permissions !== undefined || looksLikeInteractiveHtml(payload.content)
                ? 'interactive-html'
                : 'html',
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
    case 'pptx':
      return payload.path !== undefined &&
        (payload.fileSource === 'artifact-store' || projectRoot !== null)
        ? {
            kind,
            ...(projectRoot !== null ? { projectRoot } : {}),
            path: payload.path,
            ...(payload.fileSource !== undefined ? { fileSource: payload.fileSource } : {}),
            ...(artifactIdentity !== undefined
              ? { artifactId: artifactIdentity.id, version: artifactIdentity.version }
              : {}),
            ...(payload.deliveryId !== undefined ? { deliveryId: payload.deliveryId } : {}),
          }
        : null;
    case 'file':
      return payload.path !== undefined &&
        (projectRoot !== null || payload.fileSource === 'delivery-store')
        ? {
            kind,
            ...(projectRoot !== null ? { projectRoot } : {}),
            path: payload.path,
            ...(payload.fileSource !== undefined ? { fileSource: payload.fileSource } : {}),
            ...(artifactIdentity !== undefined
              ? { artifactId: artifactIdentity.id, version: artifactIdentity.version }
              : {}),
            ...(payload.deliveryId !== undefined ? { deliveryId: payload.deliveryId } : {}),
          }
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
