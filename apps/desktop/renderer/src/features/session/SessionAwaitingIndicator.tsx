import { CircleAlert } from 'lucide-react';

export interface SessionAwaitingIndicatorProps {
  readonly label: string;
  readonly mini?: boolean;
  readonly decorative?: boolean;
}

/** High-salience, motion-safe marker for a Session blocked on human interaction. */
export function SessionAwaitingIndicator({
  label,
  mini = false,
  decorative = false,
}: SessionAwaitingIndicatorProps): JSX.Element {
  return (
    <span
      className={`sidebar-status-awaiting${mini ? ' sidebar-status-awaiting--mini' : ''}`}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      title={decorative ? undefined : label}
    >
      <CircleAlert aria-hidden strokeWidth={2.35} />
    </span>
  );
}
