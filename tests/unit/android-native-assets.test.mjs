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
    "values/ic_launcher_background.xml"
  ]) {
    assert.ok(fs.statSync(path.join(canonical, relative)).size > 0, relative);
  }
  assert.equal(
    hash(path.join(canonical, "mipmap-xxxhdpi/ic_launcher.png")),
    "f6ef96228766649f0cdb10dbe2876d34acdd74d52b238476627583bbdf6f8409"
  );
  const provisioning = fs.readFileSync("scripts/prepare-android-firebase.mjs", "utf8");
  assert.match(provisioning, /src-tauri\/icons\/android/);
  assert.match(provisioning, /fs\.cpSync/);
  assert.match(provisioning, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  const androidConfig = fs.readFileSync("src-tauri/tauri.android.conf.json", "utf8");
  assert.match(androidConfig, /prepare-android-firebase\.mjs/);
});
