import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';

import { createSessionManager, exportSessionBundle } from '@kodax-ai/kodax/session';
import { createKodaXRuntime } from '@kodax-ai/kodax/runtime';

import {
  activeLineage,
  assertNativeForkPreservesCompleteHistory,
  lineageSemanticProjection,
  planCompactionContextRepair,
  removeRedundantCompactionContext,
  transcriptSemanticRevision,
} from './session-history-repair-core.mjs';

function usage() {
  return [
    'Usage:',
    '  node scripts/repair-kodax-session-history.mjs <session-id>',
    '  node scripts/repair-kodax-session-history.mjs <session-id> --apply [--target-id <id>]',
    '',
    'Options:',
    '  --sessions-dir <path>       Override ~/.kodax/sessions.',
    '  --backup-dir <path>         Override the timestamped backup directory.',
    '  --target-id <id>            ID for the repaired fork.',
    '  --validation-rounds <n>     Repeated SDK/Runtime reads (default: 5).',
    '  --skip-runtime-validation   Skip embedded Runtime load/observe/page checks.',
    '',
    'The default is a read-only dry run. --apply creates a new fork and never overwrites',
    'or deletes the source Session. Apply fails closed when a native fork would omit inactive',
    'full-history/audit entries.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    apply: false,
    sessionsDir: path.join(os.homedir(), '.kodax', 'sessions'),
    validationRounds: 5,
    runtimeValidation: true,
  };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--skip-runtime-validation') options.runtimeValidation = false;
    else if (arg === '--sessions-dir') options.sessionsDir = path.resolve(argv[++index] ?? '');
    else if (arg === '--backup-dir') options.backupDir = path.resolve(argv[++index] ?? '');
    else if (arg === '--target-id') options.targetId = argv[++index];
    else if (arg === '--validation-rounds') options.validationRounds = Number(argv[++index]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else positionals.push(arg);
  }
  if (!Number.isSafeInteger(options.validationRounds) || options.validationRounds < 2) {
    throw new Error('--validation-rounds must be an integer of at least 2.');
  }
  if (options.targetId !== undefined && !/^s_[A-Za-z0-9_-]+$/.test(options.targetId)) {
    throw new Error('--target-id must start with s_ and contain only letters, digits, _ or -.');
  }
  return { ...options, sessionId: positionals[0], extraPositionals: positionals.slice(1) };
}

function compactTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function canonicalEntryIdentity(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  if (typeof entry.logicalId === 'string' && entry.logicalId.length > 0) return entry.logicalId;
  if (typeof entry.sourceEntryId === 'string' && entry.sourceEntryId.length > 0) {
    return entry.sourceEntryId;
  }
  return typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : undefined;
}

function repairCandidateFingerprints(lineage, plan) {
  const byId = new Map(lineage.entries.map((entry) => [entry.id, entry]));
  return plan.candidates
    .map((candidate) => {
      const entry = byId.get(candidate.entryId);
      const parent = byId.get(candidate.parentId);
      const compaction = byId.get(candidate.compactionEntryId);
      if (!entry || !compaction) {
        throw new Error(`Repair candidate ${candidate.entryId} has an unresolved topology.`);
      }
      return {
        entryIdentity: canonicalEntryIdentity(entry),
        parentIdentity: canonicalEntryIdentity(parent),
        compactionIdentity: canonicalEntryIdentity(compaction),
        attachmentIndex: candidate.attachmentIndex,
        message: entry.message,
      };
    })
    .sort((left, right) =>
      `${left.entryIdentity}:${left.attachmentIndex}`.localeCompare(
        `${right.entryIdentity}:${right.attachmentIndex}`,
      ),
    );
}

