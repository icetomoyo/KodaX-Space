import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Portal } from '../components/Portal.js';
import { clampSidebarContextMenuPosition } from './sidebarContextMenuModel.js';

export interface SidebarContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly danger?: boolean;
  readonly onSelect: () => void;
}

interface SidebarContextMenuProps {
  readonly x: number;
  readonly y: number;
  readonly ariaLabel: string;
  readonly groups: readonly (readonly SidebarContextMenuItem[])[];
  readonly onClose: () => void;
  readonly width?: number;
  readonly estimatedHeight?: number;
  readonly testId?: string;
}

export function SidebarContextMenu({
  x,
  y,
  ariaLabel,
  groups,
  onClose,
  width = 208,
  estimatedHeight = 240,
  testId,
}: SidebarContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState(estimatedHeight);
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const position = useMemo(
    () =>
      clampSidebarContextMenuPosition({
        x,
        y,
        menuWidth: width,
        menuHeight: measuredHeight,
        viewportWidth,
        viewportHeight,
      }),
    [measuredHeight, viewportHeight, viewportWidth, width, x, y],
  );

  useLayoutEffect(() => {
    const height = ref.current?.getBoundingClientRect().height;
    if (height !== undefined && height > 0 && Math.abs(height - measuredHeight) > 0.5) {
      setMeasuredHeight(height);
    }
  }, [groups, measuredHeight]);

  useEffect(() => {
    const menu = ref.current;
    menu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();

    function onDocumentDown(event: MouseEvent): void {
      if (menu && !menu.contains(event.target as Node)) onClose();
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = Array.from(
        menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
      );
      if (items.length === 0) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      let next = current;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
      else next = current <= 0 ? items.length - 1 : current - 1;
      items[next]?.focus();
    }

    document.addEventListener('mousedown', onDocumentDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <Portal>
      <div
        ref={ref}
        className="fixed z-[100] overflow-hidden rounded-xl border border-border-default/80 bg-surface-4 p-1.5 text-[13px] leading-5 text-fg-primary shadow-2xl"
        style={{ left: position.left, top: position.top, width }}
        role="menu"
        aria-label={ariaLabel}
        data-testid={testId}
      >
        {groups.map((group, groupIndex) => (
          <div key={group.map((item) => item.id).join(':')}>
            {groupIndex > 0 && <div className="-mx-1.5 my-1.5 border-t border-border-default/70" />}
            <div className="space-y-0.5">
              {group.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  data-menu-action={item.id}
                  onClick={item.onSelect}
                  className={`flex min-h-8 w-full items-center rounded-lg px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:bg-hover-bg ${
                    item.danger
                      ? 'text-danger hover:bg-danger/10'
                      : 'text-fg-primary hover:bg-hover-bg'
                  } ${item.icon === undefined ? '' : 'gap-2.5'}`}
                >
                  {item.icon !== undefined && (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-current">
                      {item.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Portal>
  );
}
