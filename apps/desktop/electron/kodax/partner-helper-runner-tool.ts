import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  MAX_PARTNER_DELIVERY_INLINE_BYTES,
  type AdminPolicyT,
} from '@kodax-space/space-ipc-schema';
import { pushToRenderer } from '../ipc/push.js';
import { isPathInside, truncate } from '../ipc/files-core.js';
import { adminPolicyAuditStore, type AdminPolicyAuditStore } from './admin-policy-audit-store.js';
import { partnerDeliveryStore, type PartnerDeliveryStore } from './partner-delivery-store.js';
import { registerPartnerSpaceToolPolicy } from './partner-tools.js';
import {
  resolveSessionRunContext,
  type SdkToolExecutionContextLike,
} from './session-run-context.js';
import { decodePartnerBase64Strict } from './partner-file-guards.js';
import {
  partnerDeliveryMarkdownLink,
  partnerDeliveryReferenceLine,
} from './partner-delivery-reference.js';

type ToolHandler = (
  input: Record<string, unknown>,
  context?: SdkToolExecutionContextLike,
) => Promise<string>;

export interface PartnerHelperRunnerTestingHooks {
  readonly beforeOutputCommit?: (target: {
    readonly relativePath: string;
    readonly absolutePath: string;
  }) => void | Promise<void>;
  readonly maxTotalWriteBytes?: number;
}

const MAX_HELPER_SCRIPT_BYTES = 512 * 1024;
const MAX_HELPER_LOG_CHARS = 24_000;
const MAX_HELPER_LIST_ENTRIES = 1_000;
const MAX_HELPER_SNAPSHOT_ENTRIES = 10_000;
const MAX_HELPER_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_HELPER_INPUT_BYTES = 1 * 1024 * 1024;
const MAX_HELPER_CONFIG_BYTES = 32 * 1024 * 1024;
const MAX_HELPER_WRITE_OPERATIONS = 1_000;
const MAX_HELPER_TOTAL_WRITE_BYTES = 64 * 1024 * 1024;
const MAX_HELPER_RESULT_PREVIEW_CHARS = 4_000;
const MAX_HELPER_ERROR_CHARS = 4_000;
const MAX_HELPER_VM_PAYLOAD_CHARS =
  Math.ceil((MAX_HELPER_TOTAL_WRITE_BYTES * 4) / 3) + 2 * 1024 * 1024;
const DEFAULT_HELPER_TIMEOUT_MS = 5_000;
const MAX_HELPER_TIMEOUT_MS = 15_000;
const HELPER_WORKER_GRACE_MS = 2_000;
const HELPER_WORKER_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 192,
  maxYoungGenerationSizeMb: 16,
  stackSizeMb: 4,
});
const SENSITIVE_SEGMENTS = new Set([
  '.git',
  '.ssh',
  '.aws',
  '.azure',
  '.docker',
  '.gcloud',
  '.gnupg',
  '.kube',
  '.terraform',
]);
const SENSITIVE_NAMES = new Set([
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.vault-token',
  '_netrc',
  'accessTokens.json'.toLowerCase(),
  'application_default_credentials.json',
  'azureProfile.json'.toLowerCase(),
  'credentials',
  'credentials.json',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'service-account.json',
  'service_account.json',
  'terraform.tfstate',
]);
const SENSITIVE_EXTENSIONS = new Set(['.jks', '.key', '.keystore', '.p12', '.pem', '.pfx']);

function isSensitiveCredentialName(name: string): boolean {
  return /^(?:client_secret|service[-_]account)(?:[-_.].*)?\.json$/i.test(name);
}

export const RUN_PARTNER_HELPER_TOOL = {
  name: 'run_partner_helper',
  description: [
    'Run a small JavaScript helper inside a restricted Partner VM against this session output workspace.',
    'Use this for bounded validators, converters, renderers, packagers, or smoke checks that operate on Partner run-output files.',
    'The helper cannot use shell, package managers, require/import, process/env, subagents, or unrestricted filesystem access.',
    'It can read/write only through the provided files API under the Partner run output workspace; written files are recorded as deliveries.',
    '',
    'Inputs:',
    '- scriptPath: output-workspace-relative path to a .js helper file previously written with write_partner_deliverable.',
    '- input: optional JSON object available to the helper as input.',
    '- timeoutMs: optional execution timeout, capped at 15000 ms.',
    '- sourceRefs: optional source/citation ids or labels for files written by the helper.',
  ].join('\n'),
  sideEffect: 'mutates-state' as const,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      scriptPath: { type: 'string', description: 'Partner output-workspace-relative .js file.' },
      input: { type: 'object', additionalProperties: true, description: 'Optional JSON input.' },
      timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds, max 15000.' },
      sourceRefs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional source/citation ids or labels for files written by the helper.',
      },
    },
    required: ['scriptPath'],
  },
};

function hasControlChar(value: string): boolean {
  return /[\x00\r\n]/.test(value);
}

function normalizeOutputRelativePath(input: string, label: string): string {
  if (hasControlChar(input)) throw new Error(`${label} contains control characters`);
  const unified = input.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = unified.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) throw new Error(`${label} is required`);
  const lowerParts = parts.map((part) => part.toLowerCase());
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (part === '.' || part === '..') throw new Error(`${label} cannot contain dot segments`);
    if (SENSITIVE_SEGMENTS.has(lowerParts[index]!)) {
      throw new Error(`${label} uses blocked segment: ${truncate(part)}`);
    }
    if (
      lowerParts[index] === '.env' ||
      lowerParts[index]!.startsWith('.env.') ||
      SENSITIVE_NAMES.has(lowerParts[index]!) ||
      isSensitiveCredentialName(lowerParts[index]!)
    ) {
      throw new Error(`${label} uses blocked filename: ${truncate(part)}`);
    }
    if (lowerParts[index] === '.config' && lowerParts[index + 1] === 'gcloud') {
      throw new Error(`${label} uses blocked segment: .config/gcloud`);
    }
  }
  const name = lowerParts[lowerParts.length - 1]!;
  if (
    name === '.env' ||
    name.startsWith('.env.') ||
    SENSITIVE_NAMES.has(name) ||
    isSensitiveCredentialName(name)
  ) {
    throw new Error(`${label} uses blocked filename: ${truncate(name)}`);
  }
  if (SENSITIVE_EXTENSIONS.has(path.posix.extname(name))) {
    throw new Error(`${label} uses blocked file extension: ${truncate(path.posix.extname(name))}`);
  }
  return parts.join('/');
}

