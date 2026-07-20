import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  canonProjectRoot,
  partnerKnowledgeScopeSchema,
  partnerMaterialSelectionSchema,
  partnerProjectMaterialRelationSchema,
  partnerProjectSourceSchema,
  partnerSourceSchema,
  partnerSourceVersionSchema,
  type PartnerIngestionStatusT,
  type PartnerKnowledgeScopeT,
  type PartnerMaterialSelectionT,
  type PartnerProjectMaterialRelationT,
  type PartnerProjectMaterialTargetT,
  type PartnerProjectSourceT,
  type PartnerSourceT,
  type PartnerSourceVersionT,
} from '@kodax-space/space-ipc-schema';
import { replaceFileWithoutFollowingAliases } from './atomic-file.js';
import { getSpaceDataDir } from './data-paths.js';

const MAX_SOURCES_PER_SESSION = 128;
const MAX_PROJECT_SOURCES = 10_000;
const MAX_SOURCE_VERSIONS = 100_000;
const DEFAULT_SCOPE: PartnerKnowledgeScopeT = 'project-grounded';
const isWindows = process.platform === 'win32';

const v1FileSchema = z.object({
  version: z.literal(1),
  sources: z.array(partnerSourceSchema).max(MAX_PROJECT_SOURCES),
});

const projectSourceRecordSchema = partnerProjectSourceSchema.omit({ selected: true });
const selectionSchema = z.object({
  sessionId: z.string().min(1).max(128),
  projectRoot: z.string().min(1).max(4096),
  sourceId: z.string().min(1).max(128),
  selectedAt: z.number().int().nonnegative(),
});
const aliasSchema = z.object({
  legacySourceId: z.string().min(1).max(128),
  sourceId: z.string().min(1).max(128),
});
const scopeSchema = z.object({
  sessionId: z.string().min(1).max(128),
  projectRoot: z.string().min(1).max(4096),
  scope: partnerKnowledgeScopeSchema,
});
const v2FileSchema = z.object({
  version: z.literal(2),
  sources: z.array(projectSourceRecordSchema).max(MAX_PROJECT_SOURCES),
  versions: z.array(partnerSourceVersionSchema).max(MAX_SOURCE_VERSIONS),
  selections: z.array(selectionSchema).max(MAX_PROJECT_SOURCES * 8),
  aliases: z.array(aliasSchema).max(MAX_PROJECT_SOURCES),
  scopes: z.array(scopeSchema).max(MAX_PROJECT_SOURCES * 8),
  relations: z
    .array(partnerProjectMaterialRelationSchema)
    .max(MAX_PROJECT_SOURCES * 4)
    .default([]),
  materialSelections: z
    .array(partnerMaterialSelectionSchema)
    .max(MAX_PROJECT_SOURCES * 8)
    .default([]),
});

type PartnerSourceRecord = z.infer<typeof projectSourceRecordSchema>;
type PartnerSourcesState = z.infer<typeof v2FileSchema>;
type PartnerSourcePatch = Partial<
  Pick<
    PartnerSourceRecord,
    'path' | 'label' | 'ingestionStatus' | 'currentVersionId' | 'lastError' | 'updatedAt'
  >
>;

export interface PartnerSourceAddInput {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly path: string;
  readonly targetKind: PartnerSourceT['targetKind'];
  readonly label?: string;
}

export interface PartnerSourceVersionInput {
  readonly id?: string;
  readonly sourceId: string;
  readonly contentHash: string;
  readonly parserGeneration: string;
  readonly chunkerGeneration: string;
  readonly snapshotRef: string;
  readonly byteSize: number;
  readonly modifiedAt?: number;
  readonly indexedAt?: number;
}

function emptyState(): PartnerSourcesState {
  return {
    version: 2,
    sources: [],
    versions: [],
    selections: [],
    aliases: [],
    scopes: [],
    relations: [],
    materialSelections: [],
  };
}

