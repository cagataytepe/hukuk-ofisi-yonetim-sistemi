import fs from 'node:fs';
import path from 'node:path';

// `tauri ios init` sonrasında çalışır: oluşturulan Xcode projesine Push Notifications yeteneğini ekler.
// Değer "development" kalır; App Store/TestFlight dışa aktarımında Xcode dağıtım profiline göre "production" yazar.
const root = path.resolve('src-tauri/gen/apple');
if (!fs.existsSync(path.join(root, 'project.yml'))) {
  throw new Error('Run tauri ios init before iOS push provisioning.');
}

const targets = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.endsWith('_iOS'));
if (targets.length !== 1) {
  throw new Error(`Expected exactly one *_iOS target folder under ${root}, found ${targets.length}.`);
}

const entitlementsPath = path.join(root, targets[0].name, `${targets[0].name}.entitlements`);
const emptyPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyLists/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
</dict>
</plist>
`;
let text = fs.existsSync(entitlementsPath) ? fs.readFileSync(entitlementsPath, 'utf8') : emptyPlist;
text = text.replace(/<dict\s*\/>/, '<dict>\n</dict>');
if (!text.includes('<key>aps-environment</key>')) {
  const close = text.lastIndexOf('</dict>');
  if (close < 0) throw new Error(`Unexpected entitlements format in ${entitlementsPath}.`);
  text = `${text.slice(0, close)}\t<key>aps-environment</key>\n\t<string>development</string>\n${text.slice(close)}`;
}
fs.writeFileSync(entitlementsPath, text);

const projectYml = fs.readFileSync(path.join(root, 'project.yml'), 'utf8');
if (!projectYml.includes(`${targets[0].name}.entitlements`)) {
  throw new Error('Generated project.yml does not reference the iOS entitlements file.');
}

console.log(`Push Notifications entitlement provisioned in ${path.relative(process.cwd(), entitlementsPath)}.`);

// `tauri ios init` Tauri'nin varsayılan ikonlarını yazar; BKT ikonları kaynaktan kopyalanır.
// Kaynak ikonlar saydamlık kanalı içermez (App Store 1024px ikonda alfa kabul etmez).
function findAppIconSet(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === 'AppIcon.appiconset') return full;
    if (entry.name === 'build' || entry.name === 'Externals') continue;
    const nested = findAppIconSet(full);
    if (nested) return nested;
  }
  return null;
}
const iconSource = path.resolve('src-tauri/icons/ios');
const iconSet = findAppIconSet(root);
if (!iconSet) throw new Error('Generated AppIcon.appiconset was not found.');
const contents = JSON.parse(fs.readFileSync(path.join(iconSet, 'Contents.json'), 'utf8'));
const expected = [...new Set((contents.images || []).map((image) => image.filename).filter(Boolean))];
const missing = expected.filter((name) => !fs.existsSync(path.join(iconSource, name)));
if (!expected.length || missing.length) {
  throw new Error(`BKT iOS icons missing for: ${missing.join(', ') || 'Contents.json has no filenames'}.`);
}
for (const name of expected) fs.copyFileSync(path.join(iconSource, name), path.join(iconSet, name));
console.log(`${expected.length} BKT app icons copied into ${path.relative(process.cwd(), iconSet)}.`);