function normalizeAllowedExtension(ext: string): string {
  const trimmed = ext.trim().toLowerCase();
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function assertRunOutputPolicy(policy: AdminPolicyT, relativePath: string): void {
  if (!policy.workspaceDeliveries.writeAllowed) {
    throw new Error('Partner delivery writes are blocked by local admin policy.');
  }
  const allowed = policy.workspaceDeliveries.allowedExtensions.map(normalizeAllowedExtension);
  if (allowed.length === 0) return;
  const ext = path.posix.extname(relativePath.replace(/\\/g, '/')).toLowerCase();
  if (!ext || !allowed.includes(ext)) {
    throw new Error('Partner delivery extension is blocked by local admin policy.');
  }
}

function safeJsonClone(value: unknown): unknown {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return undefined;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_HELPER_INPUT_BYTES) {
    throw new Error(`helper input exceeds ${MAX_HELPER_INPUT_BYTES} bytes`);
  }
  return JSON.parse(serialized);
}

function sourceRefsFromInput(input: Record<string, unknown>): string[] {
  if (!Array.isArray(input.sourceRefs)) return [];
  return input.sourceRefs.filter((ref): ref is string => typeof ref === 'string');
}

function helperTimeout(input: Record<string, unknown>): number {
  const raw = typeof input.timeoutMs === 'number' ? input.timeoutMs : DEFAULT_HELPER_TIMEOUT_MS;
  if (!Number.isFinite(raw)) return DEFAULT_HELPER_TIMEOUT_MS;
  return Math.max(1, Math.min(Math.trunc(raw), MAX_HELPER_TIMEOUT_MS));
}

function assertNotSymlink(absPath: string, label: string): void {
  try {
    if (lstatSync(absPath).isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return;
    throw err;
  }
}

function assertNoSymlinkAncestors(root: string, relativePath: string, label: string): void {
  let current = path.resolve(root);
  for (const part of relativePath.split('/').slice(0, -1)) {
    current = path.join(current, part);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(label + ' cannot traverse a symbolic link parent');
      if (!stat.isDirectory()) throw new Error(label + ' parent is not a directory');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      throw err;
    }
  }
}

function resolveExistingOutput(
  root: string,
  relativeInput: string,
): { relativePath: string; absolutePath: string } {
  const relativePath = normalizeOutputRelativePath(relativeInput, 'helper path');
  const absolutePath = path.resolve(root, ...relativePath.split('/'));
  if (!isPathInside(absolutePath, root)) throw new Error('helper path escapes output root');
  assertNotSymlink(absolutePath, 'helper target');
  const realRoot = realpathSync(root);
  const realTarget = realpathSync(absolutePath);
  if (!isPathInside(realTarget, realRoot))
    throw new Error('helper path escapes output root via symlink');
  return { relativePath, absolutePath };
}

