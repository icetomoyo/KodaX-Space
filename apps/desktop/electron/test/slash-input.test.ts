import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findCommandSlashIndex,
  getActiveSlashCompletion,
  replaceActiveSlashCompletion,
  shouldOpenSlashCompletion,
} from '../../renderer/src/shell/slashInput.js';

test('findCommandSlashIndex accepts slash at the start of input', () => {
  assert.equal(findCommandSlashIndex('/rep'), 0);
});

test('findCommandSlashIndex accepts slash after whitespace or newline', () => {
  assert.equal(findCommandSlashIndex('ask /rep'), 4);
  assert.equal(findCommandSlashIndex('first line\n/mode'), 11);
});

test('findCommandSlashIndex ignores slashes embedded in words or paths', () => {
  assert.equal(findCommandSlashIndex('ask/repointel'), -1);
  assert.equal(findCommandSlashIndex('/model anthropic/claude'), 0);
  assert.equal(findCommandSlashIndex('http://example.test /mode'), 20);
});

test('getActiveSlashCompletion returns the slash query and token replacement range', () => {
  const text = 'please /repoin status';
  const active = getActiveSlashCompletion(text, 'please /rep'.length);
  assert.deepEqual(active, {
    start: 7,
    end: 'please /repoin'.length,
    query: '/rep',
  });
});

test('getActiveSlashCompletion is null when slash is not command-like', () => {
  assert.equal(getActiveSlashCompletion('please/read', 'please/read'.length), null);
});

test('replaceActiveSlashCompletion replaces the active token without duplicating separator whitespace', () => {
  const text = 'please /repoin status';
  const active = getActiveSlashCompletion(text, 'please /rep'.length);
  assert.ok(active);
  assert.deepEqual(replaceActiveSlashCompletion(text, active, '/repointel '), {
    text: 'please /repointel status',
    caret: 'please /repointel '.length,
  });
});

test('shouldOpenSlashCompletion opens command, subcommand, and selected arg completions', () => {
  assert.equal(shouldOpenSlashCompletion('/'), true);
  assert.equal(shouldOpenSlashCompletion('/rep'), true);
  assert.equal(shouldOpenSlashCompletion('/repointel s'), true);
  assert.equal(shouldOpenSlashCompletion('/mode a'), true);
  assert.equal(shouldOpenSlashCompletion('/reasoning xh'), true);
  assert.equal(shouldOpenSlashCompletion('/thinking min'), true);
  assert.equal(shouldOpenSlashCompletion('/workflow re'), true);
  assert.equal(shouldOpenSlashCompletion('/extensions sdk l'), true);
  assert.equal(shouldOpenSlashCompletion('/workflow runs --lim'), true);
  assert.equal(shouldOpenSlashCompletion('/workflow prune --dry'), true);
});

test('shouldOpenSlashCompletion stays quiet for unsupported freeform arguments', () => {
  assert.equal(shouldOpenSlashCompletion('/mode auto'), false);
  assert.equal(shouldOpenSlashCompletion('/reasoning quick'), false);
  assert.equal(shouldOpenSlashCompletion('/repointel status'), false);
  assert.equal(shouldOpenSlashCompletion('/extensions sdk load'), false);
  assert.equal(shouldOpenSlashCompletion('/compact instructions'), false);
  assert.equal(shouldOpenSlashCompletion('/workflow create build app'), false);
  assert.equal(shouldOpenSlashCompletion('/workflow runs --limit '), false);
  assert.equal(shouldOpenSlashCompletion('/workflow runs --limit 5'), false);
  assert.equal(shouldOpenSlashCompletion('/workflow prune --keep '), false);
  assert.equal(shouldOpenSlashCompletion('/workflow prune --older-than '), false);
  assert.equal(shouldOpenSlashCompletion('/unknown arg'), false);
});
