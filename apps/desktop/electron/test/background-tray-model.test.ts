import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBackgroundTrayPresentation,
  resolveBackgroundTrayLocale,
} from '../window/background-tray-model.js';

test('background tray locale follows explicit settings before system languages', () => {
  assert.equal(resolveBackgroundTrayLocale('zh-CN', ['en-US']), 'zh-CN');
  assert.equal(resolveBackgroundTrayLocale('en-US', ['zh-CN']), 'en-US');
  assert.equal(resolveBackgroundTrayLocale('system', ['zh-Hans-CN', 'en-US']), 'zh-CN');
  assert.equal(resolveBackgroundTrayLocale('system', ['ja-JP']), 'en-US');
});

test('background tray presentation makes Runtime work and control state visible', () => {
  const chinese = buildBackgroundTrayPresentation('zh-CN', {
    state: 'ready',
    activeWork: 2,
    otherClients: 1,
    canStop: false,
    blockers: ['active_runs', 'connected_clients'],
  });
  assert.match(chinese.tooltip, /任务 2/);
  assert.match(chinese.tooltip, /其他客户端 1/);
  assert.match(chinese.status, /正在工作/);
  assert.match(chinese.quitCompletely, /彻底退出/);

  const english = buildBackgroundTrayPresentation('en-US', {
    state: 'ready',
    activeWork: 0,
    otherClients: 0,
    canStop: true,
    blockers: [],
  });
  assert.match(english.status, /idle/);
  assert.match(english.quitKeepRuntime, /keep Runtime/);
});
