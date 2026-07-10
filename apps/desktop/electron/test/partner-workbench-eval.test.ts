import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPartnerWorkbenchPrompt,
  inferPartnerWorkbenchRoute,
  type PartnerWorkbenchOutputId,
  type PartnerWorkbenchScenarioId,
  type PartnerWorkbenchSkillPackId,
  type PartnerWorkbenchTaskId,
} from '../../renderer/src/features/partner/partnerWorkbench.js';

interface WorkbenchStrategyEvalCase {
  readonly name: string;
  readonly scenarioId: PartnerWorkbenchScenarioId;
  readonly userBrief: string;
  readonly expectedTaskId: PartnerWorkbenchTaskId;
  readonly expectedSkillPackId: PartnerWorkbenchSkillPackId;
  readonly expectedOutputId: PartnerWorkbenchOutputId;
  readonly strategySignals: readonly RegExp[];
}

interface WorkbenchUxEvalCase {
  readonly name: string;
  readonly scenarioId: PartnerWorkbenchScenarioId;
  readonly userBrief: string;
  readonly expectedTaskId: PartnerWorkbenchTaskId;
  readonly expectedSkillPackId: PartnerWorkbenchSkillPackId;
  readonly expectedOutputId: PartnerWorkbenchOutputId;
  readonly expectedReason?: RegExp;
  readonly promptSignals?: readonly RegExp[];
  readonly promptAntiSignals?: readonly RegExp[];
}

const GENERIC_STRATEGY_SIGNALS: readonly RegExp[] = [
  /Scenario capability profile/,
  /- Focus:/,
  /- Capability:/,
  /- Deliverable:/,
  /- Tool strategy:/,
  /- Completion bar:/,
  /Capability guidance/,
  /Output handling/,
  /Tool boundary/,
  /Do not limit the result to preset document formats/,
  /Writing small helper tools, scripts, generated apps, validators, renderers, converters, or packagers is allowed/,
  /Do not use raw write, edit, multi_edit, bash, shell, or unrestricted filesystem mutation/,
  /write_partner_deliverable/,
  /run_partner_helper/,
  /partner_source_read/,
  /Cite source ids or paths/,
];

const STRATEGY_EVAL_CASES: readonly WorkbenchStrategyEvalCase[] = [
  {
    name: 'document processing turns source bundles into open-form reports',
    scenarioId: 'document-processing',
    userBrief: 'Please convert the attached source bundle into a source-backed report in docx.',
    expectedTaskId: 'document-processing',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'docx',
    strategySignals: [
      /Capability: Extract, summarize, compare, rewrite/,
      /Deliverable: Markdown or rich text drafts, DOCX\/PDF artifacts/,
      /Tool strategy: Read attached Partner sources first/,
    ],
  },
  {
    name: 'finance separates evidence, assumptions, and workbook-style analysis',
    scenarioId: 'finance',
    userBrief: 'Build a financial analysis with valuation scenarios and export an xlsx workbook.',
    expectedTaskId: 'financial-analysis',
    expectedSkillPackId: 'financial-analysis',
    expectedOutputId: 'xlsx',
    strategySignals: [
      /Capability: Collect and compare market\/company evidence/,
      /Separate raw financial facts, calculations, assumptions, and interpretation/,
      /Tool strategy: Use source reads, web\/research tools when available, spreadsheet artifacts/,
    ],
  },
  {
    name: 'data analysis favors profiling, charts, and reproducible helper work',
    scenarioId: 'data-analysis',
    userBrief:
      'Analyze the data dashboard metrics, find missing values and trends, and export charts as xlsx.',
    expectedTaskId: 'data-analysis',
    expectedSkillPackId: 'data-analysis',
    expectedOutputId: 'xlsx',
    strategySignals: [
      /Capability: Profile schemas, missing values, outliers/,
      /Produce the analysis, visualizations, tables, and explanation/,
      /Tool strategy: Use bounded helper execution for transformations and chart generation/,
    ],
  },
  {
    name: 'deep research pushes evidence matrices and calibrated synthesis',
    scenarioId: 'deep-research',
    userBrief:
      'Deep research the competitor landscape with an evidence matrix, citations, and confidence levels.',
    expectedTaskId: 'research-memo',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
    strategySignals: [
      /Capability: Build research plans, source maps, evidence matrices/,
      /Keep citations close to claims and list source gaps plainly/,
      /Completion bar: The answer is not merely long/,
    ],
  },
  {
    name: 'product management produces PRD-quality handoff material',
    scenarioId: 'product-management',
    userBrief:
      'Write a PRD for enterprise onboarding with goals, risks, metrics, and rollout notes.',
    expectedTaskId: 'prd',
    expectedSkillPackId: 'product-requirement-breakdown',
    expectedOutputId: 'run-workspace',
    strategySignals: [
      /Capability: Draft PRDs, requirement breakdowns, user stories/,
      /Break the request into goals, users, constraints, non-goals/,
      /ready for product review or implementation handoff/,
    ],
  },
  {
    name: 'presentation mode defaults to deck narrative and pptx delivery when asked',
    scenarioId: 'presentation',
    userBrief: 'Create a leadership deck in pptx for the quarterly business review.',
    expectedTaskId: 'presentation',
    expectedSkillPackId: 'presentation-design',
    expectedOutputId: 'pptx',
    strategySignals: [
      /Capability: Build storylines, slide outlines, executive narratives/,
      /Create a presentation narrative with audience, storyline, slide structure/,
      /If pptx is the best primary artifact/,
    ],
  },
  {
    name: 'design mode can create lightweight prototypes without becoming full coding work',
    scenarioId: 'design',
    userBrief: 'Create a design brief and lightweight HTML prototype for this onboarding screen.',
    expectedTaskId: 'design-brief',
    expectedSkillPackId: 'design-brief',
    expectedOutputId: 'run-workspace',
    strategySignals: [
      /Capability: Create design briefs, UX critiques, content hierarchy/,
      /Generate lightweight HTML prototypes, copy blocks, asset lists/,
      /When the request becomes a full app build, branch\/large code edit/,
    ],
  },
  {
    name: 'email editing keeps communication output send-ready',
    scenarioId: 'email-editing',
    userBrief: 'Draft an email announcement for customers about the pricing migration.',
    expectedTaskId: 'email-draft',
    expectedSkillPackId: 'communication-drafting',
    expectedOutputId: 'run-workspace',
    strategySignals: [
      /Capability: Draft, rewrite, tighten, translate/,
      /Draft concise communication with audience, goal, tone/,
      /The user can send, review, or lightly personalize the communication immediately/,
    ],
  },
  {
    name: 'Chinese deep-research brief routes to research memo',
    scenarioId: 'deep-research',
    userBrief: '请做行业调研，对竞品格局做深度研究，并给出证据表。',
    expectedTaskId: 'research-memo',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
    strategySignals: [/Partner workbench mode: deep-research/, /evidence matrices/],
  },
  {
    name: 'Chinese presentation brief routes to pptx',
    scenarioId: 'presentation',
    userBrief: '把这些材料整理成管理层演示文稿 pptx。',
    expectedTaskId: 'presentation',
    expectedSkillPackId: 'presentation-design',
    expectedOutputId: 'pptx',
    strategySignals: [/Partner workbench mode: presentation/, /output=auto -> pptx/],
  },
  {
    name: 'Chinese data-analysis brief routes to spreadsheet output',
    scenarioId: 'data-analysis',
    userBrief: '请做数据分析和可视化，输出电子表格。',
    expectedTaskId: 'data-analysis',
    expectedSkillPackId: 'data-analysis',
    expectedOutputId: 'xlsx',
    strategySignals: [/Partner workbench mode: data-analysis/, /output=auto -> xlsx/],
  },
];

