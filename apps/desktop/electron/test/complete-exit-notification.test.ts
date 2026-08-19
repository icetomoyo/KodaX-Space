import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
const backgroundExitStart = mainSource.indexOf('function continueCompleteExitInBackground');
const backgroundExitEnd = mainSource.indexOf('function markCompleteExitLocalFinalization');
const backgroundExitSource = mainSource.slice(backgroundExitStart, backgroundExitEnd);

test('ordinary safe exit stays silent at the Windows notification layer', () => {
  assert.ok(backgroundExitStart >= 0 && backgroundExitEnd > backgroundExitStart);
  assert.doesNotMatch(backgroundExitSource, /\.displayBalloon\s*\(/);
  assert.match(backgroundExitSource, /state:\s*'exiting'/);
  assert.match(backgroundExitSource, /hideExitWindowsForBackgroundShutdown\(\)/);
});
