const fs = require('node:fs');
const path = require('node:path');
const ResEdit = require('resedit');

function valueOrFallback(value, fallback) {
  return value == null || value === '' ? fallback : String(value);
}

async function resolveIconPath(packager) {
  if (typeof packager.getIconPath !== 'function') {
    return null;
  }
  const iconPath = await packager.getIconPath();
  return iconPath && fs.existsSync(iconPath) ? iconPath : null;
}

function toWindowsVersion(value) {
  const parts = String(value)
    .split('.')
    .slice(0, 4)
    .map((part) => {
      const parsed = Number.parseInt(part, 10);
      return Number.isFinite(parsed) ? Math.max(0, Math.min(65535, parsed)) : 0;
    });
  while (parts.length < 4) {
    parts.push(0);
  }
  return parts;
}

function patchExecutable({ exePath, iconPath, fileVersion, productVersion, stringValues }) {
  const executable = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const resources = ResEdit.NtExecutableResource.from(executable);
  const versionInfos = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);

  if (versionInfos.length === 0) {
    throw new Error(`[afterPack] cannot patch Windows version resources; none found in ${exePath}`);
  }

  const fileVersionParts = toWindowsVersion(fileVersion);
  const productVersionParts = toWindowsVersion(productVersion);

  for (const versionInfo of versionInfos) {
    const translations = versionInfo.getAllLanguagesForStringValues();
    const targets =
      translations.length > 0
        ? translations
        : [
            {
              lang: typeof versionInfo.lang === 'number' ? versionInfo.lang : 1033,
              codepage: 1200,
            },
          ];

    for (const translation of targets) {
      versionInfo.setFileVersion(...fileVersionParts, translation.lang);
      versionInfo.setProductVersion(...productVersionParts, translation.lang);
      versionInfo.setStringValues(translation, stringValues);
    }
    versionInfo.outputToResourceEntries(resources.entries);
  }

  if (iconPath) {
    const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
    const existingGroup = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)[0];
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      existingGroup?.id ?? 1,
      existingGroup?.lang ?? 1033,
      iconFile.icons.map((item) => item.data),
    );
  }

  resources.outputResource(executable);
  fs.writeFileSync(exePath, Buffer.from(executable.generate()));
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const appInfo = context.packager.appInfo;
  const productName = valueOrFallback(appInfo.productName, 'KodaX Space');
  const productFilename = valueOrFallback(appInfo.productFilename, productName);
  const exeFileName = `${productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeFileName);

  if (!fs.existsSync(exePath)) {
    throw new Error(`[afterPack] cannot patch Windows exe resources; missing ${exePath}`);
  }

  const shortVersion = valueOrFallback(appInfo.shortVersion, appInfo.version);
  const productVersion = valueOrFallback(
    appInfo.shortVersionWindows,
    typeof appInfo.getVersionInWeirdWindowsForm === 'function'
      ? appInfo.getVersionInWeirdWindowsForm()
      : shortVersion,
  );

  const stringValues = {
    FileDescription: productName,
    ProductName: productName,
    LegalCopyright: valueOrFallback(appInfo.copyright, ''),
    InternalName: path.basename(exeFileName, '.exe'),
    OriginalFilename: '',
  };
  if (appInfo.companyName) {
    stringValues.CompanyName = String(appInfo.companyName);
  }

  const iconPath = await resolveIconPath(context.packager);
  patchExecutable({
    exePath,
    iconPath,
    fileVersion: shortVersion,
    productVersion,
    stringValues,
  });

  console.log(`[afterPack] patched Windows exe resources: ${exePath}`);
};
