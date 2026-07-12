import { registerChannelWithEvent } from './register.js';
import { isRendererTarget } from './push.js';
import { spaceControlRendererBroker } from '../space-control/runtime.js';

export function registerSpaceControlChannels(): void {
  registerChannelWithEvent('spaceControl.resolve', (input, event) => {
    if (!isRendererTarget(event.sender)) {
      throw new Error('space control result rejected: sender is not the primary renderer');
    }
    if (!spaceControlRendererBroker.resolve(input)) {
      throw new Error('space control result rejected: request is unknown, mismatched, or late');
    }
    return { accepted: true };
  });
}
