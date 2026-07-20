import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  artifactCreateChannel,
  artifactPreviewFileChannel,
  artifactReadBinaryChannel,
} from '../src/index.js';

test('artifact.previewFile output is a read-only preview payload', () => {
  assert.equal(
    artifactPreviewFileChannel.output.safeParse({
      title: 'README.md',
      kind: 'markdown',
      content: '# Notes',
      path: 'README.md',
    }).success,
    true,
  );
  assert.equal(
    artifactPreviewFileChannel.output.safeParse({
      title: 'report.pdf',
      kind: 'pdf',
      path: 'docs/report.pdf',
    }).success,
    true,
  );
  assert.equal(
    artifactPreviewFileChannel.output.safeParse({
      title: 'deck.pptx',
      kind: 'pptx',
      path: 'deck.pptx',
    }).success,
    true,
  );
});

test('legacy artifact.previewFile keeps its Session-scoped compatibility contract', () => {
  const fileOnly = { projectRoot: 'C:/project', path: 'README.md' };
  assert.equal(artifactPreviewFileChannel.input.safeParse(fileOnly).success, false);
  assert.equal(
    artifactPreviewFileChannel.input.safeParse({
      ...fileOnly,
      sessionId: 's1',
      surface: 'code',
    }).success,
    true,
  );
});

test('artifact.previewFile output rejects old persisted artifact shape', () => {
  assert.equal(
    artifactPreviewFileChannel.output.safeParse({
      id: 'a1',
      version: 1,
      kind: 'markdown',
    }).success,
    false,
  );
});

test('artifact.create accepts pptx as a path-backed artifact kind', () => {
  assert.equal(
    artifactCreateChannel.input.safeParse({
      sessionId: 's',
      surface: 'partner',
      kind: 'pptx',
      title: 'Deck',
      path: 'deck.pptx',
    }).success,
    true,
  );
  assert.equal(
    artifactCreateChannel.input.safeParse({
      sessionId: 's',
      surface: 'partner',
      kind: 'pptx',
      title: 'Deck',
      content: 'not binary',
    }).success,
    false,
  );
});

test('artifact.readBinary is bounded to explicit artifact versions', () => {
  assert.equal(
    artifactReadBinaryChannel.input.safeParse({
      id: 'a1',
      version: 1,
      maxBytes: 25 * 1024 * 1024,
    }).success,
    true,
  );
  assert.equal(
    artifactReadBinaryChannel.input.safeParse({
      id: 'a1',
      maxBytes: 60 * 1024 * 1024,
    }).success,
    false,
  );
});
