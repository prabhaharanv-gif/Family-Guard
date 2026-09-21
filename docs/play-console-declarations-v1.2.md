# Play Console — declarations for the three new features

Written for the release that adds **Offline SMS alerts**, **Fake incoming call**
and **Shake for SOS** on top of versionCode 16 / 1.1.2.

Everything below is meant to be pasted into the console. Where a field needs a
video, the shot list is in section 5 — a rejected video is the most common
reason these forms come back.

## 0. What each feature triggers

| Feature | Manifest | Console form |
| --- | --- | --- |
| Offline SMS alerts | `SEND_SMS` | **Sensitive app permissions → SMS and Call Log** — new, blocking |
| Fake incoming call | `FakeCallService` (`mediaPlayback|specialUse`), full-screen intent, QS tile | **Foreground service permissions** and **Full-screen intent** — both already filed, both need their text updated |
| Shake for SOS | none — the accelerometer needs no permission at 100 Hz | none, but it belongs in the `location` foreground-service justification |

All of these are filed from **Play Console → Famora → Monitor and improve → App
content** (shown under "Policy" in some account layouts — the same page):
*Sensitive app permissions* for SMS, *Foreground service permissions*,
*Full-screen intent permission*, *Data safety*. Videos go in as unlisted YouTube
links. The SMS form also appears by itself during the release flow, the first
time a bundle requesting `SEND_SMS` is uploaded — see section 6 for why that
matters more than it sounds.

Shake for SOS deliberately samples at 100 Hz. `HIGH_SAMPLING_RATE_SENSORS` only
applies above 200 Hz, so do **not** add it — it would drag a third permission
into review for nothing.

## 1. SMS and Call Log permissions declaration — the blocking one

Play restricts `SEND_SMS` to a fixed list of core-functionality exceptions. The
one Famora claims is, verbatim from the policy table:

> **Physical safety/emergency alerts to send SMS** — apps that send SMS alerts
> in emergency situations

That exception survives into the January 27, 2027 policy preview, so it is not
about to be withdrawn. The form must be re-submitted for **every** release that
ships the permission, and an app shipping `SEND_SMS` without an approved form
can be removed, not merely rejected.

**Is your app the default SMS handler?** No.

**Selected core functionality:** Physical safety/emergency alerts to send SMS.

### Description of the core functionality

> Famora is a family-safety app. Members of a family group share their live
> location with each other and can raise an SOS alert that reaches every other
> member. All of that travels over the internet.
>
> The feature declared here, "Offline SMS alerts", covers the one case the
> internet cannot. When a member's phone loses mobile data — a 2G-only stretch
> of road, an exhausted data balance, a dead zone — that member simply stops
> moving on the family's map, and the family has no way to tell "she is fine and
> out of coverage" from "something has happened". With SEND_SMS the app texts
> the member's last known position to the family instead, on the one channel
> that still works without data. In a true dead zone the carrier delivers the
> queued message as soon as there is a bar of signal.
>
> The feature is off by default. The member switches it on in Profile → Offline
> SMS alerts, and the SEND_SMS runtime permission is requested at that exact
> moment; if the permission is refused the switch does not turn on and no
> setting is stored. The screen states that texts are charged at the carrier's
> standard rate and lists the numbers that will be texted.
>
> Recipients are only the admins of the family group the member has themselves
> joined, plus one additional number the member types in. The app never reads
> the device's contacts, never reads, receives or intercepts SMS, and never
> texts a number the user has not chosen. The message is a single line:
> "Famora: <name> has no internet since <HH:MM>. Last known location:
> <Google Maps link>".
>
> Sending is rate-limited in code so the permission cannot become a nuisance or
> a bill: nothing is sent until the phone has been offline for 15 minutes (a
> tunnel, a lift or a train is not an emergency), then at most one message every
> 15 minutes, with a hard cap of 8 messages per outage — after which the app
> stays silent until data returns. Going back online resets the counters. There
> is also a single "send a test message" button, so the member can prove the
> number works on a day when nothing is wrong.

### Why no alternative method exists

> This alert exists precisely for the moments when the user cannot act: the
> phone is in a pocket or a bag, the screen is off, and there is no data
> connection.
>
> Every alternative requires either connectivity or a user tap:
>
> - Push, our own server, or any in-app channel — unavailable by definition,
>   because the condition being reported *is* the absence of data.
> - `ACTION_SENDTO` or handing the message to the default SMS app — requires the
>   user to be looking at the screen and to press Send in another app. A member
>   who can do that is a member who is not in the situation this feature exists
>   for, and delivery would stop the moment the phone was pocketed.
> - Asking the user to text manually — the same objection, and it requires them
>   to know the family's numbers while the app cannot reach the server.
>
> Sending must therefore be automatic, in the background, from the app's own
> foreground service, which is only possible with the SEND_SMS permission.

