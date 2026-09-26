# Android Push Implementation Report

Status: **BLOCKED: real Firebase configuration required**. Source prepared; no production activation and no APK claim.

## A. Baslangic

1. Worktrees: root `codex/mobile-desktop-fixes`, `work/mobile-dashboard-hero`, `work/release-main-beta3`, `work/enforcement-calculation-parity`, `work/mobile-enforcement-collections-hotfix`, `work/legal-interest-hotfix`, and separate Android APK CI checkout inspected.
2. Root, hero, and legal-interest worktrees were dirty; the other relevant checkouts were clean.
3. The original hero/background edits and existing enforcement/calculation changes were preserved. Six hero dirty files were copied into the new isolated worktree without modifying the source worktree.
4. Base branch: `codex/mobile-dashboard-hero`.
5. Base SHA: `4853e669518265bd1856a866e7dd269e24e82f39`.
6. New branch: `codex/android-push-notifications`.
7. New worktree: `C:\Users\lexla\Documents\Codex\2026-06-03\hukuk-b-rosu-duru-ma-ve\work\android-push-notifications`.

## B. Android

8. Firebase dependency: native plugin uses Firebase Messaging through Android BoM 34.19.0.
9. Google Services: Gradle plugin 4.5.0 and `google-services.json` provisioned after generated Android init; real config absent.
10. `BktFirebaseMessagingService` handles foreground messages and token refresh.
11. Stable channel `bkt_reminders_v1`; native and FCM lock-screen visibility are PRIVATE.
12. Android 13+ `POST_NOTIFICATIONS` permission requested after authenticated entry, with a readable permission-state command. Denial does not block login.
13. Token comes from native `FirebaseMessaging.getInstance().token` after authentication.
14. `onNewToken` triggers a native event; authenticated app re-registers the current token on event/resume. A refresh while the app process is absent is registered at next open, not from an unauthenticated background worker.
15. Logout disables the device through an authenticated RPC before Supabase sign-out; if disabling cannot be confirmed, logout does not silently continue.
16. Tauri native plugin exposes token, permission, and pending-navigation commands; mobile JS calls it only on Android.
17. Native source lives in `src-tauri/plugins/push`; ignored `gen/android` is re-provisioned by `scripts/prepare-android-firebase.mjs` after init. Android-only build command fails without real config. Both Android CI workflows use the same provisioning step.

## C. Database

18. Local next migration: `202609210034_android_push_notifications.sql`, with byte-identical `database/migration/034_android_push_notifications.sql` mirror. Not applied.
19. `push_devices`: unique FCM token, authenticated owner, enabled/disabled and timestamps.
20. `push_notification_preferences`: per-user hearing/24h/1h/deadline/task booleans, default true.
21. `push_notification_deliveries`: event/device rows, processing/retry/sent/failed, attempt count, next attempt, provider ID, error metadata.
22. Partial indexes for active devices and due retries.
23. Unique `fcm_token` and `(device_id,event_key)` prevent duplicate registration and concurrent event claims.
24. RLS enabled on all three tables.
25. Users select only own devices and edit only own preferences; device write/disable occurs via authenticated security-definer RPC. Delivery table is server-only.

## D. Server

26. Edge Function: `supabase/functions/dispatch-push-notifications`.
27. Function has `verify_jwt=false` but requires the separate strong `x-bkt-push-cron` header matching its Edge secret. No secret appears in logs.
28. FCM HTTP v1 `projects/{project_id}/messages:send`, not Legacy Server Key API.
29. Server signs a service-account JWT with WebCrypto, exchanges it at Google's OAuth token endpoint, and uses the bearer access token.
30. Required custom Edge secrets: `FIREBASE_SERVICE_ACCOUNT_JSON`, `PUSH_CRON_TOKEN`; runtime-provided `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` supply privileged DB access. `PUSH_SUPABASE_SECRET_KEY` is optional fallback if there is no default runtime secret key. CI only needs Base64 Android client config, not the service-account key.
31. Cron template: `scripts/enable-push-cron.sql`, deliberately separate from migrations and not executed. Function URL and token are read from Vault.
32. Interval: `*/5 * * * *`.
33. Scheduled instant must fall in `[now-15 minutes, now]`; no exact-second equality. Istanbul IANA zone is used.
34. Transient failures retry with 2/4/8/... minute capped backoff, at most five attempts. A crash after FCM acceptance leaves a processing row for manual review rather than duplicate-prone automatic replay.
35. FCM `UNREGISTERED` disables the device; generic `INVALID_ARGUMENT` is not assumed to mean an invalid token.

