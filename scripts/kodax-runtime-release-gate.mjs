import { readFileSync } from 'node:fs';
import path from 'node:path';

export const REQUIRED_INTEGRATION_CONFIG_RESILIENCE = 1;

export function assertKodaxRuntimeReleaseContract(
  sdkDir,
  requiredVersion = REQUIRED_INTEGRATION_CONFIG_RESILIENCE,
) {
  const packageFile = path.join(sdkDir, 'package.json');
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(packageFile, 'utf8'));
  } catch (error) {
    throw new Error(`[pack] Cannot read the installed KodaX package metadata at ${packageFile}.`, {
      cause: error,
    });
  }
  const packageVersion = String(metadata.version ?? '').trim() || '(unknown)';
  const actual = metadata.kodaxRuntimeContracts?.integrationConfigResilience;
  if (!Number.isSafeInteger(actual) || actual < requiredVersion) {
    throw new Error(
      `[pack] @kodax-ai/kodax@${packageVersion} does not declare ` +
        `integrationConfigResilience v${requiredVersion}. Publish the fixed KodaX ` +
        'candidate, update both Space manifests and package-lock.json to that exact ' +
        'version, then package again.',
    );
  }
  return {
    version: packageVersion,
    integrationConfigResilience: actual,
  };
}
