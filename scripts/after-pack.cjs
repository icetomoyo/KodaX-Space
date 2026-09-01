// Unified afterPack hook (runs per target after electron-builder copies files,
// before the installer/distributable is produced).
//
// 1. Restore platform-pruned KodaX native files. electron-builder drops
//    *.exe/*.dll from node_modules on non-Windows platforms
//    (app-builder-lib getNodeModuleExcludedExts, issue #1738). The KodaX
//    dist/native bundle must stay byte-complete on every release target: the
//    packaged smoke verifies each manifest-pinned artifact physically inside
//    app.asar.unpacked, and the SDK spawns the Windows sandbox executable by
//    filesystem path. Files are only added back from the exact locked install
//    in node_modules — nothing is overwritten or removed.
// 2. On Windows, patch exe version/icon resources (see after-pack-win-rcedit.cjs).

const fs = require('node:fs');
const path = require('node:path');

function listFilesRecursive(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) out.push(fullPath);
    }
  }
  return out;
}

function restorePrunedNativeFiles(context) {
  const repoRoot = path.resolve(__dirname, '..');
  const sourceRoot = path.join(
    repoRoot,
    'node_modules',
    '@kodax-ai',
    'kodax',
    'dist',
    'native',
  );
  if (!fs.existsSync(sourceRoot)) {
    throw new Error('[afterPack] KodaX native source bundle missing: ' + sourceRoot);
  }

  const resourcesDir =
    context.electronPlatformName === 'darwin'
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : path.join(context.appOutDir, 'resources');
  const destinationRoot = path.join(
    resourcesDir,
    'app.asar.unpacked',
    'node_modules',
    '@kodax-ai',
    'kodax',
    'dist',
    'native',
  );

  let restored = 0;
  for (const sourceFile of listFilesRecursive(sourceRoot)) {
    const relative = path.relative(sourceRoot, sourceFile);
    const destinationFile = path.join(destinationRoot, relative);
    if (fs.existsSync(destinationFile)) continue;
    fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
    fs.copyFileSync(sourceFile, destinationFile);
    restored += 1;
    console.log(`[afterPack] restored pruned KodaX native artifact: ${relative}`);
  }
  if (restored === 0) {
    console.log('[afterPack] KodaX native bundle already complete in app.asar.unpacked');
  }
}

module.exports = async function afterPack(context) {
  restorePrunedNativeFiles(context);
  await require('./after-pack-win-rcedit.cjs')(context);
};
