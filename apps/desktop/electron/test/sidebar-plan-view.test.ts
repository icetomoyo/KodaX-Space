import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSidebarPlanView,
  type SidebarTodoItem,
} from '../../renderer/src/shell/sidebarPlanView.js';

function todo(id: string, status: SidebarTodoItem['status']): SidebarTodoItem {
  return { id, content: `Task ${id}`, status };
}

function visibleItemIds(vm: ReturnType<typeof buildSidebarPlanView>): string[] {
  return vm.rows.flatMap((row) => (row.kind === 'item' ? [row.item.id] : []));
}

test('sidebar plan shows all items when the plan is already compact', () => {
  const vm = buildSidebarPlanView([
    todo('a', 'completed'),
    todo('b', 'in_progress'),
    todo('c', 'pending'),
  ]);

  assert.equal(vm.completed, 1);
  assert.equal(vm.total, 3);
  assert.deepEqual(
    vm.rows.map((row) => row.kind),
    ['item', 'item', 'item'],
  );
  assert.deepEqual(visibleItemIds(vm), ['a', 'b', 'c']);
});

test('sidebar plan windows a long plan around the active item', () => {
  const vm = buildSidebarPlanView([
    todo('a', 'completed'),
    todo('b', 'completed'),
    todo('c', 'completed'),
    todo('d', 'in_progress'),
    todo('e', 'pending'),
    todo('f', 'pending'),
    todo('g', 'pending'),
    todo('h', 'pending'),
  ]);

  assert.equal(vm.rows.length, 6);
  assert.equal(vm.rows[0]?.kind, 'done-summary');
  assert.deepEqual(visibleItemIds(vm), ['c', 'd', 'e', 'f']);
  assert.equal(vm.rows.at(-1)?.kind, 'more-summary');
});

test('sidebar plan promotes a failed item into the compact window', () => {
  const vm = buildSidebarPlanView([
    todo('a', 'completed'),
    todo('b', 'completed'),
    todo('c', 'in_progress'),
    todo('d', 'pending'),
    todo('e', 'pending'),
    todo('f', 'pending'),
    todo('g', 'failed'),
    todo('h', 'pending'),
  ]);

  assert.deepEqual(visibleItemIds(vm), ['b', 'c', 'd', 'g']);
  assert.ok(vm.rows.some((row) => row.kind === 'done-summary' && row.count === 1));
  assert.ok(vm.rows.some((row) => row.kind === 'more-summary' && row.count === 3));
});

test('sidebar plan shows every item after the compact summary is expanded', () => {
  const todos = [
    todo('a', 'completed'),
    todo('b', 'completed'),
    todo('c', 'in_progress'),
    todo('d', 'pending'),
    todo('e', 'pending'),
    todo('f', 'pending'),
    todo('g', 'pending'),
    todo('h', 'pending'),
  ];

  const vm = buildSidebarPlanView(todos, { expanded: true });

  assert.deepEqual(
    visibleItemIds(vm),
    todos.map((item) => item.id),
  );
  assert.ok(vm.rows.every((row) => row.kind === 'item'));
});
