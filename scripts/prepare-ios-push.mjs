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
