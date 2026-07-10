import { registerPartnerSpaceToolPolicy } from './partner-tools.js';
import {
  resolveSessionRunContext,
  type SdkToolExecutionContextLike,
} from './session-run-context.js';
import { partnerKbStore, type PartnerKbStore, type PartnerKbPage } from './partner-kb-store.js';

const MAX_KB_TOOL_RESULT_CHARS = 180_000;

type ToolHandler = (
  input: Record<string, unknown>,
  context?: SdkToolExecutionContextLike,
) => Promise<string>;

export const PARTNER_KB_LIST_TOOL = {
  name: 'partner_kb_list_pages',
  description: 'List pages in the current project Partner KB. Read-only.',
  sideEffect: 'readonly' as const,
  input_schema: {
    type: 'object' as const,
    properties: {},
  },
};

export const PARTNER_KB_READ_TOOL = {
  name: 'partner_kb_read_page',
  description: 'Read one Partner KB page in the current project by pageId or slug. Read-only.',
  sideEffect: 'readonly' as const,
  input_schema: {
    type: 'object' as const,
    properties: {
      pageId: { type: 'string', description: 'Page id returned by partner_kb_list_pages.' },
      slug: { type: 'string', description: 'Stable page slug.' },
    },
  },
};

export const PARTNER_KB_SEARCH_TOOL = {
  name: 'partner_kb_search_pages',
  description:
    'Search current-project Partner KB wiki pages by text query, with match reasons and source ids. Read-only.',
  sideEffect: 'readonly' as const,
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query.' },
      limit: { type: 'number', description: 'Optional max results, 1-50.' },
    },
    required: ['query'],
  },
};

export const PARTNER_KB_MAINTENANCE_TOOL = {
  name: 'partner_kb_run_maintenance',
  description: [
    'Run current-project Partner KB maintenance checks and return the report.',
    'Checks include broken links, uncited key claims, orphan pages, stale source pages, duplicate topics, and config diagnostics.',
    'This writes Space-owned KB maintenance state only; it does not edit project files.',
  ].join('\n'),
  sideEffect: 'mutates-state' as const,
  input_schema: {
    type: 'object' as const,
    properties: {},
  },
};

export const PARTNER_KB_WRITE_TOOL = {
  name: 'partner_kb_write_page',
  description: [
    'Create or update a page in the current project Partner KB.',
    'Use this for durable knowledge, decisions, summaries, and reusable context.',
    'This writes Space-owned KB state only; it does not edit project files.',
  ].join('\n'),
  sideEffect: 'mutates-state' as const,
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Human-readable KB page title.' },
      content: { type: 'string', description: 'Markdown page body.' },
      slug: {
        type: 'string',
        description: 'Optional stable slug; derived from title when omitted.',
      },
    },
    required: ['title', 'content'],
  },
};

function requirePartnerContext(
  toolContext?: SdkToolExecutionContextLike,
): { sessionId: string; projectRoot: string } | string {
  const ctx = resolveSessionRunContext(toolContext);
  if (!ctx) return 'Error: Partner KB tool was called outside an active session run.';
  if (ctx.surface !== 'partner')
    return 'Error: Partner KB tools are only available in Partner sessions.';
  return { sessionId: ctx.sessionId, projectRoot: ctx.projectRoot };
}