### What was actually submitted (2026-09-19, versionCode 17)

The console form does not match the policy table's wording, and it has no long
description field at all. What it asks for:

- **Core functionalities** (checkboxes): tick **only** "Physical safety /
  emergency alert apps (e.g., senior safety)". "Default SMS handler" is ticked
  by default on a fresh form — untick it. Famora is not the default SMS
  handler, and declaring it would be checked against the manifest and fail.
  Leave "Anti-SMS Phishing" and everything else empty; each extra tick is
  another justification to defend.
- **Instructions for review**: capped at **500 characters**, so the long text
  above does not fit. What was submitted (497):

> Offline SMS alerts: Profile > Safety > Offline SMS alerts. Off by default;
> the switch requests SEND_SMS and stays off if refused. After 15 min with no
> data, the app texts the member last known location to their family admins
> plus one number they enter. Max one SMS per 15 min, 8 per outage. The test
> button sends one immediately, so you can verify without waiting offline.
> Contacts are never read and no SMS is received or read; only chosen numbers
> are texted. The demo video shows the whole flow.

- **Video instructions**: `https://youtu.be/YlLeY7QB3xg` — marked optional, but
  an SMS declaration without one is unlikely to be approved.
- **Declarations**: all four ticked. The fourth (Prominent Disclosure) is the
  one to keep honest — the Offline SMS card states the 15-minute delay, the
  8-message cap and the carrier charge on screen *before* the switch triggers
  the permission dialog. If that card's copy is ever trimmed, this tick stops
  being true.

The long description in this section still has no home in the form. Keep it:
it is the answer to send if the reviewer comes back with questions.

### Expect this follow-up

The likely reviewer objection is "the app still works without SMS, so it is not
core". The answer to hold to, in the reply and in the video: the core function
is *the alert reaching the family*. Without SMS the app is not broken — the
alert is, in exactly the conditions it was built for.

## 2. Full-screen intent declaration — update, do not re-argue

This form is a single radio button — *What is the core functionality of your
app?* — with three options: Alarm clock, Making and receiving calls, Other.
There is no free-text field and no per-feature justification, so the fake call
needs no entry of its own.

It was set to **Other**, which is the one answer that does not qualify for a
pre-grant. The consequence is concrete: on every new install the permission is
ungranted, so an SOS alert appears as a floating heads-up window for 60 seconds
instead of waking the screen full-screen over the lock. `MainActivity`
deliberately does not push the user to the full-screen-intent settings page on
launch (it backgrounded the app on API 34+), so the only route to granting it is
the `SosReliabilitySetup` card, which most users never open.

**Set it to "Making and receiving calls."** That is accurate, not convenient:
Famora makes and receives voice and video calls between family members —
`useCallSignaling.js` drives them, `CallRingingService` rings, and
`CallRingingActivity` is the full-screen incoming-call screen the permission
exists for. Play defines core functionality as the app's main purpose and allows
it to be a set of features rather than one.

The other two full-screen uses ride along under the same selection: the SOS
alert uses the same mechanism, and the fake call is an incoming-call screen by
construction.

The form's warning about apps that fail to check for the permission is already
answered in code — `SOSAlarmPlugin` calls `canUseFullScreenIntent()` and offers
`ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT` as a user-initiated card, so the app
degrades knowingly rather than silently.

## 3. Foreground service permissions declaration — update

`FakeCallService` is new and declares `mediaPlayback|specialUse`. It introduces
no new *type*, and this form is checkboxes plus one video link per permission —
not free text — so almost nothing here changes. The current state is: Location =
"User-initiated location sharing", Media playback = "Media playback", Special
use = "Other", one Shorts link in all three video fields.

Two edits, and no others:

**Special use → "Other" → description.** The only field where the fake call can
be named. The field asks for the use *and* why the task must start immediately
and cannot be paused or restarted, so all three points have to be answered.
Sentences 1–3 must match the manifest's `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`
strings — copy them rather than retyping:

> Famora is a family-safety app. Three foreground services require
> FOREGROUND_SERVICE_SPECIAL_USE, each because it must show a full-screen alert
> over the lock screen — a task no other foreground service type covers.
>
> 1. SOSSirenService — Emergency SOS alarm that requires showing a full-screen
> alert over the lock screen when a family member is in danger.
>
> 2. CallRingingService — Incoming voice/video call from a family member that
> requires showing a full-screen ringing alert over the lock screen.
>
> 3. FakeCallService — Personal-safety fake incoming call the user schedules for
> themselves, shown full-screen over the lock screen.
>
> Each must start immediately and cannot be paused, deferred or restarted. All
> three are triggered by another person or by a timer the user set themselves,
> and each is only useful at the instant it fires: an SOS alert that reaches the
> family minutes late is a failed alert, a deferred ringing call is a missed
> call, and a fake call that arrives after the moment has passed no longer gets
> the user out of the situation they scheduled it for. None can be rescheduled
> by the system, because none can be repeated.

