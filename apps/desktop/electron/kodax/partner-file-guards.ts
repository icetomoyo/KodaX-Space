import { Buffer } from 'node:buffer';
import path from 'node:path';

const BLOCKED_SEGMENTS = new Set([
  '.git',
  '.ssh',
  '.aws',
  '.azure',
  '.docker',
  '.gcloud',
  '.gnupg',
  '.kube',
  '.terraform',
]);

const BLOCKED_FILENAMES = new Set([
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.vault-token',
  '_netrc',
  'application_default_credentials.json',
  'credentials',
  'credentials.json',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'service-account.json',
  'service_account.json',
  'terraform.tfstate',
]);

const BLOCKED_SECRET_EXTENSIONS = new Set(['.jks', '.key', '.keystore', '.p12', '.pem', '.pfx']);

/**
 * Reject paths that Partner must never write, even when workspace writes are
 * explicitly enabled. Callers remain responsible for traversal and symlink
 * containment checks.
 */
export function assertPartnerWritablePathNotSensitive(
  parts: readonly string[],
  label: string,
): void {
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (BLOCKED_SEGMENTS.has(lower)) {
      throw new Error(`${label} uses blocked segment: ${part.slice(0, 128)}`);
    }
  }

  const name = parts.at(-1)?.toLowerCase() ?? '';
  if (name === '.env' || name.startsWith('.env.') || BLOCKED_FILENAMES.has(name)) {
    throw new Error(`${label} uses blocked filename: ${name.slice(0, 128)}`);
  }
  const extension = path.posix.extname(name);
  if (BLOCKED_SECRET_EXTENSIONS.has(extension)) {
    throw new Error(`${label} uses blocked file type: ${extension}`);
  }
}

/** Decode canonical RFC 4648 base64 without Node's permissive character skipping. */
export function decodePartnerBase64Strict(
  value: string,
  maxBytes: number,
  label = 'base64Content',
): Buffer {
  const maxEncodedChars = Math.ceil(maxBytes / 3) * 4;
  // Bound the pre-normalization copy as well. MIME-style wrapping stays well
  // below this allowance while whitespace-only memory amplification does not.
  if (value.length > maxEncodedChars * 2 + 4096) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }
  const normalized = value.replace(/\s+/g, '');
  if (normalized.length > maxEncodedChars) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }
  if (
    normalized.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)
  ) {
    throw new Error(`invalid ${label}`);
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.length > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
  if (bytes.toString('base64') !== normalized) throw new Error(`invalid ${label}`);
  return bytes;
}
