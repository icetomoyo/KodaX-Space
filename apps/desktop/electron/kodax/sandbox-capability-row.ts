import type { SpaceCapability } from '@kodax-space/space-ipc-schema';
import type { SandboxSdkCapability } from './kodax-sdk-probe.js';

export function sandboxCommandCapability(capability: SandboxSdkCapability): SpaceCapability {
  if (capability.status === 'available') {
    if (capability.readiness === 'ready') {
      return {
        id: 'sandbox.command',
        label: 'KodaX command sandbox',
        status: 'partial',
        detail:
          `KodaX sandbox doctor confirms command containment v${capability.version} is ready through ` +
          `${capability.backend} with ASRT ${capability.asrtVersion}. This command-level primitive ` +
          'does not complete Space F138 native-resource hardening.',
        since: '0.1.34',
      };
    }
    if (capability.readiness === 'setup-required') {
      return {
        id: 'sandbox.command',
        label: 'KodaX command sandbox',
        status: 'blocked',
        detail:
          `The fail-closed KodaX sandbox facade is present, but doctor reports setup is required ` +
          `(${capability.diagnosticCount} bounded diagnostic(s)). Ordinary calls never trigger setup; ` +
          'use the explicit Runtime settings action and confirm any elevation before Space claims command containment.',
        since: '0.1.34',
      };
    }
    return {
      id: 'sandbox.command',
      label: 'KodaX command sandbox',
      status: capability.readiness === 'checking' ? 'partial' : 'blocked',
      detail:
        capability.readiness === 'checking'
          ? `The fail-closed KodaX sandbox facade v${capability.version} is present; readiness is still being checked. Space does not claim OS containment from API shape alone.`
          : `The fail-closed KodaX sandbox facade is present, but doctor could not confirm a usable backend (${capability.diagnosticCount} bounded diagnostic(s)). Commands requiring containment return structured no-execution state.`,
      since: '0.1.34',
    };
  }
  return {
    id: 'sandbox.command',
    label: 'KodaX command sandbox',
    status: 'planned',
    detail:
      'The KodaX sandbox facade has not been probed yet. Space does not claim OS containment until the fail-closed public contract is available.',
  };
}
