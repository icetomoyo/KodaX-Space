export function createPackagedShellProbeToolInput(command, platform = process.platform) {
  // The SDK timeout covers Windows sandbox authorization, execution, and Job-drain attestation.
  return platform === 'win32' ? { command, timeout: 180 } : { command };
}
