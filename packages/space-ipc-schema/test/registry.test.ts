// Schema package unit tests — run with `node --test --import tsx`.
//
// 覆盖：
// - 有效入参通过 zod.parse
// - 无效入参被 zod 拒绝（schema invalid case）
// - 未注册 channel 在 getInvokeChannel 时返回 undefined
// - envelope ok/fail 工厂行为
// - INVOKE_CHANNEL_NAMES 与 invokeChannels 同源

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  invokeChannels,
  pushChannels,
  INVOKE_CHANNEL_NAMES,
  PUSH_CHANNEL_NAMES,
  getInvokeChannel,
  getPushChannel,
  versionChannel,
  repointelStatusChannel,
  handoffListChannel,
  handoffAcceptChannel,
  handoffDismissChannel,
  handoffChangedChannel,
  MAX_NORMALIZED_IMAGE_BASE64_LENGTH,
  MAX_NORMALIZED_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_BASE64_LENGTH,
  MAX_SOURCE_IMAGE_BYTES,
  clipboardSaveImageChannel,
  clipboardReadImageChannel,
  shellRevealPathChannel,
  shellOpenDirectoryChannel,
  ok,
  fail,
  isLicenseActive,
  type IpcResult,
  type LicenseStatusT,
} from '../src/index.js';

test('invokeChannels: space.version is registered', () => {
  assert.ok(invokeChannels['space.version'], 'space.version channel must be registered');
  assert.equal(versionChannel.name, 'space.version');
  assert.equal(versionChannel.direction, 'invoke');
});

test('invokeChannels: repointel.status is registered', () => {
  assert.ok(invokeChannels['repointel.status'], 'repointel.status channel must be registered');
  assert.equal(repointelStatusChannel.name, 'repointel.status');
  assert.equal(repointelStatusChannel.direction, 'invoke');
});

test('handoff channels are registered', () => {
  assert.ok(invokeChannels['handoff.list'], 'handoff.list channel must be registered');
  assert.ok(invokeChannels['handoff.accept'], 'handoff.accept channel must be registered');
  assert.ok(invokeChannels['handoff.dismiss'], 'handoff.dismiss channel must be registered');
  assert.ok(pushChannels['handoff.changed'], 'handoff.changed channel must be registered');
  assert.equal(handoffListChannel.direction, 'invoke');
  assert.equal(handoffAcceptChannel.direction, 'invoke');
  assert.equal(handoffDismissChannel.direction, 'invoke');
  assert.equal(handoffChangedChannel.direction, 'push');
});

test('clipboard.readImage channel is registered and accepts nullable image output', () => {
  assert.ok(
    invokeChannels['clipboard.readImage'],
    'clipboard.readImage channel must be registered',
  );
  assert.ok(INVOKE_CHANNEL_NAMES.has('clipboard.readImage'));
  assert.equal(clipboardReadImageChannel.direction, 'invoke');
  assert.equal(
    clipboardReadImageChannel.output.safeParse({
      image: {
        path: '/tmp/kodax-space/clipboard/s_1/clipboard.png',
        mediaType: 'image/png',
        base64: 'abc',
        bytes: 2,
        width: 1,
        height: 1,
      },
    }).success,
    true,
  );
  assert.equal(clipboardReadImageChannel.output.safeParse({ image: null }).success, true);
});

test('clipboard.saveImage output requires the normalized media type', () => {
  const normalized = {
    path: '/tmp/kodax-space/clipboard/s_1/normalized.jpg',
    mediaType: 'image/jpeg',
    bytes: 4,
  };

  assert.equal(clipboardSaveImageChannel.output.safeParse(normalized).success, true);
  assert.equal(
    clipboardSaveImageChannel.output.safeParse({ path: normalized.path, bytes: normalized.bytes })
      .success,
    false,
  );
});

