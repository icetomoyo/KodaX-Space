import { registerChannel } from './register.js';
import { updateSandboxSdkDoctorResult } from '../kodax/kodax-sdk-probe.js';
import { SandboxController, type SandboxSdkFacade } from '../kodax/sandbox-controller.js';

export const sandboxController = new SandboxController({
  loadSdk: async (): Promise<SandboxSdkFacade> => import('@kodax-ai/kodax/sandbox'),
  onDoctor: (capability, doctor) => {
    updateSandboxSdkDoctorResult(capability, doctor);
  },
});

export function registerSandboxChannels(): void {
  registerChannel('sandbox.status', async () => sandboxController.status());
  registerChannel('sandbox.refresh', async () => sandboxController.refresh());
  registerChannel('sandbox.setup', async (input) => sandboxController.setup(input));
}
