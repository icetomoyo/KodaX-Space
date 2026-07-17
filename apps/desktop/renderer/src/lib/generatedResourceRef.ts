import { formatPartnerDeliveryUri, parsePartnerDeliveryUri } from '@kodax-space/space-ipc-schema';

export interface PartnerDeliveryToolResultRef {
  readonly id: string;
  readonly title: string;
  readonly relativePath: string | null;
  readonly uri: string;
}

interface CanonicalDeliveryReference {
  readonly type: 'partner-delivery';
  readonly id: string;
  readonly title: string;
  readonly relativePath: string;
  readonly uri: string;
}

/** Convert the Delivery mutation clock into a positive Artifact preview revision. */
export function partnerDeliveryPreviewVersion(updatedAt: number): number {
  return Number.isSafeInteger(updatedAt) && updatedAt > 0 ? updatedAt : 1;
}

function resultLine(result: string, label: string): string | null {
  const match = new RegExp(`^${label}:\\s*(.+)$`, 'm').exec(result);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

/**
 * Recover the stable generated-resource identity from both current and historical
 * write_partner_deliverable results. Historical results have a Delivery id but no URI.
 */
export function parsePartnerDeliveryToolResult(
  result: string,
): PartnerDeliveryToolResultRef | null {
  return parsePartnerDeliveryToolResults(result)[0] ?? null;
}

function parseCanonicalReference(raw: string): PartnerDeliveryToolResultRef | null {
  try {
    const value = JSON.parse(raw) as Partial<CanonicalDeliveryReference>;
    if (
      value.type !== 'partner-delivery' ||
      typeof value.id !== 'string' ||
      typeof value.title !== 'string' ||
      typeof value.relativePath !== 'string' ||
      typeof value.uri !== 'string' ||
      parsePartnerDeliveryUri(value.uri) !== value.id
    ) {
      return null;
    }
    return {
      id: value.id,
      title: value.title,
      relativePath: value.relativePath,
      uri: value.uri,
    };
  } catch {
    return null;
  }
}

/** Parse every Delivery produced by single-output and helper tools. */
export function parsePartnerDeliveryToolResults(
  result: string,
): readonly PartnerDeliveryToolResultRef[] {
  const canonical: PartnerDeliveryToolResultRef[] = [];
  for (const match of result.matchAll(/^Delivery reference:\s*(\{.*\})$/gm)) {
    const parsed = match[1] ? parseCanonicalReference(match[1]) : null;
    if (parsed && !canonical.some((item) => item.id === parsed.id)) canonical.push(parsed);
  }
  if (canonical.length > 0) return canonical;

  const id = resultLine(result, 'Delivery id');
  if (id) {
    const explicitUri = resultLine(result, 'Resource URI');
    const uri =
      explicitUri && parsePartnerDeliveryUri(explicitUri) === id
        ? explicitUri
        : formatPartnerDeliveryUri(id);
    return [
      {
        id,
        title:
          resultLine(result, 'Partner deliverable written') ??
          resultLine(result, 'Partner workspace file written') ??
          'Partner output',
        relativePath:
          resultLine(result, 'Relative path') ??
          resultLine(result, 'Partner workspace file written'),
        uri,
      },
    ];
  }

  const legacyHelperRefs: PartnerDeliveryToolResultRef[] = [];
  for (const match of result.matchAll(/^-\s+(pd_[^:\s]+):\s*(.+)$/gm)) {
    const legacyId = match[1]?.trim();
    const relativePath = match[2]?.trim();
    if (!legacyId || !relativePath || legacyHelperRefs.some((item) => item.id === legacyId))
      continue;
    const title = relativePath.replace(/\\/g, '/').split('/').pop() || 'Partner output';
    legacyHelperRefs.push({
      id: legacyId,
      title,
      relativePath,
      uri: formatPartnerDeliveryUri(legacyId),
    });
  }
  return legacyHelperRefs;
}
