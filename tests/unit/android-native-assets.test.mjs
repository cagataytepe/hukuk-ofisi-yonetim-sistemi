import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function hash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("Android build provisioning restores canonical BKT launcher resources", () => {
  const canonical = path.resolve("src-tauri/icons/android");
  for (const relative of [
    "mipmap-mdpi/ic_launcher.png",
    "mipmap-xxxhdpi/ic_launcher.png",
    "mipmap-xxxhdpi/ic_launcher_foreground.png",
    "mipmap-xxxhdpi/ic_launcher_round.png",
    "mipmap-anydpi-v26/ic_launcher.xml",
    "mipmap-anydpi-v26/ic_launcher_round.xml",
    "mipmap-anydpi/ic_launcher.xml",
    "mipmap-anydpi/ic_launcher_round.xml",
    "drawable/ic_launcher_foreground.xml",
    "drawable/ic_stat_bkt.xml",
    "values/ic_launcher_background.xml"
  ]) {
    assert.ok(fs.statSync(path.join(canonical, relative)).size > 0, relative);
  }
  const foreground = fs.readFileSync(path.join(canonical, "drawable/ic_launcher_foreground.xml"), "utf8");
  assert.match(foreground, /viewportWidth="108"/);
  assert.match(foreground, /viewportHeight="108"/);
  assert.doesNotMatch(foreground, /<bitmap|scaleX|scaleY/);
  const adaptive = fs.readFileSync(path.join(canonical, "mipmap-anydpi-v26/ic_launcher.xml"), "utf8");
  assert.match(adaptive, /@drawable\/ic_launcher_foreground/);
  const notificationIcon = path.join(canonical, "drawable/ic_stat_bkt.xml");
  const pluginNotificationIcon = path.resolve("src-tauri/plugins/push/android/src/main/res/drawable/ic_stat_bkt.xml");
  assert.equal(hash(notificationIcon), hash(pluginNotificationIcon));
  assert.doesNotMatch(fs.readFileSync(notificationIcon, "utf8"), /#FFFFFF[^F]/);
  const provisioning = fs.readFileSync("scripts/prepare-android-firebase.mjs", "utf8");
  assert.match(provisioning, /src-tauri\/icons\/android/);
  assert.match(provisioning, /fs\.cpSync/);
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
