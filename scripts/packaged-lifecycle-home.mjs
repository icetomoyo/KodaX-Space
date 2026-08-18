// Isolated packaged-lifecycle homes must survive KodaX exit-settlement
// path checks. macOS `/tmp` is a symlink to `/private/tmp`; a home created
// on the alias is rejected as `owner_unverified`.

export async function resolvePackagedLifecycleHome({
  platform,
  configuredKodaXHome,
  tmpdir,
  mkdtemp,
  realpath,
  join,
  dirname,
  resolve,
}) {
  const darwinTmpdir = platform === 'darwin' ? await realpath('/tmp') : undefined;
  const ownsHomeDir = platform !== 'win32' || !configuredKodaXHome;
  if (!ownsHomeDir) {
    const kodaxHome = resolve(configuredKodaXHome);
    return {
      ownsHomeDir,
      homeDir: dirname(kodaxHome),
      kodaxHome,
      tmpdir: darwinTmpdir,
    };
  }
  const root = darwinTmpdir ?? tmpdir();
  const homeDir = await realpath(await mkdtemp(join(root, 'kodax-space-asar-probe-')));
  return {
    ownsHomeDir,
    homeDir,
    kodaxHome: join(homeDir, '.kodax'),
    tmpdir: darwinTmpdir,
  };
}
