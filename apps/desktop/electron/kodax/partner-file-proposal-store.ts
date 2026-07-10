import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  MAX_PARTNER_FILE_PROPOSAL_CONTENT_BYTES,
  MAX_PARTNER_FILE_PROPOSAL_DIFF_BYTES,
  partnerFileProposalSchema,
  type PartnerFileProposalOperationT,
  type PartnerFileProposalSafetyT,
  type PartnerFileProposalSummaryT,
  type PartnerFileProposalT,
} from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from './data-paths.js';
import {
  isPathInside,
  looksBinary,
  recordDiff,
  toPosixRelative,
  truncate,
} from '../ipc/files-core.js';
import { replaceFileIfUnchanged, replaceFileWithoutFollowingAliases } from './atomic-file.js';
import { assertPartnerWritablePathNotSensitive } from './partner-file-guards.js';

const MAX_PROPOSALS = 10_000;

const fileSchema = z.object({
  version: z.literal(1),
  proposals: z.array(partnerFileProposalSchema).max(MAX_PROPOSALS),
});

type PartnerFileProposalsFile = z.infer<typeof fileSchema>;
type MaybePromise<T> = T | Promise<T>;

interface ProposalMutationResult {
  readonly ok: boolean;
  readonly proposal?: PartnerFileProposalSummaryT;
  readonly error?: string;
}

export interface PartnerFileProposalCreateInput {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly operation: PartnerFileProposalOperationT;
  readonly targetPath: string;
  readonly content: string;
  readonly rationale?: string;
  readonly sourceRefs?: readonly string[];
}

export interface PartnerFileProposalListFilter {
  readonly sessionId?: string;
  readonly projectRoot?: string;
  readonly status?: PartnerFileProposalT['status'];
}

export interface PartnerFileProposalApplyInput {
  readonly id: string;
  readonly expectedContentHash: string;
  readonly assertAllowedProjectRoot?: (projectRoot: string) => Promise<string>;
}

export interface PartnerFileProposalStoreHooks {
  readonly beforeApplyCommit?: (absolutePath: string) => Promise<void> | void;
}

const SAFE_TEXT_EXTS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.tsv',
  '.html',
  '.htm',
  '.css',
]);

const CONFIG_EXTS = new Set(['.toml', '.ini', '.cfg', '.conf', '.env', '.properties']);

const CODE_EXTS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.php',
  '.rb',
  '.sh',
  '.ps1',
  '.sql',
  '.xml',
]);

const BLOCKED_EXTS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.zip',
  '.7z',
  '.tar',
  '.gz',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
]);

function sha256Text(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function normalizeTargetPath(input: string): string {
  if (/[\x00\r\n]/.test(input)) throw new Error('target path contains control characters');
  const unified = input.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = unified.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) throw new Error('target path is required');
  for (const part of parts) {
    if (part === '.' || part === '..') throw new Error('target path cannot contain dot segments');
    if (part.startsWith('.')) {
      throw new Error(`hidden path segment is not allowed: ${truncate(part)}`);
    }
  }
  assertPartnerWritablePathNotSensitive(parts, 'target path');
  return parts.join('/');
}

function classifyTarget(targetPath: string): PartnerFileProposalSafetyT {
  const ext = path.posix.extname(targetPath).toLowerCase();
  if (BLOCKED_EXTS.has(ext)) {
    throw new Error(`unsupported binary or office file type: ${ext || '(none)'}`);
  }
  if (SAFE_TEXT_EXTS.has(ext)) {
    return { classification: 'safe-text', risk: 'low', warnings: [] };
  }
  if (CONFIG_EXTS.has(ext)) {
    return {
      classification: 'config',
      risk: 'medium',
      warnings: ['Config file changes require careful review before apply.'],
    };
  }
  if (CODE_EXTS.has(ext)) {
    return {
      classification: 'code',
      risk: 'medium',
      warnings: [
        'Code file proposal should be handed to Coder when the change becomes implementation-heavy.',
      ],
    };
  }
  return {
    classification: 'unknown-text',
    risk: 'medium',
    warnings: ['Unknown text file type; review the diff before applying.'],
  };
}

