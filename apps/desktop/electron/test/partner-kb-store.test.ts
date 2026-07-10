import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PartnerKbStore } from '../kodax/partner-kb-store.js';

function freshStore(): { store: PartnerKbStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'partner-kb-store-'));
  return { store: new PartnerKbStore(join(dir, 'partner-kb.json')), dir };
}

test('PartnerKbStore creates, lists, reads, and updates pages by slug', async () => {
  const { store, dir } = freshStore();
  try {
    const created = await store.upsert({
      projectRoot: '/project',
      title: 'Design Notes',
      content: '# v1',
    });
    assert.equal(created.created, true);
    assert.equal(created.page.slug, 'design-notes');
    assert.equal((await store.list('/project')).length, 1);
    assert.equal((await store.get('/project', { slug: 'design-notes' }))?.content, '# v1');

    const updated = await store.upsert({
      projectRoot: '/project',
      title: 'Design Notes',
      content: '# v2',
      slug: 'design-notes',
    });
    assert.equal(updated.created, false);
    assert.equal(updated.page.id, created.page.id);
    assert.equal((await store.list('/project')).length, 1);
    assert.equal((await store.get('/project', { id: created.page.id }))?.content, '# v2');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerKbStore isolates pages by project root', async () => {
  const { store, dir } = freshStore();
  try {
    await store.upsert({ projectRoot: '/a', title: 'Shared', content: 'A' });
    await store.upsert({ projectRoot: '/b', title: 'Shared', content: 'B' });
    assert.equal((await store.list('/a')).length, 1);
    assert.equal((await store.list('/b')).length, 1);
    assert.equal((await store.get('/a', { slug: 'shared' }))?.content, 'A');
    assert.equal((await store.get('/b', { slug: 'shared' }))?.content, 'B');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerKbStore creates source pages and derived index/log summaries', async () => {
  const { store, dir } = freshStore();
  try {
    const result = await store.upsertSourceReference({
      id: 'src_1',
      sessionId: 's_partner',
      kind: 'workspace_path',
      projectRoot: '/project',
      path: 'docs/input.md',
      targetKind: 'file',
      label: 'Input Notes',
      addedAt: 1234,
    });
    assert.equal(result.created, true);
    assert.equal(result.page.pageType, 'source');
    assert.deepEqual(result.page.sources, ['src_1']);

    const summary = await store.summary('/project');
    assert.equal(summary.pageCount, 1);
    assert.equal(summary.sourcePageCount, 1);
    assert.match(summary.indexMarkdown, /Input Notes/);
    assert.match(summary.recentLog, /source_attached/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerKbStore searches pages and lints broken links, uncited claims, and orphan pages', async () => {
  const { store, dir } = freshStore();
  try {
    await store.upsert({
      projectRoot: '/project',
      title: 'Vendor Fit',
      slug: 'vendor-fit',
      pageType: 'synthesis',
      content: [
        '# Vendor Fit',
        '',
        'See [[missing-page]].',
        '',
        '## Key Claims',
        '',
        '- Vendor A is ready for mid-market teams.',
      ].join('\n'),
    });
    await store.upsert({
      projectRoot: '/project',
      title: 'Decision',
      slug: 'decision',
      pageType: 'decision',
      content: '# Decision\nShip local KB. [src_1]',
    });

    const matches = await store.search('/project', 'mid-market');
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.page.slug, 'vendor-fit');
    assert.ok(matches[0]?.reasons.includes('content'));
    assert.equal(matches[0]?.matchKind, 'hybrid-text');
    assert.equal(matches[0]?.fallback, 'text');

    const issues = await store.lint('/project');
    assert.ok(issues.some((issue) => issue.kind === 'broken-link'));
    assert.ok(issues.some((issue) => issue.kind === 'uncited-claim'));
    assert.ok(issues.some((issue) => issue.kind === 'orphan-page' && issue.slug === 'decision'));
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerKbStore search supports Chinese, mixed-language, punctuation, and short terms', async () => {
  const { store, dir } = freshStore();
  try {
    await store.upsert({
      projectRoot: '/project',
      title: '竞争对手分析',
      slug: 'china-competitor-analysis',
      pageType: 'synthesis',
      content: [
        '# 竞争对手分析',
        '',
        '主要竞品的定价策略存在明显差异。',
        '团队正在评估人工智能与 AI 市场，并使用 R 语言验证数据。',
      ].join('\n'),
    });
    await store.upsert({
      projectRoot: '/project',
      title: 'Quarterly Report',
      slug: 'quarterly-report',
      content: 'Research archive for the operations team.',
    });

    for (const query of ['竞争对手', '人工智能 AI', '竞品，定价']) {
      const matches = await store.search('/project', query);
      assert.equal(matches[0]?.page.slug, 'china-competitor-analysis', `query ${query}`);
    }

    const shortTermMatches = await store.search('/project', 'R');
    assert.deepEqual(
      shortTermMatches.map((match) => match.page.slug),
      ['china-competitor-analysis'],
      'a one-letter term should use word boundaries instead of matching every letter occurrence',
    );
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerKbStore preserves malformed or schema-invalid files and rejects mutations', async (t) => {
  const fixtures = [
    { name: 'malformed JSON', contents: '{"version":1,"pages":[' },
    { name: 'invalid schema', contents: JSON.stringify({ version: 1, pages: 'not-an-array' }) },
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'partner-kb-store-corrupt-'));
      const filePath = join(dir, 'partner-kb.json');
      const store = new PartnerKbStore(filePath);
      writeFileSync(filePath, fixture.contents, 'utf-8');
      try {
        await assert.rejects(
          () =>
            store.upsert({
              projectRoot: '/project',
              title: 'Must Not Overwrite',
              content: 'Preserve the original bytes.',
            }),
          /PartnerKbStore.*(?:invalid JSON|schema invalid)/,
        );
        assert.equal(readFileSync(filePath, 'utf-8'), fixture.contents);
        await assert.rejects(
          () => store.list('/project'),
          /PartnerKbStore.*(?:invalid JSON|schema invalid)/,
        );
      } finally {
        store.invalidate();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

test('PartnerKbStore supports steerable config, index rebuild, and maintenance reports', async () => {
  const { store, dir } = freshStore();
  try {
    await store.upsert({
      projectRoot: '/project',
      title: 'Vendor Fit',
      slug: 'vendor-fit',
      pageType: 'synthesis',
      content: [
        '# Vendor Fit',
        '',
        'See [[missing-page]].',
        '',
        '## Key Claims',
        '',
        '- Vendor A is ready.',
      ].join('\n'),
    });
    await store.upsert({
      projectRoot: '/project',
      title: 'Vendor Fit',
      slug: 'vendor-fit-copy',
      pageType: 'note',
      content: '# Vendor Fit Copy\nDuplicate topic.',
    });

    const defaultConfig = await store.config('/project');
    assert.equal(defaultConfig.config.claimPolicy, 'warn');
    assert.equal(defaultConfig.config.freshnessWindowDays, 30);

    const updatedConfig = await store.setConfig({
      projectRoot: '/project',
      claimPolicy: 'off',
      freshnessWindowDays: 7,
      ignoredPaths: ['vendor-fit-copy'],
      pinnedSources: ['src_missing'],
    });
    assert.equal(updatedConfig.config.claimPolicy, 'off');
    assert.equal(updatedConfig.config.freshnessWindowDays, 7);
    assert.ok(updatedConfig.diagnostics.some((diagnostic) => diagnostic.path === 'pinnedSources'));

    const matches = await store.search('/project', 'duplicate');
    assert.equal(matches.length, 0, 'ignored paths should be omitted from search');

    const lintIssues = await store.lint('/project');
    assert.ok(lintIssues.some((issue) => issue.kind === 'broken-link'));
    assert.equal(
      lintIssues.some((issue) => issue.kind === 'uncited-claim'),
      false,
      'claimPolicy=off should suppress uncited key-claim issues',
    );

    const report = await store.runMaintenance('/project');
    assert.ok(report.issueCount >= 1);
    assert.match(report.summaryMarkdown, /Partner KB Maintenance/);
    assert.equal((await store.lastMaintenance('/project'))?.runAt, report.runAt);

    const rebuilt = await store.rebuildIndex('/project');
    assert.equal(rebuilt.pageCount, 2);
    assert.match(rebuilt.indexMarkdown, /Vendor Fit/);
    assert.match(await store.recentLog('/project'), /index_rebuilt/);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});
