import { canonProjectRoot } from '@kodax-space/space-ipc-schema';

export type SessionLoadPhase = 'loading' | 'loaded' | 'error';
export type SessionLoadStateByScope = Readonly<Record<string, SessionLoadPhase | undefined>>;

const IS_WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

export function sessionLoadScopeKey(
  projectRoot: string,
  surface: string,
  isWindows = IS_WINDOWS,
): string {
  return `${surface}:${canonProjectRoot(projectRoot, isWindows)}`;
}

export function unloadedProjectSessionRoots(
  candidates: readonly string[],
  surface: string,
  loadState: SessionLoadStateByScope,
  isWindows = IS_WINDOWS,
): readonly string[] {
  const roots = new Map<string, string>();
  for (const projectRoot of candidates) {
    roots.set(canonProjectRoot(projectRoot, isWindows), projectRoot);
  }
  return [...roots.values()].filter(
    (projectRoot) => loadState[sessionLoadScopeKey(projectRoot, surface, isWindows)] === undefined,
  );
}
