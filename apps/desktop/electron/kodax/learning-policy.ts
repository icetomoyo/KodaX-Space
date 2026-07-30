export function areLearningMutationsEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.SPACE_DISABLE_LEARNING_MUTATIONS !== '1';
}
