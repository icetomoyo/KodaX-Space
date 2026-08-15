const LONG_TASK_THRESHOLD_MS = 60_000;
export const LIVE_PROMPT_START_FRESH_MS = 5 * 60_000;

export interface CompletionFocusSnapshot {
  readonly hidden: boolean;
  readonly focused: boolean;
}

export interface CompletionPromptOwner {
  readonly userMessageId: string;
  readonly startedAt: number;
  readonly runtimeId?: string;
  readonly runId?: string;
  readonly turnId?: string;
}

export interface CompletionTerminalOwner {
  readonly runtimeId?: string;
  readonly runId?: string;
  readonly turnId?: string;
}

export function liveStartMatchesPromptRun(
  promptRunId: string | undefined,
  startRunId: string | undefined,
): boolean {
  return startRunId === undefined || promptRunId === startRunId;
}

export function completionTerminalMatchesPrompt(
  prompt: CompletionPromptOwner,
  terminal: CompletionTerminalOwner,
): boolean {
  if (prompt.runId !== undefined || terminal.runId !== undefined) {
    if (prompt.runId === undefined || prompt.runId !== terminal.runId) return false;
    if (
      prompt.runtimeId !== undefined &&
      terminal.runtimeId !== undefined &&
      prompt.runtimeId !== terminal.runtimeId
    ) {
      return false;
    }
  }
  if (prompt.turnId !== undefined && terminal.turnId !== undefined) {
    return prompt.turnId === terminal.turnId;
  }
  return true;
}

export function shouldNotifyForCompletion(input: {
  readonly startedAt: number;
  readonly now: number;
  readonly focus: CompletionFocusSnapshot;
}): boolean {
  const elapsedMs = input.now - input.startedAt;
  if (elapsedMs < LONG_TASK_THRESHOLD_MS) return false;
  return input.focus.hidden || !input.focus.focused;
}

export function isFreshLivePromptStart(sentAt: number, now = Date.now()): boolean {
  const ageMs = now - sentAt;
  return ageMs >= -5_000 && ageMs <= LIVE_PROMPT_START_FRESH_MS;
}

export function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const m2 = min % 60;
  return m2 > 0 ? `${hr}h ${m2}m` : `${hr}h`;
}
