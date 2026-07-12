import { app, dialog, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registerChannelWithEvent } from './register.js';
import { isRendererTarget } from './push.js';
import { buildDiagnosticBundle } from '../diagnostics/export.js';
import {
  flushDiagnostics,
  getDiagnosticLogDirectory,
  getDiagnosticRedactionOptions,
  getDiagnosticsLogger,
} from '../diagnostics/runtime.js';
import { replaceFilePreservingExisting } from '../diagnostics/safe-write.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';
import { getExperimentalMemorySdkCapability } from '../kodax/kodax-sdk-probe.js';
import { getUpdaterStateForDiagnostics } from './updater.js';

export interface DiagnosticsChannelDeps {
  readonly getMainWindow: () => BrowserWindow | null;
  readonly spaceVersion: string;
}

function exportFileName(now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `kodax-space-diagnostics-${stamp}.zip`;
}

export function registerDiagnosticsChannels(deps: DiagnosticsChannelDeps): void {
  registerChannelWithEvent('diagnostics.report', (input, event) => {
    if (!isRendererTarget(event.sender)) {
      throw new Error('diagnostics reports are accepted only from the primary renderer');
    }
    getDiagnosticsLogger()?.log(
      input.level,
      input.component,
      input.event,
      input.message,
      input.context,
    );
    return { accepted: true };
  });

  registerChannelWithEvent('diagnostics.export', async (input, event) => {
    if (!isRendererTarget(event.sender)) {
      throw new Error('diagnostic exports are accepted only from the primary renderer');
    }
    const parent = deps.getMainWindow();
    const result = parent
      ? await dialog.showSaveDialog(parent, {
          title: 'Export KodaX Space diagnostics',
          defaultPath: path.join(app.getPath('downloads'), exportFileName()),
          filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        })
      : await dialog.showSaveDialog({
          title: 'Export KodaX Space diagnostics',
          defaultPath: path.join(app.getPath('downloads'), exportFileName()),
          filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        });
    if (result.canceled || !result.filePath) return { status: 'cancelled' } as const;

    await flushDiagnostics();
    const runtime = runtimeHostAdapter.snapshot();
    const redaction = getDiagnosticRedactionOptions();
    const bundle = await buildDiagnosticBundle({
      logDirectory:
        getDiagnosticLogDirectory() ?? path.join(app.getPath('userData'), 'diagnostics'),
      spaceVersion: deps.spaceVersion,
      sdkVersion: runtime.identity?.version ?? 'unknown',
      platform: process.platform,
      categories: input.categories,
      capabilities: {
        runtime,
        experimentalMemory: getExperimentalMemorySdkCapability(),
        applicationOrigin: 'app://space',
        diagnostics: { fileSink: getDiagnosticLogDirectory() !== null, remoteUpload: false },
      },
      release: {
        version: deps.spaceVersion,
        packaged: app.isPackaged,
        arch: process.arch,
        updater: getUpdaterStateForDiagnostics(),
      },
      degradations:
        runtime.state === 'ready'
          ? []
          : [{ code: `runtime-${runtime.state}`, detail: runtime.error ?? 'Runtime not ready' }],
      secretValues: redaction.secretValues,
      privatePathPrefixes: redaction.privatePathPrefixes,
    });

    const destination = path.resolve(result.filePath);
    const temporary = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, bundle, { mode: 0o600, flag: 'wx' });
      await replaceFilePreservingExisting(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    getDiagnosticsLogger()?.info('diagnostics', 'export.saved', 'Diagnostic bundle saved', {
      categories: input.categories ?? 'all',
      bytes: bundle.byteLength,
    });
    return { status: 'saved', fileName: path.basename(destination) } as const;
  });
}
