export type RightSidebarToggleAction = 'close' | 'open-default' | 'open-balanced';

/**
 * Resolve a manual sidebar toggle from rendered state, not only persisted intent.
 * Responsive layout can hide a sidebar whose persisted open flag is still true.
 */
export function resolveRightSidebarToggleAction(
  visible: boolean,
  desiredOpen: boolean,
  defaultWidthFits = true,
): RightSidebarToggleAction {
  if (visible) return 'close';
  return desiredOpen || !defaultWidthFits ? 'open-balanced' : 'open-default';
}
