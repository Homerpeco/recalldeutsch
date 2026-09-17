# RecallDeutsch

Spoken verb-recall alarms on Android. Fourth app next to SprintDeutsch, Karteikasten and DeutschTube.

- **Android app** (`android/`): Kotlin + Jetpack Compose. SQLite cache of all cards, randomised exact alarms
  (`setAlarmClock`) inside waking hours, full-screen recall screen (English meaning → pause → German spoken and shown),
  batch size 1–15 (default 5), transient audio focus, optional voice commands, Oppo setup checklist.
- **API** (`api/`; files starting with `_` are shared code, not endpoints) on Vercel:
  - `GET /api/cards` — Verb Meister verbs (live from SprintDeutsch `/api/verbs`) + Karteikasten verbs with
    prepositions and adjectives (read from the live Karteikasten page). Header `x-sync-key`.
  - `POST /api/tts` — Gemini TTS → trimmed 40 kbps MP3. 429 + `retryAfter` on quota.
  - `GET|POST /api/recall` — RecallDeutsch's own recall log in Vercel Blob (optional).
  - `GET /api/health` — which settings are present and whether both sources load.
- **Site** (repo root): `index.html` landing page, `RecallDeutsch.apk`, `version.json` (the app checks it for updates).

## Vercel environment variables
| Name | Value |
|---|---|
| `SYNC_KEY` | the same key as SprintDeutsch's `VERB_SYNC_SECRET` |
| `GEMINI_API_KEY` | Google AI Studio key |
| (optional) Blob store | connect one for the recall log → adds `BLOB_READ_WRITE_TOKEN` |

## Build the APK (cloud container)
```
cd android && ANDROID_HOME=/home/claude/android-sdk gradle :app:testDebugUnitTest :app:assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../RecallDeutsch.apk
```
Bump `versionCode`/`versionName` in `android/app/build.gradle.kts` **and** `version.json` for every release.
Signing key: `android/signing/` — never commit it, never lose it (updates must use the same key).

## Tests
- `node test/run.mjs` — API (Karteikasten extraction, Verb Meister cards, Gemini fallbacks, MP3).
- `gradle :app:testDebugUnitTest` — planner, database mirror, alarms, notification, UI screenshots (`app/build/screens`).
