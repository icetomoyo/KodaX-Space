import { adminPolicyAuditStore } from '../kodax/admin-policy-audit-store.js';
import { registerChannel } from './register.js';

export function registerAdminPolicyAuditChannels(): void {
  registerChannel('admin.policy.get', async () => adminPolicyAuditStore.getPolicy());

  registerChannel('admin.policy.set', async (input) => adminPolicyAuditStore.setPolicy(input));

  registerChannel('admin.policy.export', async () => adminPolicyAuditStore.exportPolicy());

  registerChannel('admin.audit.list', async (input) => ({
    events: await adminPolicyAuditStore.listAudit(input ?? undefined),
  }));

  registerChannel('admin.audit.export', async (input) =>
    adminPolicyAuditStore.exportAuditJsonl(input ?? undefined),
  );
}
