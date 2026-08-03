import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeLineage,
  assertNativeForkPreservesCompleteHistory,
  lineageSemanticProjection,
  planCompactionContextRepair,
  removeRedundantCompactionContext,
  transcriptSemanticRevision,
} from '../session-history-repair-core.mjs';

const attachment = {
  role: 'user',
  content: '[Post-compact: recent operations]\nRead: one.ts',
  _synthetic: true,
  _source: 'compaction-context',
};

function fixture() {
  return {
    version: 2,
    activeEntryId: 'answer',
    entries: [
      {
        type: 'compaction',
        id: 'compact',
        parentId: null,
        postCompactAttachments: [attachment],
      },
      {
        type: 'message',
        id: 'carrier-1',
        parentId: 'compact',
        message: structuredClone(attachment),
      },
      {
        type: 'message',
        id: 'query',
        parentId: 'carrier-1',
        message: { role: 'user', content: 'same text' },
      },
      {
        type: 'message',
        id: 'answer',
        parentId: 'query',
        message: { role: 'assistant', content: 'same answer' },
      },
      {
        type: 'message',
        id: 'inactive-same-query',
        parentId: null,
        message: { role: 'user', content: 'same text' },
      },
    ],
  };
}

test('repair removes only an exact standalone compaction attachment and reparents descendants', () => {
  const lineage = activeLineage(fixture());
  const plan = planCompactionContextRepair(lineage);
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.entryId),
    ['carrier-1'],
  );

  const repaired = removeRedundantCompactionContext(lineage);
  assert.deepEqual(repaired.removedEntryIds, ['carrier-1']);
  assert.deepEqual(
    repaired.lineage.entries.map((entry) => entry.id),
    ['compact', 'query', 'answer'],
  );
  assert.equal(repaired.lineage.entries.find((entry) => entry.id === 'query').parentId, 'compact');
});

test('ordinary identical user and assistant messages are never content-deduped', () => {
  const lineage = fixture();
  lineage.entries.push({
    type: 'message',
    id: 'second-answer',
    parentId: 'inactive-same-query',
    message: { role: 'assistant', content: 'same answer' },
  });
  const repaired = removeRedundantCompactionContext(lineage);
  assert.ok(repaired.lineage.entries.some((entry) => entry.id === 'query'));
  assert.ok(repaired.lineage.entries.some((entry) => entry.id === 'inactive-same-query'));
  assert.ok(repaired.lineage.entries.some((entry) => entry.id === 'answer'));
  assert.ok(repaired.lineage.entries.some((entry) => entry.id === 'second-answer'));
});

test('synthetic context without exact ancestor attachment provenance fails open', () => {
  const lineage = fixture();
  lineage.entries[1].message = { ...attachment, content: `${attachment.content}\nchanged` };
  assert.deepEqual(planCompactionContextRepair(activeLineage(lineage)).candidates, []);
});

test('repair is idempotent', () => {
  const first = removeRedundantCompactionContext(activeLineage(fixture()));
  const second = removeRedundantCompactionContext(first.lineage);
  assert.equal(second.lineage, first.lineage);
  assert.deepEqual(second.removedEntryIds, []);
});

test('active path extraction excludes inactive audit branches without deleting the source lineage', () => {
  const lineage = fixture();
  const active = activeLineage(lineage);
  assert.deepEqual(
    active.entries.map((entry) => entry.id),
    ['compact', 'carrier-1', 'query', 'answer'],
  );
  assert.equal(lineage.entries.length, 5);
});

test('repair refuses an active-only fork when full audit entries would be omitted', () => {
  const lineage = fixture();
  const active = activeLineage(lineage);

  assert.throws(
    () => assertNativeForkPreservesCompleteHistory(lineage, active),
    /5 full-history entries.*only 4 active-path entries/i,
  );
});

test('repair permits a native fork only when the full lineage is the active path', () => {
  const active = activeLineage(fixture());
  assert.doesNotThrow(() => assertNativeForkPreservesCompleteHistory(active, active));
});

test('transcript semantic revision changes when message content changes under stable IDs', () => {
  const transcript = {
    activeMessages: [{ role: 'user', content: 'before' }],
    transcriptEntries: [
      {
        entryId: 'entry-1',
        logicalId: 'logical-1',
        type: 'message',
        message: { role: 'user', content: 'before' },
      },
    ],
  };
  const changed = structuredClone(transcript);
  changed.transcriptEntries[0].message.content = 'after';
  assert.notEqual(transcriptSemanticRevision(transcript), transcriptSemanticRevision(changed));
});

test('lineage semantic projection accepts native fork physical IDs but preserves all bodies', () => {
  const source = activeLineage(fixture());
  const idMap = new Map(source.entries.map((entry) => [entry.id, `fork-${entry.id}`]));
  const fork = {
    ...source,
    activeEntryId: idMap.get(source.activeEntryId),
    entries: source.entries.map((entry) => ({
      ...entry,
      id: idMap.get(entry.id),
      parentId: entry.parentId === null ? null : idMap.get(entry.parentId),
      logicalId: entry.logicalId ?? entry.id,
      sourceEntryId: entry.sourceEntryId ?? entry.id,
    })),
  };
  assert.deepEqual(lineageSemanticProjection(fork), lineageSemanticProjection(source));

  fork.entries[2].message = { ...fork.entries[2].message, content: 'mutated query' };
  assert.notDeepEqual(lineageSemanticProjection(fork), lineageSemanticProjection(source));
});
