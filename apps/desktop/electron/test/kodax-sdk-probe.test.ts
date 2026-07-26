// KodaX SDK shape probe tests — reviewer F034-F037 batch HIGH-2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getExperimentalMemorySdkCapability,
  inspectExperimentalMemoryModule,
  probeKodaxSdk,
} from '../kodax/kodax-sdk-probe.js';

test('probeKodaxSdk: real SDK passes (all expected functions / classes exist)', async () => {
  // 不该 throw —— SDK 真的少了任何一个，需要立即更新
  // apps/desktop/electron/kodax/kodax-sdk-types.d.ts 同步对齐
  await assert.doesNotReject(probeKodaxSdk());
});

test('probeKodaxSdk: experimental memory surface is negotiated from exports, not inferred', async () => {
  await probeKodaxSdk();
  const capability = getExperimentalMemorySdkCapability();
  assert.equal(capability.status, 'available');
  assert.match(
    capability.policyVersion,
    /^f[1-9]\d*-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/,
  );
});

test('inspectExperimentalMemoryModule rejects a present but incomplete contract', () => {
  assert.throws(
    () =>
      inspectExperimentalMemoryModule({
        createMemoryAgent() {},
        MEMORY_POLICY_VERSION: 'f275-v0.7.77.1',
      }),
    /createMemoryControlPlane expected function/,
  );
});

test('inspectExperimentalMemoryModule accepts a newer feature policy identifier', () => {
  assert.deepEqual(
    inspectExperimentalMemoryModule({
      createMemoryAgent() {},
      createMemoryControlPlane() {},
      MEMORY_POLICY_VERSION: 'f275-v0.7.77.1',
    }),
    { policyVersion: 'f275-v0.7.77.1' },
  );
});

test('inspectExperimentalMemoryModule rejects malformed policy versions', () => {
  assert.throws(
    () =>
      inspectExperimentalMemoryModule({
        createMemoryAgent() {},
        createMemoryControlPlane() {},
        MEMORY_POLICY_VERSION: 'f275-v0.7.77',
      }),
    /f<feature>-v<semver>\.<revision>/,
  );
});
