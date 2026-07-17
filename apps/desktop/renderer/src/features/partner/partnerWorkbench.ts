import type { MessageKey } from '../../i18n/messages.js';

export const PARTNER_SOURCES_CHANGED_EVENT = 'kodax-space.partner-sources-changed';
export const PARTNER_WORKBENCH_CONTEXT_EVENT = 'kodax-space.partner-workbench-context';
const PARTNER_PENDING_SOURCES_STORAGE_KEY = 'kodax-space.partner.pendingSources';

export type PartnerWorkbenchScenarioId =
  | 'document-processing'
  | 'finance'
  | 'data-analysis'
  | 'deep-research'
  | 'product-management'
  | 'presentation'
  | 'design'
  | 'email-editing';

export type PartnerWorkbenchTaskId =
  | 'document-processing'
  | 'financial-analysis'
  | 'data-analysis'
  | 'presentation'
  | 'design-brief'
  | 'email-draft'
  | 'prd'
  | 'rfc'
  | 'api-doc'
  | 'report'
  | 'meeting-summary'
  | 'changelog'
  | 'pr-description'
  | 'review-brief'
  | 'requirements-breakdown'
  | 'research-memo';

export type PartnerWorkbenchSkillPackId =
  | 'product-requirement-breakdown'
  | 'architecture-doc'
  | 'api-documentation'
  | 'release-notes'
  | 'pr-description'
  | 'review-summary'
  | 'research-memo'
  | 'financial-analysis'
  | 'data-analysis'
  | 'presentation-design'
  | 'design-brief'
  | 'communication-drafting';

export type PartnerWorkbenchOutputId =
  | 'run-workspace'
  | 'docx'
  | 'pdf'
  | 'pptx'
  | 'xlsx'
  | 'file-md'
  | 'file-txt';

export type PartnerWorkbenchOutputPreferenceId = 'auto' | PartnerWorkbenchOutputId;

export interface PartnerWorkbenchSourceRef {
  readonly id: string;
  readonly path: string;
  readonly label?: string | null;
}

export interface PartnerWorkbenchPendingSourceRef {
  readonly path: string;
  readonly label?: string | null;
}

export interface PartnerWorkbenchScenarioPreset {
  readonly id: PartnerWorkbenchScenarioId;
  readonly labelKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly capabilitySummaryKey: MessageKey;
  readonly deliverableSummaryKey: MessageKey;
  readonly defaultTaskId: PartnerWorkbenchTaskId;
  readonly defaultSkillPackId: PartnerWorkbenchSkillPackId;
  readonly defaultOutputId: PartnerWorkbenchOutputId;
}

export interface PartnerWorkbenchTaskPreset {
  readonly id: PartnerWorkbenchTaskId;
  readonly labelKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly defaultSkillPackId: PartnerWorkbenchSkillPackId;
  readonly defaultOutputId: PartnerWorkbenchOutputId;
  readonly filenameStem: string;
}

export interface PartnerWorkbenchSkillPack {
  readonly id: PartnerWorkbenchSkillPackId;
  readonly labelKey: MessageKey;
  readonly guidance: readonly string[];
}

export interface PartnerWorkbenchOutputTarget {
  readonly id: PartnerWorkbenchOutputId;
  readonly labelKey: MessageKey;
  readonly kind: 'run-workspace' | 'docx' | 'pdf' | 'pptx' | 'xlsx' | 'file-proposal';
  readonly extension?: 'docx' | 'pdf' | 'pptx' | 'xlsx' | 'md' | 'txt';
}

export interface PartnerWorkbenchOutputPreference {
  readonly id: PartnerWorkbenchOutputPreferenceId;
  readonly labelKey: MessageKey;
}

export interface PartnerWorkbenchScenarioProfile {
  readonly focus: readonly string[];
  readonly capabilities: readonly string[];
  readonly deliverables: readonly string[];
  readonly toolStrategy: readonly string[];
  readonly completionBar: readonly string[];
}

export type PartnerCodeKnowledgeSkillId =
  | 'draft-architecture-doc'
  | 'draft-api-doc'
  | 'draft-changelog'
  | 'draft-pr-description'
  | 'summarize-review'
  | 'extract-requirements';

export interface PartnerCodeKnowledgeSkill {
  readonly id: PartnerCodeKnowledgeSkillId;
  readonly taskIds: readonly PartnerWorkbenchTaskId[];
  readonly skillPackId: PartnerWorkbenchSkillPackId;
  readonly outputKinds: readonly PartnerWorkbenchOutputId[];
  readonly guidance: readonly string[];
}

export interface PartnerWorkbenchConfig {
  readonly projectRoot?: string | null;
  readonly hasSession: boolean;
  readonly scenarioId?: PartnerWorkbenchScenarioId;
  readonly userBrief?: string;
  readonly taskId?: PartnerWorkbenchTaskId;
  readonly skillPackId?: PartnerWorkbenchSkillPackId;
  readonly outputId?: PartnerWorkbenchOutputId;
  readonly outputPreferenceId?: PartnerWorkbenchOutputPreferenceId;
  readonly targetPath?: string;
  readonly sources: readonly PartnerWorkbenchSourceRef[];
  readonly pendingSources?: readonly PartnerWorkbenchPendingSourceRef[];
}

export interface PartnerWorkbenchContextDetail {
  readonly scenarioId: PartnerWorkbenchScenarioId;
  readonly outputPreferenceId: PartnerWorkbenchOutputPreferenceId;
  readonly targetPath?: string;
  readonly sources: readonly PartnerWorkbenchSourceRef[];
  readonly pendingSources: readonly PartnerWorkbenchPendingSourceRef[];
}

export interface PartnerWorkbenchRoute {
  readonly scenario: PartnerWorkbenchScenarioPreset;
  readonly scenarioProfile: PartnerWorkbenchScenarioProfile;
  readonly task: PartnerWorkbenchTaskPreset;
  readonly skillPack: PartnerWorkbenchSkillPack;
  readonly output: PartnerWorkbenchOutputTarget;
  readonly outputPreferenceId: PartnerWorkbenchOutputPreferenceId;
  readonly targetPath: string;
  readonly reasons: readonly string[];
}

