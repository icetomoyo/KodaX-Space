import { promises as fs } from 'node:fs';
import { canonProjectRoot, type PartnerProjectSourceT } from '@kodax-space/space-ipc-schema';
import { registerChannel } from './register.js';
import { projectStore } from '../projects/store.js';
import { resolveInsideProject, toPosixRelative } from './files-core.js';
import { kodaxHost } from '../kodax/host.js';
import { adminPolicyAuditStore } from '../kodax/admin-policy-audit-store.js';
import { partnerKbStore } from '../kodax/partner-kb-store.js';
import { partnerSourceStore } from '../kodax/partner-source-store.js';
import { partnerSourceIngestion } from '../kodax/partner-source-ingestion.js';
import { partnerCitationService } from '../kodax/partner-citation-service.js';
import { partnerContextBroker } from '../kodax/partner-context-broker.js';
import { partnerKnowledgeFeatures } from '../kodax/partner-knowledge-features.js';
import { loadPersistedSession, sdkTagToSurface } from '../kodax/session-store.js';

const IS_WIN = process.platform === 'win32';
const SOURCE_HEALTH_SCAN_CONCURRENCY = 8;

async function inspectCatalogSources(
  projectRoot: string,
  sources: readonly PartnerProjectSourceT[],
): Promise<PartnerProjectSourceT[]> {
  const inspected = new Array<PartnerProjectSourceT>(sources.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < sources.length) {
      const index = nextIndex;
      nextIndex += 1;
      const source = sources[index]!;
      const updated = await partnerSourceIngestion
        .inspectFreshness(projectRoot, source.id)
        .catch(() => source);
      inspected[index] = { ...updated, selected: source.selected };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SOURCE_HEALTH_SCAN_CONCURRENCY, sources.length) }, () =>
      worker(),
    ),
  );
  return inspected;
}

async function assertPartnerSession(sessionId: string, projectRoot?: string): Promise<void> {
  const session = kodaxHost.get(sessionId);
  if (session) {
    if (session.surface !== 'partner') {
      throw new Error(`session ${sessionId} is not a Partner session`);
    }
    if (
      projectRoot !== undefined &&
      canonProjectRoot(session.projectRoot, IS_WIN) !== canonProjectRoot(projectRoot, IS_WIN)
    ) {
      throw new Error('source projectRoot does not match the Partner session projectRoot');
    }
    return;
  }
  const persisted = await loadPersistedSession(sessionId);
  if (!persisted || sdkTagToSurface(persisted.tag) !== 'partner') {
    throw new Error(`session ${sessionId} is not a Partner session`);
  }
  const persistedRoot = persisted.runtimeInfo?.workspaceRoot ?? persisted.gitRoot;
  if (
    projectRoot !== undefined &&
    (!persistedRoot ||
      canonProjectRoot(persistedRoot, IS_WIN) !== canonProjectRoot(projectRoot, IS_WIN))
  ) {
    throw new Error('source projectRoot does not match the Partner session projectRoot');
  }
}

