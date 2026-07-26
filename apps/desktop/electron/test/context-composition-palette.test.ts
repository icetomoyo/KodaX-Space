import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('../../renderer/src/styles.css', import.meta.url), 'utf8');
const indicator = readFileSync(
  new URL('../../renderer/src/shell/ContextWindowIndicator.tsx', import.meta.url),
  'utf8',
);

const categoryNames = ['system', 'tools', 'skills', 'transcript', 'request', 'results'] as const;

function readThemeColors(name: (typeof categoryNames)[number]): [number[], number[]] {
  const matches = [
    ...styles.matchAll(new RegExp(`--context-${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*;`, 'g')),
  ];
  assert.equal(matches.length, 2, `--context-${name} must define light and dark values`);
  return matches.map((match) => match.slice(1).map(Number)) as [number[], number[]];
}

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

function lab(rgb: readonly number[]): number[] {
  const [red, green, blue] = rgb.map(linearChannel);
  const x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047;
  const y = red * 0.2126729 + green * 0.7151522 + blue * 0.072175;
  const z = (red * 0.0193339 + green * 0.119192 + blue * 0.9503041) / 1.08883;
  const transform = (value: number) =>
    value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const transformedX = transform(x);
  const transformedY = transform(y);
  const transformedZ = transform(z);
  return [
    116 * transformedY - 16,
    500 * (transformedX - transformedY),
    200 * (transformedY - transformedZ),
  ];
}

function deltaE76(first: readonly number[], second: readonly number[]): number {
  const firstLab = lab(first);
  const secondLab = lab(second);
  return Math.hypot(
    firstLab[0] - secondLab[0],
    firstLab[1] - secondLab[1],
    firstLab[2] - secondLab[2],
  );
}

test('context composition uses a dedicated six-color palette', () => {
  for (const name of categoryNames) {
    assert.match(indicator, new RegExp(`rgb\\(var\\(--context-${name}\\)\\)`));
    readThemeColors(name);
  }
});

test('context composition colors remain visible on both popover themes', () => {
  const lightSurface = [255, 255, 255];
  const darkSurface = [38, 38, 43];

  for (const name of categoryNames) {
    const [light, dark] = readThemeColors(name);
    assert.ok(
      contrastRatio(light, lightSurface) >= 3,
      `${name} light-theme contrast must remain at least 3:1`,
    );
    assert.ok(
      contrastRatio(dark, darkSurface) >= 3,
      `${name} dark-theme contrast must remain at least 3:1`,
    );
  }
});

test('context composition categories remain perceptually separated in both themes', () => {
  const colors = categoryNames.map(readThemeColors);

  for (const themeIndex of [0, 1] as const) {
    for (let first = 0; first < colors.length; first += 1) {
      for (let second = first + 1; second < colors.length; second += 1) {
        assert.ok(
          deltaE76(colors[first][themeIndex], colors[second][themeIndex]) >= 30,
          `${categoryNames[first]} and ${categoryNames[second]} are too similar in ${
            themeIndex === 0 ? 'light' : 'dark'
          } theme`,
        );
      }
    }
  }
});
