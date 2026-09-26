# Play Console: Data safety cheat sheet (Famora 1.2.3, versionCode 21)

Written 2026-09-26 from the privacy policy (`src/lib/policy.js`), the release manifest and the code. Play Console → **App content → Data safety**. Answer it in the order below. The policy and this form must agree, so if you change one, change the other.

**Rule of thumb Play uses.** *Collected* means the data leaves the phone and reaches your servers or a provider. *Shared* means it is transferred to a third party. Play does **not** count these as sharing: a provider that only processes data for you (Supabase, Firebase, Twilio, Agora), or something the user chose to send to other people themselves. So data that a person sends to their own family group is *collected, not shared*. That is how the earlier form treated it, and this sheet keeps it that way.

---

## 1. What changed since the form you last submitted (start here)

If you only want to edit what differs, these are the changes. The rest of the form stays as it was.

| # | Change | Why |
|---|---|---|
| 1 | **Approximate location → Shared: YES** | Two new flows send it to others: weather (to OpenWeatherMap) and Nearby Help (the SOS area, to opted-in strangers nearby). |
| 2 | **Precise location → Shared: YES** (with the reason in the box below) | Nearby Help shows the exact SOS spot to the one stranger who accepts. |
| 3 | **Add Audio: Voice or sound recordings** | SOS voice clip (up to 15 s), and chat voice messages. |
| 4 | **Add Photos and videos: Photos and Videos** | SOS photo and chat media (the old form listed only the avatar). |
| 5 | **Add Files and docs: Files and docs** | Chat attachments (documents). |
| 6 | **Add App activity: Other actions** | Call records, driving trips, place arrival notices. |
| 7 | **Add App info and performance: Diagnostics** | Battery level, charging state and network type shown to the family, plus crash diagnostics. |
| 8 | Phone number: no change (Collected, not Shared) | Twilio only delivers the code for you. The extra number for offline SMS stays on the phone and never reaches the server. |
| 9 | Privacy policy URL, and the **account deletion** answers | See section 5. |

> **Why Shared: YES for precise location.** In Nearby Help, when a stranger accepts a request, they are shown the exact spot. The sender started that themselves by sending an SOS, which Play may treat as user-initiated. But a reviewer could read it either way, and declaring it is the safe direction: over-declaring never causes a rejection, under-declaring can. If you would rather keep precise location at "Shared: No", it has to be because you are comfortable defending "the user sent an SOS on purpose". Your call, but keep the policy wording the same.

---

## 2. Section "Data collection and security"

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (all traffic is HTTPS/TLS to Supabase, Firebase and Agora) |
| Do you provide a way for users to request that their data be deleted? | **Yes** |
| Deletion URL | `https://famora-family.vercel.app/delete-account` (works without the app) |
| Account creation methods | **Username and password**, and **Phone number** (verified by a one-time code). Do not tick Email or third-party sign-in. |
| Is your app committed to following the Play Families Policy? | **No.** Famora is not designed for children. |
| Independent security review | **No** |

The privacy policy URL, in **App content → Privacy policy**: `https://famora-family.vercel.app/privacy`.

---

## 3. Data types (tick only the ones below; everything else stays unticked)

For each type Play asks: *Collected*, *Shared*, *Processed ephemerally*, *Required or optional*, and *Purposes*.

### Location

| Type | Collected | Shared | Required? | Purposes | What it is |
|---|---|---|---|---|---|
| **Approximate location** | Yes | **Yes** | Required | App functionality | Rounded position for weather (about 11 km, to OpenWeatherMap) and the SOS area shown to opted-in Nearby Help helpers |
| **Precise location** | Yes | **Yes** (see note in section 1) | Required for the core feature; sharing can be switched off | App functionality | Live position (also in the background, with the disclosure screen), the last 7 days of history, saved Places (a name and a position, visible only to the owner), driving trips, and the exact SOS spot |

### Personal info

| Type | Collected | Shared | Required? | Purposes |
|---|---|---|---|---|
| **Name** | Yes | No | Required | App functionality, Account management (the display name your family sees) |
| **Phone number** | Yes | No | Required | Account management, App functionality. Sign-in and the one-time code (Twilio only delivers it), plus the optional extra number used for offline SMS alerts |
| User IDs | Yes | No | Required | App functionality, Account management (the account identifier) |

Leave **Email address**, **Address**, **Race**, **Political or religious beliefs**, **Sexual orientation** and **Other info** **unticked**. The old `@familyguard.app` address is an internal identifier, not a real email.