## E. Notification Rules

36. Hearing 24h title: `Yarın Duruşmanız Var`.
37. Hearing 1h title: `1 Saat Sonra Duruşmanız Var`.
38. Example body from actual joined fields: `Bakırköy 4. İş Mahkemesi • 2026/245 E.\n13:30 • Ömer Şerif Turan\nD-1007`.
39. Court: `hearings.court`, fallback `files.court_or_office`.
40. Case number: `hearings.case_file_no`, fallback `files.file_no`.
41. Time: `hearings.hearing_time`; hearing without a time is skipped, never assigned a guessed time.
42. Client/file short name: linked `files.client_name`, fallback same hearing's `hearings.client_name`.
43. Internal BKT number: linked `files.display_id` when available.
44. Only allowlisted fields enter title/body. TCKN/VKN-like 10/11 digit strings, e-mail, phone, IBAN and money patterns are stripped; no notes, address, bank/account, debt or collections fields are queried into body. This is unit-tested, not yet verified against production data.
45. Today-due active deadlines produce a per-user aggregate at 09:00 Istanbul.
46. Today-due active tasks assigned by `responsible_profile_id` produce a per-user aggregate at 09:00 Istanbul.
47. `Intl.DateTimeFormat(..., timeZone: 'Europe/Istanbul')` maps date+time to UTC; daily date-only semantics use Istanbul local date, not server UTC date.

## F. Navigation

48. Hearing tap carries only route and internal IDs; native plugin extracts foreground intent and background FCM launcher extras.
49. Target: existing mobile `file-detail` route; normal repository access/RLS remains enforced.
50. Cold start reads pending navigation after Tauri initialization.
51. Without session, login stays visible and the validated destination is retained for post-login navigation.
52. Deadline tap opens the `deadlines` list.
53. Task tap opens the `tasks` list.

## G. Tests

54. Token lifecycle plans (first/repeat/refresh/denied/account switch) and SQL unique/RPC assertions: unit pass; actual native+DB integration not run.
55. Hearing 24h/1h, delayed cron, status/deleted exclusion: unit pass.
56. Two-file body isolation, court/number/time/client/internal ID and sensitive-field redaction: unit pass.
57. Deadline today/tomorrow/yesterday, grouping, completion and preference: unit pass.
58. Task due-date, assignee isolation, grouping and completion: unit pass.
59. Event-key separation and database unique constraint statically checked; concurrent live Postgres claim test not run.
60. Retry/backoff and invalid-token classification: unit pass.
61. Mocked FCM endpoint, bearer header, notification/data payload, success/invalid/transient: unit pass. Real OAuth credential exchange not run.
62. Route validation and cold-start queuing code: unit pass; Android foreground/background/cold-start tap requires device test.
63. Calculation/reference unit suite: 44 passed.
64. Enforcement hydration/parity cases, including I-1006/I-1007, are included in those 44 passed.
65. Desktop live E2E not run: isolated worktree has no test credentials, and the full suite may write to production.
66. Mobile unauthenticated shell E2E: 1 passed. Authenticated mobile E2E not run for same production-safety reason.
67. `npm.cmd run build`: passed, existing large Vite chunk warning only. `cargo check`: passed. Mobile logo asset test: 1 passed. `git diff --check`: passed.
68. Android native APK compile/runtime: **BLOCKED: real Firebase configuration required**. Kotlin/device behavior is not claimed verified.

