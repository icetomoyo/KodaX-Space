import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInteractiveHtmlCsp,
  buildInteractiveHtmlSrcDoc,
  INTERACTIVE_HTML_CSP,
  inferPassiveHtmlPermissions,
  looksLikeInteractiveHtml,
  sandboxForInteractiveHtml,
} from '../../renderer/src/features/artifact/htmlSandbox.js';
import { WEB_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE } from '@kodax-space/space-ipc-schema';
import { ARTIFACT_HTML_FRAME_BOOTSTRAP_CSP } from '../window/app-protocol-policy.js';

test('looksLikeInteractiveHtml detects script-driven HTML', () => {
  assert.equal(looksLikeInteractiveHtml('<h1>static</h1>'), false);
  assert.equal(looksLikeInteractiveHtml('<canvas id="c"></canvas>'), true);
  assert.equal(looksLikeInteractiveHtml('<script>requestAnimationFrame(() => {})</script>'), true);
  assert.equal(looksLikeInteractiveHtml('<button onclick="go()">Go</button>'), true);
  assert.equal(
    looksLikeInteractiveHtml(
      `<style>.reveal{opacity:0}</style>${'x'.repeat(70_000)}<script>reveal()</script>`,
    ),
    true,
  );
  assert.equal(
    looksLikeInteractiveHtml(
      '<link rel="stylesheet" href="https://styles.example.com/presentation.css">',
    ),
    true,
  );
});

test('buildInteractiveHtmlSrcDoc injects a restrictive in-frame CSP', () => {
  const out = buildInteractiveHtmlSrcDoc(
    '<!doctype html><html><head><title>x</title></head><body></body></html>',
  );
  assert.match(out, /Content-Security-Policy/);
  assert.match(out, /connect-src 'none'/);
  assert.match(out, /script-src 'unsafe-inline'/);
  assert.match(out, /worker-src blob:/);
  assert.match(out, /object-src 'none'/);
  assert.match(out, /Object\.defineProperty\(window,name/);
  assert.match(out, new RegExp(WEB_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE));
  assert.match(out, /securitypolicyviolation/);
  assert.match(out, /DOMContentLoaded/);
  assert.match(out, /document\.readyState==='loading'/);
  assert.match(out, /stopImmediatePropagation/);
  assert.match(out, /setTimeout\(ready,0\)/);
  assert.match(out, /removeEventListener/);
  assert.ok(out.indexOf('Content-Security-Policy') < out.indexOf('<title>x</title>'));
  assert.equal(INTERACTIVE_HTML_CSP.includes('allow-same-origin'), false);
});

test('Artifact bootstrap policy preserves the inner document Blob worker capability', () => {
  assert.match(ARTIFACT_HTML_FRAME_BOOTSTRAP_CSP, /worker-src blob:/);
});

test('buildInteractiveHtmlCsp opens only declared permission sources', () => {
  const csp = buildInteractiveHtmlCsp({
    connect: ['https://api.example.com'],
    style: ['https://styles.example.com'],
    img: ['https://images.example.com'],
    media: ['https://media.example.com'],
    font: ['https://fonts.example.com'],
    forms: ['https://forms.example.com'],
    scripts: [
      {
        url: 'https://cdn.example.com/lib/v1.js',
        integrity: 'sha384-AbCdEf0123456789+/=',
      },
    ],
  });

  assert.match(csp, /connect-src https:\/\/api\.example\.com wss:\/\/api\.example\.com/);
  // script-src = 'unsafe-inline' + default CDN allowlist + the declared SRI script.
  assert.match(csp, /script-src 'unsafe-inline'/);
  assert.ok(
    csp.includes('https://cdn.example.com/lib/v1.js'),
    'declared script present in script-src',
  );
  assert.match(csp, /style-src 'unsafe-inline' https:\/\/styles\.example\.com/);
  assert.match(csp, /img-src data: blob: https:\/\/images\.example\.com/);
  assert.match(csp, /media-src data: blob: https:\/\/media\.example\.com/);
  assert.match(csp, /font-src data: https:\/\/fonts\.example\.com/);
  assert.match(csp, /form-action https:\/\/forms\.example\.com/);
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /object-src 'none'/);
});

