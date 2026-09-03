// Contract probe — verify the transcript revision semantics against the REAL
// local daemon before implementing the Issue-204 certification fence.
//
// No LLM involved: entries are created with sessions.appendNotice (the same
// API Space's local notices use), so the probe is deterministic and free.
//
// Questions this answers (the A′ design decisions):
//   Q1  Do live observation `transcriptRevision` and page `revision` /
//       `sourceRevision` share a domain (ever equal)?
//   Q2  Does an append change the page revision (progress-detection validity)
//       and does the appended entry's id appear in the page (entry-presence
//       validity)?
//   Q3  What does `sessions.diagnostics` return for a session with no Runs —
//       the D1-lite settlement witness shape?
//   Q4  Do stale reads fence correctly (resync / unchanged snapshot)?
//   Q5  After a later append (P3 "follow-up"), is the old revision permanently
//       gone (equality-fence failure mode, recorded for the report)?
//
// Usage: node e2e/verify-revision-contract.mjs
// Writes artifacts/e2e-perf/revision-contract-report.json

import { connectKodaXRuntime } from '@kodax-ai/kodax/runtime';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const homeDir = path.join(os.tmpdir(), `kodax-revision-contract-${Date.now()}`);
fs.mkdirSync(homeDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { homeDir, steps: [] };
const record = (step, data) => {
  report.steps.push({ step, ...data });
  console.log(`[${step}]`, JSON.stringify(data).slice(0, 600));
};

const runtime = await connectKodaXRuntime({
  profile: 'coder',
  autoStart: true,
  daemonOrphanExitMs: 30_000,
  homeDir,
  sessionsDir: path.join(homeDir, 'sessions'),
  clientInfo: { name: 'kodax-space-revision-probe', version: '0.0.0-probe' },
});
record('connected', { state: runtime.state ?? 'unknown' });

const sessionId = `probe_${Date.now().toString(36)}`;
const projectPath = path.join(homeDir, 'project');
fs.mkdirSync(projectPath, { recursive: true });

// Q0: create like Space's ensureSessionUnlocked does.
const created = await runtime.sessions.create({
  sessionId,
  projectPath,
  gitRoot: projectPath,
  surface: 'space-desktop',
  tag: 'code',
});
record('created', { sessionId, createdId: created?.id ?? created?.sessionId ?? String(created).slice(0, 80) });

async function readPage() {
  const page = await runtime.sessions.conversationPage({ sessionId });
  return {
    revision: page?.revision ?? null,
    sourceRevision: page?.sourceRevision ?? null,
    status: page?.status ?? null,
    entryIds: (page?.entries ?? []).map((e) => e.entryId ?? e.boundaryId ?? `idx:${e.index}`),
    count: page?.entries?.length ?? 0,
  };
}

async function captureObservation() {
  // observe() installs a subscription and resolves with the initial snapshot.
  const observation = await runtime.sessions.observe(sessionId, () => {});
  const snapshot = observation.snapshot ?? observation;
  const picked = {
    transcriptRevision: snapshot.transcriptRevision ?? null,
    transcriptRevisionField: snapshot.transcript?.revision ?? null,
    keys: Object.keys(snapshot).slice(0, 24),
  };
  return { observation, picked };
}

const page0 = await readPage();
record('page0-empty', page0);

const obs0 = await captureObservation();
record('obs0', obs0.picked);
obs0.observation.close?.();

// Q2: append one notice, then compare.
await runtime.sessions.appendNotice({ sessionId, content: 'probe entry one', source: 'revision-probe' });
await sleep(500);
const page1 = await readPage();
record('page1-after-append', {
  ...page1,
  revisionChanged: page1.revision !== page0.revision,
  sourceRevisionChanged: page1.sourceRevision !== page0.sourceRevision,
  countDelta: page1.count - page0.count,
});

const obs1 = await captureObservation();
record('obs1', obs1.picked);
obs1.observation.close?.();

// Q1: domain equality matrix.
const equality = {
  'page1.revision === obs1.transcriptRevision': page1.revision === obs1.picked.transcriptRevision,
  'page1.revision === obs1.transcript.revision': page1.revision === obs1.picked.transcriptRevisionField,
  'page1.sourceRevision === obs1.transcriptRevision': page1.sourceRevision === obs1.picked.transcriptRevision,
  'page1.sourceRevision === obs1.transcript.revision': page1.sourceRevision === obs1.picked.transcriptRevisionField,
  'page1.revision === page1.sourceRevision': page1.revision === page1.sourceRevision,
};
record('Q1-equality-matrix', equality);

// Q4: stale cursor behavior after append.
let staleBehavior = 'page0-had-no-cursor';
try {
  // Re-read with an explicit limit to obtain a cursor, append, then re-read with that cursor.
  const limited = await runtime.sessions.conversationPage({ sessionId, limit: 1 });
  await runtime.sessions.appendNotice({ sessionId, content: 'probe entry two', source: 'revision-probe' });
  await sleep(500);
  if (limited?.nextCursor) {
    try {
      const stale = await runtime.sessions.conversationPage({ sessionId, cursor: limited.nextCursor });
      staleBehavior = stale
        ? `stale-cursor-read-ok (revisionChanged=${stale.revision !== limited.revision})`
        : 'stale-cursor-read-null';
    } catch (err) {
      staleBehavior = `stale-cursor-read-threw: ${String(err?.message ?? err).slice(0, 120)}`;
    }
  } else {
    staleBehavior = `no-cursor-returned (hasMore=${limited?.hasMore}, count=${limited?.entries?.length})`;
  }
} finally {
  record('Q4-stale-cursor', { staleBehavior });
}

// Q5 (P3): capture an "evidence revision" now, append again (the follow-up),
// then verify the old revision never returns on fresh reads.
const evidenceRevision = (await readPage()).revision;
await runtime.sessions.appendNotice({ sessionId, content: 'probe follow-up append', source: 'revision-probe' });
await sleep(500);
const pageAfterFollowUp = await readPage();
const pageAgain = await readPage();
record('Q5-p3-advancement', {
  evidenceRevision: evidenceRevision?.slice(0, 20),
  afterFollowUpRevision: pageAfterFollowUp.revision?.slice(0, 20),
  revisionChangedByFollowUp: pageAfterFollowUp.revision !== evidenceRevision,
  stableAcrossReads: pageAgain.revision === pageAfterFollowUp.revision,
});

// Q3: diagnostics shape for D1-lite.
let diagnosticsShape;
try {
  const diag = await runtime.sessions.diagnostics({ sessionId });
  diagnosticsShape = {
    ok: true,
    keys: Object.keys(diag ?? {}),
    sessionKeys: diag?.session ? Object.keys(diag.session).slice(0, 20) : null,
    runs: diag?.runs ? diag.runs.length : undefined,
    sample: JSON.stringify(diag ?? {}).slice(0, 400),
  };
} catch (err) {
  diagnosticsShape = { ok: false, error: String(err?.message ?? err).slice(0, 200) };
}
record('Q3-diagnostics', diagnosticsShape);

// entry-presence validity: the two appended notices must be locatable in the page.
const finalPage = await readPage();
const presence = {
  finalCount: finalPage.count,
  textSamples: finalPage.entryIds.slice(-4),
};
record('entry-presence', presence);

// Cleanup the probe session best-effort.
try {
  await runtime.sessions.delete(sessionId);
  record('cleanup', { deleted: sessionId });
} catch (err) {
  record('cleanup', { error: String(err?.message ?? err).slice(0, 120) });
}

const out = path.join(process.cwd(), 'artifacts', 'e2e-perf', 'revision-contract-report.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log('report →', out);

try {
  await runtime.disconnect?.();
} catch {
  /* orphan exit will reap it */
}
process.exit(0);
