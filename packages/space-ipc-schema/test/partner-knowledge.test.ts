import assert from 'node:assert/strict';
import test from 'node:test';

import {
  invokeChannels,
  partnerCitationResolveChannel,
  partnerEvidenceOwnerVersionRefSchema,
  partnerEvidenceSelectionRefSchema,
  partnerEvidenceLocatorSchema,
  partnerKnowledgeCatalogChannel,
  partnerKnowledgeRefreshChannel,
  partnerKnowledgeScopeSchema,
  partnerKnowledgeScopeSetChannel,
  partnerKnowledgeSelectChannel,
  partnerKnowledgeTraceReadChannel,
  partnerKnowledgeTraceSchema,
  partnerProjectMaterialRelationSchema,
  partnerProjectMaterialTargetSchema,
  partnerProjectSourceSchema,
  partnerSourceVersionSchema,
  sessionSendChannel,
} from '../src/index.js';

test('Partner knowledge channels are registered', () => {
  for (const name of [
    'partner.sources.catalog',
    'partner.sources.select',
    'partner.sources.refresh',
    'partner.materials.catalog',
    'partner.materials.select',
    'partner.materials.adopt',
    'partner.materials.remove',
    'partner.knowledge.scope.set',
    'partner.knowledge.trace.read',
    'partner.citations.resolve',
  ]) {
    assert.ok(invokeChannels[name as keyof typeof invokeChannels], `${name} should be registered`);
  }
});

test('Partner knowledge locators accept truthful coordinates and reject invalid ones', () => {
  assert.equal(partnerEvidenceLocatorSchema.safeParse({ kind: 'pdf_page', page: 1 }).success, true);
  assert.equal(
    partnerEvidenceLocatorSchema.safeParse({ kind: 'pdf_page', page: 0 }).success,
    false,
  );
  assert.equal(
    partnerEvidenceLocatorSchema.safeParse({
      kind: 'xlsx_range',
      sheet: 'Summary',
      range: 'B2:D8',
    }).success,
    true,
  );
  assert.equal(
    partnerEvidenceLocatorSchema.safeParse({ kind: 'text_line', startLine: 12, endLine: 4 })
      .success,
    false,
  );
});

test('Partner project source and version schemas keep stable identity separate from content', () => {
  const source = {
    id: 'src_project_1',
    projectRoot: '/workspace/project',
    path: 'docs/requirements.md',
    kind: 'workspace_path',
    targetKind: 'file',
    label: 'Requirements',
    currentVersionId: 'sv_01234567',
    ingestionStatus: 'ready',
    selected: true,
    createdAt: 1,
    updatedAt: 2,
  };
  assert.equal(partnerProjectSourceSchema.safeParse(source).success, true);
  assert.equal(
    partnerSourceVersionSchema.safeParse({
      id: 'sv_01234567',
      sourceId: 'src_project_1',
      contentHash: 'a'.repeat(64),
      parserGeneration: 'parser-v1',
      chunkerGeneration: 'chunker-v1',
      snapshotRef: 'snapshots/src_project_1/sv_1.json',
      byteSize: 120,
      createdAt: 2,
      indexedAt: 3,
    }).success,
    true,
  );
  assert.equal(
    partnerSourceVersionSchema.safeParse({
      id: 'sv_01234567',
      sourceId: 'src_project_1',
      contentHash: 'a'.repeat(64),
      parserGeneration: 'parser-v1',
      chunkerGeneration: 'chunker-v1',
      snapshotRef: '../outside.json',
      byteSize: 120,
      createdAt: 2,
    }).success,
    false,
  );
});

test('Partner knowledge catalog and selection require project/session authority inputs', () => {
  assert.equal(
    partnerKnowledgeCatalogChannel.input.safeParse({ projectRoot: '/workspace/project' }).success,
    true,
  );
  assert.equal(
    partnerKnowledgeSelectChannel.input.safeParse({
      projectRoot: '/workspace/project',
      sessionId: 's_partner',
      sourceId: 'src_project_1',
      selected: true,
    }).success,
    true,
  );
  assert.equal(
    partnerKnowledgeRefreshChannel.input.safeParse({
      projectRoot: '/workspace/project',
      sourceId: 'src_project_1',
    }).success,
    true,
  );
});

