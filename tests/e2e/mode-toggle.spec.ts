// Permission mode toggle — Path D Phase 1
//
// 验 Shift+Tab 全局快捷键能在 plan / accept-edits / auto 之间循环切换 permission mode，
// 且 ModeSelector chip 显示对应 label。
// 这条 spec 锁住 FEATURE_029 canonical 3-mode 体系不被误改。
//
// 默认 pendingPermissionMode 持久化在 localStorage（commit 971e36e），所以测试用
// 隔离 KODAX_TEST_ONBOARDING dir 启动，从干净态开始。

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { launchSpace } from './fixtures.js';

test('S4: Shift+Tab cycles permission mode through plan/accept-edits/auto', async () => {
  const testId = `s4-${Date.now()}`;
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });

  const space = await launchSpace(testId);
  try {
    // 先把 project 注入让 ModeSelector / textarea 都活 (fixture 共享 helper)
    await space.seedProject(projectDir);

    // ModeSelector 显示在 ChipBar；无 session 时也只显示模式名，
    // 不追加会让人误解生效时机的 "(next) / 下次"。
    // 三种 label 任一存在即认为 ModeSelector mount 了
    const initialLabelMatcher = /^(Plan|Accept edits|Auto)/;
    await expect(space.page.getByText(initialLabelMatcher).first()).toBeVisible({
      timeout: 10_000,
    });
    const modeButton = space.page.locator('button[title^="Mode:"]');
    const agentModeButton = space.page.locator('button[title^="Agent:"]');
    await expect(modeButton).not.toContainText(/\(next\)|（下次）/);
    await expect(agentModeButton).not.toContainText(/\(next\)|（下次）/);

    // 抓初始 label 文本
    const initialText = await space.page.getByText(initialLabelMatcher).first().textContent();
    expect(initialText).toBeTruthy();

    // 按 Shift+Tab 切到下一档
    await space.page.keyboard.press('Shift+Tab');

    // 等 label 真的变了 (用 not.toHaveText 等待 retry)
    await expect
      .poll(
        async () => (await space.page.getByText(initialLabelMatcher).first().textContent()) ?? '',
        { timeout: 5_000 },
      )
      .not.toBe(initialText);

    // 同一 renderer task 内连续切两次，验证快速操作不会被 busy gate 丢弃，
    // 且最终状态遵循最后一次用户动作。连同上面的一次正好回到原态。
    await space.page.evaluate(() => {
      for (let index = 0; index < 2; index += 1) {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    });
    await expect
      .poll(
        async () => (await space.page.getByText(initialLabelMatcher).first().textContent()) ?? '',
        { timeout: 5_000 },
      )
      .toBe(initialText);
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
