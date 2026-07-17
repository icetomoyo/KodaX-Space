import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PARTNER_CODE_KNOWLEDGE_SKILLS,
  PARTNER_WORKBENCH_OUTPUT_PREFERENCES,
  PARTNER_WORKBENCH_SCENARIO_PROFILES,
  PARTNER_WORKBENCH_SCENARIOS,
  PARTNER_WORKBENCH_SKILL_PACKS,
  PARTNER_WORKBENCH_TASKS,
  buildPartnerWorkbenchPrompt,
  defaultPartnerWorkbenchTargetPath,
  inferPartnerWorkbenchRoute,
  preflightPartnerWorkbench,
  resolvePartnerCodeKnowledgeSkill,
} from '../../renderer/src/features/partner/partnerWorkbench.js';

test('workbench preflight blocks missing project but explains composer-created sessions', () => {
  const blocked = preflightPartnerWorkbench({
    projectRoot: null,
    hasSession: false,
    scenarioId: 'document-processing',
    outputPreferenceId: 'auto',
    userBrief: '整理成一份报告',
    sources: [],
  });

  assert.equal(blocked.canStart, false);
  assert.match(blocked.errors.join('\n'), /before sending a Partner workbench task/);

  const ready = preflightPartnerWorkbench({
    projectRoot: '/repo',
    hasSession: false,
    scenarioId: 'document-processing',
    outputPreferenceId: 'auto',
    sources: [],
  });

  assert.equal(ready.canStart, true);
  assert.match(ready.warnings.join('\n'), /No active Partner session/);
  assert.match(ready.warnings.join('\n'), /Sending from the composer will create one/);
  assert.doesNotMatch(ready.warnings.join('\n'), /Starting this task/);
  assert.match(ready.warnings.join('\n'), /No work goal was entered/);
  assert.match(ready.warnings.join('\n'), /No sources are attached/);
});

test('file proposal targets require safe relative paths with the selected extension', () => {
  const good = preflightPartnerWorkbench({
    projectRoot: '/repo',
    hasSession: true,
    scenarioId: 'document-processing',
    outputPreferenceId: 'file-md',
    targetPath: 'docs/CHANGELOG-draft.md',
    sources: [{ id: 'src_1', path: '/repo/notes.md' }],
  });
  assert.equal(good.canStart, true);

  const wrongExtension = preflightPartnerWorkbench({
    projectRoot: '/repo',
    hasSession: true,
    scenarioId: 'document-processing',
    outputPreferenceId: 'file-md',
    targetPath: 'docs/CHANGELOG-draft.txt',
    sources: [{ id: 'src_1', path: '/repo/notes.md' }],
  });
  assert.equal(wrongExtension.canStart, false);
  assert.match(wrongExtension.errors.join('\n'), /\.md/);

  const absolute = preflightPartnerWorkbench({
    projectRoot: '/repo',
    hasSession: true,
    scenarioId: 'document-processing',
    outputPreferenceId: 'file-md',
    targetPath: 'C:\\repo\\CHANGELOG.md',
    sources: [{ id: 'src_1', path: '/repo/notes.md' }],
  });
  assert.equal(absolute.canStart, false);
  assert.match(absolute.errors.join('\n'), /relative project path/);
});

test('scenario routing starts from work modes instead of exposed skill packs', () => {
  const presentation = inferPartnerWorkbenchRoute({
    projectRoot: '/repo',
    hasSession: true,
    scenarioId: 'presentation',
    outputPreferenceId: 'auto',
    userBrief: '给管理层做一份季度复盘幻灯片',
    sources: [],
  });

  assert.equal(presentation.scenario.id, 'presentation');
  assert.equal(presentation.task.id, 'presentation');
  assert.equal(presentation.skillPack.id, 'presentation-design');
  assert.equal(presentation.output.id, 'pptx');
  assert.match(presentation.targetPath, /presentation\.pptx$/);

  const apiDoc = inferPartnerWorkbenchRoute({
    projectRoot: '/repo',
    hasSession: true,
    scenarioId: 'document-processing',
    outputPreferenceId: 'auto',
    userBrief: '请根据代码写 API 文档，导出 docx',
    sources: [],
  });

  assert.equal(apiDoc.task.id, 'api-doc');
  assert.equal(apiDoc.skillPack.id, 'api-documentation');
  assert.equal(apiDoc.output.id, 'docx');
});

