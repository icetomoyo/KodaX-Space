export const PARTNER_EVIDENCE_OPEN_EVENT = 'kodax-space.partner-evidence.open';

const CITATION_PREFIX = '#kodax-cite-';

export function parsePartnerCitationHref(href: string | undefined): string | null {
  if (!href?.startsWith(CITATION_PREFIX)) return null;
  const citationId = href.slice(CITATION_PREFIX.length);
  return /^cite_[A-Za-z0-9_-]{8,128}$/.test(citationId) ? citationId : null;
}

export function openPartnerEvidence(citationId: string, trigger?: HTMLElement): void {
  window.dispatchEvent(
    new CustomEvent(PARTNER_EVIDENCE_OPEN_EVENT, {
      detail: { citationId, trigger },
    }),
  );
}
