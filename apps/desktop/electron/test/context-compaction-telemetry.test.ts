import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indicator = readFileSync(
  new URL('../../renderer/src/shell/ContextWindowIndicator.tsx', import.meta.url),
  'utf8',
);

test('active compaction does not present the previous request reading as current pressure', () => {
  assert.match(indicator, /const tokenStr = compacting\s*\? '—'/);
  assert.match(indicator, /const activeContextBudget =\s*!compacting &&/);
  assert.match(indicator, /contextWindow\.compactionInputPending/);
  assert.match(indicator, /contextWindow\.tooltipCompacting/);
  assert.match(indicator, /aria-busy=\{compacting\}/);
  assert.match(
    indicator,
    /aria-valuenow=\{compacting \? undefined : Math\.min\(tokenCount, autoCompactThreshold\)\}/,
  );
  assert.match(indicator, /compacting \? \([\s\S]*context-indeterminate-progress/);
  assert.match(indicator, /'--cw-level-height': compacting \? '0%'/);
});
