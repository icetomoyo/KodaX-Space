import { existsSync } from 'node:fs';
import path from 'node:path';

export const TERMINAL_SHELL_PREFERENCES = [
  'auto',
  'pwsh',
  'powershell',
  'cmd',
  'bash',
  'zsh',
] as const;

export type TerminalShellPreference = (typeof TERMINAL_SHELL_PREFERENCES)[number];
export type ResolvedShellKind = Exclude<TerminalShellPreference, 'auto'> | 'sh' | 'other';

export interface ResolvedShell {
  readonly kind: ResolvedShellKind;
  readonly program: string;
  readonly args: readonly string[];
}

export interface ShellResolutionOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly exists?: (candidate: string) => boolean;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const direct = env[name];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const entry = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return typeof entry?.[1] === 'string' && entry[1].length > 0 ? entry[1] : undefined;
}

function classifyShell(program: string): ResolvedShellKind {
  const name = path.posix
    .basename(program.replace(/\\/g, '/'))
    .toLowerCase()
    .replace(/\.exe$/i, '');
  if (name === 'pwsh') return 'pwsh';
  if (name === 'powershell') return 'powershell';
  if (name === 'cmd') return 'cmd';
  if (name === 'bash') return 'bash';
  if (name === 'zsh') return 'zsh';
  if (name === 'sh') return 'sh';
  return 'other';
}

function shellArgs(kind: ResolvedShellKind): readonly string[] {
  if (kind === 'pwsh' || kind === 'powershell') return ['-NoLogo'];
  if (kind === 'bash' || kind === 'zsh') return ['-l'];
  return [];
}

function pathCandidates(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (pathApi.isAbsolute(command)) return [command];
  const rawPath = envValue(env, 'PATH') ?? '';
  const directories = rawPath.split(pathApi.delimiter).filter((entry) => entry.length > 0);
  if (platform !== 'win32') {
    return directories.map((directory) => pathApi.join(directory, command));
  }

  const extension = pathApi.extname(command);
  const extensions =
    extension.length > 0
      ? ['']
      : (envValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter((entry) => entry.length > 0);
  return directories.flatMap((directory) =>
    extensions.map((candidateExtension) =>
      pathApi.join(directory, `${command}${candidateExtension}`),
    ),
  );
}

function firstExisting(
  candidates: readonly (string | undefined)[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  exists: (candidate: string) => boolean,
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const expanded of pathCandidates(candidate, platform, env)) {
      if (exists(expanded)) return expanded;
    }
  }
  return undefined;
}

function windowsCandidates(
  preference: Exclude<TerminalShellPreference, 'auto'>,
  env: NodeJS.ProcessEnv,
): readonly (string | undefined)[] {
  const systemRoot = envValue(env, 'SystemRoot') ?? envValue(env, 'WINDIR') ?? 'C:\\Windows';
  const programFiles = envValue(env, 'ProgramFiles') ?? 'C:\\Program Files';
  const programFilesX86 = envValue(env, 'ProgramFiles(x86)') ?? 'C:\\Program Files (x86)';
  const localAppData = envValue(env, 'LocalAppData');
  const configuredShell = envValue(env, 'SHELL');
  const matchingConfiguredShell =
    configuredShell && classifyShell(configuredShell) === preference ? configuredShell : undefined;

  switch (preference) {
    case 'pwsh':
      return ['pwsh.exe'];
    case 'powershell':
      return [
        path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        'powershell.exe',
      ];
    case 'cmd':
      return [
        envValue(env, 'COMSPEC'),
        path.win32.join(systemRoot, 'System32', 'cmd.exe'),
        'cmd.exe',
      ];
    case 'bash':
      return [
        matchingConfiguredShell,
        'bash.exe',
        path.win32.join(programFiles, 'Git', 'bin', 'bash.exe'),
        path.win32.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
        localAppData
          ? path.win32.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe')
          : undefined,
      ];
    case 'zsh':
      return [matchingConfiguredShell, 'zsh.exe'];
  }
}

function posixCandidates(
  preference: Exclude<TerminalShellPreference, 'auto'>,
  env: NodeJS.ProcessEnv,
): readonly (string | undefined)[] {
  const configuredShell = envValue(env, 'SHELL');
  const matchingConfiguredShell =
    configuredShell && classifyShell(configuredShell) === preference ? configuredShell : undefined;
  switch (preference) {
    case 'pwsh':
      return ['pwsh'];
    case 'powershell':
      return ['powershell'];
    case 'cmd':
      return ['cmd'];
    case 'bash':
      return [matchingConfiguredShell, 'bash', '/bin/bash'];
    case 'zsh':
      return [matchingConfiguredShell, 'zsh', '/bin/zsh'];
  }
}

function resolveExplicitShell(
  preference: Exclude<TerminalShellPreference, 'auto'>,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  exists: (candidate: string) => boolean,
): ResolvedShell | undefined {
  const candidates =
    platform === 'win32' ? windowsCandidates(preference, env) : posixCandidates(preference, env);
  const program = firstExisting(candidates, platform, env, exists);
  if (!program) return undefined;
  const kind = classifyShell(program);
  return { kind, program, args: shellArgs(kind) };
}

export function resolveTerminalShell(
  preference: TerminalShellPreference = 'auto',
  options: ShellResolutionOptions = {},
): ResolvedShell {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;

  if (preference !== 'auto') {
    const explicit = resolveExplicitShell(preference, platform, env, exists);
    if (explicit) return explicit;
  }

  const configuredShell = envValue(env, 'SHELL');
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (configuredShell && pathApi.isAbsolute(configuredShell) && exists(configuredShell)) {
    const kind = classifyShell(configuredShell);
    // A Git/MSYS SHELL variable is common in Windows GUI processes, but its
    // POSIX PATH cannot safely initialize the native Coder daemon. Keep auto
    // mode native on Windows; Bash/Zsh remain available as explicit choices.
    if (
      kind !== 'other' &&
      kind !== 'sh' &&
      (platform !== 'win32' || kind === 'pwsh' || kind === 'powershell' || kind === 'cmd')
    ) {
      return { kind, program: configuredShell, args: shellArgs(kind) };
    }
  }

  const fallbackOrder: readonly Exclude<TerminalShellPreference, 'auto'>[] =
    platform === 'win32'
      ? ['pwsh', 'powershell', 'cmd']
      : platform === 'darwin'
        ? ['zsh', 'bash']
        : ['bash', 'zsh'];
  for (const candidate of fallbackOrder) {
    const resolved = resolveExplicitShell(candidate, platform, env, exists);
    if (resolved) return resolved;
  }

  return platform === 'win32'
    ? { kind: 'cmd', program: 'cmd.exe', args: [] }
    : { kind: 'sh', program: '/bin/sh', args: [] };
}
