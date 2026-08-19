import { useEffect, useState, type JSX } from 'react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider.js';

export interface CompleteExitElapsedClock {
  readonly now: () => number;
  readonly setInterval: (callback: () => void, timeoutMs: number) => number;
  readonly clearInterval: (timer: number) => void;
}

export function startCompleteExitElapsedTimer(
  startedAt: number,
  update: (elapsedSeconds: number) => void,
  clock: CompleteExitElapsedClock,
): () => void {
  const timer = clock.setInterval(() => {
    update(Math.floor((clock.now() - startedAt) / 1_000));
  }, 1_000);
  return () => clock.clearInterval(timer);
}

export function CompleteExitOverlayPresentation({
  active,
  title,
  detail,
  elapsedLabel,
}: {
  readonly active: boolean;
  readonly title: string;
  readonly detail: string;
  readonly elapsedLabel: string;
}): JSX.Element | null {
  if (!active) return null;
  return (
    <div className="app-no-drag fixed inset-0 z-[300] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
      <div
        role="status"
        aria-live="assertive"
        aria-busy="true"
        className="flex w-[min(440px,calc(100vw-32px))] items-center gap-3 rounded-xl border border-border-default bg-surface-2/95 px-4 py-3 text-fg-primary shadow-2xl"
      >
        <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-accent" aria-hidden />
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-fg-secondary">{detail}</div>
          <div className="mt-1 text-[11px] tabular-nums text-fg-muted">{elapsedLabel}</div>
        </div>
      </div>
    </div>
  );
}

export function CompleteExitOverlay(): JSX.Element | null {
  const [active, setActive] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const { t } = useI18n();

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    return bridge.on('window.completeExitProgress', ({ active: nextActive }) => {
      setActive(nextActive);
      setStartedAt(nextActive ? Date.now() : 0);
      setElapsedSeconds(0);
    });
  }, []);

  useEffect(() => {
    if (!active || startedAt === 0) return;
    return startCompleteExitElapsedTimer(startedAt, setElapsedSeconds, {
      now: Date.now,
      setInterval: window.setInterval.bind(window),
      clearInterval: window.clearInterval.bind(window),
    });
  }, [active, startedAt]);

  return (
    <CompleteExitOverlayPresentation
      active={active}
      title={t('completeExit.preparingTitle')}
      detail={t('completeExit.preparingDetail')}
      elapsedLabel={t('completeExit.elapsed', { seconds: elapsedSeconds })}
    />
  );
}
