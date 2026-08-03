import { createHash } from 'node:crypto';

type TranscriptEntryLike = {
  readonly entryId?: unknown;
  readonly parentId?: unknown;
  readonly logicalId?: unknown;
  readonly sourceEntryId?: unknown;
  readonly timestamp?: unknown;
  readonly turnId?: unknown;
  readonly active?: unknown;
  readonly type?: unknown;
  readonly message?: {
    readonly role?: unknown;
    readonly content?: unknown;
    readonly _synthetic?: unknown;
    readonly _source?: unknown;
  } | null;
  readonly summary?: unknown;
  readonly payload?: unknown;
};

export type CanonicalTranscriptEntry<T> = T & {
  /** Zero-based position after the defensive parent-before-child repair. */
  readonly canonicalIndex: number;
  /** Physical entry whose body won when a proven clone group had differing payloads. */
  readonly authoritativeEntryId?: string;
};

/**
 * Content fingerprints remain useful for diagnostics and tests, but are not clone proof.
 * Two legitimate prompts may have identical bytes, so this value must never decide whether
 * transcript rows are deleted or moved.
 */
export function entryContentKey(entry: {
  readonly type?: unknown;
  readonly message?: { readonly role?: unknown; readonly content?: unknown } | null;
  readonly summary?: unknown;
}): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        t: entry.type ?? 'message',
        r: entry.message?.role ?? null,
        c: entry.message?.content ?? null,
        s: entry.summary ?? null,
      }),
    )
    .digest('hex');
}

/**
 * SDK eviction placeholder for an old island body. It is not a visible message. An exact copy
 * with the same physical/logical identity is selected independently by the SDK or clone fold.
 */
export function isCompactedPlaceholder(entry: {
  readonly type?: unknown;
  readonly message?: { readonly content?: unknown } | null;
}): boolean {
  if (entry.type !== undefined && entry.type !== 'message') return false;
  const content = entry.message?.content;
  if (typeof content === 'string') return content === '[compacted]';
  if (Array.isArray(content)) {
    return (
      content.length === 1 &&
      typeof content[0] === 'object' &&
      content[0] !== null &&
      (content[0] as { type?: unknown }).type === 'text' &&
      (content[0] as { text?: unknown }).text === '[compacted]'
    );
  }
  return false;
}

export function isRewindMarker(entry: {
  readonly type?: unknown;
  readonly summary?: unknown;
  readonly payload?: unknown;
}): boolean {
  if (entry.type === 'rewind_marker') return true;
  if (entry.type !== 'compaction') return false;
  const payload = record(entry.payload);
  if (payload?.reason === 'rewind') return true;
  return typeof entry.summary === 'string' && entry.summary.startsWith('[Rewind]');
}

/**
 * Defensive repair for legacy SDK transcripts that placed an archived child before a parent that
 * survived in the main JSONL. Parent edges are hard; the supplied record order is the stable
 * priority among currently eligible entries. Timestamps are deliberately not used.
 *
 * Current SDK transcripts already satisfy the constraint and therefore pass through byte-order
 * unchanged. Corrupt parent cycles fail open: the earliest remaining row is emitted and no row is
 * discarded.
 */