function validateStateInvariants(input: unknown): PartnerSourcesState {
  const state = v2FileSchema.parse(input);
  const sourceById = new Map<string, PartnerSourceRecord>();
  const sourceKeys = new Set<string>();
  for (const source of state.sources) {
    if (sourceById.has(source.id)) throw new Error(`duplicate Partner source id: ${source.id}`);
    const key = sourceKey(source);
    if (sourceKeys.has(key)) throw new Error('duplicate canonical Partner source identity');
    sourceById.set(source.id, source);
    sourceKeys.add(key);
  }

  const versionById = new Map<string, PartnerSourceVersionT>();
  for (const version of state.versions) {
    if (versionById.has(version.id)) {
      throw new Error(`duplicate Partner source version id: ${version.id}`);
    }
    if (!sourceById.has(version.sourceId)) {
      throw new Error(`Partner source version has no owner: ${version.id}`);
    }
    versionById.set(version.id, version);
  }
  for (const source of state.sources) {
    if (!source.currentVersionId) continue;
    const current = versionById.get(source.currentVersionId);
    if (!current || current.sourceId !== source.id) {
      throw new Error(`Partner source current version is invalid: ${source.id}`);
    }
  }

  const selectionKeys = new Set<string>();
  for (const selection of state.selections) {
    const key = selectionKey(selection);
    if (selectionKeys.has(key)) throw new Error('duplicate Partner source selection');
    const source = sourceById.get(selection.sourceId);
    if (!source || canonicalRoot(source.projectRoot) !== canonicalRoot(selection.projectRoot)) {
      throw new Error('Partner source selection crosses its owner project');
    }
    selectionKeys.add(key);
  }

  const aliasIds = new Set<string>();
  for (const alias of state.aliases) {
    if (aliasIds.has(alias.legacySourceId) || sourceById.has(alias.legacySourceId)) {
      throw new Error(`ambiguous Partner source alias: ${alias.legacySourceId}`);
    }
    if (!sourceById.has(alias.sourceId)) {
      throw new Error(`Partner source alias target is missing: ${alias.sourceId}`);
    }
    aliasIds.add(alias.legacySourceId);
  }

  const scopeKeys = new Set<string>();
  for (const scope of state.scopes) {
    const key = scopeKey(scope);
    if (scopeKeys.has(key)) throw new Error('duplicate Partner retrieval scope');
    scopeKeys.add(key);
  }

  const relationById = new Map<string, PartnerProjectMaterialRelationT>();
  const activeTargets = new Set<string>();
  for (const relation of state.relations) {
    if (relationById.has(relation.id)) {
      throw new Error(`duplicate Partner material relation id: ${relation.id}`);
    }
    if (relation.target.kind === 'project-source') {
      const source = sourceById.get(relation.target.sourceId);
      if (!source || canonicalRoot(source.projectRoot) !== canonicalRoot(relation.projectRoot)) {
        throw new Error('Partner material relation crosses its source project');
      }
    }
    if (relation.lifecycle === 'active') {
      const key = `${canonicalRoot(relation.projectRoot)}\0${relationTargetKey(relation.target)}`;
      if (activeTargets.has(key)) throw new Error('duplicate active Partner material relation');
      activeTargets.add(key);
    }
    relationById.set(relation.id, relation);
  }

  const materialSelectionKeys = new Set<string>();
  for (const selection of state.materialSelections) {
    const key = materialSelectionKey(selection);
    if (materialSelectionKeys.has(key)) throw new Error('duplicate Partner material selection');
    const relation = relationById.get(selection.materialRelationId);
    if (
      !relation ||
      canonicalRoot(relation.projectRoot) !== canonicalRoot(selection.projectRoot) ||
      relationTargetKey(relation.target) !== relationTargetKey(selection.selectedTarget)
    ) {
      throw new Error('Partner material selection does not match its relation');
    }
    if (
      selection.selectedTarget.kind === 'project-source' &&
      selection.version?.policy === 'pinned'
    ) {
      const version = versionById.get(selection.version.versionId);
      if (!version || version.sourceId !== selection.selectedTarget.sourceId) {
        throw new Error('Partner material selection pins a version from another source');
      }
    }
    materialSelectionKeys.add(key);
  }
  return state;
}

function canonicalRoot(projectRoot: string): string {
  return canonProjectRoot(projectRoot, isWindows);
}