function resolveWritableOutput(
  root: string,
  relativeInput: string,
): { relativePath: string; absolutePath: string } {
  const relativePath = normalizeOutputRelativePath(relativeInput, 'helper output path');
  const absolutePath = path.resolve(root, ...relativePath.split('/'));
  if (!isPathInside(absolutePath, root)) throw new Error('helper output path escapes output root');
  assertNoSymlinkAncestors(root, relativePath, 'helper output path');
  mkdirSync(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  const realRoot = realpathSync(root);
  const realParent = realpathSync(path.dirname(absolutePath));
  if (!isPathInside(realParent, realRoot)) {
    throw new Error('helper output path escapes output root via symlink parent');
  }
  assertNotSymlink(absolutePath, 'helper output target');
  return { relativePath, absolutePath };
}

function unlinkIfPresent(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/**
 * Replace a helper output without ever opening the caller-visible target for writing.
 * Moving the current directory entry aside first means a symlink or hard-link that
 * appears after path validation is displaced rather than followed. The new inode is
 * then installed with an exclusive hard link, so a concurrent creator is preserved.
 */
function writeOutputFileWithoutFollowingAliases(absolutePath: string, bytes: Buffer): void {
  const directory = path.dirname(absolutePath);
  const token = `${process.pid}-${Date.now()}-${randomUUID()}`;
  const tempPath = path.join(directory, `.kodax-helper-new-${token}.tmp`);
  const displacedPath = path.join(directory, `.kodax-helper-previous-${token}.tmp`);
  let displacedRegular = false;
  let unsafeDisplaced = false;
  writeFileSync(tempPath, bytes, { flag: 'wx', mode: 0o600 });
  try {
    try {
      renameSync(absolutePath, displacedPath);
      const displacedStat = lstatSync(displacedPath);
      if (!displacedStat.isFile() || displacedStat.isSymbolicLink()) {
        unsafeDisplaced = true;
        throw new Error(
          `helper output target changed to an unsafe alias; retained at ${displacedPath}`,
        );
      }
      displacedRegular = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
    }

    linkSync(tempPath, absolutePath);
    unlinkIfPresent(tempPath);
    if (displacedRegular) unlinkIfPresent(displacedPath);
  } catch (err) {
    unlinkIfPresent(tempPath);
    if (displacedRegular) {
      try {
        linkSync(displacedPath, absolutePath);
        unlinkIfPresent(displacedPath);
      } catch (restoreErr) {
        if ((restoreErr as NodeJS.ErrnoException).code !== 'EEXIST') throw restoreErr;
      }
    }
    if (unsafeDisplaced) throw err;
    if (displacedRegular) {
      try {
        lstatSync(displacedPath);
        throw new Error(
          `${err instanceof Error ? err.message : String(err)}; previous output retained at ${displacedPath}`,
        );
      } catch (statErr) {
        if ((statErr as NodeJS.ErrnoException).code !== 'ENOENT') throw statErr;
      }
    }
    throw err;
  }
}
type HelperSnapshotEntry =
  | { path: string; kind: 'directory'; entries: string[] }
  | { path: string; kind: 'file'; content?: string; tooLarge?: boolean }
  | { path: string; kind: 'other' };

type HelperVmOperation = {
  encoding: 'utf8' | 'base64';
  relativePath: string;
  content: string;
};

type HelperVmPayload = {
  status: 'empty' | 'pending' | 'fulfilled' | 'rejected';
  resultPreview?: string;
  error?: string;
  logs: string[];
  operations: HelperVmOperation[];
};

function buildHelperSnapshot(root: string): HelperSnapshotEntry[] {
  const snapshot: HelperSnapshotEntry[] = [];
  let totalBytes = 0;
  const add = (entry: HelperSnapshotEntry): void => {
    if (snapshot.length >= MAX_HELPER_SNAPSHOT_ENTRIES) {
      throw new Error(`helper output snapshot exceeds ${MAX_HELPER_SNAPSHOT_ENTRIES} entries`);
    }
    snapshot.push(entry);
  };
  const visitDirectory = (absolutePath: string, relativePath: string): void => {
    const names = readdirSync(absolutePath);
    add({
      path: relativePath,
      kind: 'directory',
      entries: names.slice(0, MAX_HELPER_LIST_ENTRIES),
    });
    for (const name of names) {
      const childRelativePath = relativePath ? `${relativePath}/${name}` : name;
      let target: ReturnType<typeof resolveExistingOutput>;
      try {
        target = resolveExistingOutput(root, childRelativePath);
      } catch {
        // Keep blocked or symlinked names visible to list(), as readdirSync did, but never snapshot their data.
        continue;
      }
      const stat = statSync(target.absolutePath);
      if (stat.isDirectory()) {
        visitDirectory(target.absolutePath, target.relativePath);
      } else if (stat.isFile()) {
        if (stat.size > MAX_PARTNER_DELIVERY_INLINE_BYTES) {
          add({ path: target.relativePath, kind: 'file', tooLarge: true });
          continue;
        }
        totalBytes += stat.size;
        if (totalBytes > MAX_HELPER_SNAPSHOT_BYTES) {
          throw new Error(`helper output snapshot exceeds ${MAX_HELPER_SNAPSHOT_BYTES} bytes`);
        }
        add({
          path: target.relativePath,
          kind: 'file',
          content: readFileSync(target.absolutePath, 'utf8'),
        });
      } else {
        add({ path: target.relativePath, kind: 'other' });
      }
    }
  };
  visitDirectory(root, '');
  return snapshot;
}

function decodeStrictBase64(value: string): Buffer {
  return decodePartnerBase64Strict(value, MAX_PARTNER_DELIVERY_INLINE_BYTES, 'base64 content');
}

function jsStringLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function makeHelperBootstrapSource(configJson: string, bridgeName: string): string {
  return String.raw`
(() => {
  'use strict';
  const config = JSON.parse(${jsStringLiteral(configJson)});
  const jsonStringify = JSON.stringify;
  const arrayPush = Function.prototype.call.bind(Array.prototype.push);
  const arraySlice = Function.prototype.call.bind(Array.prototype.slice);
  const promiseResolve = Promise.resolve.bind(Promise);
  const entries = new Map(config.snapshot.map((entry) => [entry.path, entry]));
  const sensitiveSegments = new Set(config.sensitiveSegments);
  const sensitiveNames = new Set(config.sensitiveNames);
  const sensitiveExtensions = new Set(config.sensitiveExtensions);
  const allowedExtensions = new Set(config.allowedExtensions);
  const operations = [];
  Object.setPrototypeOf(operations, null);
  const logs = [];
  Object.setPrototypeOf(logs, null);
  let logChars = 0;
  let totalWriteBytes = 0;
  let status = 'empty';
  let resultValue;
  let errorText;

  const normalizePath = (value, label) => {
    const raw = String(value);
    if (/[\x00\r\n]/.test(raw)) throw new Error(label + ' contains control characters');
    const unified = raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const parts = unified.split('/').filter((part) => part.length > 0);
    if (parts.length === 0) throw new Error(label + ' is required');
    const lowerParts = parts.map((part) => part.toLowerCase());
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (part === '.' || part === '..') throw new Error(label + ' cannot contain dot segments');
      if (sensitiveSegments.has(lowerParts[index])) {
        throw new Error(label + ' uses blocked segment: ' + part.slice(0, 240));
      }
      if (
        lowerParts[index] === '.env' ||
        lowerParts[index].startsWith('.env.') ||
        sensitiveNames.has(lowerParts[index]) ||
        /^(?:client_secret|service[-_]account)(?:[-_.].*)?\.json$/i.test(lowerParts[index])
      ) {
        throw new Error(label + ' uses blocked filename: ' + part.slice(0, 240));
      }
      if (lowerParts[index] === '.config' && lowerParts[index + 1] === 'gcloud') {
        throw new Error(label + ' uses blocked segment: .config/gcloud');
      }
    }
    const name = lowerParts[lowerParts.length - 1];
    if (
      name === '.env' ||
      name.startsWith('.env.') ||
      sensitiveNames.has(name) ||
      /^(?:client_secret|service[-_]account)(?:[-_.].*)?\.json$/i.test(name)
    ) {
      throw new Error(label + ' uses blocked filename: ' + name.slice(0, 240));
    }
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 ? name.slice(dot) : '';
    if (sensitiveExtensions.has(extension)) {
      throw new Error(label + ' uses blocked file extension: ' + extension);
    }
    return parts.join('/');
  };

  const extensionOf = (relativePath) => {
    const name = relativePath.slice(relativePath.lastIndexOf('/') + 1).toLowerCase();
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot) : '';
  };

  const assertWritePolicy = (relativePath) => {
    if (!config.writeAllowed) {
      throw new Error('Partner delivery writes are blocked by local admin policy.');
    }
    if (allowedExtensions.size > 0 && !allowedExtensions.has(extensionOf(relativePath))) {
      throw new Error('Partner delivery extension is blocked by local admin policy.');
    }
  };

  const utf8Encode = (value) => {
    const text = String(value);
    const bytes = [];
    for (let index = 0; index < text.length; index += 1) {
      let codePoint = text.charCodeAt(index);
      if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
        const low = text.charCodeAt(index + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
          index += 1;
        } else {
          codePoint = 0xfffd;
        }
      } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
        codePoint = 0xfffd;
      }
      if (codePoint <= 0x7f) arrayPush(bytes, codePoint);
      else if (codePoint <= 0x7ff) {
        arrayPush(bytes, 0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
      } else if (codePoint <= 0xffff) {
        arrayPush(bytes, 0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
      } else {
        arrayPush(bytes,
          0xf0 | (codePoint >> 18),
          0x80 | ((codePoint >> 12) & 0x3f),
          0x80 | ((codePoint >> 6) & 0x3f),
          0x80 | (codePoint & 0x3f),
        );
      }
    }
    return bytes;
  };

  const utf8Decode = (inputBytes) => {
    const bytes = Array.from(inputBytes, (value) => Number(value) & 0xff);
    let result = '';
    for (let index = 0; index < bytes.length; ) {
      const first = bytes[index];
      let length = 1;
      let codePoint = first;
      let minimum = 0;
      if (first >= 0xc2 && first <= 0xdf) {
        length = 2;
        codePoint = first & 0x1f;
        minimum = 0x80;
      } else if (first >= 0xe0 && first <= 0xef) {
        length = 3;
        codePoint = first & 0x0f;
        minimum = 0x800;
      } else if (first >= 0xf0 && first <= 0xf4) {
        length = 4;
        codePoint = first & 0x07;
        minimum = 0x10000;
      } else if (first > 0x7f) {
        result += '\ufffd';
        index += 1;
        continue;
      }
      if (index + length > bytes.length) {
        result += '\ufffd';
        index += 1;
        continue;
      }
      let valid = true;
      for (let offset = 1; offset < length; offset += 1) {
        const next = bytes[index + offset];
        if ((next & 0xc0) !== 0x80) {
          valid = false;
          break;
        }
        codePoint = (codePoint << 6) | (next & 0x3f);
      }
      if (
        !valid ||
        codePoint < minimum ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        result += '\ufffd';
        index += 1;
        continue;
      }
      result += String.fromCodePoint(codePoint);
      index += length;
    }
    return result;
  };

  const decodeBase64 = (value) => {
    const normalized = String(value).replace(/\s+/g, '');
    if (normalized.length > Math.ceil(config.maxInlineBytes / 3) * 4) {
      throw new Error('helper write target exceeds ' + config.maxInlineBytes + ' bytes');
    }
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
      throw new Error('invalid base64 content');
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    if (normalized.endsWith('==') && (alphabet.indexOf(normalized[normalized.length - 3]) & 0x0f) !== 0) {
      throw new Error('invalid base64 content');
    }
    if (
      normalized.endsWith('=') &&
      !normalized.endsWith('==') &&
      (alphabet.indexOf(normalized[normalized.length - 2]) & 0x03) !== 0
    ) {
      throw new Error('invalid base64 content');
    }
    const bytes = [];
    for (let index = 0; index < normalized.length; index += 4) {
      const first = alphabet.indexOf(normalized[index]);
      const second = alphabet.indexOf(normalized[index + 1]);
      const third = normalized[index + 2] === '=' ? 0 : alphabet.indexOf(normalized[index + 2]);
      const fourth = normalized[index + 3] === '=' ? 0 : alphabet.indexOf(normalized[index + 3]);
      arrayPush(bytes, (first << 2) | (second >> 4));
      if (normalized[index + 2] !== '=') arrayPush(bytes, ((second & 0x0f) << 4) | (third >> 2));
      if (normalized[index + 3] !== '=') arrayPush(bytes, ((third & 0x03) << 6) | fourth);
    }
    return { normalized, bytes };
  };

  const addDirectoryEntry = (directoryPath, name) => {
    const directory = entries.get(directoryPath);
    if (!directory || directory.kind !== 'directory') {
      throw new Error('helper output path parent is not a directory');
    }
    if (!directory.entries.includes(name) && directory.entries.length < config.maxListEntries) {
      arrayPush(directory.entries, name);
    }
  };

  const ensureParentDirectories = (relativePath) => {
    const parts = relativePath.split('/');
    let parentPath = '';
    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index];
      const nextPath = parentPath ? parentPath + '/' + name : name;
      const existing = entries.get(nextPath);
      if (existing && existing.kind !== 'directory') {
        throw new Error('helper output path parent is not a directory');
      }
      if (!existing) {
        addDirectoryEntry(parentPath, name);
        entries.set(nextPath, { path: nextPath, kind: 'directory', entries: [] });
      }
      parentPath = nextPath;
    }
    return parentPath;
  };

  const recordWrite = (relativePath, encoding, content, virtualText, byteLength) => {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new Error('helper write size is invalid');
    }
    if (operations.length >= config.maxWriteOperations) {
      throw new Error('helper write operation limit exceeded');
    }
    if (totalWriteBytes + byteLength > config.maxTotalWriteBytes) {
      throw new Error('helper total write output exceeds ' + config.maxTotalWriteBytes + ' bytes');
    }
    const existing = entries.get(relativePath);
    if (existing && existing.kind === 'directory') {
      throw new Error('helper output target must not be a directory');
    }
    const parentPath = ensureParentDirectories(relativePath);
    addDirectoryEntry(parentPath, relativePath.slice(relativePath.lastIndexOf('/') + 1));
    entries.set(relativePath, { path: relativePath, kind: 'file', content: virtualText });
    const operation = Object.create(null);
    operation.relativePath = relativePath;
    operation.encoding = encoding;
    operation.content = content;
    totalWriteBytes += byteLength;
    arrayPush(operations, operation);
    return relativePath;
  };

  let files;
  files = Object.freeze({
    readText: (relativePathInput) => {
      const relativePath = normalizePath(relativePathInput, 'helper path');
      const entry = entries.get(relativePath);
      if (!entry) throw new Error('helper path does not exist');
      if (entry.kind !== 'file') throw new Error('helper read target must be a file');
      if (entry.tooLarge) {
        throw new Error('helper read target exceeds ' + config.maxInlineBytes + ' bytes');
      }
      return entry.content || '';
    },
    readJson: (relativePathInput) => JSON.parse(files.readText(relativePathInput)),
    writeText: (relativePathInput, content) => {
      const relativePath = normalizePath(relativePathInput, 'helper output path');
      assertWritePolicy(relativePath);
      const text = String(content);
      if (text.length > config.maxInlineBytes) {
        throw new Error('helper write target exceeds ' + config.maxInlineBytes + ' bytes');
      }
      const encoded = utf8Encode(text);
      if (encoded.length > config.maxInlineBytes) {
        throw new Error('helper write target exceeds ' + config.maxInlineBytes + ' bytes');
      }
      return recordWrite(relativePath, 'utf8', text, text, encoded.length);
    },
    writeJson: (relativePathInput, value) => files.writeText(relativePathInput, jsonStringify(value, null, 2)),
    writeBase64: (relativePathInput, base64Content) => {
      const relativePath = normalizePath(relativePathInput, 'helper output path');
      assertWritePolicy(relativePath);
      const decoded = decodeBase64(base64Content);
      if (decoded.bytes.length > config.maxInlineBytes) {
        throw new Error('helper write target exceeds ' + config.maxInlineBytes + ' bytes');
      }
      return recordWrite(relativePath, 'base64', decoded.normalized, utf8Decode(decoded.bytes), decoded.bytes.length);
    },
    exists: (relativePathInput) => {
      try {
        return entries.has(normalizePath(relativePathInput, 'helper path'));
      } catch {
        return false;
      }
    },
    list: (relativePathInput = '') => {
      const relativePath = relativePathInput
        ? normalizePath(relativePathInput, 'helper path')
        : '';
      const entry = entries.get(relativePath);
      if (!entry) throw new Error('helper path does not exist');
      if (entry.kind !== 'directory') throw new Error('helper list target must be a folder');
      return arraySlice(entry.entries, 0, config.maxListEntries);
    },
  });

  const previewLimitSentinel = Object.freeze(Object.create(null));
  const stringifyBounded = (value, maxChars, space) => {
    let remaining = maxChars;
    let visited = 0;
    try {
      const serialized = jsonStringify(
        value,
        (key, current) => {
          visited += 1;
          remaining -= Math.min(key.length, maxChars + 1) + 8;
          if (typeof current === 'string') {
            if (current.length > remaining) throw previewLimitSentinel;
            remaining -= current.length;
          } else if (
            typeof current === 'number' ||
            typeof current === 'bigint' ||
            typeof current === 'boolean'
          ) {
            remaining -= 32;
          } else {
            remaining -= 4;
          }
          if (visited > 2_048 || remaining < 0) throw previewLimitSentinel;
          return current;
        },
        space,
      );
      if (typeof serialized === 'string' && serialized.length > maxChars) {
        throw previewLimitSentinel;
      }
      return { serialized, truncated: false };
    } catch (error) {
      if (error === previewLimitSentinel) return { serialized: undefined, truncated: true };
      throw error;
    }
  };

  const stringifyForLog = (value, maxChars) => {
    if (typeof value === 'string') return value.slice(0, maxChars);
    try {
      const bounded = stringifyBounded(value, maxChars, 0);
      if (bounded.truncated) return '[log value truncated]'.slice(0, maxChars);
      return bounded.serialized === undefined
        ? String(value).slice(0, maxChars)
        : bounded.serialized;
    } catch {
      return String(value).slice(0, maxChars);
    }
  };
  const appendLog = (...items) => {
    if (logChars >= config.maxLogChars) return;
    const available = config.maxLogChars - logChars;
    let next = '';
    for (let index = 0; index < items.length && next.length < available; index += 1) {
      const separator = index === 0 ? '' : ' ';
      const remaining = available - next.length - separator.length;
      if (remaining <= 0) break;
      next += separator + stringifyForLog(items[index], remaining);
    }
    arrayPush(logs, next);
    logChars += next.length + 1;
  };

  class SafeTextEncoder {
    encode(value = '') {
      return Uint8Array.from(utf8Encode(value));
    }
  }
  class SafeTextDecoder {
    decode(value = new Uint8Array()) {
      return utf8Decode(value);
    }
  }

  const captureError = (error) => {
    status = 'rejected';
    resultValue = undefined;
    errorText = String(error).slice(0, config.maxErrorChars);
  };
  const capture = (value) => {
    if (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      typeof value.then === 'function'
    ) {
      status = 'pending';
      promiseResolve(value).then(
        (resolved) => {
          status = 'fulfilled';
          resultValue = resolved;
          errorText = undefined;
        },
        captureError,
      );
      return;
    }
    status = 'fulfilled';
    resultValue = value;
    errorText = undefined;
  };
  const serialize = () => {
    let resultPreview;
    if (status === 'fulfilled') {
      try {
        if (resultValue === undefined) resultPreview = 'undefined';
        else if (typeof resultValue === 'string') {
          resultPreview =
            resultValue.length > config.maxResultPreviewChars
              ? resultValue.slice(0, config.maxResultPreviewChars) + '\n[truncated]'
              : resultValue;
        } else {
          const bounded = stringifyBounded(resultValue, config.maxResultPreviewChars, 2);
          if (bounded.truncated) {
            resultPreview =
              '[result preview exceeded ' + config.maxResultPreviewChars + ' characters]';
          } else {
            if (typeof bounded.serialized !== 'string') {
              throw new TypeError('helper result is not JSON serializable');
            }
            resultPreview = bounded.serialized;
          }
        }
      } catch (error) {
        captureError(error);
      }
    }
    const payload = Object.create(null);
    payload.status = status;
    payload.resultPreview = resultPreview;
    payload.error = errorText;
    payload.logs = logs;
    payload.operations = operations;
    return jsonStringify(payload);
  };

  const bridge = Object.freeze({ capture, captureError, serialize });
  Object.defineProperties(globalThis, {
    input: { value: config.hasInput ? config.input : undefined, writable: false, configurable: false },
    files: { value: files, writable: false, configurable: false },
    log: { value: appendLog, writable: false, configurable: false },
    console: {
      value: Object.freeze({ log: appendLog, warn: appendLog, error: appendLog }),
      writable: false,
      configurable: false,
    },
    TextEncoder: { value: SafeTextEncoder, writable: false, configurable: false },
    TextDecoder: { value: SafeTextDecoder, writable: false, configurable: false },
    [${jsStringLiteral(bridgeName)}]: { value: bridge, writable: false, configurable: false },
  });
})();`;
}

const HELPER_WORKER_SOURCE = String.raw`
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');

if (!parentPort) throw new Error('Partner helper worker has no parent port');

const toErrorMessage = (error) => {
  try {
    if (error && typeof error === 'object' && typeof error.message === 'string') {
      return error.message.slice(0, 4096);
    }
    return String(error).slice(0, 4096);
  } catch {
    return 'Partner helper worker failed';
  }
};

const postAndClose = (message) => {
  parentPort.postMessage(message);
  parentPort.close();
};

try {
  const data = workerData;
  if (
    !data ||
    typeof data !== 'object' ||
    typeof data.bootstrapSource !== 'string' ||
    typeof data.executionSource !== 'string' ||
    typeof data.finalizeSource !== 'string' ||
    typeof data.executionFilename !== 'string' ||
    !Number.isSafeInteger(data.timeoutMs) ||
    data.timeoutMs < 1
  ) {
    throw new Error('Partner helper worker received invalid data');
  }

  const context = vm.createContext(Object.create(null), {
    name: 'partner-helper-worker-vm',
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: 'afterEvaluate',
  });
  new vm.Script(data.bootstrapSource, {
    filename: 'partner-helper-bootstrap.js',
  }).runInContext(context, {
    timeout: Math.min(Math.max(data.timeoutMs, 500), 2000),
  });

  let executionError;
  try {
    new vm.Script(data.executionSource, {
      filename: data.executionFilename,
    }).runInContext(context, { timeout: data.timeoutMs });
  } catch (error) {
    executionError = toErrorMessage(error);
  }

  const rawPayload = new vm.Script(data.finalizeSource, {
    filename: 'partner-helper-finalize.js',
  }).runInContext(context, {
    timeout: Math.min(Math.max(data.timeoutMs, 250), 1000),
  });
  postAndClose({ kind: 'result', rawPayload, executionError });
} catch (error) {
  postAndClose({ kind: 'failure', error: toErrorMessage(error) });
}
`;

type HelperWorkerData = {
  bootstrapSource: string;
  executionSource: string;
  finalizeSource: string;
  executionFilename: string;
  timeoutMs: number;
};

type HelperWorkerResult = {
  rawPayload: string;
  executionError?: string;
};

type HelperWorkerMessage =
  | { kind: 'result'; rawPayload: string; executionError?: string }
  | { kind: 'failure'; error: string };

function parseHelperWorkerMessage(value: unknown): HelperWorkerMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('helper worker returned an invalid message');
  }
  const candidate = value as Partial<HelperWorkerMessage>;
  if (
    candidate.kind === 'result' &&
    typeof candidate.rawPayload === 'string' &&
    (candidate.executionError === undefined ||
      (typeof candidate.executionError === 'string' &&
        candidate.executionError.length <= MAX_HELPER_ERROR_CHARS))
  ) {
    return candidate as Extract<HelperWorkerMessage, { kind: 'result' }>;
  }
  if (
    candidate.kind === 'failure' &&
    typeof candidate.error === 'string' &&
    candidate.error.length <= MAX_HELPER_ERROR_CHARS
  ) {
    return candidate as Extract<HelperWorkerMessage, { kind: 'failure' }>;
  }
  throw new Error('helper worker returned an invalid message');
}