const MODE_DEFAULT_UX_EVAL_CASES: readonly WorkbenchUxEvalCase[] = [
  {
    name: 'document mode can start from a broad document request',
    scenarioId: 'document-processing',
    userBrief: 'Please organize these materials into something usable.',
    expectedTaskId: 'document-processing',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
    expectedReason: /default task: document-processing/,
  },
  {
    name: 'finance mode defaults to financial analysis without forcing format choices',
    scenarioId: 'finance',
    userBrief: 'Help me analyze this company and prepare decision notes.',
    expectedTaskId: 'financial-analysis',
    expectedSkillPackId: 'financial-analysis',
    expectedOutputId: 'run-workspace',
    expectedReason: /default task: financial-analysis/,
  },
  {
    name: 'data mode defaults to analysis when the user only names the dataset',
    scenarioId: 'data-analysis',
    userBrief: 'Use the uploaded survey export and tell me what matters.',
    expectedTaskId: 'data-analysis',
    expectedSkillPackId: 'data-analysis',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: data-analysis/,
  },
  {
    name: 'research mode defaults to research memo for open questions',
    scenarioId: 'deep-research',
    userBrief: 'Help me understand this market before we decide.',
    expectedTaskId: 'research-memo',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
    expectedReason: /default task: research-memo/,
  },
  {
    name: 'product mode defaults to PRD-style work when the ask is broad',
    scenarioId: 'product-management',
    userBrief: 'Help me turn this idea into a product plan.',
    expectedTaskId: 'prd',
    expectedSkillPackId: 'product-requirement-breakdown',
    expectedOutputId: 'run-workspace',
    expectedReason: /default task: prd/,
  },
  {
    name: 'presentation mode defaults to deck delivery',
    scenarioId: 'presentation',
    userBrief: 'Make this into a leadership narrative.',
    expectedTaskId: 'presentation',
    expectedSkillPackId: 'presentation-design',
    expectedOutputId: 'pptx',
    expectedReason: /default task: presentation/,
  },
  {
    name: 'design mode defaults to design brief work',
    scenarioId: 'design',
    userBrief: 'Help me make this screen clearer.',
    expectedTaskId: 'design-brief',
    expectedSkillPackId: 'design-brief',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: design-brief/,
  },
  {
    name: 'email mode defaults to communication drafting',
    scenarioId: 'email-editing',
    userBrief: 'Help me phrase this clearly for customers.',
    expectedTaskId: 'email-draft',
    expectedSkillPackId: 'communication-drafting',
    expectedOutputId: 'run-workspace',
    expectedReason: /default task: email-draft/,
  },
];