function assertTextContent(content: string): void {
  if (content.includes('\u0000')) throw new Error('content contains NUL byte');
  if (Buffer.byteLength(content, 'utf8') > MAX_PARTNER_FILE_PROPOSAL_CONTENT_BYTES) {
    throw new Error(`content exceeds ${MAX_PARTNER_FILE_PROPOSAL_CONTENT_BYTES} bytes`);
  }
}

async function atomicWriteJson(filePath: string, value: PartnerFileProposalsFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await replaceFileWithoutFollowingAliases(
    filePath,
    Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
    'Partner file proposal registry changed during atomic replacement',
  );
}

interface ResolvedTarget {
  readonly realRoot: string;
  readonly absPath: string;
  readonly targetPath: string;
}

async function resolveWritableTarget(
  projectRoot: string,
  targetPath: string,
): Promise<ResolvedTarget> {
  const realRoot = await fs.realpath(path.resolve(projectRoot));
  const normalized = normalizeTargetPath(targetPath);
  const absPath = path.resolve(realRoot, ...normalized.split('/'));
  if (!isPathInside(absPath, realRoot)) {
    throw new Error(`target path escapes project root: ${truncate(targetPath)}`);
  }
  const parent = path.dirname(absPath);
  let realParent: string;
  try {
    realParent = await fs.realpath(parent);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new Error('target parent directory does not exist');
    }
    throw err;
  }
  if (!isPathInside(realParent, realRoot)) {
    throw new Error('target path escapes project root via symlink parent');
  }
  return { realRoot, absPath, targetPath: toPosixRelative(absPath, realRoot) };
}

async function assertTargetNotSymlink(absPath: string): Promise<void> {
  try {
    const stat = await fs.lstat(absPath);
    if (stat.isSymbolicLink()) throw new Error('target path cannot be a symbolic link');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return;
    throw err;
  }
}

interface ExistingText {
  readonly exists: boolean;
  readonly content: string;
  readonly hash: string | null;
}

async function readExistingText(absPath: string): Promise<ExistingText> {
  try {
    const stat = await fs.lstat(absPath);
    if (stat.isSymbolicLink()) throw new Error('target path cannot be a symbolic link');
    if (!stat.isFile()) throw new Error('target is not a regular file');
    if (stat.size > MAX_PARTNER_FILE_PROPOSAL_CONTENT_BYTES) {
      throw new Error('target file is too large for reviewed update');
    }
    const buf = await fs.readFile(absPath);
    if (looksBinary(buf))
      throw new Error('binary target files cannot be edited by Partner proposals');
    const content = buf.toString('utf-8');
    return { exists: true, content, hash: sha256Text(content) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { exists: false, content: '', hash: null };
    }
    throw err;
  }
}

async function writeProposalContent(
  target: ResolvedTarget,
  operation: PartnerFileProposalOperationT,
  content: string,
  expectedHash: string | null,
): Promise<void> {
  await assertTargetNotSymlink(target.absPath);
  if (operation === 'create') {
    await fs.writeFile(target.absPath, content, {
      encoding: 'utf-8',
      flag: 'wx',
      mode: 0o600,
    });
    return;
  }

  if (expectedHash === null) throw new Error('update proposal is missing base content hash');
  await replaceFileIfUnchanged(
    target.absPath,
    Buffer.from(content, 'utf8'),
    expectedHash,
    'target changed before proposal apply',
    MAX_PARTNER_FILE_PROPOSAL_CONTENT_BYTES,
  );
}

function capText(text: string): { value: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= MAX_PARTNER_FILE_PROPOSAL_DIFF_BYTES) {
    return { value: text, truncated: false };
  }
  return {
    value: `${Buffer.from(text, 'utf8').subarray(0, MAX_PARTNER_FILE_PROPOSAL_DIFF_BYTES).toString('utf8')}\n[truncated]`,
    truncated: true,
  };
}

