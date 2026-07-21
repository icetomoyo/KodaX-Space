import { WEB_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE } from '@kodax-space/space-ipc-schema';

export type WebPreviewDiagnosticKind = 'ready' | 'resource' | 'runtime' | 'policy';

export interface WebPreviewDiagnostic {
  readonly kind: WebPreviewDiagnosticKind;
  readonly message: string;
  readonly directive: string;
}

const DIAGNOSTIC_KINDS = new Set<WebPreviewDiagnosticKind>([
  'ready',
  'resource',
  'runtime',
  'policy',
]);

function boundedText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').slice(0, 240) : '';
}

export function parseWebPreviewDiagnostic(value: unknown): WebPreviewDiagnostic | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== WEB_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE) return null;
  if (typeof candidate.kind !== 'string') return null;
  if (!DIAGNOSTIC_KINDS.has(candidate.kind as WebPreviewDiagnosticKind)) return null;
  return {
    kind: candidate.kind as WebPreviewDiagnosticKind,
    message: boundedText(candidate.message),
    directive: boundedText(candidate.directive),
  };
}

export function webPreviewDiagnosticKey(diagnostic: WebPreviewDiagnostic): string {
  return `${diagnostic.kind}\u0000${diagnostic.directive}\u0000${diagnostic.message}`;
}
