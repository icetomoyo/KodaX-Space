import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitFileName } from '../../renderer/src/lib/fileName.js';

test('file-name labels keep the complete final extension as a fixed suffix', () => {
  assert.deepEqual(splitFileName('docs/AI Native 前沿应用创新中心.工作总结.md'), {
    leading: 'docs/AI Native 前沿应用创新中心.工作总结',
    trailing: '.md',
  });
  assert.deepEqual(splitFileName('reports/年度汇报.final.pptx'), {
    leading: 'reports/年度汇报.final',
    trailing: '.pptx',
  });
});

test('dotfiles, extensionless files, and trailing dots remain one truncatable label', () => {
  assert.deepEqual(splitFileName('.gitignore'), { leading: '.gitignore', trailing: '' });
  assert.deepEqual(splitFileName('README'), { leading: 'README', trailing: '' });
  assert.deepEqual(splitFileName('legacy.'), { leading: 'legacy.', trailing: '' });
});