async function writeBackup(bundle, backupDir, manifest) {
  await fs.mkdir(path.dirname(backupDir), { recursive: true });
  await fs.mkdir(backupDir, { recursive: false });
  const files = [];
  for (const file of bundle.files) {
    const fileName = path.basename(file.path);
    const outputPath = path.join(backupDir, fileName);
    const bytes = Buffer.from(file.contentBase64, 'base64');
    await fs.writeFile(outputPath, bytes, { flag: 'wx' });
    files.push({
      kind: file.kind,
      sourcePath: file.path,
      backupPath: outputPath,
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  await fs.writeFile(
    path.join(backupDir, 'manifest.json'),
    `${JSON.stringify({ ...manifest, files }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  return files;
}

async function validateStableSdkReads(manager, sessionId, rounds) {
  const observations = [];
  for (let round = 1; round <= rounds; round += 1) {
    const [loaded, capture] = await Promise.all([
      manager.loadSession(sessionId),
      manager.readSessionCapture(sessionId, { timeoutMs: 15_000 }),
    ]);
    if (!loaded || !capture) throw new Error(`Validation could not load ${sessionId}.`);
    observations.push({
      round,
      sourceRevision: capture.sourceRevision,
      transcriptRevision: transcriptSemanticRevision(capture.transcript),
      transcriptEntries: capture.transcript.transcriptEntries.length,
      activeMessages: loaded.messages.length,
    });
  }
  const first = observations[0];
  if (
    observations.some(
      (item) =>
        item.sourceRevision !== first.sourceRevision ||
        item.transcriptRevision !== first.transcriptRevision ||
        item.transcriptEntries !== first.transcriptEntries ||
        item.activeMessages !== first.activeMessages,
    )
  ) {
    throw new Error('Repeated SDK reads changed the repaired Session boundary.');
  }
  return observations;
}

async function collectRuntimeEntryIds(runtime, observation, sessionId) {
  const ids = [];
  let page = observation.snapshot.transcript;
  do {
    if (page) ids.unshift(...page.entries.map((entry) => entry.entryId));
    const cursor = page?.hasMore ? page.nextCursor : undefined;
    if (page?.hasMore && !cursor) throw new Error('Runtime page omitted its continuation cursor.');
    page = cursor
      ? await runtime.sessions.transcriptPage({ sessionId, cursor }, { timeoutMs: 15_000 })
      : null;
    if (cursor && !page) throw new Error('Runtime continuation page disappeared.');
  } while (page);
  return ids;
}

async function validateStableRuntimeReads(sessionsDir, sessionId, rounds) {
  const runtime = await createKodaXRuntime({
    mode: 'embedded',
    isolation: 'inline',
    sessionsDir,
    profile: `space-session-repair-${process.pid}`,
  });
  const observations = [];
  try {
    for (let round = 1; round <= rounds; round += 1) {
      const loaded = await runtime.sessions.load(sessionId, { timeoutMs: 15_000 });
      if (!loaded) throw new Error(`Runtime could not load ${sessionId}.`);
      const observation = await runtime.sessions.observe(sessionId, () => {}, {
        timeoutMs: 15_000,
      });
      try {
        const entryIds = await collectRuntimeEntryIds(runtime, observation, sessionId);
        observations.push({
          round,
          entryCount: entryIds.length,
          revision: sha256(JSON.stringify(entryIds)),
        });
      } finally {
        observation.close();
      }
    }
  } finally {
    await runtime.close();
  }
  const first = observations[0];
  if (
    observations.some(
      (item) => item.entryCount !== first.entryCount || item.revision !== first.revision,
    )
  ) {
    throw new Error('Repeated Runtime load/observe/page reads changed transcript order.');
  }
  return observations;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.sessionId || options.extraPositionals.length > 0) {
    throw new Error(usage());
  }

  const packageInfo = JSON.parse(
    await fs.readFile(
      new URL('../node_modules/@kodax-ai/kodax/package.json', import.meta.url),
      'utf8',
    ),
  );
  if (packageInfo.version !== '0.7.81') {
    throw new Error(`This repair was validated with KodaX 0.7.81; found ${packageInfo.version}.`);
  }

  const manager = createSessionManager({ sessionsDir: options.sessionsDir });
  // One SDK capture owns the plan, active context and transcript. Separate
  // loadSession/loadFullLineage/loadFullTranscript calls can straddle a writer
  // and describe different source revisions.
  const sourceCapture = await manager.readSessionCapture(options.sessionId, {
    timeoutMs: 15_000,
  });
  const source = sourceCapture?.data;
  const sourceTranscript = sourceCapture?.transcript;
  const sourceLineage = sourceTranscript?.lineage;
  if (!sourceCapture || !source || !sourceLineage || !sourceTranscript) {
    throw new Error(`Session not found: ${options.sessionId}`);
  }
  const active = activeLineage(sourceLineage);
  const plan = planCompactionContextRepair(active);
  const dryRun = {
    mode: options.apply ? 'apply' : 'dry-run',
    sdkVersion: packageInfo.version,
    sourceSessionId: options.sessionId,
    sourceTranscriptRevision: transcriptSemanticRevision(sourceTranscript),
    sourceTranscriptEntries: sourceTranscript.transcriptEntries.length,
    sourceActiveEntries: active.entries.length,
    sourceActiveMessages: source.messages.length,
    redundantCompactionContextEntries: plan.candidates,
  };
  if (!options.apply) {
    console.log(JSON.stringify(dryRun, null, 2));
    return;
  }

  // Native KodaX fork is an active-context operation. It is not a full-audit clone. The factual
  // polluted Session has hundreds of inactive historical entries, so proceeding here would create
  // a much smaller, misleading target even though the source itself remained safe.
  assertNativeForkPreservesCompleteHistory(sourceLineage, active);

  const targetId = options.targetId ?? `s_repaired_${crypto.randomUUID()}`;
  if (await manager.loadSession(targetId)) {
    throw new Error(`Target Session already exists: ${targetId}`);
  }
  const backupDir =
    options.backupDir ??
    path.join(
      path.dirname(options.sessionsDir),
      'session-repair-backups',
      `${compactTimestamp()}-${options.sessionId}`,
    );
  if (isPathInside(options.sessionsDir, backupDir)) {
    throw new Error('Backup directory must be outside the Session storage tree.');
  }
  const bundle = await exportSessionBundle(options.sessionId, {
    sessionsDir: options.sessionsDir,
    timeoutMs: 15_000,
  });
  if (bundle.status !== 'ok') {
    throw new Error(
      `Refusing repair because exact bundle export status is ${bundle.status}: ${JSON.stringify(bundle.diagnostics)}`,
    );
  }
  const captureAfterExport = await manager.readSessionCapture(options.sessionId, {
    timeoutMs: 15_000,
  });
  if (!captureAfterExport || captureAfterExport.sourceRevision !== sourceCapture.sourceRevision) {
    throw new Error(
      'Source Session changed while exporting its exact backup; no target was created.',
    );
  }
  const backupFiles = await writeBackup(bundle, backupDir, {
    createdAt: new Date().toISOString(),
    sdkVersion: packageInfo.version,
    sourceSessionId: options.sessionId,
    plannedCaptureRevision: sourceCapture.sourceRevision,
    verifiedAfterExportRevision: captureAfterExport.sourceRevision,
    plannedTargetSessionId: targetId,
    diagnostics: bundle.diagnostics,
  });

  let targetCreated = false;
  try {
    const captureBeforeFork = await manager.readSessionCapture(options.sessionId, {
      timeoutMs: 15_000,
    });
    if (!captureBeforeFork || captureBeforeFork.sourceRevision !== sourceCapture.sourceRevision) {
      throw new Error('Source Session changed after backup; no repair target was created.');
    }
    const fork = await manager.forkSession(options.sessionId, {
      sessionId: targetId,
      title: `Repaired - ${source.title}`,
    });
    if (!fork) throw new Error('KodaX native fork returned no Session.');
    targetCreated = true;

    const captureAfterFork = await manager.readSessionCapture(options.sessionId, {
      timeoutMs: 15_000,
    });
    if (!captureAfterFork || captureAfterFork.sourceRevision !== sourceCapture.sourceRevision) {
      throw new Error('Source Session changed while creating the repair fork.');
    }

    const expectedCandidateFingerprints = repairCandidateFingerprints(active, plan);
    let removedEntryIds = [];
    let targetCandidateEntryIds = [];
    const found = await manager.storage.mutateLineage(targetId, (lineage) => {
      const targetActive = activeLineage(lineage);
      if (targetActive.entries.length !== lineage.entries.length) {
        throw new Error('Native repair fork unexpectedly retained inactive audit branches.');
      }
      if (
        !isDeepStrictEqual(
          lineageSemanticProjection(targetActive),
          lineageSemanticProjection(active),
        )
      ) {
        throw new Error('Native repair fork changed active-path semantics or topology.');
      }
      const actualPlan = planCompactionContextRepair(targetActive);
      const actualCandidateFingerprints = repairCandidateFingerprints(targetActive, actualPlan);
      if (!isDeepStrictEqual(actualCandidateFingerprints, expectedCandidateFingerprints)) {
        throw new Error('Repair candidate provenance changed across the native fork boundary.');
      }
      targetCandidateEntryIds = actualPlan.candidates.map((candidate) => candidate.entryId).sort();
      const repaired = removeRedundantCompactionContext(targetActive);
      removedEntryIds = repaired.removedEntryIds;
      return repaired.lineage;
    });
    if (!found) throw new Error('Repaired fork disappeared before lineage mutation.');
    if (!isDeepStrictEqual([...removedEntryIds].sort(), targetCandidateEntryIds)) {
      throw new Error('Applied repair entry IDs differ from the verified fork candidate set.');
    }

    const targetLineage = await manager.storage.loadFullLineage(targetId);
    if (!targetLineage) throw new Error('Repaired fork has no readable lineage.');
    const remaining = planCompactionContextRepair(activeLineage(targetLineage));
    if (remaining.candidates.length > 0) {
      throw new Error(`Repair left ${remaining.candidates.length} redundant context entries.`);
    }

    const sdkValidation = await validateStableSdkReads(manager, targetId, options.validationRounds);
    const runtimeValidation = options.runtimeValidation
      ? await validateStableRuntimeReads(options.sessionsDir, targetId, options.validationRounds)
      : [];
    const sourceAfter = await manager.readSessionCapture(options.sessionId, { timeoutMs: 15_000 });
    if (!sourceAfter || sourceAfter.sourceRevision !== sourceCapture.sourceRevision) {
      throw new Error('Source Session changed while the repaired fork was being validated.');
    }

    console.log(
      JSON.stringify(
        {
          ...dryRun,
          targetSessionId: targetId,
          backupDir,
          backupFiles,
          removedEntryIds,
          sourceUnchanged: true,
          sdkValidation,
          runtimeValidation,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (targetCreated) {
      console.error(
        `Repair validation failed. Source is untouched; incomplete target ${targetId} was retained for audit.`,
      );
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
