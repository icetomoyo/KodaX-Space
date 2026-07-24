import type { WindowActivityPayload } from '@kodax-space/space-ipc-schema';
import type { VisualQuality } from '../lib/visualQuality.js';

export function isLocalDocumentActive(
  doc: Pick<Document, 'visibilityState' | 'hasFocus'>,
): boolean {
  return doc.visibilityState === 'visible' && doc.hasFocus();
}

export function shouldPauseAurora(
  quality: VisualQuality,
  activity: WindowActivityPayload | null,
  localActive: boolean,
  interactionActive = false,
): boolean {
  if (quality !== 'full') return false;
  if (interactionActive) return true;
  if (!localActive) return true;
  return activity !== null && activity.state !== 'active';
}