function canonicalRelativePath(relativePath: string): string {
  const portable = relativePath.replace(/\\/g, '/');
  const normalized = path.posix.normalize(portable).replace(/^\.\//, '');
  if (
    path.posix.isAbsolute(portable) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error('Partner source path must stay relative to its project');
  }
  return normalized;
}

function defaultLabel(relativePath: string): string {
  return path.posix.basename(relativePath) || relativePath;
}

function sourceKey(
  source: Pick<PartnerSourceRecord, 'kind' | 'projectRoot' | 'path' | 'targetKind'>,
): string {
  return `${source.kind}\0${canonicalRoot(source.projectRoot)}\0${canonicalRelativePath(source.path)}\0${source.targetKind}`;
}

function selectionKey(
  selection: Pick<z.infer<typeof selectionSchema>, 'sessionId' | 'projectRoot' | 'sourceId'>,
): string {
  return `${selection.sessionId}\0${canonicalRoot(selection.projectRoot)}\0${selection.sourceId}`;
}

function scopeKey(scope: Pick<z.infer<typeof scopeSchema>, 'sessionId' | 'projectRoot'>): string {
  return `${scope.sessionId}\0${canonicalRoot(scope.projectRoot)}`;
}

function relationTargetKey(target: PartnerProjectMaterialTargetT): string {
  switch (target.kind) {
    case 'project-source':
      return `project-source\0${target.sourceId}`;
    case 'evidence':
      return `evidence\0${target.evidenceRef.kind}\0${target.evidenceRef.adapterId ?? ''}\0${target.evidenceRef.ownerId}\0${target.evidenceRef.versionId}`;
    case 'result':
      return `result\0${target.resultOwner}\0${target.resultOwnerId}\0${target.resultOwnerVersionId}\0${target.ownerSubresourceId ?? ''}`;
  }
}

function materialSelectionKey(
  selection: Pick<PartnerMaterialSelectionT, 'sessionId' | 'projectRoot' | 'materialRelationId'>,
): string {
  return `${selection.sessionId}\0${canonicalRoot(selection.projectRoot)}\0${selection.materialRelationId}`;
}

async function atomicWriteJson(filePath: string, value: PartnerSourcesState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await replaceFileWithoutFollowingAliases(
    filePath,
    Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
    'Partner source registry changed during atomic replacement',
  );
}

function migrateV1(legacy: z.infer<typeof v1FileSchema>): PartnerSourcesState {
  const state = emptyState();
  const groups = new Map<string, PartnerSourceT[]>();
  for (const source of legacy.sources) {
    const normalized = {
      ...source,
      projectRoot: canonicalRoot(source.projectRoot),
      path: canonicalRelativePath(source.path),
    };
    const key = sourceKey(normalized);
    const group = groups.get(key) ?? [];
    group.push(normalized);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id));
    const first = group[0];
    if (!first) continue;
    const canonicalId = /^src_[A-Za-z0-9_-]{8,}$/.test(first.id) ? first.id : `src_${randomUUID()}`;
    const updatedAt = Math.max(...group.map((source) => source.addedAt));
    state.sources.push({
      id: canonicalId,
      projectRoot: first.projectRoot,
      path: first.path,
      kind: first.kind,
      targetKind: first.targetKind,
      label: first.label?.trim() || defaultLabel(first.path),
      ingestionStatus: 'pending',
      createdAt: first.addedAt,
      updatedAt,
    });
    const relation: PartnerProjectMaterialRelationT = {
      id: `rel_${randomUUID()}`,
      projectRoot: first.projectRoot,
      target: { kind: 'project-source', sourceId: canonicalId },
      createdAt: first.addedAt,
      createdBy: 'migration',
      lifecycle: 'active',
    };
    state.relations.push(relation);
    for (const source of group) {
      if (source.id !== canonicalId) {
        state.aliases.push({ legacySourceId: source.id, sourceId: canonicalId });
      }
      const selection = {
        sessionId: source.sessionId,
        projectRoot: first.projectRoot,
        sourceId: canonicalId,
        selectedAt: source.addedAt,
      };
      if (!state.selections.some((item) => selectionKey(item) === selectionKey(selection))) {
        state.selections.push(selection);
      }
      const materialSelection: PartnerMaterialSelectionT = {
        sessionId: source.sessionId,
        projectRoot: first.projectRoot,
        materialRelationId: relation.id,
        selectedTarget: relation.target,
        version: { policy: 'current-at-run' },
        selectedAt: source.addedAt,
      };
      if (
        !state.materialSelections.some(
          (item) => materialSelectionKey(item) === materialSelectionKey(materialSelection),
        )
      ) {
        state.materialSelections.push(materialSelection);
      }
    }
  }
  return state;
}

