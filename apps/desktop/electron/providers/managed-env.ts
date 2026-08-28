const managedEnvOriginals = new Map<string, string | undefined>();

function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Return only the environment value that existed before Space injected keychain state. */
export function externalProviderEnvValue(name: string): string | undefined {
  const value = managedEnvOriginals.has(name) ? managedEnvOriginals.get(name) : process.env[name];
  return nonEmpty(value);
}

/** Return values only, so diagnostics can redact both sides of a managed env replacement. */
export function managedProviderSecretValues(): readonly string[] {
  const values = new Set<string>();
  for (const [name, original] of managedEnvOriginals) {
    const external = nonEmpty(original);
    const managed = nonEmpty(process.env[name]);
    if (external) values.add(external);
    if (managed) values.add(managed);
  }
  return [...values];
}

export function setManagedProviderEnv(name: string, value: string): void {
  if (!managedEnvOriginals.has(name)) managedEnvOriginals.set(name, process.env[name]);
  process.env[name] = value;
}

export function restoreManagedProviderEnv(name: string): void {
  if (!managedEnvOriginals.has(name)) return;
  const original = managedEnvOriginals.get(name);
  if (original === undefined) delete process.env[name];
  else process.env[name] = original;
  managedEnvOriginals.delete(name);
}

export function restoreManagedProviderEnvs(): void {
  for (const name of [...managedEnvOriginals.keys()]) restoreManagedProviderEnv(name);
}
