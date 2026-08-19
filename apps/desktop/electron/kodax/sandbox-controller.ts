import {
  MAX_SANDBOX_DIAGNOSTICS,
  MAX_SANDBOX_GUIDANCE,
  MAX_SANDBOX_STATUS_TEXT,
  type SandboxLastOperationT,
  type SandboxStatusT,
} from '@kodax-space/space-ipc-schema';

export interface SandboxDoctorResult {
  readonly ready: boolean;
  readonly platform: NodeJS.Platform;
  readonly version: string;
  readonly diagnostics: readonly string[];
  readonly setupRequired: boolean;
}

export interface SandboxCapability {
  readonly version: 4;
  readonly asrtVersion: string;
  readonly platform: 'darwin' | 'linux' | 'win32';
  readonly backend:
    'windows-restricted-user' | 'macos-seatbelt' | 'linux-bubblewrap' | 'unsupported';
  readonly genericCommandExecution: true;
  readonly controls: readonly ['filesystem', 'network', 'environment', 'timeout', 'output'];
  readonly ordinaryCallsTriggerSetup: false;
  readonly setupMayElevate: boolean;
  readonly unavailableBehavior: 'structured-no-execution';
  readonly permissionFallback: 'normal-permission-policy';
}

export interface SandboxSetupOutcome {
  readonly status: 'ready' | 'cancelled' | 'unavailable';
  readonly attempted: boolean;
  readonly doctor: SandboxDoctorResult;
  readonly guidance: readonly string[];
  readonly error?: string;
}

export interface SandboxSdkFacade {
  readonly getKodaXSandboxCapability: () => unknown;
  readonly doctorKodaXSandbox: (options?: { readonly refresh?: boolean }) => Promise<unknown>;
  readonly getKodaXSandboxSetupGuidance: (doctor: SandboxDoctorResult) => unknown;
  readonly activateKodaXSandbox: (options?: {
    readonly allowElevation?: boolean;
  }) => Promise<unknown>;
}

export interface SandboxControllerOptions {
  readonly loadSdk: () => Promise<SandboxSdkFacade>;
  readonly onDoctor?: (capability: SandboxCapability, doctor: SandboxDoctorResult) => void;
  readonly now?: () => Date;
}

export interface SandboxSetupRequest {
  readonly expectedRevision: number;
  readonly confirmation: 'allow-sandbox-setup';
}

const MAX_SANDBOX_RAW_TEXT = 4_096;

function compactText(value: string): string {
  return value
    .slice(0, MAX_SANDBOX_RAW_TEXT)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SANDBOX_STATUS_TEXT);
}

export function isWindowsAclRecoveryText(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('acl_cleanup_unconfirmed') ||
    (normalized.includes('windows sandbox') &&
      (normalized.includes('acl cleanup') ||
        normalized.includes('acl recovery') ||
        normalized.includes('poison marker') ||
        normalized.includes('boot identity') ||
        normalized.includes('process tree')))
  );
}

function safeDiagnostic(value: string): string {
  const normalized = compactText(value).toLowerCase();
  if (isWindowsAclRecoveryText(normalized)) {
    return 'Windows sandbox ACL cleanup is unconfirmed.';
  }
  if (
    normalized.includes('account') ||
    normalized.includes('sandbox user') ||
    normalized.includes('sandbox group')
  ) {
    return 'Windows sandbox account is not fully provisioned.';
  }
  if (
    normalized.includes('wfp') ||
    normalized.includes('network') ||
    normalized.includes('egress') ||
    normalized.includes('firewall')
  ) {
    return 'The sandbox network policy is not ready.';
  }
  if (
    normalized.includes('javascript skill interpreter') ||
    normalized.includes('node interpreter')
  ) {
    return 'The sandbox JavaScript interpreter is unavailable.';
  }
  if (
    normalized.includes('enoent') ||
    normalized.includes('not found') ||
    normalized.includes('missing') ||
    normalized.includes('bubblewrap') ||
    normalized.includes('bwrap') ||
    normalized.includes('socat') ||
    normalized.includes('ripgrep') ||
    normalized.includes('sandbox-exec') ||
    normalized.includes('seatbelt') ||
    normalized.includes('helper')
  ) {
    return 'A required sandbox dependency is unavailable.';
  }
  if (normalized.includes('unsupported') || normalized.includes('not supported')) {
    return 'The current platform does not support the KodaX command sandbox.';
  }
  return 'The sandbox readiness check reported an unavailable component.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCapability(value: unknown): SandboxCapability {
  if (!isRecord(value)) {
    throw new Error('Sandbox capability is unavailable.');
  }
  const controls = value.controls;
  const validControls =
    Array.isArray(controls) &&
    controls.length === 5 &&
    controls[0] === 'filesystem' &&
    controls[1] === 'network' &&
    controls[2] === 'environment' &&
    controls[3] === 'timeout' &&
    controls[4] === 'output';
  const validPlatform =
    value.platform === 'darwin' || value.platform === 'linux' || value.platform === 'win32';
  const validBackend =
    value.backend === 'windows-restricted-user' ||
    value.backend === 'macos-seatbelt' ||
    value.backend === 'linux-bubblewrap' ||
    value.backend === 'unsupported';
  if (
    value.version !== 4 ||
    typeof value.asrtVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(value.asrtVersion) ||
    !validPlatform ||
    !validBackend ||
    value.genericCommandExecution !== true ||
    !validControls ||
    value.ordinaryCallsTriggerSetup !== false ||
    typeof value.setupMayElevate !== 'boolean' ||
    value.unavailableBehavior !== 'structured-no-execution' ||
    value.permissionFallback !== 'normal-permission-policy'
  ) {
    throw new Error('Sandbox capability is incompatible.');
  }
  return value as unknown as SandboxCapability;
}