function cap(text: string): string {
  if (text.length <= MAX_KB_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_KB_TOOL_RESULT_CHARS)}\n\n[Partner KB result truncated at ${MAX_KB_TOOL_RESULT_CHARS} chars]`;
}

function pageHeader(page: PartnerKbPage): string {
  return `${page.id} | ${page.slug} | ${page.title} | updated=${new Date(page.updatedAt).toISOString()}`;
}

export function makePartnerKbListHandler(store: PartnerKbStore): ToolHandler {
  return async (_input, toolContext) => {
    const ctx = requirePartnerContext(toolContext);
    if (typeof ctx === 'string') return ctx;
    const pages = await store.list(ctx.projectRoot);
    if (pages.length === 0) return 'Partner KB pages for this project: none.';
    return [
      'Partner KB pages for this project:',
      ...pages.slice(0, 200).map((page) => `- ${pageHeader(page)}`),
    ].join('\n');
  };
}

export function makePartnerKbReadHandler(store: PartnerKbStore): ToolHandler {
  return async (input, toolContext) => {
    const ctx = requirePartnerContext(toolContext);
    if (typeof ctx === 'string') return ctx;
    const pageId = typeof input.pageId === 'string' ? input.pageId.trim() : undefined;
    const slug = typeof input.slug === 'string' ? input.slug.trim() : undefined;
    if (!pageId && !slug) return 'Error: provide pageId or slug.';
    const page = await store.get(ctx.projectRoot, {
      ...(pageId ? { id: pageId } : {}),
      ...(slug ? { slug } : {}),
    });
    if (!page) return 'Error: Partner KB page not found in the current project.';
    return cap([pageHeader(page), '', page.content].join('\n'));
  };
}

export function makePartnerKbSearchHandler(store: PartnerKbStore): ToolHandler {
  return async (input, toolContext) => {
    const ctx = requirePartnerContext(toolContext);
    if (typeof ctx === 'string') return ctx;
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    const limit = typeof input.limit === 'number' ? input.limit : undefined;
    if (!query) return 'Error: provide query.';
    const matches = await store.search(ctx.projectRoot, query, limit);
    if (matches.length === 0) return 'Partner KB search results: none.';
    return cap(
      [
        `Partner KB search results for "${query}":`,
        ...matches.map(
          (match) =>
            `- ${pageHeader(match.page)} | score=${match.score} | reasons=${match.reasons.join(', ')} | sources=${match.sourceIds.join(', ') || 'none'} | fallback=${match.fallback}\n  ${match.snippet.replace(/\s+/g, ' ').slice(0, 500)}`,
        ),
      ].join('\n'),
    );
  };
}

export function makePartnerKbMaintenanceHandler(store: PartnerKbStore): ToolHandler {
  return async (_input, toolContext) => {
    const ctx = requirePartnerContext(toolContext);
    if (typeof ctx === 'string') return ctx;
    const report = await store.runMaintenance(ctx.projectRoot);
    return cap(
      [
        `Partner KB maintenance completed with ${report.issueCount} issue(s).`,
        report.summaryMarkdown,
      ].join('\n\n'),
    );
  };
}

export function makePartnerKbWriteHandler(store: PartnerKbStore): ToolHandler {
  return async (input, toolContext) => {
    const ctx = requirePartnerContext(toolContext);
    if (typeof ctx === 'string') return ctx;
    const title = typeof input.title === 'string' ? input.title : '';
    const content = typeof input.content === 'string' ? input.content : '';
    const slug = typeof input.slug === 'string' ? input.slug : undefined;
    try {
      const { page, created } = await store.upsert({
        projectRoot: ctx.projectRoot,
        title,
        content,
        ...(slug !== undefined ? { slug } : {}),
      });
      return `Partner KB page ${created ? 'created' : 'updated'}: ${page.title} (id=${page.id}, slug=${page.slug}).`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error writing Partner KB page: ${message.slice(0, 240)}`;
    }
  };
}

let registered = false;

export function _resetPartnerKbToolRegistrationForTesting(): void {
  registered = false;
}

export function ensurePartnerKbToolsRegistered(sdk: unknown): void {
  if (registered) return;
  const reg = (sdk as { registerTool?: (def: unknown) => () => void }).registerTool;
  if (typeof reg !== 'function') {
    console.warn('[partner-kb] sdk.registerTool unavailable; Partner KB tools not registered');
    return;
  }
  reg({ ...PARTNER_KB_LIST_TOOL, handler: makePartnerKbListHandler(partnerKbStore) });
  reg({ ...PARTNER_KB_READ_TOOL, handler: makePartnerKbReadHandler(partnerKbStore) });
  reg({ ...PARTNER_KB_SEARCH_TOOL, handler: makePartnerKbSearchHandler(partnerKbStore) });
  reg({ ...PARTNER_KB_MAINTENANCE_TOOL, handler: makePartnerKbMaintenanceHandler(partnerKbStore) });
  reg({ ...PARTNER_KB_WRITE_TOOL, handler: makePartnerKbWriteHandler(partnerKbStore) });
  registerPartnerSpaceToolPolicy({
    name: PARTNER_KB_LIST_TOOL.name,
    scope: 'knowledge-base',
    sideEffect: PARTNER_KB_LIST_TOOL.sideEffect,
    description: 'Lists current-project Partner KB pages.',
  });
  registerPartnerSpaceToolPolicy({
    name: PARTNER_KB_READ_TOOL.name,
    scope: 'knowledge-base',
    sideEffect: PARTNER_KB_READ_TOOL.sideEffect,
    description: 'Reads current-project Partner KB pages.',
  });
  registerPartnerSpaceToolPolicy({
    name: PARTNER_KB_SEARCH_TOOL.name,
    scope: 'knowledge-base',
    sideEffect: PARTNER_KB_SEARCH_TOOL.sideEffect,
    description: 'Searches current-project Partner KB pages.',
  });
  registerPartnerSpaceToolPolicy({
    name: PARTNER_KB_MAINTENANCE_TOOL.name,
    scope: 'knowledge-base',
    sideEffect: PARTNER_KB_MAINTENANCE_TOOL.sideEffect,
    description: 'Runs current-project Partner KB maintenance checks in Space state.',
  });
  registerPartnerSpaceToolPolicy({
    name: PARTNER_KB_WRITE_TOOL.name,
    scope: 'knowledge-base',
    sideEffect: PARTNER_KB_WRITE_TOOL.sideEffect,
    description: 'Creates or updates current-project Partner KB pages in Space state.',
  });
  registered = true;
}
