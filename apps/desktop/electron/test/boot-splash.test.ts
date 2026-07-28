import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BOOT_SPLASH_URL_PREFIX,
  BOOT_SPLASH_VARIANTS,
  bootStatusScript,
  createBootSplashUrl,
  selectBootSplashVariant,
} from '../window/boot-splash.js';

function decodeBootSplash(url: string): string {
  assert.ok(url.startsWith(BOOT_SPLASH_URL_PREFIX));
  return decodeURIComponent(url.slice(BOOT_SPLASH_URL_PREFIX.length));
}

test('boot splash selection maps the random range across all three designs', () => {
  assert.equal(selectBootSplashVariant(0), 'orbit-trace');
  assert.equal(selectBootSplashVariant(0.333_333_2), 'orbit-trace');
  assert.equal(selectBootSplashVariant(0.333_333_4), 'signal-weave');
  assert.equal(selectBootSplashVariant(0.666_666_8), 'aurora-gate');
  assert.equal(selectBootSplashVariant(1), 'aurora-gate');
  assert.deepEqual(BOOT_SPLASH_VARIANTS, ['orbit-trace', 'signal-weave', 'aurora-gate']);
});

test('each boot splash design keeps the trusted status and reduced-motion contract', () => {
  for (const variant of BOOT_SPLASH_VARIANTS) {
    const html = decodeBootSplash(
      createBootSplashUrl({
        variant,
        brandImageDataUrl: 'data:image/png;base64,aGVsbG8=',
      }),
    );
    assert.match(html, new RegExp(`data-variant="${variant}"`));
    assert.match(html, /data-boot-status/);
    assert.match(html, /prefers-reduced-motion:reduce/);
    assert.match(html, /data:image\/png;base64,aGVsbG8=/);
    assert.doesNotMatch(html, /<canvas|<svg|https?:\/\//);
  }
});

test('boot status updates serialize text without producing executable markup', () => {
  const script = bootStatusScript('</span><script>bad()</script>');
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /target\.innerHTML/);
});
