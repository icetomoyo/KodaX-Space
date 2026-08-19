import { useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { countAttentionSessions } from './appBadgeModel.js';

interface BadgeSessionFlags {
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly unread?: boolean;
}

interface BadgeInteractionRequest {
  readonly sessionId: string;
}

export interface AppBadgeStoreState {
  readonly sessionFlags: Readonly<Record<string, BadgeSessionFlags | undefined>>;
  readonly permissionQueue: readonly BadgeInteractionRequest[];
  readonly askUserQueue: readonly BadgeInteractionRequest[];
}

const MAX_APP_BADGE_COUNT = 9999;

interface AppBadgeStore {
  getState(): AppBadgeStoreState;
  subscribe(
    listener: (state: AppBadgeStoreState, previousState: AppBadgeStoreState) => void,
  ): () => void;
}

export function subscribeAppBadgeCount(
  store: AppBadgeStore,
  setCount: (count: number) => void,
): () => void {
  let lastCount: number | undefined;
  const sync = (state: AppBadgeStoreState, previousState?: AppBadgeStoreState): void => {
    if (
      previousState &&
      state.sessionFlags === previousState.sessionFlags &&
      state.permissionQueue === previousState.permissionQueue &&
      state.askUserQueue === previousState.askUserQueue
    ) {
      return;
    }
    const count = Math.min(
      countAttentionSessions({
        sessionFlags: state.sessionFlags,
        permissionRequests: state.permissionQueue,
        askUserRequests: state.askUserQueue,
      }),
      MAX_APP_BADGE_COUNT,
    );
    if (count === lastCount) return;
    lastCount = count;
    setCount(count);
  };

  sync(store.getState());
  return store.subscribe(sync);
}

export function useAppBadgeCount(): void {
  useEffect(() => {
    if (!window.kodaxSpace) return;
    return subscribeAppBadgeCount(useAppStore, (count) => {
      void window.kodaxSpace?.invoke('window.setBadgeCount', { count }).catch(() => {
        // Badge support is best-effort; main logs native failures and Session work must continue.
      });
    });
  }, []);
}