export class PartnerSourceStore {
  private cached: PartnerSourcesState | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string = path.join(getSpaceDataDir(), 'partner-sources.json'),
  ) {}

  async list(sessionId: string): Promise<PartnerSourceT[]> {
    const state = await this.load();
    return state.selections
      .filter((selection) => selection.sessionId === sessionId)
      .map((selection) => {
        const source = state.sources.find((item) => item.id === selection.sourceId);
        return source ? this.toLegacySource(source, sessionId, selection.selectedAt) : null;
      })
      .filter((source): source is PartnerSourceT => source !== null)
      .sort((a, b) => a.addedAt - b.addedAt);
  }

  async catalog(projectRoot: string, sessionId?: string): Promise<PartnerProjectSourceT[]> {
    const state = await this.load();
    const root = canonicalRoot(projectRoot);
    const selected = new Set(
      sessionId
        ? state.selections
            .filter(
              (item) => item.sessionId === sessionId && canonicalRoot(item.projectRoot) === root,
            )
            .map((item) => item.sourceId)
        : [],
    );
    return state.sources
      .filter((source) => canonicalRoot(source.projectRoot) === root)
      .map((source) => ({ ...source, selected: selected.has(source.id) }))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  async get(sessionId: string, sourceId: string): Promise<PartnerSourceT | null> {
    const state = await this.load();
    const resolvedId = this.resolveAlias(state, sourceId);
    const selection = state.selections.find(
      (item) => item.sessionId === sessionId && item.sourceId === resolvedId,
    );
    if (!selection) return null;
    const source = state.sources.find((item) => item.id === resolvedId);
    return source ? this.toLegacySource(source, sessionId, selection.selectedAt) : null;
  }

  async getProjectSource(
    projectRoot: string,
    sourceId: string,
  ): Promise<PartnerProjectSourceT | null> {
    const state = await this.load();
    const resolvedId = this.resolveAlias(state, sourceId);
    const root = canonicalRoot(projectRoot);
    const source = state.sources.find(
      (item) => item.id === resolvedId && canonicalRoot(item.projectRoot) === root,
    );
    return source ? { ...source, selected: false } : null;
  }

  async addWorkspacePath(input: PartnerSourceAddInput): Promise<PartnerSourceT> {
    return this.mutate((state) => {
      const normalized = {
        kind: 'workspace_path' as const,
        projectRoot: canonicalRoot(input.projectRoot),
        path: canonicalRelativePath(input.path),
        targetKind: input.targetKind,
      };
      let source = state.sources.find((item) => sourceKey(item) === sourceKey(normalized));
      const now = Date.now();
      if (!source) {
        source = {
          ...normalized,
          id: `src_${randomUUID()}`,
          label: input.label?.trim() || defaultLabel(normalized.path),
          ingestionStatus: 'pending',
          createdAt: now,
          updatedAt: now,
        };
        state.sources.push(source);
      }

      let relation = state.relations.find(
        (item) =>
          item.lifecycle === 'active' &&
          canonicalRoot(item.projectRoot) === normalized.projectRoot &&
          relationTargetKey(item.target) ===
            relationTargetKey({ kind: 'project-source', sourceId: source!.id }),
      );
      if (!relation) {
        const removed = state.relations
          .filter(
            (item) =>
              item.lifecycle === 'removed' &&
              canonicalRoot(item.projectRoot) === normalized.projectRoot &&
              relationTargetKey(item.target) ===
                relationTargetKey({ kind: 'project-source', sourceId: source!.id }),
          )
          .sort((left, right) => right.createdAt - left.createdAt)[0];
        relation = {
          id: `rel_${randomUUID()}`,
          projectRoot: normalized.projectRoot,
          target: { kind: 'project-source', sourceId: source.id },
          createdAt: now,
          createdBy: 'user',
          ...(removed ? { supersedesRelationId: removed.id } : {}),
          lifecycle: 'active',
        };
        state.relations.push(relation);
      }

      const candidate = {
        sessionId: input.sessionId,
        projectRoot: normalized.projectRoot,
        sourceId: source.id,
        selectedAt: now,
      };
      const existing = state.selections.find(
        (item) => selectionKey(item) === selectionKey(candidate),
      );
      if (!existing) {
        const selectedCount = state.selections.filter(
          (item) => item.sessionId === input.sessionId,
        ).length;
        if (selectedCount >= MAX_SOURCES_PER_SESSION) {
          throw new Error(
            `Partner source limit reached for this session (${MAX_SOURCES_PER_SESSION})`,
          );
        }
        state.selections.push(candidate);
      }
      const materialCandidate: PartnerMaterialSelectionT = {
        sessionId: input.sessionId,
        projectRoot: normalized.projectRoot,
        materialRelationId: relation.id,
        selectedTarget: relation.target,
        version: { policy: 'current-at-run' },
        selectedAt: existing?.selectedAt ?? now,
      };
      if (
        !state.materialSelections.some(
          (item) => materialSelectionKey(item) === materialSelectionKey(materialCandidate),
        )
      ) {
        state.materialSelections.push(materialCandidate);
      }
      return {
        state,
        result: this.toLegacySource(source, input.sessionId, existing?.selectedAt ?? now),
      };
    });
  }

  async select(
    sessionId: string,
    projectRoot: string,
    sourceId: string,
    selected: boolean,
  ): Promise<PartnerProjectSourceT | null> {
    return this.mutate((state) => {
      const resolvedId = this.resolveAlias(state, sourceId);
      const root = canonicalRoot(projectRoot);
      const source = state.sources.find(
        (item) => item.id === resolvedId && canonicalRoot(item.projectRoot) === root,
      );
      if (!source) return { state, result: null };
      const key = selectionKey({ sessionId, projectRoot: root, sourceId: resolvedId });
      const index = state.selections.findIndex((item) => selectionKey(item) === key);
      if (selected && index < 0) {
        const relation = state.relations.find(
          (item) =>
            item.lifecycle === 'active' &&
            canonicalRoot(item.projectRoot) === root &&
            item.target.kind === 'project-source' &&
            item.target.sourceId === resolvedId,
        );
        if (!relation) {
          throw new Error('Source must be added to project materials before task selection');
        }
        const selectedCount = state.selections.filter(
          (item) => item.sessionId === sessionId,
        ).length;
        if (selectedCount >= MAX_SOURCES_PER_SESSION) {
          throw new Error(
            `Partner source limit reached for this session (${MAX_SOURCES_PER_SESSION})`,
          );
        }
        state.selections.push({
          sessionId,
          projectRoot: root,
          sourceId: resolvedId,
          selectedAt: Date.now(),
        });
        const materialSelection: PartnerMaterialSelectionT = {
          sessionId,
          projectRoot: root,
          materialRelationId: relation.id,
          selectedTarget: relation.target,
          version: { policy: 'current-at-run' },
          selectedAt: Date.now(),
        };
        if (
          !state.materialSelections.some(
            (item) => materialSelectionKey(item) === materialSelectionKey(materialSelection),
          )
        ) {
          state.materialSelections.push(materialSelection);
        }
      } else if (!selected && index >= 0) {
        state.selections.splice(index, 1);
        state.materialSelections = state.materialSelections.filter(
          (item) =>
            !(
              item.sessionId === sessionId &&
              item.selectedTarget.kind === 'project-source' &&
              item.selectedTarget.sourceId === resolvedId
            ),
        );
      }
      return { state, result: { ...source, selected } };
    });
  }

  async remove(sessionId: string, sourceId: string): Promise<boolean> {
    return this.mutate((state) => {
      const resolvedId = this.resolveAlias(state, sourceId);
      const before = state.selections.length;
      state.selections = state.selections.filter(
        (selection) => !(selection.sessionId === sessionId && selection.sourceId === resolvedId),
      );
      state.materialSelections = state.materialSelections.filter(
        (selection) =>
          !(
            selection.sessionId === sessionId &&
            selection.selectedTarget.kind === 'project-source' &&
            selection.selectedTarget.sourceId === resolvedId
          ),
      );
      return { state, result: state.selections.length !== before };
    });
  }

  async updateProjectSource(
    projectRoot: string,
    sourceId: string,
    patch: PartnerSourcePatch,
  ): Promise<PartnerProjectSourceT | null> {
    return this.mutate((state) => {
      const resolvedId = this.resolveAlias(state, sourceId);
      const root = canonicalRoot(projectRoot);
      const index = state.sources.findIndex(
        (item) => item.id === resolvedId && canonicalRoot(item.projectRoot) === root,
      );
      if (index < 0) return { state, result: null };
      const current = state.sources[index]!;
      const next = {
        ...current,
        ...patch,
        updatedAt: patch.updatedAt ?? Date.now(),
      };
      state.sources[index] = next;
      return { state, result: { ...next, selected: false } };
    });
  }

  async relinkProjectSource(
    projectRoot: string,
    sourceId: string,
    nextRelativePath: string,
  ): Promise<PartnerProjectSourceT | null> {
    return this.mutate((state) => {
      const root = canonicalRoot(projectRoot);
      const resolvedId = this.resolveAlias(state, sourceId);
      const index = state.sources.findIndex(
        (item) => item.id === resolvedId && canonicalRoot(item.projectRoot) === root,
      );
      if (index < 0) return { state, result: null };
      const current = state.sources[index]!;
      const normalizedPath = canonicalRelativePath(nextRelativePath);
      const candidate = { ...current, path: normalizedPath };
      if (
        state.sources.some(
          (item, itemIndex) => itemIndex !== index && sourceKey(item) === sourceKey(candidate),
        )
      ) {
        throw new Error('Renamed Partner source conflicts with an existing source identity');
      }
      const next = {
        ...current,
        path: normalizedPath,
        label:
          current.label === defaultLabel(current.path)
            ? defaultLabel(normalizedPath)
            : current.label,
        ingestionStatus: 'stale' as const,
        updatedAt: Date.now(),
      };
      state.sources[index] = next;
      return { state, result: { ...next, selected: false } };
    });
  }

  async setIngestionStatus(
    projectRoot: string,
    sourceId: string,
    ingestionStatus: PartnerIngestionStatusT,
    lastError?: PartnerSourceRecord['lastError'],
  ): Promise<PartnerProjectSourceT | null> {
    const patch: PartnerSourcePatch = { ingestionStatus, updatedAt: Date.now() };
    patch.lastError = lastError;
    return this.updateProjectSource(projectRoot, sourceId, patch);
  }

  async commitVersion(input: PartnerSourceVersionInput): Promise<PartnerSourceVersionT> {
    return this.mutate((state) => {
      const sourceId = this.resolveAlias(state, input.sourceId);
      const sourceIndex = state.sources.findIndex((item) => item.id === sourceId);
      if (sourceIndex < 0) throw new Error(`Unknown Partner source: ${input.sourceId}`);
      const existing = input.id
        ? state.versions.find((version) => version.id === input.id)
        : undefined;
      if (
        existing &&
        (existing.sourceId !== sourceId ||
          existing.contentHash !== input.contentHash ||
          existing.parserGeneration !== input.parserGeneration ||
          existing.chunkerGeneration !== input.chunkerGeneration ||
          existing.snapshotRef !== input.snapshotRef)
      ) {
        throw new Error(`Immutable Partner source version conflict: ${existing.id}`);
      }
      const version: PartnerSourceVersionT = existing ?? {
        ...input,
        sourceId,
        id: input.id ?? `sv_${randomUUID()}`,
        createdAt: Date.now(),
      };
      if (!existing) state.versions.push(version);
      const source = state.sources[sourceIndex]!;
      const { lastError: _lastError, ...sourceWithoutError } = source;
      state.sources[sourceIndex] = {
        ...sourceWithoutError,
        currentVersionId: version.id,
        ingestionStatus: 'ready',
        updatedAt: Date.now(),
      };
      return { state, result: version };
    });
  }

  async getVersion(versionId: string): Promise<PartnerSourceVersionT | null> {
    const state = await this.load();
    return state.versions.find((version) => version.id === versionId) ?? null;
  }

  async listVersions(sourceId: string): Promise<PartnerSourceVersionT[]> {
    const state = await this.load();
    const resolvedId = this.resolveAlias(state, sourceId);
    return state.versions
      .filter((version) => version.sourceId === resolvedId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async catalogMaterials(
    projectRoot: string,
    sessionId?: string,
  ): Promise<{
    relations: PartnerProjectMaterialRelationT[];
    selections: PartnerMaterialSelectionT[];
  }> {
    const state = await this.load();
    const root = canonicalRoot(projectRoot);
    return {
      relations: state.relations
        .filter((relation) => canonicalRoot(relation.projectRoot) === root)
        .sort((left, right) => left.createdAt - right.createdAt),
      selections: state.materialSelections
        .filter(
          (selection) =>
            canonicalRoot(selection.projectRoot) === root &&
            (sessionId === undefined || selection.sessionId === sessionId),
        )
        .sort((left, right) => left.selectedAt - right.selectedAt),
    };
  }

  async activeProjectSourceIds(projectRoot: string): Promise<string[]> {
    const { relations } = await this.catalogMaterials(projectRoot);
    return relations.flatMap((relation) =>
      relation.lifecycle === 'active' && relation.target.kind === 'project-source'
        ? [relation.target.sourceId]
        : [],
    );
  }

  async selectedProjectSourceRefs(
    sessionId: string,
    projectRoot: string,
  ): Promise<
    Array<{
      materialRelationId: string;
      sourceId: string;
      version: NonNullable<PartnerMaterialSelectionT['version']>;
    }>
  > {
    const { selections } = await this.catalogMaterials(projectRoot, sessionId);
    const refs = selections.flatMap((selection) =>
      selection.selectedTarget.kind === 'project-source'
        ? [
            {
              materialRelationId: selection.materialRelationId,
              sourceId: selection.selectedTarget.sourceId,
              version: selection.version ?? { policy: 'current-at-run' as const },
              selectedAt: selection.selectedAt,
            },
          ]
        : [],
    );
    const deduped = new Map<string, (typeof refs)[number]>();
    for (const ref of refs) {
      const versionKey =
        ref.version.policy === 'pinned' ? `pinned:${ref.version.versionId}` : 'current-at-run';
      const key = `${ref.sourceId}\0${versionKey}`;
      const existing = deduped.get(key);
      if (!existing || ref.selectedAt > existing.selectedAt) deduped.set(key, ref);
    }
    return [...deduped.values()].map(({ selectedAt: _selectedAt, ...ref }) => ref);
  }

  async adoptMaterial(
    projectRoot: string,
    target: PartnerProjectMaterialTargetT,
    createdBy: PartnerProjectMaterialRelationT['createdBy'] = 'user',
  ): Promise<PartnerProjectMaterialRelationT> {
    return this.mutate((state) => {
      const root = canonicalRoot(projectRoot);
      if (
        target.kind === 'project-source' &&
        !state.sources.some(
          (source) => source.id === target.sourceId && canonicalRoot(source.projectRoot) === root,
        )
      ) {
        throw new Error(`Unknown project source material target: ${target.sourceId}`);
      }
      const targetKey = relationTargetKey(target);
      const active = state.relations.find(
        (relation) =>
          relation.lifecycle === 'active' &&
          canonicalRoot(relation.projectRoot) === root &&
          relationTargetKey(relation.target) === targetKey,
      );
      if (active) return { state, result: active };
      const superseded = state.relations
        .filter(
          (relation) =>
            relation.lifecycle === 'removed' &&
            canonicalRoot(relation.projectRoot) === root &&
            relationTargetKey(relation.target) === targetKey,
        )
        .sort((left, right) => right.createdAt - left.createdAt)[0];
      const relation: PartnerProjectMaterialRelationT = {
        id: `rel_${randomUUID()}`,
        projectRoot: root,
        target,
        createdAt: Date.now(),
        createdBy,
        ...(superseded ? { supersedesRelationId: superseded.id } : {}),
        lifecycle: 'active',
      };
      state.relations.push(relation);
      return { state, result: relation };
    });
  }

  async selectMaterial(
    sessionId: string,
    projectRoot: string,
    materialRelationId: string,
    selected: boolean,
    version: PartnerMaterialSelectionT['version'] = { policy: 'current-at-run' },
  ): Promise<PartnerMaterialSelectionT | null> {
    return this.mutate((state) => {
      const root = canonicalRoot(projectRoot);
      const relation = state.relations.find(
        (item) => item.id === materialRelationId && canonicalRoot(item.projectRoot) === root,
      );
      if (!relation) throw new Error(`Unknown project material relation: ${materialRelationId}`);
      const key = materialSelectionKey({ sessionId, projectRoot: root, materialRelationId });
      const index = state.materialSelections.findIndex(
        (selection) => materialSelectionKey(selection) === key,
      );
      if (!selected) {
        if (index >= 0) state.materialSelections.splice(index, 1);
        if (relation.target.kind === 'project-source') {
          const relationSourceId = relation.target.sourceId;
          state.selections = state.selections.filter(
            (selection) =>
              !(selection.sessionId === sessionId && selection.sourceId === relationSourceId),
          );
        }
        return { state, result: null };
      }
      if (relation.lifecycle !== 'active') {
        throw new Error('Removed project material cannot be newly selected');
      }
      if (relation.target.kind !== 'project-source' && version?.policy === 'current-at-run') {
        throw new Error(
          'Immutable evidence and Result materials must be selected by exact version',
        );
      }
      if (relation.target.kind === 'project-source' && version?.policy === 'pinned') {
        const pinned = state.versions.find((item) => item.id === version.versionId);
        if (!pinned || pinned.sourceId !== relation.target.sourceId) {
          throw new Error(
            'Pinned Partner source selection must reference a version of that source',
          );
        }
      }
      const selection: PartnerMaterialSelectionT = {
        sessionId,
        projectRoot: root,
        materialRelationId,
        selectedTarget: relation.target,
        ...(relation.target.kind === 'project-source' && version ? { version } : {}),
        selectedAt: index >= 0 ? state.materialSelections[index]!.selectedAt : Date.now(),
      };
      if (index >= 0) state.materialSelections[index] = selection;
      else state.materialSelections.push(selection);
      if (
        relation.target.kind === 'project-source' &&
        !state.selections.some((item) => {
          const relationSourceId =
            relation.target.kind === 'project-source' ? relation.target.sourceId : '';
          return item.sessionId === sessionId && item.sourceId === relationSourceId;
        })
      ) {
        const relationSourceId = relation.target.sourceId;
        state.selections.push({
          sessionId,
          projectRoot: root,
          sourceId: relationSourceId,
          selectedAt: selection.selectedAt,
        });
      }
      return { state, result: selection };
    });
  }

  async removeMaterial(
    projectRoot: string,
    materialRelationId: string,
    removalReasonCode?: string,
  ): Promise<PartnerProjectMaterialRelationT> {
    return this.mutate((state) => {
      const root = canonicalRoot(projectRoot);
      const index = state.relations.findIndex(
        (relation) =>
          relation.id === materialRelationId && canonicalRoot(relation.projectRoot) === root,
      );
      if (index < 0) throw new Error(`Unknown project material relation: ${materialRelationId}`);
      const current = state.relations[index]!;
      if (current.lifecycle === 'removed') return { state, result: current };
      const removed: PartnerProjectMaterialRelationT = {
        ...current,
        lifecycle: 'removed',
        removedAt: Date.now(),
        ...(removalReasonCode ? { removalReasonCode } : {}),
      };
      state.relations[index] = removed;
      return { state, result: removed };
    });
  }

  async getScope(sessionId: string, projectRoot: string): Promise<PartnerKnowledgeScopeT> {
    const state = await this.load();
    const key = scopeKey({ sessionId, projectRoot });
    return state.scopes.find((item) => scopeKey(item) === key)?.scope ?? DEFAULT_SCOPE;
  }

  async setScope(
    sessionId: string,
    projectRoot: string,
    scope: PartnerKnowledgeScopeT,
  ): Promise<PartnerKnowledgeScopeT> {
    return this.mutate((state) => {
      const normalized = { sessionId, projectRoot: canonicalRoot(projectRoot), scope };
      const index = state.scopes.findIndex((item) => scopeKey(item) === scopeKey(normalized));
      if (index >= 0) state.scopes[index] = normalized;
      else state.scopes.push(normalized);
      return { state, result: scope };
    });
  }

  invalidate(): void {
    this.cached = null;
  }

  private async load(): Promise<PartnerSourcesState> {
    if (this.cached !== null) return structuredClone(this.cached);
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const json: unknown = JSON.parse(raw);
      const v2 = v2FileSchema.safeParse(json);
      if (v2.success) {
        this.cached = validateStateInvariants(v2.data);
      } else {
        const v1 = v1FileSchema.safeParse(json);
        if (!v1.success) {
          throw new Error(
            `schema invalid: ${v2.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
          );
        }
        const migrated = migrateV1(v1.data);
        await this.backupLegacyFile(raw);
        await atomicWriteJson(this.filePath, migrated);
        const readback = validateStateInvariants(
          JSON.parse(await fs.readFile(this.filePath, 'utf8')),
        );
        if (JSON.stringify(readback) !== JSON.stringify(migrated)) {
          throw new Error('Partner v2 source migration readback verification failed');
        }
        this.cached = readback;
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'ENOENT'
      ) {
        this.cached = emptyState();
      } else {
        throw new Error(
          `Partner source store is corrupt or unreadable; refusing to overwrite it: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }
    return structuredClone(this.cached);
  }

  private async backupLegacyFile(raw: string): Promise<void> {
    const backupPath = `${this.filePath}.v1.backup`;
    try {
      await fs.writeFile(backupPath, raw, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          'code' in error &&
          (error as { code: string }).code === 'EEXIST'
        )
      ) {
        throw error;
      }
    }
    const readback = await fs.readFile(backupPath, 'utf8');
    if (readback !== raw) {
      throw new Error('Partner v1 source backup verification failed');
    }
  }

  private resolveAlias(state: PartnerSourcesState, sourceId: string): string {
    return state.aliases.find((alias) => alias.legacySourceId === sourceId)?.sourceId ?? sourceId;
  }

  private toLegacySource(
    source: PartnerSourceRecord,
    sessionId: string,
    addedAt: number,
  ): PartnerSourceT {
    return {
      id: source.id,
      sessionId,
      kind: source.kind,
      projectRoot: source.projectRoot,
      path: source.path,
      targetKind: source.targetKind,
      label: source.label,
      addedAt,
    };
  }

  private async mutate<R>(
    apply: (state: PartnerSourcesState) => { state: PartnerSourcesState; result: R },
  ): Promise<R> {
    const previous = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const current = await this.load();
      const { state, result } = apply(structuredClone(current));
      const validated = validateStateInvariants(state);
      await atomicWriteJson(this.filePath, validated);
      this.cached = validated;
      return result;
    } finally {
      release();
    }
  }
}

export const partnerSourceStore = new PartnerSourceStore();
