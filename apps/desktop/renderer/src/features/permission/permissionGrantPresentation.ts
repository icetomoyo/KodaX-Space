import type { PermissionRequestPayload } from '@kodax-space/space-ipc-schema';

export type PermissionGrantPresentation =
  | { readonly kind: 'pattern'; readonly target: string }
  | { readonly kind: 'runtime_persistent'; readonly target: string };

/**
 * Describes the persistent grant the main process can actually create.
 * Legacy Partner requests use a trusted command/tool pattern. Coder Runtime
 * requests expose only the bounded label of a Runtime-issued concrete grant;
 * the opaque suggestion ID remains in Electron main.
 */
export function permissionGrantPresentation(
  request: PermissionRequestPayload,
): PermissionGrantPresentation | null {
  if (request.suggestedPattern) {
    return { kind: 'pattern', target: request.suggestedPattern };
  }
  if (request.allowAlwaysScope?.kind === 'runtime_persistent') {
    return { kind: 'runtime_persistent', target: request.allowAlwaysScope.label };
  }
  return null;
}
