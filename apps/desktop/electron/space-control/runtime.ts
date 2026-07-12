import { pushToRenderer } from '../ipc/push.js';
import { RendererActionBroker } from './renderer-broker.js';
import { SpaceControlService } from './service.js';

export const spaceControlRendererBroker = new RendererActionBroker({
  push: (payload) => pushToRenderer('spaceControl.requested', payload),
});

export const spaceControlService = new SpaceControlService({
  broker: spaceControlRendererBroker,
});
