import { canonProjectRoot, MAX_FILE_BYTES } from '@kodax-space/space-ipc-schema';
import type { FileNodeT } from '@kodax-space/space-ipc-schema';
import { lstat, open } from 'node:fs/promises';
import { extname } from 'node:path';
import { projectStore } from '../projects/store.js';
import { resolveInsideProject, readFileWithGuards, walkTree } from '../ipc/files-core.js';
import { runPartnerSourceExtractionWorker } from './partner-source-extraction-runner.js';
import type { PartnerSourceExtractionFormat } from './partner-source-extraction-protocol.js';
import {
  resolveSessionRunContext,
  type SdkToolExecutionContextLike,
} from './session-run-context.js';
import { registerPartnerSpaceToolPolicy } from './partner-tools.js';
import { partnerSourceStore, type PartnerSourceStore } from './partner-source-store.js';

const MAX_TOOL_RESULT_CHARS = 180_000;

const DESCRIPTION = [
  'Read one Partner source that the user attached to the current Partner session.',
  'Use this before making source-dependent claims. Pass the exact sourceId from the Partner source list.',
  'For file sources this returns UTF-8 text or bounded text extracted from PDF, DOCX, XLSX, and PPTX. For directory sources this returns a bounded tree.',
  'The tool is read-only and cannot read paths outside the registered source/project boundary.',
].join('\n');

export const PARTNER_SOURCE_READ_TOOL = {
  name: 'partner_source_read',
  description: DESCRIPTION,
  sideEffect: 'readonly' as const,
  input_schema: {
    type: 'object' as const,
    properties: {
      sourceId: {
        type: 'string',
        description: 'The id of a source attached to the current Partner session.',
      },
    },
    required: ['sourceId'],
  },
};

interface PartnerSourceReadDeps {
  readonly store: PartnerSourceStore;
  readonly assertAllowedProjectRoot?: (projectRoot: string) => Promise<string>;
}

type ToolHandler = (
  input: Record<string, unknown>,
  context?: SdkToolExecutionContextLike,
) => Promise<string>;

