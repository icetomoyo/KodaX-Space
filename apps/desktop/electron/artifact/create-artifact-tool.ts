// create_artifact — in-process SDK tool (F058). The agent calls this to emit a
// rich artifact (report/doc/chart/code/html/...) into Space's LC-free store; the
// handler attributes it to the active run's session/surface (via run-context ALS),
// persists it, and notifies the renderer. Static tier only — `react` (LC sandbox)
// is NOT creatable here.
//
// Steering is the tool's own description (the agent self-documents from it). The
// handler/def are factored out of registration so the handler is unit-testable
// with an injected store + notifier.

import path from 'node:path';
import {
  artifactCreateChannel,
  looksLikeInteractiveHtml,
  type ArtifactKindT,
} from '@kodax-space/space-ipc-schema';
import type { ArtifactStore } from './store.js';
import { artifactStore } from './store.js';
import {
  resolveSessionRunContext,
  type SdkToolExecutionContextLike,
} from '../kodax/session-run-context.js';
import { pushToRenderer } from '../ipc/push.js';
import { registerPartnerSpaceToolPolicy } from '../kodax/partner-tools.js';

/** True if `p` (relative or absolute) resolves inside `root`. */
function isInsideProject(root: string, p: string): boolean {
  const rootAbs = path.resolve(root);
  const resolved = path.resolve(rootAbs, p); // absolute `p` ignores rootAbs
  const withSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  return resolved === rootAbs || resolved.startsWith(withSep);
}

