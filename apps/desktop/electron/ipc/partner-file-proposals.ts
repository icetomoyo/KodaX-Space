import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { canonProjectRoot } from '@kodax-space/space-ipc-schema';
import { registerChannel } from './register.js';
import { projectStore } from '../projects/store.js';
import { adminPolicyAuditStore } from '../kodax/admin-policy-audit-store.js';
import { partnerFileProposalStore } from '../kodax/partner-file-proposal-store.js';

const IS_WIN = process.platform === 'win32';

function getElectron(): typeof import('electron') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = typeof require !== 'undefined' ? null : (import.meta as any);
  const req = meta ? createRequire(meta.url) : require;
  return req('electron') as typeof import('electron');
}

function defaultExportName(targetPath: string): string {
  const base = path.posix.basename(targetPath.replace(/\\/g, '/')) || 'partner-proposal.txt';
  const safe = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return safe || 'partner-proposal.txt';
}

function sameProjectRoot(a: string, b: string): boolean {
  return canonProjectRoot(a, IS_WIN) === canonProjectRoot(b, IS_WIN);
}

export function registerPartnerFileProposalChannels(): void {
  registerChannel('partner.fileProposals.list', async (input) => {
    const projectRoot = await projectStore.assertAllowed(input.projectRoot);
    const proposals = await partnerFileProposalStore.list({
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    return {
      proposals: proposals.filter((proposal) => sameProjectRoot(proposal.projectRoot, projectRoot)),
    };
  });
  registerChannel('partner.fileProposals.get', async (input) => {
    const projectRoot = await projectStore.assertAllowed(input.projectRoot);
    const proposal = await partnerFileProposalStore.get(input.id);
    return {
      proposal: proposal && sameProjectRoot(proposal.projectRoot, projectRoot) ? proposal : null,
    };
  });
  registerChannel('partner.fileProposals.apply', async (input) => {
    const projectRoot = await projectStore.assertAllowed(input.projectRoot);
    const proposal = await partnerFileProposalStore.get(input.id);
    if (!proposal || !sameProjectRoot(proposal.projectRoot, projectRoot)) {
      return { ok: false, error: 'proposal not found' };
    }
    await adminPolicyAuditStore.assertFileProposalApplyAllowed({
      proposalId: input.id,
      targetPath: proposal.targetPath,
    });
    const result = await partnerFileProposalStore.apply({
      id: input.id,
      expectedContentHash: input.expectedContentHash,
      assertAllowedProjectRoot: (storedProjectRoot) => {
        if (!sameProjectRoot(storedProjectRoot, projectRoot)) {
          throw new Error('proposal projectRoot does not match requested projectRoot');
        }
        return projectStore.assertAllowed(storedProjectRoot);
      },
    });
    await adminPolicyAuditStore.record({
      category: 'workspace-file',
      action: 'fileProposal.apply',
      outcome: result.ok ? 'allowed' : 'failed',
      resource: result.proposal?.targetPath ?? input.id,
      details: { proposalId: input.id, error: result.ok ? undefined : result.error },
      ...(result.proposal?.projectRoot ? { projectRoot: result.proposal.projectRoot } : {}),
      ...(result.proposal?.sessionId ? { sessionId: result.proposal.sessionId } : {}),
    });
    return result;
  });
  registerChannel('partner.fileProposals.reject', async (input) => {
    const projectRoot = await projectStore.assertAllowed(input.projectRoot);
    const proposal = await partnerFileProposalStore.get(input.id);
    if (!proposal || !sameProjectRoot(proposal.projectRoot, projectRoot)) {
      return { ok: false, error: 'proposal not found' };
    }
    const result = await partnerFileProposalStore.reject(input.id, input.reason);
    await adminPolicyAuditStore.record({
      category: 'workspace-file',
      action: 'fileProposal.reject',
      outcome: result.ok ? 'allowed' : 'failed',
      resource: result.proposal?.targetPath ?? input.id,
      details: {
        proposalId: input.id,
        reason: input.reason,
        error: result.ok ? undefined : result.error,
      },
      ...(result.proposal?.projectRoot ? { projectRoot: result.proposal.projectRoot } : {}),
      ...(result.proposal?.sessionId ? { sessionId: result.proposal.sessionId } : {}),
    });
    return result;
  });
  registerChannel('partner.fileProposals.export', async (input) => {
    const projectRoot = await projectStore.assertAllowed(input.projectRoot);
    const proposal = await partnerFileProposalStore.get(input.id);
    if (!proposal || !sameProjectRoot(proposal.projectRoot, projectRoot)) {
      return { ok: false, error: 'proposal not found' };
    }
    await adminPolicyAuditStore.assertFileProposalExportAllowed({
      proposalId: input.id,
      targetPath: proposal.targetPath,
    });
    if (proposal.contentHash !== input.expectedContentHash) {
      return { ok: false, error: 'content hash mismatch' };
    }
    const { dialog, BrowserWindow } = getElectron();
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const defaultPath = defaultExportName(proposal.targetPath);
    const result = parent
      ? await dialog.showSaveDialog(parent, { defaultPath })
      : await dialog.showSaveDialog({ defaultPath });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.writeFile(result.filePath, proposal.content, { encoding: 'utf-8', mode: 0o600 });
    await adminPolicyAuditStore.record({
      category: 'workspace-file',
      action: 'fileProposal.export',
      outcome: 'allowed',
      projectRoot: proposal.projectRoot,
      sessionId: proposal.sessionId,
      resource: proposal.targetPath,
      details: { proposalId: proposal.id, exportPath: result.filePath },
    });
    return { ok: true, path: result.filePath };
  });
}
