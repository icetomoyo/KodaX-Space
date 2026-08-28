import {
  spaceRuntimeFailureDetailSchema,
  type SpaceRuntimeFailureDetailT,
} from '@kodax-space/space-ipc-schema';

export type RuntimeFailurePresentation = {
  readonly category:
    | 'auth'
    | 'rate_limit'
    | 'network'
    | 'model_unavailable'
    | 'bad_request'
    | 'server_error'
    | 'cancelled'
    | 'unknown';
  readonly retriable: boolean;
  readonly action?: 'retry' | 'open_provider_settings' | 'check_network' | 'change_model';
};

export type RuntimeFailureDetailParseResult = {
  readonly detail?: SpaceRuntimeFailureDetailT;
  readonly issuePaths: readonly string[];
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

type OptionalFailureFieldSchema = {
  safeParse(value: unknown):
    | { readonly success: true }
    | {
        readonly success: false;
        readonly error: {
          readonly issues: readonly { readonly path: readonly (string | number)[] }[];
        };
      };
};

const OPTIONAL_FAILURE_FIELDS = [
  ['httpStatus', spaceRuntimeFailureDetailSchema.shape.httpStatus],
  ['upstreamErrorCode', spaceRuntimeFailureDetailSchema.shape.upstreamErrorCode],
  ['requestId', spaceRuntimeFailureDetailSchema.shape.requestId],
  ['retryAfterMs', spaceRuntimeFailureDetailSchema.shape.retryAfterMs],
  ['contextTokens', spaceRuntimeFailureDetailSchema.shape.contextTokens],
] as const satisfies readonly (readonly [string, OptionalFailureFieldSchema])[];

function sanitizeOptionalField(
  source: Record<string, unknown>,
  candidate: Record<string, unknown>,
  field: string,
  schema: OptionalFailureFieldSchema,
): readonly string[] {
  if (source[field] === undefined) return [];
  const parsed = schema.safeParse(source[field]);
  if (parsed.success) return [];
  delete candidate[field];
  return parsed.error.issues.map((issue) => [field, ...issue.path].map(String).join('.'));
}

export function parseRuntimeFailureDetail(value: unknown): RuntimeFailureDetailParseResult {
  if (value === undefined) return { issuePaths: [] };
  const source = record(value);
  let candidate: unknown = value;
  const issuePaths: string[] = [];
  if (source !== undefined) {
    const sanitized: Record<string, unknown> = { ...source };
    for (const [field, schema] of OPTIONAL_FAILURE_FIELDS) {
      issuePaths.push(...sanitizeOptionalField(source, sanitized, field, schema));
    }
    candidate = sanitized;
  }
  const parsed = spaceRuntimeFailureDetailSchema.safeParse(candidate);
  if (parsed.success) return { detail: parsed.data, issuePaths };
  for (const issue of parsed.error.issues) {
    issuePaths.push(issue.path.length === 0 ? '$' : issue.path.join('.'));
  }
  return { issuePaths: [...new Set(issuePaths)] };
}

function providerFailurePresentation(
  code: SpaceRuntimeFailureDetailT['providerErrorCode'] | undefined,
  retryAfterMs?: number,
): RuntimeFailurePresentation | undefined {
  switch (code) {
    case 'credential_unavailable':
    case 'authentication_failed':
      return { category: 'auth', retriable: false, action: 'open_provider_settings' };
    case 'rate_limited':
      return retryAfterMs === undefined
        ? { category: 'rate_limit', retriable: false }
        : { category: 'rate_limit', retriable: true, action: 'retry' };
    case 'network_error':
    case 'tls_error':
    case 'request_timeout':
      return { category: 'network', retriable: true, action: 'check_network' };
    case 'provider_not_registered':
    case 'catalog_error':
    case 'endpoint_not_found':
    case 'protocol_mismatch':
      return { category: 'bad_request', retriable: false, action: 'open_provider_settings' };
    case 'model_not_found':
      return { category: 'model_unavailable', retriable: false, action: 'change_model' };
    case 'upstream_server_error':
      return { category: 'server_error', retriable: true, action: 'retry' };
    case 'resource_not_found':
    case 'request_build_failed':
    case 'upstream_client_error':
    case 'response_stream_error':
      return { category: 'bad_request', retriable: false };
    case 'context_capacity_exceeded':
      return { category: 'bad_request', retriable: false, action: 'change_model' };
    case 'cancelled':
      return { category: 'cancelled', retriable: false };
    case 'runtime_settlement_failed':
    case 'provider_error':
      return { category: 'unknown', retriable: false };
    default:
      return undefined;
  }
}

export function runtimeFailurePresentation(
  failureKind: unknown,
  providerErrorCode?: SpaceRuntimeFailureDetailT['providerErrorCode'],
  retryAfterMs?: number,
): RuntimeFailurePresentation {
  if (failureKind === 'provider_aborted') return { category: 'unknown', retriable: false };
  if (providerErrorCode === 'cancelled' && failureKind !== 'cancelled') {
    return { category: 'unknown', retriable: false };
  }
  const specific = providerFailurePresentation(providerErrorCode, retryAfterMs);
  if (specific !== undefined) return specific;
  if (providerErrorCode !== undefined) return { category: 'unknown', retriable: false };
  switch (failureKind) {
    case 'auth':
      return { category: 'auth', retriable: false, action: 'open_provider_settings' };
    case 'unknown_provider':
      return { category: 'bad_request', retriable: false, action: 'open_provider_settings' };
    case 'rate_limit':
      return { category: 'rate_limit', retriable: true, action: 'retry' };
    case 'network':
      return { category: 'network', retriable: true, action: 'check_network' };
    case 'not_found':
    case 'request':
    case 'invalid_response':
      return {
        category: 'bad_request',
        retriable: false,
        ...(failureKind === 'invalid_response'
          ? { action: 'open_provider_settings' as const }
          : {}),
      };
    case 'cancelled':
      return { category: 'cancelled', retriable: false };
    case 'context_capacity':
      return { category: 'bad_request', retriable: false, action: 'change_model' };
    default:
      return { category: 'unknown', retriable: false };
  }
}

export function runtimeRetryAvailableAt(
  occurredAt: string | number | undefined,
  retryAfterMs: number | undefined,
): number | undefined {
  if (retryAfterMs === undefined) return undefined;
  const timestamp =
    typeof occurredAt === 'number'
      ? occurredAt
      : typeof occurredAt === 'string'
        ? Date.parse(occurredAt)
        : Number.NaN;
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) return undefined;
  return Math.min(Number.MAX_SAFE_INTEGER, timestamp + retryAfterMs);
}
