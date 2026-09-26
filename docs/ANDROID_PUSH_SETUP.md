# Android push setup (prepared, not deployed)

No production migration, Edge Function, cron, Firebase resource, or secret was created by this branch.

## Firebase and Android

1. In Firebase Console, create or choose the real BKT Hukuk Firebase project. Add an Android app with package `tr.com.bkthukuk.ofisyonetim`.
2. Download that app's `google-services.json` and place it locally at `src-tauri/firebase/google-services.json`. This path is Git-ignored. Do not use a placeholder config. The Android config is not a service-account private key.
3. Run `npm.cmd run tauri -- android init --ci --skip-targets-install`, then the normal Android build. The Android-only `beforeBuildCommand` runs `node scripts/prepare-android-firebase.mjs` first and fails clearly when config is missing. The prepare step validates package/project data, copies config into generated `src-tauri/gen/android/app/google-services.json`, and patches the generated Gradle files. It is idempotent after each Android init. The native FCM service itself lives in source-controlled `src-tauri/plugins/push`.
4. For CI, set GitHub Actions secret `FIREBASE_GOOGLE_SERVICES_JSON_BASE64` to the Base64 encoding of the same Android config file. The workflows provision it after Android init, without printing the value. No service-account private key belongs in GitHub Actions for APK compilation.

## Supabase server (release approval required)

1. Verify project link and migration history, then apply only the new `202609210034_android_push_notifications.sql` migration with `npx.cmd supabase db push` after approval. The `database/migration/034_...` copy is documentation for this repository's dual migration convention; do not apply it a second time.
2. In Google Cloud for the same Firebase project, enable Firebase Cloud Messaging API (HTTP v1). Create a dedicated service account with the minimal Firebase Cloud Messaging API send role and generate its JSON private key via a secure administrative channel. Never paste it into chat, frontend files, APK, or Git.
3. In Supabase Edge Function secrets, set `FIREBASE_SERVICE_ACCOUNT_JSON` to that private JSON and `PUSH_CRON_TOKEN` to a strong random token. The hosted Edge runtime supplies `SUPABASE_URL` and `SUPABASE_SECRET_KEYS`; the worker uses the latter's `default` server key. If the project has no default key, configure a dedicated `PUSH_SUPABASE_SECRET_KEY` only inside Edge secrets. Neither key nor the Firebase private key may reach browser clients.
4. Deploy with `npx.cmd supabase functions deploy dispatch-push-notifications --no-verify-jwt` after confirming the linked project. JWT verification is disabled only because the function verifies its own `x-bkt-push-cron` header against `PUSH_CRON_TOKEN`. Test an unauthorized request (401) before activation. Never treat the endpoint as public.
5. Put the complete deployed function URL and the same cron token into Supabase Vault as `bkt_push_edge_url` and `bkt_push_cron_token`. After reviewing SQL and obtaining approval, run `scripts/enable-push-cron.sql` in the Supabase SQL Editor. It schedules every five minutes; it is deliberately not a migration.

## Manual device validation

Use a Play-services Android phone or Google-APIs emulator. Sign in and grant notification permission; confirm a single enabled `push_devices` row for that authenticated user, without printing the token. A Firebase Console test notification to this token should appear in foreground and background, and after ordinary app close. Android Settings **Force Stop** is a platform exception and should not be interpreted as an ordinary close.

Set a test hearing with an assigned `participant_profile_id`/`attendee_profile_id`, linked live file, and future time. Check separate 24-hour and one-hour events, correct court/file/time/client labels, and tap to file detail after warm/cold start or login. Set today's active assigned deadline/task before 09:00 Europe/Istanbul; check one aggregate notice per type, no completed/other-user notices, and no duplicate on consecutive cron runs. Disable preferences and notification permission in turn to confirm no further delivery.

## Delivery semantics

The `(device_id,event_key)` unique constraint prevents concurrent cron invocations from claiming the same event. Explicit transient FCM failures retry with capped exponential backoff and five attempts. `UNREGISTERED` disables the device. A worker crash after FCM accepts a message but before the database confirms it leaves a `processing` row for manual review: automatic replay could create a duplicate, so this first version intentionally favors at-most-once delivery over guaranteed delivery. Review stale `processing` rows operationally; never auto-retry them without reconciliation.
