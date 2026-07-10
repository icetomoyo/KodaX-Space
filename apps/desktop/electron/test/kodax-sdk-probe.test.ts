// KodaX SDK shape probe tests — reviewer F034-F037 batch HIGH-2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeKodaxSdk } from '../kodax/kodax-sdk-probe.js';

test('probeKodaxSdk: real SDK passes (all expected functions / classes exist)', async () => {
  // 不该 throw —— SDK 真的少了任何一个，需要立即更新
  // apps/desktop/electron/kodax/kodax-sdk-types.d.ts 同步对齐
  await assert.doesNotReject(probeKodaxSdk());
});
