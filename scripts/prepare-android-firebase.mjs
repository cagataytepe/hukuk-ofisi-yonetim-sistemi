import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src-tauri/gen/android');
const source = path.resolve('src-tauri/firebase/google-services.json');
const destination = path.join(root, 'app/google-services.json');
const canonicalAndroidIcons = path.resolve('src-tauri/icons/android');
const generatedResources = path.join(root, 'app/src/main/res');
const generatedManifest = path.join(root, 'app/src/main/AndroidManifest.xml');
const encoded = process.env.FIREBASE_GOOGLE_SERVICES_JSON_BASE64;
if (!fs.existsSync(path.join(root, 'app/build.gradle.kts'))) {
  throw new Error('Run tauri android init before Firebase provisioning.');
}
if (!encoded && !fs.existsSync(source)) {
  throw new Error(`BLOCKED: real Firebase configuration required at ${source} or FIREBASE_GOOGLE_SERVICES_JSON_BASE64`);
}
const raw = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : fs.readFileSync(source, 'utf8');
const config = JSON.parse(raw);
if (!config.project_info?.project_id || !config.client?.some((entry) =>
  entry.client_info?.android_client_info?.package_name === 'tr.com.bkthukuk.ofisyonetim')) {
  throw new Error('Firebase config has no project ID or matching Android package.');
}
const rootGradle = path.join(root, 'build.gradle.kts');
const appGradle = path.join(root, 'app/build.gradle.kts');
let rootText = fs.readFileSync(rootGradle, 'utf8');
let appText = fs.readFileSync(appGradle, 'utf8');
const classpath = 'classpath("com.google.gms:google-services:4.5.0")';
if (!rootText.includes(classpath)) {
  rootText = rootText.replace('classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")',
    `classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")\n        ${classpath}`);
}
const plugin = 'apply(plugin = "com.google.gms.google-services")';
if (!appText.includes(plugin)) {
  appText = appText.replace('val tauriProperties =', `${plugin}\n\nval tauriProperties =`);
}
fs.writeFileSync(rootGradle, rootText);
fs.writeFileSync(appGradle, appText);
fs.writeFileSync(destination, raw, { mode: 0o600 });

if (!fs.existsSync(canonicalAndroidIcons) || !fs.existsSync(generatedManifest)) {
  throw new Error('Canonical BKT Android icons or generated AndroidManifest.xml is missing.');
}
for (const entry of fs.readdirSync(canonicalAndroidIcons, { withFileTypes: true })) {
  fs.cpSync(
    path.join(canonicalAndroidIcons, entry.name),
    path.join(generatedResources, entry.name),
    { recursive: true, force: true }
  );
}

let manifestText = fs.readFileSync(generatedManifest, 'utf8');
if (!manifestText.includes('android:roundIcon="@mipmap/ic_launcher_round"')) {
  manifestText = manifestText.replace(
    'android:icon="@mipmap/ic_launcher"',
    'android:icon="@mipmap/ic_launcher"\n        android:roundIcon="@mipmap/ic_launcher_round"'
  );
}
fs.writeFileSync(generatedManifest, manifestText);

console.log('Firebase config and canonical BKT Android icons provisioned for tr.com.bkthukuk.ofisyonetim.');