export function orderTranscriptEntriesParentBeforeChild<T extends TranscriptEntryLike>(
  entries: readonly T[],
): T[] {
  if (entries.length < 2) return [...entries];
  const indexById = new Map<string, number>();
  for (let index = 0; index < entries.length; index++) {
    const id = stringValue(entries[index]?.entryId);
    if (id !== undefined && !indexById.has(id)) indexById.set(id, index);
  }

  const children = new Map<number, number[]>();
  const indegree = new Array<number>(entries.length).fill(0);
  const parentIndexByChild = new Array<number | undefined>(entries.length).fill(undefined);
  let hasViolation = false;
  for (let childIndex = 0; childIndex < entries.length; childIndex++) {
    const parentId = stringValue(entries[childIndex]?.parentId);
    if (parentId === undefined) continue;
    const parentIndex = indexById.get(parentId);
    if (parentIndex === undefined || parentIndex === childIndex) continue;
    indegree[childIndex] = 1;
    parentIndexByChild[childIndex] = parentIndex;
    const bucket = children.get(parentIndex) ?? [];
    bucket.push(childIndex);
    children.set(parentIndex, bucket);
    if (parentIndex > childIndex) hasViolation = true;
  }
  if (!hasViolation) return [...entries];

  const emitted = new Array<boolean>(entries.length).fill(false);
  const out: T[] = [];
  while (out.length < entries.length) {
    let next = -1;
    for (let index = 0; index < entries.length; index++) {
      if (!emitted[index] && indegree[index] === 0) {
        next = index;
        break;
      }
    }
    if (next < 0) {
      // A corrupt parent cycle is not permission to lose history. Break the incoming edge of the
      // earliest member of one actual cycle, then let the normal ready-node scan preserve every
      // acyclic parent constraint outside that cycle.
      const cycleMember = earliestUnresolvedCycleMember(emitted, parentIndexByChild);
      if (cycleMember < 0) break;
      indegree[cycleMember] = 0;
      continue;
    }
    emitted[next] = true;
    out.push(entries[next]!);
    for (const child of children.get(next) ?? []) {
      indegree[child] = Math.max(0, indegree[child]! - 1);
    }
  }
  return out;
}

function earliestUnresolvedCycleMember(
  emitted: readonly boolean[],
  parentIndexByChild: readonly (number | undefined)[],
): number {
  for (let start = 0; start < emitted.length; start++) {
    if (emitted[start]) continue;
    const path: number[] = [];
    const pathIndex = new Map<number, number>();
    let current: number | undefined = start;
    while (current !== undefined && !emitted[current]) {
      const repeatedAt = pathIndex.get(current);
      if (repeatedAt !== undefined) {
        return Math.min(...path.slice(repeatedAt));
      }
      pathIndex.set(current, path.length);
      path.push(current);
      current = parentIndexByChild[current];
    }
  }
  return -1;
}

/**
 * Complete Space history-selection pipeline:
 *
 * 1. repair only impossible child-before-parent legacy order;
 * 2. classify storage-only, placeholder, rewind-marker, and proven abandoned-rewind rows;
 * 3. fold only clones proven by physical/logical/source identity;
 * 4. retain the first canonical slot while selecting an authoritative body independently.
 *
 * `active`, timestamp, role/content equality, and sidecar location are never clone proof.
 * Ambiguous legacy rows fail open and remain visible.
 */
export function dedupeTranscriptEntries<T extends TranscriptEntryLike>(
  entries: readonly T[],
): Array<CanonicalTranscriptEntry<T>> {
  const ordered = orderTranscriptEntriesParentBeforeChild(entries);
  const selected = classifyTranscriptEntries(ordered);
  return foldProvenTranscriptClones(selected);
}

function classifyTranscriptEntries<T extends TranscriptEntryLike>(
  ordered: readonly T[],
): Array<{ readonly entry: T; readonly canonicalIndex: number }> {
  const byId = new Map<string, T>();
  for (const entry of ordered) {
    const id = stringValue(entry.entryId);
    if (id !== undefined && !byId.has(id)) byId.set(id, entry);
  }

  // Rewind exposes an exact abandoned path (`fromId` back to, but excluding, `rewindTargetId`).
  // Hide only that proven physical path. Missing/corrupt details fail open.
  const abandonedIds = new Set<string>();
  for (const entry of ordered) {
    if (!isRewindMarker(entry)) continue;
    const details = rewindDetails(entry.payload);
    if (details.fromId === undefined || details.targetId === undefined) continue;
    const candidateIds = new Set<string>();
    let current: string | undefined = details.fromId;
    while (current !== undefined && current !== details.targetId && !candidateIds.has(current)) {
      candidateIds.add(current);
      current = stringValue(byId.get(current)?.parentId);
    }
    if (current === details.targetId) {
      for (const id of candidateIds) abandonedIds.add(id);
    }
  }

  const selected: Array<{ readonly entry: T; readonly canonicalIndex: number }> = [];
  for (let canonicalIndex = 0; canonicalIndex < ordered.length; canonicalIndex++) {
    const entry = ordered[canonicalIndex]!;
    if (isRewindMarker(entry)) continue;
    if (entry.type === 'archive_marker' || entry.type === 'label' || entry.type === 'goal') {
      continue;
    }
    const entryId = stringValue(entry.entryId);
    if (entryId !== undefined && abandonedIds.has(entryId)) continue;
    selected.push({ entry, canonicalIndex });
  }
  return selected;
}

