import { createHash } from 'node:crypto';
import type {
  PartnerCitationResolutionT,
  PartnerEvidenceLocatorT,
} from '@kodax-space/space-ipc-schema';
import {
  partnerEvidenceSnapshotStore,
  type PartnerEvidenceSnapshotStore,
} from './partner-evidence-snapshot-store.js';
import { type PartnerKnowledgeSearchMatch } from './partner-knowledge-index.js';
import {
  partnerEvidenceMetadataStore,
  type PartnerCitationMetadataRecord,
  type PartnerEvidenceMetadataStore,
} from './partner-evidence-metadata-store.js';
import { partnerSourceStore, type PartnerSourceStore } from './partner-source-store.js';

export const PARTNER_CITATION_SCHEMA_GENERATION = 'project-source-citation-v1';
const MAX_CITATION_EXCERPT_CHARS = 1_200;

export interface PartnerCitationServiceDeps {
  readonly sourceStore?: PartnerSourceStore;
  readonly snapshots?: PartnerEvidenceSnapshotStore;
  readonly metadata?: PartnerEvidenceMetadataStore;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function citationId(record: Omit<PartnerCitationMetadataRecord, 'citationId'>): string {
  const identity = [
    'project-source',
    'builtin:project-source',
    record.sourceId,
    record.sourceVersionId,
    record.unitId,
    record.excerptStart,
    record.excerptEnd,
    record.excerptDigest,
    record.schemaGeneration,
  ].join('\0');
  return `cite_${createHash('sha256').update(identity).digest('hex')}`;
}

export function formatPartnerLocator(locator: PartnerEvidenceLocatorT): string {
  switch (locator.kind) {
    case 'text_line':
      return locator.startLine === locator.endLine
        ? `line ${locator.startLine}`
        : `lines ${locator.startLine}-${locator.endLine}`;
    case 'pdf_page':
      return `p. ${locator.page}`;
    case 'docx_paragraph':
      return locator.heading
        ? `paragraph ${locator.paragraph} · ${locator.heading}`
        : `paragraph ${locator.paragraph}`;
    case 'pptx_slide':
      return `slide ${locator.slide}`;
    case 'xlsx_range':
      return `${locator.sheet}!${locator.range}`;
    case 'file':
      return locator.reason === 'legacy' ? 'legacy file evidence' : 'file-level evidence';
  }
}

export class PartnerCitationService {
  private readonly sourceStore: PartnerSourceStore;
  private readonly snapshots: PartnerEvidenceSnapshotStore;
  private readonly metadata: PartnerEvidenceMetadataStore;

  constructor(deps: PartnerCitationServiceDeps = {}) {
    this.sourceStore = deps.sourceStore ?? partnerSourceStore;
    this.snapshots = deps.snapshots ?? partnerEvidenceSnapshotStore;
    this.metadata = deps.metadata ?? partnerEvidenceMetadataStore;
  }

  async create(
    projectRoot: string,
    match: PartnerKnowledgeSearchMatch,
    excerptStart = 0,
    excerptEnd = Math.min(match.text.length, MAX_CITATION_EXCERPT_CHARS),
  ): Promise<string> {
    const boundedStart = Math.max(0, Math.min(Math.trunc(excerptStart), match.text.length));
    const boundedEnd = Math.max(
      boundedStart,
      Math.min(
        Math.trunc(excerptEnd),
        match.text.length,
        boundedStart + MAX_CITATION_EXCERPT_CHARS,
      ),
    );
    const identity = {
      sourceId: match.sourceId,
      sourceVersionId: match.sourceVersionId,
      unitId: match.unitId,
      excerptStart: boundedStart,
      excerptEnd: boundedEnd,
      excerptDigest: sha256(match.text.slice(boundedStart, boundedEnd)),
      schemaGeneration: PARTNER_CITATION_SCHEMA_GENERATION,
    };
    const record: PartnerCitationMetadataRecord = {
      citationId: citationId(identity),
      ...identity,
    };
    await this.metadata.writeCitation(projectRoot, record);
    return record.citationId;
  }

  async resolve(
    projectRoot: string,
    _sessionId: string,
    opaqueCitationId: string,
  ): Promise<PartnerCitationResolutionT | null> {
    const record = await this.metadata
      .readCitation(projectRoot, opaqueCitationId)
      .catch(() => null);
    if (!record || record.schemaGeneration !== PARTNER_CITATION_SCHEMA_GENERATION) return null;
    const source = await this.sourceStore.getProjectSource(projectRoot, record.sourceId);
    const version = await this.sourceStore.getVersion(record.sourceVersionId);
    if (!source || !version || version.sourceId !== source.id) return null;

    try {
      const snapshot = await this.snapshots.read(version.snapshotRef);
      if (
        snapshot.sourceId !== source.id ||
        snapshot.sourceVersionId !== version.id ||
        snapshot.contentHash !== version.contentHash
      ) {
        throw new Error('snapshot identity mismatch');
      }
      const unit = snapshot.units.find((item) => item.id === record.unitId);
      if (!unit) throw new Error('snapshot unit missing');
      const start = Math.min(record.excerptStart, unit.text.length);
      const end = Math.min(record.excerptEnd, unit.text.length, start + MAX_CITATION_EXCERPT_CHARS);
      const excerpt = unit.text.slice(start, end);
      if (sha256(excerpt) !== record.excerptDigest) {
        throw new Error('snapshot excerpt digest mismatch');
      }
      const freshness =
        source.currentVersionId === version.id && source.ingestionStatus === 'ready'
          ? 'current'
          : 'stale';
      return {
        citationId: record.citationId,
        sourceId: source.id,
        sourceVersionId: version.id,
        sourceLabel: source.label,
        relativePath: unit.relativePath ?? source.path,
        locator: unit.locator,
        locatorLabel: formatPartnerLocator(unit.locator),
        excerpt,
        freshness,
        capturedAt: version.createdAt,
        accessDecision: {
          observation: {
            ownerRef: { kind: 'project-source', ownerId: source.id },
            versionId: version.id,
            liveAvailability: source.ingestionStatus === 'unavailable' ? 'missing' : freshness,
            originAccess: 'authorized',
            retainedSnapshotUse: 'permitted',
            retainedContentAvailability: 'present',
            observedAt: Date.now(),
          },
          decision: 'include',
          boundedReasonCode: 'retained_snapshot_permitted_present',
        },
      };
    } catch (error) {
      const retainedContentAvailability =
        error instanceof Error && /corrupt|checksum|digest|identity mismatch/i.test(error.message)
          ? 'corrupt'
          : 'missing';
      return {
        citationId: record.citationId,
        sourceId: source.id,
        sourceVersionId: version.id,
        sourceLabel: source.label,
        relativePath: source.path,
        locator: { kind: 'file', reason: 'legacy' },
        locatorLabel: 'retained evidence unavailable',
        excerpt: '',
        freshness: 'missing',
        capturedAt: version.createdAt,
        accessDecision: {
          observation: {
            ownerRef: { kind: 'project-source', ownerId: source.id },
            versionId: version.id,
            liveAvailability: source.ingestionStatus === 'unavailable' ? 'missing' : 'stale',
            originAccess: 'authorized',
            retainedSnapshotUse: 'permitted',
            retainedContentAvailability,
            observedAt: Date.now(),
          },
          decision: 'exclude',
          boundedReasonCode: `retained_content_${retainedContentAvailability}`,
        },
      };
    }
  }
}

export const partnerCitationService = new PartnerCitationService();
