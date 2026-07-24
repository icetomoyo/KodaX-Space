import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SERVICE_NAME = 'kodax-space';
const SECRET_ACCOUNT_RE =
  /^runtime_client_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_PROFILE_PREFIXES = ['kodax-test-', 'kodax-space-boot-smoke-'];
const MAX_IDENTITY_BYTES = 4 * 1024;

function isAllowedTestProfile(profileDir) {
  const resolvedProfile = path.resolve(profileDir);
  const resolvedTemp = path.resolve(os.tmpdir());
  const relative = path.relative(resolvedTemp, resolvedProfile);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  return ALLOWED_PROFILE_PREFIXES.some((prefix) =>
    path.basename(resolvedProfile).startsWith(prefix),
  );
}

async function readTestSecretAccount(profileDir) {
  if (!isAllowedTestProfile(profileDir)) return undefined;
  const identityPath = path.join(profileDir, 'space', 'runtime-client-identity.json');
  let bytes;
  try {
    bytes = await fs.readFile(identityPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
  if (bytes.byteLength > MAX_IDENTITY_BYTES) return undefined;
  let identity;
  try {
    identity = JSON.parse(bytes.toString('utf8'));
  } catch {
    return undefined;
  }
  return typeof identity?.secretAccount === 'string' &&
    SECRET_ACCOUNT_RE.test(identity.secretAccount)
    ? identity.secretAccount
    : undefined;
}

/**
 * Remove only the OS-keychain item named by an isolated test profile.
 *
 * Production profiles are rejected by path, and provider credentials are
 * rejected by the runtime-client account regex. This must run before the test
 * profile directory is deleted, otherwise the credential loses its owner
 * evidence and becomes impossible to clean safely.
 */
export async function cleanupRuntimeClientCredentialForTestProfile(profileDir, options = {}) {
  const account = await readTestSecretAccount(profileDir);
  if (account === undefined) return { cleaned: false, reason: 'not_found_or_not_test_profile' };
  if (options.deletePassword) {
    const cleaned = await options.deletePassword(SERVICE_NAME, account);
    return { cleaned, account };
  }
  const moduleId = '@napi-rs/keyring/keytar.js';
  const imported = await import(moduleId);
  const keyring = imported.default ?? imported;
  const cleaned = await keyring.deletePassword(SERVICE_NAME, account);
  return { cleaned, account };
}
