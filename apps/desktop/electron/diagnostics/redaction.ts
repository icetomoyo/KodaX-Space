const SENSITIVE_KEY =
  /(?:api.?key|token|secret|password|authorization|cookie|credential|private.?key)/i;
const SECRET_QUERY_KEY = /(?:key|token|secret|password|auth|signature|credential)/i;

const CONTENT_KEYS = new Set([
  'body',
  'clipboard',
  'content',
  'document',
  'documentbody',
  'documentcontent',
  'filecontent',
  'input',
  'inputartifact',
  'inputartifacts',
  'messagebody',
  'messagecontent',
  'messages',
  'originaltask',
  'output',
  'payload',
  'prompt',
  'promptcontent',
  'prompttext',
  'requestbody',
  'responsebody',
  'systemprompt',
  'toolinput',
  'tooloutput',
  'toolpayload',
  'transcript',
  'userprompt',
]);

export interface DiagnosticRedactionOptions {
  readonly secretValues?: readonly string[];
  readonly privatePathPrefixes?: readonly string[];
  readonly maxDepth?: number;
  readonly maxArrayItems?: number;
  readonly maxStringLength?: number;
  readonly maxObjectKeys?: number;
}

interface ResolvedOptions {
  readonly secretValues: readonly string[];
  readonly privatePathPrefixes: readonly string[];
  readonly maxDepth: number;
  readonly maxArrayItems: number;
  readonly maxStringLength: number;
  readonly maxObjectKeys: number;
}

function options(input: DiagnosticRedactionOptions): ResolvedOptions {
  return {
    secretValues: (input.secretValues ?? [])
      .filter((value) => value.length >= 6)
      .sort((a, b) => b.length - a.length),
    privatePathPrefixes: (input.privatePathPrefixes ?? [])
      .filter((value) => value.length >= 3)
      .sort((a, b) => b.length - a.length),
    maxDepth: Math.max(1, input.maxDepth ?? 6),
    maxArrayItems: Math.max(1, input.maxArrayItems ?? 64),
    maxStringLength: Math.max(8, input.maxStringLength ?? 4096),
    maxObjectKeys: Math.max(1, input.maxObjectKeys ?? 64),
  };
}

function replaceAllLiteral(input: string, value: string, replacement: string): string {
  if (!value) return input;
  return input.split(value).join(replacement);
}

function replaceAllLiteralCaseInsensitive(
  input: string,
  value: string,
  replacement: string,
): string {
  if (!value) return input;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return input.replace(new RegExp(escaped, 'gi'), replacement);
}

function isContentKey(key: string): boolean {
  return CONTENT_KEYS.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase());
}

function redactUrls(input: string): string {
  return input.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    try {
      const url = new URL(candidate);
      if (url.username) url.username = '[REDACTED]';
      if (url.password) url.password = '[REDACTED]';
      for (const key of [...url.searchParams.keys()]) {
        if (SECRET_QUERY_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
      }
      return url.toString();
    } catch {
      return '[REDACTED_URL]';
    }
  });
}

function truncate(input: string, maxLength: number): string {
  return input.length <= maxLength ? input : `${input.slice(0, maxLength)}...[truncated]`;
}

export function redactDiagnosticText(
  input: string,
  inputOptions: DiagnosticRedactionOptions = {},
): string {
  const resolved = options(inputOptions);
  let output = input
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/(authorization\s*[:=]\s*)(?!Bearer|Basic)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk|pk|api)[-_][A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]');
  output = redactUrls(output);
  for (const secret of resolved.secretValues) {
    output = replaceAllLiteral(output, secret, '[REDACTED]');
  }
  for (const prefix of resolved.privatePathPrefixes) {
    const variants = new Set([prefix, prefix.replaceAll('\\', '/'), prefix.replaceAll('/', '\\')]);
    for (const variant of variants) {
      output = replaceAllLiteralCaseInsensitive(output, variant, '[PRIVATE_PATH]');
    }
  }
  return truncate(output, resolved.maxStringLength);
}

export function redactDiagnosticValue(
  input: unknown,
  inputOptions: DiagnosticRedactionOptions = {},
): unknown {
  const resolved = options(inputOptions);
  const seen = new WeakSet<object>();

  const visit = (value: unknown, depth: number, key?: string): unknown => {
    if (key && isContentKey(key)) return '[CONTENT_REDACTED]';
    if (key && SENSITIVE_KEY.test(key)) return '[REDACTED]';
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return redactDiagnosticText(value, resolved);
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'undefined') return '[UNDEFINED]';
    if (typeof value === 'function') return '[FUNCTION]';
    if (typeof value === 'symbol') return '[SYMBOL]';
    if (depth >= resolved.maxDepth) return '[MAX_DEPTH]';

    if (value instanceof Error) {
      return {
        name: truncate(value.name || 'Error', 128),
        message: redactDiagnosticText(value.message, {
          ...resolved,
          maxStringLength: Math.max(256, resolved.maxStringLength),
        }),
      };
    }
    if (value instanceof Uint8Array) return `[BINARY ${value.byteLength} BYTES]`;
    if (typeof value !== 'object') return '[UNSUPPORTED]';
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);

    if (Array.isArray(value)) {
      const items = value.slice(0, resolved.maxArrayItems).map((item) => visit(item, depth + 1));
      if (value.length > resolved.maxArrayItems) {
        items.push(`[TRUNCATED ${value.length - resolved.maxArrayItems} ITEMS]`);
      }
      return items;
    }

    const result: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [entryKey, entryValue] of entries.slice(0, resolved.maxObjectKeys)) {
      result[truncate(entryKey, 128)] = visit(entryValue, depth + 1, entryKey);
    }
    if (entries.length > resolved.maxObjectKeys) {
      result.__truncatedKeys = entries.length - resolved.maxObjectKeys;
    }
    return result;
  };

  return visit(input, 0);
}
