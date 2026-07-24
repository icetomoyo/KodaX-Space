import { Settings } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider.js';

interface SidebarFooterProps {
  readonly onOpenSettings: () => void;
}

/** Persistent application footer shared by every left-sidebar content mode. */
export function SidebarFooter({ onOpenSettings }: SidebarFooterProps): JSX.Element {
  const { t } = useI18n();

  return (
    <div
      data-testid="left-sidebar-footer"
      className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-border-default px-3 py-2 text-[11px] text-fg-muted"
    >
      <span className="min-w-0 truncate">KodaX Space</span>
      <button
        type="button"
        onClick={onOpenSettings}
        data-testid="settings-button"
        className="ix-pop inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-fg-secondary hover:bg-hover-bg hover:text-fg-primary"
        aria-label={t('common.settings')}
        title={t('common.settings')}
      >
        <Settings className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        <span>{t('common.settings')}</span>
      </button>
    </div>
  );
}
