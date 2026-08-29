# Play Console — internal testing launch

Working checklist for getting Famora onto the internal testing track with real
families. Order matters: signing → build → declarations → testers.

Drafted text below is a starting point written from what the code actually
does. Read it before pasting — you are the one certifying it is accurate.

---

## 1. Upload keystore (one time)

Run this yourself — it prompts for passwords, which must not pass through any
tool or get committed:

```bash
keytool -genkeypair -v -keystore famora-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias famora-upload
```

Store `famora-upload.jks` somewhere backed up and outside the repo. **If you
lose it you cannot ship updates to the same listing**, short of a Play support
key reset.

Then create `android/keystore.properties` (already gitignored):

```
storeFile=C:/path/to/famora-upload.jks
storePassword=...
keyAlias=famora-upload
keyPassword=...
```

`android/app/build.gradle` picks this up automatically. Without the file the
release buildType simply has no signingConfig, so debug builds are unaffected.

Enrol in **Play App Signing** when you create the app — Google then holds the
real signing key and your upload key stays replaceable.

## 2. Version codes

`versionCode` is still `1` in `android/app/build.gradle`. Play rejects a
re-upload of an existing code, so bump it on **every** upload — testing builds
included. `versionName` is the human string and can lag behind.

## 3. Build the AAB

Play wants an `.aab`, not the `.apk` that `build.ps1` produces:

```bash
npm run build && npx cap sync android && cd android && ./gradlew.bat bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`.

Note `minifyEnabled false` in the release buildType. That is fine to ship, but
turning it on later shrinks the download and the Crashlytics Gradle plugin will
upload the mapping file automatically so traces stay readable.

## 4. Declarations

These are where a background-location app actually gets stuck. All four apply.

### 4a. Background location — permission declaration form

Famora requests `ACCESS_BACKGROUND_LOCATION`. Play requires a written
justification plus a video demo of the in-app flow.

> Famora is a family-safety app. Members of a family group opt in to sharing
> their live location with each other so the group can see where everyone is on
> a shared map, and so that a member who triggers an SOS alert is located
> immediately by the rest of the family.
>
> Background location is required because the core feature — other family
> members seeing an accurate, current position — is only useful when the app is
> not open. A parent checking whether a child has reached home, or a family
> responding to an SOS alert, needs the location to be current at that moment,
> not from whenever the app was last foregrounded. Foreground-only location
> would freeze every member's position the instant they locked their phone,
> which removes the feature entirely.
>
> Location is shared only within a family group the user explicitly joined, is
> never sold or shared with third parties, and each member can turn sharing off
> at any time from within the app.

The video must show: the prominent disclosure, the system permission dialog,
and the resulting feature. Record it on the real device.

### 4b. Prominent disclosure (in-app)

**This does not exist yet, and it will fail review.**

Play requires an in-app disclosure **before** the background-location prompt,
separate from the privacy policy. `src/hooks/useLocationService.js` currently
calls `LocationService.requestBackgroundPermission()` directly, with no
disclosure screen anywhere ahead of it. The ConsentGate privacy policy at app
entry does not satisfy this — Play wants a specific disclosure naming
background location, shown immediately before the system prompt.

Internal testing bypasses review so this will not block section 6, but it
blocks closed testing, open testing, and production. It needs a small modal
before that call, with copy along these lines:

> Famora collects location data to show your position to your family group on a
> shared map and to include it in SOS alerts, even when the app is closed or
> not in use. You can stop sharing at any time in Settings.

### 4c. Data Safety form

Map it against what the app genuinely collects:

| Data type | Collected | Shared | Purpose | Notes |
| --- | --- | --- | --- | --- |
| Precise location | Yes | No | App functionality | Visible only to the user's own family group |
| Name / display name | Yes | No | App functionality, account | |
| Phone number | Yes | No | Account management | Used for OTP verification |
| Photos (avatar) | Yes | No | App functionality | Optional |
| In-app messages | Yes | No | App functionality | Group and direct messages |
| Voice / video call audio | No | No | — | Agora carries the stream; not stored |
| Crash logs & diagnostics | Yes | No | Diagnostics | Firebase Crashlytics — see below |
| Device / FCM token | Yes | No | App functionality | Push delivery |

Declare data **encrypted in transit** (all Supabase traffic is HTTPS/WSS) and
that users can request deletion (the account-deletion RPC exists).

### 4d. Other permission declarations

Each of these needs its own justification in the console:

- `SYSTEM_ALERT_WINDOW` — showing an incoming call or SOS alert over the lock
  screen and over other apps.
- `SCHEDULE_EXACT_ALARM` / `USE_FULL_SCREEN_INTENT` — an SOS alert must wake the
  screen at a precise moment; a delayed safety alert is a failed one.
- `FOREGROUND_SERVICE_SPECIAL_USE` — already declared in the manifest with
  `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`; the console justification must match that
  subtype string.
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` — Play scrutinises this. Justify it as
  keeping the location foreground service alive, and make sure the app still
  functions if the user declines.

## 5. Privacy policy update — required before this ships

Crashlytics is new as of this change. `PrivacyPolicyPage.jsx` and
`PolicyContent.jsx` must disclose that crash and diagnostic data (including an
opaque user identifier) is sent to Firebase, or the Data Safety declaration in
4c contradicts the policy — which is itself a review failure.

Collection is gated: it stays off until the user accepts the policy
(`ConsentGate` calls `setCrashReportingEnabled(true)`), so the disclosure and
the behaviour line up as long as the policy text is updated.

## 6. Internal testing track

1. Play Console → **Testing → Internal testing → Create new release**.
2. Upload the AAB. Internal testing skips full review, so this is fast.
3. Add testers by email (up to 100). Aim for **5–10 families across different
   OEMs** — Samsung, Xiaomi, Oppo, Vivo, and a Pixel as the clean baseline.
4. Share the opt-in link. Testers must accept before they can install.

Note that internal testing bypasses review, but the declarations in section 4
are still needed before promoting to closed/open testing or production. Do them
now rather than discovering them later.

## 7. What to watch once testers are live

The point of this track is telemetry you cannot get from one device.

- **Crashlytics → ANRs.** The signal that matters most. An OEM killing
  `LocationForegroundService`, or the SOS siren blocking the main thread, shows
  up here and nowhere else.
- **Crashlytics → non-fatals.** JS errors arrive as `JavaScriptException` via
  `CrashReportingPlugin`, tagged with the originating context.
- **Android vitals** in the console — excessive wakeups and stuck partial
  wakelocks, both plausible given the location service and SOS wakelocks.
- Ask testers one question directly, because no dashboard reports it: *did the
  map ever go stale, and did SOS ever fail to make a noise?*
