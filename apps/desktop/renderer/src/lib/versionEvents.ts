export const SPACE_VERSION_REFRESH_EVENT = 'kodax-space.version-refresh';

export function requestSpaceVersionRefresh(): void {
  window.dispatchEvent(new Event(SPACE_VERSION_REFRESH_EVENT));
}