function foldProvenTranscriptClones<T extends TranscriptEntryLike>(
  selected: readonly { readonly entry: T; readonly canonicalIndex: number }[],
): Array<CanonicalTranscriptEntry<T>> {
  const parent = selected.map((_, index) => index);
  const find = (value: number): number => {
    let root = value;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[value] !== value) {
      const next = parent[value]!;
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  };

  const firstByEntryId = new Map<string, number>();
  const firstByLogicalId = new Map<string, number>();
  const firstBySourceEntryId = new Map<string, number>();
  for (let index = 0; index < selected.length; index++) {
    const entry = selected[index]!.entry;
    const entryId = stringValue(entry.entryId);
    if (entryId !== undefined) {
      const first = firstByEntryId.get(entryId);
      if (first === undefined) firstByEntryId.set(entryId, index);
      else union(first, index);
    }
    const logicalId = stringValue(entry.logicalId);
    if (logicalId !== undefined) {
      const first = firstByLogicalId.get(logicalId);
      if (first === undefined) firstByLogicalId.set(logicalId, index);
      else union(first, index);
    }
    const sourceEntryId = stringValue(entry.sourceEntryId);
    if (sourceEntryId !== undefined) {
      const source = firstByEntryId.get(sourceEntryId);
      if (source !== undefined) union(source, index);
      const first = firstBySourceEntryId.get(sourceEntryId);
      if (first === undefined) firstBySourceEntryId.set(sourceEntryId, index);
      else union(first, index);
    }
  }
  // A source entry may occur after its clone in malformed legacy order.
  for (let index = 0; index < selected.length; index++) {
    const sourceEntryId = stringValue(selected[index]!.entry.sourceEntryId);
    const source = sourceEntryId === undefined ? undefined : firstByEntryId.get(sourceEntryId);
    if (source !== undefined) union(source, index);
  }
  const membersByRoot = new Map<number, number[]>();
  for (let index = 0; index < selected.length; index++) {
    const root = find(index);
    const members = membersByRoot.get(root) ?? [];
    members.push(index);
    membersByRoot.set(root, members);
  }

  const out: Array<CanonicalTranscriptEntry<T>> = [];
  const canonicalEntryIdByMemberEntryId = new Map<string, string>();
  for (let index = 0; index < selected.length; index++) {
    const members = membersByRoot.get(find(index))!;
    if (members[0] !== index) continue;
    const canonical = selected[index]!;
    const authoritativeIndex = chooseAuthoritativeIndex(selected, members);
    const authoritative = selected[authoritativeIndex]!.entry;
    const merged = mergeCanonicalIdentity(canonical.entry, authoritative, members, selected);
    const canonicalEntryId = stringValue(merged.entryId);
    if (canonicalEntryId !== undefined) {
      for (const memberIndex of members) {
        const memberEntryId = stringValue(selected[memberIndex]!.entry.entryId);
        if (memberEntryId !== undefined) {
          canonicalEntryIdByMemberEntryId.set(memberEntryId, canonicalEntryId);
        }
      }
    }
    out.push({
      ...merged,
      canonicalIndex: canonical.canonicalIndex,
      ...(authoritativeIndex !== index && stringValue(authoritative.entryId) !== undefined
        ? { authoritativeEntryId: stringValue(authoritative.entryId)! }
        : {}),
    } as CanonicalTranscriptEntry<T>);
  }
  return out
    .filter((entry) => !isCompactedPlaceholder(entry))
    .map((entry) => {
      const parentId = stringValue(entry.parentId);
      const canonicalParentId =
        parentId === undefined ? undefined : canonicalEntryIdByMemberEntryId.get(parentId);
      return canonicalParentId !== undefined && canonicalParentId !== parentId
        ? ({ ...entry, parentId: canonicalParentId } as CanonicalTranscriptEntry<T>)
        : entry;
    });
}