const NATURAL_LANGUAGE_UX_EVAL_CASES: readonly WorkbenchUxEvalCase[] = [
  {
    name: 'document mode recognizes meeting notes as a meeting summary task',
    scenarioId: 'document-processing',
    userBrief: 'Summarize these meeting notes into decisions, action items, and follow-ups.',
    expectedTaskId: 'meeting-summary',
    expectedSkillPackId: 'review-summary',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: meeting-summary/,
  },
  {
    name: 'document mode recognizes Word document as docx output',
    scenarioId: 'document-processing',
    userBrief: 'Rewrite this policy document as a clean Word document.',
    expectedTaskId: 'document-processing',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'docx',
    expectedReason: /brief routed output: docx/,
  },
  {
    name: 'document mode can cross-route to PR description when the query asks for it',
    scenarioId: 'document-processing',
    userBrief: 'Based on the diff, write a PR description with reviewer focus and a test plan.',
    expectedTaskId: 'pr-description',
    expectedSkillPackId: 'pr-description',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: pr-description/,
    promptSignals: [/Selected skill: draft-pr-description/],
  },
  {
    name: 'finance mode recognizes English valuation language',
    scenarioId: 'finance',
    userBrief: 'Build a valuation sensitivity analysis for Acme and export an Excel workbook.',
    expectedTaskId: 'financial-analysis',
    expectedSkillPackId: 'financial-analysis',
    expectedOutputId: 'xlsx',
    expectedReason: /brief routed output: xlsx/,
  },
  {
    name: 'finance mode keeps investment memo as finance rather than generic memo',
    scenarioId: 'finance',
    userBrief: 'Create an investment memo with assumptions, risks, scenarios, and a PDF summary.',
    expectedTaskId: 'financial-analysis',
    expectedSkillPackId: 'financial-analysis',
    expectedOutputId: 'pdf',
    expectedReason: /brief routed output: pdf/,
  },
  {
    name: 'data mode recognizes csv, cohorts, and charts as analysis work',
    scenarioId: 'data-analysis',
    userBrief:
      'Clean this CSV, compute retention cohorts, and create charts plus a data dictionary.',
    expectedTaskId: 'data-analysis',
    expectedSkillPackId: 'data-analysis',
    expectedOutputId: 'run-workspace',
    promptSignals: [/Choose the concrete deliverable shape/, /data files/],
  },
  {
    name: 'data mode recognizes pivot workbook as spreadsheet output',
    scenarioId: 'data-analysis',
    userBrief: 'Make an Excel pivot workbook from these survey responses.',
    expectedTaskId: 'data-analysis',
    expectedSkillPackId: 'data-analysis',
    expectedOutputId: 'xlsx',
    expectedReason: /brief routed output: xlsx/,
  },
  {
    name: 'data mode keeps HTML dashboard as open workspace output',
    scenarioId: 'data-analysis',
    userBrief: 'Create an HTML dashboard with metric charts from these logs.',
    expectedTaskId: 'data-analysis',
    expectedSkillPackId: 'data-analysis',
    expectedOutputId: 'run-workspace',
    promptSignals: [/HTML/, /charts/],
  },
  {
    name: 'research mode recognizes competitor landscape language',
    scenarioId: 'deep-research',
    userBrief: 'Map the competitor landscape, cite sources, and identify open questions.',
    expectedTaskId: 'research-memo',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: research-memo/,
  },
  {
    name: 'research mode recognizes market map language without literal research word',
    scenarioId: 'deep-research',
    userBrief: 'Build a market map for AI note-taking tools with source-backed claims.',
    expectedTaskId: 'research-memo',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
    promptSignals: [/source maps/, /confidence/],
  },
  {
    name: 'product mode recognizes user stories and acceptance criteria',
    scenarioId: 'product-management',
    userBrief: 'Turn these notes into user stories, acceptance criteria, risks, and non-goals.',
    expectedTaskId: 'requirements-breakdown',
    expectedSkillPackId: 'product-requirement-breakdown',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: requirements-breakdown/,
  },
  {
    name: 'product mode recognizes roadmap and launch plan as product work',
    scenarioId: 'product-management',
    userBrief: 'Build a launch roadmap with milestones, stakeholders, and rollout risks.',
    expectedTaskId: 'prd',
    expectedSkillPackId: 'product-requirement-breakdown',
    expectedOutputId: 'run-workspace',
    promptSignals: [/roadmaps/, /rollout strategy/],
  },
  {
    name: 'presentation mode recognizes training slides',
    scenarioId: 'presentation',
    userBrief: 'Make customer training slides with speaker notes.',
    expectedTaskId: 'presentation',
    expectedSkillPackId: 'presentation-design',
    expectedOutputId: 'pptx',
    expectedReason: /brief routed output: pptx/,
  },
  {
    name: 'presentation mode recognizes PowerPoint wording',
    scenarioId: 'presentation',
    userBrief: 'Create a PowerPoint for the sales kickoff.',
    expectedTaskId: 'presentation',
    expectedSkillPackId: 'presentation-design',
    expectedOutputId: 'pptx',
    expectedReason: /brief routed output: pptx/,
  },
  {
    name: 'design mode recognizes UX audit and annotated report',
    scenarioId: 'design',
    userBrief: 'UX audit this checkout flow and produce an annotated report.',
    expectedTaskId: 'design-brief',
    expectedSkillPackId: 'design-brief',
    expectedOutputId: 'run-workspace',
    promptSignals: [/UX critiques/, /annotated screenshots/],
    promptAntiSignals: [/Selected skill: summarize-review/],
  },
  {
    name: 'design mode recognizes wireframe and mockup language',
    scenarioId: 'design',
    userBrief: 'Wireframe a mobile onboarding screen and make a lightweight HTML mockup.',
    expectedTaskId: 'design-brief',
    expectedSkillPackId: 'design-brief',
    expectedOutputId: 'run-workspace',
    promptSignals: [/HTML prototypes/, /interaction intent/],
  },
  {
    name: 'email mode recognizes follow-up and approval ask',
    scenarioId: 'email-editing',
    userBrief: 'Write a concise follow-up asking for approval by Friday.',
    expectedTaskId: 'email-draft',
    expectedSkillPackId: 'communication-drafting',
    expectedOutputId: 'run-workspace',
    promptSignals: [/key asks/, /next actions/],
  },
  {
    name: 'email mode recognizes newsletter language',
    scenarioId: 'email-editing',
    userBrief: 'Draft a customer newsletter about the pricing migration.',
    expectedTaskId: 'email-draft',
    expectedSkillPackId: 'communication-drafting',
    expectedOutputId: 'run-workspace',
    promptSignals: [/audience, goal, tone/],
  },
  {
    name: 'Chinese document request recognizes meeting summary',
    scenarioId: 'document-processing',
    userBrief: '把会议记录整理成会议纪要，列出决议和待办。',
    expectedTaskId: 'meeting-summary',
    expectedSkillPackId: 'review-summary',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: meeting-summary/,
  },
  {
    name: 'Chinese finance request recognizes investment research',
    scenarioId: 'finance',
    userBrief: '做一份投研备忘录，包含估值假设、风险和情景表，导出 PDF。',
    expectedTaskId: 'financial-analysis',
    expectedSkillPackId: 'financial-analysis',
    expectedOutputId: 'pdf',
    expectedReason: /brief routed output: pdf/,
  },
  {
    name: 'Chinese product request recognizes requirement breakdown',
    scenarioId: 'product-management',
    userBrief: '把这些需求拆解成用户故事、验收标准、风险和开放问题。',
    expectedTaskId: 'requirements-breakdown',
    expectedSkillPackId: 'product-requirement-breakdown',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: requirements-breakdown/,
  },
  {
    name: 'Chinese design request recognizes prototype work',
    scenarioId: 'design',
    userBrief: '做一个移动端注册流程的交互原型和设计说明。',
    expectedTaskId: 'design-brief',
    expectedSkillPackId: 'design-brief',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: design-brief/,
  },
  {
    name: 'Chinese email request recognizes announcement drafting',
    scenarioId: 'email-editing',
    userBrief: '写一封客户通知邮件，说明价格迁移和下一步动作。',
    expectedTaskId: 'email-draft',
    expectedSkillPackId: 'communication-drafting',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: email-draft/,
  },
];