### Messages

| Type | Collected | Shared | Required? | Purposes |
|---|---|---|---|---|
| **Other in-app messages** | Yes | No | Required | App functionality (family and one-to-one chat). We do not read them. |

**Do not** tick *Emails* or *SMS or MMS*: Famora never reads SMS. It only *sends* one when offline alerts are on. That is covered by the SMS permission declaration, not by this form.

### Photos and videos, Audio, Files

| Type | Collected | Shared | Required? | Purposes |
|---|---|---|---|---|
| **Photos** | Yes | No | Optional | App functionality (profile photo, SOS photo, chat photos) |
| **Videos** | Yes | No | Optional | App functionality (chat videos) |
| **Voice or sound recordings** | Yes | No | Optional | App functionality (SOS voice clip up to 15 s, chat voice messages) |
| **Files and docs** | Yes | No | Optional | App functionality (chat attachments) |

**Calls are not "collected".** Live call audio and video pass through Agora in real time and are never recorded or stored, so they do not count as collected data. That is what the policy says too. Do not tick anything for calls other than the call records below.

`READ_MEDIA_AUDIO` is only used to let the person pick an alert sound from their own phone. It stays on the device, so it is not collected.

### App activity

| Type | Collected | Shared | Required? | Purposes |
|---|---|---|---|---|
| **Other actions** | Yes | No | Required | App functionality (call records: who called whom, when, how long, voice or video; place arrival and leaving notices; battery and offline alerts) |

Leave **App interactions**, **In-app search history**, **Installed apps** and **Web browsing** unticked. Search inside chat runs on the phone.

### App info and performance

| Type | Collected | Shared | Required? | Purposes |
|---|---|---|---|---|
| **Crash logs** | Yes | No | Required | App functionality, Analytics (Firebase Crashlytics; only after the person accepts the policy) |
| **Diagnostics** | Yes | No | Required | App functionality (battery level, charging state and network type or signal strength shown to the family; the device model and Android version in crash reports) |

### Device or other IDs

| Type | Collected | Shared | Required? | Purposes |
|---|---|---|---|---|
| **Device or other IDs** | Yes | No | Required | App functionality (the Firebase push notification token, so alerts and calls reach the phone) |

### Leave these unticked

Health info and Fitness info (crash detection and shake read the motion sensor on the phone only; nothing is uploaded), Financial info, Contacts, Calendar, Web browsing, and the **Advertising ID** (the app declares no ad permission and uses no ad SDK).

---

## 4. Anything a reviewer might ask about

| Topic | The answer, and where it is written |
|---|---|
| Why background location? | Family map and SOS need it with the app closed. Prominent disclosure screen shown first (`BackgroundLocationDisclosure`); policy section "How We Use It". |
| Why `SEND_SMS`? | Offline safety alerts, under the emergency-alerts exception. Already declared in `docs/play-console-declarations-v1.2.md`. Off unless the person switches it on. |
| Why full-screen intent and display over other apps? | An incoming call or SOS must wake the screen. Already declared. |
| Why microphone and camera? | Voice and video calls, the SOS voice clip and photo. Runtime permissions, requested when used. |
| Data sold or used for ads? | **No.** Policy: "we do not sell your data" and no advertising or profiling. |
| Data kept how long? | Messages 90 days, resolved SOS 30 days, location history 7 days, trips 30 days, SOS voice clips and photos 7 days, notification tokens 60 days. Policy section "How Long We Keep It". |
| Anti-theft or device admin? | Removed. The release manifest declares neither a device-admin receiver nor the capture activity. |
| Children? | Not designed for children. |

---

## 5. Before you submit

- [ ] The **privacy policy URL** in the store listing is `https://famora-family.vercel.app/privacy`, and it is the deployed version (26 September 2026, lists Twilio and the map providers).
- [ ] The **Data safety** answers above match the policy sections "Information We Collect" and "Who Else Is Involved". If a reviewer finds a mismatch, that alone can fail the review.
- [ ] Account deletion works both **in the app** (Profile → Delete My Account) and **on the web** (`/delete-account`). Play checks the web route.
- [ ] After saving, Play shows a preview of the "Data safety" section as users will see it. Read it once: "Data shared" should list *Approximate location* and *Precise location* only, and "Data collected" everything else in section 3.

## 6. If you change your mind later

Adding a feature that sends data somewhere new means updating **this form, the policy in six languages, and the manual** in the same release. The privacy policy file has a dated note at its top for each change: add one.