function runHelperVmInWorker(data: HelperWorkerData): Promise<HelperWorkerResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(HELPER_WORKER_SOURCE, {
        eval: true,
        workerData: data,
        argv: [],
        env: {},
        resourceLimits: HELPER_WORKER_RESOURCE_LIMITS,
      });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let deadline: NodeJS.Timeout | undefined;
    const stopWorker = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      void worker.terminate().then(complete, reject);
    };

    worker.once('message', (rawMessage: unknown) => {
      let message: HelperWorkerMessage;
      try {
        message = parseHelperWorkerMessage(rawMessage);
      } catch (error) {
        stopWorker(() => reject(error));
        return;
      }
      if (message.kind === 'failure') {
        stopWorker(() => reject(new Error(message.error)));
        return;
      }
      stopWorker(() =>
        resolve({
          rawPayload: message.rawPayload,
          ...(message.executionError !== undefined
            ? { executionError: message.executionError }
            : {}),
        }),
      );
    });
    worker.once('error', (error) => stopWorker(() => reject(error)));
    worker.once('exit', (code) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      reject(new Error(`helper worker exited before returning a result (code ${code})`));
    });

    const hardDeadlineMs = data.timeoutMs + HELPER_WORKER_GRACE_MS;
    deadline = setTimeout(() => {
      stopWorker(() =>
        reject(new Error(`helper worker exceeded its ${hardDeadlineMs} ms hard deadline`)),
      );
    }, hardDeadlineMs);
  });
}
function parseHelperVmPayload(raw: unknown): HelperVmPayload {
  if (typeof raw !== 'string') throw new Error('helper VM returned an invalid payload');
  if (raw.length > MAX_HELPER_VM_PAYLOAD_CHARS) {
    throw new Error(`helper VM payload exceeds ${MAX_HELPER_VM_PAYLOAD_CHARS} characters`);
  }
  const parsed = JSON.parse(raw) as Partial<HelperVmPayload>;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !['empty', 'pending', 'fulfilled', 'rejected'].includes(String(parsed.status)) ||
    (parsed.resultPreview !== undefined &&
      (typeof parsed.resultPreview !== 'string' ||
        parsed.resultPreview.length > MAX_HELPER_RESULT_PREVIEW_CHARS + 16)) ||
    (parsed.error !== undefined &&
      (typeof parsed.error !== 'string' || parsed.error.length > MAX_HELPER_ERROR_CHARS)) ||
    !Array.isArray(parsed.logs) ||
    !parsed.logs.every((item) => typeof item === 'string') ||
    !Array.isArray(parsed.operations) ||
    parsed.operations.length > MAX_HELPER_WRITE_OPERATIONS
  ) {
    throw new Error('helper VM returned an invalid payload');
  }
  let logChars = 0;
  for (const item of parsed.logs) {
    logChars += item.length + 1;
    if (logChars > MAX_HELPER_LOG_CHARS + 1) {
      throw new Error('helper VM returned oversized logs');
    }
  }
  for (const operation of parsed.operations) {
    if (
      !operation ||
      (operation.encoding !== 'utf8' && operation.encoding !== 'base64') ||
      typeof operation.relativePath !== 'string' ||
      typeof operation.content !== 'string' ||
      operation.relativePath.length > 4_096 ||
      operation.content.length > MAX_HELPER_VM_PAYLOAD_CHARS
    ) {
      throw new Error('helper VM returned an invalid write operation');
    }
  }
  return parsed as HelperVmPayload;
}