const REGRESSION_UX_EVAL_CASES: readonly WorkbenchUxEvalCase[] = [
  {
    name: 'quarterly business review deck is a presentation, not a review brief',
    scenarioId: 'presentation',
    userBrief: 'Create a leadership deck in pptx for the quarterly business review.',
    expectedTaskId: 'presentation',
    expectedSkillPackId: 'presentation-design',
    expectedOutputId: 'pptx',
    promptAntiSignals: [/Selected skill: summarize-review/],
  },
  {
    name: 'design review wording does not steal design mode into review-summary',
    scenarioId: 'design',
    userBrief: 'Do a design review of this onboarding flow and propose a better hierarchy.',
    expectedTaskId: 'design-brief',
    expectedSkillPackId: 'design-brief',
    expectedOutputId: 'run-workspace',
    promptAntiSignals: [/Selected skill: summarize-review/],
  },
  {
    name: 'customer review dashboard remains data work',
    scenarioId: 'data-analysis',
    userBrief: 'Analyze customer review scores and build a trend dashboard.',
    expectedTaskId: 'data-analysis',
    expectedSkillPackId: 'data-analysis',
    expectedOutputId: 'run-workspace',
    promptAntiSignals: [/Selected skill: summarize-review/],
  },
  {
    name: 'PRD is product work and not PR description',
    scenarioId: 'product-management',
    userBrief: 'Create a PRD for onboarding metrics and rollout.',
    expectedTaskId: 'prd',
    expectedSkillPackId: 'product-requirement-breakdown',
    expectedOutputId: 'run-workspace',
    promptAntiSignals: [/Selected skill: draft-pr-description/],
  },
  {
    name: 'arbitrary deliverable requests stay open instead of being forced into Office formats',
    scenarioId: 'deep-research',
    userBrief: 'Deliver a folder with notes, CSV evidence table, and a small HTML index.',
    expectedTaskId: 'research-memo',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
    promptSignals: [/documents, slides, spreadsheets, charts, HTML, images, data files, folders/],
    promptAntiSignals: [/Create a final docx deliverable/, /Create a final pdf deliverable/],
  },
];

