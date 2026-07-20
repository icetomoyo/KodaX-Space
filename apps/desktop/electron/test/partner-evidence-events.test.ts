import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePartnerCitationHref } from '../../renderer/src/features/partner/partnerEvidenceEvents.js';

test('Partner citation links accept only the exact safe fragment shape', () => {
  assert.equal(
    parsePartnerCitationHref('#kodax-cite-cite_0123456789abcdef'),
    'cite_0123456789abcdef',
  );
  assert.equal(
    parsePartnerCitationHref('https://example.com/#kodax-cite-cite_0123456789abcdef'),
    null,
  );
  assert.equal(parsePartnerCitationHref('#kodax-cite-../../secret'), null);
  assert.equal(parsePartnerCitationHref('#KODAX-CITE-cite_0123456789abcdef'), null);
});