function normalizeDoctor(value: unknown): SandboxDoctorResult | null {
  if (
    !isRecord(value) ||
    typeof value.ready !== 'boolean' ||
    typeof value.platform !== 'string' ||
    typeof value.version !== 'string' ||
    !Array.isArray(value.diagnostics) ||
    typeof value.setupRequired !== 'boolean'
  ) {
    return null;
  }
  const diagnostics = value.diagnostics.slice(0, 99);
  if (!diagnostics.every((diagnostic) => typeof diagnostic === 'string')) {
    return null;
  }
  return {
    ready: value.ready,
    platform: value.platform as NodeJS.Platform,
    version: value.version,
    diagnostics,
    setupRequired: value.setupRequired,
  };
}

function normalizeActivation(
  value: unknown,
): Pick<SandboxSetupOutcome, 'status' | 'attempted'> | null {
  if (
    !isRecord(value) ||
    (value.status !== 'ready' && value.status !== 'cancelled' && value.status !== 'unavailable') ||
    typeof value.attempted !== 'boolean'
  ) {
    return null;
  }
  return {
    status: value.status,
    attempted: value.attempted,
  };
}

function projectGuidanceLine(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = compactText(value).toLowerCase();
  if (isWindowsAclRecoveryText(normalized) || normalized.includes('acl recover --force --json')) {
    return 'Restart Windows, then refresh sandbox readiness. If recovery is still blocked, stop every KodaX and KodaX Space process, run `kodax sandbox doctor`, and follow its ACL recovery command.';
  }
  if (normalized.includes('terminal') && normalized.includes('administrator')) {
    return 'The terminal does not need to run as Administrator; approve UAC only after the explicit Setup action.';
  }
  if (normalized.includes('uac') || normalized.includes('sandbox account')) {
    return 'The explicit Windows Setup action may request one-time UAC approval for the sandbox account and network policy.';
  }
  if (normalized.includes('homebrew') || normalized.includes('brew install')) {
    return 'Homebrew: brew install ripgrep';
  }
  if (normalized.includes('debian') || normalized.includes('ubuntu')) {
    return 'Debian/Ubuntu: sudo apt install bubblewrap socat ripgrep';
  }
  if (normalized.includes('fedora') || normalized.includes('rhel')) {
    return 'Fedora/RHEL: sudo dnf install bubblewrap socat ripgrep';
  }
  if (normalized.includes('arch linux') || normalized.includes('pacman')) {
    return 'Arch Linux: sudo pacman -S bubblewrap socat ripgrep';
  }
  if (normalized.includes('seatbelt') || normalized.includes('sandbox-exec')) {
    return 'KodaX uses macOS Seatbelt; install ripgrep, then refresh the readiness check.';
  }
  if (
    normalized.includes('bubblewrap') ||
    normalized.includes('socat') ||
    normalized.includes('ripgrep')
  ) {
    return 'KodaX uses bubblewrap on Linux; install bubblewrap, socat, and ripgrep, then refresh the readiness check.';
  }
  if (normalized.includes('active') || normalized.includes('ready')) {
    return 'KodaX command sandbox is ready.';
  }
  return null;
}

