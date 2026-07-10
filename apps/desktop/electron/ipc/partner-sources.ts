import { promises as fs } from 'node:fs';
import { canonProjectRoot } from '@kodax-space/space-ipc-schema';
import { registerChannel } from './register.js';
import { projectStore } from '../projects/store.js';
import { resolveInsideProject, toPosixRelative } from './files-core.js';
import { kodaxHost } from '../kodax/host.js';
import { adminPolicyAuditStore } from '../kodax/admin-policy-audit-store.js';
import { partnerKbStore } from '../kodax/partner-kb-store.js';
import { partnerSourceStore } from '../kodax/partner-source-store.js';

const IS_WIN = process.platform === 'win32';

function assertPartnerSessionIfActive(sessionId: string, projectRoot?: string): void {
  const session = kodaxHost.get(sessionId);
  if (!session) return;
  if (session.surface !== 'partner') {
    throw new Error(`session ${sessionId} is not a Partner session`);
  }
  if (
    projectRoot !== undefined &&
    canonProjectRoot(session.projectRoot, IS_WIN) !== canonProjectRoot(projectRoot, IS_WIN)
  ) {
    throw new Error('source projectRoot does not match the Partner session projectRoot');
  }
}

export function registerPartnerSourceChannels(): void {
  registerChannel('partner.sources.list', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    assertPartnerSessionIfActive(input.sessionId, validatedRoot);
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
    assertPartnerSessionIfActive(input.sessionId, validatedRoot);
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
    return { source };
  });

  registerChannel('partner.sources.remove', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    assertPartnerSessionIfActive(input.sessionId, validatedRoot);
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
}