function chooseAuthoritativeIndex<T extends TranscriptEntryLike>(
  selected: readonly { readonly entry: T }[],
  members: readonly number[],
): number {
  let best = members[0]!;
  let bestScore = authoritativeScore(selected[best]!.entry, best);
  for (const index of members.slice(1)) {
    const score = authoritativeScore(selected[index]!.entry, index);
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  }
  return best;
}

function authoritativeScore(entry: TranscriptEntryLike, index: number): number {
  // Exact bodies outrank placeholders regardless of branch activity. Activity selects among
  // exact copies only; it must never pull a clone to a later display position.
  let score = isCompactedPlaceholder(entry) ? 0 : 10_000_000;
  if (entry.active === true) score += 1_000_000;
  if (entry.message !== null && entry.message !== undefined) score += 10_000;
  if (typeof entry.summary === 'string' && entry.summary.length > 0) score += 1_000;
  // Later copies may contain normalized payload fields unavailable on the original. This affects
  // only the body choice; mergeCanonicalIdentity keeps the first canonical position and identity.
  return score + index;
}

function mergeCanonicalIdentity<T extends TranscriptEntryLike>(
  canonical: T,
  authoritative: T,
  members: readonly number[],
  selected: readonly { readonly entry: T }[],
): T {
  const anyActive = members.some((index) => selected[index]!.entry.active === true);
  const merged: Record<string, unknown> = { ...authoritative };
  copyIdentityField(merged, 'entryId', canonical.entryId, authoritative.entryId);
  copyNullableIdentityField(merged, 'parentId', canonical.parentId, authoritative.parentId);
  copyIdentityField(merged, 'timestamp', canonical.timestamp, authoritative.timestamp);
  copyIdentityField(merged, 'logicalId', canonical.logicalId, authoritative.logicalId);
  copyIdentityField(merged, 'sourceEntryId', canonical.sourceEntryId, authoritative.sourceEntryId);
  if (merged.sourceEntryId === merged.entryId) delete merged.sourceEntryId;
  copyIdentityField(merged, 'turnId', canonical.turnId, authoritative.turnId);
  if (members.length > 1) merged.active = anyActive;
  return merged as T;
}

function copyIdentityField(
  target: Record<string, unknown>,
  key: string,
  preferred: unknown,
  fallback: unknown,
): void {
  const value = stringValue(preferred) ?? stringValue(fallback);
  if (value === undefined) delete target[key];
  else target[key] = value;
}

function copyNullableIdentityField(
  target: Record<string, unknown>,
  key: string,
  preferred: unknown,
  fallback: unknown,
): void {
  if (preferred === null) {
    target[key] = null;
    return;
  }
  const value = stringValue(preferred) ?? (fallback === null ? null : stringValue(fallback));
  if (value === undefined) delete target[key];
  else target[key] = value;
}

function rewindDetails(payload: unknown): {
  readonly targetId?: string;
  readonly fromId?: string;
} {
  const top = record(payload);
  const details = record(top?.details);
  return {
    targetId:
      stringValue(top?.rewindTargetId) ??
      stringValue(top?.targetId) ??
      stringValue(details?.rewindTargetId) ??
      stringValue(details?.targetId),
    fromId: stringValue(top?.fromId) ?? stringValue(details?.fromId),
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
