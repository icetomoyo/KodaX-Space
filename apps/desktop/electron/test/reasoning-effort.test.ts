import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWireEffort, type ReasoningProfileLike } from '../kodax/reasoning-effort.js';

// Profiles mirror the real SDK getReasoningProfile() output (verified against 0.7.71).
const KIMI_CODE: ReasoningProfileLike = {
  supportedEfforts: [
    { value: 'low' },
    { value: 'medium' },
    { value: 'high' },
    { value: 'xhigh' },
    { value: 'max' },
  ],
  localRejectEfforts: ['none', 'minimal'],
  defaultEffort: 'high',
};
const GLM_CODING: ReasoningProfileLike = {
  supportedEfforts: [
    { value: 'none' },
    { value: 'minimal' },
    { value: 'low' },
    { value: 'medium' },
    { value: 'high' },
    { value: 'xhigh' },
    { value: 'max' },
  ],
  // none/minimal are disabledEfforts (fold to off) but NOT localReject — safe to send.
  defaultEffort: 'max',
};
const ANTHROPIC: ReasoningProfileLike = {
  supportedEfforts: [
    { value: 'low' },
    { value: 'medium' },
    { value: 'high' },
    { value: 'xhigh' },
    { value: 'max' },
  ],
  defaultEffort: 'high',
};
const KIMI_K3: ReasoningProfileLike = {
  supportedEfforts: [{ value: 'none' }, { value: 'low' }, { value: 'high' }, { value: 'max' }],
  defaultEffort: 'max',
};

test('C4: "Off" never emits a locally-rejected effort (kimi-code/minimax clamp up, no crash)', () => {
  // kimi-code hard-rejects none/minimal → "Off" clamps to the weakest usable rung, not a throw.
  assert.equal(resolveWireEffort('off', KIMI_CODE), 'low');
});

test('C5: "Deep" reaches the provider ceiling (GLM-5.2 -> max, not a static high)', () => {
  assert.equal(resolveWireEffort('deep', GLM_CODING), 'max');
  assert.equal(resolveWireEffort('deep', KIMI_CODE), 'max');
  assert.equal(resolveWireEffort('deep', ANTHROPIC), 'max');
  assert.equal(resolveWireEffort('deep', KIMI_K3), 'max');
});

test('Kimi K3 keeps explicit thinking-off while its deep tier reaches max', () => {
  assert.equal(resolveWireEffort('off', KIMI_K3), 'none');
  assert.equal(resolveWireEffort('deep', KIMI_K3), 'max');
});

test('no regression: providers that accept "none" for Off still get none', () => {
  // Anthropic doesn't list 'none' in supportedEfforts, but accepts it for Off (thinking flag is
  // separate) — must NOT be clamped to 'low'.
  assert.equal(resolveWireEffort('off', ANTHROPIC), 'none');
  // GLM lists none (disabled, folds to off) and doesn't localReject it → send none.
  assert.equal(resolveWireEffort('off', GLM_CODING), 'none');
});

test('quick/balanced pass through the mapped rung when not rejected', () => {
  assert.equal(resolveWireEffort('quick', GLM_CODING), 'low'); // SDK aliases low->high at the wire
  assert.equal(resolveWireEffort('balanced', KIMI_CODE), 'medium');
});

test('auto and unset pass through untouched', () => {
  assert.equal(resolveWireEffort('auto', KIMI_CODE), 'auto');
  assert.equal(resolveWireEffort(undefined, KIMI_CODE), undefined);
});

test('C1: observed wire-rejected efforts are excluded on subsequent turns', () => {
  // After the API 400s on 'max', it's recorded; "Deep" then falls to the next ceiling (xhigh).
  assert.equal(resolveWireEffort('deep', GLM_CODING, ['max']), 'xhigh');
  assert.equal(resolveWireEffort('deep', GLM_CODING, ['max', 'xhigh']), 'high');
});

test('no profile (custom_* / resolve failure) falls back to the static legacy mapping', () => {
  assert.equal(resolveWireEffort('off', undefined), 'none');
  assert.equal(resolveWireEffort('deep', undefined), 'high');
  assert.equal(resolveWireEffort('quick', undefined), 'low');
  assert.equal(resolveWireEffort('balanced', null), 'medium');
});