test('clipboard.saveImage separates bounded source and normalized image limits', () => {
  assert.equal(MAX_SOURCE_IMAGE_BYTES, 12 * 1024 * 1024);
  assert.equal(MAX_NORMALIZED_IMAGE_BYTES, 6 * 1024 * 1024);
  assert.equal(
    clipboardSaveImageChannel.input.safeParse({
      sessionId: 's_source_limit',
      base64: 'A'.repeat(MAX_SOURCE_IMAGE_BASE64_LENGTH),
      mediaType: 'image/png',
    }).success,
    true,
  );
  assert.equal(
    clipboardSaveImageChannel.input.safeParse({
      sessionId: 's_source_limit',
      base64: 'A'.repeat(MAX_SOURCE_IMAGE_BASE64_LENGTH + 1),
      mediaType: 'image/png',
    }).success,
    false,
  );
  assert.equal(
    clipboardReadImageChannel.output.safeParse({
      image: {
        path: '/tmp/kodax-space/clipboard/s_1/normalized.png',
        mediaType: 'image/png',
        base64: 'A'.repeat(MAX_NORMALIZED_IMAGE_BASE64_LENGTH),
        bytes: MAX_NORMALIZED_IMAGE_BYTES,
        width: 2000,
        height: 2000,
      },
    }).success,
    true,
  );
});

test('clipboard channels reject unsafe Session IDs at the schema boundary', () => {
  const unsafeIds = ['../session', 'session/child', 'session\\child', 'session\u0000suffix'];
  for (const sessionId of unsafeIds) {
    assert.equal(
      clipboardSaveImageChannel.input.safeParse({
        sessionId,
        base64: 'AQ==',
        mediaType: 'image/png',
      }).success,
      false,
      sessionId,
    );
  }
});

test('shell.openDirectory is present in the typed invoke registry', () => {
  assert.equal(shellOpenDirectoryChannel.name, 'shell.openDirectory');
  assert.equal(invokeChannels['shell.openDirectory'], shellOpenDirectoryChannel);
  assert.ok(INVOKE_CHANNEL_NAMES.has('shell.openDirectory'));
  assert.equal(
    shellOpenDirectoryChannel.input.safeParse({
      path: 'C:/workspace',
      projectRoot: 'C:/workspace',
    }).success,
    true,
  );
});

test('shell.revealPath accepts bounded failure reasons and legacy responses', () => {
  assert.equal(invokeChannels['shell.revealPath'], shellRevealPathChannel);
  for (const output of [
    { revealed: true },
    { revealed: false },
    { revealed: false, reason: 'not-found' },
    { revealed: false, reason: 'not-allowed' },
    { revealed: false, reason: 'failed' },
  ]) {
    assert.equal(shellRevealPathChannel.output.safeParse(output).success, true);
  }
  assert.equal(
    shellRevealPathChannel.output.safeParse({ revealed: false, reason: 'outside-project' }).success,
    false,
  );
});

test('INVOKE_CHANNEL_NAMES is derived from invokeChannels keys', () => {
  assert.equal(INVOKE_CHANNEL_NAMES.size, Object.keys(invokeChannels).length);
  for (const name of Object.keys(invokeChannels)) {
    assert.ok(INVOKE_CHANNEL_NAMES.has(name), `${name} should be in allowlist`);
  }
});

test('PUSH_CHANNEL_NAMES is derived from pushChannels keys', () => {
  assert.equal(PUSH_CHANNEL_NAMES.size, Object.keys(pushChannels).length);
  for (const name of Object.keys(pushChannels)) {
    assert.ok(PUSH_CHANNEL_NAMES.has(name), name + ' should be in allowlist');
  }
});

test('space.version input schema: undefined parses', () => {
  const result = versionChannel.input.safeParse(undefined);
  assert.equal(result.success, true);
});

test('space.version input schema: non-undefined fails (catches caller bugs)', () => {
  const result = versionChannel.input.safeParse({ accidentalPayload: true });
  assert.equal(result.success, false);
});