test('auto output prompt keeps deliverables format-open by default', () => {
  const prompt = buildPartnerWorkbenchPrompt({
    projectRoot: '/repo',
    hasSession: true,
    scenarioId: 'deep-research',
    outputPreferenceId: 'auto',
    userBrief: '研究这个行业机会，整理结论和证据',
    sources: [{ id: 'src_1', path: '/repo/brief.md' }],
  });

  assert.match(prompt, /Partner workbench mode: deep-research/);
  assert.match(prompt, /User goal\n研究这个行业机会/);
  assert.match(prompt, /Scenario capability profile/);
  assert.match(prompt, /Capability: Build research plans/);
  assert.match(prompt, /Output preference: Auto/);
  assert.match(prompt, /Choose the concrete deliverable shape/);
  assert.match(prompt, /Do not limit the result to preset document formats/);
  assert.match(prompt, /write_partner_deliverable/);
  assert.match(prompt, /run_partner_helper/);
  assert.match(prompt, /reuse that link in the final response/);
  assert.match(prompt, /Do not present a bare run-output path/);
  assert.match(prompt, /partner-output\/research-memo/);
  assert.doesNotMatch(prompt, /Create a workspace-visible md deliverable/);
});

test('office output override prompt prefers run workspace with office writer as convenience path', () => {
  const prompt = buildPartnerWorkbenchPrompt({
    projectRoot: '/repo',
    hasSession: true,
    scenarioId: 'product-management',
    outputPreferenceId: 'docx',
    userBrief: '把需求整理成 PRD',
    sources: [{ id: 'src_1', path: '/repo/docs/input.md', label: 'input.md' }],
  });

  assert.match(
    prompt,
    /Internal route: task=prd; capability=product-requirement-breakdown; output=docx/,
  );
  assert.match(prompt, /write_partner_deliverable/);
  assert.match(prompt, /Writing small helper tools, scripts, generated apps/);
  assert.match(prompt, /run_partner_helper/);
  assert.match(prompt, /create_office_artifact/);
  assert.match(prompt, /Outputs browser/);
  assert.match(prompt, /src_1: \/repo\/docs\/input\.md/);
  assert.match(prompt, /partner_source_read/);
  assert.match(prompt, /Selected skill: extract-requirements/);
  assert.match(prompt, /Cite source ids or paths/);
  assert.doesNotMatch(prompt, /create_file_proposal/);
});

test('workspace file output prompt prefers checkpointed writes with reviewed fallback', () => {
  const prompt = buildPartnerWorkbenchPrompt({
    projectRoot: '/repo',
    hasSession: true,
    scenarioId: 'document-processing',
    outputPreferenceId: 'file-md',
    targetPath: 'docs/CHANGELOG-draft.md',
    userBrief: '基于提交记录写更新日志 markdown',
    sources: [{ id: 'src_1', path: '/repo/commits.txt' }],
  });

  assert.match(prompt, /Internal route: task=changelog; capability=release-notes; output=file-md/);
  assert.match(prompt, /write_partner_workspace_file/);
  assert.match(prompt, /create_file_proposal/);
  assert.match(prompt, /checkpoint/);
  assert.match(prompt, /docs\/CHANGELOG-draft\.md/);
  assert.match(prompt, /Do not use raw write, edit, multi_edit, bash, shell/);
  assert.doesNotMatch(prompt, /Create a final docx deliverable/);
});

