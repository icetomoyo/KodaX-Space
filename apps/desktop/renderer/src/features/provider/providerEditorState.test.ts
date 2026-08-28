import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADD_PROVIDER_FORM_KEY,
  beginProviderEdit,
  retargetProviderEdit,
} from './providerEditorState.js';

test('retargetProviderEdit preserves the mounted form when a provider rename partially succeeds', () => {
  const initial = beginProviderEdit('custom-old-name');

  assert.deepEqual(retargetProviderEdit(initial, 'custom-new-name'), {
    providerId: 'custom-new-name',
    formKey: 'edit-provider:custom-old-name',
  });
});

test('a provider literally named new cannot reuse the add-provider form', () => {
  assert.equal(ADD_PROVIDER_FORM_KEY, 'add-provider');
  assert.equal(beginProviderEdit('new').formKey, 'edit-provider:new');
  assert.notEqual(beginProviderEdit('new').formKey, ADD_PROVIDER_FORM_KEY);
});

test('retargetProviderEdit does not reopen a closed editor', () => {
  assert.equal(retargetProviderEdit(null, 'custom-new-name'), null);
});
