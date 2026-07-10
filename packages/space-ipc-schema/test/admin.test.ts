import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adminAuditEventSchema,
  adminAuditExportChannel,
  adminAuditListChannel,
  adminPolicyExportChannel,
  adminPolicyGetChannel,
  adminPolicySchema,
  adminPolicySchemaVersion,
  adminPolicySetChannel,
  invokeChannels,
} from '../src/index.js';

test('admin policy and audit channels are registered', () => {
  for (const name of [
    'admin.policy.get',
    'admin.policy.set',
    'admin.policy.export',
    'admin.audit.list',
    'admin.audit.export',
  ]) {
    assert.ok(invokeChannels[name as keyof typeof invokeChannels], `${name} should be registered`);
  }
});

test('admin policy update accepts partial local-first controls', () => {
  assert.equal(adminPolicyGetChannel.input.safeParse(undefined).success, true);
  assert.equal(
    adminPolicySetChannel.input.safeParse({
      artifact: { exportAllowed: false },
      workspaceFileProposals: { applyAllowed: false },
      workspaceDeliveries: { writeAllowed: false },
      redaction: { extraPatterns: ['secret-[0-9]+'] },
    }).success,
    true,
  );
  assert.equal(adminPolicyExportChannel.input.safeParse(undefined).success, true);
  assert.equal(
    adminAuditListChannel.input.safeParse({ category: 'artifact', limit: 50 }).success,
    true,
  );
  assert.equal(adminAuditExportChannel.input.safeParse({ limit: 500 }).success, true);
});

test('admin policy and audit event schemas validate exported shapes', () => {
  const policy = {
    schema: adminPolicySchemaVersion,
    providers: { allow: [], deny: [] },
    mcp: { allow: [], deny: [] },
    connectors: { allow: [], deny: [], writesAllowed: false },
    artifact: { generateOfficeAllowed: true, exportAllowed: true },
    workspaceFileProposals: {
      createAllowed: true,
      applyAllowed: true,
      exportAllowed: true,
      allowedExtensions: [],
    },
    workspaceDeliveries: {
      writeAllowed: true,
      workspaceWriteAllowed: false,
      registerWorkspaceAllowed: false,
      allowedExtensions: [],
    },
    automation: { enabled: false, connectorWritesAllowed: false, filesystemExportsAllowed: false },
    remoteRunner: { enabled: false },
    desktopAutomation: { enabled: false },
    redaction: { enabled: true, extraPatterns: [] },
    userOverrides: { allowed: true, requireReason: false },
    updatedAt: 1,
  };
  assert.equal(adminPolicySchema.safeParse(policy).success, true);
  assert.equal(
    adminAuditEventSchema.safeParse({
      id: 'audit_1',
      createdAt: 2,
      category: 'artifact',
      action: 'artifact.export',
      outcome: 'allowed',
      resource: 'art_1',
      details: '{"ok":true}',
      redacted: false,
    }).success,
    true,
  );
});
