import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import {
  clearLastOpenedFileViewerSnapshotForSession,
  collectTransientArtifactsFromEvents,
  dispatchOpenFileViewer,
  getLastOpenedFileViewerSnapshot,
  isFileViewerSnapshot,
  mergeTransientArtifactSnapshots,
  snapshotFromCreateArtifactTool,
  upsertTransientArtifact,
  type TransientArtifactSnapshot,
} from '../../renderer/src/features/artifact/transientArtifact.js';

test('Session attachment File Viewer snapshot is scoped to both project and Session', () => {
  const globalWithWindow = globalThis as unknown as {
    window?: { dispatchEvent(event: Event): boolean };
  };
  const previousWindow = globalWithWindow.window;
  globalWithWindow.window = { dispatchEvent: () => true };
  try {
    dispatchOpenFileViewer({
      id: 'session-image-scoped',
      kind: 'image',
      title: 'Image 1',
      source: 'session-attachment-preview',
      content: 'app://space/session-attachment/token?variant=original',
      projectRoot: 'C:/project-a',
      sessionId: 'session-a',
    });
    assert.equal(
      getLastOpenedFileViewerSnapshot('C:/project-a', 'session-a')?.id,
      'session-image-scoped',
    );
    assert.equal(getLastOpenedFileViewerSnapshot('C:/project-b', 'session-a'), null);
    assert.equal(getLastOpenedFileViewerSnapshot('C:/project-a', 'session-b'), null);
    clearLastOpenedFileViewerSnapshotForSession('session-a');
    assert.equal(getLastOpenedFileViewerSnapshot('C:/project-a', 'session-a'), null);
  } finally {
    if (previousWindow === undefined) delete globalWithWindow.window;
    else globalWithWindow.window = previousWindow;
  }
});

test('file and Delivery previews belong to File Viewer, not Artifacts', () => {
  assert.equal(
    isFileViewerSnapshot({
      id: 'file-preview-readme',
      kind: 'markdown',
      title: 'README.md',
      source: 'file-preview',
      content: '# Readme',
    }),
    true,
  );
  assert.equal(
    isFileViewerSnapshot({
      id: 'delivery-preview-report',
      kind: 'pdf',
      title: 'Report.pdf',
      source: 'delivery-preview',
      path: 'Report.pdf',
    }),
    true,
  );
  assert.equal(
    isFileViewerSnapshot({
      id: 'session-image',
      kind: 'image',
      title: 'Image 1',
      source: 'session-attachment-preview',
      content: 'app://space/session-attachment/token?variant=original',
    }),
    true,
  );
  assert.equal(
    isFileViewerSnapshot({
      id: 'artifact-report',
      kind: 'markdown',
      title: 'Report',
      source: 'artifact',
      content: '# Report',
    }),
    false,
  );
});

function createArtifactStart(toolId: string, content: string, summary: string): SessionEvent {
  return {
    kind: 'tool_start',
    sessionId: 's1',
    toolId,
    toolName: 'create_artifact',
    input: {
      kind: 'html',
      title: 'Launch Film',
      summary,
      content,
    },
  } as unknown as SessionEvent;
}

function createArtifactResult(toolId: string, version: number): SessionEvent {
  return {
    kind: 'tool_result',
    sessionId: 's1',
    toolId,
    toolName: 'create_artifact',
    content: `Created artifact Launch Film (id=a1, v${version})`,
  } as unknown as SessionEvent;
}

test('collectTransientArtifactsFromEvents groups create_artifact versions from transcript', () => {
  const events: SessionEvent[] = [
    createArtifactStart('t1', '<h1>v1</h1>', 'first'),
    createArtifactResult('t1', 1),
    createArtifactStart('t2', '<h1>v2</h1>', 'second'),
    createArtifactResult('t2', 2),
    createArtifactStart('t3', '<canvas></canvas><script>draw()</script>', 'third'),
    createArtifactResult('t3', 3),
  ];

  const artifacts = collectTransientArtifactsFromEvents(events);

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.id, 'a1');
  assert.equal(artifacts[0]?.version, 3);
  assert.equal(artifacts[0]?.kind, 'interactive-html');
  assert.deepEqual(
    artifacts[0]?.versions?.map((version) => ({
      v: version.v,
      summary: version.summary,
      content: version.content,
    })),
    [
      { v: 1, summary: 'first', content: '<h1>v1</h1>' },
      { v: 2, summary: 'second', content: '<h1>v2</h1>' },
      { v: 3, summary: 'third', content: '<canvas></canvas><script>draw()</script>' },
    ],
  );
});

test('upsertTransientArtifact folded incrementally equals a full transcript rescan', () => {
  // The appStore reducer maintains transientArtifactsBySession incrementally: on
  // each create_artifact tool_result it reads the matching tool_start input from
  // the prior events, snapshots, and upserts. This must match the full rescan the
  // view used to run on every text_delta — otherwise fork/rewind (which rescan)
  // and live streaming (which fold) would disagree.
  const events: SessionEvent[] = [
    createArtifactStart('t1', '<h1>v1</h1>', 'first'),
    createArtifactResult('t1', 1),
    createArtifactStart('t2', '<h1>v2</h1>', 'second'),
    createArtifactResult('t2', 2),
    createArtifactStart('t3', '<canvas></canvas><script>draw()</script>', 'third'),
    createArtifactResult('t3', 3),
  ];

  let incremental: readonly TransientArtifactSnapshot[] = [];
  const seen: SessionEvent[] = [];
  for (const event of events) {
    if (event.kind === 'tool_result') {
      const start = [...seen]
        .reverse()
        .find(
          (e) =>
            e.kind === 'tool_start' &&
            e.toolId === event.toolId &&
            e.toolName === 'create_artifact',
        );
      if (start && start.kind === 'tool_start') {
        const snapshot = snapshotFromCreateArtifactTool({
          status: 'done',
          input: start.input,
          result: event.content,
        });
        if (snapshot) incremental = upsertTransientArtifact(incremental, snapshot);
      }
    }
    seen.push(event);
  }

  assert.deepEqual(incremental, collectTransientArtifactsFromEvents(events));
});

test('mergeTransientArtifactSnapshots preserves transcript versions when focusing one card', () => {
  const grouped = collectTransientArtifactsFromEvents([
    createArtifactStart('t1', '<h1>v1</h1>', 'first'),
    createArtifactResult('t1', 1),
    createArtifactStart('t2', '<h1>v2</h1>', 'second'),
    createArtifactResult('t2', 2),
    createArtifactStart('t3', '<h1>v3</h1>', 'third'),
    createArtifactResult('t3', 3),
  ])[0];
  assert.ok(grouped);

  const focused = collectTransientArtifactsFromEvents([
    createArtifactStart('t3-focus', '<h1>v3</h1>', 'third'),
    createArtifactResult('t3-focus', 3),
  ])[0];
  assert.ok(focused);

  const merged = mergeTransientArtifactSnapshots(grouped, focused);

  assert.equal(merged.version, 3);
  assert.deepEqual(
    merged.versions?.map((version) => version.v),
    [1, 2, 3],
  );
});
