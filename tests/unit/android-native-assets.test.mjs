import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function hash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function pngInfo(filePath) {
  const png = fs.readFileSync(filePath);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", filePath);
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    colorType: png[25]
  };
}

test("Android build provisioning restores canonical BKT launcher resources", () => {
  const canonical = path.resolve("src-tauri/icons/android");
  for (const relative of [
    "mipmap-mdpi/ic_launcher.png",
    "mipmap-anydpi-v26/ic_launcher.xml",
    "mipmap-anydpi-v26/ic_launcher_round.xml",
    "drawable/ic_stat_bkt.xml",
    "values/ic_launcher_background.xml"
  ]) {
    assert.ok(fs.statSync(path.join(canonical, relative)).size > 0, relative);
  }
  const densities = {
    mdpi: { foreground: 108, legacy: 48 },
    hdpi: { foreground: 162, legacy: 72 },
    xhdpi: { foreground: 216, legacy: 96 },
    xxhdpi: { foreground: 324, legacy: 144 },
    xxxhdpi: { foreground: 432, legacy: 192 }
  };
  for (const [density, sizes] of Object.entries(densities)) {
    const folder = path.join(canonical, `mipmap-${density}`);
    const foreground = pngInfo(path.join(folder, "ic_launcher_foreground.png"));
    assert.deepEqual([foreground.width, foreground.height], [sizes.foreground, sizes.foreground]);
    assert.equal(foreground.colorType, 6, `${density} foreground must retain RGBA transparency`);
    for (const legacyName of ["ic_launcher.png", "ic_launcher_round.png"]) {
      const legacy = pngInfo(path.join(folder, legacyName));
      assert.deepEqual([legacy.width, legacy.height], [sizes.legacy, sizes.legacy]);
      assert.equal(legacy.colorType, 6, `${density}/${legacyName} must retain RGBA transparency`);
    }
  }
  for (const adaptiveName of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
    const adaptive = fs.readFileSync(path.join(canonical, "mipmap-anydpi-v26", adaptiveName), "utf8");
    assert.match(adaptive, /@mipmap\/ic_launcher_foreground/);
    assert.doesNotMatch(adaptive, /@drawable\/ic_launcher_foreground/);
  }
  for (const wrongOverride of [
    "drawable/ic_launcher_foreground.xml",
    "mipmap-anydpi/ic_launcher.xml",
    "mipmap-anydpi/ic_launcher_round.xml"
  ]) {
    assert.equal(fs.existsSync(path.join(canonical, wrongOverride)), false, wrongOverride);
  }
  const notificationIcon = path.join(canonical, "drawable/ic_stat_bkt.xml");
  const pluginNotificationIcon = path.resolve("src-tauri/plugins/push/android/src/main/res/drawable/ic_stat_bkt.xml");
  assert.equal(hash(notificationIcon), hash(pluginNotificationIcon));
  assert.doesNotMatch(fs.readFileSync(notificationIcon, "utf8"), /#FFFFFF[^F]/);
  const provisioning = fs.readFileSync("scripts/prepare-android-firebase.mjs", "utf8");
  assert.match(provisioning, /src-tauri\/icons\/android/);
  assert.match(provisioning, /fs\.cpSync/);
  assert.match(provisioning, /fs\.rmSync\(staleLauncherOverride/);
  assert.match(provisioning, /mipmap-anydpi\/ic_launcher\.xml/);
  assert.match(provisioning, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  assert.match(provisioning, /BKT_PUSH_NOTIFICATION/);
  const pluginManifest = fs.readFileSync("src-tauri/plugins/push/android/src/main/AndroidManifest.xml", "utf8");
  assert.match(pluginManifest, /default_notification_icon/);
  assert.match(pluginManifest, /@drawable\/ic_stat_bkt/);
  const nativePlugin = fs.readFileSync("src-tauri/plugins/push/android/src/main/java/PushPlugin.kt", "utf8");
  assert.match(nativePlugin, /getSharedPreferences\(NAVIGATION_STORE/);
  assert.match(nativePlugin, /override fun onNewIntent/);
  assert.match(nativePlugin, /"hearings"/);
  const nativeService = fs.readFileSync(
    "src-tauri/plugins/push/android/src/main/java/BktFirebaseMessagingService.kt", "utf8");
  assert.match(nativeService, /BKT_PUSH_NOTIFICATION/);
  assert.match(nativeService, /ic_stat_bkt/);
  const androidConfig = fs.readFileSync("src-tauri/tauri.android.conf.json", "utf8");
  assert.match(androidConfig, /prepare-android-firebase\.mjs/);
});
