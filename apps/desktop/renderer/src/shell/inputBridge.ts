// Module-private bridge for "insert text into BottomBar input" requests.
//
// Replaces an earlier `window.dispatchEvent` CustomEvent design — that exposed
// an ambient capability where any renderer JS could silently inject text into
// the textarea. Module-private registry confines the channel to code that
// imports this file (BottomBar producer + CommandPalette consumer today).
//
// Contract:
//   - At most one receiver at a time (BottomBar mounts once in Shell). If a
//     second BottomBar registers it overwrites — we log a dev warning rather
//     than throw, since hot-reload during dev can transiently double-register.
//   - requestInsert() falls back to no-op (returns false) when no receiver
//     is mounted; caller decides whether that's a soft error to toast.

type InsertReceiver = (text: string) => void;

let receiver: InsertReceiver | null = null;

/** BottomBar (or test harness) registers itself; returns an unregister fn. */
export function registerInsertReceiver(fn: InsertReceiver): () => void {
  const isDev =
    (
      import.meta as ImportMeta & {
        readonly env?: { readonly DEV?: boolean };
      }
    ).env?.DEV === true;
  if (receiver !== null && receiver !== fn && isDev) {
    // Dev-only doubleregister warning (HMR / Strict Mode double-mount surfaces here)
    console.warn('[inputBridge] receiver overwrite — multiple BottomBar mounts?');
  }
  receiver = fn;
  // Guarded clear — prevents stale unmount from clobbering a re-registered receiver
  // (StrictMode double-invoke / hot-reload).
  return () => {
    if (receiver === fn) receiver = null;
  };
}

/** Returns true if delivered; false if no receiver is currently mounted. */
export function requestInsert(text: string): boolean {
  if (receiver === null) return false;
  receiver(text);
  return true;
}
