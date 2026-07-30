import test from 'node:test';
import assert from 'node:assert/strict';
import type { WindowActivityPayload } from '@kodax-space/space-ipc-schema';

import {
  isLocalDocumentActive,
  shouldPauseAurora,
} from '../../renderer/src/shell/auroraActivity.js';

const ACTIVE: WindowActivityPayload = {
  state: 'active',
  active: true,
  focused: true,
  visible: true,
  minimized: false,
};

const PASSIVE: WindowActivityPayload = {
  state: 'passive',
  active: false,
  focused: false,
  visible: true,
  minimized: false,
};

const HIDDEN: WindowActivityPayload = {
  state: 'hidden',
  active: false,
  focused: false,
  visible: false,
  minimized: true,
};

test('isLocalDocumentActive requires visible document focus', () => {
  assert.equal(
    isLocalDocumentActive({ visibilityState: 'visible', hasFocus: () => true } as Document),
    true,
  );
  assert.equal(
    isLocalDocumentActive({ visibilityState: 'visible', hasFocus: () => false } as Document),
    false,
  );
  assert.equal(
    isLocalDocumentActive({ visibilityState: 'hidden', hasFocus: () => true } as Document),
    false,
  );
});

test('shouldPauseAurora pauses only full-quality inactive or interactive states', () => {
  assert.equal(shouldPauseAurora('minimal', PASSIVE, false), false);
  assert.equal(shouldPauseAurora('balanced', PASSIVE, false), false);
  assert.equal(shouldPauseAurora('full', ACTIVE, true), false);
  assert.equal(shouldPauseAurora('full', ACTIVE, true, true), true);
  assert.equal(shouldPauseAurora('balanced', ACTIVE, true, true), false);
  assert.equal(shouldPauseAurora('full', ACTIVE, true, false, true), true);
  assert.equal(shouldPauseAurora('balanced', ACTIVE, true, false, true), false);
  assert.equal(shouldPauseAurora('full', PASSIVE, true), true);
  assert.equal(shouldPauseAurora('full', HIDDEN, true), true);
  assert.equal(shouldPauseAurora('full', null, false), true);
});
