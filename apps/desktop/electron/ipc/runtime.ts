import type { InvokeChannelName } from '@kodax-space/space-ipc-schema';

import {
  runtimeProjectionController,
  type RuntimeProjectionController,
} from '../kodax/runtime/runtime-projection-controller.js';
import { runtimeHostAdapter } from '../kodax/runtime-host-adapter.js';
import { registerChannel } from './register.js';

type RuntimeChannelName = Extract<
  InvokeChannelName,
  'runtime.profileSnapshot' | 'session.liveSnapshot'
>;

type RuntimeChannelRegistrar = <C extends RuntimeChannelName>(
  name: C,
  handler: Parameters<typeof registerChannel<C>>[1],
) => void;

export function registerRuntimeProjectionChannels(
  controller: RuntimeProjectionController = runtimeProjectionController,
  register: RuntimeChannelRegistrar = registerChannel,
  ensureObserved: (sessionId: string) => Promise<void> = (sessionId) =>
    runtimeHostAdapter.ensureObserved(sessionId),
): void {
  register('runtime.profileSnapshot', () => controller.profileSnapshot());
  register('session.liveSnapshot', async ({ sessionId }) => {
    await ensureObserved(sessionId);
    return controller.sessionLiveSnapshot(sessionId);
  });
}