**The video.** Replaced on 2026-09-19 with `youtu.be/YlLeY7QB3xg` in the Media
playback and Special use fields. It has to contain the fake call: that service
is named in the description above and the video is the only footage backing it.
Keep the Location field's link pointing at footage that actually shows
user-initiated location sharing — if the new video covers it, update that field
too so all three agree.

What does *not* change: Media playback keeps its one checkbox, since the fake
call's ringtone is the task already declared. Location keeps "User-initiated
location sharing" — shake SOS runs inside `LocationForegroundService` but adds
no task category, and there is no free-text field to describe it in. Leave
Navigation, Geofencing and every unused "Other" unticked; each one ticked is
another justification to defend.

## 4. Data safety — no new data, but two documents must catch up

None of the three features collects anything new:

- Offline SMS sends **location** (already declared) to recipients the user
  configured. Keep **Shared: No**, consistent with how in-app location sharing
  is already declared — the recipients are members of the user's own family
  group, chosen by the user. The extra number lives only in `SharedPreferences`
  and never reaches the server.
- Fake-call caller name and number are on-device only (`FakeCallPrefs`).
- Shake detection reads the accelerometer and stores nothing.

What must change:

1. **Privacy policy** (`PolicyContent.jsx` / `PrivacyPolicyPage.jsx`) must state
   that, when the member enables offline alerts, the app sends SMS containing
   their name and last known location to the family admins and to a number they
   provide, at the carrier's standard rate. A Data safety form that contradicts
   the policy is itself a review failure.
2. **Store listing** must describe the fake call honestly, as a simulated call
   the user schedules for themselves. Described that way it is an ordinary
   personal-safety feature; described as anything else it walks into the
   Deceptive Behavior policy.

## 5. Video shot list

One unlisted YouTube video per form, recorded on a real device. No narration
needed, but no cuts inside a flow.

**SMS (required, most scrutinised):**

1. Profile → Offline SMS alerts, switch off, with the on-screen text about
   charges and recipients visible.
2. Tap the switch → the Android SEND_SMS permission dialog → Allow.
3. The recipients list, showing the family admins and the extra-number field.
4. Tap the test-send button, then show the received SMS on a second phone with
   its "[Test]" prefix and maps link.
5. Tap the switch off again, to show it is revocable.

**Full-screen intent:** schedule a fake call, lock the phone, let it ring over
the lock screen, answer, hang up. Then one real SOS alert arriving on a locked
phone.

**Foreground services:** pull down the notification shade during a location
session, during a fake call, and during an SOS, so each service's notification
is visible.

## 6. Sequencing — read this before uploading

The 14-day closed-test clock is the only thing between this app and production
access, and a policy rejection while it runs costs more than the feature gains.
`SEND_SMS` is the only item here that can produce one.

The SMS form cannot be filed in advance. It is attached to an uploaded bundle:
Play surfaces it during the release flow once an AAB requesting `SEND_SMS` is
uploaded and no declaration exists for it. So "declare later" is not an option
either — the form is completed *as part of* the upload that carries the
permission, and while it sits unresolved Play raises an alert under App content
and blocks publishing any other change to that track.

### Decision for versionCode 17 / 1.2.0 (2026-09-19)

**Ship the permission and declare it in the same upload.** The demo video
recorded for the foreground-service declarations already shows the Offline SMS
feature, so the build and the evidence match — which they would not if the
permission were held back.

`SEND_SMS` stays in `AndroidManifest.xml`, the Offline SMS card stays visible,
and `safetySub` keeps listing it in all six languages. The alternative — holding
the permission until after production access — was prepared and then reverted;
it is still the fallback if the declaration comes back rejected.

What that requires at upload time:

1. Complete the SMS declaration in the release flow. Do not save the release
   with the form outstanding. Every answer is in section 1 above.
2. Expect the reviewer's "the app works without SMS, so it is not core"
   objection, and answer it as written there.

If the declaration is rejected: comment out the permission, hide the card
behind a flag in `src/lib/offlineSms.js` (which also stops
`refreshOfflineSmsContacts` caching admins' numbers on the device), drop the
SMS clause from `safetySub` in all six languages, bump the version and
re-upload. The native `OfflineSms` code can stay — with the feature
unreachable, `maybeSend` returns `NOT_CONFIGURED` on every fix.

Whichever order you pick, bump `versionCode` past 16, and keep the declarations
and the manifest in step for every future release that ships the permission.