function capToolResult(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n[partner_source_read truncated at ${MAX_TOOL_RESULT_CHARS} chars]`;
}

interface BoundedFile {
  readonly bytes: Buffer;
  readonly size: number;
  readonly truncated: boolean;
}

interface ExtractedOfficeText {
  readonly format: 'PDF' | 'DOCX' | 'XLSX' | 'PPTX';
  readonly text: string;
}

async function readBoundedFile(absPath: string): Promise<BoundedFile> {
  const pathStat = await lstat(absPath);
  if (!pathStat.isFile()) throw new Error('not a regular file');
  const handle = await open(absPath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('not a regular file');
    if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) {
      throw new Error('source file changed while it was being opened');
    }
    if (stat.size > MAX_FILE_BYTES)
      return { bytes: Buffer.alloc(0), size: stat.size, truncated: true };
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    if (
      offset !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    ) {
      throw new Error('source file changed while it was being read');
    }
    return { bytes, size: stat.size, truncated: false };
  } finally {
    await handle.close();
  }
}

async function extractOfficeText(path: string, bytes: Buffer): Promise<ExtractedOfficeText | null> {
  const extension = extname(path).toLowerCase();
  let format: PartnerSourceExtractionFormat | null = null;
  if (extension === '.pdf') {
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-')
      throw new Error('file has no PDF signature');
    format = 'PDF';
  }
  if (extension === '.docx') format = 'DOCX';
  if (extension === '.xlsx') format = 'XLSX';
  if (extension === '.pptx') format = 'PPTX';
  if (!format) return null;
  return { format, text: await runPartnerSourceExtractionWorker(format, bytes) };
}

function safeExtractionError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown extraction error';
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 300);
}

function decodedTextLooksBinary(text: string): boolean {
  if (text.includes('\uFFFD')) return true;
  const sample = text.slice(0, 4096);
  if (sample.length === 0) return false;
  let controlCharacters = 0;
  for (const character of sample) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 0x20 && character !== '\t' && character !== '\n' && character !== '\r') {
      controlCharacters += 1;
    }
  }
  return controlCharacters / sample.length > 0.01;
}

function renderTree(nodes: readonly FileNodeT[], depth = 0): string[] {
  const lines: string[] = [];
  const prefix = '  '.repeat(depth);
  for (const node of nodes) {
    lines.push(`${prefix}- ${node.kind === 'dir' ? '[dir]' : '[file]'} ${node.path}`);
    if (node.children && node.children.length > 0) {
      lines.push(...renderTree(node.children, depth + 1));
    }
  }
  return lines;
}

export function makePartnerSourceReadHandler(deps: PartnerSourceReadDeps): ToolHandler {
  return async (
    input: Record<string, unknown>,
    toolContext?: SdkToolExecutionContextLike,
  ): Promise<string> => {
    const ctx = resolveSessionRunContext(toolContext);
    if (!ctx) {
      return 'Error: partner_source_read was called outside an active session run.';
    }
    if (ctx.surface !== 'partner') {
      return 'Error: partner_source_read is only available in Partner sessions.';
    }

    const sourceId = typeof input.sourceId === 'string' ? input.sourceId.trim() : '';
    if (!sourceId) return 'Error: sourceId is required.';

    const source = await deps.store.get(ctx.sessionId, sourceId);
    if (!source) return `Error: source not found for this Partner session: ${sourceId}`;

    if (
      canonProjectRoot(source.projectRoot, process.platform === 'win32') !==
      canonProjectRoot(ctx.projectRoot, process.platform === 'win32')
    ) {
      return 'Error: source belongs to a different project root than the current session.';
    }

    const assertAllowedProjectRoot =
      deps.assertAllowedProjectRoot ??
      ((projectRoot: string) => projectStore.assertAllowed(projectRoot));
    const allowedRoot = await assertAllowedProjectRoot(source.projectRoot);
    const absPath = await resolveInsideProject(allowedRoot, source.path);

    if (source.targetKind === 'dir') {
      const counter = { count: 0 };
      const tree = await walkTree(allowedRoot, absPath, 2, counter);
      const body = renderTree(tree).join('\n') || '(empty directory)';
      return capToolResult(
        [
          `Source: ${source.id}`,
          `Path: ${source.path}`,
          'Kind: directory',
          `Truncated: ${counter.count >= 5000 ? 'yes' : 'no'}`,
          '',
          body,
        ].join('\n'),
      );
    }

    const extension = extname(source.path).toLowerCase();
    if (
      extension === '.pdf' ||
      extension === '.docx' ||
      extension === '.xlsx' ||
      extension === '.pptx'
    ) {
      const bounded = await readBoundedFile(absPath);
      if (bounded.truncated) {
        return `Source: ${source.id}\nPath: ${source.path}\nKind: file\nSize: ${bounded.size}\n\n[File is too large to read inline.]`;
      }
      try {
        const extracted = await extractOfficeText(source.path, bounded.bytes);
        if (extracted) {
          return capToolResult(
            [
              `Source: ${source.id}`,
              `Path: ${source.path}`,
              'Kind: file',
              `Size: ${bounded.size}`,
              `Extracted format: ${extracted.format}`,
              '',
              extracted.text || '[No extractable text found.]',
            ].join('\n'),
          );
        }
      } catch (error) {
        return [
          `Source: ${source.id}`,
          `Path: ${source.path}`,
          'Kind: file',
          `Size: ${bounded.size}`,
          '',
          `[Unable to extract document text: ${safeExtractionError(error)}]`,
        ].join('\n');
      }
    }

    const read = await readFileWithGuards(absPath);
    if (read.truncated) {
      return `Source: ${source.id}\nPath: ${source.path}\nKind: file\nSize: ${read.size}\n\n[File is too large to read inline.]`;
    }
    if (read.isBinary || decodedTextLooksBinary(read.content)) {
      return `Source: ${source.id}\nPath: ${source.path}\nKind: file\nSize: ${read.size}\n\n[Binary file; text content unavailable.]`;
    }
    return capToolResult(
      [
        `Source: ${source.id}`,
        `Path: ${source.path}`,
        'Kind: file',
        `Size: ${read.size}`,
        '',
        read.content,
      ].join('\n'),
    );
  };
}

let registered = false;

export function _resetPartnerSourceToolRegistrationForTesting(): void {
  registered = false;
}

export function ensurePartnerSourceToolRegistered(sdk: unknown): void {
  if (registered) return;
  const reg = (sdk as { registerTool?: (def: unknown) => () => void }).registerTool;
  if (typeof reg !== 'function') {
    console.warn(
      '[partner-source] sdk.registerTool unavailable; partner_source_read not registered',
    );
    return;
  }
  reg({
    ...PARTNER_SOURCE_READ_TOOL,
    handler: makePartnerSourceReadHandler({ store: partnerSourceStore }),
  });
  registerPartnerSpaceToolPolicy({
    name: PARTNER_SOURCE_READ_TOOL.name,
    scope: 'source',
    sideEffect: PARTNER_SOURCE_READ_TOOL.sideEffect,
    description: 'Reads user-selected Partner sources for evidence gathering.',
  });
  registered = true;
}
