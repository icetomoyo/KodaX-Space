import { z } from 'zod';
import { type ArtifactKindT } from '@kodax-space/space-ipc-schema';
import type { ArtifactStore } from './store.js';
import { artifactStore } from './store.js';
import {
  createOfficeArtifactBytes,
  normalizeSafeWorksheetFormula,
  type OfficeArtifactKind,
} from './office-writers.js';
import {
  resolveSessionRunContext,
  type SdkToolExecutionContextLike,
} from '../kodax/session-run-context.js';
import { pushToRenderer } from '../ipc/push.js';
import { registerPartnerSpaceToolPolicy } from '../kodax/partner-tools.js';
import { adminPolicyAuditStore } from '../kodax/admin-policy-audit-store.js';

const officeKindSchema = z.enum(['docx', 'pdf', 'xlsx', 'pptx']);

const sourceRefSchema = z
  .object({
    label: z.string().min(1).max(256),
    uri: z.string().max(2048).optional(),
    note: z.string().max(512).optional(),
  })
  .strict();

const documentBlockSchema = z
  .object({
    type: z.enum(['heading', 'paragraph', 'bullets', 'table']),
    text: z.string().max(16_384).optional(),
    level: z.number().int().min(0).max(3).optional(),
    items: z.array(z.string().max(2048)).max(128).optional(),
    rows: z
      .array(z.array(z.string().max(2048)).max(32))
      .max(256)
      .optional(),
  })
  .strict();

const documentPayloadSchema = z
  .object({
    subtitle: z.string().max(512).optional(),
    blocks: z.array(documentBlockSchema).max(512).optional(),
  })
  .strict();

const cellValueSchema = z.union([z.string().max(32_767), z.number(), z.boolean(), z.null()]);

const formulaCellSchema = z
  .string()
  .regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/)
  .refine((address) => {
    const match = /^([A-Z]+)([0-9]+)$/.exec(address);
    if (!match) return false;
    let column = 0;
    for (const character of match[1]!) {
      column = column * 26 + character.charCodeAt(0) - 64;
    }
    const row = Number(match[2]);
    return column >= 1 && column <= 16_384 && row >= 1 && row <= 1_048_576;
  }, 'formula cell must be inside the Excel worksheet grid');

const worksheetFormulaSchema = z
  .string()
  .min(1)
  .max(2048)
  .superRefine((formula, ctx) => {
    try {
      normalizeSafeWorksheetFormula(formula);
    } catch (error: unknown) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'unsafe Excel formula',
      });
    }
  });

const workbookPayloadSchema = z
  .object({
    sheets: z
      .array(
        z
          .object({
            name: z.string().min(1).max(64),
            rows: z.array(z.array(cellValueSchema).max(128)).min(1).max(5000),
            formulas: z
              .array(
                z
                  .object({
                    cell: formulaCellSchema,
                    formula: worksheetFormulaSchema,
                  })
                  .strict(),
              )
              .max(512)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict();

const presentationPayloadSchema = z
  .object({
    slides: z
      .array(
        z
          .object({
            title: z.string().min(1).max(256),
            subtitle: z.string().max(512).optional(),
            bullets: z.array(z.string().max(512)).max(12).optional(),
            notes: z.string().max(4096).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(80),
  })
  .strict();

const officeArtifactInputSchema = z
  .object({
    kind: officeKindSchema,
    title: z.string().min(1).max(256),
    content: z.string().max(262_144).optional(),
    document: documentPayloadSchema.optional(),
    workbook: workbookPayloadSchema.optional(),
    presentation: presentationPayloadSchema.optional(),
    sourceRefs: z.array(sourceRefSchema).max(64).optional(),
    citations: z.array(sourceRefSchema).max(64).optional(),
    summary: z.string().max(512).optional(),
    artifactId: z.string().min(1).max(128).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.kind === 'docx' || value.kind === 'pdf') && !value.document && !value.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'docx/pdf require document or content',
        path: ['document'],
      });
    }
    if (value.kind === 'xlsx' && !value.workbook) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'xlsx requires workbook',
        path: ['workbook'],
      });
    }
    if (value.kind === 'pptx' && !value.presentation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pptx requires presentation',
        path: ['presentation'],
      });
    }
  });

type OfficeArtifactInput = z.infer<typeof officeArtifactInputSchema>;

type ToolHandler = (
  input: Record<string, unknown>,
  context?: SdkToolExecutionContextLike,
) => Promise<string>;

