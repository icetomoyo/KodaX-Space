import type {
  LearnedCapabilityActionT,
  LearnedCapabilityProjectionT,
  SpaceCoderConnectionProjectionT,
} from '@kodax-space/space-ipc-schema';

const ACTIONABLE_ATTENTION_LIFECYCLES = new Set<LearnedCapabilityProjectionT['lifecycle']>([
  'ready',
  'testing',
  'quarantined',
]);

export function canShowLearningSafetySurface(connection: SpaceCoderConnectionProjectionT): boolean {
  if (
    (connection.state !== 'ready' && connection.state !== 'degraded') ||
    connection.stale ||
    !connection.runtimeId
  ) {
    return false;
  }
  const supports = (id: string): boolean =>
    connection.capabilities.some(
      (capability) => capability.id === id && capability.available && capability.version >= 1,
    );
  return supports('runtime.learning') && supports('runtime.learning.skillLoop');
}

export function actionableLearningAttention(
  items: readonly LearnedCapabilityProjectionT[],
): number {
  return items.filter(
    (item) =>
      item.carrier === 'skill' &&
      item.availableActions.length > 0 &&
      ACTIONABLE_ATTENTION_LIFECYCLES.has(item.lifecycle),
  ).length;
}

export function learningActionNeedsDangerTone(action: LearnedCapabilityActionT): boolean {
  return action === 'reject' || action === 'disable' || action === 'rollback';
}
