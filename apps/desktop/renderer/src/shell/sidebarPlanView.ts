import {
  isOpenTodoStatus,
  summarizeTodoProgress,
} from '../lib/liveTaskProgress.js';

export type SidebarTodoStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface SidebarTodoItem {
  readonly id: string;
  readonly content: string;
  readonly status: SidebarTodoStatus;
  readonly activeForm?: string;
}

export type SidebarPlanRow =
  | { readonly kind: 'done-summary'; readonly count: number }
  | { readonly kind: 'item'; readonly item: SidebarTodoItem; readonly index: number }
  | { readonly kind: 'more-summary'; readonly count: number };

export interface SidebarPlanViewModel {
  readonly total: number;
  readonly completed: number;
  readonly running?: SidebarTodoItem;
  readonly rows: readonly SidebarPlanRow[];
}

export interface SidebarPlanViewOptions {
  readonly expanded?: boolean;
}

const MAX_VISIBLE_ROWS = 6;
const MAX_VISIBLE_ITEMS_WITH_SUMMARIES = 4;

export function buildSidebarPlanView(
  todos: readonly SidebarTodoItem[],
  options: SidebarPlanViewOptions = {},
): SidebarPlanViewModel {
  const progress = summarizeTodoProgress(todos);
  const total = progress.total;
  const completed = progress.completed;
  const running = todos.find((todo) => todo.status === 'in_progress');

  if (options.expanded || total <= MAX_VISIBLE_ROWS) {
    return {
      total,
      completed,
      running,
      rows: todos.map((item, index) => ({ kind: 'item', item, index })),
    };
  }

  const selected = selectVisibleTodoIndices(todos);
  const selectedSet = new Set(selected);
  const hidden = todos
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !selectedSet.has(index));
  const hiddenCompleted = hidden.filter(({ item }) => item.status === 'completed').length;
  const hiddenOpen = hidden.filter(({ item }) => isOpenTodoStatus(item.status)).length;
  const rows: SidebarPlanRow[] = [];

  if (hiddenCompleted > 0) rows.push({ kind: 'done-summary', count: hiddenCompleted });
  for (const index of selected) rows.push({ kind: 'item', item: todos[index]!, index });
  if (hiddenOpen > 0) rows.push({ kind: 'more-summary', count: hiddenOpen });

  return { total, completed, running, rows };
}

function selectVisibleTodoIndices(todos: readonly SidebarTodoItem[]): readonly number[] {
  const budget = Math.min(MAX_VISIBLE_ITEMS_WITH_SUMMARIES, todos.length);
  const anchor = findAnchorIndex(todos);
  const start = clamp(anchor - 1, 0, Math.max(0, todos.length - budget));
  const selected = range(start, start + budget);

  const failedIndex = findLastIndex(todos, (todo) => todo.status === 'failed');
  if (failedIndex >= 0 && !selected.includes(failedIndex)) {
    const replaceAt = findReplacementSlot(selected, todos, anchor);
    if (replaceAt >= 0) {
      selected[replaceAt] = failedIndex;
      selected.sort((a, b) => a - b);
    }
  }

  return selected;
}

function findAnchorIndex(todos: readonly SidebarTodoItem[]): number {
  const running = todos.findIndex((todo) => todo.status === 'in_progress');
  if (running >= 0) return running;

  const pending = todos.findIndex((todo) => todo.status === 'pending');
  if (pending >= 0) return pending;

  const completed = findLastIndex(todos, (todo) => todo.status === 'completed');
  if (completed >= 0) return completed;

  return 0;
}

function findReplacementSlot(
  selected: readonly number[],
  todos: readonly SidebarTodoItem[],
  anchor: number,
): number {
  const replaceablePending = findLastIndex(selected, (index) => {
    return index !== anchor && todos[index]?.status === 'pending';
  });
  if (replaceablePending >= 0) return replaceablePending;

  const replaceableCompleted = selected.findIndex((index) => {
    return index !== anchor && todos[index]?.status === 'completed';
  });
  if (replaceableCompleted >= 0) return replaceableCompleted;

  return findLastIndex(selected, (index) => index !== anchor);
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let index = start; index < end; index += 1) out.push(index);
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!)) return index;
  }
  return -1;
}
