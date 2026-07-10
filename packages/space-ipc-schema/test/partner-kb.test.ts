import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  invokeChannels,
  partnerKbLintChannel,
  partnerKbConfigGetChannel,
  partnerKbConfigSetChannel,
  partnerKbMaintenanceRunChannel,
  partnerKbMaintenanceLastChannel,
  partnerKbPageSchema,
  partnerKbPagesChannel,
  partnerKbRebuildIndexChannel,
  partnerKbReadPageChannel,
  partnerKbSearchChannel,
  partnerKbSearchMatchSchema,
  partnerKbSummaryChannel,
  partnerKbWritePageChannel,
  partnerKbConfigSchema,
  partnerKbMaintenanceReportSchema,
} from '../src/index.js';

test('partner KB channels are registered', () => {
  for (const name of [
    'partner.kb.summary',
    'partner.kb.pages',
    'partner.kb.readPage',
    'partner.kb.writePage',
    'partner.kb.search',
    'partner.kb.rebuildIndex',
    'partner.kb.lint',
    'partner.kb.config.get',
    'partner.kb.config.set',
    'partner.kb.maintenance.run',
    'partner.kb.maintenance.last',
  ]) {
    assert.ok(invokeChannels[name as keyof typeof invokeChannels], `${name} should be registered`);
  }
});

test('partner KB page schema accepts markdown wiki metadata', () => {
  const parsed = partnerKbPageSchema.safeParse({
    id: 'kb_1',
    projectRoot: '/workspace/project',
    slug: 'decisions',
    title: 'Decision Log',
    content: '# Decision\nUse local KB. [src_1]',
    pageType: 'decision',
    summary: 'Local KB decision notes',
    sources: ['src_1'],
    tags: ['architecture'],
    confidence: 'medium',
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  assert.equal(parsed.success, true);
});

test('partner KB channel inputs validate project paths and target selectors', () => {
  assert.equal(partnerKbSummaryChannel.input.safeParse({ projectRoot: '/repo' }).success, true);
  assert.equal(
    partnerKbPagesChannel.input.safeParse({ projectRoot: '/repo', query: 'decision' }).success,
    true,
  );
  assert.equal(
    partnerKbReadPageChannel.input.safeParse({ projectRoot: '/repo', slug: 'decisions' }).success,
    true,
  );
  assert.equal(
    partnerKbWritePageChannel.input.safeParse({
      projectRoot: '/repo',
      title: 'Decision',
      content: '# Decision',
      pageType: 'decision',
      sources: ['src_1'],
    }).success,
    true,
  );
  assert.equal(
    partnerKbSearchChannel.input.safeParse({ projectRoot: '/repo', query: 'Decision' }).success,
    true,
  );
  assert.equal(
    partnerKbRebuildIndexChannel.input.safeParse({ projectRoot: '/repo' }).success,
    true,
  );
  assert.equal(partnerKbLintChannel.input.safeParse({ projectRoot: '/repo' }).success, true);
  assert.equal(partnerKbConfigGetChannel.input.safeParse({ projectRoot: '/repo' }).success, true);
  assert.equal(
    partnerKbConfigSetChannel.input.safeParse({
      projectRoot: '/repo',
      claimPolicy: 'strict',
      freshnessWindowDays: 14,
      ignoredPaths: ['generated'],
    }).success,
    true,
  );
  assert.equal(
    partnerKbMaintenanceRunChannel.input.safeParse({ projectRoot: '/repo' }).success,
    true,
  );
  assert.equal(
    partnerKbMaintenanceLastChannel.input.safeParse({ projectRoot: '/repo' }).success,
    true,
  );
  assert.equal(
    partnerKbSummaryChannel.input.safeParse({ projectRoot: '/repo\nsecret' }).success,
    false,
  );
});

test('partner KB search/config/maintenance schemas expose explainable maintenance metadata', () => {
  assert.equal(
    partnerKbSearchMatchSchema.safeParse({
      page: {
        id: 'kb_1',
        projectRoot: '/repo',
        slug: 'api',
        title: 'API',
        pageType: 'note',
        summary: 'API docs',
        sources: ['src_1'],
        tags: ['api'],
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
      },
      snippet: 'API docs',
      score: 12,
      reasons: ['title', 'source'],
      sourceIds: ['src_1'],
      matchKind: 'hybrid-text',
      fallback: 'text',
    }).success,
    true,
  );
  const config = {
    projectRoot: '/repo',
    pageGroups: ['source', 'decision'],
    pinnedSources: ['src_1'],
    preferredSynthesisPages: ['overview'],
    ignoredPaths: ['vendor'],
    claimPolicy: 'warn',
    freshnessWindowDays: 30,
    updatedAt: 1,
  };
  assert.equal(partnerKbConfigSchema.safeParse(config).success, true);
  assert.equal(
    partnerKbMaintenanceReportSchema.safeParse({
      projectRoot: '/repo',
      runAt: 2,
      issueCount: 0,
      lintIssues: [],
      staleSources: [],
      duplicateTopics: [],
      configDiagnostics: [],
      summaryMarkdown: '# Partner KB Maintenance',
    }).success,
    true,
  );
});
