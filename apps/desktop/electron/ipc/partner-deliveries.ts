import { partnerDeliveryStore } from '../kodax/partner-delivery-store.js';
import { projectStore } from '../projects/store.js';
import { registerChannel } from './register.js';

export function registerPartnerDeliveryChannels(): void {
  registerChannel('partner.deliveries.list', async (input) => {
    const projectRoot = await projectStore.assertAllowed(input.projectRoot);
    return {
      deliveries: await partnerDeliveryStore.list({ ...input, projectRoot }),
    };
  });

  registerChannel('partner.deliveries.get', async (input) => {
    const delivery = await partnerDeliveryStore.get(input.id);
    if (delivery) await projectStore.assertAllowed(delivery.projectRoot);
    return { delivery };
  });

  registerChannel('partner.deliveries.outputRoot', async (input) => {
    await projectStore.assertAllowed(input.projectRoot);
    return {
      rootPath: await partnerDeliveryStore.ensureOutputRoot(input.sessionId),
    };
  });

  registerChannel('partner.deliveries.readBinary', async (input) => {
    const delivery = await partnerDeliveryStore.get(input.id);
    if (delivery) await projectStore.assertAllowed(delivery.projectRoot);
    return partnerDeliveryStore.readBinary(input.id, input.maxBytes);
  });
}