function defaultGuidance(
  capability: SandboxCapability,
  readiness: SandboxStatusT['readiness'],
  windowsAclRecoveryBlocked = false,
): readonly string[] {
  if (readiness === 'ready') {
    return [`KodaX command sandbox is ready with ASRT ${capability.asrtVersion}.`];
  }
  if (capability.platform === 'win32') {
    if (windowsAclRecoveryBlocked) {
      return [
        'Restart Windows, then refresh sandbox readiness. If recovery is still blocked, stop every KodaX and KodaX Space process, run `kodax sandbox doctor`, and follow its ACL recovery command.',
      ];
    }
    return [
      'Use the explicit Setup action to provision the one-time Windows sandbox account and network policy.',
      'The terminal does not need to run as Administrator; approve UAC only after the explicit Setup action.',
    ];
  }
  if (capability.platform === 'darwin') {
    return [
      'KodaX uses macOS Seatbelt; install ripgrep, then refresh the readiness check.',
      'Homebrew: brew install ripgrep',
    ];
  }
  if (capability.platform === 'linux') {
    return [
      'KodaX uses bubblewrap on Linux; install bubblewrap, socat, and ripgrep, then refresh the readiness check.',
      'Use the supported package manager for this host; Space never runs sudo or a package manager automatically.',
    ];
  }
  return ['The KodaX command sandbox is unavailable on this platform.'];
}

function operationForReadiness(
  kind: 'refresh' | 'setup',
  readiness: SandboxStatusT['readiness'],
  attempted: boolean,
): SandboxLastOperationT {
  return {
    kind,
    outcome:
      readiness === 'ready'
        ? 'ready'
        : readiness === 'setup-required'
          ? 'setup-required'
          : 'unavailable',
    attempted,
  };
}

export class SandboxController {
  readonly #loadSdk: () => Promise<SandboxSdkFacade>;
  readonly #onDoctor:
    ((capability: SandboxCapability, doctor: SandboxDoctorResult) => void) | undefined;
  readonly #now: () => Date;
  #sdkPromise: Promise<SandboxSdkFacade> | null = null;
  #status: SandboxStatusT | null = null;
  #operationTail: Promise<void> = Promise.resolve();

  constructor(options: SandboxControllerOptions) {
    this.#loadSdk = options.loadSdk;
    this.#onDoctor = options.onDoctor;
    this.#now = options.now ?? (() => new Date());
  }

