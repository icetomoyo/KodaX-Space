import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sandboxStatusSchema } from '@kodax-space/space-ipc-schema';
import { sandboxController } from '../ipc/sandbox.js';
import { getSandboxSdkCapability, probeKodaxSdk } from '../kodax/kodax-sdk-probe.js';
import { sandboxCommandCapability } from '../kodax/sandbox-capability-row.js';

test('real sandbox status refresh updates the shared space.version capability source', async () => {
  await probeKodaxSdk();

  const status = await sandboxController.refresh();
  assert.equal(sandboxStatusSchema.safeParse(status).success, true);
  assert.equal(status.asrtVersion, '0.0.65');
  assert.equal(status.platform, process.platform);
  assert.ok(['ready', 'setup-required', 'unavailable'].includes(status.readiness));

  const projected = getSandboxSdkCapability();
  assert.equal(projected.status, 'available');
  assert.equal(projected.readiness, status.readiness);

  const versionRow = sandboxCommandCapability(projected);
  assert.equal(versionRow.id, 'sandbox.command');
  assert.match(versionRow.detail, /sandbox|containment/i);
  if (status.readiness === 'ready') {
    assert.match(versionRow.detail, /ASRT 0\.0\.65/);
  }
});