const ADVERSARIAL_WORK_MODE_UX_EVAL_CASES: readonly WorkbenchUxEvalCase[] = [
  {
    name: 'announcement deck remains presentation work instead of email drafting',
    scenarioId: 'presentation',
    userBrief: 'Build a launch announcement deck with speaker notes for the sales kickoff.',
    expectedTaskId: 'presentation',
    expectedSkillPackId: 'presentation-design',
    expectedOutputId: 'pptx',
    expectedReason: /brief routed task: presentation/,
    promptSignals: [/presentation narrative/, /speaker intent/],
  },
  {
    name: 'announcement email remains communication work when no deck is requested',
    scenarioId: 'email-editing',
    userBrief: 'Draft a launch announcement email with subject lines and two tone variants.',
    expectedTaskId: 'email-draft',
    expectedSkillPackId: 'communication-drafting',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: email-draft/,
    promptSignals: [/audience, goal, tone/, /variants/],
  },
  {
    name: 'dashboard UI critique remains design work instead of data analysis',
    scenarioId: 'design',
    userBrief: 'Review this analytics dashboard UI for accessibility and information architecture.',
    expectedTaskId: 'design-brief',
    expectedSkillPackId: 'design-brief',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: design-brief/,
    promptSignals: [/accessibility/, /information architecture/],
  },
  {
    name: 'dashboard data analysis can explicitly exclude UI review',
    scenarioId: 'data-analysis',
    userBrief: 'Analyze the product usage dashboard data, not the UI, and produce segment charts.',
    expectedTaskId: 'data-analysis',
    expectedSkillPackId: 'data-analysis',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: data-analysis/,
    promptSignals: [/charts/, /data files/],
  },
  {
    name: 'HTML slide deck stays open workspace instead of being forced to pptx',
    scenarioId: 'presentation',
    userBrief: 'Create an HTML slide deck with speaker notes and reusable image assets.',
    expectedTaskId: 'presentation',
    expectedSkillPackId: 'presentation-design',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed output: run-workspace/,
    promptSignals: [/documents, slides, spreadsheets, charts, HTML, images, data files, folders/],
    promptAntiSignals: [/Create a final pptx deliverable/],
  },
  {
    name: 'multi-file report bundle stays open workspace instead of markdown single-file output',
    scenarioId: 'document-processing',
    userBrief: 'Deliver a folder with a Markdown report, CSV appendix, and HTML index.',
    expectedTaskId: 'document-processing',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed output: run-workspace/,
    promptSignals: [/documents, slides, spreadsheets, charts, HTML, images, data files, folders/],
    promptAntiSignals: [/Create a workspace-visible md deliverable/],
  },
];

