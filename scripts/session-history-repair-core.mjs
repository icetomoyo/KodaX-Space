import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

function assertLineageShape(lineage) {
  if (!lineage || typeof lineage !== 'object' || !Array.isArray(lineage.entries)) {
    throw new Error('Session lineage is missing or malformed.');
  }
  if (typeof lineage.activeEntryId !== 'string' || lineage.activeEntryId.length === 0) {
    throw new Error('Session lineage has no active entry.');
  }
}

function indexEntries(entries) {
  const byId = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') {
      throw new Error('Session lineage contains an entry without an ID.');
    }
    if (byId.has(entry.id)) {
      throw new Error(`Session lineage contains duplicate entry ID ${entry.id}.`);
    }
    byId.set(entry.id, entry);
  }
  return byId;
}

function canonicalEntryIdentity(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  if (typeof entry.logicalId === 'string' && entry.logicalId.length > 0) return entry.logicalId;
  if (typeof entry.sourceEntryId === 'string' && entry.sourceEntryId.length > 0) {
    return entry.sourceEntryId;
  }
  return typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : undefined;
}

/**
 * Hash the complete public transcript semantics used by resume and history.
 * Storage/actor metadata is deliberately excluded because observing a Session
 * may advance actorSnapshot.revision without changing any transcript content.
 */
export function transcriptSemanticRevision(transcript) {
  if (
    !transcript ||
    typeof transcript !== 'object' ||
    !Array.isArray(transcript.transcriptEntries)
  ) {
    throw new Error('Transcript is missing or malformed.');
  }
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        transcriptEntries: transcript.transcriptEntries,
        activeMessages: Array.isArray(transcript.activeMessages) ? transcript.activeMessages : [],
      }),
    )
    .digest('hex');
}

/**
 * Canonicalize a native fork while ignoring only physical storage IDs. KodaX
 * forks preserve logical/source identity, so every body and topology field must
 * remain exactly equal across the fork boundary.
 */
export function lineageSemanticProjection(lineage) {
  assertLineageShape(lineage);
  const byId = indexEntries(lineage.entries);
  return {
    activeIdentity: canonicalEntryIdentity(byId.get(lineage.activeEntryId)),
    entries: lineage.entries.map((entry) => {
      const body = { ...entry };
      delete body.id;
      delete body.parentId;
      delete body.logicalId;
      delete body.sourceEntryId;
      const { parentId } = entry;
      const parent = typeof parentId === 'string' ? byId.get(parentId) : undefined;
      return {
        identity: canonicalEntryIdentity(entry),
        parentIdentity: parent ? canonicalEntryIdentity(parent) : null,
        body,
      };
    }),
  };
}

function nearestAncestorCompaction(entry, byId) {
  const visited = new Set([entry.id]);
  let parentId = entry.parentId;
  while (typeof parentId === 'string' && parentId.length > 0) {
    if (visited.has(parentId)) {
      throw new Error(`Session lineage contains a parent cycle at ${parentId}.`);
    }
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) return undefined;
    if (parent.type === 'compaction') return parent;
    parentId = parent.parentId;
  }
  return undefined;
}

function isSyntheticCompactionContext(message) {
  return (
    message &&
    typeof message === 'object' &&
    message._synthetic === true &&
    message._source === 'compaction-context'
  );
}

/**
 * Select only standalone context carriers whose exact message is already owned
 * by an ancestor compaction's postCompactAttachments. This is deliberately not
 * a general content deduper: ordinary user/assistant/tool messages are never
 * candidates, even when every visible field is identical.
 */
export function planCompactionContextRepair(lineage) {
  assertLineageShape(lineage);
  const byId = indexEntries(lineage.entries);
  const candidates = [];

  for (const entry of lineage.entries) {
    if (entry.type !== 'message' || !isSyntheticCompactionContext(entry.message)) continue;
    const compaction = nearestAncestorCompaction(entry, byId);
    if (!compaction || !Array.isArray(compaction.postCompactAttachments)) continue;
    const attachmentIndex = compaction.postCompactAttachments.findIndex((attachment) =>
      isDeepStrictEqual(attachment, entry.message),
    );
    if (attachmentIndex < 0) continue;
    candidates.push({
      entryId: entry.id,
      parentId: entry.parentId ?? null,
      compactionEntryId: compaction.id,
      attachmentIndex,
    });
  }

  return { candidates };
}

function resolveKeptParent(parentId, removedParents) {
  const visited = new Set();
  let resolved = parentId;
  while (typeof resolved === 'string' && removedParents.has(resolved)) {
    if (visited.has(resolved)) {
      throw new Error(`Repair candidate parent cycle detected at ${resolved}.`);
    }
    visited.add(resolved);
    resolved = removedParents.get(resolved) ?? null;
  }
  return resolved ?? null;
}

export function removeRedundantCompactionContext(lineage) {
  const plan = planCompactionContextRepair(lineage);
  if (plan.candidates.length === 0) {
    return { lineage, removedEntryIds: [] };
  }

  const removedIds = new Set(plan.candidates.map((candidate) => candidate.entryId));
  if (removedIds.has(lineage.activeEntryId)) {
    throw new Error('Refusing to remove the active lineage entry.');
  }
  const removedParents = new Map(
    plan.candidates.map((candidate) => [candidate.entryId, candidate.parentId]),
  );
  const entries = lineage.entries
    .filter((entry) => !removedIds.has(entry.id))
    .map((entry) => {
      const parentId = resolveKeptParent(entry.parentId ?? null, removedParents);
      return parentId === (entry.parentId ?? null) ? entry : { ...entry, parentId };
    });

  const byId = indexEntries(entries);
  if (!byId.has(lineage.activeEntryId)) {
    throw new Error('Repair would leave the active lineage entry unresolved.');
  }
  for (const entry of entries) {
    if (entry.parentId !== null && entry.parentId !== undefined && !byId.has(entry.parentId)) {
      throw new Error(`Repair would leave dangling parent ${entry.parentId} for ${entry.id}.`);
    }
  }

  return {
    lineage: { ...lineage, entries },
    removedEntryIds: plan.candidates.map((candidate) => candidate.entryId),
  };
}

export function activeLineage(lineage) {
  assertLineageShape(lineage);
  const byId = indexEntries(lineage.entries);
  const activeIds = [];
  const visited = new Set();
  let entryId = lineage.activeEntryId;
  while (typeof entryId === 'string' && entryId.length > 0) {
    if (visited.has(entryId)) {
      throw new Error(`Session active lineage contains a parent cycle at ${entryId}.`);
    }
    visited.add(entryId);
    const entry = byId.get(entryId);
    if (!entry) throw new Error(`Session active entry ${entryId} is missing from lineage.`);
    activeIds.push(entryId);
    entryId = entry.parentId;
  }
  activeIds.reverse();
  const activeSet = new Set(activeIds);
  return {
    ...lineage,
    entries: lineage.entries.filter((entry) => activeSet.has(entry.id)),
  };
}

/**
 * KodaX's native fork contract intentionally copies the selected active path, not the complete
 * append-order audit lineage. A repair that starts from that fork is lossless only when no
 * inactive entries exist. Refuse every other source instead of publishing an active-context copy
 * as a repaired full Session.
 */
export function assertNativeForkPreservesCompleteHistory(fullLineage, active) {
  assertLineageShape(fullLineage);
  assertLineageShape(active);
  if (fullLineage.entries.length !== active.entries.length) {
    throw new Error(
      `Lossless repair is unavailable: the source contains ${fullLineage.entries.length} full-history entries but its native fork would retain only ${active.entries.length} active-path entries. The source and backup remain unchanged.`,
    );
  }
}
