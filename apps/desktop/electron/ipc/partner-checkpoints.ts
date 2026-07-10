import { adminPolicyAuditStore } from '../kodax/admin-policy-audit-store.js';
import { partnerCheckpointStore } from '../kodax/partner-checkpoint-store.js';
import { partnerDeliveryStore } from '../kodax/partner-delivery-store.js';
import { projectStore } from '../projects/store.js';
import { pushToRenderer } from './push.js';
import { registerChannel } from './register.js';

export function registerPartnerCheckpointChannels(): void {
  registerChannel('partner.checkpoints.list', async (input) => {
    const projectRoot = await projectStore.assertAllowed(input.projectRoot);
    return {
      checkpoints: await partnerCheckpointStore.list({ ...input, projectRoot }),
    };
  });

  registerChannel('partner.checkpoints.get', async (input) => {
    const checkpoint = await partnerCheckpointStore.get(input.id);
    if (checkpoint) await projectStore.assertAllowed(checkpoint.projectRoot);
    return { checkpoint };
  });

  registerChannel('partner.checkpoints.rollback', async (input) => {
    const checkpoint = await partnerCheckpointStore.get(input.id);
    if (!checkpoint) return { ok: false, error: 'checkpoint not found' };
    const projectRoot = await projectStore.assertAllowed(checkpoint.projectRoot);
    const result = await partnerCheckpointStore.rollback(input.id);
    await adminPolicyAuditStore.record({
      category: 'workspace-file',
      action: 'delivery.rollbackCheckpoint',
      outcome: result.ok ? 'allowed' : 'failed',
      projectRoot,
      sessionId: checkpoint.sessionId,
      resource: checkpoint.relativePath,
      details: { checkpointId: checkpoint.id, error: result.error },
    });
    let deliverySyncError: string | undefined;
    if (result.ok) {
      if (checkpoint.deliveryId) {
        try {
          await partnerDeliveryStore.refresh(checkpoint.deliveryId);
        } catch (err) {
          deliverySyncError = err instanceof Error ? err.message : String(err);
        }
      }
      pushToRenderer('partner.checkpoints.changed', {
        sessionId: checkpoint.sessionId,
        id: checkpoint.id,
        reason: 'rollback',
      });
      if (checkpoint.deliveryId) {
        pushToRenderer('partner.deliveries.changed', {
          sessionId: checkpoint.sessionId,
          id: checkpoint.deliveryId,
          reason: 'rollback',
        });
      }
    }
    return deliverySyncError ? { ...result, error: deliverySyncError.slice(0, 512) } : result;
  });
}
