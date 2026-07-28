import { getKodaxRuntimeDir } from './data-paths.js';

type SdkReplModule = typeof import('@kodax-ai/kodax/repl');
export type KodaxIntegrationMigrationPlan = ReturnType<
  SdkReplModule['planLegacyIntegrationMigration']
>;
export type KodaxIntegrationMigrationResult = ReturnType<
  SdkReplModule['migrateLegacyIntegrationConfig']
>;

let sdkReplCache: SdkReplModule | null = null;

async function loadSdkRepl(): Promise<SdkReplModule> {
  if (sdkReplCache === null) {
    sdkReplCache = await import('@kodax-ai/kodax/repl');
  }
  return sdkReplCache;
}

/**
 * Preview KodaX's own user-level migration plan. The renderer never chooses a
 * filesystem path: Space always targets the same config home as the SDK/CLI.
 */
export async function planKodaxIntegrationMigration(
  configHome = getKodaxRuntimeDir(),
): Promise<KodaxIntegrationMigrationPlan> {
  const sdk = await loadSdkRepl();
  return sdk.planLegacyIntegrationMigration(configHome);
}

/**
 * Create missing split integration files without deleting config.json fields.
 * The SDK refuses to overwrite an existing destination. Legacy cleanup remains
 * a separate, explicit CLI operation after the new sources have been verified.
 */
export async function applyKodaxIntegrationMigration(
  configHome = getKodaxRuntimeDir(),
): Promise<KodaxIntegrationMigrationResult> {
  const sdk = await loadSdkRepl();
  return sdk.migrateLegacyIntegrationConfig({
    configHome,
    cleanupLegacy: false,
  });
}