test('inferPassiveHtmlPermissions allows declared passive resources but not connect', () => {
  const html = `
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
    <link rel="stylesheet" href="https://cdn.example.com/app.css">
    <img src="https://images.example.com/hero.png">
    <video poster="https://images.example.com/poster.jpg" src="https://media.example.com/demo.mp4"></video>
    <style>@import url("https://theme.example.com/base.css"); @font-face{src:url("https://static.example.com/app.woff2")} body{background:url(https://static.example.com/bg.png)}</style>
    <script src="https://scripts.example.com/app.js"></script>
  `;

  assert.deepEqual(inferPassiveHtmlPermissions(html), {
    style: ['https://fonts.googleapis.com', 'https://cdn.example.com', 'https://theme.example.com'],
    img: ['https://images.example.com', 'https://static.example.com'],
    media: ['https://media.example.com'],
    font: ['https://fonts.gstatic.com', 'https://static.example.com'],
  });
});

test('buildInteractiveHtmlSrcDoc infers passive resources when no explicit permissions are present', () => {
  const out = buildInteractiveHtmlSrcDoc(
    '<html><head><link rel="stylesheet" href="https://cdn.example.com/app.css"></head><body><img src="https://images.example.com/a.png"><script src="https://scripts.example.com/app.js"></script></body></html>',
  );

  assert.match(out, /style-src[^"]*https:\/\/cdn\.example\.com/);
  assert.match(out, /img-src[^"]*https:\/\/images\.example\.com/);
  assert.match(out, /script-src[^"]*https:\/\/scripts\.example\.com/);
  assert.match(out, /connect-src 'none'/);
});

test('buildInteractiveHtmlSrcDoc injects SRI and crossorigin for declared scripts', () => {
  const out = buildInteractiveHtmlSrcDoc(
    '<html><head></head><body><script src="https://cdn.example.com/lib/v1.js"></script></body></html>',
    {
      scripts: [
        {
          url: 'https://cdn.example.com/lib/v1.js',
          integrity: 'sha256-AbCdEf0123456789+/=',
        },
      ],
    },
  );

  assert.match(out, /integrity="sha256-AbCdEf0123456789\+\/="/);
  assert.match(out, /crossorigin="anonymous"/);
});

test('C12: default script-src allows a curated CDN set so CDN-script artifacts are not blank', () => {
  const csp = buildInteractiveHtmlCsp();
  assert.match(csp, /script-src[^;]*https:\/\/cdn\.tailwindcss\.com/);
  assert.match(csp, /script-src[^;]*https:\/\/cdn\.jsdelivr\.net/);
  assert.match(csp, /script-src[^;]*https:\/\/unpkg\.com/);
  // but network egress stays locked by default — the CDN allowance can't be used to exfiltrate.
  assert.match(csp, /connect-src 'none'/);
});

test('C11: explicit permissions still keep passive resources present in the markup', () => {
  // Supplying only `connect` must NOT revoke the font/img that inference would otherwise allow.
  const out = buildInteractiveHtmlSrcDoc(
    '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></head>' +
      '<body><img src="https://images.example.com/a.png"></body></html>',
    { connect: ['https://api.example.com'] },
  );
  assert.match(out, /connect-src https:\/\/api\.example\.com/, 'explicit connect honored');
  assert.match(out, /img-src[^"]*https:\/\/images\.example\.com/, 'inferred img still allowed');
  assert.match(
    out,
    /style-src[^"]*https:\/\/fonts\.googleapis\.com/,
    'inferred style still allowed',
  );
});

test('sandboxForInteractiveHtml adds forms and popup tokens only when requested', () => {
  assert.equal(sandboxForInteractiveHtml(), 'allow-scripts');
  assert.equal(
    sandboxForInteractiveHtml({
      forms: ['https://forms.example.com'],
      popups: 'confirm-external',
    }),
    'allow-scripts allow-forms allow-popups',
  );
});
