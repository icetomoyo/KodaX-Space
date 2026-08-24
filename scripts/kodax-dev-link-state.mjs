import fs from 'node:fs';
import path from 'node:path';

export const KODAX_DEV_LINK_MARKER = '.kodax-space-dev-link';

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}

function readLinkTarget(entryPath, fallback) {
  try {
    return fs.readlinkSync(entryPath);
  } catch {
    return fallback;
  }
}

/**
 * Detect both supported local SDK layouts:
 *
 * 1. node_modules/@kodax-ai/kodax itself is an external symlink/junction.
 * 2. link-kodax.mjs created a local staging directory whose dist,
 *    node_modules, and scripts children point at the sibling KodaX checkout.
 *
 * electron-builder must never consume either layout. Nested staging junctions
 * are especially important: realpath(SDK_DIR) stays under Space, so checking
 * only the package root silently packages an incomplete dependency tree.
 */
export function inspectKodaxDevLink(spaceRoot, sdkDir) {
  let sdkLstat;
  let sdkRealpath;
  let sdkPathFromCanonicalParent;
  try {
    sdkLstat = fs.lstatSync(sdkDir);
    sdkRealpath = fs.realpathSync(sdkDir);
    sdkPathFromCanonicalParent = path.join(
      fs.realpathSync(path.dirname(sdkDir)),
      path.basename(sdkDir),
    );
  } catch {
    return { linked: false };
  }

  // pnpm installs Registry packages through a junction into its workspace-local
  // virtual store. That target remains inside Space and is safe for packaging;
  // treating it as a development link would let npm ci delete the saved target
  // before pack.mjs tries to restore it.
  const pnpmVirtualStore = path.join(spaceRoot, 'node_modules', '.pnpm');
  const isPnpmInstalledPackage = isInside(pnpmVirtualStore, sdkRealpath);

  // Other package-root reparse points are development state even when they
  // target another directory under the Space checkout. Compare the SDK realpath
  // to the path beneath its canonical parent so an ancestor alias such as
  // macOS /var -> /private/var is not mistaken for a package-root link.
  if (
    !isPnpmInstalledPackage &&
    (sdkLstat.isSymbolicLink() ||
      path.resolve(sdkRealpath) !== path.resolve(sdkPathFromCanonicalParent))
  ) {
    return {
      linked: true,
      layout: 'direct',
      target: sdkLstat.isSymbolicLink() ? readLinkTarget(sdkDir, sdkRealpath) : sdkRealpath,
      type: process.platform === 'win32' ? 'junction' : 'dir',
    };
  }

  if (fs.existsSync(path.join(sdkDir, KODAX_DEV_LINK_MARKER))) {
    return { linked: true, layout: 'staging' };
  }

  // Compatibility with staging directories created before the marker existed.
  for (const child of ['dist', 'node_modules', 'scripts']) {
    try {
      const childPath = path.join(sdkDir, child);
      const installedChildPath = path.join(sdkRealpath, child);
      const childLstat = fs.lstatSync(childPath);
      const childRealpath = fs.realpathSync(childPath);
      if (
        childLstat.isSymbolicLink() ||
        path.resolve(childRealpath) !== path.resolve(installedChildPath) ||
        !isInside(spaceRoot, childRealpath)
      ) {
        return { linked: true, layout: 'staging' };
      }
    } catch {
      // A missing optional staging child does not identify a published package.
    }
  }

  return { linked: false };
}
