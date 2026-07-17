import { formatPartnerDeliveryUri } from '@kodax-space/space-ipc-schema';

interface DeliveryReferenceLike {
  readonly id: string;
  readonly title: string;
  readonly relativePath: string;
}

function markdownLinkLabel(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/]/g, '\\]');
}

/** Canonical machine-readable line preserved inside the SDK's string tool-result contract. */
export function partnerDeliveryReferenceLine(delivery: DeliveryReferenceLike): string {
  return `Delivery reference: ${JSON.stringify({
    type: 'partner-delivery',
    id: delivery.id,
    title: delivery.title,
    relativePath: delivery.relativePath,
    uri: formatPartnerDeliveryUri(delivery.id),
  })}`;
}

/** Exact Markdown link the working agent should reuse in its user-facing completion. */
export function partnerDeliveryMarkdownLink(delivery: DeliveryReferenceLike): string {
  return `[${markdownLinkLabel(delivery.title)}](<${formatPartnerDeliveryUri(delivery.id)}>)`;
}