## H. Firebase / Deployment (manual, approval required)

69. Create/select a real Firebase project, add Android app with the exact package, download client config; enable FCM API; provision dedicated sender service account via secure admin process.
70. Required project data: actual Firebase project ID in client config and service-account JSON; no guessed ID is used.
71. Download `google-services.json` from the Android app entry in Firebase Console.
72. Local exact path: `C:\Users\lexla\Documents\Codex\2026-06-03\hukuk-b-rosu-duru-ma-ve\work\android-push-notifications\src-tauri\firebase\google-services.json` (Git-ignored).
73. Generate/download the sender service-account private JSON through Google Cloud IAM for the same Firebase project; never put it in chat or Git.
74. Set Edge secrets through Supabase Dashboard as described in item 30; never put values on a CLI command line or in the repository.
75. Set GitHub Actions secret `FIREBASE_GOOGLE_SERVICES_JSON_BASE64` to the Android client config Base64; no Firebase private key in GitHub Actions.
76. After checking linked project and migration history, apply via `npx.cmd supabase db push` only after explicit approval.
77. After secrets and approval, deploy with `npx.cmd supabase functions deploy dispatch-push-notifications --no-verify-jwt`; verify 401 without custom header.
78. Put full function URL and cron token in Vault under `bkt_push_edge_url`/`bkt_push_cron_token`; review and run `scripts/enable-push-cron.sql` only after approval.

## I. Device Test Plan

79. On a Play-services Android device, sign in, grant notification permission, verify one active `push_devices` row for the authenticated user. Handle the token only in a secure admin console.
80. Send a Firebase Console test notification to that token; Console-only payload is for basic delivery, not app-specific deep-link verification.
81. Foreground: verify one native system notification and no duplicate.
82. Background: verify one Android system-tray notification.
83. Normal app close: verify tray delivery. Android Settings Force Stop is a distinct OS restriction and is not bypassed.
84. Set a real future assigned hearing; inspect separate 24h and 1h reminders, contents and one delivery row per event/device.
85. Add an active deadline due today before 09:00 Istanbul; verify aggregate and exclude completed/deleted/other-day records.
86. Add an assigned active task due today before 09:00 Istanbul; verify only assignee receives aggregate.
87. Tap foreground/background/cold-start reminders with and without session; verify authorized file detail or safe list and normal RLS denial for inaccessible files.

## J. Git / Changes

88. Changed source: `.github/workflows/android-{apk,native-smoke}.yml`, `.gitignore`, `package{,-lock}.json`, `services/browserRepositoryBridge.js`, `src-tauri/{Cargo.toml,Cargo.lock,capabilities/default.json,src/lib.rs,tauri.android.conf.json,plugins/push/**}`, `src/mobile/{main.js,push.js,push-state.mjs}`, `supabase/{config.toml,functions/dispatch-push-notifications/**,migrations/202609210034_android_push_notifications.sql}`, `database/migration/034_android_push_notifications.sql`, `scripts/{prepare-android-firebase.mjs,enable-push-cron.sql}`, `docs/{ANDROID_PUSH_SETUP.md,ANDROID_PUSH_IMPLEMENTATION_REPORT.md}`, `tests/{unit/android-push.test.mjs,e2e/push-shell.mobile.spec.js}`. The copied pre-existing hero dirty changes remain in `outputs/hukuk-burosu-takip-sistemi.html`, `src/mobile/mobile.css`, and three prior E2E specs.
89. No commit SHA: implementation is intentionally uncommitted while real Firebase config/native validation is blocked.
90. Worktree is dirty; original hero worktree remains dirty and untouched.
91. No push.
92. No main merge.
93. No production DB change.
94. No production Edge Function deploy.
95. No production cron change.
96. No production secret change.
