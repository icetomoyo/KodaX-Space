import type {
  ArtifactHtmlPermissionsT,
  ArtifactKindT,
  SessionEvent,
} from '@kodax-space/space-ipc-schema';
import {
  artifactHtmlPermissionsSchema,
  artifactKindSchema,
  looksLikeInteractiveHtml,
} from '@kodax-space/space-ipc-schema';

export const FOCUS_ARTIFACT_EVENT = 'kodax-space.focus-artifact';
export const OPEN_FILE_VIEWER_EVENT = 'kodax-space.open-file-viewer';

export interface TransientArtifactSnapshot {
  id: string;
  kind: ArtifactKindT;
  title: string;
  source?: 'artifact' | 'file-preview' | 'delivery-preview';
  version?: number;
  summary?: string;
  content?: string;
  path?: string;
  projectRoot?: string;
  fileSource?: 'workspace' | 'artifact-store' | 'delivery-store';
  deliveryId?: string;
  permissions?: ArtifactHtmlPermissionsT;
  versions?: readonly TransientArtifactVersionSnapshot[];
}

export interface TransientArtifactVersionSnapshot {
  v: number;
  summary?: string;
  content?: string;
  path?: string;
  fileSource?: 'workspace' | 'artifact-store' | 'delivery-store';
  deliveryId?: string;
}

export interface FocusArtifactEventDetail {
  id?: string;
  snapshot?: TransientArtifactSnapshot;
}

export interface OpenFileViewerEventDetail {
  snapshot: TransientArtifactSnapshot;
}

export function isFileViewerSnapshot(
  snapshot: TransientArtifactSnapshot | null | undefined,
): boolean {
  return snapshot?.source === 'file-preview' || snapshot?.source === 'delivery-preview';
}

interface CreateArtifactToolLike {
  status?: 'running' | 'done';
  input?: Record<string, unknown>;
  result?: string;
}

const ARTIFACT_RESULT_RE = /\(id=([^,]+), v(\d+)\)/;

function pickString(input: Record<string, unknown> | undefined, key: string): string | null {
  if (!input) return null;
  const value = input[key];
  return typeof value === 'string' ? value : null;
}

function parsePermissions(
  input: Record<string, unknown> | undefined,
): ArtifactHtmlPermissionsT | undefined {
  const parsed = artifactHtmlPermissionsSchema.safeParse(input?.permissions);
  return parsed.success ? parsed.data : undefined;
}

function normalizeKind(
  rawKind: string | null,
  content: string | undefined,
  permissions: ArtifactHtmlPermissionsT | undefined,
): ArtifactKindT | null {
  const parsedKind = artifactKindSchema.safeParse(rawKind);
  if (!parsedKind.success) return null;
  return parsedKind.data === 'html' &&
    content !== undefined &&
    (looksLikeInteractiveHtml(content) || permissions !== undefined)
    ? 'interactive-html'
    : parsedKind.data;
}

