import { protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import {
  APP_PROTOCOL_SCHEME,
  ARTIFACT_HTML_FRAME_BOOTSTRAP,
  artifactHtmlFrameResponseHeaders,
  appAssetResponseHeaders,
  isArtifactHtmlFrameUrl,
  resolveAppProtocolPath,
} from './app-protocol-policy.js';
import {
  PROJECT_WEB_PREVIEW_RUNTIME,
  PROJECT_WEB_PREVIEW_RUNTIME_PATH,
  inferProjectWebPreviewSources,
  injectProjectWebPreviewRuntime,
  isProjectWebPreviewUrl,
  projectWebPreviewRegistry,
  projectWebPreviewResponseHeaders,
} from './project-web-preview.js';
import { handleSessionAttachmentProtocolRequest } from './session-attachment-protocol.js';

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
    const attachmentResponse = await handleSessionAttachmentProtocolRequest(
      request.url,
      request.method,
    );
    if (attachmentResponse !== null) return attachmentResponse;
    if (isArtifactHtmlFrameUrl(request.url)) {
      return new Response(ARTIFACT_HTML_FRAME_BOOTSTRAP, {
        status: 200,
        headers: artifactHtmlFrameResponseHeaders(),
      });
    }
    if (isProjectWebPreviewUrl(request.url)) {
      const resolved = await projectWebPreviewRegistry.resolve(request.url, request.method);
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
      if (resolved.kind === 'runtime') {
        return new Response(request.method === 'HEAD' ? null : PROJECT_WEB_PREVIEW_RUNTIME, {
          status: 200,
          headers: projectWebPreviewResponseHeaders(
            PROJECT_WEB_PREVIEW_RUNTIME_PATH,
            resolved.networkAccess,
          ),
        });
      }
      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: projectWebPreviewResponseHeaders(resolved.filePath, resolved.networkAccess),
        });
      }
      try {
        const bytes = await readFile(resolved.filePath);
        const isHtml = /\.html?$/i.test(resolved.filePath);
        const html = isHtml ? bytes.toString('utf8') : null;
        const body = html !== null ? injectProjectWebPreviewRuntime(html) : new Uint8Array(bytes);
        return new Response(body, {
          status: 200,
          headers: projectWebPreviewResponseHeaders(
            resolved.filePath,
            resolved.networkAccess,
            html !== null ? inferProjectWebPreviewSources(html) : undefined,
          ),
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
    }
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
