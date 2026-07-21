import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fileTreeRefreshPaths,
  splitFileTreeLabel,
} from '../../renderer/src/features/code/fileTreeModel.js';

test('file labels keep the complete final extension visible', () => {
  assert.deepEqual(splitFileTreeLabel('AI Native 前沿应用创新中心.工作总结.md', 'file'), {
    leading: 'AI Native 前沿应用创新中心.工作总结',
    trailing: '.md',
  });
  assert.deepEqual(splitFileTreeLabel('年度汇报.final.pptx', 'file'), {
    leading: '年度汇报.final',
    trailing: '.pptx',
  });
});

test('extensionless files and directories keep one conventional leading label', () => {
  assert.deepEqual(splitFileTreeLabel('.gitignore', 'file'), {
    leading: '.gitignore',
    trailing: '',
  });
  assert.deepEqual(splitFileTreeLabel('README', 'file'), {
    leading: 'README',
    trailing: '',
  });
  assert.deepEqual(splitFileTreeLabel('很长的项目资料文件夹', 'dir'), {
    leading: '很长的项目资料文件夹',
    trailing: '',
  });
});

test('refresh plans include the root and every expanded directory once', () => {
  assert.deepEqual(fileTreeRefreshPaths(['docs', 'src', 'docs']), [null, 'docs', 'src']);
  assert.deepEqual(fileTreeRefreshPaths([]), [null]);
});
