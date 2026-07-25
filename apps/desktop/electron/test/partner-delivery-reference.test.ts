import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatPartnerDeliveryUri } from '@kodax-space/space-ipc-schema';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PartnerDeliveryStore } from '../kodax/partner-delivery-store.js';
import { resolvePartnerDeliveryReference } from '../ipc/partner-deliveries.js';
import {
  partnerDeliveryPreviewVersion,
  parsePartnerDeliveryToolResult,
  parsePartnerDeliveryToolResults,
} from '../../renderer/src/lib/generatedResourceRef.js';
import { Markdown } from '../../renderer/src/features/session/messages/Markdown.js';
import { I18nProvider } from '../../renderer/src/i18n/I18nProvider.js';

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'partner-delivery-reference-'));
  const projectRoot = join(dir, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const store = new PartnerDeliveryStore(join(dir, 'deliveries.json'), join(dir, 'partner-runs'));
  return { dir, projectRoot, store };
}

test('Delivery resolver scopes stable ids and legacy paths to project and Session', async () => {
  const { dir, projectRoot, store } = harness();
  try {
    const first = await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'partner-output/report.md',
      bytes: Buffer.from('first'),
      producer: 'write_partner_deliverable',
    });
    const second = await store.writeRunOutput({
      sessionId: 's2',
      projectRoot,
      relativePath: 'partner-output/report.md',
      bytes: Buffer.from('second'),
      producer: 'write_partner_deliverable',
    });

    const byId = await resolvePartnerDeliveryReference(store, {
      projectRoot,
      sessionId: 's1',
      reference: { type: 'id', id: first.id },
    });
    assert.equal(byId.status, 'found');
    assert.equal(byId.delivery?.id, first.id);

    const wrongSession = await resolvePartnerDeliveryReference(store, {
      projectRoot,
      sessionId: 's2',
      reference: { type: 'id', id: first.id },
    });
    assert.equal(wrongSession.status, 'not-found');

    const scopedPath = await resolvePartnerDeliveryReference(store, {
      projectRoot,
      sessionId: 's2',
      reference: { type: 'path', path: 'partner-output/report.md' },
    });
    assert.equal(scopedPath.status, 'found');
    assert.equal(scopedPath.delivery?.id, second.id);

    const unscopedPath = await resolvePartnerDeliveryReference(store, {
      projectRoot,
      reference: { type: 'path', path: 'partner-output/report.md' },
    });
    assert.equal(unscopedPath.status, 'ambiguous');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Delivery resolver reports and prunes a registered output whose file disappeared', async () => {
  const { dir, projectRoot, store } = harness();
  try {
    const delivery = await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'partner-output/missing.md',
      bytes: Buffer.from('temporary'),
      producer: 'write_partner_deliverable',
    });
    rmSync(delivery.absolutePath);

    const resolution = await resolvePartnerDeliveryReference(store, {
      projectRoot,
      sessionId: 's1',
      reference: { type: 'id', id: delivery.id },
    });
    assert.equal(resolution.status, 'missing');
    assert.deepEqual(resolution.removed, { id: delivery.id, sessionId: 's1' });
    assert.equal(await store.get(delivery.id), null);
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rewriting one Delivery advances its stable preview revision', async () => {
  const { dir, projectRoot, store } = harness();
  try {
    const first = await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'partner-output/report.md',
      bytes: Buffer.from('first'),
      producer: 'write_partner_deliverable',
    });
    const second = await store.writeRunOutput({
      sessionId: 's1',
      projectRoot,
      relativePath: 'partner-output/report.md',
      bytes: Buffer.from('second'),
      producer: 'write_partner_deliverable',
    });

    assert.equal(second.id, first.id);
    assert.ok(second.updatedAt > first.updatedAt);
    assert.ok(
      partnerDeliveryPreviewVersion(second.updatedAt) >
        partnerDeliveryPreviewVersion(first.updatedAt),
    );
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Delivery tool-result parser reads canonical multi-output references', () => {
  const first = {
    type: 'partner-delivery',
    id: 'pd_first',
    title: 'First report',
    relativePath: 'partner-output/first.md',
    uri: formatPartnerDeliveryUri('pd_first'),
  };
  const second = {
    type: 'partner-delivery',
    id: 'pd_second',
    title: 'Second report',
    relativePath: 'partner-output/second.md',
    uri: formatPartnerDeliveryUri('pd_second'),
  };
  const parsed = parsePartnerDeliveryToolResults(
    `Deliveries:\nDelivery reference: ${JSON.stringify(first)}\nDelivery reference: ${JSON.stringify(second)}`,
  );
  assert.deepEqual(
    parsed.map((item) => item.id),
    ['pd_first', 'pd_second'],
  );
  assert.equal(parsed[1]?.uri, formatPartnerDeliveryUri('pd_second'));
});

test('Delivery tool-result parser upgrades historical single and helper results', () => {
  const single = parsePartnerDeliveryToolResult(
    'Partner deliverable written: Brief\nDelivery id: pd_old\nRelative path: partner-output/brief.md',
  );
  assert.deepEqual(single, {
    id: 'pd_old',
    title: 'Brief',
    relativePath: 'partner-output/brief.md',
    uri: formatPartnerDeliveryUri('pd_old'),
  });

  const helper = parsePartnerDeliveryToolResults(
    'Partner helper executed: helpers/build.js\nDeliveries:\n- pd_one: reports/one.md\n- pd_two: reports/two.json',
  );
  assert.deepEqual(
    helper.map((item) => [item.id, item.relativePath]),
    [
      ['pd_one', 'reports/one.md'],
      ['pd_two', 'reports/two.json'],
    ],
  );
});

test('Markdown preserves typed Partner Delivery links as generated-resource anchors', () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
  try {
    const uri = formatPartnerDeliveryUri('pd_markdown');
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(Markdown, { content: `[Open report](<${uri}>)` }),
      ),
    );
    assert.match(html, /href="kodax-space:\/\/partner-delivery\/pd_markdown"/);
    assert.match(html, /data-generated-resource="partner-delivery"/);
    assert.match(html, />Open report<\/a>/);
  } finally {
    if (navigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator;
    }
  }
});