const REALISTIC_QUERY_CORPUS_EVAL_CASES: readonly WorkbenchUxEvalCase[] = [
  {
    name: 'document request turns mixed material into an executive report workspace',
    scenarioId: 'document-processing',
    userBrief: 'Organize these notes, links, and screenshots into a report my manager can read.',
    expectedTaskId: 'document-processing',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
  },
  {
    name: 'document request recognizes API examples as API documentation',
    scenarioId: 'document-processing',
    userBrief: 'Turn these API usage examples into developer documentation.',
    expectedTaskId: 'api-doc',
    expectedSkillPackId: 'api-documentation',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: api-doc/,
  },
  {
    name: 'document request recognizes changelog and markdown output',
    scenarioId: 'document-processing',
    userBrief: 'Write a release changelog from these commits and export it as Markdown.',
    expectedTaskId: 'changelog',
    expectedSkillPackId: 'release-notes',
    expectedOutputId: 'file-md',
    expectedReason: /brief routed output: file-md/,
  },
  {
    name: 'document request recognizes transcript decisions as meeting summary',
    scenarioId: 'document-processing',
    userBrief: 'Turn this transcript into decisions, owners, and follow-up actions.',
    expectedTaskId: 'meeting-summary',
    expectedSkillPackId: 'review-summary',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: meeting-summary/,
  },
  {
    name: 'finance request can start from investment decision wording',
    scenarioId: 'finance',
    userBrief:
      'Help me decide whether this company is investable and list key assumptions and risks.',
    expectedTaskId: 'financial-analysis',
    expectedSkillPackId: 'financial-analysis',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: financial-analysis/,
  },
  {
    name: 'finance request recognizes public comps and revenue model',
    scenarioId: 'finance',
    userBrief: 'Build a public comps table and revenue model for the target.',
    expectedTaskId: 'financial-analysis',
    expectedSkillPackId: 'financial-analysis',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: financial-analysis/,
  },
  {
    name: 'finance request recognizes market sizing workbook',
    scenarioId: 'finance',
    userBrief: 'Create a TAM/SAM/SOM market sizing model and give me an xlsx workbook.',
    expectedTaskId: 'financial-analysis',
    expectedSkillPackId: 'financial-analysis',
    expectedOutputId: 'xlsx',
    expectedReason: /brief routed output: xlsx/,
  },
  {
    name: 'finance request keeps P&L unit economics board memo as finance',
    scenarioId: 'finance',
    userBrief: 'Summarize the P&L and unit economics into a board memo.',
    expectedTaskId: 'financial-analysis',
    expectedSkillPackId: 'financial-analysis',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: financial-analysis/,
  },
  {
    name: 'data request recognizes CSV anomaly scan',
    scenarioId: 'data-analysis',
    userBrief: 'Look at this CSV for anomalies and give me a cleaned file if needed.',
    expectedTaskId: 'data-analysis',
    expectedSkillPackId: 'data-analysis',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: data-analysis/,
  },
  {
    name: 'data request recognizes funnel analysis',
    scenarioId: 'data-analysis',
    userBrief: 'Run funnel analysis on signup logs and show conversion drop-offs.',
    expectedTaskId: 'data-analysis',
    expectedSkillPackId: 'data-analysis',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: data-analysis/,
  },
  {
    name: 'data request recognizes retention cohort charting',
    scenarioId: 'data-analysis',
    userBrief: 'Make a retention cohort table and chart from the event export.',
    expectedTaskId: 'data-analysis',
    expectedSkillPackId: 'data-analysis',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: data-analysis/,
  },
  {
    name: 'data request keeps dashboard as open workspace output',
    scenarioId: 'data-analysis',
    userBrief: 'Turn these survey results into a small dashboard and explain the segments.',
    expectedTaskId: 'data-analysis',
    expectedSkillPackId: 'data-analysis',
    expectedOutputId: 'run-workspace',
    promptSignals: [/charts/, /data files/],
  },
  {
    name: 'research request can start from trend scouting',
    scenarioId: 'deep-research',
    userBrief: 'Research recent trends in this category and include source confidence.',
    expectedTaskId: 'research-memo',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: research-memo/,
  },
  {
    name: 'research request supports vendor shortlist',
    scenarioId: 'deep-research',
    userBrief: 'Build a vendor shortlist with pros, cons, pricing signals, and citations.',
    expectedTaskId: 'research-memo',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
    promptSignals: [/source maps/, /source gaps/],
  },
  {
    name: 'research request recognizes competitive landscape',
    scenarioId: 'deep-research',
    userBrief:
      'Do a competitive landscape for this category and separate primary evidence from commentary.',
    expectedTaskId: 'research-memo',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: research-memo/,
  },
  {
    name: 'research request keeps bibliography and gaps as research work',
    scenarioId: 'deep-research',
    userBrief: 'Find the source bibliography for this topic and summarize evidence gaps.',
    expectedTaskId: 'research-memo',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
    promptSignals: [/evidence matrices/, /confidence/],
  },
  {
    name: 'product request recognizes MVP and launch plan',
    scenarioId: 'product-management',
    userBrief: 'Turn this idea into MVP scope, non-goals, metrics, and a launch plan.',
    expectedTaskId: 'prd',
    expectedSkillPackId: 'product-requirement-breakdown',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: prd/,
  },
  {
    name: 'product request recognizes RFC even when product mode is selected',
    scenarioId: 'product-management',
    userBrief: 'Write an RFC for the versioning decision.',
    expectedTaskId: 'rfc',
    expectedSkillPackId: 'architecture-doc',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: rfc/,
  },
  {
    name: 'product request recognizes support tickets into acceptance criteria',
    scenarioId: 'product-management',
    userBrief: 'Turn support tickets into requirements and acceptance criteria.',
    expectedTaskId: 'requirements-breakdown',
    expectedSkillPackId: 'product-requirement-breakdown',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: requirements-breakdown/,
  },
  {
    name: 'product request recognizes roadmap planning',
    scenarioId: 'product-management',
    userBrief: 'Create a roadmap broken down by milestones, dependencies, and risk.',
    expectedTaskId: 'prd',
    expectedSkillPackId: 'product-requirement-breakdown',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: prd/,
  },
  {
    name: 'presentation request recognizes investor pitch deck',
    scenarioId: 'presentation',
    userBrief: 'Make an investor pitch deck with speaker notes.',
    expectedTaskId: 'presentation',
    expectedSkillPackId: 'presentation-design',
    expectedOutputId: 'pptx',
    expectedReason: /brief routed output: pptx/,
  },
  {
    name: 'presentation request recognizes one-page slide',
    scenarioId: 'presentation',
    userBrief: 'Create a one-page executive summary slide.',
    expectedTaskId: 'presentation',
    expectedSkillPackId: 'presentation-design',
    expectedOutputId: 'pptx',
    expectedReason: /brief routed output: pptx/,
  },
  {
    name: 'presentation request recognizes customer training PPT',
    scenarioId: 'presentation',
    userBrief: 'Turn the research findings into a customer training PPT.',
    expectedTaskId: 'presentation',
    expectedSkillPackId: 'presentation-design',
    expectedOutputId: 'pptx',
    expectedReason: /brief routed output: pptx/,
  },
  {
    name: 'presentation request recognizes existing deck speaker notes',
    scenarioId: 'presentation',
    userBrief: 'Make speaker notes for the existing deck.',
    expectedTaskId: 'presentation',
    expectedSkillPackId: 'presentation-design',
    expectedOutputId: 'pptx',
    expectedReason: /brief routed output: pptx/,
  },
  {
    name: 'design request can start from screenshot usability critique',
    scenarioId: 'design',
    userBrief: 'Look at this screenshot and tell me where the screen is hard to use.',
    expectedTaskId: 'design-brief',
    expectedSkillPackId: 'design-brief',
    expectedOutputId: 'run-workspace',
  },
  {
    name: 'design request recognizes information architecture',
    scenarioId: 'design',
    userBrief: 'Review the information architecture and visual direction for this workflow.',
    expectedTaskId: 'design-brief',
    expectedSkillPackId: 'design-brief',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: design-brief/,
  },
  {
    name: 'design request recognizes accessibility review',
    scenarioId: 'design',
    userBrief: 'Check accessibility issues in this settings screen and suggest improvements.',
    expectedTaskId: 'design-brief',
    expectedSkillPackId: 'design-brief',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: design-brief/,
  },
  {
    name: 'design request supports multiple visual directions',
    scenarioId: 'design',
    userBrief: 'Create three visual directions and a handoff note.',
    expectedTaskId: 'design-brief',
    expectedSkillPackId: 'design-brief',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: design-brief/,
  },
  {
    name: 'email request recognizes customer reply tone',
    scenarioId: 'email-editing',
    userBrief: 'Help me reply to this customer, polite but firm.',
    expectedTaskId: 'email-draft',
    expectedSkillPackId: 'communication-drafting',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: email-draft/,
  },
  {
    name: 'email request recognizes subject lines and escalation email',
    scenarioId: 'email-editing',
    userBrief: 'Write subject lines and a short escalation email.',
    expectedTaskId: 'email-draft',
    expectedSkillPackId: 'communication-drafting',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: email-draft/,
  },
  {
    name: 'email request recognizes weekly update',
    scenarioId: 'email-editing',
    userBrief: 'Turn this project status into a weekly update for leadership.',
    expectedTaskId: 'email-draft',
    expectedSkillPackId: 'communication-drafting',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: email-draft/,
  },
  {
    name: 'email request recognizes launch announcement variants',
    scenarioId: 'email-editing',
    userBrief: 'Draft a launch announcement with short and long variants.',
    expectedTaskId: 'email-draft',
    expectedSkillPackId: 'communication-drafting',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: email-draft/,
  },
];

