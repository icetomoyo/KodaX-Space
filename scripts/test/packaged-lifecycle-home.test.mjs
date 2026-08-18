import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePackagedLifecycleHome } from '../packaged-lifecycle-home.mjs';

function createIo(calls) {
  return {
    tmpdir() {
      calls.push(['tmpdir']);
      return '/var/folders/long/T';
    },
    async mkdtemp(prefix) {
      calls.push(['mkdtemp', prefix]);
      return `${prefix}XXXX`;
    },
    async realpath(target) {
      calls.push(['realpath', target]);
      if (target === '/tmp') return '/private/tmp';
      return `/real${target}`;
    },
    join(...parts) {
      return parts.join('/').replaceAll(/\/+/g, '/');
    },
    dirname(target) {
      return target.replace(/\/[^/]+$/, '') || '/';
    },
    resolve(target) {
      return target;
    },
  };
}

test('Darwin isolated homes land on the real /tmp path, not the symlink alias', async () => {
  const calls = [];
  const home = await resolvePackagedLifecycleHome({
    platform: 'darwin',
    configuredKodaXHome: undefined,
    ...createIo(calls),
  });

  assert.deepEqual(home, {
    ownsHomeDir: true,
    homeDir: '/real/private/tmp/kodax-space-asar-probe-XXXX',
    kodaxHome: '/real/private/tmp/kodax-space-asar-probe-XXXX/.kodax',
    tmpdir: '/private/tmp',
  });
  assert.deepEqual(calls, [
    ['realpath', '/tmp'],
    ['mkdtemp', '/private/tmp/kodax-space-asar-probe-'],
    ['realpath', '/private/tmp/kodax-space-asar-probe-XXXX'],
  ]);
});

test('Linux isolated homes realpath the created temp directory', async () => {
  const calls = [];
  const home = await resolvePackagedLifecycleHome({
    platform: 'linux',
    configuredKodaXHome: undefined,
    ...createIo(calls),
  });

  assert.equal(home.ownsHomeDir, true);
  assert.equal(home.homeDir, '/real/var/folders/long/T/kodax-space-asar-probe-XXXX');
  assert.equal(home.kodaxHome, '/real/var/folders/long/T/kodax-space-asar-probe-XXXX/.kodax');
  assert.equal(home.tmpdir, undefined);
});

test('Windows configured homes keep the supplied KODAX_HOME', async () => {
  const home = await resolvePackagedLifecycleHome({
    platform: 'win32',
    configuredKodaXHome: 'C:/runner/kodax-home',
    ...createIo([]),
  });

  assert.deepEqual(home, {
    ownsHomeDir: false,
    homeDir: 'C:/runner',
    kodaxHome: 'C:/runner/kodax-home',
    tmpdir: undefined,
  });
});
