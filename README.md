# RecallDeutsch

Spoken verb-recall alarms on Android. Fourth app next to SprintDeutsch, Karteikasten and DeutschTube.

- **Android app** (`android/`): Kotlin + Jetpack Compose. SQLite cache of all cards, randomised exact alarms
  (`setAlarmClock`) inside waking hours, full-screen recall screen, batch size 1–15 (default 5), transient audio focus,
  optional voice commands, Oppo setup checklist.
- **What one card sounds like (v1.1):** meaning in Spanish (Spanish voice) and/or English (English voice) → pause →
  German: infinitive (+ preposition and case) → 3rd person present, Präteritum, Perfekt → the examples from the database.
  Setting "Read the meaning in": Spanish + English (default) / Spanish / English.
- **Recalled tab (v1.2):** every verb heard in recalls (last 7 days / 30 days / all), "didn't know" ones first,
  with meaning, forms, preposition + case and (tap) the examples; "Recall the ones I didn't know" starts a session
  with those cards (up to 15). The Today screen's "Last 7 days" panel names the "didn't know" verbs.
- **API** (`api/`; files starting with `_` are shared code, not endpoints) on Vercel:
  - `GET /api/cards` — Verb Meister verbs (live from SprintDeutsch `/api/verbs`) + Karteikasten verbs with
    prepositions and adjectives (read from the live Karteikasten page). Header `x-sync-key`.
    Each card has `forms`, `prepLine`, `examples[]` and `speakDe` (the German script, one part per line).
  - `POST /api/cues` — Gemini text model turns long mixed meanings into 1–3 Spanish + 1–3 English cues
    (max 30 cards per call). Forwards to SprintDeutsch `/api/recall-cues` when this project has no Gemini key.
  - `POST /api/tts` — Gemini TTS → trimmed 40 kbps MP3 (max 1200 chars). 429 + `retryAfter` on quota.
  - `GET|POST /api/recall` — RecallDeutsch's own recall log in Vercel Blob (optional).
  - `GET /api/health` — which settings are present and whether both sources load.
- **Site** (repo root): `index.html` landing page, `RecallDeutsch.apk`, `version.json` (the app checks it for updates).

## Live setup (2026-09-17)
- **recalldeutsch.vercel.app** — landing page, APK, and the API above. Env var: `SYNC_KEY` only.
- **Voice and cues:** there is no `GEMINI_API_KEY` in this project, so `/api/tts` and `/api/cues` forward to
  **sprintdeutsch.vercel.app/api/recall-tts** and **/api/recall-cues**, which use SprintDeutsch's existing
  `VITE_GEMINI_API_KEY` and check the same `VERB_SYNC_SECRET`. Adding `GEMINI_API_KEY` here later makes it use that key directly.
- **Connect page:** sprintdeutsch.vercel.app/recall-connect.html reads the Verb Meister key saved in that browser and
  hands it to the phone app (`recalldeutsch://connect?key=…` button on Android, QR code on desktop).
- The SprintDeutsch-side files are kept in `sprintdeutsch-addon/` (same paths as in the sprintdeutsch repo).

## Vercel environment variables (reference)
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
- `node test/run.mjs` — API, 15 tests (Karteikasten extraction, German reading order, regular forms, cues,
  Gemini fallbacks, MP3, forwarding to SprintDeutsch).
- `gradle :app:testDebugUnitTest` — 26 tests: planner, language detection, database mirror + v1→v2 upgrade, alarms,
  notification, recall history, UI screenshots (`app/build/screens`).
