import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  adminAuditEventSchema,
  adminPolicySchema,
  adminPolicySchemaVersion,
  type AdminAuditCategoryT,
  type AdminAuditEventT,
  type AdminAuditOutcomeT,
  type AdminPolicyT,
  type AdminPolicyUpdateT,
} from '@kodax-space/space-ipc-schema';
import { replaceFileWithoutFollowingAliases } from './atomic-file.js';
import { getSpaceDataDir } from './data-paths.js';

const MAX_AUDIT_EVENTS = 50_000;

const fileSchema = z.object({
  version: z.literal(1),
  policy: adminPolicySchema.optional(),
  auditEvents: z.array(adminAuditEventSchema).max(MAX_AUDIT_EVENTS).default([]),
});

type AdminPolicyAuditFile = z.infer<typeof fileSchema>;

export interface AdminAuditRecordInput {
  readonly category: AdminAuditCategoryT;
  readonly action: string;
  readonly outcome: AdminAuditOutcomeT;
  readonly projectRoot?: string;
  readonly sessionId?: string;
  readonly resource?: string;
  readonly details?: unknown;
}

export interface AdminPolicyView {
  readonly policy: AdminPolicyT;
  readonly source: 'default' | 'local-file';
}

function defaultPolicy(): AdminPolicyT {
  return {
    schema: adminPolicySchemaVersion,
    providers: { allow: [], deny: [] },
    mcp: { allow: [], deny: [] },
    connectors: { allow: [], deny: [], writesAllowed: false },
    artifact: { generateOfficeAllowed: true, exportAllowed: true },
    workspaceFileProposals: {
      createAllowed: true,
      applyAllowed: true,
      exportAllowed: true,
      allowedExtensions: [],
    },
    workspaceDeliveries: {
      writeAllowed: true,
      workspaceWriteAllowed: false,
      registerWorkspaceAllowed: false,
      allowedExtensions: [],
    },
    automation: {
      enabled: false,
      connectorWritesAllowed: false,
      filesystemExportsAllowed: false,
    },
    remoteRunner: { enabled: false },
    desktopAutomation: { enabled: false },
    redaction: { enabled: true, extraPatterns: [] },
    userOverrides: { allowed: true, requireReason: false },
    updatedAt: 0,
  };
}

function emptyFile(): AdminPolicyAuditFile {
  return { version: 1, auditEvents: [] };
}

async function atomicWriteJson(filePath: string, value: AdminPolicyAuditFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await replaceFileWithoutFollowingAliases(
    filePath,
    Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
    'Admin policy audit store changed during atomic replacement',
  );
}

function cloneFile(file: AdminPolicyAuditFile): AdminPolicyAuditFile {
  return {
    version: 1,
    ...(file.policy ? { policy: structuredClone(file.policy) as AdminPolicyT } : {}),
    auditEvents: file.auditEvents.map((event) => ({ ...event })),
  };
}