/** Strip filesystem paths from an error message before it reaches the LLM/tool result. */
function sanitizeErrorForTool(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/[A-Za-z]:[\\/][^\s'"]+/g, '<path>')
    .replace(/\\\\[^\s'"]+/g, '<path>')
    .replace(/\/[\w.-]+\/[^\s'"]*/g, '<path>')
    .slice(0, 240);
}

// Static-tier kinds the tool advertises. `react` is intentionally excluded — the
// interactive-React tier is the gated LC path, never agent-emitted via this tool.
const CREATE_ARTIFACT_KINDS = [
  'markdown',
  'code',
  'html',
  'interactive-html',
  'svg',
  'image',
  'chart',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'file',
] as const satisfies readonly ArtifactKindT[];

const DESCRIPTION = [
  'Create or update a rich ARTIFACT shown in a dedicated preview panel (not inline in chat).',
  'Use for substantial, self-contained deliverables the user will want to preview, iterate, and export:',
  'reports/docs (markdown), charts, code, static HTML, interactive HTML, SVG, or referencing an existing pdf/docx/xlsx/pptx/media file.',
  '',
  'kinds:',
  '- markdown/code/html/interactive-html/svg: pass `content` (the text/source).',
  '- html is static and runs with scripts disabled. Use interactive-html for canvas, animations, playback controls, DOM event handlers, requestAnimationFrame, or any <script>-driven deliverable.',
  '- interactive-html runs in an opaque-origin iframe sandbox with scripts allowed, same-origin disabled, no top-navigation, and an injected CSP. By default it blocks network, external scripts, forms, popups, frames, and objects.',
  '- Optional `permissions` for interactive-html can allow limited HTTPS origins: connect/style/img/media/font/forms arrays contain HTTPS origins; scripts contains exact HTTPS script URLs plus SRI integrity; popups can be "confirm-external" (main-window navigation guards still deny in-app popups and route https externally).',
  '- chart: pass `content` as a JSON string: {"type":"line"|"bar"|"area","xKey":"<field>","data":[{...}],"series":[{"key":"<field>","label"?,"color"?}],"title"?}.',
  '- pdf/docx/xlsx/pptx/file: reference an existing workspace `path` (no inline content). To generate finished Office/PDF deliverables, use create_office_artifact instead of writing project files.',
  '- image: pass `content` as a data: URI.',
  '',
  'To revise an existing artifact, pass its `artifactId` to append a new version (iterate). Omit it to create a new artifact.',
].join('\n');

export interface CreateArtifactHandlerDeps {
  store: ArtifactStore;
  /** Called after a successful create/version so the renderer can refetch. */
  notifyChanged: (payload: {
    id: string;
    sessionId: string;
    reason: 'created' | 'version';
  }) => void;
}

type ToolHandler = (
  input: Record<string, unknown>,
  context?: SdkToolExecutionContextLike,
) => Promise<string>;

/** The tool definition sans handler — reused for registration + introspection/tests. */
export const CREATE_ARTIFACT_TOOL = {
  name: 'create_artifact',
  description: DESCRIPTION,
  sideEffect: 'mutates-state' as const, // writes Space's internal artifact store, not the project FS
  input_schema: {
    type: 'object' as const,
    properties: {
      kind: {
        type: 'string',
        enum: [...CREATE_ARTIFACT_KINDS],
        description: 'Artifact type.',
      },
      title: { type: 'string', description: 'Short human title for the artifact.' },
      content: {
        type: 'string',
        description:
          'Inline content for content kinds (for chart: a JSON string of the chart spec).',
      },
      path: {
        type: 'string',
        description: 'Workspace file path for path-backed kinds (pdf/docx/xlsx/pptx/file).',
      },
      summary: { type: 'string', description: 'Optional one-line summary of this version.' },
      artifactId: {
        type: 'string',
        description: 'Existing artifact id to append a new version (iterate). Omit to create new.',
      },
      permissions: {
        type: 'object',
        description:
          'Optional allow-list for interactive-html only. Network/form entries are HTTPS origins. External scripts require exact HTTPS URL plus SRI integrity.',
        additionalProperties: false,
        properties: {
          connect: {
            type: 'array',
            items: { type: 'string' },
            description:
              'HTTPS origins allowed for fetch/XHR plus matching wss:// WebSocket hosts.',
          },
          style: {
            type: 'array',
            items: { type: 'string' },
            description:
              'HTTPS origins allowed for external stylesheets, in addition to inline styles.',
          },
          img: {
            type: 'array',
            items: { type: 'string' },
            description: 'HTTPS origins allowed for images, in addition to data: and blob:.',
          },
          media: {
            type: 'array',
            items: { type: 'string' },
            description: 'HTTPS origins allowed for audio/video, in addition to data: and blob:.',
          },
          font: {
            type: 'array',
            items: { type: 'string' },
            description: 'HTTPS origins allowed for fonts, in addition to data:.',
          },
          forms: {
            type: 'array',
            items: { type: 'string' },
            description: 'HTTPS origins allowed as form-action targets.',
          },
          scripts: {
            type: 'array',
            description: 'External CDN scripts allowed by exact URL. Each entry must include SRI.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', description: 'Exact HTTPS script URL without query/hash.' },
                integrity: {
                  type: 'string',
                  description: 'SRI hash, for example sha384-...',
                },
              },
              required: ['url', 'integrity'],
            },
          },
          popups: {
            type: 'string',
            enum: ['confirm-external'],
            description:
              'Allow popup attempts; app navigation guards deny in-app windows and route https externally.',
          },
        },
      },
    },
    required: ['kind', 'title'],
  },
};

/** Build the handler with injected deps (store + change notifier) for testability. */
export function makeCreateArtifactHandler(deps: CreateArtifactHandlerDeps): ToolHandler {
  return async (
    input: Record<string, unknown>,
    toolContext?: SdkToolExecutionContextLike,
  ): Promise<string> => {
    const ctx = resolveSessionRunContext(toolContext);
    if (!ctx) {
      return 'Error: create_artifact was called outside an active session run; cannot attribute the artifact.';
    }
    if (input.kind === 'react') {
      return 'Error: the "react" interactive tier is not available via create_artifact.';
    }

    // Validate the full payload through the shared IPC input schema (kind/
    // content/path coherence, byte cap, path control-char rejection).
    const hasPermissions = input.permissions !== null && typeof input.permissions === 'object';
    const normalizedKind =
      input.kind === 'html' &&
      typeof input.content === 'string' &&
      (looksLikeInteractiveHtml(input.content) || hasPermissions)
        ? 'interactive-html'
        : input.kind;

    const parsed = artifactCreateChannel.input.safeParse({
      sessionId: ctx.sessionId,
      surface: ctx.surface,
      kind: normalizedKind,
      title: input.title,
      ...(typeof input.content === 'string' ? { content: input.content } : {}),
      ...(typeof input.path === 'string' ? { path: input.path } : {}),
      ...(typeof input.summary === 'string' ? { summary: input.summary } : {}),
      ...(typeof input.artifactId === 'string' ? { id: input.artifactId } : {}),
      ...(hasPermissions ? { permissions: input.permissions } : {}),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return `Error: invalid artifact input${issue?.path?.length ? ` (${issue.path.join('.')})` : ''}: ${issue?.message ?? 'unknown'}`;
    }

    // Defense-in-depth: a doc-kind path must resolve inside the run's project root.
    // (Reads are also scope-gated downstream by files.readBinary, but don't persist
    // an out-of-scope path that other code might later consume unguarded.)
    if (parsed.data.path !== undefined && !isInsideProject(ctx.projectRoot, parsed.data.path)) {
      return 'Error: artifact path must be inside the project directory.';
    }

    try {
      const res = await deps.store.upsert(parsed.data);
      try {
        deps.notifyChanged({
          id: res.id,
          sessionId: ctx.sessionId,
          reason: res.created ? 'created' : 'version',
        });
      } catch {
        // renderer may be closing — artifact is persisted and shows on next load.
      }
      return `Artifact ${res.created ? 'created' : 'updated'}: "${parsed.data.title}" (id=${res.id}, v${res.version}). It is shown in the Artifact panel.`;
    } catch (err) {
      return `Error creating artifact: ${sanitizeErrorForTool(err)}`;
    }
  };
}

// registerTool is idempotent across the process (the registry is global).
let registered = false;

/** Test hook: reset the register-once flag so registration paths can be re-exercised. */
export function _resetCreateArtifactRegistrationForTesting(): void {
  registered = false;
}

/**
 * Register create_artifact once with the SDK coding runtime. Call after
 * loadSdkCoding(), before runManagedTask, so the agent's tool schema includes it.
 * `sdk` is the loaded coding module; typed `unknown` + runtime-guarded to avoid
 * SDK-type variance friction and to fail soft if registerTool ever drifts away.
 */
export function ensureCreateArtifactToolRegistered(sdk: unknown): void {
  if (registered) return;
  const reg = (sdk as { registerTool?: (def: unknown) => () => void }).registerTool;
  if (typeof reg !== 'function') {
    console.warn('[artifact] sdk.registerTool unavailable — create_artifact not registered');
    return;
  }
  // Set the flag only AFTER a successful registration, so a throwing reg() doesn't
  // permanently lock out re-registration on the next run. Safe to re-check the flag
  // without a lock: callers invoke this synchronously right after `await loadSdkCoding()`
  // with no intervening await, so the JS event loop serializes concurrent first-calls.
  reg({
    ...CREATE_ARTIFACT_TOOL,
    handler: makeCreateArtifactHandler({
      store: artifactStore,
      notifyChanged: (payload) => pushToRenderer('artifact.changed', payload),
    }),
  });
  registerPartnerSpaceToolPolicy({
    name: CREATE_ARTIFACT_TOOL.name,
    scope: 'artifact',
    sideEffect: CREATE_ARTIFACT_TOOL.sideEffect,
    description: 'Creates or updates Space artifacts for Partner deliverables.',
  });
  registered = true;
}
