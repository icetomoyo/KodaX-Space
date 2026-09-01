export interface ActiveSlashCompletion {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

export interface SlashCompletionReplacement {
  readonly text: string;
  readonly caret: number;
}

const SLASH_ARG_ALIASES: Readonly<Record<string, string>> = {
  a: 'auto',
  am: 'agent-mode',
  ctx: 'status',
  del: 'delete',
  ext: 'extensions',
  h: 'help',
  hist: 'history',
  info: 'status',
  ls: 'sessions',
  m: 'model',
  reason: 'reasoning',
  recovery: 'recover',
  resume: 'load',
  ri: 'repointel',
  rm: 'delete',
  t: 'thinking',
  think: 'thinking',
  '?': 'help',
};

const DYNAMIC_ARG_COMPLETION_COMMANDS = new Set([
  'delete',
  'fork',
  'help',
  'load',
  'model',
  'provider',
  'rewind',
  'sessions',
  'tree',
]);

const STATIC_ARG_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  'agent-mode': ['ama', 'sa', 'toggle'],
  auto: ['auto'],
  extensions: ['status', 'refresh', 'sdk'],
  fallback: ['status', 'off'],
  goal: ['status', 'pause', 'resume', 'complete', 'blocked', 'clear', 'help', '--tokens'],
  learn: ['pending', 'ledger', 'diff', 'approve', 'reject', 'help'],
  mcp: ['status', 'refresh'],
  memory: ['inbox', 'pending', 'list', 'show', 'approve', 'reject', 'curate', 'open', 'help'],
  mode: ['plan', 'accept-edits', 'auto', 'full-access'],
  paste: ['list', 'show', 'help'],
  reasoning: ['off', 'auto', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  recover: ['seed', 'prompt', 'candidate', 'help'],
  repointel: ['status', 'mode', 'trace', 'warm', 'endpoint', 'bin'],
  review: ['--lean', '--workflow', 'base', 'sha', 'help'],
  skill: ['pending', 'ledger'],
  skills: ['pending', 'ledger'],
  'stall-log': ['on', 'off'],
  status: ['workspace', 'worktree', 'runtime', 'peers'],
  thinking: ['on', 'off', 'auto', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  'verifier-log': ['on', 'off'],
};

const NESTED_STATIC_ARG_OPTIONS: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  extensions: {
    sdk: ['load'],
  },
  repointel: {
    bin: ['default'],
    endpoint: ['default'],
    mode: ['auto', 'off', 'oss', 'premium-shared', 'premium-native'],
  },
};

export function findCommandSlashIndex(beforeCursor: string): number {
  let idx = beforeCursor.lastIndexOf('/');
  if (idx === -1) return -1;

  while (idx > 0 && !/\s/.test(beforeCursor[idx - 1] ?? '')) {
    idx = beforeCursor.lastIndexOf('/', idx - 1);
    if (idx === -1) return -1;
  }
  return idx;
}

export function getActiveSlashCompletion(
  text: string,
  cursorPos: number,
): ActiveSlashCompletion | null {
  const caret = Math.max(0, Math.min(cursorPos, text.length));
  const beforeCursor = text.slice(0, caret);
  const slashIndex = findCommandSlashIndex(beforeCursor);
  if (slashIndex === -1) return null;

  let end = caret;
  while (end < text.length && !/\s/.test(text[end] ?? '')) {
    end++;
  }

  return {
    start: slashIndex,
    end,
    query: beforeCursor.slice(slashIndex),
  };
}

export function replaceActiveSlashCompletion(
  text: string,
  active: ActiveSlashCompletion,
  insertText: string,
): SlashCompletionReplacement {
  const suffix = text.slice(active.end);
  const reuseExistingSeparator = /\s$/.test(insertText) && /^\s/.test(suffix);
  const effectiveInsertText = reuseExistingSeparator ? insertText.trimEnd() : insertText;
  const nextText = text.slice(0, active.start) + effectiveInsertText + suffix;
  return {
    text: nextText,
    caret: active.start + effectiveInsertText.length + (reuseExistingSeparator ? 1 : 0),
  };
}

function commandNameOf(query: string): string | null {
  const match = query.trimStart().match(/^\/([^\s]+)/);
  const raw = match?.[1]?.toLowerCase();
  if (!raw) return null;
  return SLASH_ARG_ALIASES[raw] ?? raw;
}

function shouldOpenStaticArgCompletion(query: string): boolean {
  const trimmedQuery = query.trimStart();
  const match = trimmedQuery.match(/^\/([^\s]+)(?:\s+(.*))?$/);
  if (!match || match[2] === undefined) return false;

  const command = commandNameOf(trimmedQuery);
  if (!command) return false;

  const rest = match[2] ?? '';
  const spans = scanArgSpans(rest);
  const endsWithSpace = /\s$/.test(trimmedQuery);
  const first = spans[0]?.value.toLowerCase();
  const prefix = endsWithSpace ? '' : (spans.at(-1)?.value.toLowerCase() ?? '');
  const argIndex = endsWithSpace ? spans.length : Math.max(0, spans.length - 1);

  const nested = first ? NESTED_STATIC_ARG_OPTIONS[command]?.[first] : undefined;
  if (nested && spans.length === 1 && !endsWithSpace) {
    return STATIC_ARG_OPTIONS[command]?.includes(first) ?? false;
  }
  if (nested && argIndex >= 1) {
    return prefix === '' || nested.some((option) => option.startsWith(prefix) && option !== prefix);
  }
  if (endsWithSpace && spans.length > 0) return false;

  const options = STATIC_ARG_OPTIONS[command];
  if (!options) return false;
  return prefix === '' || options.some((option) => option.startsWith(prefix) && option !== prefix);
}

function shouldOpenDynamicArgCompletion(query: string): boolean {
  const command = commandNameOf(query);
  if (!command || !DYNAMIC_ARG_COMPLETION_COMMANDS.has(command)) return false;
  return /^\/[^\s]+\s+.*$/i.test(query.trimStart());
}

export function shouldOpenWorkflowSlashCompletion(query: string): boolean {
  const trimmedQuery = query.trimStart();
  const match = trimmedQuery.match(/^\/workflow(?:\s+(.*))?$/i);
  if (!match) return false;
  const rest = match[1] ?? '';
  if (rest === '') return true;

  const spans = scanArgSpans(rest);
  const endsWithSpace = /\s$/.test(trimmedQuery);
  const first = spans[0]?.value.toLowerCase();
  if (!first) return true;

  if (spans.length === 1 && !endsWithSpace) return true;
  if (first === 'create' || first === 'help' || first === 'list' || first === 'ls') return false;

  if (first === 'revise') {
    const targetIndex = spans[1]?.value === '--replace' ? 2 : 1;
    const target = spans[targetIndex];
    if (!target) return true;
    return !endsWithSpace && spans.length === targetIndex + 1;
  }

  if (first === 'rename' || first === 'rerun') {
    const target = spans[1];
    if (!target) return true;
    return !endsWithSpace && spans.length === 2;
  }

  if (first === 'save') {
    const runId = spans[1];
    if (!runId) return true;
    return !endsWithSpace && spans.length === 2;
  }

  const valueOwner = endsWithSpace ? spans.at(-1)?.value : spans.at(-2)?.value;
  if (first === 'runs' && valueOwner === '--limit') return false;
  if (first === 'prune' && ['--keep', '--older-than'].includes(valueOwner ?? '')) {
    return false;
  }

  return new Set(['runs', 'show', 'pause', 'resume', 'stop', 'delete', 'prune']).has(first);
}

export function shouldOpenSlashCompletion(query: string): boolean {
  const trimmedQuery = query.trimStart();
  if (!trimmedQuery.startsWith('/')) return false;
  if (!/\s/.test(trimmedQuery)) return true;
  if (shouldOpenWorkflowSlashCompletion(trimmedQuery)) return true;
  if (shouldOpenStaticArgCompletion(trimmedQuery)) return true;
  return shouldOpenDynamicArgCompletion(trimmedQuery);
}

function scanArgSpans(rest: string): Array<{ value: string; end: number }> {
  const result: Array<{ value: string; end: number }> = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    result.push({ value: m[1] ?? m[2] ?? '', end: re.lastIndex });
  }
  return result;
}
