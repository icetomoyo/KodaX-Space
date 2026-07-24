import fs from 'node:fs/promises';
import path from 'node:path';

type SdkSkillsModule = typeof import('@kodax-ai/kodax/skills');

export interface SpaceBuiltinPathContext {
  isPackaged: boolean;
  mainDirectory: string;
  resourcesPath: string;
}

let registeredRoot: string | null = null;
let unregisterCurrentRoot: (() => void) | null = null;

export function resolveSpaceBuiltinSkillsPath(context: SpaceBuiltinPathContext): string {
  return context.isPackaged
    ? path.resolve(context.resourcesPath, 'builtin-skills')
    : path.resolve(context.mainDirectory, '..', 'resources', 'builtin-skills');
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function isSpaceBuiltinSkillPath(candidate: string | undefined): boolean {
  if (!candidate || registeredRoot === null) return false;
  const root = comparablePath(registeredRoot);
  const resolved = comparablePath(candidate);
  const relative = path.relative(root, resolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function discoverSkillNames(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const stat = await fs.stat(path.join(root, entry.name, 'SKILL.md'));
      if (stat.isFile()) names.push(entry.name);
    } catch {
      // Non-skill support directories are ignored.
    }
  }
  return names.sort();
}

/**
 * Register Space-shipped skills with the SDK before the first registry discovery.
 *
 * Electron packages this tree as an extra resource rather than inside app.asar so
 * skill-owned Python/Node/shell scripts keep normal executable filesystem paths.
 * The SDK registration API labels the path as `plugin`; Space maps this vetted,
 * installer-owned root back to `builtin` for UI metadata while retaining the
 * SDK's conservative plugin classification at security boundaries.
 */
export async function registerSpaceBuiltinSkills(
  root: string,
): Promise<{ root: string; skillNames: string[] }> {
  const normalizedRoot = path.resolve(root);
  const skillNames = await discoverSkillNames(normalizedRoot);
  if (skillNames.length === 0) {
    throw new Error(`[space-builtins] no SKILL.md found under ${normalizedRoot}`);
  }
  if (
    registeredRoot !== null &&
    comparablePath(registeredRoot) === comparablePath(normalizedRoot)
  ) {
    return { root: normalizedRoot, skillNames };
  }

  const sdk: SdkSkillsModule = await import('@kodax-ai/kodax/skills');
  unregisterCurrentRoot?.();
  unregisterCurrentRoot = sdk.registerPluginSkillPath(normalizedRoot);
  registeredRoot = normalizedRoot;
  return { root: normalizedRoot, skillNames };
}

export function _resetSpaceBuiltinSkillsForTests(): void {
  unregisterCurrentRoot?.();
  unregisterCurrentRoot = null;
  registeredRoot = null;
}
