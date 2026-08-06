import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(new URL('../ipc/session.ts', import.meta.url), 'utf8');

function registrationBody(channel: string, nextChannel?: string): string {
  const start = source.indexOf(`registerChannel('${channel}'`);
  const end =
    nextChannel === undefined
      ? source.length
      : source.indexOf(`registerChannel('${nextChannel}'`, start + 1);
  assert.notEqual(start, -1, `${channel} registration must exist`);
  if (nextChannel !== undefined) {
    assert.notEqual(end, -1, `${nextChannel} registration must bound ${channel}`);
  }
  return source.slice(start, end);
}

test('read-only Session list does not participate in executable Coder admission', () => {
  assert.doesNotMatch(
    registrationBody('session.list', 'session.delete'),
    /runWithCoderAdmission|beginCoderAdmission/,
  );
});

test('read-only Session history does not participate in executable Coder admission', () => {
  assert.doesNotMatch(
    registrationBody('session.history'),
    /runWithCoderAdmission|beginCoderAdmission/,
  );
});
