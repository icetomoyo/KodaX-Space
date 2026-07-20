import type { PartnerEvidenceLocatorT } from '@kodax-space/space-ipc-schema';

export const PARTNER_SOURCE_EXTRACTION_PROTOCOL_VERSION = 2 as const;
export const MAX_PARTNER_SOURCE_EXTRACTED_TEXT_CHARS = 180_000;
export const MAX_PARTNER_SOURCE_EXTRACTION_ERROR_CHARS = 300;
export const MAX_PARTNER_SOURCE_EVIDENCE_UNITS = 10_000;
export const MAX_PARTNER_SOURCE_EVIDENCE_UNIT_CHARS = 64_000;

export const PARTNER_SOURCE_EXTRACTION_FORMATS = ['PDF', 'DOCX', 'XLSX', 'PPTX'] as const;

export type PartnerSourceExtractionFormat = (typeof PARTNER_SOURCE_EXTRACTION_FORMATS)[number];

export interface PartnerSourceExtractionWorkerRequest {
  readonly version: typeof PARTNER_SOURCE_EXTRACTION_PROTOCOL_VERSION;
  readonly format: PartnerSourceExtractionFormat;
  readonly bytes: ArrayBuffer;
}

export interface PartnerSourceExtractionUnit {
  readonly id: string;
  readonly ordinal: number;
  readonly text: string;
  readonly locator: PartnerEvidenceLocatorT;
}

export interface PartnerSourceExtractionResult {
  readonly text: string;
  readonly units: readonly PartnerSourceExtractionUnit[];
  readonly warnings: readonly string[];
}

export type PartnerSourceExtractionWorkerResponse =
  | {
      readonly version: typeof PARTNER_SOURCE_EXTRACTION_PROTOCOL_VERSION;
      readonly ok: true;
      readonly format: PartnerSourceExtractionFormat;
      readonly text: string;
      readonly units: readonly PartnerSourceExtractionUnit[];
      readonly warnings: readonly string[];
    }
  | {
      readonly version: typeof PARTNER_SOURCE_EXTRACTION_PROTOCOL_VERSION;
      readonly ok: false;
      readonly error: string;
    };

export function isPartnerSourceExtractionFormat(
  value: unknown,
): value is PartnerSourceExtractionFormat {
  return (
    typeof value === 'string' &&
    (PARTNER_SOURCE_EXTRACTION_FORMATS as readonly string[]).includes(value)
  );
}