const CHINESE_WORK_MODE_EXPERIENCE_EVAL_CASES: readonly WorkbenchUxEvalCase[] = [
  {
    name: 'Chinese document mode keeps broad legal-material work format-open',
    scenarioId: 'document-processing',
    userBrief: '把这份合同和补充材料整理成给法务看的风险清单和修订建议。',
    expectedTaskId: 'document-processing',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
    expectedReason: /default task: document-processing/,
    promptSignals: [/Do not limit the result to preset document formats/],
    promptAntiSignals: [/Create a final docx deliverable/, /Create a final pdf deliverable/],
  },
  {
    name: 'Chinese finance mode recognizes investment analysis without an explicit format',
    scenarioId: 'finance',
    userBrief: '做一份公司投研分析，列出估值假设、风险、情景和数据缺口。',
    expectedTaskId: 'financial-analysis',
    expectedSkillPackId: 'financial-analysis',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: financial-analysis/,
    promptSignals: [/Separate raw financial facts, calculations, assumptions/],
  },
  {
    name: 'Chinese data mode recognizes CSV cleaning and visualization dashboard work',
    scenarioId: 'data-analysis',
    userBrief: '清洗这个 CSV，找异常值和缺失值，做一个可视化看板。',
    expectedTaskId: 'data-analysis',
    expectedSkillPackId: 'data-analysis',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: data-analysis/,
    promptSignals: [/bounded helper execution/, /charts/],
  },
  {
    name: 'Chinese research mode recognizes trend and competitor evidence work',
    scenarioId: 'deep-research',
    userBrief: '调研这个行业最近趋势，做竞品对比、证据表和置信度标注。',
    expectedTaskId: 'research-memo',
    expectedSkillPackId: 'research-memo',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: research-memo/,
    promptSignals: [/evidence matrices/, /confidence/],
  },
  {
    name: 'Chinese product mode recognizes feedback into requirements and acceptance criteria',
    scenarioId: 'product-management',
    userBrief: '把用户反馈拆成需求、验收标准、非目标和发布风险。',
    expectedTaskId: 'requirements-breakdown',
    expectedSkillPackId: 'product-requirement-breakdown',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: requirements-breakdown/,
    promptSignals: [/goals, users, constraints, non-goals/],
  },
  {
    name: 'Chinese presentation mode recognizes management PPT and speaker notes',
    scenarioId: 'presentation',
    userBrief: '把研究结论整理成管理层汇报 PPT，附讲稿。',
    expectedTaskId: 'presentation',
    expectedSkillPackId: 'presentation-design',
    expectedOutputId: 'pptx',
    expectedReason: /brief routed output: pptx/,
    promptSignals: [/presentation narrative/, /speaker intent/],
  },
  {
    name: 'Chinese design mode keeps design review in design instead of generic review brief',
    scenarioId: 'design',
    userBrief: '评审这个设置页的信息架构和可访问性，给出原型改进方向。',
    expectedTaskId: 'design-brief',
    expectedSkillPackId: 'design-brief',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: design-brief/,
    promptSignals: [/accessibility/, /information architecture/],
    promptAntiSignals: [/Selected skill: summarize-review/],
  },
  {
    name: 'Chinese email mode recognizes customer notice and next actions',
    scenarioId: 'email-editing',
    userBrief: '写一封客户通知邮件，说明价格迁移、影响范围和下一步动作。',
    expectedTaskId: 'email-draft',
    expectedSkillPackId: 'communication-drafting',
    expectedOutputId: 'run-workspace',
    expectedReason: /brief routed task: email-draft/,
    promptSignals: [/audience, goal, tone/, /next actions/],
  },
];

function evaluateCase(evalCase: WorkbenchStrategyEvalCase): readonly string[] {
  const route = inferPartnerWorkbenchRoute({
    projectRoot: '/repo',
    hasSession: true,
    scenarioId: evalCase.scenarioId,
    outputPreferenceId: 'auto',
    userBrief: evalCase.userBrief,
    sources: [{ id: 'src_eval', path: '/repo/source.md', label: 'source.md' }],
  });
  const prompt = buildPartnerWorkbenchPrompt({
    projectRoot: '/repo',
    hasSession: true,
    scenarioId: evalCase.scenarioId,
    outputPreferenceId: 'auto',
    userBrief: evalCase.userBrief,
    sources: [{ id: 'src_eval', path: '/repo/source.md', label: 'source.md' }],
  });

  const failures: string[] = [];
  if (route.scenario.id !== evalCase.scenarioId) {
    failures.push(`${evalCase.name}: scenario ${route.scenario.id} !== ${evalCase.scenarioId}`);
  }
  if (route.task.id !== evalCase.expectedTaskId) {
    failures.push(`${evalCase.name}: task ${route.task.id} !== ${evalCase.expectedTaskId}`);
  }
  if (route.skillPack.id !== evalCase.expectedSkillPackId) {
    failures.push(
      `${evalCase.name}: skill pack ${route.skillPack.id} !== ${evalCase.expectedSkillPackId}`,
    );
  }
  if (route.output.id !== evalCase.expectedOutputId) {
    failures.push(`${evalCase.name}: output ${route.output.id} !== ${evalCase.expectedOutputId}`);
  }

  for (const signal of [...GENERIC_STRATEGY_SIGNALS, ...evalCase.strategySignals]) {
    if (!signal.test(prompt)) {
      failures.push(`${evalCase.name}: missing prompt signal ${signal}`);
    }
  }

  return failures;
}

