import type { InvokeChannelName } from '@kodax-space/space-ipc-schema';

import {
  runtimeProjectionController,
  type RuntimeProjectionController,
} from '../kodax/runtime/runtime-projection-controller.js';
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
): void {
  register('runtime.profileSnapshot', () => controller.profileSnapshot());
  register('session.liveSnapshot', ({ sessionId }) => controller.sessionLiveSnapshot(sessionId));
}
