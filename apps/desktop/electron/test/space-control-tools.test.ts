import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  _resetSpaceControlToolRegistrationForTesting,
  ensureSpaceControlToolsRegistered,
  isSpaceControlToolExposureEnabled,
  SPACE_CONTROL_APPLY_TOOL,
  SPACE_CONTROL_INSPECT_TOOL,
} from '../space-control/tools.js';
import {
  _clearPartnerSpaceToolPoliciesForTesting,
  getPartnerSpaceToolPolicy,
  isPartnerToolAllowed,
} from '../kodax/partner-tools.js';
import {
  getSpaceActionDescriptor,
  listSpaceActionDescriptors,
  validateSpaceActionArgs,
} from '../space-control/catalog.js';
import { SPACE_CONTROL_INVENTORY } from '../space-control/classification.js';

test('space action catalog filters by product surface and validates bounded values', () => {
  const partnerIds = listSpaceActionDescriptors(undefined, 'partner').map((item) => item.id);
  assert.ok(partnerIds.includes('ui.theme.set'));
  assert.ok(!partnerIds.includes('ui.taskDock.setOpen'));
  assert.equal(
    validateSpaceActionArgs(getSpaceActionDescriptor('ui.theme.set'), { value: 'dark' }),
    true,
  );
  assert.equal(
    validateSpaceActionArgs(getSpaceActionDescriptor('ui.theme.set'), { value: 'neon' }),
    false,
  );
  assert.equal(
    validateSpaceActionArgs(getSpaceActionDescriptor('ui.leftSidebar.setOpen'), { value: true }),
    true,
  );
});

test('space control rollout gate is explicit and defaults on', () => {
  assert.equal(isSpaceControlToolExposureEnabled({}), true);
  assert.equal(isSpaceControlToolExposureEnabled({ SPACE_DISABLE_SPACE_CONTROL: '0' }), true);
  assert.equal(isSpaceControlToolExposureEnabled({ SPACE_DISABLE_SPACE_CONTROL: '1' }), false);
});

test('disabled space control exposure does not register tools', () => {
  _resetSpaceControlToolRegistrationForTesting();
  const previous = process.env.SPACE_DISABLE_SPACE_CONTROL;
  process.env.SPACE_DISABLE_SPACE_CONTROL = '1';
  try {
    let calls = 0;
    ensureSpaceControlToolsRegistered({
      registerTool() {
        calls += 1;
      },
    });
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.SPACE_DISABLE_SPACE_CONTROL;
    else process.env.SPACE_DISABLE_SPACE_CONTROL = previous;
  }
});

test('space control tools declare SDK safety metadata and register exactly once', () => {
  _resetSpaceControlToolRegistrationForTesting();
  _clearPartnerSpaceToolPoliciesForTesting();
  const definitions: Array<Record<string, unknown>> = [];
  const sdk = {
    registerTool(definition: Record<string, unknown>) {
      definitions.push(definition);
      return () => undefined;
    },
  };
  ensureSpaceControlToolsRegistered(sdk);
  ensureSpaceControlToolsRegistered(sdk);
  assert.deepEqual(
    definitions.map((definition) => definition.name),
    ['space_control_inspect', 'space_control_apply'],
  );
  assert.equal(SPACE_CONTROL_INSPECT_TOOL.sideEffect, 'readonly');
  assert.equal(SPACE_CONTROL_INSPECT_TOOL.toClassifierInput(), '');
  assert.equal(SPACE_CONTROL_APPLY_TOOL.sideEffect, 'mutates-state');
  assert.equal(
    SPACE_CONTROL_APPLY_TOOL.toClassifierInput({
      actionId: 'ui.theme.set',
      args: { value: 'dark' },
    }),
    'SpaceControl ui.theme.set=dark',
  );
  assert.equal(getPartnerSpaceToolPolicy('space_control_apply')?.scope, 'space-control');
  assert.equal(
    isPartnerToolAllowed('space_control_apply', 'subagent', { sideEffect: 'mutates-state' }),
    true,
  );
  _clearPartnerSpaceToolPoliciesForTesting();
});

test('space control tool registration rolls back a partial SDK registration', () => {
  _resetSpaceControlToolRegistrationForTesting();
  _clearPartnerSpaceToolPoliciesForTesting();
  let calls = 0;
  let disposed = 0;
  const failure = new Error('second registration failed');
  assert.throws(
    () =>
      ensureSpaceControlToolsRegistered({
        registerTool() {
          calls += 1;
          if (calls === 2) throw failure;
          return () => {
            disposed += 1;
          };
        },
      }),
    failure,
  );
  assert.equal(disposed, 1);

  const retried: unknown[] = [];
  ensureSpaceControlToolsRegistered({
    registerTool(definition: unknown) {
      retried.push(definition);
      return () => undefined;
    },
  });
  assert.equal(retried.length, 2);
  _clearPartnerSpaceToolPoliciesForTesting();
});

test('control inventory is unique, fully classified, and maps every visible action', () => {
  const ids = SPACE_CONTROL_INVENTORY.map((entry) => entry.controlId);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of SPACE_CONTROL_INVENTORY) {
    const prefix =
      entry.area === 'command-palette'
        ? 'commandPalette'
        : entry.area === 'local-slash'
          ? 'slash'
          : entry.area;
    assert.ok(entry.controlId.startsWith(`${prefix}.`));
    if (entry.classification === 'llm-visible') assert.ok(entry.actionId);
    else assert.ok(entry.reasonCode);
  }
  const visibleActions = new Set(
    SPACE_CONTROL_INVENTORY.flatMap((entry) =>
      entry.classification === 'llm-visible' && entry.actionId ? [entry.actionId] : [],
    ),
  );
  assert.deepEqual(
    [...visibleActions].sort(),
    [
      'settings.reasoningMode.setDefault',
      'ui.language.set',
      'ui.leftSidebar.setOpen',
      'ui.settings.open',
      'ui.surface.set',
      'ui.taskDock.setOpen',
      'ui.taskDock.widthMode.set',
      'ui.theme.set',
    ].sort(),
  );
});