test('default output path follows routed task stem and selected output mode', () => {
  assert.equal(
    defaultPartnerWorkbenchTargetPath('document-processing', 'run-workspace'),
    'partner-output/partner-document',
  );
  assert.equal(
    defaultPartnerWorkbenchTargetPath('presentation', 'pptx'),
    'partner-output/presentation.pptx',
  );
  assert.equal(
    defaultPartnerWorkbenchTargetPath('pr-description', 'file-md'),
    'partner-output/pr-description.md',
  );
  assert.equal(
    defaultPartnerWorkbenchTargetPath('api-doc', 'docx'),
    'partner-output/api-documentation.docx',
  );
  assert.ok(PARTNER_WORKBENCH_SCENARIOS.some((scenario) => scenario.id === 'data-analysis'));
  assert.ok(PARTNER_WORKBENCH_OUTPUT_PREFERENCES.some((output) => output.id === 'auto'));
});

test('every visible work mode has a real capability profile behind it', () => {
  for (const scenario of PARTNER_WORKBENCH_SCENARIOS) {
    const profile = PARTNER_WORKBENCH_SCENARIO_PROFILES[scenario.id];
    assert.ok(profile.focus.length > 0, `${scenario.id} focus`);
    assert.ok(profile.capabilities.length >= 3, `${scenario.id} capabilities`);
    assert.ok(profile.deliverables.length >= 1, `${scenario.id} deliverables`);
    assert.ok(profile.toolStrategy.length >= 1, `${scenario.id} tool strategy`);
    assert.ok(profile.completionBar.length >= 1, `${scenario.id} completion bar`);
  }
});

test('code knowledge pack exposes first-run skill routes for Partner workbench tasks', () => {
  const ids = new Set(PARTNER_CODE_KNOWLEDGE_SKILLS.map((skill) => skill.id));
  assert.ok(ids.has('draft-architecture-doc'));
  assert.ok(ids.has('draft-api-doc'));
  assert.ok(ids.has('draft-pr-description'));
  assert.ok(ids.has('summarize-review'));
  assert.ok(ids.has('extract-requirements'));
  assert.ok(PARTNER_WORKBENCH_TASKS.some((task) => task.id === 'api-doc'));
  assert.ok(PARTNER_WORKBENCH_TASKS.some((task) => task.id === 'requirements-breakdown'));
  assert.ok(PARTNER_WORKBENCH_SKILL_PACKS.some((pack) => pack.id === 'api-documentation'));
  assert.ok(
    PARTNER_CODE_KNOWLEDGE_SKILLS.every((skill) => skill.outputKinds.includes('run-workspace')),
  );
  assert.equal(
    resolvePartnerCodeKnowledgeSkill('api-doc', 'api-documentation')?.id,
    'draft-api-doc',
  );
  assert.equal(
    resolvePartnerCodeKnowledgeSkill('requirements-breakdown', 'product-requirement-breakdown')?.id,
    'extract-requirements',
  );
});

test('code knowledge prompt steers repo-intelligence work without raw mutation tools', () => {
  const prompt = buildPartnerWorkbenchPrompt({
    projectRoot: '/repo',
    hasSession: true,
    scenarioId: 'document-processing',
    outputPreferenceId: 'docx',
    userBrief: '根据 packages/schema/src/index.ts 写 API 文档',
    sources: [{ id: 'src_api', path: '/repo/packages/schema/src/index.ts' }],
  });

  assert.match(prompt, /Internal route: task=api-doc; capability=api-documentation; output=docx/);
  assert.match(prompt, /Selected skill: draft-api-doc/);
  assert.match(prompt, /read, grep, glob/);
  assert.match(prompt, /Repointel\/repo-intelligence overview or impact/);
  assert.match(prompt, /concrete file paths, symbols, diffs, KB pages, or Partner source ids/);
  assert.match(prompt, /write_partner_deliverable/);
  assert.match(prompt, /create_office_artifact/);
  assert.match(prompt, /Do not use raw write, edit, multi_edit, bash, shell/);
  assert.doesNotMatch(prompt, /Create a reviewed workspace file proposal/);
});
