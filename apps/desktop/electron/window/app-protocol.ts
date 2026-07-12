import { protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import {
  APP_PROTOCOL_SCHEME,
  appAssetResponseHeaders,
  resolveAppProtocolPath,
} from './app-protocol-policy.js';

let privilegesRegistered = false;
let handlerInstalled = false;

/** Must run before app.ready; safe to call repeatedly in tests/bootstrap composition. */
export function registerAppSchemePrivileges(): void {
  if (privilegesRegistered) return;
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
      },
    },
  ]);
  privilegesRegistered = true;
}

/** Install the immutable packaged renderer handler after Electron is ready. */
export function installAppProtocolHandler(rendererRoot: string): void {
  if (handlerInstalled) return;
  protocol.handle(APP_PROTOCOL_SCHEME, async (request) => {
    const resolved = await resolveAppProtocolPath(request.url, rendererRoot);
    if (!resolved.ok) {
      return new Response(resolved.code, {
        status: resolved.status,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }
    try {
      const bytes = await readFile(resolved.filePath);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: appAssetResponseHeaders(resolved.filePath),
      });
    } catch {
      return new Response('read-failed', {
        status: 500,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }
  });
  handlerInstalled = true;
}