function evaluateUxCase(evalCase: WorkbenchUxEvalCase): readonly string[] {
  const config = {
    projectRoot: '/repo',
    hasSession: true,
    scenarioId: evalCase.scenarioId,
    outputPreferenceId: 'auto' as const,
    userBrief: evalCase.userBrief,
    sources: [{ id: 'src_eval', path: '/repo/source.md', label: 'source.md' }],
  };
  const route = inferPartnerWorkbenchRoute(config);
  const prompt = buildPartnerWorkbenchPrompt(config);
  const failures: string[] = [];

  if (route.scenario.id !== evalCase.scenarioId) {
    failures.push(`${evalCase.name}: scenario ${route.scenario.id} !== ${evalCase.scenarioId}`);
  }
  if (route.task.id !== evalCase.expectedTaskId) {
    failures.push(`${evalCase.name}: task ${route.task.id} !== ${evalCase.expectedTaskId}`);
  }
  if (route.skillPack.id !== evalCase.expectedSkillPackId) {
    failures.push(
      `${evalCase.name}: skill pack ${route.skillPack.id} !== ${evalCase.expectedSkillPackId}`,
    );
  }
  if (route.output.id !== evalCase.expectedOutputId) {
    failures.push(`${evalCase.name}: output ${route.output.id} !== ${evalCase.expectedOutputId}`);
  }
  if (
    evalCase.expectedReason &&
    !route.reasons.some((reason) => evalCase.expectedReason?.test(reason))
  ) {
    failures.push(`${evalCase.name}: missing route reason ${evalCase.expectedReason}`);
  }
  if (!/Output preference: Auto/.test(prompt)) {
    failures.push(`${evalCase.name}: missing auto-output instruction`);
  }
  if (!/Choose the concrete deliverable shape from the work/.test(prompt)) {
    failures.push(`${evalCase.name}: missing open deliverable instruction`);
  }
  if (!/Use write_partner_deliverable/.test(prompt)) {
    failures.push(`${evalCase.name}: missing deliverable registration instruction`);
  }
  for (const signal of evalCase.promptSignals ?? []) {
    if (!signal.test(prompt)) {
      failures.push(`${evalCase.name}: missing prompt signal ${signal}`);
    }
  }
  for (const antiSignal of evalCase.promptAntiSignals ?? []) {
    if (antiSignal.test(prompt)) {
      failures.push(`${evalCase.name}: unexpected prompt signal ${antiSignal}`);
    }
  }

  return failures;
}

test('partner workbench strategy eval passes representative work-mode matrix', () => {
  const failures = STRATEGY_EVAL_CASES.flatMap((evalCase) => evaluateCase(evalCase));
  assert.equal(
    failures.length,
    0,
    `Partner workbench strategy eval failed:\n${failures.join('\n')}`,
  );
});

test('partner workbench UX eval keeps mode-only starts useful', () => {
  const failures = MODE_DEFAULT_UX_EVAL_CASES.flatMap((evalCase) => evaluateUxCase(evalCase));
  assert.equal(
    failures.length,
    0,
    `Partner workbench mode-default UX eval failed:\n${failures.join('\n')}`,
  );
});

test('partner workbench UX eval routes common natural-language asks', () => {
  const failures = NATURAL_LANGUAGE_UX_EVAL_CASES.flatMap((evalCase) => evaluateUxCase(evalCase));
  assert.equal(
    failures.length,
    0,
    `Partner workbench natural-language UX eval failed:\n${failures.join('\n')}`,
  );
});

test('partner workbench UX eval covers realistic release-candidate query corpus', () => {
  const failures = REALISTIC_QUERY_CORPUS_EVAL_CASES.flatMap((evalCase) =>
    evaluateUxCase(evalCase),
  );
  assert.equal(
    failures.length,
    0,
    `Partner workbench realistic query corpus eval failed:\n${failures.join('\n')}`,
  );
});

test('partner workbench UX eval covers Chinese mode-first experience corpus', () => {
  const failures = CHINESE_WORK_MODE_EXPERIENCE_EVAL_CASES.flatMap((evalCase) =>
    evaluateUxCase(evalCase),
  );
  assert.equal(
    failures.length,
    0,
    `Partner workbench Chinese mode-first UX eval failed:\n${failures.join('\n')}`,
  );
});

test('partner workbench UX eval guards common misclassification regressions', () => {
  const failures = REGRESSION_UX_EVAL_CASES.flatMap((evalCase) => evaluateUxCase(evalCase));
  assert.equal(
    failures.length,
    0,
    `Partner workbench regression UX eval failed:\n${failures.join('\n')}`,
  );
});

test('partner workbench UX eval guards adversarial work-mode ambiguity', () => {
  const failures = ADVERSARIAL_WORK_MODE_UX_EVAL_CASES.flatMap((evalCase) =>
    evaluateUxCase(evalCase),
  );
  assert.equal(
    failures.length,
    0,
    `Partner workbench adversarial work-mode UX eval failed:\n${failures.join('\n')}`,
  );
});
