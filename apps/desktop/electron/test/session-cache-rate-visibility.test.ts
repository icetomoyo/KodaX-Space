import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// 缓存命中率块是 Token 统计弹窗中的重点指标:样式上必须区别于普通 10px muted
// 注释行,且绿色点缀(圆点/边框/底色)在浅色与深色主题下都保持可感知的对比度。
const styles = readFileSync(new URL('../../renderer/src/styles.css', import.meta.url), 'utf8');
const indicator = readFileSync(
  new URL('../../renderer/src/shell/ContextWindowIndicator.tsx', import.meta.url),
  'utf8',
);

function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: readonly number[]): number {
  const [red, green, blue] = rgb.map(linearChannel);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(first: readonly number[], second: readonly number[]): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

function readOkThemeColors(): [number[], number[]] {
  const matches = [...styles.matchAll(/--ok:\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)];
  assert.equal(matches.length, 2, '--ok must define light and dark values');
  return matches.map((match) => match.slice(1).map(Number)) as [number[], number[]];
}

test('session cache hit rate block stays emphasized and theme-safe', () => {
  // 强调样式不回退:绿 tint 容器 + 大号数值字体
  assert.match(indicator, /data-testid="session-token-cache-rates"/);
  assert.match(indicator, /bg-ok\/10/);
  assert.match(indicator, /border-ok\/40/);
  assert.match(indicator, /text-\[15px\]/);

  const [light, dark] = readOkThemeColors();
  assert.ok(
    contrastRatio(light, [255, 255, 255]) >= 3,
    'light-theme ok accent must keep 3:1 on popover surface',
  );
  assert.ok(
    contrastRatio(dark, [38, 38, 43]) >= 3,
    'dark-theme ok accent must keep 3:1 on popover surface',
  );
});
