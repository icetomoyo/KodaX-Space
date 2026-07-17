import type { ReactNode } from 'react';
import { Maximize2, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider.js';

export type RightSidebarWidthMode = 'default' | 'half' | 'max' | 'custom';

interface RightSidebarFrameProps {
  readonly children: ReactNode;
  readonly width?: number;
  readonly widthMode?: RightSidebarWidthMode;
  readonly onDefaultWidth?: () => void;
  readonly onHalfWidth?: () => void;
  readonly onMaxWidth?: () => void;
  readonly onClose?: () => void;
  readonly closeTestId?: string;
  readonly dockKind?: string;
}

/** Shared right-sidebar chrome. Surface-specific panels own only the body content. */
export function RightSidebarFrame({
  children,
  width,
  widthMode = 'custom',
  onDefaultWidth,
  onHalfWidth,
  onMaxWidth,
  onClose,
  closeTestId,
  dockKind = 'task-dock',
}: RightSidebarFrameProps): JSX.Element {
  return (
    <aside
      data-testid="right-sidebar"
      data-dock-kind={dockKind}
      style={width !== undefined ? { width: `${width}px` } : undefined}
      className="glass lift ix-zone border border-border-default rounded-xl overflow-hidden bg-surface flex flex-col flex-shrink-0 text-[13px]"
    >
      <RightSidebarWidthToolbar
        mode={widthMode}
        onDefaultWidth={onDefaultWidth}
        onHalfWidth={onHalfWidth}
        onMaxWidth={onMaxWidth}
        onClose={onClose}
        closeTestId={closeTestId}
      />
      {children}
    </aside>
  );
}

function RightSidebarWidthToolbar({
  mode,
  onDefaultWidth,
  onHalfWidth,
  onMaxWidth,
  onClose,
  closeTestId,
}: {
  readonly mode: RightSidebarWidthMode;
  readonly onDefaultWidth?: () => void;
  readonly onHalfWidth?: () => void;
  readonly onMaxWidth?: () => void;
  readonly onClose?: () => void;
  readonly closeTestId?: string;
}): JSX.Element {
  const { t } = useI18n();
  const closeLabel = t('shell.hideSidebar', { side: t('shell.side.right') });
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border-default/60 px-2 py-1.5 flex-shrink-0">
      <span className="text-[10px] uppercase tracking-wider text-fg-faint">{t('right.panel')}</span>
      <div className="flex items-center gap-0.5">
        <RightWidthButton active={mode === 'max'} label={t('right.maxWidth')} onClick={onMaxWidth}>
          <Maximize2 size={13} strokeWidth={1.8} aria-hidden />
        </RightWidthButton>
        <RightWidthButton
          active={mode === 'half'}
          label={t('right.halfWidth')}
          onClick={onHalfWidth}
        >
          <PanelRightOpen size={13} strokeWidth={1.8} aria-hidden />
        </RightWidthButton>
        <RightWidthButton
          active={mode === 'default'}
          label={t('right.defaultWidth')}
          onClick={onDefaultWidth}
        >
          <PanelRightClose size={13} strokeWidth={1.8} aria-hidden />
        </RightWidthButton>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-1 w-6 h-6 inline-flex items-center justify-center rounded border-l border-border-default text-fg-muted hover:bg-surface-3 hover:text-fg-primary"
            title={closeLabel}
            aria-label={closeLabel}
            data-testid={closeTestId}
          >
            <X size={13} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

function RightWidthButton({
  active,
  label,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`w-6 h-6 inline-flex items-center justify-center rounded hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-35 ${
        active ? 'text-fg-primary bg-surface-3' : 'text-fg-muted hover:text-fg-primary'
      }`}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