export function makeRunPartnerHelperHandler(
  store: PartnerDeliveryStore,
  auditStore: AdminPolicyAuditStore = adminPolicyAuditStore,
  hooks: PartnerHelperRunnerTestingHooks = {},
): ToolHandler {
  return async (input, toolContext) => {
    const ctx = resolveSessionRunContext(toolContext);
    if (!ctx) return 'Error: run_partner_helper was called outside an active session run.';
    if (ctx.surface !== 'partner')
      return 'Error: run_partner_helper is only available in Partner sessions.';

    const scriptPathInput = typeof input.scriptPath === 'string' ? input.scriptPath : '';
    const timeoutMs = helperTimeout(input);
    const maxTotalWriteBytes =
      typeof hooks.maxTotalWriteBytes === 'number' && Number.isFinite(hooks.maxTotalWriteBytes)
        ? Math.max(1, Math.min(Math.trunc(hooks.maxTotalWriteBytes), MAX_HELPER_TOTAL_WRITE_BYTES))
        : MAX_HELPER_TOTAL_WRITE_BYTES;
    const sourceRefs = sourceRefsFromInput(input);
    const written = new Set<string>();
    const deliveries: Awaited<ReturnType<PartnerDeliveryStore['register']>>[] = [];
    const registered = new Set<string>();
    let outputRoot: string | null = null;
    const registerWrittenDeliveries = async (): Promise<void> => {
      if (!outputRoot) return;
      for (const relativePath of written) {
        if (registered.has(relativePath)) continue;
        const target = resolveExistingOutput(outputRoot, relativePath);
        const delivery = await store.register({
          sessionId: ctx.sessionId,
          projectRoot: ctx.projectRoot,
          rootKind: 'run-output',
          rootPath: outputRoot,
          absolutePath: target.absolutePath,
          sourceRefs,
          producer: RUN_PARTNER_HELPER_TOOL.name,
        });
        registered.add(relativePath);
        deliveries.push(delivery);
        pushToRenderer('partner.deliveries.changed', {
          sessionId: ctx.sessionId,
          id: delivery.id,
          reason: 'created',
        });
      }
    };
    try {
      const { policy } = await auditStore.getPolicy();
      assertRunOutputPolicy(policy, scriptPathInput);
      outputRoot = await store.ensureOutputRoot(ctx.sessionId);
      const scriptTarget = resolveExistingOutput(outputRoot, scriptPathInput);
      if (!/\.js$/i.test(scriptTarget.relativePath)) {
        throw new Error('run_partner_helper only runs .js helper files.');
      }
      const scriptStat = statSync(scriptTarget.absolutePath);
      if (!scriptStat.isFile()) throw new Error('helper script must be a file');
      if (scriptStat.size > MAX_HELPER_SCRIPT_BYTES) {
        throw new Error(`helper script exceeds ${MAX_HELPER_SCRIPT_BYTES} bytes`);
      }
      const script = readFileSync(scriptTarget.absolutePath, 'utf8');
      const snapshot = buildHelperSnapshot(outputRoot);
      const clonedInput = safeJsonClone(input.input);
      const bridgeName = `__partner_helper_bridge_${randomUUID().replace(/-/g, '')}`;
      const configJson = JSON.stringify({
        snapshot,
        hasInput: clonedInput !== undefined,
        input: clonedInput ?? null,
        writeAllowed: policy.workspaceDeliveries.writeAllowed,
        allowedExtensions:
          policy.workspaceDeliveries.allowedExtensions.map(normalizeAllowedExtension),
        sensitiveSegments: [...SENSITIVE_SEGMENTS],
        sensitiveNames: [...SENSITIVE_NAMES],
        sensitiveExtensions: [...SENSITIVE_EXTENSIONS],
        maxInlineBytes: MAX_PARTNER_DELIVERY_INLINE_BYTES,
        maxListEntries: MAX_HELPER_LIST_ENTRIES,
        maxLogChars: MAX_HELPER_LOG_CHARS,
        maxWriteOperations: MAX_HELPER_WRITE_OPERATIONS,
        maxTotalWriteBytes,
        maxResultPreviewChars: MAX_HELPER_RESULT_PREVIEW_CHARS,
        maxErrorChars: MAX_HELPER_ERROR_CHARS,
      });
      if (Buffer.byteLength(configJson, 'utf8') > MAX_HELPER_CONFIG_BYTES) {
        throw new Error(`helper VM config exceeds ${MAX_HELPER_CONFIG_BYTES} bytes`);
      }
      const executionSource = [
        '{',
        `const bridge = globalThis[${jsStringLiteral(bridgeName)}];`,
        'try {',
        `bridge.capture((() => {\n${script}\n})());`,
        '} catch (error) {',
        'bridge.captureError(error);',
        '}',
        '}',
      ].join('\n');
      const workerResult = await runHelperVmInWorker({
        bootstrapSource: makeHelperBootstrapSource(configJson, bridgeName),
        executionSource,
        finalizeSource: `globalThis[${jsStringLiteral(bridgeName)}].serialize()`,
        executionFilename: scriptTarget.relativePath,
        timeoutMs,
      });
      const payload = parseHelperVmPayload(workerResult.rawPayload);
      const executionError = workerResult.executionError;
      const preparedOperations: Array<{ relativePath: string; bytes: Buffer }> = [];
      let totalWriteBytes = 0;
      for (const operation of payload.operations) {
        const relativePath = normalizeOutputRelativePath(
          operation.relativePath,
          'helper output path',
        );
        assertRunOutputPolicy(policy, relativePath);
        const bytes =
          operation.encoding === 'base64'
            ? decodeStrictBase64(operation.content)
            : Buffer.from(operation.content, 'utf8');
        if (bytes.length > MAX_PARTNER_DELIVERY_INLINE_BYTES) {
          throw new Error(`helper write target exceeds ${MAX_PARTNER_DELIVERY_INLINE_BYTES} bytes`);
        }
        totalWriteBytes += bytes.length;
        if (totalWriteBytes > maxTotalWriteBytes) {
          throw new Error(`helper total write output exceeds ${maxTotalWriteBytes} bytes`);
        }
        preparedOperations.push({ relativePath, bytes });
      }
      for (const operation of preparedOperations) {
        const target = resolveWritableOutput(outputRoot, operation.relativePath);
        await hooks.beforeOutputCommit?.(target);
        writeOutputFileWithoutFollowingAliases(target.absolutePath, operation.bytes);
        written.add(target.relativePath);
      }
      if (executionError) throw new Error(executionError);
      if (payload.status === 'pending') {
        throw new Error(`helper async result did not settle within ${timeoutMs} ms`);
      }
      if (payload.status === 'rejected') throw new Error(payload.error || 'helper failed');
      if (payload.status !== 'fulfilled') throw new Error('helper did not produce a result');
      await registerWrittenDeliveries();
      await auditStore.record({
        category: 'workspace-file',
        action: 'delivery.runHelper',
        outcome: 'allowed',
        projectRoot: ctx.projectRoot,
        sessionId: ctx.sessionId,
        resource: scriptTarget.relativePath,
        details: {
          written: deliveries.map((delivery) => delivery.relativePath),
          timeoutMs,
        },
      });
      return [
        `Partner helper executed: ${scriptTarget.relativePath}`,
        `Result: ${payload.resultPreview ?? 'undefined'}`,
        payload.logs.length > 0 ? `Logs:\n${payload.logs.join('\n')}` : 'Logs: none',
        deliveries.length > 0
          ? [
              'Deliveries:',
              ...deliveries.map((delivery) => `- ${delivery.id}: ${delivery.relativePath}`),
              ...deliveries.map((delivery) => partnerDeliveryReferenceLine(delivery)),
              'Use these exact links when referencing the outputs:',
              ...deliveries.map((delivery) => `- ${partnerDeliveryMarkdownLink(delivery)}`),
            ].join('\n')
          : 'Deliveries: none',
      ].join('\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      let deliveryRecordError: string | undefined;
      try {
        await registerWrittenDeliveries();
      } catch (deliveryErr) {
        deliveryRecordError =
          deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr);
      }
      await auditStore.record({
        category: 'workspace-file',
        action: 'delivery.runHelper',
        outcome: 'failed',
        projectRoot: ctx.projectRoot,
        sessionId: ctx.sessionId,
        resource: scriptPathInput,
        details: {
          error: message.slice(0, 240),
          written: deliveries.map((delivery) => delivery.relativePath),
          ...(deliveryRecordError
            ? { deliveryRecordError: deliveryRecordError.slice(0, 240) }
            : {}),
        },
      });
      return [
        `Error running Partner helper: ${message.slice(0, 240)}`,
        deliveries.length > 0
          ? [
              'Partial deliveries:',
              ...deliveries.map((delivery) => `- ${delivery.id}: ${delivery.relativePath}`),
              ...deliveries.map((delivery) => partnerDeliveryReferenceLine(delivery)),
            ].join('\n')
          : 'Partial deliveries: none',
        ...(deliveryRecordError
          ? [`Delivery registration error: ${deliveryRecordError.slice(0, 240)}`]
          : []),
      ].join('\n');
    }
  };
}

let registered = false;

export function _resetPartnerHelperRunnerRegistrationForTesting(): void {
  registered = false;
}

export function ensurePartnerHelperRunnerToolsRegistered(sdk: unknown): void {
  if (registered) return;
  const reg = (sdk as { registerTool?: (def: unknown) => () => void }).registerTool;
  if (typeof reg !== 'function') {
    console.warn(
      '[partner-helper-runner] sdk.registerTool unavailable; helper runner not registered',
    );
    return;
  }
  reg({
    ...RUN_PARTNER_HELPER_TOOL,
    handler: makeRunPartnerHelperHandler(partnerDeliveryStore),
  });
  registerPartnerSpaceToolPolicy({
    name: RUN_PARTNER_HELPER_TOOL.name,
    scope: 'workspace-delivery',
    sideEffect: RUN_PARTNER_HELPER_TOOL.sideEffect,
    description:
      'Runs restricted JavaScript helpers against Partner run-output files and records written outputs.',
  });
  registered = true;
}