function buildDiff(
  before: string,
  after: string,
  targetPath: string,
): PartnerFileProposalT['diff'] {
  const beforeCap = capText(before);
  const afterCap = capText(after);
  const unifiedRaw = [
    `--- a/${targetPath}`,
    `+++ b/${targetPath}`,
    '@@ full-file proposal @@',
    before.length > 0 ? before : '[new file]',
    '--- proposed content ---',
    after,
  ].join('\n');
  const unifiedCap = capText(unifiedRaw);
  return {
    before: beforeCap.value,
    after: afterCap.value,
    unified: unifiedCap.value,
    truncated: beforeCap.truncated || afterCap.truncated || unifiedCap.truncated,
  };
}

function toSummary(proposal: PartnerFileProposalT): PartnerFileProposalSummaryT {
  const { content: _content, diff: _diff, ...summary } = proposal;
  return summary;
}

export class PartnerFileProposalStore {
  private cached: PartnerFileProposalT[] | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string = path.join(getSpaceDataDir(), 'partner-file-proposals.json'),
    private readonly hooks: PartnerFileProposalStoreHooks = {},
  ) {}

  async list(filter: PartnerFileProposalListFilter = {}): Promise<PartnerFileProposalSummaryT[]> {
    const all = await this.load();
    return all
      .filter((proposal) => {
        if (filter.sessionId !== undefined && proposal.sessionId !== filter.sessionId) return false;
        if (filter.projectRoot !== undefined && proposal.projectRoot !== filter.projectRoot)
          return false;
        if (filter.status !== undefined && proposal.status !== filter.status) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toSummary);
  }

  async get(id: string): Promise<PartnerFileProposalT | null> {
    const all = await this.load();
    return all.find((proposal) => proposal.id === id) ?? null;
  }

  async create(input: PartnerFileProposalCreateInput): Promise<PartnerFileProposalT> {
    assertTextContent(input.content);
    const target = await resolveWritableTarget(input.projectRoot, input.targetPath);
    const safety = classifyTarget(target.targetPath);
    const existing = await readExistingText(target.absPath);
    if (input.operation === 'create' && existing.exists) {
      throw new Error('create proposal target already exists');
    }
    if (input.operation === 'update' && !existing.exists) {
      throw new Error('update proposal target does not exist');
    }
    const now = Date.now();
    const proposal: PartnerFileProposalT = {
      id: `pfp_${randomUUID()}`,
      sessionId: input.sessionId,
      projectRoot: path.resolve(input.projectRoot),
      targetPath: target.targetPath,
      operation: input.operation,
      status: 'pending',
      content: input.content,
      contentHash: sha256Text(input.content),
      baseContentHash: existing.hash,
      ...(input.rationale !== undefined ? { rationale: input.rationale.slice(0, 1024) } : {}),
      sourceRefs: [...(input.sourceRefs ?? [])].slice(0, 64).map((ref) => ref.slice(0, 256)),
      safety,
      diff: buildDiff(existing.content, input.content, target.targetPath),
      createdAt: now,
      updatedAt: now,
    };
    return this.mutate((current) => {
      if (current.length >= MAX_PROPOSALS) {
        throw new Error(`Partner file proposal limit reached (${MAX_PROPOSALS})`);
      }
      return { next: [...current, proposal], result: proposal };
    });
  }

  async apply(input: PartnerFileProposalApplyInput): Promise<ProposalMutationResult> {
    const assertAllowedProjectRoot =
      input.assertAllowedProjectRoot ?? ((projectRoot: string) => Promise.resolve(projectRoot));
    return this.mutate<ProposalMutationResult>(async (current) => {
      const idx = current.findIndex((proposal) => proposal.id === input.id);
      if (idx < 0) return { next: current, result: { ok: false, error: 'proposal not found' } };
      const proposal = current[idx]!;
      if (proposal.status !== 'pending') {
        return {
          next: current,
          result: {
            ok: false,
            proposal: toSummary(proposal),
            error: `proposal is already ${proposal.status}`,
          },
        };
      }
      if (proposal.contentHash !== input.expectedContentHash) {
        return {
          next: current,
          result: { ok: false, proposal: toSummary(proposal), error: 'content hash mismatch' },
        };
      }
      try {
        const allowedRoot = await assertAllowedProjectRoot(proposal.projectRoot);
        const target = await resolveWritableTarget(allowedRoot, proposal.targetPath);
        const existing = await readExistingText(target.absPath);
        if (proposal.operation === 'create' && existing.exists) {
          return {
            next: current,
            result: { ok: false, proposal: toSummary(proposal), error: 'target already exists' },
          };
        }
        if (proposal.operation === 'update') {
          if (!existing.exists) {
            return {
              next: current,
              result: {
                ok: false,
                proposal: toSummary(proposal),
                error: 'target no longer exists',
              },
            };
          }
          if (existing.hash !== proposal.baseContentHash) {
            return {
              next: current,
              result: {
                ok: false,
                proposal: toSummary(proposal),
                error: 'target changed after proposal preview',
              },
            };
          }
        }
        await this.hooks.beforeApplyCommit?.(target.absPath);
        await writeProposalContent(
          target,
          proposal.operation,
          proposal.content,
          proposal.baseContentHash,
        );
        recordDiff(target.realRoot, target.targetPath, existing.content, proposal.content);
        recordDiff(proposal.projectRoot, target.targetPath, existing.content, proposal.content);
        const now = Date.now();
        const applied: PartnerFileProposalT = {
          ...proposal,
          status: 'applied',
          updatedAt: now,
          appliedAt: now,
        };
        const next = [...current];
        next[idx] = applied;
        return { next, result: { ok: true, proposal: toSummary(applied) } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          next: current,
          result: { ok: false, proposal: toSummary(proposal), error: message.slice(0, 512) },
        };
      }
    });
  }

  async reject(id: string, reason?: string): Promise<ProposalMutationResult> {
    return this.mutate<ProposalMutationResult>((current) => {
      const idx = current.findIndex((proposal) => proposal.id === id);
      if (idx < 0) return { next: current, result: { ok: false, error: 'proposal not found' } };
      const proposal = current[idx]!;
      if (proposal.status !== 'pending') {
        return {
          next: current,
          result: {
            ok: false,
            proposal: toSummary(proposal),
            error: `proposal is already ${proposal.status}`,
          },
        };
      }
      const now = Date.now();
      const rejected: PartnerFileProposalT = {
        ...proposal,
        status: 'rejected',
        updatedAt: now,
        rejectedAt: now,
        ...(reason !== undefined ? { rejectReason: reason.slice(0, 512) } : {}),
      };
      const next = [...current];
      next[idx] = rejected;
      return { next, result: { ok: true, proposal: toSummary(rejected) } };
    });
  }

  invalidate(): void {
    this.cached = null;
  }

  private async load(): Promise<PartnerFileProposalT[]> {
    if (this.cached !== null) return [...this.cached];
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw new Error(
          `schema invalid: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
        );
      } else {
        this.cached = parsed.data.proposals;
      }
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        this.cached = [];
      } else {
        throw new Error(
          `Partner file proposal store is corrupt or unreadable; refusing to overwrite it: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }
    return [...this.cached];
  }

  private async mutate<R>(
    apply: (
      current: PartnerFileProposalT[],
    ) => MaybePromise<{ next: PartnerFileProposalT[]; result: R }>,
  ): Promise<R> {
    const previous = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const current = await this.load();
      const { next, result } = await apply([...current]);
      await atomicWriteJson(this.filePath, { version: 1, proposals: next });
      this.cached = next;
      return result;
    } finally {
      release();
    }
  }
}

export const partnerFileProposalStore = new PartnerFileProposalStore();
