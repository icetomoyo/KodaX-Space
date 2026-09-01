// NotificationsSurface — 持久内联通知 (REPL NotificationsSurface 等价, v0.1.x)
//
// 与 ToastContainer 的区别:
//   - Toast: 几秒自动消失,适合 ephemeral 反馈 (复制成功 / IPC 错)
//   - 这里:  持续显示,直到用户 dismiss 或来源条件消失。eg "Auto-mode fell back to rules"
//     这种系统级状态用户必须确认 — 不能用一闪而过的 toast 处理。
//
// 来源 (当前 v0.1.x 触发器):
//   - 后续: context 80% warning / 反复 retry / network down 等
//
// session 过滤: notice.sessionId 与 currentSessionId 不匹配且非全局 (undefined sessionId) 时不显示。

import { X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../store/appStore.js';
import type { Notification } from '../store/appStore.js';
import { useI18n } from '../i18n/I18nProvider.js';

// 双主题色: 暗模式延续原 zinc-900 衬底家族,亮模式用深色文字 + 浅暖/冷衬底保证对比度。
// 选择 deep-700/800 文字色 + light-100/70 衬底是为了 WCAG AA (4.5:1) 以上对比。
const SEVERITY_BG: Record<Notification['severity'], string> = {
  info: 'text-run bg-run/15 border-run/40',
  warning: 'text-warn bg-warn/15 border-warn/40',
  error: 'text-danger bg-danger/15 border-danger/40',
};
const SEVERITY_ICON: Record<Notification['severity'], string> = {
  info: 'ℹ',
  warning: '⚠',
  error: '✖',
};

interface NotificationRowProps {
  readonly notification: Notification;
  readonly onDismiss: (id: string) => void;
}

function NotificationRow({ notification, onDismiss }: NotificationRowProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div
      data-testid="notification-row"
      data-notification-id={notification.id}
      className={`rounded border px-2 py-1 text-xs flex items-start gap-2 ${SEVERITY_BG[notification.severity]}`}
    >
      <span aria-hidden className="mt-px">
        {SEVERITY_ICON[notification.severity]}
      </span>
      <span className="min-w-0 flex-1 break-words leading-snug">{notification.text}</span>
      <button
        type="button"
        data-testid="notification-dismiss"
        onClick={() => onDismiss(notification.id)}
        className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
        title={t('notification.dismiss')}
        aria-label={t('notification.dismissAria')}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}

export function NotificationsSurface(): JSX.Element | null {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const notifications = useAppStore((s) => s.notifications);
  const dismissNotification = useAppStore((s) => s.dismissNotification);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Visible: global notifications or notifications for the current session.
  const visible = useMemo(
    () =>
      notifications.filter((n) => n.sessionId === undefined || n.sessionId === currentSessionId),
    [currentSessionId, notifications],
  );
  const dismissOnOutsideInteractionIds = useMemo(
    () => visible.filter((n) => n.dismissOnOutsideInteraction).map((n) => n.id),
    [visible],
  );

  useEffect(() => {
    if (dismissOnOutsideInteractionIds.length === 0) return;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      for (const id of dismissOnOutsideInteractionIds) dismissNotification(id);
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [dismissNotification, dismissOnOutsideInteractionIds]);
  if (visible.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className="px-3 space-y-1"
      role="region"
      aria-label={t('notification.systemAria')}
      data-testid="notifications-surface"
    >
      {visible.map((n) => (
        <NotificationRow key={n.id} notification={n} onDismiss={dismissNotification} />
      ))}
    </div>
  );
}