export interface PartnerWorkbenchPreflight {
  readonly canStart: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export const PARTNER_WORKBENCH_SCENARIOS: readonly PartnerWorkbenchScenarioPreset[] = [
  {
    id: 'document-processing',
    labelKey: 'partner.workbench.scenario.document',
    descriptionKey: 'partner.workbench.scenario.document.desc',
    capabilitySummaryKey: 'partner.workbench.profile.document.capabilities',
    deliverableSummaryKey: 'partner.workbench.profile.document.deliverables',
    defaultTaskId: 'document-processing',
    defaultSkillPackId: 'research-memo',
    defaultOutputId: 'run-workspace',
  },
  {
    id: 'finance',
    labelKey: 'partner.workbench.scenario.finance',
    descriptionKey: 'partner.workbench.scenario.finance.desc',
    capabilitySummaryKey: 'partner.workbench.profile.finance.capabilities',
    deliverableSummaryKey: 'partner.workbench.profile.finance.deliverables',
    defaultTaskId: 'financial-analysis',
    defaultSkillPackId: 'financial-analysis',
    defaultOutputId: 'run-workspace',
  },
  {
    id: 'data-analysis',
    labelKey: 'partner.workbench.scenario.data',
    descriptionKey: 'partner.workbench.scenario.data.desc',
    capabilitySummaryKey: 'partner.workbench.profile.data.capabilities',
    deliverableSummaryKey: 'partner.workbench.profile.data.deliverables',
    defaultTaskId: 'data-analysis',
    defaultSkillPackId: 'data-analysis',
    defaultOutputId: 'run-workspace',
  },
  {
    id: 'deep-research',
    labelKey: 'partner.workbench.scenario.research',
    descriptionKey: 'partner.workbench.scenario.research.desc',
    capabilitySummaryKey: 'partner.workbench.profile.research.capabilities',
    deliverableSummaryKey: 'partner.workbench.profile.research.deliverables',
    defaultTaskId: 'research-memo',
    defaultSkillPackId: 'research-memo',
    defaultOutputId: 'run-workspace',
  },
  {
    id: 'product-management',
    labelKey: 'partner.workbench.scenario.product',
    descriptionKey: 'partner.workbench.scenario.product.desc',
    capabilitySummaryKey: 'partner.workbench.profile.product.capabilities',
    deliverableSummaryKey: 'partner.workbench.profile.product.deliverables',
    defaultTaskId: 'prd',
    defaultSkillPackId: 'product-requirement-breakdown',
    defaultOutputId: 'run-workspace',
  },
  {
    id: 'presentation',
    labelKey: 'partner.workbench.scenario.presentation',
    descriptionKey: 'partner.workbench.scenario.presentation.desc',
    capabilitySummaryKey: 'partner.workbench.profile.presentation.capabilities',
    deliverableSummaryKey: 'partner.workbench.profile.presentation.deliverables',
    defaultTaskId: 'presentation',
    defaultSkillPackId: 'presentation-design',
    defaultOutputId: 'pptx',
  },
  {
    id: 'design',
    labelKey: 'partner.workbench.scenario.design',
    descriptionKey: 'partner.workbench.scenario.design.desc',
    capabilitySummaryKey: 'partner.workbench.profile.design.capabilities',
    deliverableSummaryKey: 'partner.workbench.profile.design.deliverables',
    defaultTaskId: 'design-brief',
    defaultSkillPackId: 'design-brief',
    defaultOutputId: 'run-workspace',
  },
  {
    id: 'email-editing',
    labelKey: 'partner.workbench.scenario.email',
    descriptionKey: 'partner.workbench.scenario.email.desc',
    capabilitySummaryKey: 'partner.workbench.profile.email.capabilities',
    deliverableSummaryKey: 'partner.workbench.profile.email.deliverables',
    defaultTaskId: 'email-draft',
    defaultSkillPackId: 'communication-drafting',
    defaultOutputId: 'run-workspace',
  },
];

export const PARTNER_WORKBENCH_SCENARIO_PROFILES: Readonly<
  Record<PartnerWorkbenchScenarioId, PartnerWorkbenchScenarioProfile>
> = {
  'document-processing': {
    focus: [
      'Turn unstructured documents, notes, transcripts, files, and source bundles into usable written work.',
      'Preserve source meaning, document provenance, and reader intent while improving structure and clarity.',
    ],
    capabilities: [
      'Extract, summarize, compare, rewrite, translate, clean up, and restructure long-form documents.',
      'Build outlines, reports, memos, briefs, tables, appendices, citations, and review checklists from mixed sources.',
      'Detect missing evidence, contradictions, duplicated sections, style drift, and unresolved assumptions.',
    ],
    deliverables: [
      'Markdown or rich text drafts, DOCX/PDF artifacts, source-backed reports, annotated summaries, document bundles, and companion checklists.',
      'When useful, generate helper scripts or converters in the run output workspace to transform source files or validate document structure.',
    ],
    toolStrategy: [
      'Read attached Partner sources first when the task depends on supplied documents.',
      'Use Office/PDF artifact writers for structured baseline documents, and write_partner_deliverable for bounded files or generated support files.',
    ],
    completionBar: [
      'The user can inspect the final document, see what sources were used, and understand what remains uncertain.',
    ],
  },
  finance: {
    focus: [
      'Support finance, market, company, valuation, investment, and business-analysis work without pretending uncertainty is certainty.',
      'Separate facts, calculations, assumptions, scenarios, and recommendations so the reasoning can be audited.',
    ],
    capabilities: [
      'Collect and compare market/company evidence, financial statements, operating metrics, unit economics, and benchmark assumptions.',
      'Build tables, scenarios, sensitivity notes, valuation-style reasoning, risk matrices, and executive takeaways.',
      'Flag stale data, missing citations, conflicting assumptions, and non-advice boundaries for financial claims.',
    ],
    deliverables: [
      'Investment memos, market snapshots, company tear-downs, financial tables, scenario workbooks, charts, and decision briefs.',
      'When data is available, produce XLSX/CSV outputs, charts, or lightweight HTML dashboards alongside the written synthesis.',
    ],
    toolStrategy: [
      'Use source reads, web/research tools when available, spreadsheet artifacts, and bounded helper calculations.',
      'Cite source dates and avoid making live-market claims without current evidence.',
    ],
    completionBar: [
      'The final output makes assumptions auditable and clearly distinguishes evidence from interpretation.',
    ],
  },
  'data-analysis': {
    focus: [
      'Turn raw data, tables, logs, survey results, or metric requests into cleaned analysis and useful visual conclusions.',
      'Choose analysis depth from the user goal instead of forcing every task into a spreadsheet.',
    ],
    capabilities: [
      'Profile schemas, missing values, outliers, joins, metric definitions, and data quality risks before drawing conclusions.',
      'Compute summaries, segmentations, cohorts, trends, distributions, pivots, correlations, and lightweight models when appropriate.',
      'Create charts, tables, dashboards, notebooks, validation notes, and reproducible helper scripts in the run output workspace.',
    ],
    deliverables: [
      'XLSX/CSV files, charts, HTML dashboards, markdown reports, cleaned datasets, analysis scripts, and executive summaries.',
      'Include data dictionary or caveat notes when definitions are ambiguous.',
    ],
    toolStrategy: [
      'Use bounded helper execution for transformations and chart generation; keep raw/source data separate from derived outputs.',
      'Prefer transparent calculations and validation artifacts over opaque conclusions.',
    ],
    completionBar: [
      'The user gets both the conclusion and enough intermediate evidence to trust or rerun the analysis.',
    ],
  },
  'deep-research': {
    focus: [
      'Run source-grounded research on industries, competitors, topics, decisions, products, or open questions.',
      'Optimize for synthesis quality, evidence coverage, confidence calibration, and clear gaps.',
    ],
    capabilities: [
      'Build research plans, source maps, evidence matrices, competitor comparisons, trend synthesis, and decision memos.',
      'Cross-check claims across sources, separate first-party evidence from commentary, and mark confidence levels.',
      'Produce concise executive summaries plus deeper appendices when the task needs both speed and auditability.',
    ],
    deliverables: [
      'Research memos, evidence tables, source bibliographies, competitive landscapes, opportunity maps, and follow-up question lists.',
      'When useful, deliver a folder with notes, tables, charts, and a final synthesis rather than one monolithic document.',
    ],
    toolStrategy: [
      'Use attached sources first, then web/research tools when the user asks for current or external evidence.',
      'Keep citations close to claims and call out source gaps explicitly.',
    ],
    completionBar: [
      'The answer is not merely long; it helps the user decide what to believe and what to do next.',
    ],
  },
  'product-management': {
    focus: [
      'Translate messy product context into decisions, requirements, user value, sequencing, and execution clarity.',
      'Keep PM deliverables grounded in users, constraints, trade-offs, and measurable outcomes.',
    ],
    capabilities: [
      'Draft PRDs, requirement breakdowns, user stories, acceptance criteria, launch plans, roadmaps, RFC-style decisions, and review briefs.',
      'Extract product implications from docs, code/repo evidence, customer notes, tickets, and stakeholder goals.',
      'Identify non-goals, risks, dependencies, open questions, metrics, and rollout strategy.',
    ],
    deliverables: [
      'PRDs, specs, acceptance checklists, roadmap tables, decision docs, release notes, stakeholder updates, and implementation handoff notes.',
      'Use diagrams, tables, or lightweight prototypes when they make the product decision easier to review.',
    ],
    toolStrategy: [
      'Read relevant sources and repo evidence before asserting existing behavior.',
      'Use durable deliverables for specs and KB tools for reusable product decisions.',
    ],
    completionBar: [
      'The output should be ready for product review or implementation handoff, not just a brainstorm.',
    ],
  },
  presentation: {
    focus: [
      'Convert ideas, research, data, or documents into a presentation narrative for a specific audience.',
      'Design the story, slide hierarchy, and speaker intent before choosing the final deck format.',
    ],
    capabilities: [
      'Build storylines, slide outlines, executive narratives, speaker notes, data-backed slides, and visual hierarchy.',
      'Adapt tone for leadership, customers, investors, internal updates, training, or project reviews.',
      'Package a clear, inspectable PPTX, HTML slide deck, PDF, outline, or supporting asset set depending on the goal.',
    ],
    deliverables: [
      'PPTX decks, HTML presentations, speaker notes, slide-by-slide outlines, visual direction notes, and supporting data tables.',
      'Include source-backed claims and companion notes when reviewability matters.',
    ],
    toolStrategy: [
      'Use Office artifact writers for PPTX when a deck is explicitly needed; otherwise choose the fastest inspectable presentation form.',
      'Use helper generation for charts, thumbnails, or slide assets when useful.',
    ],
    completionBar: [
      'The user can present or review the deck structure immediately, with claims and data traceable to sources.',
    ],
  },
  design: {
    focus: [
      'Support UX/product design thinking, critique, brief writing, prototype shaping, and visual direction without becoming a heavy coding agent.',
      'Clarify product intent, audience, constraints, visual references, and interaction depth before producing design output.',
    ],
    capabilities: [
      'Create design briefs, UX critiques, content hierarchy, interaction notes, wireframe-level structures, visual direction, and prototype requirements.',
      'Generate lightweight HTML prototypes, copy blocks, asset lists, design QA notes, or review reports when they serve the task.',
      'Identify accessibility, layout, information architecture, and workflow friction from screenshots or product context.',
    ],
    deliverables: [
      'Design briefs, UX audit reports, prototype specs, HTML mockups, visual direction docs, annotated screenshots, and implementation handoff notes.',
      'When the request becomes a full app build, branch/large code edit, or production implementation, hand off to Coder.',
    ],
    toolStrategy: [
      'Use screenshots, saved design context, artifacts, and source files as grounding; avoid inventing visual details when a reference exists.',
      'Use helper output for local prototypes or generated assets, not unrestricted project mutation.',
    ],
    completionBar: [
      'The output helps the user make a design decision or hand off a bounded prototype/design artifact.',
    ],
  },
  'email-editing': {
    focus: [
      'Turn intent, rough notes, facts, or stakeholder context into effective written communication.',
      'Prioritize audience, tone, ask, timing, and action clarity.',
    ],
    capabilities: [
      'Draft, rewrite, tighten, translate, localize, and tone-adjust emails, announcements, updates, FAQs, and executive messages.',
      'Create variants for different audiences, summarize context, extract key asks, and turn meetings or docs into follow-ups.',
      'Preserve sensitive nuance, avoid overclaiming, and keep source-backed claims faithful.',
    ],
    deliverables: [
      'Final email copy, subject lines, short/long variants, stakeholder update drafts, announcement posts, and follow-up action lists.',
      'For recurring communications, save reusable patterns or decisions to Partner KB when appropriate.',
    ],
    toolStrategy: [
      'Use attached docs and prior notes for factual context; keep the final copy ready to paste.',
      'Offer variants only when they help the user choose tone or audience fit.',
    ],
    completionBar: [
      'The user can send, review, or lightly personalize the communication immediately.',
    ],
  },
};

export const PARTNER_WORKBENCH_TASKS: readonly PartnerWorkbenchTaskPreset[] = [
  {
    id: 'document-processing',
    labelKey: 'partner.workbench.task.documentProcessing',
    descriptionKey: 'partner.workbench.task.documentProcessing.desc',
    defaultSkillPackId: 'research-memo',
    defaultOutputId: 'run-workspace',
    filenameStem: 'partner-document',
  },
  {
    id: 'financial-analysis',
    labelKey: 'partner.workbench.task.financialAnalysis',
    descriptionKey: 'partner.workbench.task.financialAnalysis.desc',
    defaultSkillPackId: 'financial-analysis',
    defaultOutputId: 'run-workspace',
    filenameStem: 'financial-analysis',
  },
  {
    id: 'data-analysis',
    labelKey: 'partner.workbench.task.dataAnalysis',
    descriptionKey: 'partner.workbench.task.dataAnalysis.desc',
    defaultSkillPackId: 'data-analysis',
    defaultOutputId: 'run-workspace',
    filenameStem: 'data-analysis',
  },
  {
    id: 'presentation',
    labelKey: 'partner.workbench.task.presentation',
    descriptionKey: 'partner.workbench.task.presentation.desc',
    defaultSkillPackId: 'presentation-design',
    defaultOutputId: 'pptx',
    filenameStem: 'presentation',
  },
  {
    id: 'design-brief',
    labelKey: 'partner.workbench.task.designBrief',
    descriptionKey: 'partner.workbench.task.designBrief.desc',
    defaultSkillPackId: 'design-brief',
    defaultOutputId: 'run-workspace',
    filenameStem: 'design-brief',
  },
  {
    id: 'email-draft',
    labelKey: 'partner.workbench.task.emailDraft',
    descriptionKey: 'partner.workbench.task.emailDraft.desc',
    defaultSkillPackId: 'communication-drafting',
    defaultOutputId: 'run-workspace',
    filenameStem: 'email-draft',
  },
  {
    id: 'prd',
    labelKey: 'partner.workbench.task.prd',
    descriptionKey: 'partner.workbench.task.prd.desc',
    defaultSkillPackId: 'product-requirement-breakdown',
    defaultOutputId: 'run-workspace',
    filenameStem: 'partner-prd',
  },
  {
    id: 'rfc',
    labelKey: 'partner.workbench.task.rfc',
    descriptionKey: 'partner.workbench.task.rfc.desc',
    defaultSkillPackId: 'architecture-doc',
    defaultOutputId: 'run-workspace',
    filenameStem: 'partner-rfc',
  },
  {
    id: 'api-doc',
    labelKey: 'partner.workbench.task.apiDoc',
    descriptionKey: 'partner.workbench.task.apiDoc.desc',
    defaultSkillPackId: 'api-documentation',
    defaultOutputId: 'run-workspace',
    filenameStem: 'api-documentation',
  },
  {
    id: 'report',
    labelKey: 'partner.workbench.task.report',
    descriptionKey: 'partner.workbench.task.report.desc',
    defaultSkillPackId: 'research-memo',
    defaultOutputId: 'run-workspace',
    filenameStem: 'partner-report',
  },
  {
    id: 'meeting-summary',
    labelKey: 'partner.workbench.task.meeting',
    descriptionKey: 'partner.workbench.task.meeting.desc',
    defaultSkillPackId: 'review-summary',
    defaultOutputId: 'run-workspace',
    filenameStem: 'meeting-summary',
  },
  {
    id: 'changelog',
    labelKey: 'partner.workbench.task.changelog',
    descriptionKey: 'partner.workbench.task.changelog.desc',
    defaultSkillPackId: 'release-notes',
    defaultOutputId: 'run-workspace',
    filenameStem: 'CHANGELOG-draft',
  },
  {
    id: 'pr-description',
    labelKey: 'partner.workbench.task.prDescription',
    descriptionKey: 'partner.workbench.task.prDescription.desc',
    defaultSkillPackId: 'pr-description',
    defaultOutputId: 'run-workspace',
    filenameStem: 'pr-description',
  },
  {
    id: 'review-brief',
    labelKey: 'partner.workbench.task.reviewBrief',
    descriptionKey: 'partner.workbench.task.reviewBrief.desc',
    defaultSkillPackId: 'review-summary',
    defaultOutputId: 'run-workspace',
    filenameStem: 'review-brief',
  },
  {
    id: 'requirements-breakdown',
    labelKey: 'partner.workbench.task.requirements',
    descriptionKey: 'partner.workbench.task.requirements.desc',
    defaultSkillPackId: 'product-requirement-breakdown',
    defaultOutputId: 'run-workspace',
    filenameStem: 'requirements-breakdown',
  },
  {
    id: 'research-memo',
    labelKey: 'partner.workbench.task.researchMemo',
    descriptionKey: 'partner.workbench.task.researchMemo.desc',
    defaultSkillPackId: 'research-memo',
    defaultOutputId: 'run-workspace',
    filenameStem: 'research-memo',
  },
];

export const PARTNER_WORKBENCH_SKILL_PACKS: readonly PartnerWorkbenchSkillPack[] = [
  {
    id: 'product-requirement-breakdown',
    labelKey: 'partner.workbench.skill.product',
    guidance: [
      'Break the request into goals, users, constraints, non-goals, user stories, acceptance criteria, risks, and rollout notes.',
      'Make unresolved assumptions explicit and ask only for blockers that prevent a useful draft.',
    ],
  },
  {
    id: 'architecture-doc',
    labelKey: 'partner.workbench.skill.architecture',
    guidance: [
      'Explain context, options, decision, consequences, migration, failure modes, and validation plan.',
      'Separate confirmed source facts from design recommendations.',
    ],
  },
  {
    id: 'api-documentation',
    labelKey: 'partner.workbench.skill.api',
    guidance: [
      'Describe public entry points, request/response shapes, lifecycle, errors, examples, and compatibility notes.',
      'Tie every endpoint, command, or module contract back to concrete files, symbols, schemas, or tests.',
    ],
  },
  {
    id: 'release-notes',
    labelKey: 'partner.workbench.skill.release',
    guidance: [
      'Group user-facing changes, fixes, breaking changes, upgrade notes, and verification evidence.',
      'Prefer concise, release-ready language and avoid internal-only implementation noise unless requested.',
    ],
  },
  {
    id: 'pr-description',
    labelKey: 'partner.workbench.skill.pr',
    guidance: [
      'Write a PR-ready summary, motivation, implementation notes, screenshots/artifacts when relevant, and test plan.',
      'Call out risk areas and reviewer focus points.',
    ],
  },
  {
    id: 'review-summary',
    labelKey: 'partner.workbench.skill.review',
    guidance: [
      'Summarize findings by severity, then open questions, then concise context.',
      'Tie every finding or claim back to a source, diff, document section, or explicit inference.',
    ],
  },
  {
    id: 'research-memo',
    labelKey: 'partner.workbench.skill.research',
    guidance: [
      'Synthesize evidence into an executive summary, details, alternatives, confidence, and follow-up plan.',
      'Keep citations close to claims and list source gaps plainly.',
    ],
  },
  {
    id: 'financial-analysis',
    labelKey: 'partner.workbench.skill.finance',
    guidance: [
      'Separate raw financial facts, calculations, assumptions, and interpretation so the reader can audit the reasoning.',
      'Prefer tables, scenarios, sensitivity notes, and source-linked caveats when financial claims are uncertain.',
    ],
  },
  {
    id: 'data-analysis',
    labelKey: 'partner.workbench.skill.data',
    guidance: [
      'Inspect data shape, quality, missing values, and definitions before drawing conclusions.',
      'Produce the analysis, visualizations, tables, and explanation that fit the user goal instead of forcing a single file format.',
    ],
  },
  {
    id: 'presentation-design',
    labelKey: 'partner.workbench.skill.presentation',
    guidance: [
      'Create a presentation narrative with audience, storyline, slide structure, speaker intent, and visual hierarchy.',
      'Use source-backed claims and include companion notes or data when they make the deck easier to review.',
    ],
  },
  {
    id: 'design-brief',
    labelKey: 'partner.workbench.skill.design',
    guidance: [
      'Clarify the audience, surface, constraints, visual direction, content hierarchy, and interaction intent before producing design output.',
      'When useful, generate assets, HTML prototypes, copy blocks, or review notes rather than only prose.',
    ],
  },
  {
    id: 'communication-drafting',
    labelKey: 'partner.workbench.skill.communication',
    guidance: [
      'Draft concise communication with audience, goal, tone, key asks, context, and next actions made explicit.',
      'Offer polished final copy plus variants only when variants help the user decide.',
    ],
  },
];

export const PARTNER_CODE_KNOWLEDGE_SKILLS: readonly PartnerCodeKnowledgeSkill[] = [
  {
    id: 'draft-architecture-doc',
    taskIds: ['rfc'],
    skillPackId: 'architecture-doc',
    outputKinds: ['run-workspace', 'docx', 'pdf', 'file-md'],
    guidance: [
      'Use repository structure, module boundaries, public contracts, and recent diffs to draft an architecture document.',
      'Include concrete file paths and symbols beside claims about responsibilities or dependencies.',
    ],
  },
  {
    id: 'draft-api-doc',
    taskIds: ['api-doc'],
    skillPackId: 'api-documentation',
    outputKinds: ['run-workspace', 'docx', 'file-md'],
    guidance: [
      'Identify API surfaces from schemas, routes, IPC channels, exported types, CLI commands, tests, and README examples.',
      'Document inputs, outputs, errors, compatibility notes, and usage examples with source file citations.',
    ],
  },
  {
    id: 'draft-changelog',
    taskIds: ['changelog'],
    skillPackId: 'release-notes',
    outputKinds: ['run-workspace', 'file-md', 'docx'],
    guidance: [
      'Base the changelog on diff, commit, issue, or release-note sources instead of guessing from filenames alone.',
      'Separate user-facing changes, fixes, breaking changes, migration notes, and verification evidence.',
    ],
  },
  {
    id: 'draft-pr-description',
    taskIds: ['pr-description'],
    skillPackId: 'pr-description',
    outputKinds: ['run-workspace', 'file-md', 'docx'],
    guidance: [
      'Inspect the working-tree diff or attached PR snapshot, then produce a review-ready PR description.',
      'Include summary, motivation, implementation notes, screenshots or artifacts when relevant, and test plan.',
    ],
  },
  {
    id: 'summarize-review',
    taskIds: ['review-brief'],
    skillPackId: 'review-summary',
    outputKinds: ['run-workspace', 'docx', 'file-md'],
    guidance: [
      'Read review comments, diff context, failing checks, and attached notes before summarizing.',
      'Group findings by severity and tie every finding to a file path, diff hunk, source id, or explicit inference.',
    ],
  },
  {
    id: 'extract-requirements',
    taskIds: ['requirements-breakdown', 'prd'],
    skillPackId: 'product-requirement-breakdown',
    outputKinds: ['run-workspace', 'docx', 'file-md'],
    guidance: [
      'Extract goals, non-goals, constraints, users, acceptance criteria, risks, and rollout notes from source text and repo evidence.',
      'Keep source-backed requirements separate from inferred product recommendations.',
    ],
  },
];

export const PARTNER_WORKBENCH_OUTPUTS: readonly PartnerWorkbenchOutputTarget[] = [
  { id: 'run-workspace', labelKey: 'partner.workbench.output.runWorkspace', kind: 'run-workspace' },
  { id: 'docx', labelKey: 'partner.workbench.output.docx', kind: 'docx', extension: 'docx' },
  { id: 'pdf', labelKey: 'partner.workbench.output.pdf', kind: 'pdf', extension: 'pdf' },
  { id: 'pptx', labelKey: 'partner.workbench.output.pptx', kind: 'pptx', extension: 'pptx' },
  { id: 'xlsx', labelKey: 'partner.workbench.output.xlsx', kind: 'xlsx', extension: 'xlsx' },
  {
    id: 'file-md',
    labelKey: 'partner.workbench.output.fileMd',
    kind: 'file-proposal',
    extension: 'md',
  },
  {
    id: 'file-txt',
    labelKey: 'partner.workbench.output.fileTxt',
    kind: 'file-proposal',
    extension: 'txt',
  },
];

export const PARTNER_WORKBENCH_OUTPUT_PREFERENCES: readonly PartnerWorkbenchOutputPreference[] = [
  { id: 'auto', labelKey: 'partner.workbench.output.auto' },
  ...PARTNER_WORKBENCH_OUTPUTS.map((output) => ({ id: output.id, labelKey: output.labelKey })),
];

export function getPartnerWorkbenchScenario(
  id: PartnerWorkbenchScenarioId | undefined,
): PartnerWorkbenchScenarioPreset {
  return (
    PARTNER_WORKBENCH_SCENARIOS.find((scenario) => scenario.id === id) ??
    PARTNER_WORKBENCH_SCENARIOS[0]
  );
}

export function getPartnerWorkbenchScenarioProfile(
  id: PartnerWorkbenchScenarioId,
): PartnerWorkbenchScenarioProfile {
  return PARTNER_WORKBENCH_SCENARIO_PROFILES[id];
}

export function getPartnerWorkbenchTask(id: PartnerWorkbenchTaskId): PartnerWorkbenchTaskPreset {
  return PARTNER_WORKBENCH_TASKS.find((task) => task.id === id) ?? PARTNER_WORKBENCH_TASKS[0];
}

export function getPartnerWorkbenchSkillPack(
  id: PartnerWorkbenchSkillPackId,
): PartnerWorkbenchSkillPack {
  return (
    PARTNER_WORKBENCH_SKILL_PACKS.find((pack) => pack.id === id) ?? PARTNER_WORKBENCH_SKILL_PACKS[0]
  );
}

export function getPartnerWorkbenchOutput(
  id: PartnerWorkbenchOutputId,
): PartnerWorkbenchOutputTarget {
  return (
    PARTNER_WORKBENCH_OUTPUTS.find((output) => output.id === id) ?? PARTNER_WORKBENCH_OUTPUTS[0]
  );
}

interface PartnerWorkbenchContextWindow extends Window {
  __kodaxPartnerWorkbenchContext?: PartnerWorkbenchContextDetail;
}

export function buildPartnerWorkbenchContextDetail(
  config: PartnerWorkbenchConfig,
): PartnerWorkbenchContextDetail {
  const detail: PartnerWorkbenchContextDetail = {
    scenarioId: getPartnerWorkbenchScenario(config.scenarioId).id,
    outputPreferenceId: getOutputPreferenceId(config),
    sources: [...config.sources],
    pendingSources: [...(config.pendingSources ?? [])],
  };
  const targetPath = config.targetPath?.trim();
  if (targetPath) {
    return { ...detail, targetPath };
  }
  return detail;
}

export function publishPartnerWorkbenchContext(detail: PartnerWorkbenchContextDetail): void {
  if (typeof window === 'undefined') return;
  const partnerWindow = window as PartnerWorkbenchContextWindow;
  partnerWindow.__kodaxPartnerWorkbenchContext = detail;
  window.dispatchEvent(new CustomEvent(PARTNER_WORKBENCH_CONTEXT_EVENT, { detail }));
}

export function readPartnerWorkbenchContext(): PartnerWorkbenchContextDetail | null {
  if (typeof window === 'undefined') return null;
  return (window as PartnerWorkbenchContextWindow).__kodaxPartnerWorkbenchContext ?? null;
}

interface PartnerPendingSourceEntry extends PartnerWorkbenchPendingSourceRef {
  readonly projectRoot: string;
}

function normalizePendingProjectRoot(projectRoot: string): string {
  return projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
}

function readPartnerPendingSourceEntries(): readonly PartnerPendingSourceEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PARTNER_PENDING_SOURCES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): PartnerPendingSourceEntry[] => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.projectRoot !== 'string' || typeof candidate.path !== 'string')
        return [];
      if (/[\0\r\n]/.test(candidate.projectRoot) || /[\0\r\n]/.test(candidate.path)) return [];
      const label =
        typeof candidate.label === 'string' && candidate.label.trim().length > 0
          ? candidate.label
          : undefined;
      return [
        {
          projectRoot: candidate.projectRoot,
          path: candidate.path,
          ...(label !== undefined ? { label } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

function writePartnerPendingSourceEntries(entries: readonly PartnerPendingSourceEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PARTNER_PENDING_SOURCES_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Pending source staging is a convenience; failure should not block normal Partner work.
  }
}

export function readPartnerPendingSources(
  projectRoot?: string | null,
): readonly PartnerWorkbenchPendingSourceRef[] {
  if (!projectRoot) return [];
  const normalizedRoot = normalizePendingProjectRoot(projectRoot);
  return readPartnerPendingSourceEntries()
    .filter((entry) => normalizePendingProjectRoot(entry.projectRoot) === normalizedRoot)
    .map((entry) => ({
      path: entry.path,
      ...(entry.label !== undefined ? { label: entry.label } : {}),
    }));
}

export function stagePartnerPendingSource(
  projectRoot: string,
  source: PartnerWorkbenchPendingSourceRef,
): readonly PartnerWorkbenchPendingSourceRef[] {
  const normalizedRoot = normalizePendingProjectRoot(projectRoot);
  const normalizedPath = source.path.replace(/\\/g, '/');
  const entries = readPartnerPendingSourceEntries().filter(
    (entry) =>
      normalizePendingProjectRoot(entry.projectRoot) !== normalizedRoot ||
      entry.path.replace(/\\/g, '/') !== normalizedPath,
  );
  writePartnerPendingSourceEntries([
    ...entries,
    {
      projectRoot,
      path: source.path,
      ...(source.label !== undefined && source.label !== null ? { label: source.label } : {}),
    },
  ]);
  return readPartnerPendingSources(projectRoot);
}

export function removePartnerPendingSource(
  projectRoot: string,
  path: string,
): readonly PartnerWorkbenchPendingSourceRef[] {
  const normalizedRoot = normalizePendingProjectRoot(projectRoot);
  const normalizedPath = path.replace(/\\/g, '/');
  const entries = readPartnerPendingSourceEntries().filter(
    (entry) =>
      normalizePendingProjectRoot(entry.projectRoot) !== normalizedRoot ||
      entry.path.replace(/\\/g, '/') !== normalizedPath,
  );
  writePartnerPendingSourceEntries(entries);
  return readPartnerPendingSources(projectRoot);
}

export function clearPartnerPendingSources(projectRoot: string): void {
  const normalizedRoot = normalizePendingProjectRoot(projectRoot);
  const entries = readPartnerPendingSourceEntries().filter(
    (entry) => normalizePendingProjectRoot(entry.projectRoot) !== normalizedRoot,
  );
  writePartnerPendingSourceEntries(entries);
}

export function isFileProposalOutput(outputId: PartnerWorkbenchOutputId): boolean {
  return getPartnerWorkbenchOutput(outputId).kind === 'file-proposal';
}

export function resolvePartnerCodeKnowledgeSkill(
  taskId: PartnerWorkbenchTaskId,
  skillPackId: PartnerWorkbenchSkillPackId,
): PartnerCodeKnowledgeSkill | null {
  return (
    PARTNER_CODE_KNOWLEDGE_SKILLS.find(
      (skill) => skill.taskIds.includes(taskId) && skill.skillPackId === skillPackId,
    ) ??
    PARTNER_CODE_KNOWLEDGE_SKILLS.find((skill) => skill.taskIds.includes(taskId)) ??
    PARTNER_CODE_KNOWLEDGE_SKILLS.find((skill) => skill.skillPackId === skillPackId) ??
    null
  );
}

export function defaultPartnerWorkbenchTargetPath(
  taskId: PartnerWorkbenchTaskId,
  outputId: PartnerWorkbenchOutputId,
): string {
  const task = getPartnerWorkbenchTask(taskId);
  const output = getPartnerWorkbenchOutput(outputId);
  if (output.kind === 'run-workspace') return `partner-output/${task.filenameStem}`;
  return `partner-output/${task.filenameStem}.${output.extension}`;
}

function getOutputPreferenceId(config: PartnerWorkbenchConfig): PartnerWorkbenchOutputPreferenceId {
  return config.outputPreferenceId ?? config.outputId ?? 'auto';
}

function hasAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function inferTaskFromBrief(brief: string): PartnerWorkbenchTaskId | null {
  if (brief.length === 0) return null;
  if (hasAny(brief, [/\brfc\b/i, /\badr\b/i])) {
    return 'rfc';
  }
  if (
    hasAny(brief, [
      /meeting minutes?/i,
      /action items?/i,
      /follow-up actions?/i,
      /decisions?.*actions?/i,
      /transcript/i,
    ])
  ) {
    return 'meeting-summary';
  }
  if (hasAny(brief, [/acceptance criteria/i, /user stor/i])) {
    return 'requirements-breakdown';
  }
  if (
    hasAny(brief, [
      /\bprd\b/i,
      /\bmvp\b/i,
      /roadmap/i,
      /launch plan/i,
      /rollout/i,
      /non-goals?/i,
      /milestones?/i,
    ])
  ) {
    return 'prd';
  }
  if (
    hasAny(brief, [
      /\bslides?\b/i,
      /\bdeck\b/i,
      /pptx?/i,
      /powerpoint/i,
      /presentation/i,
      /keynote/i,
      /speaker notes?/i,
      /pitch deck/i,
      /executive summary slide/i,
    ])
  ) {
    return 'presentation';
  }
  if (
    hasAny(brief, [
      /email/i,
      /mail/i,
      /announcement/i,
      /follow-up/i,
      /subject lines?/i,
      /reply to customer/i,
      /reply to .*customer/i,
      /customer reply/i,
      /escalation/i,
      /weekly update/i,
    ])
  ) {
    return 'email-draft';
  }
  const negatesDesignScope = hasAny(brief, [
    /\bnot\s+(the\s+)?(ui|ux|interface|screen|design)\b/i,
    /\bnot\s+a\s+design\b/i,
  ]);
  if (
    !negatesDesignScope &&
    hasAny(brief, [
      /design/i,
      /prototype/i,
      /\bux\b/i,
      /\bui\b/i,
      /interface/i,
      /\bscreens?\b/i,
      /user experience/i,
      /wireframe/i,
      /mockup/i,
      /interaction/i,
      /visual direction/i,
      /ux audit/i,
      /accessibility/i,
      /information architecture/i,
    ])
  ) {
    return 'design-brief';
  }
  if (
    hasAny(brief, [
      /dashboard/i,
      /visuali[sz]ation/i,
      /\b(clean|analy[sz]e|profile|inspect|look at|check)\b.*\bcsv\b/i,
      /\bcsv\b.*\b(anomal|clean|missing|outlier|cohort|chart|dashboard|metric|file)\b/i,
      /cohort/i,
      /funnel/i,
      /retention/i,
      /outliers?/i,
      /missing values?/i,
      /pivot/i,
      /survey export/i,
    ])
  ) {
    return 'data-analysis';
  }
  if (
    hasAny(brief, [
      /finance/i,
      /financial/i,
      /valuation/i,
      /investment/i,
      /investable/i,
      /financial model/i,
      /public comps?/i,
      /revenue model/i,
      /unit economics/i,
      /\bp&l\b/i,
      /profit and loss/i,
      /\btam\/sam\/som\b/i,
      /\bdcf\b/i,
    ])
  ) {
    return 'financial-analysis';
  }
  if (
    hasAny(brief, [
      /design/i,
      /prototype/i,
      /\bux\b/i,
      /user experience/i,
      /wireframe/i,
      /mockup/i,
      /interaction/i,
      /visual direction/i,
      /ux audit/i,
      /accessibility/i,
      /information architecture/i,
      /设计/,
      /原型/,
      /交互/,
      /视觉/,
      /可访问性/,
      /信息架构/,
      /界面/,
      /页面/,
      /屏幕/,
      /体验/,
    ])
  ) {
    return 'design-brief';
  }
  if (hasAny(brief, [/\bapi\b/i, /openapi/i, /swagger/i, /endpoint/i, /接口/, /契约/])) {
    return 'api-doc';
  }
  if (hasAny(brief, [/\bpull request\b/i, /\bmerge request\b/i, /\bpr\b/i, /PR\s*描述/i])) {
    return 'pr-description';
  }
  if (
    hasAny(brief, [
      /code review/i,
      /review brief/i,
      /review summary/i,
      /review comments?/i,
      /\bpr review\b/i,
      /pull request review/i,
      /merge request review/i,
      /审阅/,
      /评审/,
      /代码审查/,
    ])
  ) {
    return 'review-brief';
  }
  if (hasAny(brief, [/changelog/i, /release notes?/i, /更新日志/, /发布说明/])) {
    return 'changelog';
  }
  if (hasAny(brief, [/\brfc\b/i, /\badr\b/i, /architecture/i, /架构/, /技术方案/])) {
    return 'rfc';
  }
  if (hasAny(brief, [/会议纪要/, /会议记录/, /meeting minutes?/i, /action items?/i, /待办/])) {
    return 'meeting-summary';
  }
  if (hasAny(brief, [/需求拆解/, /acceptance criteria/i, /验收标准/, /user stor/i])) {
    return 'requirements-breakdown';
  }
  if (hasAny(brief, [/\bprd\b/i, /产品需求/, /需求文档/])) {
    return 'prd';
  }
  if (hasAny(brief, [/邮件/, /email/i, /mail/i, /announcement/i, /通知/, /汇报/])) {
    return 'email-draft';
  }
  if (hasAny(brief, [/幻灯片/, /演示文稿/, /\bslides?\b/i, /\bdeck\b/i, /pptx?/i])) {
    return 'presentation';
  }
  if (hasAny(brief, [/数据分析/, /可视化/, /dashboard/i, /visuali[sz]ation/i, /指标/, /图表/])) {
    return 'data-analysis';
  }
  if (
    hasAny(brief, [
      /金融/,
      /财务/,
      /估值/,
      /投研/,
      /finance/i,
      /financial/i,
      /valuation/i,
      /investment/i,
      /financial model/i,
      /\bdcf\b/i,
    ])
  ) {
    return 'financial-analysis';
  }
  if (
    hasAny(brief, [
      /设计/,
      /原型/,
      /交互/,
      /视觉/,
      /design/i,
      /prototype/i,
      /\bux\b/i,
      /user experience/i,
      /wireframe/i,
      /mockup/i,
      /interaction/i,
      /visual direction/i,
    ])
  ) {
    return 'design-brief';
  }
  if (
    hasAny(brief, [
      /深度研究/,
      /行业调研/,
      /竞品/,
      /research/i,
      /调研/,
      /competitor/i,
      /competitive landscape/i,
      /market map/i,
    ])
  ) {
    return 'research-memo';
  }
  if (hasAny(brief, [/报告/, /文书/, /文档/, /memo/i, /report/i])) {
    return 'document-processing';
  }
  return null;
}

function inferOutputFromBrief(brief: string): PartnerWorkbenchOutputId | null {
  if (brief.length === 0) return null;
  if (
    hasAny(brief, [
      /\bhtml\b/i,
      /\bweb\s+page\b/i,
      /\bfolder\b/i,
      /\basset\s+folder\b/i,
      /\bmultiple\s+files?\b/i,
      /\bfile\s+bundle\b/i,
    ])
  ) {
    return 'run-workspace';
  }
  if (hasAny(brief, [/\bpptx?\b/i, /powerpoint/i, /\bslides?\b/i, /\bdeck\b/i])) {
    return 'pptx';
  }
  if (hasAny(brief, [/pptx/i, /powerpoint/i, /\bslides?\b/i, /\bdeck\b/i, /幻灯片/, /演示文稿/])) {
    return 'pptx';
  }
  if (hasAny(brief, [/xlsx/i, /excel/i, /spreadsheet/i, /workbook/i, /电子表格/])) {
    return 'xlsx';
  }
  if (hasAny(brief, [/\bpdf\b/i])) {
    return 'pdf';
  }
  if (hasAny(brief, [/docx/i, /\bword\b/i])) {
    return 'docx';
  }
  if (hasAny(brief, [/\bmarkdown\b/i, /\bmd\b/i, /Markdown/])) {
    return 'file-md';
  }
  if (hasAny(brief, [/\btxt\b/i, /\btext file\b/i])) {
    return 'file-txt';
  }
  return null;
}

export function inferPartnerWorkbenchRoute(config: PartnerWorkbenchConfig): PartnerWorkbenchRoute {
  const scenario = getPartnerWorkbenchScenario(config.scenarioId);
  const scenarioProfile = getPartnerWorkbenchScenarioProfile(scenario.id);
  const brief = config.userBrief?.trim() ?? '';
  const inferredTaskId = inferTaskFromBrief(brief);
  const taskId = inferredTaskId ?? config.taskId ?? scenario.defaultTaskId;
  const task = getPartnerWorkbenchTask(taskId);
  const skillPackId = config.skillPackId ?? task.defaultSkillPackId ?? scenario.defaultSkillPackId;
  const skillPack = getPartnerWorkbenchSkillPack(skillPackId);
  const outputPreferenceId = getOutputPreferenceId(config);
  const inferredOutputId = inferOutputFromBrief(brief);
  const outputId =
    outputPreferenceId === 'auto'
      ? (inferredOutputId ?? task.defaultOutputId ?? scenario.defaultOutputId)
      : outputPreferenceId;
  const output = getPartnerWorkbenchOutput(outputId);
  const targetPath = defaultPartnerWorkbenchTargetPath(task.id, output.id);
  const reasons = [
    `work mode: ${scenario.id}`,
    inferredTaskId ? `brief routed task: ${inferredTaskId}` : `default task: ${task.id}`,
    outputPreferenceId === 'auto'
      ? inferredOutputId
        ? `brief routed output: ${inferredOutputId}`
        : `default output: ${output.id}`
      : `user output override: ${outputPreferenceId}`,
  ];

  return {
    scenario,
    scenarioProfile,
    task,
    skillPack,
    output,
    outputPreferenceId,
    targetPath,
    reasons,
  };
}

export function preflightPartnerWorkbench(
  config: PartnerWorkbenchConfig,
): PartnerWorkbenchPreflight {
  const errors: string[] = [];
  const warnings: string[] = [];
  const route = inferPartnerWorkbenchRoute(config);
  const output = route.output;
  const targetPath = config.targetPath !== undefined ? config.targetPath.trim() : route.targetPath;

  if (!config.projectRoot) {
    errors.push('Open a project folder before sending a Partner workbench task.');
  }
  if (!config.hasSession) {
    warnings.push('No active Partner session yet. Sending from the composer will create one.');
  }
  if ((config.userBrief?.trim() ?? '').length === 0) {
    warnings.push(
      'No work goal was entered. Partner will ask for the missing goal before producing deliverables.',
    );
  }
  if (config.sources.length === 0) {
    warnings.push(
      'No sources are attached. Partner may need to ask for sources before producing a faithful deliverable.',
    );
  }
  if (output.kind === 'file-proposal') {
    if (targetPath.length === 0) {
      errors.push('Choose a target path for the workspace file output.');
    } else if (!targetPath.toLowerCase().endsWith(`.${output.extension}`)) {
      errors.push(`Target path must end with .${output.extension}.`);
    } else if (
      /^[a-zA-Z]:[\\/]/.test(targetPath) ||
      targetPath.startsWith('/') ||
      targetPath.includes('\0')
    ) {
      errors.push('Use a relative project path for workspace file outputs.');
    }
  }

  return { canStart: errors.length === 0, errors, warnings };
}

function sourceLines(sources: readonly PartnerWorkbenchSourceRef[]): readonly string[] {
  if (sources.length === 0) {
    return [
      '- No Partner sources are attached yet. Ask for source attachment if source-grounding is required.',
    ];
  }
  return sources.map((source) => {
    const label = source.label && source.label !== source.path ? ` (${source.label})` : '';
    return `- ${source.id}: ${source.path}${label}`;
  });
}

function codeKnowledgeLines(
  taskId: PartnerWorkbenchTaskId,
  skillPackId: PartnerWorkbenchSkillPackId,
): readonly string[] {
  const selectedSkill = resolvePartnerCodeKnowledgeSkill(taskId, skillPackId);
  if (!selectedSkill) {
    return [];
  }

  return [
    '',
    'Code knowledge skill',
    `- Selected skill: ${selectedSkill.id}`,
    ...selectedSkill.guidance.map((line) => `- ${line}`),
    '- Treat this as code-related knowledge work, not code implementation.',
    '- Use read, grep, glob, Partner KB search, and Repointel/repo-intelligence overview or impact tools when exposed in the session before drafting.',
    '- For diff-centric tasks, inspect the working-tree diff or attached PR/review snapshot and cite changed file paths.',
    '- Ground architecture, API, requirement, changelog, PR, and review claims in concrete file paths, symbols, diffs, KB pages, or Partner source ids.',
  ];
}

function outputInstructionLines(
  route: PartnerWorkbenchRoute,
  targetPath: string,
): readonly string[] {
  const output = route.output;
  if (route.outputPreferenceId === 'auto') {
    const lines = [
      `Output preference: Auto. Current route suggests ${output.id}; change course if the brief or sources make another deliverable form more useful.`,
      `Use the Partner run output workspace as the default delivery surface. Suggested path or folder: ${targetPath}`,
      'Choose the concrete deliverable shape from the work: documents, slides, spreadsheets, charts, HTML, images, data files, folders, checklists, or other generated assets as needed.',
      'Do not limit the result to preset document formats; the deliverable form should serve the user goal.',
      'Use write_partner_deliverable so every output is recorded in the Outputs browser with metadata and source refs.',
    ];
    if (output.kind !== 'run-workspace') {
      return [
        ...lines,
        `If ${output.id} is the best primary artifact, create that final deliverable and include companion files when they improve reviewability.`,
        'Use create_office_artifact when its structured Office/PDF writer is the best path for the inferred artifact.',
      ];
    }
    return lines;
  }

  if (output.kind === 'run-workspace') {
    return [
      `Create one or more deliverables under the Partner run output workspace. Suggested path or folder: ${targetPath}`,
      'Choose the concrete file or folder shape that best fits the task; do not limit the result to preset document formats.',
      'Use write_partner_deliverable so each output is recorded in the Outputs browser with metadata and source refs.',
    ];
  }
  if (output.kind === 'file-proposal') {
    return [
      `Create a workspace-visible ${output.extension} deliverable for target path: ${targetPath}`,
      'Prefer write_partner_workspace_file when the change is small, targeted, and safe to checkpoint.',
      'Use create_file_proposal or update_file_proposal only when policy, sensitivity, or review requirements make an explicit apply step the right path.',
      'Do not use raw write, edit, multi_edit, bash, shell, or any unrestricted filesystem mutation for this output.',
    ];
  }
  return [
    `Create a final ${output.kind} deliverable.`,
    'Prefer write_partner_deliverable in the Partner run output workspace so the result is recorded in the Outputs browser. Use create_office_artifact when its structured Office/PDF writer is the better fit.',
    'Include source/citation metadata in the delivery or artifact payload where the output kind supports it.',
  ];
}

export function buildPartnerWorkbenchPrompt(config: PartnerWorkbenchConfig): string {
  const route = inferPartnerWorkbenchRoute(config);
  const { task, skillPack, output } = route;
  const targetPath =
    config.targetPath !== undefined && config.targetPath.trim().length > 0
      ? config.targetPath.trim()
      : route.targetPath;
  const brief = config.userBrief?.trim();
  const outputInstructions = outputInstructionLines(route, targetPath);
  const codeKnowledgeInstructions = codeKnowledgeLines(task.id, skillPack.id);

  return [
    `Partner workbench mode: ${route.scenario.id}`,
    `Internal route: task=${task.id}; capability=${skillPack.id}; output=${route.outputPreferenceId === 'auto' ? `auto -> ${output.id}` : output.id}`,
    '',
    'User goal',
    brief && brief.length > 0
      ? brief
      : '- No concrete goal was entered. Ask one or two concise questions before executing.',
    '',
    'Source scope',
    ...sourceLines(config.sources),
    '',
    'Routing rationale',
    ...route.reasons.map((reason) => `- ${reason}`),
    '',
    'Scenario capability profile',
    ...route.scenarioProfile.focus.map((line) => `- Focus: ${line}`),
    ...route.scenarioProfile.capabilities.map((line) => `- Capability: ${line}`),
    ...route.scenarioProfile.deliverables.map((line) => `- Deliverable: ${line}`),
    ...route.scenarioProfile.toolStrategy.map((line) => `- Tool strategy: ${line}`),
    ...route.scenarioProfile.completionBar.map((line) => `- Completion bar: ${line}`),
    '',
    'Capability guidance',
    ...skillPack.guidance.map((line) => `- ${line}`),
    ...codeKnowledgeInstructions,
    '',
    'Output handling',
    ...outputInstructions.map((line) => `- ${line}`),
    '',
    'Tool boundary',
    '- Do not use raw write, edit, multi_edit, bash, shell, or unrestricted filesystem mutation.',
    '- Writing small helper tools, scripts, generated apps, validators, renderers, converters, or packagers is allowed when it makes the Partner task faster; keep them as run-output deliverables, and use run_partner_helper for bounded JavaScript transform/validation runs when needed.',
    '- Use write_partner_deliverable for arbitrary run-output files and folders; use run_partner_helper for bounded helper execution over those outputs; use write_partner_workspace_file only for small checkpointed workspace-session writes when policy explicitly allows direct workspace writes.',
    '- When a delivery tool returns an exact Markdown output link, reuse that link in the final response. Do not present a bare run-output path as though it were a project-relative file.',
    '- Treat create_office_artifact as an Office/PDF convenience writer and file proposals as strict/review fallbacks, not as the ceiling of Partner output.',
    '',
    'Faithfulness checklist',
    '- Read attached sources with partner_source_read before making source-grounded claims.',
    '- Cite source ids or paths next to claims, requirements, or decisions that come from the sources.',
    '- Mark inferred recommendations as inference when they are not directly stated in sources.',
    '- List missing evidence, contradictions, or assumptions before the final deliverable summary.',
    '',
    'Finish by linking each created output with the exact Delivery/Artifact link returned by its tool, and report the delivery id, checkpoint id, artifact id, or file proposal id plus the output kind and source coverage.',
  ].join('\n');
}