test('space.version output schema: valid object parses', () => {
  const valid = {
    spaceVersion: '0.1.0-alpha.0',
    nodeVersion: '20.18.3',
    electronVersion: '33.2.0',
    chromeVersion: '130.0.0.0',
    platform: 'win32' as const,
    kodaxSdkVersion: '0.7.52',
    kodaxDependencySpec: '^0.7.52',
    capabilityContract: 'space-v0.1.30',
    capabilities: [
      {
        id: 'repointel.trace',
        label: 'Repointel trace',
        status: 'supported' as const,
        detail: 'Session trace events are consumed by Space.',
        since: '0.1.19',
      },
    ],
  };
  const result = versionChannel.output.safeParse(valid);
  assert.equal(result.success, true);
});

test('space.version output schema: rejects empty string fields', () => {
  const invalid = {
    spaceVersion: '',
    nodeVersion: '20',
    electronVersion: '33',
    chromeVersion: '130',
    platform: 'win32' as const,
    kodaxSdkVersion: '0.7.52',
    kodaxDependencySpec: '^0.7.52',
    capabilityContract: 'space-v0.1.30',
    capabilities: [
      {
        id: 'repointel.trace',
        label: 'Repointel trace',
        status: 'supported' as const,
        detail: 'Session trace events are consumed by Space.',
      },
    ],
  };
  const result = versionChannel.output.safeParse(invalid);
  assert.equal(result.success, false);
});

test('space.version output schema: rejects unknown platform', () => {
  const invalid = {
    spaceVersion: '0.1.0',
    nodeVersion: '20',
    electronVersion: '33',
    chromeVersion: '130',
    platform: 'plan9',
    kodaxSdkVersion: '0.7.52',
    kodaxDependencySpec: '^0.7.52',
    capabilityContract: 'space-v0.1.30',
    capabilities: [
      {
        id: 'repointel.trace',
        label: 'Repointel trace',
        status: 'supported' as const,
        detail: 'Session trace events are consumed by Space.',
      },
    ],
  };
  const result = versionChannel.output.safeParse(invalid);
  assert.equal(result.success, false);
});

test('space.version output schema: rejects unknown capability status', () => {
  const invalid = {
    spaceVersion: '0.1.0',
    nodeVersion: '20',
    electronVersion: '33',
    chromeVersion: '130',
    platform: 'win32' as const,
    kodaxSdkVersion: '0.7.52',
    kodaxDependencySpec: '^0.7.52',
    capabilityContract: 'space-v0.1.30',
    capabilities: [
      {
        id: 'quickAsk.sideQuery',
        label: 'Quick Ask side query',
        status: 'maybe',
        detail: 'SDK contract is not exposed.',
      },
    ],
  };
  const result = versionChannel.output.safeParse(invalid);
  assert.equal(result.success, false);
});

test('repointel.status input and output schema', () => {
  assert.equal(repointelStatusChannel.input.safeParse({ projectRoot: 'C:/repo' }).success, true);
  assert.equal(repointelStatusChannel.input.safeParse({ projectRoot: '' }).success, false);
  // probe is an optional input — the chip passes probe:false for a cheap readiness fetch.
  assert.equal(repointelStatusChannel.input.safeParse({ probe: false }).success, true);

  const output = repointelStatusChannel.output.safeParse({
    projectRoot: 'C:/repo',
    projectExists: true,
    gitRoot: 'C:/repo',
    traceSource: 'session-events',
    warmSupported: false,
    warmReason: 'The current KodaX SDK does not expose a standalone warm API.',
    entitled: true,
    effectiveEngine: 'full',
    engineStatus: 'ok',
    diagnostics: [
      {
        id: 'project',
        status: 'ok',
        detail: 'Project directory is readable.',
      },
    ],
  });
  assert.equal(output.success, true);

  // effectiveEngine/engineStatus are nullable (SDK inspection failed) but still required keys.
  assert.equal(
    repointelStatusChannel.output.safeParse({
      projectRoot: null,
      projectExists: false,
      gitRoot: null,
      traceSource: 'session-events',
      warmSupported: false,
      warmReason: 'x',
      entitled: false,
      effectiveEngine: null,
      engineStatus: null,
      diagnostics: [{ id: 'x', status: 'ok', detail: 'y' }],
    }).success,
    true,
  );

  // `entitled` is required — repo-intelligence is a licensed capability, so a status
  // payload that forgets to report entitlement must not validate (other fields present).
  const missingEntitled = repointelStatusChannel.output.safeParse({
    projectRoot: 'C:/repo',
    projectExists: true,
    gitRoot: 'C:/repo',
    traceSource: 'session-events',
    warmSupported: false,
    warmReason: 'x',
    effectiveEngine: 'full',
    engineStatus: 'ok',
    diagnostics: [{ id: 'project', status: 'ok', detail: 'y' }],
  });
  assert.equal(missingEntitled.success, false);
});

