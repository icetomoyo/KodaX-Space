import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { canonProjectRoot } from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from './data-paths.js';
import type { PartnerSourceT } from '@kodax-space/space-ipc-schema';
import { replaceFileWithoutFollowingAliases } from './atomic-file.js';

const MAX_KB_PAGES_PER_PROJECT = 512;
export const MAX_PARTNER_KB_CONTENT_CHARS = 512_000;

const PARTNER_KB_PAGE_TYPES = [
  'source',
  'entity',
  'concept',
  'synthesis',
  'decision',
  'timeline',
  'note',
] as const;
const DEFAULT_PAGE_GROUPS = [...PARTNER_KB_PAGE_TYPES];
const DEFAULT_FRESHNESS_WINDOW_DAYS = 30;

const pageTypeSchema = z.enum(PARTNER_KB_PAGE_TYPES);
const confidenceSchema = z.enum(['low', 'medium', 'high']);
const statusSchema = z.enum(['active', 'draft', 'stale', 'archived']);
const claimPolicySchema = z.enum(['off', 'warn', 'strict']);

const pageSchema = z.object({
  id: z.string().min(1).max(128),
  projectRoot: z.string().min(1).max(4096),
  slug: z.string().min(1).max(128),
  title: z.string().min(1).max(256),
  content: z.string().max(MAX_PARTNER_KB_CONTENT_CHARS),
  pageType: pageTypeSchema.default('note'),
  summary: z.string().max(2000).default(''),
  sources: z.array(z.string().min(1).max(128)).max(128).default([]),
  tags: z.array(z.string().min(1).max(64)).max(64).default([]),
  confidence: confidenceSchema.optional(),
  status: statusSchema.default('active'),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const eventSchema = z.object({
  id: z.string().min(1).max(128),
  projectRoot: z.string().min(1).max(4096),
  kind: z.enum([
    'write_page',
    'source_attached',
    'index_rebuilt',
    'lint',
    'maintenance',
    'config_updated',
  ]),
  pageId: z.string().min(1).max(128).optional(),
  sourceId: z.string().min(1).max(128).optional(),
  title: z.string().min(1).max(256),
  createdAt: z.number().int().nonnegative(),
});

const configSchema = z.object({
  projectRoot: z.string().min(1).max(4096),
  pageGroups: z.array(pageTypeSchema).min(1).max(16).default(DEFAULT_PAGE_GROUPS),
  pinnedSources: z.array(z.string().min(1).max(128)).max(128).default([]),
  preferredSynthesisPages: z.array(z.string().min(1).max(128)).max(128).default([]),
  ignoredPaths: z.array(z.string().min(1).max(512)).max(256).default([]),
  claimPolicy: claimPolicySchema.default('warn'),
  freshnessWindowDays: z.number().int().min(1).max(3650).default(DEFAULT_FRESHNESS_WINDOW_DAYS),
  updatedAt: z.number().int().nonnegative(),
});

const configDiagnosticSchema = z.object({
  level: z.enum(['info', 'warning', 'error']),
  message: z.string().min(1).max(1000),
  path: z.string().min(1).max(256).optional(),
});

const staleSourceSchema = z.object({
  pageId: z.string().min(1).max(128),
  slug: z.string().min(1).max(128),
  title: z.string().min(1).max(256),
  ageDays: z.number().int().nonnegative(),
  message: z.string().min(1).max(1000),
});

const duplicateTopicSchema = z.object({
  title: z.string().min(1).max(256),
  slugs: z.array(z.string().min(1).max(128)).min(2).max(50),
});

const maintenanceReportSchema = z.object({
  projectRoot: z.string().min(1).max(4096),
  runAt: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
  lintIssues: z
    .array(
      z.object({
        kind: z.enum(['broken-link', 'uncited-claim', 'orphan-page']),
        pageId: z.string().min(1).max(128),
        slug: z.string().min(1).max(128),
        title: z.string().min(1).max(256),
        message: z.string().min(1).max(1000),
        target: z.string().min(1).max(256).optional(),
      }),
    )
    .max(2000),
  staleSources: z.array(staleSourceSchema).max(512),
  duplicateTopics: z.array(duplicateTopicSchema).max(512),
  configDiagnostics: z.array(configDiagnosticSchema).max(100),
  summaryMarkdown: z.string().max(128_000),
});

const fileSchema = z.object({
  version: z.literal(1),
  pages: z.array(pageSchema).max(100_000),
  events: z.array(eventSchema).max(100_000).default([]),
  configs: z.array(configSchema).max(10_000).catch([]).default([]),
  maintenanceReports: z.array(maintenanceReportSchema).max(10_000).catch([]).default([]),
});

export type PartnerKbPage = z.infer<typeof pageSchema>;
export type PartnerKbPageType = z.infer<typeof pageTypeSchema>;
export type PartnerKbConfidence = z.infer<typeof confidenceSchema>;
export type PartnerKbPageStatus = z.infer<typeof statusSchema>;
export type PartnerKbEvent = z.infer<typeof eventSchema>;
export type PartnerKbClaimPolicy = z.infer<typeof claimPolicySchema>;
export type PartnerKbConfig = z.infer<typeof configSchema>;
export type PartnerKbConfigDiagnostic = z.infer<typeof configDiagnosticSchema>;
export type PartnerKbMaintenanceReport = z.infer<typeof maintenanceReportSchema>;
type PartnerKbFile = z.infer<typeof fileSchema>;

export interface PartnerKbWriteInput {
  readonly projectRoot: string;
  readonly title: string;
  readonly content: string;
  readonly slug?: string;
  readonly pageType?: PartnerKbPageType;
  readonly summary?: string;
  readonly sources?: readonly string[];
  readonly tags?: readonly string[];
  readonly confidence?: PartnerKbConfidence;
  readonly status?: PartnerKbPageStatus;
}

export interface PartnerKbSummary {
  readonly projectRoot: string;
  readonly pageCount: number;
  readonly sourcePageCount: number;
  readonly updatedAt: number | null;
  readonly indexMarkdown: string;
  readonly recentLog: string;
}

export interface PartnerKbSearchMatch {
  readonly page: PartnerKbPage;
  readonly snippet: string;
  readonly score: number;
  readonly reasons: string[];
  readonly sourceIds: string[];
  readonly matchKind: 'hybrid-text';
  readonly fallback: 'none' | 'text';
}

export interface PartnerKbLintIssue {
  readonly kind: 'broken-link' | 'uncited-claim' | 'orphan-page';
  readonly pageId: string;
  readonly slug: string;
  readonly title: string;
  readonly message: string;
  readonly target?: string;
}

export interface PartnerKbConfigInput {
  readonly projectRoot: string;
  readonly pageGroups?: readonly PartnerKbPageType[];
  readonly pinnedSources?: readonly string[];
  readonly preferredSynthesisPages?: readonly string[];
  readonly ignoredPaths?: readonly string[];
  readonly claimPolicy?: PartnerKbClaimPolicy;
  readonly freshnessWindowDays?: number;
}

function normalizeSlug(input: string): string {
  const ascii = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return ascii || `page-${randomUUID().slice(0, 8)}`;
}

function uniqSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function inferSummary(content: string): string {
  const body = content
    .replace(/^---[\s\S]*?---\s*/m, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter((line) => {
      if (line.length === 0) return false;
      if (line.startsWith('- [')) return false;
      if (line.startsWith('[[')) return false;
      return true;
    })
    .join(' ');
  return body.length > 220 ? `${body.slice(0, 217)}...` : body;
}

function sourceRefsFromContent(content: string): string[] {
  const refs = new Set<string>();
  for (const match of content.matchAll(/\[(src_[A-Za-z0-9._-]+)\]/g)) {
    refs.add(match[1]!);
  }
  return [...refs].sort();
}

function wikiLinks(content: string): string[] {
  const links = new Set<string>();
  for (const match of content.matchAll(/\[\[([^\]\r\n]+)\]\]/g)) {
    const raw = match[1]!.split('|')[0]!.trim();
    if (raw) links.add(normalizeSlug(raw));
  }
  return [...links].sort();
}

function sameProject(a: string, b: string): boolean {
  return (
    canonProjectRoot(a, process.platform === 'win32') ===
    canonProjectRoot(b, process.platform === 'win32')
  );
}

function defaultConfig(projectRoot: string): PartnerKbConfig {
  return {
    projectRoot,
    pageGroups: [...DEFAULT_PAGE_GROUPS],
    pinnedSources: [],
    preferredSynthesisPages: [],
    ignoredPaths: [],
    claimPolicy: 'warn',
    freshnessWindowDays: DEFAULT_FRESHNESS_WINDOW_DAYS,
    updatedAt: 0,
  };
}

function mergeConfig(
  projectRoot: string,
  existing: PartnerKbConfig | null,
  input: PartnerKbConfigInput,
): PartnerKbConfig {
  const base = existing ?? defaultConfig(projectRoot);
  return {
    projectRoot,
    pageGroups: [...(input.pageGroups ?? base.pageGroups)],
    pinnedSources: uniqSorted(input.pinnedSources ?? base.pinnedSources),
    preferredSynthesisPages: uniqSorted(
      input.preferredSynthesisPages ?? base.preferredSynthesisPages,
    ),
    ignoredPaths: uniqSorted(input.ignoredPaths ?? base.ignoredPaths),
    claimPolicy: input.claimPolicy ?? base.claimPolicy,
    freshnessWindowDays: input.freshnessWindowDays ?? base.freshnessWindowDays,
    updatedAt: Date.now(),
  };
}

function configDiagnostics(
  config: PartnerKbConfig,
  pages: readonly PartnerKbPage[],
): PartnerKbConfigDiagnostic[] {
  const diagnostics: PartnerKbConfigDiagnostic[] = [];
  const sourceIds = new Set(pages.flatMap((page) => page.sources));
  for (const sourceId of config.pinnedSources) {
    if (!sourceIds.has(sourceId)) {
      diagnostics.push({
        level: 'warning',
        path: 'pinnedSources',
        message: `Pinned source ${sourceId} is not referenced by current KB pages.`,
      });
    }
  }
  const slugs = new Set(pages.map((page) => page.slug));
  for (const slug of config.preferredSynthesisPages) {
    if (!slugs.has(normalizeSlug(slug))) {
      diagnostics.push({
        level: 'warning',
        path: 'preferredSynthesisPages',
        message: `Preferred synthesis page ${slug} does not exist yet.`,
      });
    }
  }
  if (config.claimPolicy === 'strict') {
    diagnostics.push({
      level: 'info',
      path: 'claimPolicy',
      message: 'Strict claim policy treats uncited key claims as maintenance errors.',
    });
  }
  return diagnostics;
}

const CJK_SCRIPT_CHARS =
  '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}';
const CJK_SCRIPT_RUN = new RegExp(`^[${CJK_SCRIPT_CHARS}]+$`, 'u');
const SEARCH_SCRIPT_RUNS = new RegExp(`[${CJK_SCRIPT_CHARS}]+|[^${CJK_SCRIPT_CHARS}]+`, 'gu');
const MAX_SEARCH_TOKENS = 256;

function normalizeSearchText(input: string): string {
  return input.normalize('NFKC').toLowerCase();
}

function tokenizeQuery(input: string): string[] {
  const primaryTokens: string[] = [];
  const cjkBigrams: string[] = [];
  const wordLikeRuns = normalizeSearchText(input).match(/[\p{L}\p{N}_./:-]+/gu) ?? [];

  for (const run of wordLikeRuns) {
    for (const segment of run.match(SEARCH_SCRIPT_RUNS) ?? []) {
      if (CJK_SCRIPT_RUN.test(segment)) {
        const characters = Array.from(segment);
        // Retain a reasonably sized phrase for exact field weighting, then
        // add overlapping bigrams so a long unsegmented CJK run can still
        // match text containing word boundaries that are not written down.
        if (characters.length <= 64) primaryTokens.push(segment);
        if (characters.length === 1) {
          primaryTokens.push(segment);
        } else {
          for (let i = 0; i < characters.length - 1; i += 1) {
            cjkBigrams.push(`${characters[i]}${characters[i + 1]}`);
          }
        }
        continue;
      }

      const token = segment.trim();
      if (!token || !/[\p{L}\p{N}_]/u.test(token)) continue;
      // One-character terms such as R and C are useful in technical KBs.
      // fieldHitScore applies word boundaries to these terms to avoid broad
      // substring matches (for example, R must not match "report").
      primaryTokens.push(token);
    }
  }

  return [...new Set([...primaryTokens, ...cjkBigrams])].slice(0, MAX_SEARCH_TOKENS);
}

function normalizedFieldContainsToken(field: string, token: string): boolean {
  if (/^[a-z0-9]$/.test(token)) {
    return new RegExp(`(?:^|[^a-z0-9_])${token}(?=$|[^a-z0-9_])`).test(field);
  }
  return field.includes(token);
}

function fieldHitScore(field: string, tokens: readonly string[], weight: number): number {
  const normalized = normalizeSearchText(field);
  return tokens.reduce(
    (score, token) => score + (normalizedFieldContainsToken(normalized, token) ? weight : 0),
    0,
  );
}

function ignoredByConfig(page: PartnerKbPage, config: PartnerKbConfig): boolean {
  if (config.ignoredPaths.length === 0) return false;
  const haystack = [
    page.slug,
    page.title,
    page.summary,
    page.tags.join(' '),
    page.sources.join(' '),
  ]
    .join('\n')
    .toLowerCase();
  return config.ignoredPaths.some((pattern) => {
    const normalized = pattern.trim().toLowerCase();
    return normalized.length > 0 && haystack.includes(normalized);
  });
}

async function atomicWriteJson(filePath: string, value: PartnerKbFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await replaceFileWithoutFollowingAliases(
    filePath,
    Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
    'Partner knowledge base changed during atomic replacement',
  );
}

export class PartnerKbStore {
  private cached: PartnerKbFile | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string = path.join(getSpaceDataDir(), 'partner-kb.json'),
  ) {}

  async list(projectRoot: string, query?: string): Promise<PartnerKbPage[]> {
    const file = await this.load();
    const q = query?.trim().toLowerCase() ?? '';
    return file.pages
      .filter((page) => sameProject(page.projectRoot, projectRoot))
      .filter((page) => {
        if (!q) return true;
        return [
          page.title,
          page.slug,
          page.summary,
          page.content,
          page.pageType,
          page.tags.join(' '),
          page.sources.join(' '),
        ]
          .join('\n')
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(
    projectRoot: string,
    selector: { readonly id?: string; readonly slug?: string },
  ): Promise<PartnerKbPage | null> {
    const file = await this.load();
    return (
      file.pages.find((page) => {
        if (!sameProject(page.projectRoot, projectRoot)) return false;
        if (selector.id && page.id === selector.id) return true;
        if (selector.slug && page.slug === normalizeSlug(selector.slug)) return true;
        return false;
      }) ?? null
    );
  }

  async upsert(input: PartnerKbWriteInput): Promise<{ page: PartnerKbPage; created: boolean }> {
    const title = input.title.trim();
    const content = input.content;
    if (!title) throw new Error('title is required');
    if (!content.trim()) throw new Error('content is required');
    if (content.length > MAX_PARTNER_KB_CONTENT_CHARS) {
      throw new Error(`content exceeds ${MAX_PARTNER_KB_CONTENT_CHARS} characters`);
    }
    const slug = normalizeSlug(input.slug ?? title);
    const metadata = {
      pageType: input.pageType ?? 'note',
      summary: (input.summary ?? inferSummary(content)).trim().slice(0, 2000),
      sources: uniqSorted(input.sources ?? sourceRefsFromContent(content)),
      tags: uniqSorted(input.tags ?? []),
      ...(input.confidence ? { confidence: input.confidence } : {}),
      status: input.status ?? 'active',
    } satisfies Pick<PartnerKbPage, 'pageType' | 'summary' | 'sources' | 'tags' | 'status'> & {
      confidence?: PartnerKbConfidence;
    };
    return this.mutate<{ page: PartnerKbPage; created: boolean }>((current) => {
      const idx = current.pages.findIndex(
        (page) => sameProject(page.projectRoot, input.projectRoot) && page.slug === slug,
      );
      const now = Date.now();
      if (idx >= 0) {
        const prev = current.pages[idx]!;
        const page: PartnerKbPage = {
          ...prev,
          title,
          content,
          ...metadata,
          updatedAt: now,
        };
        const pages = [...current.pages];
        pages[idx] = page;
        return {
          next: appendEvent(
            { ...current, pages },
            {
              projectRoot: input.projectRoot,
              kind: 'write_page',
              pageId: page.id,
              title: `Updated ${page.title}`,
              createdAt: now,
            },
          ),
          result: { page, created: false },
        };
      }
      const projectCount = current.pages.filter((page) =>
        sameProject(page.projectRoot, input.projectRoot),
      ).length;
      if (projectCount >= MAX_KB_PAGES_PER_PROJECT) {
        throw new Error(
          `Partner KB page limit reached for this project (${MAX_KB_PAGES_PER_PROJECT})`,
        );
      }
      const page: PartnerKbPage = {
        id: `kb_${randomUUID()}`,
        projectRoot: input.projectRoot,
        slug,
        title,
        content,
        ...metadata,
        createdAt: now,
        updatedAt: now,
      };
      return {
        next: appendEvent(
          { ...current, pages: [...current.pages, page] },
          {
            projectRoot: input.projectRoot,
            kind: 'write_page',
            pageId: page.id,
            title: `Created ${page.title}`,
            createdAt: now,
          },
        ),
        result: { page, created: true },
      };
    });
  }

  async upsertSourceReference(
    source: PartnerSourceT,
  ): Promise<{ page: PartnerKbPage; created: boolean }> {
    const title = source.label ?? source.path;
    const content = [
      '---',
      'kb_page_type: source',
      `title: ${JSON.stringify(title)}`,
      `sources: [${source.id}]`,
      'confidence: low',
      'status: active',
      '---',
      '',
      `# ${title}`,
      '',
      '## Source Metadata',
      '',
      `- Source id: [${source.id}]`,
      `- Kind: ${source.kind}`,
      `- Target: ${source.targetKind}`,
      `- Project path: ${source.path}`,
      `- Added at: ${new Date(source.addedAt).toISOString()}`,
      '',
      '## Summary',
      '',
      'Pending Partner synthesis. Use partner_source_read for source-grounded extraction before adding claims.',
      '',
      '## Key Claims',
      '',
      '- Pending source review.',
      '',
      '## Open Questions',
      '',
      '- What durable claims should be compiled from this source?',
    ].join('\n');
    const result = await this.upsert({
      projectRoot: source.projectRoot,
      title,
      content,
      slug: `source-${source.id}`,
      pageType: 'source',
      summary: `Source reference for ${source.path}`,
      sources: [source.id],
      tags: ['source'],
      confidence: 'low',
    });
    await this.appendLog({
      projectRoot: source.projectRoot,
      kind: 'source_attached',
      pageId: result.page.id,
      sourceId: source.id,
      title: `Attached source ${title}`,
    });
    return result;
  }

  async summary(projectRoot: string): Promise<PartnerKbSummary> {
    const pages = await this.list(projectRoot);
    const updatedAt = pages.length > 0 ? Math.max(...pages.map((page) => page.updatedAt)) : null;
    return {
      projectRoot,
      pageCount: pages.length,
      sourcePageCount: pages.filter((page) => page.pageType === 'source').length,
      updatedAt,
      indexMarkdown: buildIndexMarkdown(projectRoot, pages),
      recentLog: await this.recentLog(projectRoot, 12),
    };
  }

  async search(projectRoot: string, query: string, limit = 20): Promise<PartnerKbSearchMatch[]> {
    const q = query.trim();
    const tokens = tokenizeQuery(q);
    if (!q || tokens.length === 0) return [];
    const normalizedQuery = normalizeSearchText(q);
    const pages = await this.list(projectRoot);
    const { config } = await this.config(projectRoot);
    return pages
      .filter((page) => !ignoredByConfig(page, config))
      .map((page): PartnerKbSearchMatch | null => {
        const reasons: string[] = [];
        const titleScore = fieldHitScore(page.title, tokens, 8);
        const slugScore = fieldHitScore(page.slug, tokens, 4);
        const summaryScore = fieldHitScore(page.summary, tokens, 5);
        const sourceScore = fieldHitScore(page.sources.join(' '), tokens, 5);
        const tagScore = fieldHitScore(page.tags.join(' '), tokens, 4);
        const contentScore = fieldHitScore(page.content, tokens, 1);
        const exactPhraseScore = normalizedFieldContainsToken(
          normalizeSearchText([page.title, page.slug, page.summary, page.content].join('\n')),
          normalizedQuery,
        )
          ? 6
          : 0;
        if (titleScore > 0) reasons.push('title');
        if (slugScore > 0) reasons.push('slug');
        if (summaryScore > 0) reasons.push('summary');
        if (sourceScore > 0) reasons.push('source');
        if (tagScore > 0) reasons.push('tag');
        if (contentScore > 0) reasons.push('content');
        if (exactPhraseScore > 0) reasons.push('exact phrase');
        const score =
          titleScore +
          slugScore +
          summaryScore +
          sourceScore +
          tagScore +
          contentScore +
          exactPhraseScore;
        if (score <= 0) return null;
        return {
          page,
          snippet: snippetFor(page, query),
          score,
          reasons,
          sourceIds: page.sources,
          matchKind: 'hybrid-text',
          fallback: 'text',
        };
      })
      .filter((match): match is PartnerKbSearchMatch => match !== null)
      .sort((a, b) => b.score - a.score || b.page.updatedAt - a.page.updatedAt)
      .slice(0, Math.max(1, Math.min(limit, 50)));
  }

  async rebuildIndex(
    projectRoot: string,
  ): Promise<{ indexMarkdown: string; pageCount: number; rebuiltAt: number }> {
    const summary = await this.summary(projectRoot);
    const rebuiltAt = Date.now();
    await this.appendLog({
      projectRoot,
      kind: 'index_rebuilt',
      title: `Rebuilt Partner KB index for ${summary.pageCount} page(s)`,
    });
    return { indexMarkdown: summary.indexMarkdown, pageCount: summary.pageCount, rebuiltAt };
  }

  async config(
    projectRoot: string,
  ): Promise<{ config: PartnerKbConfig; diagnostics: PartnerKbConfigDiagnostic[] }> {
    const file = await this.load();
    const config =
      file.configs.find((item) => sameProject(item.projectRoot, projectRoot)) ??
      defaultConfig(projectRoot);
    const pages = await this.list(projectRoot);
    return { config, diagnostics: configDiagnostics(config, pages) };
  }

  async setConfig(
    input: PartnerKbConfigInput,
  ): Promise<{ config: PartnerKbConfig; diagnostics: PartnerKbConfigDiagnostic[] }> {
    return this.mutate<{ config: PartnerKbConfig; diagnostics: PartnerKbConfigDiagnostic[] }>(
      (current) => {
        const projectRoot = input.projectRoot;
        const existing =
          current.configs.find((item) => sameProject(item.projectRoot, projectRoot)) ?? null;
        const config = mergeConfig(projectRoot, existing, input);
        const configs = current.configs.filter(
          (item) => !sameProject(item.projectRoot, projectRoot),
        );
        const pages = current.pages.filter((page) => sameProject(page.projectRoot, projectRoot));
        const next = appendEvent(
          { ...current, configs: [...configs, config] },
          {
            projectRoot,
            kind: 'config_updated',
            title: 'Updated Partner KB config',
            createdAt: Date.now(),
          },
        );
        return { next, result: { config, diagnostics: configDiagnostics(config, pages) } };
      },
    );
  }

  async recentLog(projectRoot: string, limit = 20): Promise<string> {
    const file = await this.load();
    const events = file.events
      .filter((event) => sameProject(event.projectRoot, projectRoot))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, Math.min(limit, 100)));
    if (events.length === 0) return 'No Partner KB activity yet.';
    return events
      .map(
        (event) => `- ${new Date(event.createdAt).toISOString()} | ${event.kind} | ${event.title}`,
      )
      .join('\n');
  }

  async lint(projectRoot: string): Promise<PartnerKbLintIssue[]> {
    const pages = await this.list(projectRoot);
    const { config } = await this.config(projectRoot);
    const issues = lintPages(pages, config);
    await this.appendLog({
      projectRoot,
      kind: 'lint',
      title: `Lint completed with ${issues.length} issue(s)`,
    });
    return issues;
  }

  async runMaintenance(projectRoot: string): Promise<PartnerKbMaintenanceReport> {
    const pages = await this.list(projectRoot);
    const { config, diagnostics } = await this.config(projectRoot);
    const lintIssues = lintPages(pages, config);
    const staleSources = staleSourcesFor(pages, config, Date.now());
    const duplicateTopics = duplicateTopicsFor(pages, config);
    const issueCount =
      lintIssues.length +
      staleSources.length +
      duplicateTopics.length +
      diagnostics.filter((diagnostic) => diagnostic.level !== 'info').length;
    const report: PartnerKbMaintenanceReport = {
      projectRoot,
      runAt: Date.now(),
      issueCount,
      lintIssues,
      staleSources,
      duplicateTopics,
      configDiagnostics: diagnostics,
      summaryMarkdown: buildMaintenanceMarkdown({
        projectRoot,
        issueCount,
        lintIssues,
        staleSources,
        duplicateTopics,
        configDiagnostics: diagnostics,
      }),
    };
    await this.mutate<void>((current) => {
      const reports = current.maintenanceReports
        .filter((item) => !sameProject(item.projectRoot, projectRoot))
        .concat(report)
        .slice(-10_000);
      return {
        next: appendEvent(
          { ...current, maintenanceReports: reports },
          {
            projectRoot,
            kind: 'maintenance',
            title: `Maintenance completed with ${issueCount} issue(s)`,
            createdAt: report.runAt,
          },
        ),
        result: undefined,
      };
    });
    return report;
  }

  async lastMaintenance(projectRoot: string): Promise<PartnerKbMaintenanceReport | null> {
    const file = await this.load();
    return (
      file.maintenanceReports
        .filter((report) => sameProject(report.projectRoot, projectRoot))
        .sort((a, b) => b.runAt - a.runAt)[0] ?? null
    );
  }

  invalidate(): void {
    this.cached = null;
  }

  private async appendLog(input: {
    readonly projectRoot: string;
    readonly kind: PartnerKbEvent['kind'];
    readonly title: string;
    readonly pageId?: string;
    readonly sourceId?: string;
  }): Promise<void> {
    await this.mutate<void>((current) => ({
      next: appendEvent(current, {
        id: `kbevt_${randomUUID()}`,
        projectRoot: input.projectRoot,
        kind: input.kind,
        title: input.title,
        ...(input.pageId ? { pageId: input.pageId } : {}),
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        createdAt: Date.now(),
      }),
      result: undefined,
    }));
  }

  private async load(): Promise<PartnerKbFile> {
    if (this.cached !== null) return cloneFile(this.cached);
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf-8');
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        this.cached = { version: 1, pages: [], events: [], configs: [], maintenanceReports: [] };
        return cloneFile(this.cached);
      }
      throw new Error(
        `[PartnerKbStore] ${this.filePath} read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `[PartnerKbStore] ${this.filePath} invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const parsed = fileSchema.safeParse(decoded);
    if (!parsed.success) {
      const invalidPaths = parsed.error.issues
        .map((issue) => issue.path.join('.') || '<root>')
        .join(', ');
      throw new Error(`[PartnerKbStore] ${this.filePath} schema invalid: ${invalidPaths}`);
    }
    this.cached = parsed.data;
    return cloneFile(this.cached);
  }

  private async mutate<R>(
    apply: (current: PartnerKbFile) => { next: PartnerKbFile; result: R },
  ): Promise<R> {
    const previous = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const current = await this.load();
      const { next, result } = apply(cloneFile(current));
      await atomicWriteJson(this.filePath, next);
      this.cached = next;
      return result;
    } finally {
      release();
    }
  }
}

function appendEvent(
  file: PartnerKbFile,
  event: Omit<PartnerKbEvent, 'id'> & { readonly id?: string },
): PartnerKbFile {
  const nextEvent: PartnerKbEvent = {
    id: event.id ?? `kbevt_${randomUUID()}`,
    projectRoot: event.projectRoot,
    kind: event.kind,
    title: event.title,
    ...(event.pageId ? { pageId: event.pageId } : {}),
    ...(event.sourceId ? { sourceId: event.sourceId } : {}),
    createdAt: event.createdAt,
  };
  return { ...file, events: [...file.events, nextEvent].slice(-100_000) };
}

function cloneFile(file: PartnerKbFile): PartnerKbFile {
  return {
    version: 1,
    pages: file.pages.map((page) => ({
      ...page,
      sources: [...page.sources],
      tags: [...page.tags],
    })),
    events: file.events.map((event) => ({ ...event })),
    configs: file.configs.map((config) => ({
      ...config,
      pageGroups: [...config.pageGroups],
      pinnedSources: [...config.pinnedSources],
      preferredSynthesisPages: [...config.preferredSynthesisPages],
      ignoredPaths: [...config.ignoredPaths],
    })),
    maintenanceReports: file.maintenanceReports.map((report) => ({
      ...report,
      lintIssues: report.lintIssues.map((issue) => ({ ...issue })),
      staleSources: report.staleSources.map((source) => ({ ...source })),
      duplicateTopics: report.duplicateTopics.map((topic) => ({
        ...topic,
        slugs: [...topic.slugs],
      })),
      configDiagnostics: report.configDiagnostics.map((diagnostic) => ({ ...diagnostic })),
    })),
  };
}

function buildIndexMarkdown(projectRoot: string, pages: readonly PartnerKbPage[]): string {
  const groups = new Map<PartnerKbPageType, PartnerKbPage[]>();
  for (const page of pages) {
    const group = groups.get(page.pageType) ?? [];
    group.push(page);
    groups.set(page.pageType, group);
  }
  const lines = ['# Partner KB Index', '', `Project: ${projectRoot}`, `Pages: ${pages.length}`, ''];
  for (const type of [
    'source',
    'entity',
    'concept',
    'synthesis',
    'decision',
    'timeline',
    'note',
  ] as const) {
    const group = groups.get(type) ?? [];
    if (group.length === 0) continue;
    lines.push(`## ${type}`);
    for (const page of group.sort((a, b) => a.title.localeCompare(b.title))) {
      const sourceCount = page.sources.length;
      const summary = page.summary ? ` - ${page.summary}` : '';
      lines.push(
        `- [[${page.slug}|${page.title}]]${summary} (sources: ${sourceCount}, updated: ${new Date(page.updatedAt).toISOString()})`,
      );
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function lintPages(pages: readonly PartnerKbPage[], config: PartnerKbConfig): PartnerKbLintIssue[] {
  const visiblePages = pages.filter((page) => !ignoredByConfig(page, config));
  const bySlug = new Map(visiblePages.map((page) => [page.slug, page]));
  const inbound = new Map<string, number>();
  const issues: PartnerKbLintIssue[] = [];
  for (const page of visiblePages) {
    const links = wikiLinks(page.content);
    for (const link of links) {
      if (!bySlug.has(link)) {
        issues.push({
          kind: 'broken-link',
          pageId: page.id,
          slug: page.slug,
          title: page.title,
          target: link,
          message: `Broken wiki link: [[${link}]]`,
        });
      } else {
        inbound.set(link, (inbound.get(link) ?? 0) + 1);
      }
    }
    if (config.claimPolicy !== 'off') {
      for (const claim of keyClaimLines(page.content)) {
        if (!/\[src_[A-Za-z0-9._-]+\]/.test(claim)) {
          issues.push({
            kind: 'uncited-claim',
            pageId: page.id,
            slug: page.slug,
            title: page.title,
            message: `Uncited claim: ${claim.slice(0, 160)}`,
          });
        }
      }
    }
  }
  for (const page of visiblePages) {
    if (
      page.pageType !== 'source' &&
      page.slug !== 'index' &&
      (inbound.get(page.slug) ?? 0) === 0
    ) {
      issues.push({
        kind: 'orphan-page',
        pageId: page.id,
        slug: page.slug,
        title: page.title,
        message: 'No inbound wiki links point to this page.',
      });
    }
  }
  return issues;
}

function staleSourcesFor(
  pages: readonly PartnerKbPage[],
  config: PartnerKbConfig,
  now: number,
): PartnerKbMaintenanceReport['staleSources'] {
  const maxAgeMs = config.freshnessWindowDays * 24 * 60 * 60 * 1000;
  return pages
    .filter((page) => page.pageType === 'source' && !ignoredByConfig(page, config))
    .map((page) => {
      const ageDays = Math.floor(Math.max(0, now - page.updatedAt) / (24 * 60 * 60 * 1000));
      if (now - page.updatedAt <= maxAgeMs) return null;
      return {
        pageId: page.id,
        slug: page.slug,
        title: page.title,
        ageDays,
        message: `Source page has not been refreshed for ${ageDays} day(s).`,
      };
    })
    .filter((item): item is PartnerKbMaintenanceReport['staleSources'][number] => item !== null);
}

function duplicateTopicsFor(
  pages: readonly PartnerKbPage[],
  config: PartnerKbConfig,
): PartnerKbMaintenanceReport['duplicateTopics'] {
  const byTitle = new Map<string, PartnerKbPage[]>();
  for (const page of pages) {
    if (page.pageType === 'source' || ignoredByConfig(page, config)) continue;
    const key = page.title.trim().toLowerCase();
    if (!key) continue;
    const group = byTitle.get(key) ?? [];
    group.push(page);
    byTitle.set(key, group);
  }
  return [...byTitle.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([title, group]) => ({
      title,
      slugs: group.map((page) => page.slug).sort(),
    }));
}

function buildMaintenanceMarkdown(input: {
  readonly projectRoot: string;
  readonly issueCount: number;
  readonly lintIssues: readonly PartnerKbLintIssue[];
  readonly staleSources: readonly PartnerKbMaintenanceReport['staleSources'][number][];
  readonly duplicateTopics: readonly PartnerKbMaintenanceReport['duplicateTopics'][number][];
  readonly configDiagnostics: readonly PartnerKbConfigDiagnostic[];
}): string {
  const lines = [
    '# Partner KB Maintenance',
    '',
    `Project: ${input.projectRoot}`,
    `Issues: ${input.issueCount}`,
    '',
  ];
  if (input.configDiagnostics.length > 0) {
    lines.push('## Config Diagnostics');
    for (const diagnostic of input.configDiagnostics) {
      lines.push(`- ${diagnostic.level}: ${diagnostic.message}`);
    }
    lines.push('');
  }
  if (input.lintIssues.length > 0) {
    lines.push('## Lint Issues');
    for (const issue of input.lintIssues) {
      lines.push(`- ${issue.kind}: [[${issue.slug}|${issue.title}]] - ${issue.message}`);
    }
    lines.push('');
  }
  if (input.staleSources.length > 0) {
    lines.push('## Stale Sources');
    for (const source of input.staleSources) {
      lines.push(`- [[${source.slug}|${source.title}]] - ${source.message}`);
    }
    lines.push('');
  }
  if (input.duplicateTopics.length > 0) {
    lines.push('## Duplicate Topics');
    for (const topic of input.duplicateTopics) {
      lines.push(`- ${topic.title}: ${topic.slugs.map((slug) => `[[${slug}]]`).join(', ')}`);
    }
    lines.push('');
  }
  if (input.issueCount === 0) {
    lines.push('No maintenance issues found.');
  }
  return lines.join('\n').trimEnd();
}

function snippetFor(page: PartnerKbPage, query: string): string {
  const haystack = page.content || page.summary || page.title;
  const idx = haystack.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return page.summary || page.title;
  const start = Math.max(0, idx - 80);
  const end = Math.min(haystack.length, idx + query.length + 140);
  return `${start > 0 ? '...' : ''}${haystack.slice(start, end).replace(/\s+/g, ' ')}${end < haystack.length ? '...' : ''}`;
}

function keyClaimLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const claims: string[] = [];
  let inKeyClaims = false;
  for (const line of lines) {
    if (/^##\s+/i.test(line)) {
      inKeyClaims = /^##\s+key claims/i.test(line);
      continue;
    }
    if (inKeyClaims && /^[-*]\s+\S/.test(line.trim())) {
      claims.push(line.trim());
    }
  }
  return claims;
}

export const partnerKbStore = new PartnerKbStore();
