import { test } from 'node:test';
import assert from 'node:assert/strict';

import { activatePartnerProjectFile } from '../../renderer/src/features/partner/partnerProjectFileActivation.js';

test('Partner project file activation keeps source selection and opens the preview', () => {
  const actions: string[] = [];

  activatePartnerProjectFile('docs/report.md', {
    selectFile: (path) => actions.push(`select:${path}`),
    openFile: (path) => actions.push(`open:${path}`),
  });

  assert.deepEqual(actions, ['select:docs/report.md', 'open:docs/report.md']);
});
