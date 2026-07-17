import {
  canonProjectRoot,
  partnerDeliveryPathMatches,
  type PartnerDeliveryReferenceT,
  type PartnerDeliveryRefT,
  type PartnerDeliveryResolveStatusT,
} from '@kodax-space/space-ipc-schema';
import {
  partnerDeliveryStore,
  type PartnerDeliveryStore,
} from '../kodax/partner-delivery-store.js';
import { projectStore } from '../projects/store.js';
import { pushToRenderer } from './push.js';
import { registerChannel } from './register.js';

const IS_WIN = process.platform === 'win32';

function sameProjectRoot(a: string, b: string): boolean {
  return canonProjectRoot(a, IS_WIN) === canonProjectRoot(b, IS_WIN);
}

interface DeliveryResolution {
  readonly status: PartnerDeliveryResolveStatusT;
  readonly delivery: PartnerDeliveryRefT | null;
  readonly removed?: Pick<PartnerDeliveryRefT, 'id' | 'sessionId'>;
}

export async function resolvePartnerDeliveryReference(
  store: PartnerDeliveryStore,
  input: {
    readonly projectRoot: string;
    readonly sessionId?: string;
    readonly reference: PartnerDeliveryReferenceT;
  },
): Promise<DeliveryResolution> {
  const candidates = await (async () => {
    if (input.reference.type === 'id') {
      const delivery = await store.get(input.reference.id);
      return delivery ? [delivery] : [];
    }
    const referencePath = input.reference.path;
    return (
      await store.list({
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      })
    ).filter((delivery) => partnerDeliveryPathMatches(delivery, referencePath));
  })();

  const scoped = candidates.filter(
    (delivery) =>
      sameProjectRoot(delivery.projectRoot, input.projectRoot) &&
      (input.sessionId === undefined || delivery.sessionId === input.sessionId),
  );
  if (scoped.length === 0) return { status: 'not-found', delivery: null };
  if (scoped.length > 1) return { status: 'ambiguous', delivery: null };

  const validation = await store.validate(scoped[0]!.id);
  if (validation.status === 'found') {
    return { status: 'found', delivery: validation.delivery };
  }
  if (validation.status === 'missing') {
    return {
      status: 'missing',
      delivery: null,
      removed: { id: scoped[0]!.id, sessionId: scoped[0]!.sessionId },
    };
  }
  return { status: 'not-found', delivery: null };
}

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

  registerChannel('partner.deliveries.resolve', async (input) => {
    const projectRoot = await projectStore.assertAllowed(input.projectRoot);
    const resolution = await resolvePartnerDeliveryReference(partnerDeliveryStore, {
      ...input,
      projectRoot,
    });
    if (resolution.removed) {
      try {
        pushToRenderer('partner.deliveries.changed', {
          sessionId: resolution.removed.sessionId,
          id: resolution.removed.id,
          reason: 'deleted',
        });
      } catch {
        // Renderer may be gone; the stale registry entry has still been removed.
      }
    }
    return { status: resolution.status, delivery: resolution.delivery };
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