function serializeDetails(details: unknown): string {
  if (details === undefined) return '';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function redactDetails(
  raw: string,
  policy: AdminPolicyT,
): { text: string; redacted: boolean; diagnostics: string[] } {
  if (!policy.redaction.enabled || raw.length === 0)
    return { text: raw.slice(0, 4000), redacted: false, diagnostics: [] };
  let text = raw;
  let redacted = false;
  const diagnostics: string[] = [];
  const builtIns = [
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"',\s}]{6,}/gi,
    /\bsk-[A-Za-z0-9]{12,}\b/g,
  ];
  for (const pattern of builtIns) {
    text = text.replace(pattern, () => {
      redacted = true;
      return '[REDACTED]';
    });
  }
  for (const rawPattern of policy.redaction.extraPatterns) {
    try {
      const pattern = new RegExp(rawPattern, 'g');
      text = text.replace(pattern, () => {
        redacted = true;
        return '[REDACTED]';
      });
    } catch {
      diagnostics.push(`Invalid redaction pattern ignored: ${rawPattern.slice(0, 80)}`);
    }
  }
  return { text: text.slice(0, 4000), redacted, diagnostics };
}

function targetPathFromDetails(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const value =
    (details as { targetPath?: unknown }).targetPath ??
    (details as { relativePath?: unknown }).relativePath;
  return typeof value === 'string' ? value : null;
}

function normalizeAllowedExtension(ext: string): string {
  const trimmed = ext.trim().toLowerCase();
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function extensionAllowed(policy: AdminPolicyT, details: unknown): boolean {
  const allowedExtensions =
    policy.workspaceFileProposals.allowedExtensions.map(normalizeAllowedExtension);
  return extensionAllowedByList(allowedExtensions, details);
}

function deliveryExtensionAllowed(policy: AdminPolicyT, details: unknown): boolean {
  const allowedExtensions =
    policy.workspaceDeliveries.allowedExtensions.map(normalizeAllowedExtension);
  return extensionAllowedByList(allowedExtensions, details);
}

function extensionAllowedByList(allowedExtensions: string[], details: unknown): boolean {
  if (allowedExtensions.length === 0) return true;
  const targetPath = targetPathFromDetails(details);
  if (!targetPath) return false;
  const ext = path.posix.extname(targetPath.replace(/\\/g, '/')).toLowerCase();
  return ext.length > 0 && allowedExtensions.includes(ext);
}

function mergePolicy(base: AdminPolicyT, update: AdminPolicyUpdateT): AdminPolicyT {
  return {
    schema: adminPolicySchemaVersion,
    providers: { ...base.providers, ...(update.providers ?? {}) },
    mcp: { ...base.mcp, ...(update.mcp ?? {}) },
    connectors: { ...base.connectors, ...(update.connectors ?? {}) },
    artifact: { ...base.artifact, ...(update.artifact ?? {}) },
    workspaceFileProposals: {
      ...base.workspaceFileProposals,
      ...(update.workspaceFileProposals ?? {}),
    },
    workspaceDeliveries: {
      ...base.workspaceDeliveries,
      ...(update.workspaceDeliveries ?? {}),
    },
    automation: { ...base.automation, ...(update.automation ?? {}) },
    remoteRunner: { ...base.remoteRunner, ...(update.remoteRunner ?? {}) },
    desktopAutomation: { ...base.desktopAutomation, ...(update.desktopAutomation ?? {}) },
    redaction: { ...base.redaction, ...(update.redaction ?? {}) },
    userOverrides: { ...base.userOverrides, ...(update.userOverrides ?? {}) },
    updatedAt: Date.now(),
  };
}

export class AdminPolicyAuditStore {
  private cached: AdminPolicyAuditFile | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string = path.join(getSpaceDataDir(), 'admin-policy-audit.json'),
  ) {}

  async getPolicy(): Promise<AdminPolicyView> {
    const file = await this.load();
    return file.policy
      ? { policy: structuredClone(file.policy) as AdminPolicyT, source: 'local-file' }
      : { policy: defaultPolicy(), source: 'default' };
  }

  async setPolicy(
    update: AdminPolicyUpdateT,
  ): Promise<{ policy: AdminPolicyT; diagnostics: string[] }> {
    return this.mutate<{ policy: AdminPolicyT; diagnostics: string[] }>((current) => {
      const policy = mergePolicy(current.policy ?? defaultPolicy(), update);
      const parsed = adminPolicySchema.safeParse(policy);
      const diagnostics = parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
      if (!parsed.success) {
        throw new Error(`Invalid admin policy: ${diagnostics.join('; ')}`);
      }
      const next = { ...current, policy: parsed.data };
      return { next, result: { policy: parsed.data, diagnostics } };
    }).then(async (result) => {
      await this.record({
        category: 'policy',
        action: 'policy.set',
        outcome: 'info',
        details: { updatedAt: result.policy.updatedAt },
      });
      return result;
    });
  }

  async exportPolicy(): Promise<{ filename: string; json: string }> {
    const { policy } = await this.getPolicy();
    return { filename: 'kodax-space-admin-policy.json', json: JSON.stringify(policy, null, 2) };
  }

  async record(input: AdminAuditRecordInput): Promise<AdminAuditEventT> {
    const { policy } = await this.getPolicy();
    const redacted = redactDetails(serializeDetails(input.details), policy);
    return this.mutate<AdminAuditEventT>((current) => {
      const event: AdminAuditEventT = {
        id: `audit_${randomUUID()}`,
        createdAt: Date.now(),
        category: input.category,
        action: input.action.slice(0, 128),
        outcome: input.outcome,
        ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.resource ? { resource: input.resource.slice(0, 512) } : {}),
        details: redacted.text,
        redacted: redacted.redacted,
      };
      return {
        next: {
          ...current,
          auditEvents: [...current.auditEvents, event].slice(-MAX_AUDIT_EVENTS),
        },
        result: event,
      };
    });
  }

  async listAudit(input?: {
    readonly category?: AdminAuditCategoryT;
    readonly limit?: number;
  }): Promise<AdminAuditEventT[]> {
    const file = await this.load();
    return file.auditEvents
      .filter((event) => !input?.category || event.category === input.category)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, Math.min(input?.limit ?? 200, 1000)))
      .map((event) => ({ ...event }));
  }

  async exportAuditJsonl(input?: {
    readonly category?: AdminAuditCategoryT;
    readonly limit?: number;
  }): Promise<{ filename: string; jsonl: string }> {
    const filter: { category?: AdminAuditCategoryT; limit?: number } = {
      limit: Math.min(input?.limit ?? 10_000, 10_000),
    };
    if (input?.category) filter.category = input.category;
    const events = await this.listAudit(filter);
    return {
      filename: 'kodax-space-audit.jsonl',
      jsonl: events.map((event) => JSON.stringify(event)).join('\n'),
    };
  }

  async assertArtifactGenerationAllowed(details?: unknown): Promise<void> {
    const { policy } = await this.getPolicy();
    if (policy.artifact.generateOfficeAllowed) return;
    await this.record({
      category: 'artifact',
      action: 'artifact.generateOffice',
      outcome: 'blocked',
      details,
    });
    throw new Error('Office artifact generation is blocked by local admin policy.');
  }

  async assertArtifactExportAllowed(details?: unknown): Promise<void> {
    const { policy } = await this.getPolicy();
    if (policy.artifact.exportAllowed) return;
    await this.record({
      category: 'artifact',
      action: 'artifact.export',
      outcome: 'blocked',
      details,
    });
    throw new Error('Artifact export is blocked by local admin policy.');
  }

  async assertFileProposalCreateAllowed(details?: unknown): Promise<void> {
    const { policy } = await this.getPolicy();
    if (policy.workspaceFileProposals.createAllowed && extensionAllowed(policy, details)) return;
    await this.record({
      category: 'workspace-file',
      action: 'fileProposal.create',
      outcome: 'blocked',
      details: {
        ...(details && typeof details === 'object' ? details : {}),
        reason: policy.workspaceFileProposals.createAllowed
          ? 'extension not allowed'
          : 'create disabled',
      },
    });
    if (policy.workspaceFileProposals.createAllowed) {
      throw new Error('Workspace file proposal extension is blocked by local admin policy.');
    }
    throw new Error('Workspace file proposals are blocked by local admin policy.');
  }

  async assertFileProposalApplyAllowed(details?: unknown): Promise<void> {
    const { policy } = await this.getPolicy();
    if (policy.workspaceFileProposals.applyAllowed && extensionAllowed(policy, details)) return;
    await this.record({
      category: 'workspace-file',
      action: 'fileProposal.apply',
      outcome: 'blocked',
      details: {
        ...(details && typeof details === 'object' ? details : {}),
        reason: policy.workspaceFileProposals.applyAllowed
          ? 'extension not allowed'
          : 'apply disabled',
      },
    });
    if (policy.workspaceFileProposals.applyAllowed) {
      throw new Error('Workspace file proposal extension is blocked by local admin policy.');
    }
    throw new Error('Applying workspace file proposals is blocked by local admin policy.');
  }

  async assertFileProposalExportAllowed(details?: unknown): Promise<void> {
    const { policy } = await this.getPolicy();
    if (policy.workspaceFileProposals.exportAllowed && extensionAllowed(policy, details)) return;
    await this.record({
      category: 'workspace-file',
      action: 'fileProposal.export',
      outcome: 'blocked',
      details: {
        ...(details && typeof details === 'object' ? details : {}),
        reason: policy.workspaceFileProposals.exportAllowed
          ? 'extension not allowed'
          : 'export disabled',
      },
    });
    if (policy.workspaceFileProposals.exportAllowed) {
      throw new Error('Workspace file proposal extension is blocked by local admin policy.');
    }
    throw new Error('Exporting workspace file proposals is blocked by local admin policy.');
  }

  async assertDeliveryWriteAllowed(details?: unknown): Promise<void> {
    const { policy } = await this.getPolicy();
    if (policy.workspaceDeliveries.writeAllowed && deliveryExtensionAllowed(policy, details))
      return;
    await this.record({
      category: 'workspace-file',
      action: 'delivery.writeRunOutput',
      outcome: 'blocked',
      details: {
        ...(details && typeof details === 'object' ? details : {}),
        reason: policy.workspaceDeliveries.writeAllowed
          ? 'extension not allowed'
          : 'write disabled',
      },
    });
    if (policy.workspaceDeliveries.writeAllowed) {
      throw new Error('Partner delivery extension is blocked by local admin policy.');
    }
    throw new Error('Partner delivery writes are blocked by local admin policy.');
  }

  async assertDeliveryRegisterWorkspaceAllowed(details?: unknown): Promise<void> {
    const { policy } = await this.getPolicy();
    if (
      policy.workspaceDeliveries.registerWorkspaceAllowed &&
      deliveryExtensionAllowed(policy, details)
    ) {
      return;
    }
    await this.record({
      category: 'workspace-file',
      action: 'delivery.registerWorkspace',
      outcome: 'blocked',
      details: {
        ...(details && typeof details === 'object' ? details : {}),
        reason: policy.workspaceDeliveries.registerWorkspaceAllowed
          ? 'extension not allowed'
          : 'register disabled',
      },
    });
    if (policy.workspaceDeliveries.registerWorkspaceAllowed) {
      throw new Error('Partner workspace delivery extension is blocked by local admin policy.');
    }
    throw new Error('Registering workspace deliveries is blocked by local admin policy.');
  }

  async assertDeliveryWorkspaceWriteAllowed(details?: unknown): Promise<void> {
    const { policy } = await this.getPolicy();
    if (
      policy.workspaceDeliveries.workspaceWriteAllowed &&
      deliveryExtensionAllowed(policy, details)
    ) {
      return;
    }
    await this.record({
      category: 'workspace-file',
      action: 'delivery.writeWorkspaceFile',
      outcome: 'blocked',
      details: {
        ...(details && typeof details === 'object' ? details : {}),
        reason: policy.workspaceDeliveries.workspaceWriteAllowed
          ? 'extension not allowed'
          : 'workspace write disabled',
      },
    });
    if (policy.workspaceDeliveries.workspaceWriteAllowed) {
      throw new Error('Partner workspace write extension is blocked by local admin policy.');
    }
    throw new Error('Partner workspace writes are blocked by local admin policy.');
  }

  invalidate(): void {
    this.cached = null;
  }

  private async load(): Promise<AdminPolicyAuditFile> {
    if (this.cached) return cloneFile(this.cached);
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw new Error(
          `schema invalid: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
        );
      }
      this.cached = parsed.data;
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        this.cached = emptyFile();
      } else {
        throw new Error(
          `Admin policy/audit store is corrupt or unreadable; refusing to overwrite it: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }
    return cloneFile(this.cached);
  }

  private async mutate<R>(
    apply: (current: AdminPolicyAuditFile) => { next: AdminPolicyAuditFile; result: R },
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

export const adminPolicyAuditStore = new AdminPolicyAuditStore();