export function snapshotFromCreateArtifactTool(
  tool: CreateArtifactToolLike,
): TransientArtifactSnapshot | null {
  if (tool.status !== 'done') return null;
  const match = typeof tool.result === 'string' ? ARTIFACT_RESULT_RE.exec(tool.result) : null;
  if (!match) return null;

  const id = match[1]?.trim();
  const version = Number(match[2]);
  if (!id || !Number.isFinite(version)) return null;

  const content = pickString(tool.input, 'content') ?? undefined;
  const path = pickString(tool.input, 'path') ?? undefined;
  if (content === undefined && path === undefined) return null;

  const permissions = parsePermissions(tool.input);
  const kind = normalizeKind(pickString(tool.input, 'kind'), content, permissions);
  if (!kind) return null;

  const title = pickString(tool.input, 'title') ?? 'Artifact';
  const summary = pickString(tool.input, 'summary') ?? undefined;
  return {
    id,
    kind,
    title,
    source: 'artifact',
    version,
    ...(summary !== undefined ? { summary } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(permissions !== undefined ? { permissions } : {}),
    versions: [
      {
        v: version,
        ...(summary !== undefined ? { summary } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(path !== undefined ? { path } : {}),
      },
    ],
  };
}

function versionsFromSnapshot(
  snapshot: TransientArtifactSnapshot,
): readonly TransientArtifactVersionSnapshot[] {
  if (snapshot.versions && snapshot.versions.length > 0) return snapshot.versions;
  return [
    {
      v: snapshot.version ?? 1,
      ...(snapshot.summary !== undefined ? { summary: snapshot.summary } : {}),
      ...(snapshot.content !== undefined ? { content: snapshot.content } : {}),
      ...(snapshot.path !== undefined ? { path: snapshot.path } : {}),
      ...(snapshot.fileSource !== undefined ? { fileSource: snapshot.fileSource } : {}),
      ...(snapshot.deliveryId !== undefined ? { deliveryId: snapshot.deliveryId } : {}),
    },
  ];
}

export function mergeTransientArtifactSnapshots(
  existing: TransientArtifactSnapshot,
  snapshot: TransientArtifactSnapshot,
): TransientArtifactSnapshot {
  const versions = [...versionsFromSnapshot(existing), ...versionsFromSnapshot(snapshot)].sort(
    (a, b) => a.v - b.v,
  );
  const deduped = new Map<number, TransientArtifactVersionSnapshot>();
  for (const version of versions) deduped.set(version.v, version);

  const existingVersion =
    existing.version ?? Math.max(...versionsFromSnapshot(existing).map((v) => v.v));
  const snapshotVersion =
    snapshot.version ?? Math.max(...versionsFromSnapshot(snapshot).map((v) => v.v));
  const latest = snapshotVersion >= existingVersion ? snapshot : existing;

  return {
    ...existing,
    ...latest,
    version: Math.max(existingVersion, snapshotVersion),
    versions: [...deduped.values()],
  };
}

/**
 * Incrementally fold a single new snapshot into an existing artifact list,
 * merging by artifact id and keeping the same version-desc ordering that
 * `collectTransientArtifactsFromEvents` produces for a full rescan. Used by the
 * store to maintain the per-session transient-artifact table without re-scanning
 * the whole event log on every streamed token.
 */
export function upsertTransientArtifact(
  list: readonly TransientArtifactSnapshot[],
  snapshot: TransientArtifactSnapshot,
): readonly TransientArtifactSnapshot[] {
  const idx = list.findIndex((a) => a.id === snapshot.id);
  const merged =
    idx < 0
      ? [...list, snapshot]
      : list.map((a, i) => (i === idx ? mergeTransientArtifactSnapshots(a, snapshot) : a));
  return [...merged].sort((a, b) => (b.version ?? 1) - (a.version ?? 1));
}

export function collectTransientArtifactsFromEvents(
  events: readonly SessionEvent[],
): readonly TransientArtifactSnapshot[] {
  const started = new Map<string, Record<string, unknown> | undefined>();
  const snapshots: TransientArtifactSnapshot[] = [];

  for (const event of events) {
    if (event.kind === 'tool_start' && event.toolName === 'create_artifact') {
      started.set(event.toolId, event.input);
      continue;
    }
    if (event.kind !== 'tool_result') continue;
    const input = started.get(event.toolId);
    if (input === undefined && !started.has(event.toolId)) continue;
    const snapshot = snapshotFromCreateArtifactTool({
      status: 'done',
      input,
      result: event.content,
    });
    if (snapshot) snapshots.push(snapshot);
  }

  const byId = new Map<string, TransientArtifactSnapshot>();
  for (const snapshot of snapshots) {
    const existing = byId.get(snapshot.id);
    if (!existing) {
      byId.set(snapshot.id, snapshot);
      continue;
    }
    byId.set(snapshot.id, mergeTransientArtifactSnapshots(existing, snapshot));
  }

  return [...byId.values()].sort((a, b) => (b.version ?? 1) - (a.version ?? 1));
}
