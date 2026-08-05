import type {
  InvokeChannelName,
  SpaceRuntimeProfileProjectionT,
  SpaceSessionLiveProjectionT,
} from '@kodax-space/space-ipc-schema';

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
  _controller: RuntimeProjectionController = runtimeProjectionController,
  register: RuntimeChannelRegistrar = registerChannel,
  readSessionLiveSnapshot: (sessionId: string) => Promise<SpaceSessionLiveProjectionT> = (
    sessionId,
  ) => runtimeHostAdapter.readSessionLiveSnapshot(sessionId),
  readRuntimeProfileSnapshot: () => Promise<SpaceRuntimeProfileProjectionT> = () =>
    runtimeHostAdapter.readRuntimeProfileSnapshot(),
): void {
  register('runtime.profileSnapshot', () => readRuntimeProfileSnapshot());
  register('session.liveSnapshot', ({ sessionId }) => readSessionLiveSnapshot(sessionId));
}
