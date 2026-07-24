import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import { FileNameText } from '../../renderer/src/components/FileNameText.js';
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

test('split file labels keep one contiguous accessible name', () => {
  const name = 'quarterly-review.pptx';
  const markup = renderToStaticMarkup(FileNameText({ name }));

  assert.match(markup, /class="sr-only">quarterly-review\.pptx<\/span>/);
  assert.equal((markup.match(/aria-hidden="true"/g) ?? []).length, 2);
});
