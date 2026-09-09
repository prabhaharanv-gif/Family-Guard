# FamilyGuard

A family-safety Android app: live location sharing on a shared map, SOS alerts with a
loud native siren, family voice/video calling, and group + direct messaging.

Built as a React web app wrapped in Capacitor, with Supabase (Postgres + RLS + Edge
Functions) as the backend and Agora for real-time calling.

## Stack

| Layer | Choice |
| --- | --- |
| UI | React 19, React Router 7, Zustand, plain CSS |
| Build | Vite 8 |
| Native shell | Capacitor 8 (Android only) |
| Backend | Supabase — Postgres, RLS, RPCs, Edge Functions (Deno) |
| Maps | Leaflet / react-leaflet |
| Calling | Agora RTC (`agora-rtc-sdk-ng`), tokens minted server-side |
| Push | Firebase Cloud Messaging |

## Prerequisites

- Node.js 20+
- Android Studio (for the bundled JDK and the Android SDK)
- `android/app/google-services.json` — from the Firebase console, not in this repo
- A `.env` at the repo root (see below), not in this repo

## Environment

The web app reads these at build time:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_APP_VERSION=<shown in Settings>
```

Edge Functions read `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `FIREBASE_PROJECT_ID`,
`FIREBASE_SERVICE_ACCOUNT`, and the Supabase-provided `SUPABASE_URL` /
`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`. Set them as function secrets in the
Supabase dashboard — they are never bundled into the client.

## Running the web app

```bash
npm install && npm run dev
```

Serves on `http://0.0.0.0:5173`. Native features (background location, SOS siren,
full-screen call alerts) are no-ops in the browser and only work in the APK.

## Building the APK

```bash
./build.ps1
```

Cleans `dist/` and the Android assets folder, runs the Vite build, `npx cap sync
android`, then `gradlew assembleDebug`. Output lands at
`android/app/build/outputs/apk/debug/app-debug.apk`.

Always go through this script rather than calling Gradle directly. A bare
`gradlew assembleDebug` reuses whatever web bundle is already sitting in
`android/app/src/main/assets/public`, so JS changes silently will not be in the APK.
Java-only edits can be syntax-checked faster with
`gradlew :app:compileDebugJavaWithJavac`.

**Known snag:** on Windows PowerShell 5.1 the script can abort at step 3/5 with a
`NativeCommandError` even though the Vite build succeeded — PowerShell promotes Vite's
"chunks larger than 500 kB" stderr warning into a terminating error. If that happens,
run the three stages by hand:

```bash
npm run build && npx cap sync android && cd android && ./gradlew.bat assembleDebug
```

## Layout

```
src/
  pages/       route-level screens (map, family, messages, SOS, calls, profile)
  components/  shared UI + the global SOS / incoming-call overlays
  hooks/       location broadcast, SOS, call signaling, push, presence, battery
  lib/         supabase client, agora, firebase, native alarm bridges
  store/       zustand auth store
  i18n/        translated strings
android/       Capacitor shell + native Java plugins
supabase/
  migrations/  schema, RLS policies, RPCs
  functions/   Deno edge functions for push + Agora token minting
```

Native Java lives in `android/app/src/main/java/com/scoopfamily/familyguard/` —
a foreground location service, an SOS siren service, and Capacitor plugins bridging
them to JS.

## Backend notes

Client code talks to Postgres through `SECURITY DEFINER` RPCs rather than direct table
writes; RLS is enabled on every table and policies are scoped to family membership.
When adding a function, pin its `search_path`:

```sql
alter function public.my_function(...) set search_path = public, pg_temp;
```

Deploy an edge function with:

```bash
npx supabase functions deploy <name> --project-ref <project-ref>
```

## Android permissions

The app requests background location, overlay (`SYSTEM_ALERT_WINDOW`), exact alarms,
full-screen intents, and battery-optimization exemption — all needed for location and
SOS to survive Doze and aggressive OEM task-killers. Each of these requires its own
justification in the Play Console before release.
