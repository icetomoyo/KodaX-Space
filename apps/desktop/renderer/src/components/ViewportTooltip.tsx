import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Portal } from './Portal.js';

interface ViewportTooltipProps {
  readonly content: string;
  readonly children: ReactNode;
  readonly className?: string;
}

interface TooltipPosition {
  readonly left: number;
  readonly top: number;
}

const VIEWPORT_GUTTER_PX = 8;
const TOOLTIP_GAP_PX = 8;

/**
 * A wrapping tooltip rendered at document.body.
 *
 * Native `title` bubbles are single-line and platform-sized, which makes long
 * Session names and task paths look clipped. The portal also keeps this surface
 * outside the center pane's `overflow-hidden` boundary.
 */
export function ViewportTooltip({
  content,
  children,
  className = '',
}: ViewportTooltipProps): JSX.Element {
  const tooltipId = useId();
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const show = (): void => {
    const anchor = anchorRef.current;
    if (!anchor || content.length === 0) return;
    setPosition(null);
    setAnchorRect(anchor.getBoundingClientRect());
  };

  const hide = (): void => {
    setAnchorRect(null);
    setPosition(null);
  };

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!anchorRect || !tooltip) return;
    const tooltipRect = tooltip.getBoundingClientRect();
    const preferredLeft = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;
    const left = Math.min(
      Math.max(VIEWPORT_GUTTER_PX, preferredLeft),
      Math.max(VIEWPORT_GUTTER_PX, window.innerWidth - tooltipRect.width - VIEWPORT_GUTTER_PX),
    );
    const below = anchorRect.bottom + TOOLTIP_GAP_PX;
    const top =
      below + tooltipRect.height <= window.innerHeight - VIEWPORT_GUTTER_PX
        ? below
        : Math.max(VIEWPORT_GUTTER_PX, anchorRect.top - tooltipRect.height - TOOLTIP_GAP_PX);
    setPosition({ left, top });
  }, [anchorRect, content]);

  useEffect(() => {
    if (!anchorRect) return;
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [anchorRect]);

  return (
    <>
      <span
        ref={anchorRef}
        className={className}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={anchorRect ? tooltipId : undefined}
      >
        {children}
      </span>
      {anchorRect && (
        <Portal>
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none fixed z-[1000] max-w-[min(40rem,calc(100vw-1rem))] whitespace-pre-wrap break-words rounded-md border border-border-strong bg-surface-4 px-2.5 py-1.5 text-xs leading-5 text-fg-primary shadow-xl [overflow-wrap:anywhere]"
            style={{
              left: position?.left ?? anchorRect.left,
              top: position?.top ?? anchorRect.bottom + TOOLTIP_GAP_PX,
              visibility: position ? 'visible' : 'hidden',
            }}
          >
            {content}
          </div>
        </Portal>
      )}
    </>
  );
}
