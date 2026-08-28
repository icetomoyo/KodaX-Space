import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { StructuredLogger, type DiagnosticLogLevel } from './logger.js';
import type { DiagnosticRedactionOptions } from './redaction.js';
import { managedProviderSecretValues } from '../providers/managed-env.js';

const originalConsole = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let logger: StructuredLogger | null = null;
let logDirectory: string | null = null;
let consoleBridgeInstalled = false;
let initialized = false;
let redactionOptions: DiagnosticRedactionOptions = {};

function readSdkVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = typeof require !== 'undefined' ? null : (import.meta as any);
    const req = meta ? createRequire(meta.url) : require;
    const pkg = req('@kodax-ai/kodax/package.json') as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function configuredSecretValues(): string[] {
  const environmentSecrets = Object.entries(process.env)
    .filter(([key, value]) =>
      Boolean(
        value && /(?:api.?key|token|secret|password|authorization|cookie|credential)/i.test(key),
      ),
    )
    .map(([, value]) => value!)
    .filter((value) => value.length >= 6);
  return [...new Set([...environmentSecrets, ...managedProviderSecretValues()])].filter(
    (value) => value.length >= 6,
  );
}

function formatConsoleArgs(args: readonly unknown[]): { message?: string; data?: unknown } {
  if (args.length === 0) return {};
  const [first, ...rest] = args;
  if (typeof first === 'string') {
    return {
      message: first,
      ...(rest.length === 1 ? { data: rest[0] } : rest.length > 1 ? { data: rest } : {}),
    };
  }
  return { data: args.length === 1 ? first : args };
}

function bridge(level: DiagnosticLogLevel, original: (...args: unknown[]) => void) {
  return (...args: unknown[]): void => {
    original(...args);
    const formatted = formatConsoleArgs(args);
    logger?.log(level, 'legacy-console', 'console', formatted.message, formatted.data);
  };
}

function installConsoleBridge(): void {
  if (consoleBridgeInstalled) return;
  console.debug = bridge('debug', originalConsole.debug);
  console.info = bridge('info', originalConsole.info);
  console.log = bridge('info', originalConsole.log);
  console.warn = bridge('warn', originalConsole.warn);
  console.error = bridge('error', originalConsole.error);
  consoleBridgeInstalled = true;
}

export interface InitializeDiagnosticsOptions {
  readonly userDataDir: string;
  readonly spaceVersion: string;
  readonly privatePathPrefixes?: readonly string[];
  readonly fileSinkEnabled?: boolean;
}

export function isDiagnosticFileSinkEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.SPACE_DISABLE_DIAGNOSTIC_FILE_SINK !== '1';
}

export function initializeDiagnostics(
  options: InitializeDiagnosticsOptions,
): StructuredLogger | null {
  if (initialized) return logger;
  initialized = true;
  redactionOptions = {
    secretValues: configuredSecretValues(),
    privatePathPrefixes: [
      os.homedir(),
      options.userDataDir,
      ...(options.privatePathPrefixes ?? []),
    ],
  };
  if (options.fileSinkEnabled === false) {
    originalConsole.warn('[diagnostics] file sink disabled by local rollback gate');
    return null;
  }
  logDirectory = path.join(options.userDataDir, 'diagnostics');
  logger = new StructuredLogger({
    directory: logDirectory,
    version: options.spaceVersion,
    sdkVersion: readSdkVersion(),
    ...redactionOptions,
    fallback: (level, message) => {
      const target = level === 'error' ? originalConsole.error : originalConsole.warn;
      target(`[diagnostics] ${message}`);
    },
  });
  installConsoleBridge();
  logger.info('diagnostics', 'initialized', 'Structured diagnostics initialized', {
    fileSink: true,
    remoteUpload: false,
  });
  return logger;
}

export function getDiagnosticsLogger(): StructuredLogger | null {
  return logger;
}

export function getDiagnosticLogDirectory(): string | null {
  return logDirectory;
}

export function refreshDiagnosticRedactionOptions(): void {
  redactionOptions = {
    ...redactionOptions,
    secretValues: configuredSecretValues(),
  };
  logger?.updateRedactionOptions(redactionOptions);
}

export function getDiagnosticRedactionOptions(): DiagnosticRedactionOptions {
  refreshDiagnosticRedactionOptions();
  return {
    secretValues: [...(redactionOptions.secretValues ?? [])],
    privatePathPrefixes: [...(redactionOptions.privatePathPrefixes ?? [])],
  };
}

export async function flushDiagnostics(): Promise<void> {
  await logger?.flush();
}
