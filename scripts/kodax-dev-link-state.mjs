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
  try {
    sdkLstat = fs.lstatSync(sdkDir);
    sdkRealpath = fs.realpathSync(sdkDir);
  } catch {
    return { linked: false };
  }

  if (!isInside(spaceRoot, sdkRealpath)) {
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
      if (!isInside(spaceRoot, fs.realpathSync(path.join(sdkDir, child)))) {
        return { linked: true, layout: 'staging' };
      }
    } catch {
      // A missing optional staging child does not identify a published package.
    }
  }

  return { linked: false };
}