export function registerPartnerSourceChannels(): void {
  registerChannel('partner.sources.list', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    await assertPartnerSession(input.sessionId, validatedRoot);
    const sources = await partnerSourceStore.list(input.sessionId);
    return {
      sources: sources.filter(
        (source) =>
          canonProjectRoot(source.projectRoot, IS_WIN) === canonProjectRoot(validatedRoot, IS_WIN),
      ),
    };
  });

  registerChannel('partner.sources.add', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    await assertPartnerSession(input.sessionId, validatedRoot);
    const realRoot = await fs.realpath(validatedRoot);
    const absPath = await resolveInsideProject(validatedRoot, input.path);
    const stat = await fs.stat(absPath);
    const actualTargetKind = stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : null;
    if (actualTargetKind === null) {
      throw new Error('Partner sources must be regular files or directories');
    }
    if (input.targetKind !== undefined && input.targetKind !== actualTargetKind) {
      throw new Error(
        `source targetKind mismatch: expected ${input.targetKind}, got ${actualTargetKind}`,
      );
    }
    const source = await partnerSourceStore.addWorkspacePath({
      sessionId: input.sessionId,
      projectRoot: validatedRoot,
      path: toPosixRelative(absPath, realRoot),
      targetKind: actualTargetKind,
      ...(input.label !== undefined ? { label: input.label } : {}),
    });
    await partnerKbStore.upsertSourceReference(source);
    await adminPolicyAuditStore.record({
      category: 'source',
      action: 'source.attach',
      outcome: 'allowed',
      projectRoot: validatedRoot,
      sessionId: input.sessionId,
      resource: source.path,
      details: { sourceId: source.id, targetKind: source.targetKind, kind: source.kind },
    });
    if (partnerKnowledgeFeatures.fts5Index) {
      void partnerSourceIngestion.refresh(validatedRoot, source.id).catch((error) => {
        console.warn(
          `[partner-sources] background ingestion failed for ${source.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
    return { source };
  });

  registerChannel('partner.sources.remove', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    await assertPartnerSession(input.sessionId, validatedRoot);
    const existing = (await partnerSourceStore.list(input.sessionId)).find(
      (source) => source.id === input.sourceId,
    );
    if (
      !existing ||
      canonProjectRoot(existing.projectRoot, IS_WIN) !== canonProjectRoot(validatedRoot, IS_WIN)
    ) {
      return { removed: false };
    }
    const removed = await partnerSourceStore.remove(input.sessionId, input.sourceId);
    if (removed) {
      await adminPolicyAuditStore.record({
        category: 'source',
        action: 'source.remove',
        outcome: 'allowed',
        sessionId: input.sessionId,
        resource: existing?.path ?? input.sourceId,
        details: { sourceId: input.sourceId },
        ...(existing?.projectRoot ? { projectRoot: existing.projectRoot } : {}),
      });
    }
    return { removed };
  });

  registerChannel('partner.sources.catalog', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    if (input.sessionId) await assertPartnerSession(input.sessionId, validatedRoot);
    const catalog = await partnerSourceStore.catalog(validatedRoot, input.sessionId);
    const sources = await inspectCatalogSources(validatedRoot, catalog.slice(0, 512));
    if (partnerKnowledgeFeatures.fts5Index) {
      for (const source of sources) {
        if (source.ingestionStatus !== 'pending' && source.ingestionStatus !== 'stale') continue;
        void partnerSourceIngestion.refresh(validatedRoot, source.id).catch((error) => {
          console.warn(
            `[partner-sources] migrated source ingestion failed for ${source.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      }
    }
    return { sources, truncated: catalog.length > sources.length };
  });

  registerChannel('partner.sources.select', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    await assertPartnerSession(input.sessionId, validatedRoot);
    const source = await partnerSourceStore.select(
      input.sessionId,
      validatedRoot,
      input.sourceId,
      input.selected,
    );
    if (!source) throw new Error(`Unknown Partner source: ${input.sourceId}`);
    await adminPolicyAuditStore.record({
      category: 'source',
      action: input.selected ? 'source.select' : 'source.detach',
      outcome: 'allowed',
      projectRoot: validatedRoot,
      sessionId: input.sessionId,
      details: { sourceId: source.id },
    });
    return { source };
  });

  registerChannel('partner.sources.refresh', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    const result = await partnerSourceIngestion.refresh(validatedRoot, input.sourceId);
    return { source: result.source };
  });

  registerChannel('partner.materials.catalog', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    if (input.sessionId) await assertPartnerSession(input.sessionId, validatedRoot);
    const catalog = await partnerSourceStore.catalogMaterials(validatedRoot, input.sessionId);
    return {
      ...catalog,
      ...(input.sessionId
        ? {
            scope: await partnerSourceStore.getScope(input.sessionId, validatedRoot),
            latestTrace:
              (await partnerContextBroker.readLatestTrace(validatedRoot, input.sessionId)) ??
              undefined,
          }
        : {}),
    };
  });

  registerChannel('partner.materials.select', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    await assertPartnerSession(input.sessionId, validatedRoot);
    const selection = await partnerSourceStore.selectMaterial(
      input.sessionId,
      validatedRoot,
      input.materialRelationId,
      input.selected,
      input.version,
    );
    return { selection };
  });

  registerChannel('partner.materials.adopt', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    await assertPartnerSession(input.sessionId, validatedRoot);
    if (input.target.kind !== 'project-source') {
      throw new Error('This evidence owner adapter is not registered in v0.1.34');
    }
    const relation = await partnerSourceStore.adoptMaterial(validatedRoot, input.target);
    return { relation };
  });

  registerChannel('partner.materials.remove', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    await assertPartnerSession(input.sessionId, validatedRoot);
    const relation = await partnerSourceStore.removeMaterial(
      validatedRoot,
      input.materialRelationId,
      input.reasonCode,
    );
    await adminPolicyAuditStore.record({
      category: 'source',
      action: 'material.remove',
      outcome: 'allowed',
      projectRoot: validatedRoot,
      sessionId: input.sessionId,
      details: { materialRelationId: relation.id, targetKind: relation.target.kind },
    });
    return { relation };
  });

  registerChannel('partner.knowledge.scope.set', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    await assertPartnerSession(input.sessionId, validatedRoot);
    return {
      scope: await partnerSourceStore.setScope(input.sessionId, validatedRoot, input.scope),
    };
  });

  registerChannel('partner.knowledge.trace.read', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    await assertPartnerSession(input.sessionId, validatedRoot);
    return {
      trace: await partnerContextBroker.readTrace(validatedRoot, input.sessionId, input.traceId),
    };
  });

  registerChannel('partner.citations.resolve', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    await assertPartnerSession(input.sessionId, validatedRoot);
    return {
      citation: partnerKnowledgeFeatures.citations
        ? await partnerCitationService.resolve(validatedRoot, input.sessionId, input.citationId)
        : null,
    };
  });
}
