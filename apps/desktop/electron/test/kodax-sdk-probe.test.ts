// KodaX SDK shape probe tests — reviewer F034-F037 batch HIGH-2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getExperimentalMemorySdkCapability,
  getSandboxSdkCapability,
  inspectExperimentalMemoryModule,
  inspectSandboxModule,
  projectSandboxDoctorResult,
  probeKodaxSdk,
  updateSandboxSdkDoctorResult,
} from '../kodax/kodax-sdk-probe.js';

test('probeKodaxSdk: real SDK passes (all expected functions / classes exist)', async () => {
  // 不该 throw —— SDK 真的少了任何一个，需要立即更新
  // apps/desktop/electron/kodax/kodax-sdk-types.d.ts 同步对齐
  await assert.doesNotReject(probeKodaxSdk());
});

test('probeKodaxSdk: standalone sandbox surface is shape-probed without triggering setup', async () => {
  await probeKodaxSdk();
  const capability = getSandboxSdkCapability();
  assert.equal(capability.status, 'available');
  assert.equal(capability.version, 1);
  assert.equal(capability.asrtVersion, '0.0.65');
  assert.equal(capability.unavailableBehavior, 'structured-no-execution');
  assert.ok(['checking', 'ready', 'setup-required', 'unavailable'].includes(capability.readiness));
});

test('sandbox capability distinguishes facade shape from doctor-confirmed readiness', () => {
  const shaped = inspectSandboxModule({
    KODAX_ASRT_VERSION: '0.0.65',
    getKodaXSandboxCapability: () => ({
      version: 1,
      asrtVersion: '0.0.65',
      platform: process.platform,
      backend: 'unsupported',
      genericCommandExecution: true,
      controls: ['filesystem', 'network', 'environment', 'timeout', 'output'],
      ordinaryCallsTriggerSetup: false,
      setupMayElevate: false,
      unavailableBehavior: 'structured-no-execution',
      permissionFallback: 'normal-permission-policy',
    }),
    doctorKodaXSandbox() {},
    getKodaXSandboxSetupGuidance() {},
    activateKodaXSandbox() {},
    setupKodaXSandbox() {},
    runKodaXSandboxed() {},
  });
  assert.equal(shaped.readiness, 'checking');
  assert.equal(
    projectSandboxDoctorResult(shaped, {
      ready: false,
      setupRequired: true,
      diagnostics: ['dependency missing'],
    }).readiness,
    'setup-required',
  );
  assert.equal(
    projectSandboxDoctorResult(shaped, {
      ready: true,
      setupRequired: false,
      diagnostics: [],
    }).readiness,
    'ready',
  );
});

test('sandbox doctor refresh updates the capability ledger source without changing facade facts', async () => {
  await probeKodaxSdk();
  const current = getSandboxSdkCapability();
  assert.equal(current.status, 'available');

  const setupRequired = updateSandboxSdkDoctorResult(current, {
    ready: false,
    setupRequired: true,
    diagnostics: ['bounded'],
  });
  assert.equal(setupRequired.status, 'available');
  assert.equal(setupRequired.readiness, 'setup-required');
  assert.equal(setupRequired.diagnosticCount, 1);

  const ready = updateSandboxSdkDoctorResult(current, {
    ready: true,
    setupRequired: false,
    diagnostics: [],
  });
  assert.equal(ready.status, 'available');
  assert.equal(ready.readiness, 'ready');
  assert.equal(ready.asrtVersion, current.asrtVersion);

  // Restore the real machine projection for later tests in this process.
  await probeKodaxSdk();
});

test('inspectSandboxModule rejects an executor that could hide unavailable containment', () => {
  assert.throws(
    () =>
      inspectSandboxModule({
        KODAX_ASRT_VERSION: '0.0.65',
        getKodaXSandboxCapability: () => ({
          version: 1,
          asrtVersion: '0.0.65',
          platform: process.platform,
          backend: 'unsupported',
          genericCommandExecution: true,
          controls: ['filesystem', 'network', 'environment', 'timeout', 'output'],
          ordinaryCallsTriggerSetup: false,
          setupMayElevate: false,
          unavailableBehavior: 'normal-execution',
          permissionFallback: 'normal-permission-policy',
        }),
        doctorKodaXSandbox() {},
        activateKodaXSandbox() {},
        runKodaXSandboxed() {},
      }),
    /structured-no-execution/,
  );
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