function sanitizeErrorForTool(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/[A-Za-z]:[\\/][^\s'"]+/g, '<path>')
    .replace(/\\\\[^\s'"]+/g, '<path>')
    .replace(/\/[\w.-]+\/[^\s'"]*/g, '<path>')
    .slice(0, 240);
}

function kindForStore(kind: OfficeArtifactKind): ArtifactKindT {
  return kind;
}

export const CREATE_OFFICE_ARTIFACT_TOOL = {
  name: 'create_office_artifact',
  description: [
    'Create or update a structured baseline Office/PDF deliverable as a Space-owned artifact.',
    'Use this for Partner deliverables that should become downloadable files: docx reports, pdf memos, xlsx workbooks, or pptx briefing decks.',
    'This tool writes only to the internal artifact store. It does not write to the project or arbitrary filesystem paths; the user exports from the Artifact panel explicitly.',
    '',
    'Inputs:',
    '- kind: docx | pdf | xlsx | pptx.',
    '- docx/pdf: provide document.blocks or content.',
    '- xlsx: provide workbook.sheets with rows and optional local-only formulas like {cell:"C2", formula:"=SUM(A2:B2)"}; external workbook links, DDE/network functions, paths, and non-allowlisted functions are rejected.',
    '- pptx: provide presentation.slides with title, optional subtitle, bullets, and speaker notes.',
    '- sourceRefs/citations are embedded into document deliverables and retained in the artifact version metadata hash.',
    '- artifactId appends a new version to an existing generated office artifact.',
  ].join('\n'),
  sideEffect: 'mutates-state' as const,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['docx', 'pdf', 'xlsx', 'pptx'] },
      title: { type: 'string' },
      content: { type: 'string' },
      document: {
        type: 'object',
        additionalProperties: false,
        properties: {
          subtitle: { type: 'string' },
          blocks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                type: { type: 'string', enum: ['heading', 'paragraph', 'bullets', 'table'] },
                text: { type: 'string' },
                level: { type: 'number' },
                items: { type: 'array', items: { type: 'string' } },
                rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
              },
              required: ['type'],
            },
          },
        },
      },
      workbook: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sheets: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                rows: {
                  type: 'array',
                  items: {
                    type: 'array',
                    items: { type: ['string', 'number', 'boolean', 'null'] },
                  },
                },
                formulas: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      cell: { type: 'string' },
                      formula: { type: 'string' },
                    },
                    required: ['cell', 'formula'],
                  },
                },
              },
              required: ['name', 'rows'],
            },
          },
        },
        required: ['sheets'],
      },
      presentation: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slides: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string' },
                subtitle: { type: 'string' },
                bullets: { type: 'array', items: { type: 'string' } },
                notes: { type: 'string' },
              },
              required: ['title'],
            },
          },
        },
        required: ['slides'],
      },
      sourceRefs: { type: 'array', items: { type: 'object' } },
      citations: { type: 'array', items: { type: 'object' } },
      summary: { type: 'string' },
      artifactId: { type: 'string' },
    },
    required: ['kind', 'title'],
  },
};

export interface CreateOfficeArtifactHandlerDeps {
  store: ArtifactStore;
  notifyChanged: (payload: {
    id: string;
    sessionId: string;
    reason: 'created' | 'version';
  }) => void;
}

export function makeCreateOfficeArtifactHandler(
  deps: CreateOfficeArtifactHandlerDeps,
): ToolHandler {
  return async (
    input: Record<string, unknown>,
    toolContext?: SdkToolExecutionContextLike,
  ): Promise<string> => {
    const ctx = resolveSessionRunContext(toolContext);
    if (!ctx) {
      return 'Error: create_office_artifact was called outside an active session run; cannot attribute the artifact.';
    }
    const parsed = officeArtifactInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return `Error: invalid office artifact input${issue?.path?.length ? ` (${issue.path.join('.')})` : ''}: ${issue?.message ?? 'unknown'}`;
    }

    const data: OfficeArtifactInput = parsed.data;
    try {
      await adminPolicyAuditStore.assertArtifactGenerationAllowed({
        sessionId: ctx.sessionId,
        projectRoot: ctx.projectRoot,
        kind: data.kind,
        title: data.title,
      });
      const rendered = await createOfficeArtifactBytes(data);
      const res = await deps.store.upsertGeneratedFile({
        sessionId: ctx.sessionId,
        surface: ctx.surface,
        kind: kindForStore(data.kind),
        title: data.title,
        bytes: rendered.bytes,
        filename: rendered.filename,
        ...(data.summary !== undefined ? { summary: data.summary } : {}),
        ...(data.artifactId !== undefined ? { id: data.artifactId } : {}),
      });
      try {
        deps.notifyChanged({
          id: res.id,
          sessionId: ctx.sessionId,
          reason: res.created ? 'created' : 'version',
        });
      } catch {
        // Renderer may be gone; the artifact is persisted.
      }
      await adminPolicyAuditStore.record({
        category: 'artifact',
        action: 'artifact.generateOffice',
        outcome: 'allowed',
        projectRoot: ctx.projectRoot,
        sessionId: ctx.sessionId,
        resource: res.id,
        details: { kind: data.kind, title: data.title, version: res.version },
      });
      return `Office artifact ${res.created ? 'created' : 'updated'}: "${data.title}" (id=${res.id}, v${res.version}, kind=${data.kind}). It is shown in the Artifact panel and can be exported by the user.`;
    } catch (err) {
      return `Error creating office artifact: ${sanitizeErrorForTool(err)}`;
    }
  };
}

let registered = false;

export function _resetOfficeArtifactRegistrationForTesting(): void {
  registered = false;
}

export function ensureOfficeArtifactToolRegistered(sdk: unknown): void {
  if (registered) return;
  const reg = (sdk as { registerTool?: (def: unknown) => () => void }).registerTool;
  if (typeof reg !== 'function') {
    console.warn('[artifact] sdk.registerTool unavailable - create_office_artifact not registered');
    return;
  }
  reg({
    ...CREATE_OFFICE_ARTIFACT_TOOL,
    handler: makeCreateOfficeArtifactHandler({
      store: artifactStore,
      notifyChanged: (payload) => pushToRenderer('artifact.changed', payload),
    }),
  });
  registerPartnerSpaceToolPolicy({
    name: CREATE_OFFICE_ARTIFACT_TOOL.name,
    scope: 'artifact',
    sideEffect: CREATE_OFFICE_ARTIFACT_TOOL.sideEffect,
    description:
      'Creates Space-owned generated Office/PDF artifact files for Partner deliverables.',
  });
  registered = true;
}