test('isLicenseActive: only an active licensed status unlocks gated capabilities', () => {
  const base: LicenseStatusT = {
    status: 'community',
    edition: 'community',
    licenseKind: null,
    managedRequired: false,
    enforcementSource: 'none',
    licenseId: null,
    customer: null,
    expiresAt: null,
    features: [],
    reason: null,
    lastCheckedAt: '2026-07-03T00:00:00.000Z',
    degraded: false,
  };
  assert.equal(isLicenseActive({ ...base, status: 'licensed' }), true);
  // Any-active-license policy: everything that is not 'licensed' stays locked —
  // including 'degraded' (valid payload, but clock-rollback suspicious).
  for (const status of ['community', 'expired', 'invalid', 'required', 'degraded'] as const) {
    assert.equal(isLicenseActive({ ...base, status }), false, `${status} must not unlock`);
  }
});

test('handoff list output accepts valid, stale, and invalid entries', () => {
  const result = handoffListChannel.output.safeParse({
    handoffs: [
      {
        id: 'abc',
        filePath: 'C:/Users/me/.kodax/handoffs/abc.json',
        status: 'valid',
        sessionId: 'sess_1',
        projectRoot: 'C:/repo',
        source: 'cli',
        createdAt: Date.now(),
      },
      {
        id: 'bad',
        filePath: 'C:/Users/me/.kodax/handoffs/bad.json',
        status: 'invalid',
        sessionId: null,
        projectRoot: null,
        source: null,
        createdAt: null,
        error: 'invalid JSON',
      },
    ],
  });
  assert.equal(result.success, true);
});

test('handoff accept input accepts optional expected session guard', () => {
  assert.equal(handoffAcceptChannel.input.safeParse({ handoffId: 'abc' }).success, true);
  assert.equal(
    handoffAcceptChannel.input.safeParse({ handoffId: 'abc', expectedSessionId: 'sess_1' }).success,
    true,
  );
  assert.equal(
    handoffAcceptChannel.input.safeParse({ handoffId: 'abc', expectedSessionId: '' }).success,
    false,
  );
});

test('getInvokeChannel: known channel returns definition', () => {
  const def = getInvokeChannel('space.version');
  assert.ok(def);
  assert.equal(def?.name, 'space.version');
});

test('getInvokeChannel: unknown channel returns undefined', () => {
  const def = getInvokeChannel('totally.bogus.channel');
  assert.equal(def, undefined);
});

test('getPushChannel: known and unknown channels resolve predictably', () => {
  const def = getPushChannel('window.activity');
  assert.ok(def);
  assert.equal(def?.name, 'window.activity');
  assert.equal(getPushChannel('totally.bogus.push'), undefined);
});

test('envelope ok() produces { ok: true, data }', () => {
  const result: IpcResult<number> = ok(42);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data, 42);
  }
});

test('envelope fail() produces { ok: false, error: {code, message, details?} }', () => {
  const result = fail('SCHEMA_INVALID', 'bad input', { fieldErrors: { foo: ['required'] } });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'SCHEMA_INVALID');
    assert.equal(result.error.message, 'bad input');
    assert.deepEqual(result.error.details, { fieldErrors: { foo: ['required'] } });
  }
});

test('envelope fail() works without details', () => {
  const result = fail('INTERNAL', 'oops');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.details, undefined);
  }
});