test('Partner retrieval scopes are explicit and bounded', () => {
  for (const scope of ['project-grounded', 'selected-only', 'general']) {
    assert.equal(partnerKnowledgeScopeSchema.safeParse(scope).success, true);
  }
  assert.equal(partnerKnowledgeScopeSchema.safeParse('automatic').success, false);
  assert.equal(
    partnerKnowledgeScopeSetChannel.input.safeParse({
      projectRoot: '/workspace/project',
      sessionId: 's_partner',
      scope: 'selected-only',
    }).success,
    true,
  );
  assert.equal(
    sessionSendChannel.input.safeParse({
      sessionId: 's_partner',
      prompt: 'Answer from project evidence',
      partnerRetrievalScope: 'selected-only',
    }).success,
    true,
  );
  assert.equal(
    sessionSendChannel.input.safeParse({
      sessionId: 's_partner',
      prompt: 'Answer from project evidence',
      partnerRetrievalScope: 'automatic',
    }).success,
    false,
  );
});

test('Citation and trace reads accept opaque ids but no renderer-supplied evidence coordinates', () => {
  assert.equal(
    partnerCitationResolveChannel.input.safeParse({
      projectRoot: '/workspace/project',
      sessionId: 's_partner',
      citationId: 'cite_0123456789abcdef0123456789abcdef',
    }).success,
    true,
  );
  assert.equal(
    partnerKnowledgeTraceReadChannel.input.safeParse({
      projectRoot: '/workspace/project',
      sessionId: 's_partner',
      traceId: 'trace_0123456789abcdef0123456789abcdef',
      locator: { kind: 'pdf_page', page: 99 },
    }).success,
    false,
  );
});

test('Partner material contracts keep availability, selection, and immutable owner identity distinct', () => {
  assert.equal(
    partnerProjectMaterialRelationSchema.safeParse({
      id: 'rel_01234567',
      projectRoot: '/workspace/project',
      target: { kind: 'project-source', sourceId: 'src_01234567' },
      createdAt: 1,
      createdBy: 'user',
      lifecycle: 'active',
    }).success,
    true,
  );
  assert.equal(
    partnerProjectMaterialRelationSchema.safeParse({
      id: 'rel_01234567',
      projectRoot: '/workspace/project',
      target: { kind: 'project-source', sourceId: 'src_01234567' },
      createdAt: 1,
      createdBy: 'user',
      lifecycle: 'removed',
    }).success,
    false,
  );
  assert.equal(
    partnerProjectMaterialTargetSchema.safeParse({
      kind: 'result',
      resultOwner: 'artifact',
      resultOwnerId: 'artifact_1',
      resultOwnerVersionId: 'artifact_version_1',
      searchable: true,
    }).success,
    false,
  );
  assert.equal(
    partnerEvidenceSelectionRefSchema.safeParse({
      kind: 'task-attachment-snapshot',
      ownerId: 'attachment_1',
      version: { policy: 'pinned', versionId: 'attachment_version_1' },
    }).success,
    true,
  );
  assert.equal(
    partnerEvidenceOwnerVersionRefSchema.safeParse({
      kind: 'connector-snapshot',
      ownerId: 'resource_1',
      versionId: 'snapshot_1',
    }).success,
    false,
  );
  assert.equal(
    partnerEvidenceOwnerVersionRefSchema.safeParse({
      kind: 'connector-snapshot',
      adapterId: 'mock:connector-v1',
      ownerId: 'resource_1',
      versionId: 'snapshot_1',
    }).success,
    true,
  );
  assert.equal(
    partnerEvidenceOwnerVersionRefSchema.safeParse({
      kind: 'result-snapshot',
      adapterId: 'builtin:result-snapshot-v1',
      ownerId: 'result_1',
      versionId: 'result_version_1',
      currentAccess: 'authorized',
    }).success,
    false,
  );
});

test('Partner trace compatibility source fields are exact read-only projections', () => {
  const trace = {
    traceId: 'trace_0123456789abcdef',
    sessionId: 's_partner',
    scope: 'selected-only',
    createdAt: 10,
    notices: [],
    selectedMaterialRelationIds: ['rel_01234567'],
    selectedEvidenceOwnerRefs: [
      {
        kind: 'project-source',
        ownerId: 'src_01234567',
        version: { policy: 'current-at-run' },
      },
    ],
    usedEvidenceOwnerVersionRefs: [
      {
        kind: 'project-source',
        ownerId: 'src_01234567',
        versionId: 'sv_01234567',
      },
    ],
    usedKnowledgePageVersionRefs: [],
    accessDecisions: [],
    selectedSourceIds: ['src_01234567'],
    usedSourceIds: ['src_01234567'],
    usedSourceVersionIds: ['sv_01234567'],
    items: [],
    budget: { usedChars: 100, maxChars: 1000 },
  } as const;
  assert.equal(partnerKnowledgeTraceSchema.safeParse(trace).success, true);
  assert.equal(
    partnerKnowledgeTraceSchema.safeParse({ ...trace, selectedSourceIds: [] }).success,
    false,
  );
});