  status(): Promise<SandboxStatusT> {
    return this.#serialize(async () => {
      if (this.#status !== null) return this.#status;
      return this.#runDoctor(false, null);
    });
  }

  refresh(): Promise<SandboxStatusT> {
    return this.#serialize(async () => {
      const result = await this.#runDoctor(true, null);
      const lastOperation = operationForReadiness('refresh', result.readiness, true);
      this.#status = { ...result, lastOperation };
      return this.#status;
    });
  }

  setup(request: SandboxSetupRequest): Promise<SandboxStatusT> {
    return this.#serialize(async () => {
      const current = this.#status ?? (await this.#runDoctor(false, null));
      if (request.expectedRevision !== current.revision) {
        throw new Error(
          'Sandbox readiness changed before setup; refresh the status and confirm again.',
        );
      }
      if (!current.setup.canSetup) {
        throw new Error('Sandbox setup is not available for the current platform or readiness.');
      }

      const preflight = await this.#runDoctor(true, null);
      if (!preflight.setup.canSetup) {
        this.#status = {
          ...preflight,
          lastOperation: {
            kind: 'setup',
            outcome: preflight.readiness === 'ready' ? 'not-needed' : 'unavailable',
            attempted: false,
            ...(preflight.readiness === 'ready'
              ? {}
              : { message: 'Sandbox setup was not started because preflight is unavailable.' }),
          },
        };
        return this.#status;
      }

      const sdk = await this.#sdk();
      let activation: Pick<SandboxSetupOutcome, 'status' | 'attempted'>;
      try {
        const rawActivation = await sdk.activateKodaXSandbox({ allowElevation: true });
        const normalizedActivation = normalizeActivation(rawActivation);
        if (normalizedActivation === null) {
          throw new Error('Sandbox activation returned an incompatible result.');
        }
        activation = normalizedActivation;
      } catch {
        const verified = await this.#runDoctor(true, null);
        this.#status = {
          ...verified,
          lastOperation: {
            kind: 'setup',
            outcome: verified.readiness === 'ready' ? 'ready' : 'failed',
            attempted: true,
            message:
              verified.readiness === 'ready'
                ? 'The activation helper failed, but a fresh readiness check confirms the sandbox is ready.'
                : 'Sandbox setup failed. Review the guidance and try again.',
          },
        };
        return this.#status;
      }

      const verified = await this.#runDoctor(true, null);
      if (verified.readiness === 'ready') {
        this.#status = {
          ...verified,
          lastOperation: {
            kind: 'setup',
            outcome: 'ready',
            attempted: activation.attempted,
            ...(activation.status === 'cancelled'
              ? {
                  message:
                    'Setup was cancelled, but a fresh readiness check confirms the sandbox is ready.',
                }
              : activation.status === 'unavailable'
                ? {
                    message:
                      'The activation helper reported unavailable, but a fresh readiness check confirms the sandbox is ready.',
                  }
                : {}),
          },
        };
        return this.#status;
      }
      if (activation.status === 'cancelled') {
        this.#status = {
          ...verified,
          lastOperation: {
            kind: 'setup',
            outcome: 'cancelled',
            attempted: activation.attempted,
            message: 'Sandbox setup was cancelled.',
          },
        };
        return this.#status;
      }

      this.#status = {
        ...verified,
        lastOperation: {
          kind: 'setup',
          outcome: 'unavailable',
          attempted: activation.attempted,
          message: 'Sandbox setup did not produce a ready doctor result.',
        },
      };
      return this.#status;
    });
  }

  #sdk(): Promise<SandboxSdkFacade> {
    this.#sdkPromise ??= this.#loadSdk().catch(() => {
      this.#sdkPromise = null;
      throw new Error('Sandbox SDK is unavailable.');
    });
    return this.#sdkPromise;
  }

  async #runDoctor(
    refresh: boolean,
    lastOperation: SandboxLastOperationT | null,
  ): Promise<SandboxStatusT> {
    const sdk = await this.#sdk();
    let capability: SandboxCapability;
    try {
      capability = normalizeCapability(sdk.getKodaXSandboxCapability());
    } catch {
      throw new Error('Sandbox capability is unavailable.');
    }
    let doctor: SandboxDoctorResult;
    try {
      doctor =
        normalizeDoctor(await sdk.doctorKodaXSandbox({ refresh })) ??
        ({
          ready: false,
          platform: capability.platform,
          version: capability.asrtVersion,
          diagnostics: ['Sandbox doctor returned an incompatible result.'],
          setupRequired: false,
        } satisfies SandboxDoctorResult);
    } catch {
      doctor = {
        ready: false,
        platform: capability.platform,
        version: capability.asrtVersion,
        diagnostics: ['Sandbox doctor could not complete.'],
        setupRequired: false,
      };
    }

    const compatibleDoctor =
      doctor.platform === capability.platform && doctor.version === capability.asrtVersion;
    const projectedDoctor = compatibleDoctor
      ? doctor
      : {
          ...doctor,
          ready: false,
          setupRequired: false,
          diagnostics: [
            ...doctor.diagnostics,
            'Sandbox doctor returned incompatible runtime metadata.',
          ],
        };
    try {
      this.#onDoctor?.(capability, projectedDoctor);
    } catch {
      throw new Error('Sandbox readiness projection could not be updated.');
    }
    const readiness: SandboxStatusT['readiness'] = projectedDoctor.ready
      ? 'ready'
      : projectedDoctor.setupRequired
        ? 'setup-required'
        : 'unavailable';

    const rawDiagnostics = projectedDoctor.diagnostics;
    const windowsAclRecoveryBlocked = rawDiagnostics.some(isWindowsAclRecoveryText);
    const diagnostics = [...new Set(rawDiagnostics.map(safeDiagnostic))].slice(
      0,
      MAX_SANDBOX_DIAGNOSTICS,
    );
    if (readiness === 'unavailable' && diagnostics.length === 0) {
      diagnostics.push('The sandbox readiness check reported an unavailable component.');
    }

    let rawGuidance: readonly unknown[];
    try {
      const guidanceValue = sdk.getKodaXSandboxSetupGuidance(projectedDoctor);
      rawGuidance = Array.isArray(guidanceValue)
        ? guidanceValue.slice(0, MAX_SANDBOX_GUIDANCE * 2)
        : [];
    } catch {
      rawGuidance = [];
    }
    const guidance = [
      ...new Set(
        rawGuidance.map(projectGuidanceLine).filter((line): line is string => line !== null),
      ),
    ].slice(0, MAX_SANDBOX_GUIDANCE);
    if (guidance.length === 0) {
      guidance.push(...defaultGuidance(capability, readiness, windowsAclRecoveryBlocked));
    }

    const canSetup =
      readiness === 'setup-required' &&
      capability.platform === 'win32' &&
      capability.backend === 'windows-restricted-user' &&
      capability.setupMayElevate;
    const status: SandboxStatusT = {
      contractVersion: 1,
      sandboxVersion: capability.version,
      asrtVersion: capability.asrtVersion,
      platform: capability.platform,
      backend: capability.backend,
      readiness,
      setup: {
        canSetup,
        mayElevate: capability.setupMayElevate,
        requiresElevation: canSetup,
      },
      diagnosticCount: Math.min(99, Math.max(rawDiagnostics.length, diagnostics.length)),
      diagnostics,
      guidance,
      revision: (this.#status?.revision ?? 0) + 1,
      checkedAt: this.#now().toISOString(),
      lastOperation,
    };
    this.#status = status;
    return status;
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#operationTail.then(operation, operation);
    this.#operationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
