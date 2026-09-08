// /compact composer regression — Issue: 输入框残留 + spinner 不居中
//
// 背景（v0.1.45 回归，a583d082）：
//   1. handleSend 的 slash 分支改为 await execSlashOrSkill 之后才 setPrompt('')，
//      而 /compact 的 slash.exec 要等整段压缩完成才返回 → 压缩期间输入框一直残留
//      "/compact" 文本（真机实测近 4 分钟）。
//   2. ContextWindowIndicator 的压缩 spinner 依赖 Tailwind flex 居中，但
//      .context-liquid-gauge { display: block } 按源序覆盖了它 → 图标缩在左上角。
//
// 测试机制：SPACE_TEST_COMPACT_DELAY_MS 让 main 的 requestCompact 挂起指定毫秒，
// 提供确定性的"压缩进行中"窗口。spinner 用例额外用 KODAX_SPACE_RUNTIME_HOST=legacy
// 走 embedded 压缩路径（会 push compact_start/compact_end 事件对）。

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { launchSpace } from './fixtures.js';

const COMPACT_HOLD_MS = '6000';

test('S-compact-residue: /compact clears the composer immediately, not after compaction', async () => {
  test.skip(
    !!process.env.CI && process.platform === 'win32',
    'mock slash dispatch can stall on Windows CI; keep local and Linux coverage',
  );
  test.setTimeout(90_000);
  const testId = `compact-residue-${Date.now()}`;
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });

  const space = await launchSpace(testId, {
    env: { SPACE_TEST_COMPACT_DELAY_MS: COMPACT_HOLD_MS },
  });
  try {
    await space.seedProject(projectDir);

    const textarea = space.page.locator('textarea').first();
    await expect(textarea).toBeEnabled({ timeout: 10_000 });

    // 点 Send 按钮走 handleSend，绕开 SlashCommandPopover 的异步加载窗口（同 S5）。
    await textarea.fill('/compact');
    await space.page.getByLabel('Send message').click();

    // 回归断言：提交即清空。修复前 slash.exec 挂起期间 textarea 一直保持 "/compact"。
    await expect(textarea).toHaveValue('', { timeout: 2_000 });

    // 挂起的 slash.exec 最终仍要完成并把结果回显进消息流（防止"根本没发出去"的假绿）。
    const stream = space.page.getByTestId('conversation-stream');
    await expect(stream.getByText(/Compaction skipped|Compacted context/).first()).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('S-compact-spinner: compacting spinner stays centered in the context gauge', async () => {
  test.skip(
    !!process.env.CI && process.platform === 'win32',
    'embedded compact path can stall on Windows CI; keep local and Linux coverage',
  );
  test.setTimeout(90_000);
  const testId = `compact-spinner-${Date.now()}`;
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });

  // legacy → embedded 压缩路径 push compact_start/compact_end；hold 让 spinner 稳定可见。
  const space = await launchSpace(testId, {
    env: {
      KODAX_SPACE_RUNTIME_HOST: 'legacy',
      SPACE_TEST_COMPACT_DELAY_MS: COMPACT_HOLD_MS,
    },
  });
  try {
    await space.seedProject(projectDir);

    const textarea = space.page.locator('textarea').first();
    await expect(textarea).toBeEnabled({ timeout: 10_000 });

    await textarea.fill('/compact');
    await space.page.getByLabel('Send message').click();

    const gauge = space.page.getByTestId('context-window-indicator');
    const spinner = gauge.locator('svg');
    await expect(spinner).toBeVisible({ timeout: 10_000 });

    // 回归断言：spinner 必须与量规按钮同心。修复前 display:block 覆盖 flex 居中，
    // 图标缩在左上角，中心偏差约 6px。
    const centers = await space.page.evaluate(() => {
      const button = document.querySelector('[data-testid="context-window-indicator"]');
      const icon = button?.querySelector('svg');
      if (!button || !icon) return null;
      const b = button.getBoundingClientRect();
      const s = icon.getBoundingClientRect();
      return {
        dx: Math.abs(b.x + b.width / 2 - (s.x + s.width / 2)),
        dy: Math.abs(b.y + b.height / 2 - (s.y + s.height / 2)),
      };
    });
    expect(centers).not.toBeNull();
    expect(centers!.dx).toBeLessThan(2);
    expect(centers!.dy).toBeLessThan(2);

    // 等 hold 释放、compact_end 落地，spinner 收起，不留悬挂状态再关进程。
    await expect(spinner).toHaveCount(0, { timeout: 20_000 });
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
