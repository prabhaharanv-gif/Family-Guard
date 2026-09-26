/**
 * policy.js
 *
 * The single source of truth for the privacy policy, in every language the
 * app ships it in.
 *
 * ── Why this file exists ───────────────────────────────────────────────────
 * There used to be two policies. PolicyContent.jsx (shown inside ConsentGate,
 * where people actually accept) and PrivacyPolicyPage.jsx (linked from Register
 * and Profile) each carried their own hand-written copy — 63 and 65 prose
 * strings with not one sentence in common. They had drifted apart, and the page
 * most users see was the stale one. Where they disagreed, this file keeps the
 * version that matches what the code actually does:
 *
 *   - Location retention. The page claimed "only stored as current position —
 *     no history kept". There IS a location_history table, and retention_job_5
 *     deletes rows older than 7 days nightly, so 7 days is the true figure.
 *   - Third parties. The page said "We do not share your data with any third
 *     parties" and then listed two, omitting Agora — which carries live call
 *     audio and video. Agora is named here.
 *   - Crash reporting. The page predated Crashlytics and still said "no
 *     analytics, no tracking". Crash reporting has its own section now.
 *   - Calls. The page described none of the calling feature.
 *
 * Two accurate details that existed only on the page (bcrypt password hashing,
 * Edge Functions verifying caller identity) are kept.
 *
 * Every retention period was checked against the cron jobs that actually run:
 *   retention_job_1 messages 90d · _2 resolved SOS 30d
 *   retention_job_4 device tokens 60d · _5 location history 7d
 *
 * ── 26 September 2026: an audit turned up four undisclosed things ─────────
 * A full pass against the Android sources and the migrations found features
 * that had shipped without ever being written down here:
 *
 *   - Anti-theft's wrong-password alert (AntiTheft.java, UnlockAttemptPlan,
 *     migration 20260925180000) was missing outright — not one sentence,
 *     in any section. It reports 3+ wrong screen-lock attempts to family
 *     ADMINS with the phone's last position, holds Android's device-admin
 *     permission to learn about the failures, and — only if the owner also
 *     switches on the experimental option — takes one front-camera photo of
 *     whoever is holding the phone and uploads it. A feature that reports on
 *     a person and photographs them without their say is exactly the kind of
 *     thing this file exists to disclose, so it now has entries in Collect,
 *     Use, Retention (7 days, matching purge_expired_unlock_alerts) and
 *     Choices.
 *   - Chat attachments (chat_media migration, 2026-08-31) — photos, videos,
 *     voice notes and documents sent in a message — were never mentioned;
 *     only plain text messages were. Also corrected while here: the 90-day
 *     message purge (retention_job_1) deletes the message row, not the
 *     attachment in the chat-media bucket — deliberately, per that
 *     migration's own comment, to avoid breaking a reply quote — so the
 *     retention line now says so rather than implying attachments vanish
 *     with the message.
 *   - Private one-to-one messages (direct_messages) were never distinguished
 *     from the family room. "Messages are visible only to members of that
 *     family group" is true of the room but was silent on the fact that a
 *     private thread is visible only to its two participants — a materially
 *     different, narrower audience that a reader could not have inferred.
 *   - Find My Phone (PingRingService) — one family member making another's
 *     phone ring loudly to locate it — collects nothing new (it rides the
 *     existing notification token) but was an undocumented capability one
 *     family member holds over another's device, so it now has a line.
 *
 * ── 22 September 2026: the Timeline ────────────────────────────────────────
 * The Map's Timeline shows a family member's location history — the last
 * 24 hours or 7 days, with where they were at any moment. The history was
 * already collected and disclosed (7 days, "Location history is deleted
 * automatically…"), but who can SEE it was not: the policy only said your
 * location is visible to your family, which read as "where you are now". A
 * line under How We Use It now says family members can view the last 7 days.
 * The in-app location disclosure (BackgroundLocationDisclosure) says the same,
 * and existing members get a one-time notice (App.jsx).
 *
 * ── 18 September 2026: three features that needed disclosing ──────────────
 * Offline SMS, Shake for SOS and Fake call all shipped undocumented here.
 * What changed, and why it could not simply be left out:
 *
 *   - Offline SMS has its own section. It holds SEND_SMS and texts the
 *     member's last known position over the mobile network, so the operator
 *     sees it and the member's plan is charged. Google Play grants SEND_SMS
 *     only under the emergency-alerts exception, and the Permissions
 *     Declaration Form is checked against this page.
 *   - The extra SMS number broke an existing promise. 'not shared with
 *     anyone outside these providers and your own family group' was true
 *     until a member could type in any number at all. That sentence now
 *     names the exception instead of contradicting the code.
 *   - Shake for SOS reads the accelerometer continuously while armed. The
 *     samples never leave the phone (ShakePattern judges them there), but a
 *     sensor read in the background is collection until it is said not to be.
 *   - Fake call sends nothing at all, which is exactly why it is written
 *     down: a feature by that name invites the worst assumption.
 *
 * 'What Stays on Your Phone' exists so the last two have somewhere to live
 * that is plainly not a server. Retention lists cron jobs, and none of this
 * is covered by one — it goes when the app is uninstalled.
 *
 * Also corrected while here: battery level, charging state and speed were
 * stored and shown to the family but had never been listed as collected.
 *
 * ── Translations ──────────────────────────────────────────────────────────
 * NOT REVIEWED BY A LAWYER. The translations below were produced alongside
 * the UI strings, not by a qualified legal translator. Each is a faithful
 * rendering of the English, which remains the authoritative version — but
 * before relying on either for a compliance obligation, have someone qualified
 * read it.
 *
 * Structure mirrors i18n/manual.js: presentation (icon, colour, order) is
 * defined once in SECTION_META, and only text is per-language. A missing
 * translation therefore falls back to the English sentence rather than dropping
 * a disclosure, which is the one failure mode a policy must not have.
 */

// Order and presentation, shared by every language.
export const SECTION_META = [
  { key: 'collect',   icon: '📋',  color: '#8B0D3D' },
  { key: 'use',       icon: '🔒',  color: '#059669' },
  { key: 'calls',     icon: '📞',  color: '#B01650' },
  { key: 'sms',       icon: '✉️',  color: '#D97706' },
  { key: 'onphone',   icon: '📱',  color: '#0F766E' },
  { key: 'crash',     icon: '🐞',  color: '#DC2626' },
  { key: 'providers', icon: '🤝',  color: '#B01650' },
  { key: 'protect',   icon: '🛡️', color: '#A5124A' },
  { key: 'retention', icon: '🗑️', color: '#D97706' },
  { key: 'choices',   icon: '✅',  color: '#16A34A' },
]

const CONTENT = {
  // ──────────────────────────────────────────────────────────────── English ──
  en: {
    lastUpdated: '26 September 2026',
    pageTitle: 'Privacy Policy',
    consentTitle: 'Privacy Policy & Terms of Use',
    lastUpdatedLabel: 'Last updated',
    promiseLead: 'Famora is built on a simple promise:',
    promiseStrong: 'your data belongs to you and your family — nobody else.',
    promiseTail: 'We collect only what is necessary to keep your family safe and connected.',
    intro:
      'Famora helps families stay connected and reach each other quickly in an ' +
      'emergency. It shares your location, messages and calls only with the family ' +
      'group you choose to join — and, if you switch on offline SMS alerts, with one ' +
      'extra number you pick yourself. This page explains exactly what is collected, ' +
      'why, who it is shared with, and how long it is kept.',
    consentNote:
      'By continuing you confirm you have read and accept this policy, and that you ' +
      "have the right to share the location of any account you set up on someone " +
      "else's behalf.",
    contactPrompt: 'Questions about your privacy?',
    contactPromptConsent: 'Questions or a data request?',
    sections: {
      collect: {
        title: 'Information We Collect',
        items: [
          'Mobile number — used to create and sign in to your account',
          'Display name and, if you add one, a profile photo',
          'Location, while location sharing is switched on',
          'Battery level, charging state and speed while moving, shown to your family beside your position',
          'Messages you send within your family group',
          "Photos, videos, voice notes (recorded with your microphone) and documents you choose to attach to a message, in your family group's chat or in a private one-to-one thread with another member",
          'SOS alerts you send or receive, including location at that moment',
          'Call records: who called whom, time, duration and whether voice or video',
          'A device notification token, so alerts and calls can reach your phone',
          'Basic device details needed to deliver calls and alerts reliably',
          'Motion sensor readings, only while Shake for SOS is switched on — they are judged on your phone and never sent anywhere',
          'The extra phone number you enter for offline SMS alerts, if you use that feature',
          'Crash and diagnostic reports, if the app stops working — see below',
          "If you switch on Driving trips: the start and end time, distance, average and top speed of each drive, and the number of hard brakes and hard accelerations — worked out from the location fixes above, with no extra sensor",
          "Your saved places (a name and a position) and the speed limit you set for Overspeed alert, if you use them — saved places are visible only to you",
          "If Phone lost is used on your phone: the fact that it is marked lost, who marked it, any short message they typed, and the phone's position every few seconds while it is lost",
          "Your network type (Wi-Fi or mobile data) and signal strength, shown to your family on your card",
          "When you arrive at or leave a place you saved (such as Home or Office): the place name, whether you arrived or left, and the time. Your family is told this, but never the exact position of the place",
          "If you switch on Voice clip with my SOS: up to 15 seconds of audio recorded by your phone after you send an SOS from the app, and a photo from your camera if you choose to add one",
          "If you opt in to Nearby Help: your approximate position, so people who send an SOS near you can be matched with you; a blurred, anonymous dot on the nearby-people map; and your answers to help requests",
          "If you switch on the wrong-password alert in Profile → Anti-theft: the fact that your phone had 3 or more wrong screen-lock attempts within 10 minutes, how many, and its position at that moment; and, only if you also switch on the photo option, one front-camera photo taken right after",
        ],
      },
      use: {
        title: 'How We Use It',
        items: [
          'Your location is visible only to members of your own family group',
          'Family members can also see where you have been over the last 7 days, on the Map\'s Timeline',
          'Messages are visible only to members of that family group',
          "A photo, video, voice note or document attached to a message in your family group's chat is visible to that group, the same as the message itself; one attached to a private one-to-one message is visible only to you and the other person, never the rest of your family group",
          'Notification tokens are used solely to deliver alerts, messages and calls',
          'Call and video content is never recorded or stored by us',
          'We do not read your messages, and we do not sell your data',
          'We do not use your data for advertising or profiling',
          "Overspeed alert and Driving trips are off unless you switch them on. Once on, your family group can see your trips and is told when you drive above the limit you chose, and you get a warning on your own phone too",
          "Severe-weather alerts warn only you, about your own saved places. Only an approximate area of each place (rounded to about 11 km) is sent, by our server, to OpenWeatherMap",
          "Crash detection is off unless you switch it on. It never sends anything by itself: a recognised crash only starts a 20-second countdown, and an SOS goes out only if you do not cancel",
          "Phone lost is off unless you switch on \"Allow Phone lost\" in Profile → Safety. Only then can an admin of one of your families mark your phone lost. While it is, the phone reports its position every few seconds, rings every 2 minutes and shows the message on the lock screen, and every member of the family can see that it is marked lost. It stops after 12 hours or when it is marked found",
          "Your family is told when your phone battery falls to 15% or 5% while not charging, when your phone has sent no update for about 45 minutes (phone off, or no network), and when it reports again. These alerts carry the battery level and how long the phone was silent. Turning location sharing off in Profile → Privacy stops them. Offline alerts are held back from 11 PM to 6 AM, India time",
          "A voice clip or photo attached to an SOS goes only to the families that SOS was sent to. It is stored privately, is never shown to Nearby Help helpers, and is deleted after 7 days",
          "Nearby Help is off unless you opt in. When an SOS may reach a family too far away to help, the closest opted-in people (first within 2 km, then 5 km, then 10 km) are asked to phone the right emergency number for the sender. They see only the approximate area and the kind of help needed, never a name or phone number; the exact position is shown only to the one person who accepts. Nobody is asked to travel to the spot",
          "Because of Nearby Help, when you send an SOS that has a position, the approximate area of the SOS and the kind of help needed may be sent to opted-in Famora users near it. They never receive your name, phone number, messages, voice clip or photo",
          "Arrival and leaving notices for your saved places go to your family group; the exact position of a place stays with you",
          "Any family member can make your phone ring loudly for up to 30 seconds to help find it (\"Find My Phone\"); this does not reveal your location beyond what your family can already see",
          "The wrong-password alert is off unless you switch it on in Profile → Anti-theft. Once on, 3 or more wrong screen-lock attempts within 10 minutes are reported — with how many attempts and the phone's last known position — to the ADMINS of your family groups only, at most once every 10 minutes. It uses Android's device-admin permission solely to be told about a failed unlock; we never use it to lock, wipe or otherwise control your phone. If you also switch on the photo option, one front-camera photo is taken right after such a report; only you and those admins can see it",
        ],
      },
      calls: {
        title: 'Voice and Video Calls',
        items: [
          'Calls run over the internet between family members, not the phone network',
          'Audio and video are carried by Agora, our calling provider, and are not recorded',
          'Only call records are stored — never the conversation itself',
          'Microphone is used during a call; camera only during a video call',
          'Any family member can clear the call history for the family',
        ],
      },
      sms: {
        title: 'Offline SMS Alerts',
        items: [
          'Switched off unless you turn it on in Profile → Offline SMS alerts',
          'When your phone has had no internet for fifteen minutes, it texts your last known position so your family is not left guessing',
          'The text contains your name, how long you have been offline and a map link — nothing else',
          'It goes to the admins of every family you belong to, and to one extra number if you add one. That number is your choice and may be someone outside your family group',
          'The message travels over the mobile network, so your mobile operator handles it as it handles any text message',
          'Each alert is charged by your mobile plan, and no more than eight are sent per outage',
          'Android must grant permission to send SMS, and you can withdraw it at any time in Android settings',
          'The numbers to text are stored on your phone so they work with no connection; we do not use them for anything else',
        ],
      },
      onphone: {
        title: 'What Stays on Your Phone',
        items: [
          'Shake for SOS reads the motion sensor while it is switched on. The readings are judged on your phone and never uploaded — only an SOS you actually send leaves the phone',
          'Fake call places no real call and tells your family nothing. The caller name, number and timer are stored on your phone only',
          'The voice heard after answering a fake call is your phone\'s own text-to-speech. The microphone is not used and nothing is recorded',
          'Your nicknames for other members, and your language choice, are stored on your phone for you alone',
          'Everything in this section is removed when you uninstall the app',
          "Crash detection reads the motion sensor only while it is switched on and you are travelling fast. The readings are judged on your phone and never uploaded",
        ],
      },
      crash: {
        title: 'Crash and Diagnostic Reports',
        items: [
          'When the app crashes or stops responding, a report is sent to Firebase Crashlytics so the fault can be found and fixed',
          'A report contains the technical fault, your device model and Android version, and an anonymous account identifier',
          'It does not contain your location, your messages, your name or your phone number',
          'Nothing is collected until you accept this policy, and reports are never used for advertising or profiling',
        ],
      },
      providers: {
        title: 'Who Else Is Involved',
        items: [
          'Supabase — hosts the database and handles sign-in',
          'Google Firebase — delivers push notifications, and receives crash reports via Crashlytics',
          'Agora — carries live call audio and video',
          'OpenWeatherMap — provides the weather shown on family cards. It receives only an approximate area (rounded to about 11 km), sent from our server, never your exact position or your phone’s address',
          'These providers process data only to run the service, never for their own purposes',
          'Your mobile operator carries offline SMS alerts, as it carries any text message you send',
          'Your data is not sold. Beyond these providers and your own family group, the only recipient is an extra number you choose yourself for offline SMS alerts',
        ],
      },
      protect: {
        title: 'How We Protect It',
        items: [
          'Data is held on SOC 2 compliant Supabase infrastructure',
          'Row Level Security restricts every table to the people entitled to see it',
          'Passwords are bcrypt hashed — we cannot see them',
          'All requests require an authenticated session',
          'Edge Functions verify caller identity before processing any data',
          'Calls are authorised per call with short-lived, server-issued tokens',
        ],
      },
      retention: {
        title: 'How Long We Keep It',
        items: [
          'Messages are deleted automatically after 90 days',
          'A photo, video, voice note or document attached to a message is not automatically removed when that 90-day purge runs',
          'Resolved SOS alerts are deleted automatically after 30 days',
          'Location history is deleted automatically after 7 days',
          'Unused device notification tokens are removed after 60 days',
          'Deleting your account removes your data from these records',
          'Settings kept on your phone — fake call details, offline SMS numbers, nicknames — go when you uninstall the app',
          "Driving trips are deleted automatically after 30 days, and at once when you turn Driving trips off",
          "Phone lost records are deleted when lost mode ends, and in any case after 12 hours",
          "SOS voice clips and photos are deleted automatically after 7 days",
          "Nearby Help requests and answers are deleted together with the SOS they belong to, 30 days after it is resolved",
          "Place arrival and leaving notices, and battery and phone-offline alerts, are kept until you delete your account, and are then removed",
          "Wrong-password reports, including any photo, are deleted automatically after 7 days",
        ],
      },
      choices: {
        title: 'Your Choices',
        items: [
          'View all your data — it is visible to you inside your own family group',
          'Turn location sharing off at any time in Profile → Privacy',
          'Leave a family group at any time',
          'Turn Shake for SOS off at any time in Profile',
          'Turn offline SMS alerts off at any time in Profile, and remove the extra number',
          'Clear message and call history from their respective screens',
          'Delete your account and its data from Profile → Delete My Account, or from the Delete Account page on the Famora website without the app',
          'Withdraw camera, microphone, location, SMS or notification access in Android settings',
          "Turn Overspeed alert, Driving trips and Crash detection on or off at any time in Profile → Driving safety, and Weather alerts in Profile → Safety",
          "Turn \"Allow Phone lost\" on or off at any time in Profile → Safety",
          "Turn Voice clip with my SOS on or off at any time in Profile → Safety",
          "Opt in or out of Nearby Help at any time from the SOS page, and hide entries from your own Nearby Help history",
          "Delete a saved place at any time in Profile → Places",
          "Turn the wrong-password alert and its photo option on or off at any time in Profile → Anti-theft, which also removes Famora's device-admin permission from your phone",
        ],
      },
    },
  },

  // ────────────────────────────────────────────────────────────────── Tamil ──
  // See the NOT REVIEWED BY A LAWYER note at the top of this file.
  ta: {
    lastUpdated: '26 செப்டம்பர் 2026',
    pageTitle: 'தனியுரிமைக் கொள்கை',
    consentTitle: 'தனியுரிமைக் கொள்கை & பயன்பாட்டு விதிமுறைகள்',
    lastUpdatedLabel: 'கடைசியாகப் புதுப்பிக்கப்பட்டது',
    promiseLead: 'Famora ஒரு எளிய உறுதிமொழியின் மீது கட்டப்பட்டுள்ளது:',
    promiseStrong: 'உங்கள் தரவு உங்களுக்கும் உங்கள் குடும்பத்திற்கும் மட்டுமே சொந்தம் — வேறு யாருக்கும் அல்ல.',
    promiseTail: 'உங்கள் குடும்பத்தைப் பாதுகாப்பாகவும் இணைந்தும் வைத்திருக்கத் தேவையானதை மட்டுமே நாங்கள் சேகரிக்கிறோம்.',
    intro:
      'Famora குடும்பங்கள் இணைந்திருக்கவும், அவசர நேரத்தில் ஒருவரை ஒருவர் விரைவாக ' +
      'அடையவும் உதவுகிறது. நீங்கள் இணையத் தேர்ந்தெடுக்கும் குடும்பக் குழுவுடன் மட்டுமே ' +
      'உங்கள் இருப்பிடம், செய்திகள் மற்றும் அழைப்புகள் பகிரப்படுகின்றன — மேலும், "இணையம் இல்லாதபோது SMS" இயக்கினால், நீங்களே தேர்ந்தெடுக்கும் ஒரு கூடுதல் எண்ணுடனும். என்ன ' +
      'சேகரிக்கப்படுகிறது, ஏன், யாருடன் பகிரப்படுகிறது, எவ்வளவு காலம் வைக்கப்படுகிறது ' +
      'என்பதை இந்தப் பக்கம் விளக்குகிறது.',
    consentNote:
      'தொடர்வதன் மூலம், இந்தக் கொள்கையை நீங்கள் படித்து ஏற்றுக்கொள்வதாகவும், வேறொருவர் ' +
      'சார்பாக நீங்கள் அமைக்கும் எந்தக் கணக்கின் இருப்பிடத்தையும் பகிர உங்களுக்கு உரிமை ' +
      'உள்ளது என்பதையும் உறுதிப்படுத்துகிறீர்கள்.',
    contactPrompt: 'உங்கள் தனியுரிமை குறித்து கேள்விகள் உள்ளதா?',
    contactPromptConsent: 'கேள்விகளா, அல்லது தரவுக் கோரிக்கையா?',
    sections: {
      collect: {
        title: 'நாங்கள் சேகரிக்கும் தகவல்கள்',
        items: [
          'மொபைல் எண் — உங்கள் கணக்கை உருவாக்கவும் உள்நுழையவும் பயன்படுகிறது',
          'காட்சிப் பெயர், மற்றும் நீங்கள் சேர்த்தால் ஒரு சுயவிவரப் படம்',
          'இருப்பிடப் பகிர்வு இயக்கத்தில் இருக்கும் போது உங்கள் இருப்பிடம்',
'பேட்டரி அளவு, சார்ஜ் நிலை, மற்றும் நகரும்போது வேகம் — உங்கள் இருப்பிடத்துடன் சேர்த்து குடும்பத்திற்குக் காட்டப்படும்',
          'உங்கள் குடும்பக் குழுவினுள் நீங்கள் அனுப்பும் செய்திகள்',
          "உங்கள் குடும்பக் குழுவின் அரட்டையிலோ அல்லது மற்றொரு உறுப்பினருடனான தனிப்பட்ட ஒன்றுக்கு ஒன்று உரையாடலிலோ, ஒரு செய்திக்கு நீங்கள் இணைக்கத் தேர்ந்தெடுக்கும் புகைப்படங்கள், வீடியோக்கள், (உங்கள் ஒலிவாங்கியால் பதிவு செய்யப்படும்) குரல் குறிப்புகள் மற்றும் ஆவணங்கள்",
          'நீங்கள் அனுப்பும் அல்லது பெறும் SOS எச்சரிக்கைகள், அந்த நேரத்திய இருப்பிடம் உட்பட',
          'அழைப்புப் பதிவுகள்: யார் யாரை அழைத்தார்கள், நேரம், கால அளவு, மற்றும் அது குரல் அழைப்பா வீடியோ அழைப்பா என்பது',
          'எச்சரிக்கைகளும் அழைப்புகளும் உங்கள் தொலைபேசியை அடைவதற்கான ஒரு சாதன அறிவிப்பு டோக்கன்',
          'அழைப்புகளையும் எச்சரிக்கைகளையும் நம்பகமாக வழங்கத் தேவையான அடிப்படை சாதன விவரங்கள்',
'இயக்க உணரி அளவீடுகள், "குலுக்கினால் SOS" இயக்கத்தில் இருக்கும்போது மட்டும் — அவை உங்கள் கைபேசியிலேயே ஆராயப்படுகின்றன, எங்கும் அனுப்பப்படுவதில்லை',
          '"இணையம் இல்லாதபோது SMS" பயன்படுத்தினால், அதற்காக நீங்கள் உள்ளிடும் கூடுதல் தொலைபேசி எண்',
          'செயலி வேலை செய்யாமல் நின்றால், செயலிழப்பு மற்றும் கண்டறிதல் அறிக்கைகள் — கீழே காண்க',
          "நீங்கள் \"ஓட்டப் பயணங்கள்\" இயக்கினால்: ஒவ்வொரு பயணத்தின் தொடக்க, முடிவு நேரம், தூரம், சராசரி மற்றும் அதிகபட்ச வேகம், திடீர் பிரேக் மற்றும் திடீர் வேகமெடுப்பின் எண்ணிக்கை — மேலே உள்ள இருப்பிடத் தரவிலிருந்தே கணக்கிடப்படுகிறது, கூடுதல் சென்சார் இல்லை",
          "நீங்கள் சேமித்த இடங்கள் (பெயர் மற்றும் இடம்) மற்றும் \"அதிவேக எச்சரிக்கை\"க்கு நீங்கள் அமைத்த வேக வரம்பு — சேமித்த இடங்கள் உங்களுக்கு மட்டுமே தெரியும்",
          "உங்கள் ஃபோனில் \"தொலைந்த ஃபோன்\" பயன்படுத்தப்பட்டால்: அது தொலைந்ததாகக் குறிக்கப்பட்ட தகவல், யார் குறித்தார், அவர் தட்டச்சு செய்த குறுஞ்செய்தி, தொலைந்த நிலையில் சில வினாடிகளுக்கு ஒருமுறை ஃபோனின் இருப்பிடம்",
          "உங்கள் நெட்வொர்க் வகை (Wi-Fi அல்லது மொபைல் டேட்டா) மற்றும் சிக்னல் வலிமை, உங்கள் குடும்பத்துக்கு உங்கள் அட்டையில் காட்டப்படும்",
          "நீங்கள் சேமித்த இடத்துக்கு (வீடு, அலுவலகம் போன்றவை) வரும்போது அல்லது அங்கிருந்து புறப்படும்போது: இடத்தின் பெயர், வந்தீர்களா புறப்பட்டீர்களா, நேரம். இது உங்கள் குடும்பத்துக்குத் தெரிவிக்கப்படும்; அந்த இடத்தின் சரியான இருப்பிடம் ஒருபோதும் தெரிவிக்கப்படாது",
          "\"என் SOS-உடன் குரல் பதிவு\" இயக்கினால்: செயலியிலிருந்து SOS அனுப்பிய பிறகு உங்கள் ஃபோன் பதிவு செய்யும் 15 வினாடி வரை ஒலி, மேலும் நீங்கள் சேர்க்க விரும்பினால் கேமராவிலிருந்து ஒரு படம்",
          "\"அருகிலுள்ள உதவி\"யில் சேர்ந்தால்: உங்கள் தோராயமான இருப்பிடம் (உங்களுக்கு அருகில் SOS அனுப்புபவர்களுடன் பொருத்த), அருகிலுள்ளவர்கள் வரைபடத்தில் மங்கலான அடையாளமற்ற புள்ளி, மற்றும் உதவிக் கோரிக்கைகளுக்கு நீங்கள் அளிக்கும் பதில்கள்",
          "சுயவிவரம் → திருட்டுத் தடுப்பு-இல் தவறான கடவுச்சொல் எச்சரிக்கையை இயக்கினால்: உங்கள் ஃபோனில் 10 நிமிடங்களுக்குள் 3 அல்லது அதற்கு மேற்பட்ட தவறான திரைப்பூட்டு முயற்சிகள் நடந்த உண்மை, எத்தனை முயற்சிகள், அந்த நேரத்தில் அதன் இருப்பிடம்; மேலும், படம் எடுக்கும் விருப்பத்தையும் இயக்கினால் மட்டும், அதற்குப் பின் எடுக்கப்படும் ஒரு முன் கேமரா படம்",
        ],
      },
      use: {
        title: 'அதை நாங்கள் எப்படிப் பயன்படுத்துகிறோம்',
        items: [
          'உங்கள் இருப்பிடம் உங்கள் சொந்தக் குடும்பக் குழு உறுப்பினர்களுக்கு மட்டுமே தெரியும்',
          'கடந்த 7 நாட்களில் நீங்கள் எங்கெல்லாம் சென்றீர்கள் என்பதையும் குடும்ப உறுப்பினர்கள் வரைபடத்தின் காலவரிசையில் பார்க்கலாம்',
          'செய்திகள் அந்தக் குடும்பக் குழு உறுப்பினர்களுக்கு மட்டுமே தெரியும்',
          "உங்கள் குடும்பக் குழுவின் அரட்டையில் ஒரு செய்திக்கு இணைக்கப்படும் புகைப்படம், வீடியோ, குரல் குறிப்பு அல்லது ஆவணம் அந்தச் செய்தியைப் போலவே அந்தக் குழுவுக்குத் தெரியும்; ஒரு தனிப்பட்ட ஒன்றுக்கு ஒன்று செய்திக்கு இணைக்கப்படுவது உங்களுக்கும் மற்றவருக்கும் மட்டுமே தெரியும், உங்கள் குடும்பக் குழுவின் மற்றவர்களுக்கு ஒருபோதும் இல்லை",
          'அறிவிப்பு டோக்கன்கள் எச்சரிக்கைகள், செய்திகள் மற்றும் அழைப்புகளை வழங்க மட்டுமே பயன்படுகின்றன',
          'அழைப்பு மற்றும் வீடியோ உள்ளடக்கம் எங்களால் ஒருபோதும் பதிவு செய்யப்படுவதோ சேமிக்கப்படுவதோ இல்லை',
          'உங்கள் செய்திகளை நாங்கள் படிப்பதில்லை, உங்கள் தரவை விற்பதுமில்லை',
          'விளம்பரத்திற்கோ சுயவிவரத் தொகுப்பிற்கோ உங்கள் தரவை நாங்கள் பயன்படுத்துவதில்லை',
          "\"அதிவேக எச்சரிக்கை\" மற்றும் \"ஓட்டப் பயணங்கள்\" நீங்கள் இயக்கும் வரை அணைந்தே இருக்கும். இயக்கிய பிறகு, உங்கள் குடும்பக் குழு உங்கள் பயணங்களைப் பார்க்கலாம்; நீங்கள் தேர்ந்தெடுத்த வரம்பைத் தாண்டினால் அவர்களுக்குத் தெரிவிக்கப்படும்; உங்கள் ஃபோனிலும் எச்சரிக்கை வரும்",
          "கடுமையான வானிலை எச்சரிக்கைகள் உங்களுக்கு மட்டுமே, உங்கள் சேமித்த இடங்களுக்காக வரும். ஒவ்வொரு இடத்தின் தோராயமான பகுதி மட்டுமே (சுமார் 11 கி.மீ-க்கு வட்டமாக்கப்பட்டது) எங்கள் சர்வரிலிருந்து OpenWeatherMap-க்கு அனுப்பப்படுகிறது",
          "\"விபத்து கண்டறிதல்\" நீங்கள் இயக்கும் வரை அணைந்தே இருக்கும். அது தானாக எதையும் அனுப்பாது: விபத்து என அடையாளம் கண்டால் 20 வினாடி கவுண்ட்டவுன் மட்டுமே தொடங்கும்; நீங்கள் ரத்து செய்யாவிட்டால் மட்டுமே SOS செல்லும்",
          "Profile → Safety-இல் \"தொலைந்த ஃபோன் அனுமதி\"யை நீங்கள் இயக்கும் வரை அது அணைந்தே இருக்கும். இயக்கிய பிறகே உங்கள் குடும்பங்களில் ஒன்றின் நிர்வாகி உங்கள் ஃபோனைத் தொலைந்ததாகக் குறிக்க முடியும். அப்போது ஃபோன் சில வினாடிகளுக்கு ஒருமுறை இருப்பிடத்தைத் தெரிவிக்கும், 2 நிமிடத்துக்கு ஒருமுறை ஒலிக்கும், பூட்டுத் திரையில் செய்தியைக் காட்டும்; குடும்பத்தின் ஒவ்வொருவரும் அது தொலைந்ததாகக் குறிக்கப்பட்டிருப்பதைப் பார்க்கலாம். 12 மணி நேரத்துக்குப் பிறகு அல்லது கிடைத்ததாகக் குறிக்கும்போது நிற்கும்",
          "உங்கள் ஃபோன் பேட்டரி சார்ஜ் ஆகாத நிலையில் 15% அல்லது 5%-க்கு குறையும்போது, சுமார் 45 நிமிடங்களாக ஃபோன் எந்தத் தகவலும் அனுப்பாதபோது (ஃபோன் அணைந்திருக்கலாம் அல்லது நெட்வொர்க் இல்லை), மீண்டும் தகவல் அனுப்பும்போது உங்கள் குடும்பத்துக்குத் தெரிவிக்கப்படும். இந்த எச்சரிக்கைகளில் பேட்டரி அளவும் ஃபோன் எவ்வளவு நேரம் அமைதியாக இருந்தது என்பதும் இருக்கும். Profile → தனியுரிமையில் இருப்பிடப் பகிர்வை அணைத்தால் இவை நின்றுவிடும். ஆஃப்லைன் எச்சரிக்கைகள் இந்திய நேரம் இரவு 11 முதல் காலை 6 வரை நிறுத்தி வைக்கப்படும்",
          "SOS-உடன் இணைக்கப்படும் குரல் பதிவு அல்லது படம் அந்த SOS அனுப்பப்பட்ட குடும்பங்களுக்கு மட்டுமே செல்லும். அது தனிப்பட்ட முறையில் சேமிக்கப்படும், அருகிலுள்ள உதவியாளர்களுக்கு ஒருபோதும் காட்டப்படாது, 7 நாட்களுக்குப் பிறகு நீக்கப்படும்",
          "\"அருகிலுள்ள உதவி\" நீங்கள் சேரும் வரை அணைந்தே இருக்கும். உதவ முடியாத தூரத்தில் உள்ள குடும்பத்துக்கு SOS சென்றடையக்கூடும்போது, மிக அருகிலுள்ள சேர்ந்தவர்களிடம் (முதலில் 2 கி.மீ-க்குள், பிறகு 5 கி.மீ, பிறகு 10 கி.மீ) அனுப்புநருக்காக சரியான அவசர எண்ணை அழைக்கக் கேட்கப்படும். அவர்கள் தோராயமான பகுதியையும் தேவைப்படும் உதவி வகையையும் மட்டுமே பார்ப்பார்கள், பெயரையோ ஃபோன் எண்ணையோ அல்ல; ஏற்றுக்கொள்ளும் ஒருவருக்கு மட்டுமே சரியான இருப்பிடம் காட்டப்படும். யாரும் அந்த இடத்துக்குப் பயணிக்கக் கேட்கப்பட மாட்டார்கள்",
          "\"அருகிலுள்ள உதவி\" காரணமாக, இருப்பிடத்துடன் நீங்கள் SOS அனுப்பும்போது, அந்த SOS-இன் தோராயமான பகுதியும் தேவைப்படும் உதவி வகையும் அதற்கு அருகில் உள்ள, சேர்ந்த Famora பயனர்களுக்கு அனுப்பப்படலாம். உங்கள் பெயர், ஃபோன் எண், செய்திகள், குரல் பதிவு அல்லது படம் அவர்களுக்குக் கிடைக்காது",
          "நீங்கள் சேமித்த இடங்களுக்கு வருகை/புறப்பாடு அறிவிப்புகள் உங்கள் குடும்பக் குழுவுக்குச் செல்லும்; இடத்தின் சரியான இருப்பிடம் உங்களிடமே இருக்கும்",
          "ஏதேனும் ஒரு குடும்ப உறுப்பினர் உங்கள் ஃபோனைக் கண்டுபிடிக்க உதவும்படி அதை உரக்க ஒலிக்கச் செய்யலாம் (\"Find My Phone\"); இது உங்கள் குடும்பத்திற்கு ஏற்கனவே தெரிந்ததைத் தாண்டி உங்கள் இருப்பிடத்தை வெளிப்படுத்தாது",
          "தவறான கடவுச்சொல் எச்சரிக்கை சுயவிவரம் → திருட்டுத் தடுப்பு-இல் நீங்கள் இயக்கும் வரை அணைந்தே இருக்கும். இயக்கிய பிறகு, 10 நிமிடங்களுக்குள் 3 அல்லது அதற்கு மேற்பட்ட தவறான திரைப்பூட்டு முயற்சிகள் — எத்தனை முயற்சிகள் மற்றும் ஃபோனின் கடைசி அறியப்பட்ட இருப்பிடத்துடன் — உங்கள் குடும்பக் குழுக்களின் நிர்வாகிகளுக்கு மட்டுமே, 10 நிமிடத்திற்கு ஒரு முறை மட்டுமே தெரிவிக்கப்படும். தவறான திரைப்பூட்டு முயற்சிகளைப் பற்றி மட்டும் தெரிந்துகொள்ள Android-இன் சாதன நிர்வாகி அனுமதியைப் பயன்படுத்துகிறது; உங்கள் ஃபோனைப் பூட்டவோ அழிக்கவோ வேறு எப்படியும் கட்டுப்படுத்தவோ நாங்கள் ஒருபோதும் பயன்படுத்துவதில்லை. படம் எடுக்கும் விருப்பத்தையும் இயக்கினால், அத்தகைய அறிக்கைக்குப் பின் ஒரு முன் கேமரா படம் எடுக்கப்படும்; உங்களுக்கும் அந்த நிர்வாகிகளுக்கும் மட்டுமே அதைப் பார்க்க முடியும்",
        ],
      },
      calls: {
        title: 'குரல் மற்றும் வீடியோ அழைப்புகள்',
        items: [
          'அழைப்புகள் குடும்ப உறுப்பினர்களுக்கு இடையே இணையம் வழியாக நடக்கின்றன, தொலைபேசி நெட்வொர்க் வழியாக அல்ல',
          'ஒலியும் வீடியோவும் எங்கள் அழைப்பு வழங்குநரான Agora வழியாகச் செல்கின்றன, அவை பதிவு செய்யப்படுவதில்லை',
          'அழைப்புப் பதிவுகள் மட்டுமே சேமிக்கப்படுகின்றன — உரையாடல் ஒருபோதும் அல்ல',
          'அழைப்பின் போது ஒலிவாங்கி பயன்படுத்தப்படுகிறது; வீடியோ அழைப்பின் போது மட்டும் கேமரா',
          'எந்தக் குடும்ப உறுப்பினரும் குடும்பத்தின் அழைப்பு வரலாற்றை நீக்க முடியும்',
        ],
      },
      sms: {
        title: 'இணையம் இல்லாதபோது SMS',
        items: [
          '"சுயவிவரம்" → "இணையம் இல்லாதபோது SMS"-இல் நீங்கள் இயக்கும் வரை அணைந்தே இருக்கும்',
          'உங்கள் கைபேசியில் பதினைந்து நிமிடங்கள் இணையம் இல்லாதபோது, உங்கள் கடைசி இருப்பிடத்தை SMS-ஆக அனுப்பும், அதனால் குடும்பம் யோசனையில் இருக்க வேண்டியதில்லை',
          'அந்தச் செய்தியில் உங்கள் பெயர், எவ்வளவு நேரமாக இணையம் இல்லை, ஒரு வரைபட இணைப்பு — வேறு எதுவும் இல்லை',
          'நீங்கள் இருக்கும் ஒவ்வொரு குடும்பத்தின் நிர்வாகிகளுக்கும், நீங்கள் சேர்த்தால் ஒரு கூடுதல் எண்ணுக்கும் செல்லும். அந்த எண் உங்கள் தேர்வு, அது உங்கள் குடும்பக் குழுவுக்கு வெளியே உள்ள ஒருவராகவும் இருக்கலாம்',
          'செய்தி மொபைல் நெட்வொர்க் வழியாகச் செல்கிறது, எனவே மற்ற எந்த SMS-ஐயும் போலவே உங்கள் மொபைல் நிறுவனம் அதைக் கையாளும்',
          'ஒவ்வொரு எச்சரிக்கைக்கும் உங்கள் மொபைல் திட்டம் கட்டணம் வசூலிக்கும், ஒரு முறை இணையம் இல்லாதபோது எட்டுக்கு மேல் அனுப்பப்படாது',
          'SMS அனுப்ப Android அனுமதி அளிக்க வேண்டும்; அதை எப்போது வேண்டுமானாலும் Android அமைப்புகளில் திரும்பப் பெறலாம்',
          'அனுப்ப வேண்டிய எண்கள் உங்கள் கைபேசியில் சேமிக்கப்படுகின்றன, அதனால் இணைப்பு இல்லாமலும் வேலை செய்யும்; வேறு எதற்கும் அவற்றை நாங்கள் பயன்படுத்துவதில்லை',
        ],
      },
      onphone: {
        title: 'உங்கள் கைபேசியிலேயே இருப்பவை',
        items: [
          '"குலுக்கினால் SOS" இயக்கத்தில் இருக்கும்போது இயக்க உணரியைப் படிக்கிறது. அந்த அளவீடுகள் கைபேசியிலேயே ஆராயப்படுகின்றன, ஒருபோதும் பதிவேற்றப்படுவதில்லை — நீங்கள் உண்மையில் அனுப்பும் SOS மட்டுமே கைபேசியை விட்டு வெளியே செல்கிறது',
          '"போலி அழைப்பு" உண்மையான அழைப்பை ஏற்படுத்துவதில்லை, உங்கள் குடும்பத்திற்கு எதுவும் தெரிவிப்பதில்லை. அழைப்பவர் பெயர், எண், நேரம் — அனைத்தும் உங்கள் கைபேசியில் மட்டுமே சேமிக்கப்படுகின்றன',
          'போலி அழைப்புக்குப் பதிலளித்த பிறகு கேட்கும் குரல் உங்கள் கைபேசியின் சொந்த உரை-குரல் வசதி. ஒலிவாங்கி பயன்படுத்தப்படுவதில்லை, எதுவும் பதிவு செய்யப்படுவதில்லை',
          'மற்ற உறுப்பினர்களுக்கு நீங்கள் வைக்கும் செல்லப்பெயர்களும், உங்கள் மொழித் தேர்வும் உங்களுக்காக மட்டும் கைபேசியில் சேமிக்கப்படுகின்றன',
          'இந்தப் பகுதியில் உள்ள அனைத்தும் செயலியை நீக்கும்போது அகற்றப்படும்',
          "\"விபத்து கண்டறிதல்\" இயக்கத்தில் இருந்து நீங்கள் வேகமாகப் பயணிக்கும்போது மட்டுமே இயக்க சென்சாரைப் படிக்கும். அளவீடுகள் உங்கள் ஃபோனிலேயே மதிப்பிடப்படும், பதிவேற்றப்படாது",
        ],
      },
      crash: {
        title: 'செயலிழப்பு மற்றும் கண்டறிதல் அறிக்கைகள்',
        items: [
          'செயலி செயலிழந்தால் அல்லது பதிலளிக்காமல் நின்றால், பிழையைக் கண்டறிந்து சரிசெய்ய Firebase Crashlytics-க்கு ஒரு அறிக்கை அனுப்பப்படும்',
          'அந்த அறிக்கையில் தொழில்நுட்பப் பிழை, உங்கள் சாதன மாடல் மற்றும் Android பதிப்பு, மற்றும் அடையாளம் தெரியாத ஒரு கணக்கு அடையாளக் குறியீடு இருக்கும்',
          'அதில் உங்கள் இருப்பிடம், உங்கள் செய்திகள், உங்கள் பெயர் அல்லது தொலைபேசி எண் இருக்காது',
          'இந்தக் கொள்கையை நீங்கள் ஏற்கும் வரை எதுவும் சேகரிக்கப்படாது; இந்த அறிக்கைகள் விளம்பரத்திற்கோ சுயவிவரத் தொகுப்பிற்கோ ஒருபோதும் பயன்படுத்தப்படுவதில்லை',
        ],
      },
      providers: {
        title: 'வேறு யார் ஈடுபட்டுள்ளனர்',
        items: [
          'Supabase — தரவுத்தளத்தை இயக்குகிறது, உள்நுழைவைக் கையாள்கிறது',
          'Google Firebase — புஷ் அறிவிப்புகளை வழங்குகிறது, மேலும் Crashlytics வழியாக செயலிழப்பு அறிக்கைகளைப் பெறுகிறது',
          'Agora — நேரடி அழைப்பின் ஒலி மற்றும் வீடியோவைக் கொண்டு செல்கிறது',
          'OpenWeatherMap — குடும்ப அட்டைகளில் காட்டப்படும் வானிலையை வழங்குகிறது. எங்கள் server-இலிருந்து தோராயமான பகுதி (சுமார் 11 கி.மீ. அளவுக்குச் சுருக்கியது) மட்டுமே அனுப்பப்படுகிறது, உங்கள் துல்லியமான இருப்பிடமோ போனின் முகவரியோ அல்ல',
          'நீங்கள் அனுப்பும் மற்ற எந்தச் செய்தியையும் போலவே, "இணையம் இல்லாதபோது SMS" எச்சரிக்கைகளையும் உங்கள் மொபைல் நிறுவனம் கொண்டு செல்கிறது',
          'இந்த வழங்குநர்கள் சேவையை இயக்குவதற்காக மட்டுமே தரவைக் கையாள்கிறார்கள், தங்கள் சொந்த நோக்கங்களுக்காக ஒருபோதும் அல்ல',
          'உங்கள் தரவு விற்கப்படுவதில்லை. இந்த வழங்குநர்களையும் உங்கள் சொந்தக் குடும்பக் குழுவையும் தவிர, "இணையம் இல்லாதபோது SMS"-க்காக நீங்களே தேர்ந்தெடுக்கும் ஒரு கூடுதல் எண் மட்டுமே பெறுநர்',
        ],
      },
      protect: {
        title: 'அதை நாங்கள் எப்படிப் பாதுகாக்கிறோம்',
        items: [
          'தரவு SOC 2 தரநிலைக்கு இணங்கும் Supabase உள்கட்டமைப்பில் வைக்கப்படுகிறது',
          'Row Level Security ஒவ்வொரு அட்டவணையையும் அதைப் பார்க்க உரிமையுள்ளவர்களுக்கு மட்டுமே கட்டுப்படுத்துகிறது',
          'கடவுச்சொற்கள் bcrypt முறையில் மறையாக்கம் செய்யப்படுகின்றன — அவற்றை எங்களால் பார்க்க முடியாது',
          'அனைத்துக் கோரிக்கைகளுக்கும் அங்கீகரிக்கப்பட்ட அமர்வு தேவை',
          'எந்தத் தரவையும் செயலாக்கும் முன் Edge Functions அழைப்பாளரின் அடையாளத்தைச் சரிபார்க்கின்றன',
          'ஒவ்வொரு அழைப்பும் சேவையகம் வழங்கும் குறுகிய கால டோக்கன்களால் தனித்தனியே அங்கீகரிக்கப்படுகிறது',
        ],
      },
      retention: {
        title: 'எவ்வளவு காலம் வைத்திருக்கிறோம்',
        items: [
          'செய்திகள் 90 நாட்களுக்குப் பிறகு தானாகவே நீக்கப்படும்',
          'ஒரு செய்திக்கு இணைக்கப்படும் புகைப்படம், வீடியோ, குரல் குறிப்பு அல்லது ஆவணம் அந்த 90-நாள் அகற்றல் நடக்கும்போது தானாக நீக்கப்படாது',
          'முடிக்கப்பட்ட SOS எச்சரிக்கைகள் 30 நாட்களுக்குப் பிறகு தானாகவே நீக்கப்படும்',
          'இருப்பிட வரலாறு 7 நாட்களுக்குப் பிறகு தானாகவே நீக்கப்படும்',
          'பயன்படுத்தப்படாத சாதன அறிவிப்பு டோக்கன்கள் 60 நாட்களுக்குப் பிறகு அகற்றப்படும்',
          'உங்கள் கணக்கை நீக்கினால், இந்தப் பதிவுகளிலிருந்து உங்கள் தரவு அகற்றப்படும்',
'உங்கள் கைபேசியில் சேமிக்கப்படும் அமைப்புகள் — போலி அழைப்பு விவரங்கள், "இணையம் இல்லாதபோது SMS" எண்கள், செல்லப்பெயர்கள் — செயலியை நீக்கும்போது போய்விடும்',
          "ஓட்டப் பயணங்கள் 30 நாட்களுக்குப் பிறகு தானாக நீக்கப்படும்; \"ஓட்டப் பயணங்கள்\" அணைத்தால் உடனே நீக்கப்படும்",
          "தொலைந்த ஃபோன் பதிவுகள் அந்த நிலை முடிந்ததும், எப்படியிருந்தாலும் 12 மணி நேரத்துக்குப் பிறகும் நீக்கப்படும்",
          "SOS குரல் பதிவுகளும் படங்களும் 7 நாட்களுக்குப் பிறகு தானாக நீக்கப்படும்",
          "\"அருகிலுள்ள உதவி\" கோரிக்கைகளும் பதில்களும் அவை சார்ந்த SOS தீர்க்கப்பட்ட 30 நாட்களுக்குப் பிறகு அதனுடன் சேர்ந்து நீக்கப்படும்",
          "இட வருகை/புறப்பாடு அறிவிப்புகள், பேட்டரி மற்றும் ஃபோன் ஆஃப்லைன் எச்சரிக்கைகள் நீங்கள் கணக்கை நீக்கும் வரை வைக்கப்பட்டு, பின்னர் நீக்கப்படும்",
          "தவறான கடவுச்சொல் அறிக்கைகள், அவற்றின் படம் உட்பட, 7 நாட்களுக்குப் பிறகு தானாக நீக்கப்படும்",
        ],
      },
      choices: {
        title: 'உங்கள் தேர்வுகள்',
        items: [
          'உங்கள் தரவு அனைத்தையும் பார்க்கலாம் — அது உங்கள் சொந்தக் குடும்பக் குழுவினுள் உங்களுக்குத் தெரியும்',
          'எப்போது வேண்டுமானாலும் "சுயவிவரம்" → "தனியுரிமை"-யில் இருப்பிடப் பகிர்வை நிறுத்தலாம்',
          'எப்போது வேண்டுமானாலும் ஒரு குடும்பக் குழுவிலிருந்து விலகலாம்',
'"சுயவிவரம்"-இல் எப்போது வேண்டுமானாலும் "குலுக்கினால் SOS"-ஐ நிறுத்தலாம்',
          '"சுயவிவரம்"-இல் எப்போது வேண்டுமானாலும் "இணையம் இல்லாதபோது SMS"-ஐ நிறுத்தி, கூடுதல் எண்ணை அகற்றலாம்',
          'செய்தி மற்றும் அழைப்பு வரலாற்றை அந்தந்தத் திரைகளிலிருந்து நீக்கலாம்',
          '"சுயவிவரம்" → "என் கணக்கை நீக்கு" மூலம், அல்லது செயலி இல்லாமல் Famora இணையதளத்தின் "Delete Account" பக்கத்தின் மூலம் உங்கள் கணக்கையும் அதன் தரவையும் நீக்கலாம்',
          'Android அமைப்புகளில் கேமரா, ஒலிவாங்கி, இருப்பிடம், SMS அல்லது அறிவிப்பு அனுமதிகளைத் திரும்பப் பெறலாம்',
          "Profile → ஓட்டுநர் பாதுகாப்பு-இல் எப்போது வேண்டுமானாலும் \"அதிவேக எச்சரிக்கை\", \"ஓட்டப் பயணங்கள்\", \"விபத்து கண்டறிதல்\" ஆகியவற்றையும், Profile → Safety-இல் \"வானிலை எச்சரிக்கைகள்\" என்பதையும் இயக்கலாம் அல்லது அணைக்கலாம்",
          "Profile → Safety-இல் எப்போது வேண்டுமானாலும் \"தொலைந்த ஃபோன் அனுமதி\"யை இயக்கலாம் அல்லது அணைக்கலாம்",
          "Profile → Safety-இல் எப்போது வேண்டுமானாலும் \"என் SOS-உடன் குரல் பதிவு\" இயக்கலாம் அல்லது அணைக்கலாம்",
          "SOS பக்கத்திலிருந்து எப்போது வேண்டுமானாலும் \"அருகிலுள்ள உதவி\"யில் சேரலாம் அல்லது விலகலாம், உங்கள் வரலாற்றிலிருந்து பதிவுகளை மறைக்கலாம்",
          "Profile → இடங்கள்-இல் சேமித்த இடத்தை எப்போது வேண்டுமானாலும் நீக்கலாம்",
          "தவறான கடவுச்சொல் எச்சரிக்கையையும் அதன் படம் எடுக்கும் விருப்பத்தையும் எப்போது வேண்டுமானாலும் சுயவிவரம் → திருட்டுத் தடுப்பு-இல் இயக்கலாம் அல்லது அணைக்கலாம், இது உங்கள் ஃபோனிலிருந்து Famora-வின் சாதன நிர்வாகி அனுமதியையும் அகற்றும்",
        ],
      },
    },
  },

  // ────────────────────────────────────────────────────────────────── Hindi ──
  // See the NOT REVIEWED BY A LAWYER note at the top of this file.
  hi: {
    lastUpdated: '26 सितंबर 2026',
    pageTitle: 'गोपनीयता नीति',
    consentTitle: 'गोपनीयता नीति और उपयोग की शर्तें',
    lastUpdatedLabel: 'आख़िरी बार अपडेट किया गया',
    promiseLead: 'Famora एक सीधे वादे पर बना है:',
    promiseStrong: 'आपका डेटा आपका और आपके परिवार का है — किसी और का नहीं।',
    promiseTail: 'हम केवल वही इकट्ठा करते हैं जो आपके परिवार को सुरक्षित और जुड़ा रखने के लिए ज़रूरी है।',
    intro:
      'Famora परिवारों को आपस में जुड़े रहने और आपात स्थिति में एक-दूसरे तक तेज़ी से ' +
      'पहुँचने में मदद करता है। यह आपकी लोकेशन, संदेश और कॉल केवल उसी परिवार समूह के ' +
      'साथ साझा करता है जिसमें आप ख़ुद शामिल होना चुनते हैं — और, यदि आप "इंटरनेट न होने पर SMS" चालू करते हैं, तो आपके ख़ुद चुने हुए एक अतिरिक्त नंबर के साथ भी। इस पृष्ठ पर ठीक-ठीक बताया ' +
      'गया है कि क्या इकट्ठा किया जाता है, क्यों, किसके साथ साझा होता है और कितने समय ' +
      'तक रखा जाता है।',
    consentNote:
      'आगे बढ़ने पर आप पुष्टि करते हैं कि आपने यह नीति पढ़ ली है और इसे स्वीकार करते हैं, ' +
      'तथा किसी और की ओर से आपके द्वारा बनाए गए किसी भी खाते की लोकेशन साझा करने का ' +
      'अधिकार आपके पास है।',
    contactPrompt: 'अपनी गोपनीयता के बारे में कोई सवाल?',
    contactPromptConsent: 'कोई सवाल या डेटा से जुड़ा अनुरोध?',
    sections: {
      collect: {
        title: 'हम कौन-सी जानकारी इकट्ठा करते हैं',
        items: [
          'मोबाइल नंबर — आपका खाता बनाने और उसमें साइन इन करने के लिए',
          'प्रदर्शित नाम और, यदि आप जोड़ें तो, प्रोफ़ाइल फ़ोटो',
          'लोकेशन, जब तक लोकेशन साझा करना चालू है',
'बैटरी स्तर, चार्जिंग की स्थिति और चलते समय गति — आपकी लोकेशन के साथ परिवार को दिखते हैं',
          'आपके परिवार समूह में आपके भेजे गए संदेश',
          "आपके परिवार समूह की चैट में या किसी दूसरे सदस्य के साथ निजी एक-से-एक थ्रेड में, आप किसी संदेश के साथ जो फ़ोटो, वीडियो, (आपके माइक्रोफ़ोन से रिकॉर्ड की गई) वॉइस नोट और दस्तावेज़ जोड़ना चुनते हैं",
          'आपके भेजे या पाए गए SOS अलर्ट, उस समय की लोकेशन सहित',
          'कॉल रिकॉर्ड: किसने किसे कॉल किया, समय, अवधि और वह वॉइस थी या वीडियो',
          'डिवाइस का नोटिफ़िकेशन टोकन, ताकि अलर्ट और कॉल आपके फ़ोन तक पहुँच सकें',
          'कॉल और अलर्ट भरोसेमंद ढंग से पहुँचाने के लिए ज़रूरी बुनियादी डिवाइस जानकारी',
'मोशन सेंसर की रीडिंग, केवल तब जब "हिलाकर SOS" चालू हो — इन्हें आपके फ़ोन पर ही परखा जाता है, कहीं भेजा नहीं जाता',
          '"इंटरनेट न होने पर SMS" इस्तेमाल करने पर, उसके लिए आपका दिया हुआ अतिरिक्त फ़ोन नंबर',
          'ऐप के काम करना बंद कर देने पर क्रैश और डायग्नोस्टिक रिपोर्ट — नीचे देखें',
          "अगर आप ड्राइविंग ट्रिप चालू करते हैं: हर ड्राइव का शुरू और खत्म होने का समय, दूरी, औसत और अधिकतम रफ़्तार, और अचानक ब्रेक व तेज़ शुरुआत की गिनती — ऊपर दिए लोकेशन डेटा से ही निकाली जाती है, कोई अतिरिक्त सेंसर नहीं",
          "आपकी सहेजी हुई जगहें (नाम और स्थान) और अधिक रफ़्तार अलर्ट के लिए आपकी तय की हुई सीमा — सहेजी हुई जगहें सिर्फ़ आपको दिखती हैं",
          "अगर आपके फ़ोन पर \"फ़ोन खोया\" इस्तेमाल होता है: यह कि वह खोया हुआ चिह्नित है, किसने चिह्नित किया, उसका लिखा छोटा संदेश, और खोए रहने के दौरान हर कुछ सेकंड में फ़ोन की लोकेशन",
          "आपका नेटवर्क प्रकार (Wi-Fi या मोबाइल डेटा) और सिग्नल की ताकत, जो आपके परिवार को आपके कार्ड पर दिखती है",
          "जब आप अपनी सहेजी हुई जगह (जैसे घर या ऑफ़िस) पर पहुँचते या वहाँ से निकलते हैं: जगह का नाम, पहुँचे या निकले, और समय। यह आपके परिवार को बताया जाता है, पर उस जगह की सटीक लोकेशन कभी नहीं",
          "अगर आप \"मेरे SOS के साथ वॉइस क्लिप\" चालू करते हैं: ऐप से SOS भेजने के बाद आपका फ़ोन 15 सेकंड तक की आवाज़ रिकॉर्ड करता है, और चाहें तो कैमरे से एक फ़ोटो",
          "अगर आप \"नज़दीकी मदद\" में शामिल होते हैं: आपकी अनुमानित लोकेशन (ताकि आपके पास SOS भेजने वालों से मिलान हो सके), नज़दीकी लोगों के नक्शे पर एक धुँधला, बेनाम बिंदु, और मदद के अनुरोधों पर आपके जवाब",
          "अगर आप Profile → चोरी सुरक्षा में गलत पासवर्ड अलर्ट चालू करते हैं: यह कि आपके फ़ोन पर 10 मिनट के भीतर 3 या ज़्यादा गलत स्क्रीन-लॉक प्रयास हुए, कितने प्रयास हुए, और उस समय उसकी लोकेशन; और, सिर्फ़ अगर आप फ़ोटो वाला विकल्प भी चालू करते हैं, उसके ठीक बाद लिया गया एक फ्रंट-कैमरा फ़ोटो",
        ],
      },
      use: {
        title: 'हम इसका उपयोग कैसे करते हैं',
        items: [
          'आपकी लोकेशन केवल आपके अपने परिवार समूह के सदस्यों को दिखती है',
          'परिवार के सदस्य मैप की टाइमलाइन पर यह भी देख सकते हैं कि पिछले 7 दिनों में आप कहाँ-कहाँ गए',
          'संदेश केवल उसी परिवार समूह के सदस्यों को दिखते हैं',
          "आपके परिवार समूह की चैट में किसी संदेश से जुड़ा फ़ोटो, वीडियो, वॉइस नोट या दस्तावेज़ उस संदेश जैसा ही उस समूह को दिखता है; किसी निजी एक-से-एक संदेश से जुड़ा हुआ सिर्फ़ आपको और दूसरे व्यक्ति को दिखता है, आपके परिवार समूह के बाकी लोगों को कभी नहीं",
          'नोटिफ़िकेशन टोकन केवल अलर्ट, संदेश और कॉल पहुँचाने के लिए इस्तेमाल होते हैं',
          'कॉल और वीडियो की सामग्री हमारे द्वारा कभी रिकॉर्ड या संग्रहीत नहीं की जाती',
          'हम आपके संदेश नहीं पढ़ते, और हम आपका डेटा नहीं बेचते',
          'हम आपके डेटा का उपयोग विज्ञापन या प्रोफ़ाइलिंग के लिए नहीं करते',
          "अधिक रफ़्तार अलर्ट और ड्राइविंग ट्रिप तब तक बंद रहते हैं जब तक आप उन्हें चालू न करें। चालू होने पर आपका परिवार समूह आपकी ट्रिप देख सकता है और आपकी चुनी सीमा से तेज़ चलाने पर उसे बताया जाता है, और आपके अपने फ़ोन पर भी चेतावनी आती है",
          "गंभीर मौसम अलर्ट सिर्फ़ आपको, आपकी अपनी सहेजी हुई जगहों के लिए चेतावनी देते हैं। हर जगह का सिर्फ़ अनुमानित क्षेत्र (करीब 11 किमी तक गोल किया हुआ) हमारे सर्वर से OpenWeatherMap को भेजा जाता है",
          "दुर्घटना पहचान तब तक बंद रहती है जब तक आप उसे चालू न करें। यह खुद कुछ नहीं भेजती: दुर्घटना पहचानने पर सिर्फ़ 20 सेकंड का काउंटडाउन शुरू होता है, और आप रद्द न करें तभी SOS जाता है",
          "\"फ़ोन खोया\" तब तक बंद रहता है जब तक आप Profile → Safety में \"फ़ोन खोया की अनुमति\" चालू न करें। तभी आपके किसी परिवार का एडमिन आपका फ़ोन खोया हुआ चिह्नित कर सकता है। तब फ़ोन हर कुछ सेकंड में लोकेशन भेजता है, हर 2 मिनट में बजता है और लॉक स्क्रीन पर संदेश दिखाता है, और परिवार का हर सदस्य देख सकता है कि वह खोया चिह्नित है। यह 12 घंटे बाद या \"मिल गया\" चिह्नित करने पर रुक जाता है",
          "आपके परिवार को बताया जाता है जब आपके फ़ोन की बैटरी चार्जिंग न होने पर 15% या 5% तक गिरती है, जब फ़ोन ने लगभग 45 मिनट से कोई अपडेट नहीं भेजा (फ़ोन बंद या नेटवर्क नहीं), और जब वह फिर रिपोर्ट करता है। इन अलर्ट में बैटरी स्तर और फ़ोन कितनी देर चुप रहा यह होता है। Profile → गोपनीयता में लोकेशन साझा करना बंद करने से ये रुक जाते हैं। ऑफ़लाइन अलर्ट भारतीय समय रात 11 से सुबह 6 बजे तक रोके जाते हैं",
          "SOS के साथ जुड़ी वॉइस क्लिप या फ़ोटो सिर्फ़ उन्हीं परिवारों को जाती है जिन्हें वह SOS भेजा गया। वह निजी तौर पर रखी जाती है, नज़दीकी मददगारों को कभी नहीं दिखाई जाती, और 7 दिन बाद हटा दी जाती है",
          "\"नज़दीकी मदद\" तब तक बंद रहती है जब तक आप शामिल न हों। जब कोई SOS ऐसे परिवार तक पहुँच सकता है जो मदद के लिए बहुत दूर है, तो सबसे नज़दीकी शामिल लोगों (पहले 2 किमी, फिर 5 किमी, फिर 10 किमी) से भेजने वाले की ओर से सही आपातकालीन नंबर पर फ़ोन करने को कहा जाता है। उन्हें सिर्फ़ अनुमानित इलाका और ज़रूरत का प्रकार दिखता है, कोई नाम या फ़ोन नंबर नहीं; सटीक लोकेशन सिर्फ़ उस एक व्यक्ति को दिखती है जो स्वीकार करता है। किसी से मौके पर जाने को नहीं कहा जाता",
          "\"नज़दीकी मदद\" के कारण, जब आप लोकेशन वाला SOS भेजते हैं, तो उस SOS का अनुमानित इलाका और ज़रूरत का प्रकार उसके पास मौजूद, शामिल Famora उपयोगकर्ताओं को भेजा जा सकता है। उन्हें आपका नाम, फ़ोन नंबर, संदेश, वॉइस क्लिप या फ़ोटो कभी नहीं मिलता",
          "आपकी सहेजी हुई जगहों पर पहुँचने और निकलने की सूचनाएँ आपके परिवार समूह को जाती हैं; जगह की सटीक लोकेशन आपके पास ही रहती है",
          "कोई भी परिवार सदस्य आपका फ़ोन ढूँढने में मदद के लिए उसे तेज़ आवाज़ में बजा सकता है (\"Find My Phone\"); इससे आपकी लोकेशन के बारे में वह जानकारी नहीं मिलती जो आपके परिवार को पहले से नहीं पता",
          "गलत पासवर्ड अलर्ट तब तक बंद रहता है जब तक आप उसे Profile → चोरी सुरक्षा में चालू न करें। चालू होने पर, 10 मिनट के भीतर 3 या ज़्यादा गलत स्क्रीन-लॉक प्रयास — कितने प्रयास हुए और फ़ोन की आख़िरी जानी गई लोकेशन के साथ — सिर्फ़ आपके परिवार समूहों के एडमिन को बताए जाते हैं, हर 10 मिनट में एक बार से ज़्यादा नहीं। यह सिर्फ़ गलत पासवर्ड के बारे में बताने के लिए Android की डिवाइस-एडमिन अनुमति का उपयोग करता है; हम इसे आपका फ़ोन लॉक, वाइप या किसी और तरह से नियंत्रित करने के लिए कभी इस्तेमाल नहीं करते। अगर आप फ़ोटो वाला विकल्प भी चालू करते हैं, तो ऐसी रिपोर्ट के ठीक बाद एक फ्रंट-कैमरा फ़ोटो ली जाती है; इसे सिर्फ़ आप और वे एडमिन देख सकते हैं",
        ],
      },
      calls: {
        title: 'वॉइस और वीडियो कॉल',
        items: [
          'कॉल परिवार के सदस्यों के बीच इंटरनेट पर चलती हैं, फ़ोन नेटवर्क पर नहीं',
          'ऑडियो और वीडियो हमारे कॉलिंग प्रदाता Agora के ज़रिए जाते हैं और रिकॉर्ड नहीं किए जाते',
          'केवल कॉल रिकॉर्ड संग्रहीत होते हैं — बातचीत कभी नहीं',
          'कॉल के दौरान माइक्रोफ़ोन का उपयोग होता है; कैमरा केवल वीडियो कॉल के दौरान',
          'परिवार का कोई भी सदस्य पूरे परिवार के लिए कॉल इतिहास हटा सकता है',
        ],
      },
      sms: {
        title: 'इंटरनेट न होने पर SMS',
        items: [
          'Profile → इंटरनेट न होने पर SMS में जब तक आप चालू न करें, यह बंद रहता है',
          'आपके फ़ोन पर पंद्रह मिनट से इंटरनेट न होने पर, आपकी आख़िरी लोकेशन SMS से भेजी जाती है, ताकि परिवार अंदाज़ा न लगाता रहे',
          'उस संदेश में आपका नाम, कितनी देर से इंटरनेट नहीं है, और एक मैप लिंक होता है — इसके अलावा कुछ नहीं',
          'यह आप जिन परिवारों में हैं उन सबके एडमिन को, और आपके जोड़े जाने पर एक अतिरिक्त नंबर को जाता है। वह नंबर आपकी पसंद है और आपके परिवार समूह से बाहर का कोई भी हो सकता है',
          'संदेश मोबाइल नेटवर्क से जाता है, इसलिए आपका मोबाइल ऑपरेटर इसे किसी भी दूसरे संदेश की तरह संभालता है',
          'हर अलर्ट का शुल्क आपके मोबाइल प्लान से लगता है, और एक बार इंटरनेट जाने पर आठ से ज़्यादा नहीं भेजे जाते',
          'SMS भेजने के लिए Android की अनुमति देनी होती है, जिसे आप कभी भी Android सेटिंग्स में वापस ले सकते हैं',
          'जिन नंबरों पर भेजना है वे आपके फ़ोन पर ही रखे जाते हैं ताकि बिना कनेक्शन के भी काम करें; हम उन्हें किसी और काम के लिए इस्तेमाल नहीं करते',
        ],
      },
      onphone: {
        title: 'जो आपके फ़ोन पर ही रहता है',
        items: [
          '"हिलाकर SOS" चालू रहने पर मोशन सेंसर पढ़ा जाता है। वे रीडिंग आपके फ़ोन पर ही परखी जाती हैं, कभी अपलोड नहीं होतीं — फ़ोन से केवल वही SOS बाहर जाता है जो आप वाक़ई भेजते हैं',
          '"नकली कॉल" असल में कोई कॉल नहीं करती और आपके परिवार को कुछ नहीं बताती। कॉल करने वाले का नाम, नंबर और समय केवल आपके फ़ोन पर रहते हैं',
          'नकली कॉल उठाने के बाद सुनाई देने वाली आवाज़ आपके फ़ोन की अपनी टेक्स्ट-टू-स्पीच है। माइक्रोफ़ोन इस्तेमाल नहीं होता और कुछ भी रिकॉर्ड नहीं होता',
          'दूसरे सदस्यों के लिए रखे आपके उपनाम और आपकी भाषा का चुनाव सिर्फ़ आपके लिए फ़ोन पर रखे जाते हैं',
          'इस भाग की हर चीज़ ऐप अनइंस्टॉल करने पर हट जाती है',
          "दुर्घटना पहचान मोशन सेंसर तभी पढ़ती है जब वह चालू हो और आप तेज़ सफ़र में हों। रीडिंग आपके फ़ोन पर ही जाँची जाती हैं और कभी अपलोड नहीं होतीं",
        ],
      },
      crash: {
        title: 'क्रैश और डायग्नोस्टिक रिपोर्ट',
        items: [
          'ऐप के क्रैश होने या प्रतिक्रिया देना बंद कर देने पर एक रिपोर्ट Firebase Crashlytics को भेजी जाती है, ताकि ख़राबी ढूँढ़कर ठीक की जा सके',
          'रिपोर्ट में तकनीकी ख़राबी, आपके डिवाइस का मॉडल और Android संस्करण, तथा एक गुमनाम खाता पहचानकर्ता होता है',
          'इसमें आपकी लोकेशन, आपके संदेश, आपका नाम या आपका फ़ोन नंबर नहीं होता',
          'इस नीति को स्वीकार करने से पहले कुछ भी इकट्ठा नहीं किया जाता, और रिपोर्ट कभी विज्ञापन या प्रोफ़ाइलिंग के लिए इस्तेमाल नहीं होतीं',
        ],
      },
      providers: {
        title: 'और कौन शामिल है',
        items: [
          'Supabase — डेटाबेस होस्ट करता है और साइन-इन संभालता है',
          'Google Firebase — पुश नोटिफ़िकेशन पहुँचाता है, और Crashlytics के ज़रिए क्रैश रिपोर्ट प्राप्त करता है',
          'Agora — लाइव कॉल का ऑडियो और वीडियो ले जाता है',
          'OpenWeatherMap — फ़ैमिली कार्ड पर दिखने वाला मौसम देता है। उसे हमारे सर्वर से केवल अनुमानित इलाका (लगभग 11 कि.मी. तक गोल किया हुआ) मिलता है, आपकी सटीक लोकेशन या फ़ोन का पता नहीं',
          'आपके भेजे किसी भी संदेश की तरह, "इंटरनेट न होने पर SMS" अलर्ट भी आपका मोबाइल ऑपरेटर ले जाता है',
          'ये प्रदाता डेटा केवल सेवा चलाने के लिए संसाधित करते हैं, कभी अपने उद्देश्यों के लिए नहीं',
          'आपका डेटा बेचा नहीं जाता। इन प्रदाताओं और आपके अपने परिवार समूह के अलावा, केवल वही अतिरिक्त नंबर इसे पाता है जिसे आप ख़ुद "इंटरनेट न होने पर SMS" के लिए चुनते हैं',
        ],
      },
      protect: {
        title: 'हम इसकी सुरक्षा कैसे करते हैं',
        items: [
          'डेटा SOC 2 अनुरूप Supabase अवसंरचना पर रखा जाता है',
          'Row Level Security हर तालिका को केवल उन्हीं लोगों तक सीमित रखता है जिन्हें उसे देखने का अधिकार है',
          'पासवर्ड bcrypt से हैश किए जाते हैं — हम उन्हें देख नहीं सकते',
          'हर अनुरोध के लिए प्रमाणित सत्र आवश्यक है',
          'Edge Functions किसी भी डेटा को संसाधित करने से पहले अनुरोध करने वाले की पहचान सत्यापित करते हैं',
          'हर कॉल को अलग से, सर्वर द्वारा जारी अल्पकालिक टोकन से अधिकृत किया जाता है',
        ],
      },
      retention: {
        title: 'हम इसे कितने समय तक रखते हैं',
        items: [
          'संदेश 90 दिनों बाद अपने आप हट जाते हैं',
          'किसी संदेश से जुड़ा फ़ोटो, वीडियो, वॉइस नोट या दस्तावेज़ उस 90-दिन की सफ़ाई के दौरान अपने आप नहीं हटता',
          'सुलझे हुए SOS अलर्ट 30 दिनों बाद अपने आप हट जाते हैं',
          'लोकेशन इतिहास 7 दिनों बाद अपने आप हट जाता है',
          'उपयोग में न आने वाले डिवाइस नोटिफ़िकेशन टोकन 60 दिनों बाद हटा दिए जाते हैं',
          'खाता हटाने पर इन रिकॉर्ड से आपका डेटा हट जाता है',
'आपके फ़ोन पर रखी सेटिंग्स — नकली कॉल का विवरण, "इंटरनेट न होने पर SMS" के नंबर, उपनाम — ऐप अनइंस्टॉल करने पर चली जाती हैं',
          "ड्राइविंग ट्रिप 30 दिन बाद अपने आप हटा दी जाती हैं, और ड्राइविंग ट्रिप बंद करते ही तुरंत हट जाती हैं",
          "\"फ़ोन खोया\" के रिकॉर्ड मोड खत्म होने पर, और हर हाल में 12 घंटे बाद हटा दिए जाते हैं",
          "SOS की वॉइस क्लिप और फ़ोटो 7 दिन बाद अपने आप हटा दी जाती हैं",
          "\"नज़दीकी मदद\" के अनुरोध और जवाब उस SOS के साथ, उसके हल होने के 30 दिन बाद हटा दिए जाते हैं",
          "जगह पर पहुँचने/निकलने की सूचनाएँ तथा बैटरी और फ़ोन-ऑफ़लाइन अलर्ट आपके खाता हटाने तक रखे जाते हैं, फिर हटा दिए जाते हैं",
          "गलत पासवर्ड रिपोर्ट, उनकी फ़ोटो सहित, 7 दिन बाद अपने आप हट जाती हैं",
        ],
      },
      choices: {
        title: 'आपके विकल्प',
        items: [
          'अपना सारा डेटा देखें — यह आपको अपने परिवार समूह के भीतर दिखता है',
          'लोकेशन साझा करना कभी भी प्रोफ़ाइल → गोपनीयता में बंद करें',
          'किसी भी समय परिवार समूह छोड़ें',
'प्रोफ़ाइल में कभी भी "हिलाकर SOS" बंद करें',
          'प्रोफ़ाइल में कभी भी "इंटरनेट न होने पर SMS" बंद करें और अतिरिक्त नंबर हटाएँ',
          'संदेश और कॉल इतिहास उनकी अपनी स्क्रीन से हटाएँ',
          'अपना खाता और उसका डेटा प्रोफ़ाइल → मेरा खाता हटाएँ से, या ऐप के बिना Famora वेबसाइट के "Delete Account" पेज से हटाएँ',
          'कैमरा, माइक्रोफ़ोन, लोकेशन, SMS या नोटिफ़िकेशन की अनुमति Android सेटिंग्स में वापस लें',
          "Profile → ड्राइविंग सुरक्षा में कभी भी अधिक रफ़्तार अलर्ट, ड्राइविंग ट्रिप और दुर्घटना पहचान, तथा Profile → Safety में मौसम अलर्ट चालू या बंद करें",
          "Profile → Safety में कभी भी \"फ़ोन खोया की अनुमति\" चालू या बंद करें",
          "Profile → Safety में कभी भी \"मेरे SOS के साथ वॉइस क्लिप\" चालू या बंद करें",
          "SOS पेज से कभी भी \"नज़दीकी मदद\" में शामिल हों या हटें, और अपने इतिहास से प्रविष्टियाँ छिपाएँ",
          "Profile → जगहें में कभी भी सहेजी हुई जगह हटाएँ",
          "गलत पासवर्ड अलर्ट और उसके फ़ोटो विकल्प को कभी भी Profile → चोरी सुरक्षा में चालू या बंद करें, जिससे आपके फ़ोन से Famora की डिवाइस-एडमिन अनुमति भी हट जाती है",
        ],
      },
    },
  },

  // ───────────────────────────────────────────────────────────────── Telugu ──
  // See the NOT REVIEWED BY A LAWYER note at the top of this file.
  te: {
    lastUpdated: '26 సెప్టెంబర్ 2026',
    pageTitle: 'గోప్యతా విధానం',
    consentTitle: 'గోప్యతా విధానం & వినియోగ నిబంధనలు',
    lastUpdatedLabel: 'చివరిగా నవీకరించినది',
    promiseLead: 'Famora ఒక సరళమైన వాగ్దానంపై నిర్మించబడింది:',
    promiseStrong: 'మీ డేటా మీది, మీ కుటుంబానిది — ఇంకెవరిదీ కాదు.',
    promiseTail: 'మీ కుటుంబాన్ని సురక్షితంగా, అనుసంధానంగా ఉంచడానికి అవసరమైనది మాత్రమే మేము సేకరిస్తాము.',
    intro:
      'కుటుంబాలు అనుసంధానంగా ఉండటానికి, అత్యవసర సమయంలో ఒకరినొకరు వేగంగా ' +
      'చేరుకోవడానికి Famora సహాయపడుతుంది. మీరు చేరాలని ఎంచుకున్న కుటుంబ గ్రూప్‌తో ' +
      'మాత్రమే ఇది మీ లొకేషన్, సందేశాలు, కాల్‌లను షేర్ చేస్తుంది — అలాగే, "ఇంటర్నెట్ లేనప్పుడు SMS" ఆన్ చేస్తే, మీరే ఎంచుకున్న ఒక అదనపు నంబర్‌తో కూడా. ఏమి సేకరిస్తారు, ' +
      'ఎందుకు, ఎవరితో షేర్ చేస్తారు, ఎంతకాలం ఉంచుతారు అనేది ఈ పేజీలో ఖచ్చితంగా ' +
      'వివరించబడింది.',
    consentNote:
      'కొనసాగించడం ద్వారా మీరు ఈ విధానాన్ని చదివి అంగీకరించినట్లు, మరియు ఇతరుల ' +
      'తరఫున మీరు ఏర్పాటు చేసిన ఏ ఖాతా లొకేషన్‌నైనా షేర్ చేసే హక్కు మీకు ఉన్నట్లు ' +
      'ధృవీకరిస్తున్నారు.',
    contactPrompt: 'మీ గోప్యత గురించి ప్రశ్నలా?',
    contactPromptConsent: 'ప్రశ్నలా లేదా డేటా అభ్యర్థనా?',
    sections: {
      collect: {
        title: 'మేము సేకరించే సమాచారం',
        items: [
          'మొబైల్ నంబర్ — మీ ఖాతా సృష్టించడానికి, సైన్ ఇన్ చేయడానికి',
          'ప్రదర్శన పేరు, మీరు జోడిస్తే ప్రొఫైల్ ఫోటో',
          'లొకేషన్ షేరింగ్ ఆన్‌లో ఉన్నప్పుడు లొకేషన్',
'బ్యాటరీ స్థాయి, ఛార్జింగ్ స్థితి, కదులుతున్నప్పుడు వేగం — మీ లొకేషన్‌తో పాటు కుటుంబానికి కనిపిస్తాయి',
          'మీ కుటుంబ గ్రూప్‌లో మీరు పంపే సందేశాలు',
          "మీ కుటుంబ గ్రూప్ చాట్‌లో లేదా మరో సభ్యుడితో ప్రైవేట్ వన్-టు-వన్ థ్రెడ్‌లో, మీరు ఒక సందేశానికి జోడించాలని ఎంచుకునే ఫోటోలు, వీడియోలు, (మీ మైక్రోఫోన్‌తో రికార్డ్ చేయబడిన) వాయిస్ నోట్‌లు మరియు డాక్యుమెంట్‌లు",
          'మీరు పంపిన లేదా అందుకున్న SOS హెచ్చరికలు, ఆ సమయంలోని లొకేషన్‌తో సహా',
          'కాల్ రికార్డులు: ఎవరు ఎవరికి కాల్ చేశారు, సమయం, వ్యవధి, వాయిస్ లేదా వీడియో',
          'హెచ్చరికలు, కాల్‌లు మీ ఫోన్‌కు చేరడానికి పరికర నోటిఫికేషన్ టోకెన్',
          'కాల్‌లు, హెచ్చరికలు నమ్మకంగా అందించడానికి అవసరమైన ప్రాథమిక పరికర వివరాలు',
'మోషన్ సెన్సార్ రీడింగ్‌లు, "ఊపితే SOS" ఆన్‌లో ఉన్నప్పుడు మాత్రమే — అవి మీ ఫోన్‌లోనే పరిశీలించబడతాయి, ఎక్కడికీ పంపబడవు',
          '"ఇంటర్నెట్ లేనప్పుడు SMS" వాడితే, దాని కోసం మీరు ఇచ్చే అదనపు ఫోన్ నంబర్',
          'యాప్ పనిచేయడం ఆగిపోతే క్రాష్, డయాగ్నొస్టిక్ నివేదికలు — కింద చూడండి',
          "మీరు డ్రైవింగ్ ట్రిప్‌లను ఆన్ చేస్తే: ప్రతి డ్రైవ్ ప్రారంభ, ముగింపు సమయం, దూరం, సగటు మరియు గరిష్ఠ వేగం, అకస్మాత్తు బ్రేక్‌లు మరియు వేగవంతమైన ప్రారంభాల సంఖ్య — పై లొకేషన్ డేటా నుండే లెక్కిస్తారు, అదనపు సెన్సార్ లేదు",
          "మీరు సేవ్ చేసిన ప్రదేశాలు (పేరు మరియు స్థానం) మరియు అధిక వేగ హెచ్చరిక కోసం మీరు పెట్టిన పరిమితి — సేవ్ చేసిన ప్రదేశాలు మీకు మాత్రమే కనిపిస్తాయి",
          "మీ ఫోన్‌లో \"ఫోన్ పోయింది\" వాడితే: అది పోయినట్లు గుర్తించబడిన వాస్తవం, ఎవరు గుర్తించారు, వారు టైప్ చేసిన చిన్న సందేశం, మరియు పోయిన స్థితిలో ప్రతి కొన్ని సెకన్లకు ఫోన్ స్థానం",
          "మీ నెట్‌వర్క్ రకం (Wi-Fi లేదా మొబైల్ డేటా) మరియు సిగ్నల్ బలం, మీ కార్డ్‌పై మీ కుటుంబానికి చూపబడతాయి",
          "మీరు సేవ్ చేసిన ప్రదేశానికి (ఇల్లు, ఆఫీస్ వంటివి) చేరినప్పుడు లేదా అక్కడి నుండి బయలుదేరినప్పుడు: ప్రదేశం పేరు, చేరారా బయలుదేరారా, సమయం. ఇది మీ కుటుంబానికి తెలియజేయబడుతుంది, కానీ ఆ ప్రదేశం యొక్క ఖచ్చితమైన స్థానం ఎప్పుడూ కాదు",
          "మీరు \"నా SOSతో వాయిస్ క్లిప్\"ను ఆన్ చేస్తే: యాప్ నుండి SOS పంపిన తర్వాత మీ ఫోన్ రికార్డ్ చేసే 15 సెకన్ల వరకు ఆడియో, మరియు మీరు జోడించాలనుకుంటే కెమెరా నుండి ఒక ఫోటో",
          "మీరు \"సమీప సహాయం\"లో చేరితే: మీ సుమారు స్థానం (మీ దగ్గర SOS పంపేవారితో సరిపోల్చడానికి), సమీపంలోని వ్యక్తుల మ్యాప్‌లో అస్పష్టమైన, పేరులేని చుక్క, మరియు సహాయ అభ్యర్థనలకు మీ సమాధానాలు",
          "మీరు Profile → దొంగతన రక్షణలో తప్పు పాస్‌వర్డ్ హెచ్చరికను ఆన్ చేస్తే: మీ ఫోన్‌లో 10 నిమిషాల్లో 3 లేదా అంతకంటే ఎక్కువ తప్పు స్క్రీన్-లాక్ ప్రయత్నాలు జరిగిన విషయం, ఎన్ని ప్రయత్నాలు, ఆ సమయంలో దాని స్థానం; మరియు, మీరు ఫోటో ఆప్షన్‌ను కూడా ఆన్ చేస్తే మాత్రమే, దాని తర్వాత తీసిన ఒక ఫ్రంట్-కెమెరా ఫోటో",
        ],
      },
      use: {
        title: 'మేము దీన్ని ఎలా ఉపయోగిస్తాము',
        items: [
          'మీ లొకేషన్ మీ సొంత కుటుంబ గ్రూప్ సభ్యులకు మాత్రమే కనిపిస్తుంది',
          'గత 7 రోజుల్లో మీరు ఎక్కడెక్కడ ఉన్నారో కుటుంబ సభ్యులు మ్యాప్‌లోని టైమ్‌లైన్‌లో కూడా చూడగలరు',
          'సందేశాలు ఆ కుటుంబ గ్రూప్ సభ్యులకు మాత్రమే కనిపిస్తాయి',
          "మీ కుటుంబ గ్రూప్ చాట్‌లో ఒక సందేశానికి జోడించిన ఫోటో, వీడియో, వాయిస్ నోట్ లేదా డాక్యుమెంట్ ఆ సందేశం లాగానే ఆ గ్రూప్‌కు కనిపిస్తుంది; ప్రైవేట్ వన్-టు-వన్ సందేశానికి జోడించినది మీకు మరియు మరో వ్యక్తికి మాత్రమే కనిపిస్తుంది, మీ కుటుంబ గ్రూప్‌లోని మిగతా వారికి ఎప్పుడూ కాదు",
          'నోటిఫికేషన్ టోకెన్‌లు హెచ్చరికలు, సందేశాలు, కాల్‌లు అందించడానికే వాడతారు',
          'కాల్, వీడియో కంటెంట్‌ను మేము ఎప్పుడూ రికార్డ్ చేయము లేదా నిల్వ చేయము',
          'మేము మీ సందేశాలను చదవము, మీ డేటాను అమ్మము',
          'ప్రకటనలు లేదా ప్రొఫైలింగ్ కోసం మీ డేటాను మేము ఉపయోగించము',
          "అధిక వేగ హెచ్చరిక మరియు డ్రైవింగ్ ట్రిప్‌లు మీరు ఆన్ చేసే వరకు ఆఫ్‌లోనే ఉంటాయి. ఆన్ చేశాక మీ కుటుంబ గ్రూప్ మీ ట్రిప్‌లను చూడగలదు, మీరు ఎంచుకున్న పరిమితి దాటితే వారికి తెలియజేస్తారు, మీ ఫోన్‌లో కూడా హెచ్చరిక వస్తుంది",
          "తీవ్ర వాతావరణ హెచ్చరికలు మీకు మాత్రమే, మీరు సేవ్ చేసిన ప్రదేశాల గురించి వస్తాయి. ప్రతి ప్రదేశం యొక్క సుమారు ప్రాంతం మాత్రమే (సుమారు 11 కి.మీ వరకు గుండ్రం చేసినది) మా సర్వర్ నుండి OpenWeatherMap కు పంపబడుతుంది",
          "ప్రమాద గుర్తింపు మీరు ఆన్ చేసే వరకు ఆఫ్‌లోనే ఉంటుంది. అది ఏదీ తనంతట తాను పంపదు: ప్రమాదం గుర్తిస్తే 20 సెకన్ల కౌంట్‌డౌన్ మాత్రమే మొదలవుతుంది, మీరు రద్దు చేయకపోతేనే SOS వెళ్తుంది",
          "Profile → Safety లో \"ఫోన్ పోయింది అనుమతి\"ని మీరు ఆన్ చేసే వరకు అది ఆఫ్‌లోనే ఉంటుంది. ఆ తర్వాతే మీ కుటుంబాల్లో ఒకదాని అడ్మిన్ మీ ఫోన్‌ను పోయినట్లు గుర్తించగలరు. అప్పుడు ఫోన్ ప్రతి కొన్ని సెకన్లకు స్థానం తెలియజేస్తుంది, ప్రతి 2 నిమిషాలకు మోగుతుంది, లాక్ స్క్రీన్‌పై సందేశం చూపుతుంది, మరియు కుటుంబంలోని ప్రతి ఒక్కరూ అది పోయినట్లు గుర్తించబడిందని చూడగలరు. 12 గంటల తర్వాత లేదా దొరికినట్లు గుర్తించినప్పుడు ఆగుతుంది",
          "మీ ఫోన్ బ్యాటరీ ఛార్జ్ అవ్వనప్పుడు 15% లేదా 5%కి పడిపోయినప్పుడు, ఫోన్ సుమారు 45 నిమిషాలుగా ఏ అప్‌డేట్ పంపనప్పుడు (ఫోన్ ఆఫ్ లేదా నెట్‌వర్క్ లేదు), మరియు అది మళ్లీ రిపోర్ట్ చేసినప్పుడు మీ కుటుంబానికి తెలియజేయబడుతుంది. ఈ హెచ్చరికలలో బ్యాటరీ స్థాయి మరియు ఫోన్ ఎంతసేపు నిశ్శబ్దంగా ఉందో ఉంటుంది. Profile → గోప్యత లో లొకేషన్ షేరింగ్ ఆఫ్ చేస్తే ఇవి ఆగుతాయి. ఆఫ్‌లైన్ హెచ్చరికలు భారత సమయం రాత్రి 11 నుండి ఉదయం 6 వరకు ఆపబడతాయి",
          "SOSకి జోడించిన వాయిస్ క్లిప్ లేదా ఫోటో ఆ SOS పంపబడిన కుటుంబాలకు మాత్రమే వెళ్తుంది. అది ప్రైవేట్‌గా నిల్వ చేయబడుతుంది, సమీప సహాయకులకు ఎప్పుడూ చూపబడదు, 7 రోజుల తర్వాత తొలగించబడుతుంది",
          "\"సమీప సహాయం\" మీరు చేరే వరకు ఆఫ్‌లోనే ఉంటుంది. సహాయం చేయలేనంత దూరంలో ఉన్న కుటుంబానికి SOS చేరవచ్చు అనుకున్నప్పుడు, అత్యంత సమీపంలోని చేరిన వ్యక్తులను (మొదట 2 కి.మీ లోపు, తర్వాత 5 కి.మీ, తర్వాత 10 కి.మీ) పంపినవారి తరఫున సరైన అత్యవసర నంబర్‌కు ఫోన్ చేయమని అడుగుతారు. వారు సుమారు ప్రాంతం మరియు అవసరమైన సహాయ రకం మాత్రమే చూస్తారు, పేరు లేదా ఫోన్ నంబర్ కాదు; అంగీకరించే ఒక్కరికి మాత్రమే ఖచ్చితమైన స్థానం చూపబడుతుంది. ఎవరినీ ఆ ప్రదేశానికి వెళ్లమని అడగరు",
          "\"సమీప సహాయం\" కారణంగా, స్థానంతో మీరు SOS పంపినప్పుడు, ఆ SOS యొక్క సుమారు ప్రాంతం మరియు అవసరమైన సహాయ రకం దాని దగ్గర ఉన్న, చేరిన Famora వినియోగదారులకు పంపబడవచ్చు. వారికి మీ పేరు, ఫోన్ నంబర్, సందేశాలు, వాయిస్ క్లిప్ లేదా ఫోటో ఎప్పుడూ అందవు",
          "మీరు సేవ్ చేసిన ప్రదేశాలకు చేరడం/బయలుదేరడం నోటీసులు మీ కుటుంబ గ్రూప్‌కు వెళ్తాయి; ప్రదేశం యొక్క ఖచ్చితమైన స్థానం మీ వద్దే ఉంటుంది",
          "ఏ కుటుంబ సభ్యుడైనా మీ ఫోన్‌ను కనుగొనడంలో సహాయపడేందుకు దాన్ని బిగ్గరగా మోగించవచ్చు (\"Find My Phone\"); ఇది మీ కుటుంబానికి ఇప్పటికే తెలిసిన దానికంటే ఎక్కువగా మీ లొకేషన్‌ను తెలియజేయదు",
          "తప్పు పాస్‌వర్డ్ హెచ్చరిక మీరు Profile → దొంగతన రక్షణలో ఆన్ చేసే వరకు ఆఫ్‌లోనే ఉంటుంది. ఆన్ చేసిన తర్వాత, 10 నిమిషాల్లో 3 లేదా అంతకంటే ఎక్కువ తప్పు స్క్రీన్-లాక్ ప్రయత్నాలు — ఎన్ని ప్రయత్నాలు మరియు ఫోన్ యొక్క చివరిగా తెలిసిన స్థానంతో పాటు — మీ కుటుంబ గ్రూప్‌ల అడ్మిన్‌లకు మాత్రమే, 10 నిమిషాలకు ఒకసారి మాత్రమే తెలియజేయబడతాయి. తప్పు అన్‌లాక్ గురించి తెలుసుకోవడానికి మాత్రమే ఇది Android యొక్క డివైస్-అడ్మిన్ అనుమతిని ఉపయోగిస్తుంది; మీ ఫోన్‌ను లాక్ చేయడానికి, తుడిచివేయడానికి లేదా వేరే ఏ విధంగానూ నియంత్రించడానికి మేము దీన్ని ఎప్పుడూ ఉపయోగించము. మీరు ఫోటో ఆప్షన్‌ను కూడా ఆన్ చేస్తే, అలాంటి రిపోర్ట్ తర్వాత ఒక ఫ్రంట్-కెమెరా ఫోటో తీయబడుతుంది; దాన్ని మీరు మరియు ఆ అడ్మిన్‌లు మాత్రమే చూడగలరు",
        ],
      },
      calls: {
        title: 'వాయిస్ మరియు వీడియో కాల్‌లు',
        items: [
          'కాల్‌లు కుటుంబ సభ్యుల మధ్య ఇంటర్నెట్ ద్వారా జరుగుతాయి, ఫోన్ నెట్‌వర్క్ ద్వారా కాదు',
          'ఆడియో, వీడియోను మా కాలింగ్ ప్రొవైడర్ Agora మోసుకెళ్తుంది, అవి రికార్డ్ కావు',
          'కాల్ రికార్డులు మాత్రమే నిల్వ చేయబడతాయి — సంభాషణ ఎప్పటికీ కాదు',
          'కాల్ సమయంలో మైక్రోఫోన్ వాడతారు; కెమెరా వీడియో కాల్ సమయంలో మాత్రమే',
          'ఏ కుటుంబ సభ్యుడైనా కుటుంబం మొత్తానికి కాల్ చరిత్రను తొలగించవచ్చు',
        ],
      },
      sms: {
        title: 'ఇంటర్నెట్ లేనప్పుడు SMS',
        items: [
          'Profile → ఇంటర్నెట్ లేనప్పుడు SMS లో మీరు ఆన్ చేసే వరకు ఇది ఆఫ్‌లోనే ఉంటుంది',
          'మీ ఫోన్‌కు పదిహేను నిమిషాలుగా ఇంటర్నెట్ లేనప్పుడు, మీ చివరి లొకేషన్‌ను SMS ద్వారా పంపుతుంది, తద్వారా కుటుంబం ఊహాగానాలు చేయాల్సిన అవసరం ఉండదు',
          'ఆ సందేశంలో మీ పేరు, ఎంతసేపటి నుండి ఇంటర్నెట్ లేదు, ఒక మ్యాప్ లింక్ — ఇంకేమీ ఉండదు',
          'మీరు ఉన్న ప్రతి కుటుంబ అడ్మిన్‌లకు, మీరు చేర్చితే ఒక అదనపు నంబర్‌కు వెళ్తుంది. ఆ నంబర్ మీ ఎంపిక, అది మీ కుటుంబ గ్రూప్ బయటి వ్యక్తి కూడా కావచ్చు',
          'సందేశం మొబైల్ నెట్‌వర్క్ ద్వారా వెళ్తుంది, కాబట్టి మిగతా ఏ సందేశాన్ని నిర్వహించినట్టే మీ మొబైల్ ఆపరేటర్ దీన్ని నిర్వహిస్తారు',
          'ప్రతి హెచ్చరికకు మీ మొబైల్ ప్లాన్ ఛార్జ్ చేస్తుంది, ఒక్కసారి ఇంటర్నెట్ పోయినప్పుడు ఎనిమిదికి మించి పంపబడవు',
          'SMS పంపడానికి Android అనుమతి ఇవ్వాలి, దాన్ని ఎప్పుడైనా Android సెట్టింగ్‌లలో ఉపసంహరించుకోవచ్చు',
          'పంపవలసిన నంబర్లు మీ ఫోన్‌లోనే ఉంచబడతాయి, తద్వారా కనెక్షన్ లేకున్నా పనిచేస్తాయి; వాటిని మేము మరే అవసరానికీ వాడము',
        ],
      },
      onphone: {
        title: 'మీ ఫోన్‌లోనే ఉండేవి',
        items: [
          '"ఊపితే SOS" ఆన్‌లో ఉన్నప్పుడు మోషన్ సెన్సార్‌ను చదువుతుంది. ఆ రీడింగ్‌లు మీ ఫోన్‌లోనే పరిశీలించబడతాయి, ఎప్పుడూ అప్‌లోడ్ కావు — మీరు నిజంగా పంపే SOS మాత్రమే ఫోన్‌ను దాటి వెళ్తుంది',
          '"నకిలీ కాల్" నిజమైన కాల్ చేయదు, మీ కుటుంబానికి ఏమీ చెప్పదు. కాల్ చేసేవారి పేరు, నంబర్, సమయం — అన్నీ మీ ఫోన్‌లో మాత్రమే ఉంటాయి',
          'నకిలీ కాల్‌కు సమాధానం ఇచ్చాక వినిపించే గొంతు మీ ఫోన్ సొంత టెక్స్ట్-టు-స్పీచ్. మైక్రోఫోన్ వాడబడదు, ఏదీ రికార్డ్ కాదు',
          'ఇతర సభ్యులకు మీరు పెట్టే ముద్దుపేర్లు, మీ భాష ఎంపిక మీ కోసం మాత్రమే ఫోన్‌లో ఉంచబడతాయి',
          'ఈ విభాగంలోని అన్నీ యాప్‌ను అన్‌ఇన్‌స్టాల్ చేసినప్పుడు తొలగిపోతాయి',
          "ప్రమాద గుర్తింపు ఆన్‌లో ఉండి మీరు వేగంగా ప్రయాణిస్తున్నప్పుడు మాత్రమే మోషన్ సెన్సార్‌ను చదువుతుంది. రీడింగ్‌లు మీ ఫోన్‌లోనే పరిశీలించబడతాయి, ఎప్పుడూ అప్‌లోడ్ కావు",
        ],
      },
      crash: {
        title: 'క్రాష్ మరియు డయాగ్నొస్టిక్ నివేదికలు',
        items: [
          'యాప్ క్రాష్ అయినప్పుడు లేదా స్పందించడం ఆపినప్పుడు, లోపాన్ని కనుగొని సరిచేయడానికి Firebase Crashlytics కు నివేదిక పంపబడుతుంది',
          'నివేదికలో సాంకేతిక లోపం, మీ పరికర మోడల్, Android వెర్షన్, ఒక అనామక ఖాతా గుర్తింపు ఉంటాయి',
          'అందులో మీ లొకేషన్, మీ సందేశాలు, మీ పేరు లేదా మీ ఫోన్ నంబర్ ఉండవు',
          'మీరు ఈ విధానాన్ని అంగీకరించే వరకు ఏదీ సేకరించబడదు, నివేదికలు ప్రకటనలు లేదా ప్రొఫైలింగ్ కోసం ఎప్పుడూ వాడబడవు',
        ],
      },
      providers: {
        title: 'ఇంకా ఎవరు పాల్గొంటారు',
        items: [
          'Supabase — డేటాబేస్‌ను హోస్ట్ చేస్తుంది, సైన్-ఇన్‌ను నిర్వహిస్తుంది',
          'Google Firebase — పుష్ నోటిఫికేషన్‌లు అందిస్తుంది, Crashlytics ద్వారా క్రాష్ నివేదికలు అందుకుంటుంది',
          'Agora — లైవ్ కాల్ ఆడియో, వీడియోను మోసుకెళ్తుంది',
          'OpenWeatherMap — కుటుంబ కార్డులపై చూపే వాతావరణాన్ని అందిస్తుంది. మా సర్వర్ నుండి సుమారు ప్రాంతం (దాదాపు 11 కి.మీ.కు గుండ్రంగా చేసినది) మాత్రమే పంపబడుతుంది, మీ ఖచ్చితమైన స్థానం లేదా ఫోన్ చిరునామా కాదు',
          'మీరు పంపే మరే సందేశాన్ని మోసుకెళ్లినట్టే, "ఇంటర్నెట్ లేనప్పుడు SMS" హెచ్చరికలను మీ మొబైల్ ఆపరేటర్ మోసుకెళ్తారు',
          'ఈ ప్రొవైడర్లు సేవను నడపడానికి మాత్రమే డేటాను ప్రాసెస్ చేస్తారు, వారి సొంత అవసరాలకు ఎప్పుడూ కాదు',
          'మీ డేటా అమ్మబడదు. ఈ ప్రొవైడర్లు, మీ సొంత కుటుంబ గ్రూప్ కాకుండా, "ఇంటర్నెట్ లేనప్పుడు SMS" కోసం మీరే ఎంచుకున్న ఒక అదనపు నంబర్ మాత్రమే స్వీకర్త',
        ],
      },
      protect: {
        title: 'మేము దీన్ని ఎలా కాపాడతాము',
        items: [
          'డేటా SOC 2 అనుకూల Supabase మౌలిక సదుపాయాలపై ఉంచబడుతుంది',
          'Row Level Security ప్రతి టేబుల్‌ను చూడటానికి అర్హులైన వారికి మాత్రమే పరిమితం చేస్తుంది',
          'పాస్‌వర్డ్‌లు bcrypt తో హాష్ చేయబడతాయి — మేము వాటిని చూడలేము',
          'ప్రతి అభ్యర్థనకు ధృవీకరించబడిన సెషన్ అవసరం',
          'ఏ డేటానైనా ప్రాసెస్ చేసే ముందు Edge Functions అభ్యర్థించిన వారి గుర్తింపును ధృవీకరిస్తాయి',
          'ప్రతి కాల్ సర్వర్ జారీ చేసిన స్వల్పకాలిక టోకెన్‌లతో విడిగా అధికారం పొందుతుంది',
        ],
      },
      retention: {
        title: 'మేము దీన్ని ఎంతకాలం ఉంచుతాము',
        items: [
          'సందేశాలు 90 రోజుల తర్వాత స్వయంచాలకంగా తొలగించబడతాయి',
          'ఒక సందేశానికి జోడించిన ఫోటో, వీడియో, వాయిస్ నోట్ లేదా డాక్యుమెంట్ ఆ 90-రోజుల తొలగింపు జరిగినప్పుడు స్వయంచాలకంగా తీసివేయబడదు',
          'పరిష్కరించిన SOS హెచ్చరికలు 30 రోజుల తర్వాత స్వయంచాలకంగా తొలగించబడతాయి',
          'లొకేషన్ చరిత్ర 7 రోజుల తర్వాత స్వయంచాలకంగా తొలగించబడుతుంది',
          'ఉపయోగించని పరికర నోటిఫికేషన్ టోకెన్‌లు 60 రోజుల తర్వాత తీసివేయబడతాయి',
          'మీ ఖాతాను తొలగిస్తే ఈ రికార్డుల నుండి మీ డేటా తీసివేయబడుతుంది',
'మీ ఫోన్‌లో ఉంచిన సెట్టింగ్‌లు — నకిలీ కాల్ వివరాలు, "ఇంటర్నెట్ లేనప్పుడు SMS" నంబర్లు, ముద్దుపేర్లు — యాప్‌ను అన్‌ఇన్‌స్టాల్ చేసినప్పుడు పోతాయి',
          "డ్రైవింగ్ ట్రిప్‌లు 30 రోజుల తర్వాత ఆటోమేటిక్‌గా తొలగించబడతాయి, డ్రైవింగ్ ట్రిప్‌లను ఆఫ్ చేయగానే వెంటనే తొలగించబడతాయి",
          "ఫోన్ పోయింది రికార్డులు ఆ మోడ్ ముగియగానే, ఏ సందర్భంలోనైనా 12 గంటల తర్వాత తొలగించబడతాయి",
          "SOS వాయిస్ క్లిప్‌లు మరియు ఫోటోలు 7 రోజుల తర్వాత ఆటోమేటిక్‌గా తొలగించబడతాయి",
          "\"సమీప సహాయం\" అభ్యర్థనలు మరియు సమాధానాలు అవి చెందిన SOS పరిష్కరించిన 30 రోజుల తర్వాత దానితో పాటు తొలగించబడతాయి",
          "ప్రదేశానికి చేరడం/బయలుదేరడం నోటీసులు, బ్యాటరీ మరియు ఫోన్-ఆఫ్‌లైన్ హెచ్చరికలు మీరు ఖాతాను తొలగించే వరకు ఉంచబడతాయి, తర్వాత తొలగించబడతాయి",
          "తప్పు పాస్‌వర్డ్ రిపోర్ట్‌లు, వాటి ఫోటోతో సహా, 7 రోజుల తర్వాత స్వయంచాలకంగా తొలగించబడతాయి",
        ],
      },
      choices: {
        title: 'మీ ఎంపికలు',
        items: [
          'మీ డేటా మొత్తాన్ని చూడండి — అది మీ సొంత కుటుంబ గ్రూప్‌లో మీకు కనిపిస్తుంది',
          'లొకేషన్ షేరింగ్‌ను ఎప్పుడైనా ప్రొఫైల్ → గోప్యత లో ఆఫ్ చేయండి',
          'ఎప్పుడైనా కుటుంబ గ్రూప్ నుండి వైదొలగండి',
'ప్రొఫైల్ లో ఎప్పుడైనా "ఊపితే SOS" ఆఫ్ చేయండి',
          'ప్రొఫైల్ లో ఎప్పుడైనా "ఇంటర్నెట్ లేనప్పుడు SMS" ఆఫ్ చేసి, అదనపు నంబర్‌ను తీసివేయండి',
          'సందేశ, కాల్ చరిత్రను వాటి స్క్రీన్‌ల నుండి తొలగించండి',
          'మీ ఖాతాను, దాని డేటాను ప్రొఫైల్ → నా ఖాతా తొలగించు నుండి, లేదా యాప్ లేకుండా Famora వెబ్‌సైట్‌లోని "Delete Account" పేజీ నుండి తొలగించండి',
          'కెమెరా, మైక్రోఫోన్, లొకేషన్, SMS లేదా నోటిఫికేషన్ అనుమతిని Android సెట్టింగ్‌లలో ఉపసంహరించుకోండి',
          "Profile → డ్రైవింగ్ భద్రత లో ఎప్పుడైనా అధిక వేగ హెచ్చరిక, డ్రైవింగ్ ట్రిప్‌లు, ప్రమాద గుర్తింపు, మరియు Profile → Safety లో వాతావరణ హెచ్చరికలను ఆన్ లేదా ఆఫ్ చేయండి",
          "Profile → Safety లో ఎప్పుడైనా \"ఫోన్ పోయింది అనుమతి\"ని ఆన్ లేదా ఆఫ్ చేయండి",
          "Profile → Safety లో ఎప్పుడైనా \"నా SOSతో వాయిస్ క్లిప్\"ను ఆన్ లేదా ఆఫ్ చేయండి",
          "SOS పేజీ నుండి ఎప్పుడైనా \"సమీప సహాయం\"లో చేరండి లేదా వైదొలగండి, మీ చరిత్ర నుండి ఎంట్రీలను దాచండి",
          "Profile → ప్రదేశాలు లో ఎప్పుడైనా సేవ్ చేసిన ప్రదేశాన్ని తొలగించండి",
          "తప్పు పాస్‌వర్డ్ హెచ్చరికను మరియు దాని ఫోటో ఆప్షన్‌ను ఎప్పుడైనా Profile → దొంగతన రక్షణలో ఆన్ లేదా ఆఫ్ చేయండి, ఇది మీ ఫోన్ నుండి Famora యొక్క డివైస్-అడ్మిన్ అనుమతిని కూడా తీసివేస్తుంది",
        ],
      },
    },
  },

  // ──────────────────────────────────────────────────────────────── Kannada ──
  // See the NOT REVIEWED BY A LAWYER note at the top of this file.
  kn: {
    lastUpdated: '26 ಸೆಪ್ಟೆಂಬರ್ 2026',
    pageTitle: 'ಗೌಪ್ಯತಾ ನೀತಿ',
    consentTitle: 'ಗೌಪ್ಯತಾ ನೀತಿ ಮತ್ತು ಬಳಕೆಯ ನಿಯಮಗಳು',
    lastUpdatedLabel: 'ಕೊನೆಯ ಬಾರಿ ನವೀಕರಿಸಿದ್ದು',
    promiseLead: 'Famora ಒಂದು ಸರಳ ಭರವಸೆಯ ಮೇಲೆ ನಿರ್ಮಿತವಾಗಿದೆ:',
    promiseStrong: 'ನಿಮ್ಮ ಡೇಟಾ ನಿಮ್ಮದು ಮತ್ತು ನಿಮ್ಮ ಕುಟುಂಬದ್ದು — ಬೇರೆ ಯಾರದ್ದೂ ಅಲ್ಲ.',
    promiseTail: 'ನಿಮ್ಮ ಕುಟುಂಬವನ್ನು ಸುರಕ್ಷಿತವಾಗಿ ಮತ್ತು ಸಂಪರ್ಕದಲ್ಲಿಡಲು ಅಗತ್ಯವಿರುವುದನ್ನು ಮಾತ್ರ ನಾವು ಸಂಗ್ರಹಿಸುತ್ತೇವೆ.',
    intro:
      'ಕುಟುಂಬಗಳು ಸಂಪರ್ಕದಲ್ಲಿರಲು ಮತ್ತು ತುರ್ತು ಸಂದರ್ಭದಲ್ಲಿ ಪರಸ್ಪರ ಬೇಗ ' +
      'ತಲುಪಲು Famora ಸಹಾಯ ಮಾಡುತ್ತದೆ. ನೀವು ಸೇರಲು ಆಯ್ಕೆ ಮಾಡಿದ ಕುಟುಂಬ ಗುಂಪಿನೊಂದಿಗೆ ' +
      'ಮಾತ್ರ ಇದು ನಿಮ್ಮ ಸ್ಥಳ, ಸಂದೇಶಗಳು ಮತ್ತು ಕರೆಗಳನ್ನು ಹಂಚಿಕೊಳ್ಳುತ್ತದೆ — ಜೊತೆಗೆ, "ಇಂಟರ್ನೆಟ್ ಇಲ್ಲದಾಗ SMS" ಆನ್ ಮಾಡಿದರೆ, ನೀವೇ ಆಯ್ಕೆ ಮಾಡಿದ ಒಂದು ಹೆಚ್ಚುವರಿ ಸಂಖ್ಯೆಯೊಂದಿಗೂ. ಏನನ್ನು ' +
      'ಸಂಗ್ರಹಿಸಲಾಗುತ್ತದೆ, ಏಕೆ, ಯಾರೊಂದಿಗೆ ಹಂಚಿಕೊಳ್ಳಲಾಗುತ್ತದೆ ಮತ್ತು ಎಷ್ಟು ಕಾಲ ' +
      'ಇಡಲಾಗುತ್ತದೆ ಎಂಬುದನ್ನು ಈ ಪುಟ ನಿಖರವಾಗಿ ವಿವರಿಸುತ್ತದೆ.',
    consentNote:
      'ಮುಂದುವರಿಯುವ ಮೂಲಕ ನೀವು ಈ ನೀತಿಯನ್ನು ಓದಿ ಒಪ್ಪಿಕೊಂಡಿದ್ದೀರಿ ಎಂದೂ, ಬೇರೆಯವರ ' +
      'ಪರವಾಗಿ ನೀವು ರಚಿಸಿದ ಯಾವುದೇ ಖಾತೆಯ ಸ್ಥಳವನ್ನು ಹಂಚಿಕೊಳ್ಳುವ ಹಕ್ಕು ನಿಮಗಿದೆ ' +
      'ಎಂದೂ ದೃಢೀಕರಿಸುತ್ತೀರಿ.',
    contactPrompt: 'ನಿಮ್ಮ ಗೌಪ್ಯತೆಯ ಬಗ್ಗೆ ಪ್ರಶ್ನೆಗಳಿವೆಯೇ?',
    contactPromptConsent: 'ಪ್ರಶ್ನೆ ಅಥವಾ ಡೇಟಾ ವಿನಂತಿಯೇ?',
    sections: {
      collect: {
        title: 'ನಾವು ಸಂಗ್ರಹಿಸುವ ಮಾಹಿತಿ',
        items: [
          'ಮೊಬೈಲ್ ಸಂಖ್ಯೆ — ನಿಮ್ಮ ಖಾತೆ ರಚಿಸಲು ಮತ್ತು ಸೈನ್ ಇನ್ ಮಾಡಲು',
          'ಪ್ರದರ್ಶನ ಹೆಸರು ಮತ್ತು ನೀವು ಸೇರಿಸಿದರೆ ಪ್ರೊಫೈಲ್ ಫೋಟೋ',
          'ಸ್ಥಳ ಹಂಚಿಕೆ ಆನ್ ಆಗಿರುವಾಗ ಸ್ಥಳ',
'ಬ್ಯಾಟರಿ ಮಟ್ಟ, ಚಾರ್ಜಿಂಗ್ ಸ್ಥಿತಿ ಮತ್ತು ಚಲಿಸುವಾಗ ವೇಗ — ನಿಮ್ಮ ಸ್ಥಳದ ಜೊತೆಗೆ ಕುಟುಂಬಕ್ಕೆ ತೋರಿಸಲಾಗುತ್ತದೆ',
          'ನಿಮ್ಮ ಕುಟುಂಬ ಗುಂಪಿನಲ್ಲಿ ನೀವು ಕಳುಹಿಸುವ ಸಂದೇಶಗಳು',
          "ನಿಮ್ಮ ಕುಟುಂಬ ಗುಂಪಿನ ಚಾಟ್‌ನಲ್ಲಿ ಅಥವಾ ಇನ್ನೊಬ್ಬ ಸದಸ್ಯರೊಂದಿಗಿನ ಖಾಸಗಿ ಒಂದರಿಂದ-ಒಂದು ಥ್ರೆಡ್‌ನಲ್ಲಿ, ನೀವು ಒಂದು ಸಂದೇಶಕ್ಕೆ ಸೇರಿಸಲು ಆಯ್ಕೆಮಾಡುವ ಫೋಟೋಗಳು, ವೀಡಿಯೊಗಳು, (ನಿಮ್ಮ ಮೈಕ್ರೊಫೋನ್‌ನಿಂದ ರೆಕಾರ್ಡ್ ಮಾಡಿದ) ಧ್ವನಿ ಟಿಪ್ಪಣಿಗಳು ಮತ್ತು ಡಾಕ್ಯುಮೆಂಟ್‌ಗಳು",
          'ನೀವು ಕಳುಹಿಸಿದ ಅಥವಾ ಸ್ವೀಕರಿಸಿದ SOS ಎಚ್ಚರಿಕೆಗಳು, ಆ ಕ್ಷಣದ ಸ್ಥಳ ಸೇರಿದಂತೆ',
          'ಕರೆ ದಾಖಲೆಗಳು: ಯಾರು ಯಾರಿಗೆ ಕರೆ ಮಾಡಿದರು, ಸಮಯ, ಅವಧಿ ಮತ್ತು ಧ್ವನಿಯೋ ವೀಡಿಯೊವೋ',
          'ಎಚ್ಚರಿಕೆಗಳು ಮತ್ತು ಕರೆಗಳು ನಿಮ್ಮ ಫೋನ್ ತಲುಪಲು ಸಾಧನ ಅಧಿಸೂಚನೆ ಟೋಕನ್',
          'ಕರೆಗಳು ಮತ್ತು ಎಚ್ಚರಿಕೆಗಳನ್ನು ವಿಶ್ವಾಸಾರ್ಹವಾಗಿ ತಲುಪಿಸಲು ಬೇಕಾದ ಮೂಲಭೂತ ಸಾಧನ ವಿವರಗಳು',
'ಚಲನೆ ಸಂವೇದಕದ ಓದುವಿಕೆಗಳು, "ಅಲುಗಾಡಿಸಿದರೆ SOS" ಆನ್ ಇರುವಾಗ ಮಾತ್ರ — ಅವು ನಿಮ್ಮ ಫೋನಿನಲ್ಲೇ ಪರಿಶೀಲಿಸಲ್ಪಡುತ್ತವೆ, ಎಲ್ಲಿಗೂ ಕಳುಹಿಸಲ್ಪಡುವುದಿಲ್ಲ',
          '"ಇಂಟರ್ನೆಟ್ ಇಲ್ಲದಾಗ SMS" ಬಳಸಿದರೆ, ಅದಕ್ಕಾಗಿ ನೀವು ನಮೂದಿಸುವ ಹೆಚ್ಚುವರಿ ಫೋನ್ ಸಂಖ್ಯೆ',
          'ಅಪ್ಲಿಕೇಶನ್ ಕೆಲಸ ಮಾಡುವುದನ್ನು ನಿಲ್ಲಿಸಿದರೆ ಕ್ರ್ಯಾಶ್ ಮತ್ತು ರೋಗನಿರ್ಣಯ ವರದಿಗಳು — ಕೆಳಗೆ ನೋಡಿ',
          "ನೀವು ಡ್ರೈವಿಂಗ್ ಟ್ರಿಪ್‌ಗಳನ್ನು ಆನ್ ಮಾಡಿದರೆ: ಪ್ರತಿ ಡ್ರೈವ್‌ನ ಆರಂಭ ಮತ್ತು ಅಂತ್ಯ ಸಮಯ, ದೂರ, ಸರಾಸರಿ ಮತ್ತು ಗರಿಷ್ಠ ವೇಗ, ಹಠಾತ್ ಬ್ರೇಕ್‌ಗಳು ಮತ್ತು ವೇಗದ ಆರಂಭಗಳ ಸಂಖ್ಯೆ — ಮೇಲಿನ ಸ್ಥಳ ಡೇಟಾದಿಂದಲೇ ಲೆಕ್ಕಹಾಕಲಾಗುತ್ತದೆ, ಹೆಚ್ಚುವರಿ ಸೆನ್ಸರ್ ಇಲ್ಲ",
          "ನೀವು ಉಳಿಸಿದ ಸ್ಥಳಗಳು (ಹೆಸರು ಮತ್ತು ಸ್ಥಾನ) ಮತ್ತು ಅತಿ ವೇಗ ಎಚ್ಚರಿಕೆಗೆ ನೀವು ಹೊಂದಿಸಿದ ಮಿತಿ — ಉಳಿಸಿದ ಸ್ಥಳಗಳು ನಿಮಗೆ ಮಾತ್ರ ಕಾಣುತ್ತವೆ",
          "ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ \"ಫೋನ್ ಕಳೆದುಹೋಗಿದೆ\" ಬಳಸಿದರೆ: ಅದು ಕಳೆದುಹೋಗಿದೆ ಎಂದು ಗುರುತಿಸಲಾದ ಸಂಗತಿ, ಯಾರು ಗುರುತಿಸಿದರು, ಅವರು ಟೈಪ್ ಮಾಡಿದ ಚಿಕ್ಕ ಸಂದೇಶ, ಮತ್ತು ಕಳೆದುಹೋದ ಸ್ಥಿತಿಯಲ್ಲಿ ಪ್ರತಿ ಕೆಲವು ಸೆಕೆಂಡಿಗೆ ಫೋನ್‌ನ ಸ್ಥಾನ",
          "ನಿಮ್ಮ ನೆಟ್‌ವರ್ಕ್ ಪ್ರಕಾರ (Wi-Fi ಅಥವಾ ಮೊಬೈಲ್ ಡೇಟಾ) ಮತ್ತು ಸಿಗ್ನಲ್ ಬಲ, ನಿಮ್ಮ ಕಾರ್ಡ್‌ನಲ್ಲಿ ನಿಮ್ಮ ಕುಟುಂಬಕ್ಕೆ ತೋರಿಸಲಾಗುತ್ತದೆ",
          "ನೀವು ಉಳಿಸಿದ ಸ್ಥಳಕ್ಕೆ (ಮನೆ, ಕಚೇರಿ ಮುಂತಾದವು) ತಲುಪಿದಾಗ ಅಥವಾ ಅಲ್ಲಿಂದ ಹೊರಟಾಗ: ಸ್ಥಳದ ಹೆಸರು, ತಲುಪಿದಿರೋ ಹೊರಟಿರೋ, ಮತ್ತು ಸಮಯ. ಇದನ್ನು ನಿಮ್ಮ ಕುಟುಂಬಕ್ಕೆ ತಿಳಿಸಲಾಗುತ್ತದೆ, ಆದರೆ ಆ ಸ್ಥಳದ ನಿಖರ ಸ್ಥಾನವನ್ನು ಎಂದಿಗೂ ಅಲ್ಲ",
          "ನೀವು \"ನನ್ನ SOS ಜೊತೆ ಧ್ವನಿ ಕ್ಲಿಪ್\" ಆನ್ ಮಾಡಿದರೆ: ಆ್ಯಪ್‌ನಿಂದ SOS ಕಳುಹಿಸಿದ ನಂತರ ನಿಮ್ಮ ಫೋನ್ ರೆಕಾರ್ಡ್ ಮಾಡುವ 15 ಸೆಕೆಂಡ್‌ವರೆಗಿನ ಆಡಿಯೋ, ಮತ್ತು ನೀವು ಸೇರಿಸಲು ಬಯಸಿದರೆ ಕ್ಯಾಮೆರಾದಿಂದ ಒಂದು ಫೋಟೋ",
          "ನೀವು \"ಹತ್ತಿರದ ಸಹಾಯ\"ದಲ್ಲಿ ಸೇರಿದರೆ: ನಿಮ್ಮ ಅಂದಾಜು ಸ್ಥಾನ (ನಿಮ್ಮ ಹತ್ತಿರ SOS ಕಳುಹಿಸುವವರೊಂದಿಗೆ ಹೊಂದಿಸಲು), ಹತ್ತಿರದ ಜನರ ನಕ್ಷೆಯಲ್ಲಿ ಮಸುಕಾದ, ಹೆಸರಿಲ್ಲದ ಚುಕ್ಕೆ, ಮತ್ತು ಸಹಾಯ ವಿನಂತಿಗಳಿಗೆ ನಿಮ್ಮ ಉತ್ತರಗಳು",
          "ನೀವು Profile → ಕಳ್ಳತನ ರಕ್ಷಣೆ ಯಲ್ಲಿ ತಪ್ಪು ಪಾಸ್‌ವರ್ಡ್ ಎಚ್ಚರಿಕೆಯನ್ನು ಆನ್ ಮಾಡಿದರೆ: ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ 10 ನಿಮಿಷಗಳ ಒಳಗೆ 3 ಅಥವಾ ಹೆಚ್ಚು ತಪ್ಪು ಸ್ಕ್ರೀನ್-ಲಾಕ್ ಪ್ರಯತ್ನಗಳು ನಡೆದ ಸಂಗತಿ, ಎಷ್ಟು ಪ್ರಯತ್ನಗಳು, ಆ ಕ್ಷಣದಲ್ಲಿ ಅದರ ಸ್ಥಾನ; ಮತ್ತು, ನೀವು ಫೋಟೋ ಆಯ್ಕೆಯನ್ನು ಸಹ ಆನ್ ಮಾಡಿದರೆ ಮಾತ್ರ, ಅದರ ನಂತರ ತೆಗೆದ ಒಂದು ಮುಂಭಾಗದ ಕ್ಯಾಮೆರಾ ಫೋಟೋ",
        ],
      },
      use: {
        title: 'ನಾವು ಇದನ್ನು ಹೇಗೆ ಬಳಸುತ್ತೇವೆ',
        items: [
          'ನಿಮ್ಮ ಸ್ಥಳ ನಿಮ್ಮ ಸ್ವಂತ ಕುಟುಂಬ ಗುಂಪಿನ ಸದಸ್ಯರಿಗೆ ಮಾತ್ರ ಕಾಣಿಸುತ್ತದೆ',
          'ಕಳೆದ 7 ದಿನಗಳಲ್ಲಿ ನೀವು ಎಲ್ಲೆಲ್ಲಿ ಇದ್ದಿರಿ ಎಂಬುದನ್ನು ಕುಟುಂಬ ಸದಸ್ಯರು ನಕ್ಷೆಯ ಟೈಮ್‌ಲೈನ್‌ನಲ್ಲಿ ಸಹ ನೋಡಬಹುದು',
          'ಸಂದೇಶಗಳು ಆ ಕುಟುಂಬ ಗುಂಪಿನ ಸದಸ್ಯರಿಗೆ ಮಾತ್ರ ಕಾಣಿಸುತ್ತವೆ',
          "ನಿಮ್ಮ ಕುಟುಂಬ ಗುಂಪಿನ ಚಾಟ್‌ನಲ್ಲಿ ಒಂದು ಸಂದೇಶಕ್ಕೆ ಜೋಡಿಸಿದ ಫೋಟೋ, ವೀಡಿಯೊ, ಧ್ವನಿ ಟಿಪ್ಪಣಿ ಅಥವಾ ಡಾಕ್ಯುಮೆಂಟ್ ಆ ಸಂದೇಶದಂತೆಯೇ ಆ ಗುಂಪಿಗೆ ಕಾಣುತ್ತದೆ; ಖಾಸಗಿ ಒಂದರಿಂದ-ಒಂದು ಸಂದೇಶಕ್ಕೆ ಜೋಡಿಸಿದದ್ದು ನಿಮಗೆ ಮತ್ತು ಇನ್ನೊಬ್ಬ ವ್ಯಕ್ತಿಗೆ ಮಾತ್ರ ಕಾಣುತ್ತದೆ, ನಿಮ್ಮ ಕುಟುಂಬ ಗುಂಪಿನ ಇತರರಿಗೆ ಎಂದಿಗೂ ಅಲ್ಲ",
          'ಅಧಿಸೂಚನೆ ಟೋಕನ್‌ಗಳನ್ನು ಎಚ್ಚರಿಕೆ, ಸಂದೇಶ ಮತ್ತು ಕರೆ ತಲುಪಿಸಲು ಮಾತ್ರ ಬಳಸಲಾಗುತ್ತದೆ',
          'ಕರೆ ಮತ್ತು ವೀಡಿಯೊ ವಿಷಯವನ್ನು ನಾವು ಎಂದಿಗೂ ರೆಕಾರ್ಡ್ ಅಥವಾ ಸಂಗ್ರಹಿಸುವುದಿಲ್ಲ',
          'ನಾವು ನಿಮ್ಮ ಸಂದೇಶಗಳನ್ನು ಓದುವುದಿಲ್ಲ, ನಿಮ್ಮ ಡೇಟಾವನ್ನು ಮಾರುವುದಿಲ್ಲ',
          'ಜಾಹೀರಾತು ಅಥವಾ ಪ್ರೊಫೈಲಿಂಗ್‌ಗೆ ನಿಮ್ಮ ಡೇಟಾವನ್ನು ನಾವು ಬಳಸುವುದಿಲ್ಲ',
          "ಅತಿ ವೇಗ ಎಚ್ಚರಿಕೆ ಮತ್ತು ಡ್ರೈವಿಂಗ್ ಟ್ರಿಪ್‌ಗಳು ನೀವು ಆನ್ ಮಾಡುವವರೆಗೆ ಆಫ್ ಆಗಿರುತ್ತವೆ. ಆನ್ ಮಾಡಿದ ಮೇಲೆ ನಿಮ್ಮ ಕುಟುಂಬ ಗುಂಪು ನಿಮ್ಮ ಟ್ರಿಪ್‌ಗಳನ್ನು ನೋಡಬಹುದು, ನೀವು ಆರಿಸಿದ ಮಿತಿ ಮೀರಿದರೆ ಅವರಿಗೆ ತಿಳಿಸಲಾಗುತ್ತದೆ, ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲೂ ಎಚ್ಚರಿಕೆ ಬರುತ್ತದೆ",
          "ತೀವ್ರ ಹವಾಮಾನ ಎಚ್ಚರಿಕೆಗಳು ನಿಮಗೆ ಮಾತ್ರ, ನೀವು ಉಳಿಸಿದ ಸ್ಥಳಗಳ ಬಗ್ಗೆ ಬರುತ್ತವೆ. ಪ್ರತಿ ಸ್ಥಳದ ಅಂದಾಜು ಪ್ರದೇಶ ಮಾತ್ರ (ಸುಮಾರು 11 ಕಿ.ಮೀ ವರೆಗೆ ದುಂಡಗಾಗಿಸಿದ್ದು) ನಮ್ಮ ಸರ್ವರ್‌ನಿಂದ OpenWeatherMap ಗೆ ಕಳುಹಿಸಲಾಗುತ್ತದೆ",
          "ಅಪಘಾತ ಪತ್ತೆ ನೀವು ಆನ್ ಮಾಡುವವರೆಗೆ ಆಫ್ ಆಗಿರುತ್ತದೆ. ಅದು ತಾನಾಗಿ ಏನನ್ನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ: ಅಪಘಾತ ಗುರುತಿಸಿದರೆ 20 ಸೆಕೆಂಡ್ ಕೌಂಟ್‌ಡೌನ್ ಮಾತ್ರ ಪ್ರಾರಂಭವಾಗುತ್ತದೆ, ನೀವು ರದ್ದುಮಾಡದಿದ್ದರೆ ಮಾತ್ರ SOS ಹೋಗುತ್ತದೆ",
          "Profile → Safety ನಲ್ಲಿ \"ಫೋನ್ ಕಳೆದುಹೋಗಿದೆ ಅನುಮತಿ\" ಅನ್ನು ನೀವು ಆನ್ ಮಾಡುವವರೆಗೆ ಅದು ಆಫ್ ಆಗಿರುತ್ತದೆ. ಆಗ ಮಾತ್ರ ನಿಮ್ಮ ಕುಟುಂಬಗಳಲ್ಲಿ ಒಂದರ ಅಡ್ಮಿನ್ ನಿಮ್ಮ ಫೋನ್ ಅನ್ನು ಕಳೆದುಹೋಗಿದೆ ಎಂದು ಗುರುತಿಸಬಹುದು. ಆಗ ಫೋನ್ ಪ್ರತಿ ಕೆಲವು ಸೆಕೆಂಡಿಗೆ ಸ್ಥಾನ ತಿಳಿಸುತ್ತದೆ, ಪ್ರತಿ 2 ನಿಮಿಷಕ್ಕೆ ರಿಂಗ್ ಆಗುತ್ತದೆ, ಲಾಕ್ ಸ್ಕ್ರೀನ್‌ನಲ್ಲಿ ಸಂದೇಶ ತೋರಿಸುತ್ತದೆ, ಮತ್ತು ಕುಟುಂಬದ ಪ್ರತಿಯೊಬ್ಬರೂ ಅದನ್ನು ಕಳೆದುಹೋಗಿದೆ ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ ಎಂಬುದನ್ನು ನೋಡಬಹುದು. 12 ಗಂಟೆಗಳ ನಂತರ ಅಥವಾ ಸಿಕ್ಕಿದೆ ಎಂದು ಗುರುತಿಸಿದಾಗ ನಿಲ್ಲುತ್ತದೆ",
          "ನಿಮ್ಮ ಫೋನ್ ಬ್ಯಾಟರಿ ಚಾರ್ಜ್ ಆಗದಿರುವಾಗ 15% ಅಥವಾ 5%ಕ್ಕೆ ಇಳಿದಾಗ, ಫೋನ್ ಸುಮಾರು 45 ನಿಮಿಷಗಳಿಂದ ಯಾವುದೇ ಅಪ್‌ಡೇಟ್ ಕಳುಹಿಸದಿದ್ದಾಗ (ಫೋನ್ ಆಫ್ ಅಥವಾ ನೆಟ್‌ವರ್ಕ್ ಇಲ್ಲ), ಮತ್ತು ಅದು ಮತ್ತೆ ವರದಿ ಮಾಡಿದಾಗ ನಿಮ್ಮ ಕುಟುಂಬಕ್ಕೆ ತಿಳಿಸಲಾಗುತ್ತದೆ. ಈ ಎಚ್ಚರಿಕೆಗಳಲ್ಲಿ ಬ್ಯಾಟರಿ ಮಟ್ಟ ಮತ್ತು ಫೋನ್ ಎಷ್ಟು ಹೊತ್ತು ಮೌನವಾಗಿತ್ತು ಎಂಬುದು ಇರುತ್ತದೆ. Profile → ಗೌಪ್ಯತೆ ನಲ್ಲಿ ಸ್ಥಳ ಹಂಚಿಕೆ ಆಫ್ ಮಾಡಿದರೆ ಇವು ನಿಲ್ಲುತ್ತವೆ. ಆಫ್‌ಲೈನ್ ಎಚ್ಚರಿಕೆಗಳು ಭಾರತೀಯ ಸಮಯ ರಾತ್ರಿ 11 ರಿಂದ ಬೆಳಿಗ್ಗೆ 6 ರವರೆಗೆ ತಡೆಹಿಡಿಯಲ್ಪಡುತ್ತವೆ",
          "SOS ಜೊತೆ ಜೋಡಿಸಿದ ಧ್ವನಿ ಕ್ಲಿಪ್ ಅಥವಾ ಫೋಟೋ ಆ SOS ಕಳುಹಿಸಿದ ಕುಟುಂಬಗಳಿಗೆ ಮಾತ್ರ ಹೋಗುತ್ತದೆ. ಅದನ್ನು ಖಾಸಗಿಯಾಗಿ ಸಂಗ್ರಹಿಸಲಾಗುತ್ತದೆ, ಹತ್ತಿರದ ಸಹಾಯಕರಿಗೆ ಎಂದಿಗೂ ತೋರಿಸಲಾಗುವುದಿಲ್ಲ, ಮತ್ತು 7 ದಿನಗಳ ನಂತರ ಅಳಿಸಲಾಗುತ್ತದೆ",
          "\"ಹತ್ತಿರದ ಸಹಾಯ\" ನೀವು ಸೇರುವವರೆಗೆ ಆಫ್ ಆಗಿರುತ್ತದೆ. ಸಹಾಯ ಮಾಡಲು ತುಂಬಾ ದೂರದಲ್ಲಿರುವ ಕುಟುಂಬಕ್ಕೆ SOS ತಲುಪಬಹುದಾದಾಗ, ಅತ್ಯಂತ ಹತ್ತಿರದ ಸೇರಿದವರನ್ನು (ಮೊದಲು 2 ಕಿ.ಮೀ ಒಳಗೆ, ನಂತರ 5 ಕಿ.ಮೀ, ನಂತರ 10 ಕಿ.ಮೀ) ಕಳುಹಿಸಿದವರ ಪರವಾಗಿ ಸರಿಯಾದ ತುರ್ತು ಸಂಖ್ಯೆಗೆ ಕರೆ ಮಾಡಲು ಕೇಳಲಾಗುತ್ತದೆ. ಅವರು ಅಂದಾಜು ಪ್ರದೇಶ ಮತ್ತು ಬೇಕಾದ ಸಹಾಯದ ಪ್ರಕಾರವನ್ನು ಮಾತ್ರ ನೋಡುತ್ತಾರೆ, ಹೆಸರು ಅಥವಾ ಫೋನ್ ಸಂಖ್ಯೆಯಲ್ಲ; ಒಪ್ಪಿಕೊಳ್ಳುವ ಒಬ್ಬರಿಗೆ ಮಾತ್ರ ನಿಖರ ಸ್ಥಾನ ತೋರಿಸಲಾಗುತ್ತದೆ. ಯಾರನ್ನೂ ಸ್ಥಳಕ್ಕೆ ಪ್ರಯಾಣಿಸಲು ಕೇಳುವುದಿಲ್ಲ",
          "\"ಹತ್ತಿರದ ಸಹಾಯ\"ದ ಕಾರಣ, ಸ್ಥಾನದೊಂದಿಗೆ ನೀವು SOS ಕಳುಹಿಸಿದಾಗ, ಆ SOS ನ ಅಂದಾಜು ಪ್ರದೇಶ ಮತ್ತು ಬೇಕಾದ ಸಹಾಯದ ಪ್ರಕಾರ ಅದರ ಹತ್ತಿರವಿರುವ, ಸೇರಿದ Famora ಬಳಕೆದಾರರಿಗೆ ಕಳುಹಿಸಲ್ಪಡಬಹುದು. ಅವರಿಗೆ ನಿಮ್ಮ ಹೆಸರು, ಫೋನ್ ಸಂಖ್ಯೆ, ಸಂದೇಶಗಳು, ಧ್ವನಿ ಕ್ಲಿಪ್ ಅಥವಾ ಫೋಟೋ ಎಂದಿಗೂ ಸಿಗುವುದಿಲ್ಲ",
          "ನೀವು ಉಳಿಸಿದ ಸ್ಥಳಗಳಿಗೆ ತಲುಪುವ/ಹೊರಡುವ ಸೂಚನೆಗಳು ನಿಮ್ಮ ಕುಟುಂಬ ಗುಂಪಿಗೆ ಹೋಗುತ್ತವೆ; ಸ್ಥಳದ ನಿಖರ ಸ್ಥಾನ ನಿಮ್ಮ ಬಳಿಯೇ ಇರುತ್ತದೆ",
          "ಯಾವುದೇ ಕುಟುಂಬ ಸದಸ್ಯರು ನಿಮ್ಮ ಫೋನ್ ಅನ್ನು ಹುಡುಕಲು ಸಹಾಯ ಮಾಡಲು ಅದನ್ನು ಜೋರಾಗಿ ರಿಂಗ್ ಮಾಡಿಸಬಹುದು (\"Find My Phone\"); ಇದು ನಿಮ್ಮ ಕುಟುಂಬಕ್ಕೆ ಈಗಾಗಲೇ ಗೊತ್ತಿರುವುದನ್ನು ಮೀರಿ ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಬಹಿರಂಗಪಡಿಸುವುದಿಲ್ಲ",
          "ತಪ್ಪು ಪಾಸ್‌ವರ್ಡ್ ಎಚ್ಚರಿಕೆ ನೀವು Profile → ಕಳ್ಳತನ ರಕ್ಷಣೆ ಯಲ್ಲಿ ಆನ್ ಮಾಡುವವರೆಗೆ ಆಫ್ ಆಗಿರುತ್ತದೆ. ಆನ್ ಮಾಡಿದ ನಂತರ, 10 ನಿಮಿಷಗಳ ಒಳಗೆ 3 ಅಥವಾ ಹೆಚ್ಚು ತಪ್ಪು ಸ್ಕ್ರೀನ್-ಲಾಕ್ ಪ್ರಯತ್ನಗಳು — ಎಷ್ಟು ಪ್ರಯತ್ನಗಳು ಮತ್ತು ಫೋನ್‌ನ ಕೊನೆಯ ತಿಳಿದಿರುವ ಸ್ಥಾನದೊಂದಿಗೆ — ನಿಮ್ಮ ಕುಟುಂಬ ಗುಂಪುಗಳ ಅಡ್ಮಿನ್‌ಗಳಿಗೆ ಮಾತ್ರ, 10 ನಿಮಿಷಕ್ಕೆ ಒಮ್ಮೆ ಮಾತ್ರ ವರದಿಯಾಗುತ್ತವೆ. ತಪ್ಪು ಅನ್‌ಲಾಕ್ ಬಗ್ಗೆ ತಿಳಿಯಲು ಮಾತ್ರ ಇದು Android ನ ಡಿವೈಸ್-ಅಡ್ಮಿನ್ ಅನುಮತಿಯನ್ನು ಬಳಸುತ್ತದೆ; ನಿಮ್ಮ ಫೋನ್ ಅನ್ನು ಲಾಕ್ ಮಾಡಲು, ಅಳಿಸಲು ಅಥವಾ ಬೇರೆ ಯಾವುದೇ ರೀತಿಯಲ್ಲಿ ನಿಯಂತ್ರಿಸಲು ನಾವು ಇದನ್ನು ಎಂದಿಗೂ ಬಳಸುವುದಿಲ್ಲ. ನೀವು ಫೋಟೋ ಆಯ್ಕೆಯನ್ನು ಸಹ ಆನ್ ಮಾಡಿದರೆ, ಅಂತಹ ವರದಿಯ ನಂತರ ಒಂದು ಮುಂಭಾಗದ ಕ್ಯಾಮೆರಾ ಫೋಟೋ ತೆಗೆಯಲಾಗುತ್ತದೆ; ಅದನ್ನು ನೀವು ಮತ್ತು ಆ ಅಡ್ಮಿನ್‌ಗಳು ಮಾತ್ರ ನೋಡಬಹುದು",
        ],
      },
      calls: {
        title: 'ಧ್ವನಿ ಮತ್ತು ವೀಡಿಯೊ ಕರೆಗಳು',
        items: [
          'ಕರೆಗಳು ಕುಟುಂಬ ಸದಸ್ಯರ ನಡುವೆ ಇಂಟರ್ನೆಟ್ ಮೂಲಕ ನಡೆಯುತ್ತವೆ, ಫೋನ್ ನೆಟ್‌ವರ್ಕ್ ಮೂಲಕ ಅಲ್ಲ',
          'ಆಡಿಯೊ ಮತ್ತು ವೀಡಿಯೊವನ್ನು ನಮ್ಮ ಕರೆ ಪೂರೈಕೆದಾರ Agora ಸಾಗಿಸುತ್ತದೆ, ಅವು ರೆಕಾರ್ಡ್ ಆಗುವುದಿಲ್ಲ',
          'ಕರೆ ದಾಖಲೆಗಳನ್ನು ಮಾತ್ರ ಸಂಗ್ರಹಿಸಲಾಗುತ್ತದೆ — ಸಂಭಾಷಣೆಯನ್ನು ಎಂದಿಗೂ ಅಲ್ಲ',
          'ಕರೆಯ ಸಮಯದಲ್ಲಿ ಮೈಕ್ರೊಫೋನ್ ಬಳಸಲಾಗುತ್ತದೆ; ಕ್ಯಾಮೆರಾ ವೀಡಿಯೊ ಕರೆಯ ಸಮಯದಲ್ಲಿ ಮಾತ್ರ',
          'ಯಾವುದೇ ಕುಟುಂಬ ಸದಸ್ಯರು ಕುಟುಂಬಕ್ಕಾಗಿ ಕರೆ ಇತಿಹಾಸವನ್ನು ತೆಗೆದುಹಾಕಬಹುದು',
        ],
      },
      sms: {
        title: 'ಇಂಟರ್ನೆಟ್ ಇಲ್ಲದಾಗ SMS',
        items: [
          'Profile → ಇಂಟರ್ನೆಟ್ ಇಲ್ಲದಾಗ SMS ನಲ್ಲಿ ನೀವು ಆನ್ ಮಾಡುವವರೆಗೆ ಇದು ಆಫ್ ಆಗಿಯೇ ಇರುತ್ತದೆ',
          'ನಿಮ್ಮ ಫೋನಿಗೆ ಹದಿನೈದು ನಿಮಿಷಗಳಿಂದ ಇಂಟರ್ನೆಟ್ ಇಲ್ಲದಿದ್ದಾಗ, ನಿಮ್ಮ ಕೊನೆಯ ಸ್ಥಳವನ್ನು SMS ಮೂಲಕ ಕಳುಹಿಸುತ್ತದೆ, ಹಾಗಾಗಿ ಕುಟುಂಬ ಊಹಿಸುತ್ತಾ ಕೂರಬೇಕಾಗಿಲ್ಲ',
          'ಆ ಸಂದೇಶದಲ್ಲಿ ನಿಮ್ಮ ಹೆಸರು, ಎಷ್ಟು ಹೊತ್ತಿನಿಂದ ಇಂಟರ್ನೆಟ್ ಇಲ್ಲ, ಮತ್ತು ಒಂದು ನಕ್ಷೆ ಲಿಂಕ್ — ಬೇರೇನೂ ಇಲ್ಲ',
          'ನೀವು ಇರುವ ಪ್ರತಿ ಕುಟುಂಬದ ಅಡ್ಮಿನ್‌ಗಳಿಗೆ, ಮತ್ತು ನೀವು ಸೇರಿಸಿದರೆ ಒಂದು ಹೆಚ್ಚುವರಿ ಸಂಖ್ಯೆಗೆ ಹೋಗುತ್ತದೆ. ಆ ಸಂಖ್ಯೆ ನಿಮ್ಮ ಆಯ್ಕೆ, ಅದು ನಿಮ್ಮ ಕುಟುಂಬ ಗುಂಪಿನ ಹೊರಗಿನವರೂ ಆಗಿರಬಹುದು',
          'ಸಂದೇಶ ಮೊಬೈಲ್ ನೆಟ್‌ವರ್ಕ್ ಮೂಲಕ ಹೋಗುತ್ತದೆ, ಹಾಗಾಗಿ ಬೇರೆ ಯಾವುದೇ ಸಂದೇಶವನ್ನು ನಿರ್ವಹಿಸುವಂತೆಯೇ ನಿಮ್ಮ ಮೊಬೈಲ್ ಆಪರೇಟರ್ ಇದನ್ನು ನಿರ್ವಹಿಸುತ್ತಾರೆ',
          'ಪ್ರತಿ ಎಚ್ಚರಿಕೆಗೂ ನಿಮ್ಮ ಮೊಬೈಲ್ ಯೋಜನೆ ಶುಲ್ಕ ವಿಧಿಸುತ್ತದೆ, ಮತ್ತು ಒಮ್ಮೆ ಇಂಟರ್ನೆಟ್ ಹೋದಾಗ ಎಂಟಕ್ಕಿಂತ ಹೆಚ್ಚು ಕಳುಹಿಸಲ್ಪಡುವುದಿಲ್ಲ',
          'SMS ಕಳುಹಿಸಲು Android ಅನುಮತಿ ನೀಡಬೇಕು, ಮತ್ತು ಅದನ್ನು ಯಾವಾಗ ಬೇಕಾದರೂ Android ಸೆಟ್ಟಿಂಗ್‌ಗಳಲ್ಲಿ ಹಿಂಪಡೆಯಬಹುದು',
          'ಕಳುಹಿಸಬೇಕಾದ ಸಂಖ್ಯೆಗಳು ನಿಮ್ಮ ಫೋನಿನಲ್ಲೇ ಉಳಿಯುತ್ತವೆ, ಹಾಗಾಗಿ ಸಂಪರ್ಕವಿಲ್ಲದೆಯೂ ಕೆಲಸ ಮಾಡುತ್ತವೆ; ಅವನ್ನು ನಾವು ಬೇರೆ ಯಾವುದಕ್ಕೂ ಬಳಸುವುದಿಲ್ಲ',
        ],
      },
      onphone: {
        title: 'ನಿಮ್ಮ ಫೋನಿನಲ್ಲೇ ಉಳಿಯುವುದು',
        items: [
          '"ಅಲುಗಾಡಿಸಿದರೆ SOS" ಆನ್ ಇರುವಾಗ ಚಲನೆ ಸಂವೇದಕವನ್ನು ಓದುತ್ತದೆ. ಆ ಓದುವಿಕೆಗಳು ಫೋನಿನಲ್ಲೇ ಪರಿಶೀಲಿಸಲ್ಪಡುತ್ತವೆ, ಎಂದಿಗೂ ಅಪ್‌ಲೋಡ್ ಆಗುವುದಿಲ್ಲ — ನೀವು ನಿಜವಾಗಿ ಕಳುಹಿಸುವ SOS ಮಾತ್ರ ಫೋನ್ ದಾಟಿ ಹೋಗುತ್ತದೆ',
          '"ನಕಲಿ ಕರೆ" ನಿಜವಾದ ಕರೆ ಮಾಡುವುದಿಲ್ಲ, ನಿಮ್ಮ ಕುಟುಂಬಕ್ಕೆ ಏನೂ ತಿಳಿಸುವುದಿಲ್ಲ. ಕರೆ ಮಾಡುವವರ ಹೆಸರು, ಸಂಖ್ಯೆ, ಸಮಯ — ಎಲ್ಲವೂ ನಿಮ್ಮ ಫೋನಿನಲ್ಲಿ ಮಾತ್ರ ಉಳಿಯುತ್ತವೆ',
          'ನಕಲಿ ಕರೆಗೆ ಉತ್ತರಿಸಿದ ನಂತರ ಕೇಳಿಸುವ ಧ್ವನಿ ನಿಮ್ಮ ಫೋನಿನ ಸ್ವಂತ ಟೆಕ್ಸ್ಟ್-ಟು-ಸ್ಪೀಚ್. ಮೈಕ್ರೊಫೋನ್ ಬಳಸಲ್ಪಡುವುದಿಲ್ಲ, ಏನೂ ರೆಕಾರ್ಡ್ ಆಗುವುದಿಲ್ಲ',
          'ಇತರ ಸದಸ್ಯರಿಗೆ ನೀವು ಇಡುವ ಅಡ್ಡಹೆಸರುಗಳು ಮತ್ತು ನಿಮ್ಮ ಭಾಷೆಯ ಆಯ್ಕೆ ನಿಮಗಾಗಿ ಮಾತ್ರ ಫೋನಿನಲ್ಲಿ ಉಳಿಯುತ್ತವೆ',
          'ಈ ವಿಭಾಗದಲ್ಲಿರುವ ಎಲ್ಲವೂ ಆ್ಯಪ್ ಅನ್ನು ಅನ್‌ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಿದಾಗ ತೆಗೆದುಹಾಕಲ್ಪಡುತ್ತವೆ',
          "ಅಪಘಾತ ಪತ್ತೆ ಆನ್ ಆಗಿದ್ದು ನೀವು ವೇಗವಾಗಿ ಪ್ರಯಾಣಿಸುವಾಗ ಮಾತ್ರ ಚಲನೆ ಸೆನ್ಸರ್ ಅನ್ನು ಓದುತ್ತದೆ. ರೀಡಿಂಗ್‌ಗಳನ್ನು ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲೇ ಪರಿಶೀಲಿಸಲಾಗುತ್ತದೆ, ಎಂದಿಗೂ ಅಪ್‌ಲೋಡ್ ಆಗುವುದಿಲ್ಲ",
        ],
      },
      crash: {
        title: 'ಕ್ರ್ಯಾಶ್ ಮತ್ತು ರೋಗನಿರ್ಣಯ ವರದಿಗಳು',
        items: [
          'ಅಪ್ಲಿಕೇಶನ್ ಕ್ರ್ಯಾಶ್ ಆದಾಗ ಅಥವಾ ಸ್ಪಂದಿಸದಿದ್ದಾಗ, ದೋಷವನ್ನು ಕಂಡುಹಿಡಿದು ಸರಿಪಡಿಸಲು Firebase Crashlytics ಗೆ ವರದಿ ಕಳುಹಿಸಲಾಗುತ್ತದೆ',
          'ವರದಿಯಲ್ಲಿ ತಾಂತ್ರಿಕ ದೋಷ, ನಿಮ್ಮ ಸಾಧನದ ಮಾದರಿ ಮತ್ತು Android ಆವೃತ್ತಿ, ಹಾಗೂ ಅನಾಮಧೇಯ ಖಾತೆ ಗುರುತು ಇರುತ್ತದೆ',
          'ಅದರಲ್ಲಿ ನಿಮ್ಮ ಸ್ಥಳ, ನಿಮ್ಮ ಸಂದೇಶಗಳು, ನಿಮ್ಮ ಹೆಸರು ಅಥವಾ ಫೋನ್ ಸಂಖ್ಯೆ ಇರುವುದಿಲ್ಲ',
          'ನೀವು ಈ ನೀತಿಯನ್ನು ಒಪ್ಪುವವರೆಗೆ ಏನನ್ನೂ ಸಂಗ್ರಹಿಸಲಾಗುವುದಿಲ್ಲ, ಮತ್ತು ವರದಿಗಳನ್ನು ಜಾಹೀರಾತು ಅಥವಾ ಪ್ರೊಫೈಲಿಂಗ್‌ಗೆ ಎಂದಿಗೂ ಬಳಸಲಾಗುವುದಿಲ್ಲ',
        ],
      },
      providers: {
        title: 'ಇನ್ನು ಯಾರು ಒಳಗೊಂಡಿದ್ದಾರೆ',
        items: [
          'Supabase — ಡೇಟಾಬೇಸ್ ಹೋಸ್ಟ್ ಮಾಡುತ್ತದೆ ಮತ್ತು ಸೈನ್-ಇನ್ ನಿರ್ವಹಿಸುತ್ತದೆ',
          'Google Firebase — ಪುಶ್ ಅಧಿಸೂಚನೆಗಳನ್ನು ತಲುಪಿಸುತ್ತದೆ ಮತ್ತು Crashlytics ಮೂಲಕ ಕ್ರ್ಯಾಶ್ ವರದಿಗಳನ್ನು ಪಡೆಯುತ್ತದೆ',
          'Agora — ನೇರ ಕರೆಯ ಆಡಿಯೊ ಮತ್ತು ವೀಡಿಯೊವನ್ನು ಸಾಗಿಸುತ್ತದೆ',
          'OpenWeatherMap — ಕುಟುಂಬ ಕಾರ್ಡ್‌ಗಳಲ್ಲಿ ತೋರಿಸುವ ಹವಾಮಾನವನ್ನು ಒದಗಿಸುತ್ತದೆ. ನಮ್ಮ ಸರ್ವರ್‌ನಿಂದ ಅಂದಾಜು ಪ್ರದೇಶ (ಸುಮಾರು 11 ಕಿ.ಮೀ.ಗೆ ಸುತ್ತುಗೊಳಿಸಿದ) ಮಾತ್ರ ಕಳುಹಿಸಲಾಗುತ್ತದೆ, ನಿಮ್ಮ ನಿಖರ ಸ್ಥಳ ಅಥವಾ ಫೋನ್ ವಿಳಾಸವಲ್ಲ',
          'ನೀವು ಕಳುಹಿಸುವ ಬೇರೆ ಯಾವುದೇ ಸಂದೇಶವನ್ನು ಸಾಗಿಸುವಂತೆಯೇ, "ಇಂಟರ್ನೆಟ್ ಇಲ್ಲದಾಗ SMS" ಎಚ್ಚರಿಕೆಗಳನ್ನು ನಿಮ್ಮ ಮೊಬೈಲ್ ಆಪರೇಟರ್ ಸಾಗಿಸುತ್ತಾರೆ',
          'ಈ ಪೂರೈಕೆದಾರರು ಸೇವೆ ನಡೆಸಲು ಮಾತ್ರ ಡೇಟಾ ಸಂಸ್ಕರಿಸುತ್ತಾರೆ, ತಮ್ಮ ಸ್ವಂತ ಉದ್ದೇಶಗಳಿಗೆ ಎಂದಿಗೂ ಅಲ್ಲ',
          'ನಿಮ್ಮ ಡೇಟಾ ಮಾರಾಟವಾಗುವುದಿಲ್ಲ. ಈ ಪೂರೈಕೆದಾರರು ಮತ್ತು ನಿಮ್ಮ ಸ್ವಂತ ಕುಟುಂಬ ಗುಂಪಿನ ಹೊರತಾಗಿ, "ಇಂಟರ್ನೆಟ್ ಇಲ್ಲದಾಗ SMS" ಗಾಗಿ ನೀವೇ ಆಯ್ಕೆ ಮಾಡಿದ ಒಂದು ಹೆಚ್ಚುವರಿ ಸಂಖ್ಯೆ ಮಾತ್ರ ಸ್ವೀಕರಿಸುವವರು',
        ],
      },
      protect: {
        title: 'ನಾವು ಇದನ್ನು ಹೇಗೆ ರಕ್ಷಿಸುತ್ತೇವೆ',
        items: [
          'ಡೇಟಾವನ್ನು SOC 2 ಅನುಸರಣೆಯ Supabase ಮೂಲಸೌಕರ್ಯದಲ್ಲಿ ಇರಿಸಲಾಗುತ್ತದೆ',
          'Row Level Security ಪ್ರತಿ ಕೋಷ್ಟಕವನ್ನು ಅದನ್ನು ನೋಡಲು ಅರ್ಹರಾದವರಿಗೆ ಮಾತ್ರ ಸೀಮಿತಗೊಳಿಸುತ್ತದೆ',
          'ಪಾಸ್‌ವರ್ಡ್‌ಗಳನ್ನು bcrypt ನಿಂದ ಹ್ಯಾಶ್ ಮಾಡಲಾಗುತ್ತದೆ — ನಮಗೆ ಅವು ಕಾಣಿಸುವುದಿಲ್ಲ',
          'ಪ್ರತಿ ವಿನಂತಿಗೆ ದೃಢೀಕೃತ ಸೆಷನ್ ಅಗತ್ಯ',
          'ಯಾವುದೇ ಡೇಟಾ ಸಂಸ್ಕರಿಸುವ ಮೊದಲು Edge Functions ವಿನಂತಿಸಿದವರ ಗುರುತನ್ನು ಪರಿಶೀಲಿಸುತ್ತವೆ',
          'ಪ್ರತಿ ಕರೆಗೆ ಸರ್ವರ್ ನೀಡುವ ಅಲ್ಪಾವಧಿಯ ಟೋಕನ್‌ಗಳಿಂದ ಪ್ರತ್ಯೇಕವಾಗಿ ಅಧಿಕಾರ ನೀಡಲಾಗುತ್ತದೆ',
        ],
      },
      retention: {
        title: 'ನಾವು ಇದನ್ನು ಎಷ್ಟು ಕಾಲ ಇಡುತ್ತೇವೆ',
        items: [
          'ಸಂದೇಶಗಳು 90 ದಿನಗಳ ನಂತರ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಅಳಿಸಲ್ಪಡುತ್ತವೆ',
          'ಒಂದು ಸಂದೇಶಕ್ಕೆ ಜೋಡಿಸಿದ ಫೋಟೋ, ವೀಡಿಯೊ, ಧ್ವನಿ ಟಿಪ್ಪಣಿ ಅಥವಾ ಡಾಕ್ಯುಮೆಂಟ್ ಆ 90-ದಿನದ ಅಳಿಸುವಿಕೆ ನಡೆದಾಗ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ತೆಗೆದುಹಾಕಲ್ಪಡುವುದಿಲ್ಲ',
          'ಪರಿಹರಿಸಿದ SOS ಎಚ್ಚರಿಕೆಗಳು 30 ದಿನಗಳ ನಂತರ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಅಳಿಸಲ್ಪಡುತ್ತವೆ',
          'ಸ್ಥಳ ಇತಿಹಾಸ 7 ದಿನಗಳ ನಂತರ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಅಳಿಸಲ್ಪಡುತ್ತದೆ',
          'ಬಳಕೆಯಾಗದ ಸಾಧನ ಅಧಿಸೂಚನೆ ಟೋಕನ್‌ಗಳನ್ನು 60 ದಿನಗಳ ನಂತರ ತೆಗೆದುಹಾಕಲಾಗುತ್ತದೆ',
          'ನಿಮ್ಮ ಖಾತೆಯನ್ನು ಅಳಿಸಿದರೆ ಈ ದಾಖಲೆಗಳಿಂದ ನಿಮ್ಮ ಡೇಟಾ ತೆಗೆದುಹಾಕಲ್ಪಡುತ್ತದೆ',
'ನಿಮ್ಮ ಫೋನಿನಲ್ಲಿ ಉಳಿಯುವ ಸೆಟ್ಟಿಂಗ್‌ಗಳು — ನಕಲಿ ಕರೆ ವಿವರಗಳು, "ಇಂಟರ್ನೆಟ್ ಇಲ್ಲದಾಗ SMS" ಸಂಖ್ಯೆಗಳು, ಅಡ್ಡಹೆಸರುಗಳು — ಆ್ಯಪ್ ಅನ್‌ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಿದಾಗ ಹೋಗುತ್ತವೆ',
          "ಡ್ರೈವಿಂಗ್ ಟ್ರಿಪ್‌ಗಳು 30 ದಿನಗಳ ನಂತರ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಅಳಿಸಲ್ಪಡುತ್ತವೆ, ಡ್ರೈವಿಂಗ್ ಟ್ರಿಪ್‌ಗಳನ್ನು ಆಫ್ ಮಾಡಿದ ತಕ್ಷಣ ಅಳಿಸಲ್ಪಡುತ್ತವೆ",
          "ಫೋನ್ ಕಳೆದುಹೋಗಿದೆ ದಾಖಲೆಗಳು ಆ ಮೋಡ್ ಮುಗಿದಾಗ, ಮತ್ತು ಯಾವುದೇ ಸಂದರ್ಭದಲ್ಲಿ 12 ಗಂಟೆಗಳ ನಂತರ ಅಳಿಸಲ್ಪಡುತ್ತವೆ",
          "SOS ಧ್ವನಿ ಕ್ಲಿಪ್‌ಗಳು ಮತ್ತು ಫೋಟೋಗಳು 7 ದಿನಗಳ ನಂತರ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಅಳಿಸಲ್ಪಡುತ್ತವೆ",
          "\"ಹತ್ತಿರದ ಸಹಾಯ\" ವಿನಂತಿಗಳು ಮತ್ತು ಉತ್ತರಗಳು ಅವು ಸೇರಿದ SOS ಪರಿಹಾರವಾದ 30 ದಿನಗಳ ನಂತರ ಅದರೊಂದಿಗೆ ಅಳಿಸಲ್ಪಡುತ್ತವೆ",
          "ಸ್ಥಳಕ್ಕೆ ತಲುಪುವ/ಹೊರಡುವ ಸೂಚನೆಗಳು, ಬ್ಯಾಟರಿ ಮತ್ತು ಫೋನ್-ಆಫ್‌ಲೈನ್ ಎಚ್ಚರಿಕೆಗಳನ್ನು ನೀವು ಖಾತೆ ಅಳಿಸುವವರೆಗೆ ಇಡಲಾಗುತ್ತದೆ, ನಂತರ ಅಳಿಸಲಾಗುತ್ತದೆ",
          "ತಪ್ಪು ಪಾಸ್‌ವರ್ಡ್ ವರದಿಗಳು, ಅವುಗಳ ಫೋಟೋ ಸೇರಿದಂತೆ, 7 ದಿನಗಳ ನಂತರ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಅಳಿಸಲ್ಪಡುತ್ತವೆ",
        ],
      },
      choices: {
        title: 'ನಿಮ್ಮ ಆಯ್ಕೆಗಳು',
        items: [
          'ನಿಮ್ಮ ಎಲ್ಲಾ ಡೇಟಾ ನೋಡಿ — ಅದು ನಿಮ್ಮ ಸ್ವಂತ ಕುಟುಂಬ ಗುಂಪಿನೊಳಗೆ ನಿಮಗೆ ಕಾಣಿಸುತ್ತದೆ',
          'ಸ್ಥಳ ಹಂಚಿಕೆಯನ್ನು ಯಾವಾಗ ಬೇಕಾದರೂ ಪ್ರೊಫೈಲ್ → ಗೌಪ್ಯತೆ ಯಲ್ಲಿ ಆಫ್ ಮಾಡಿ',
          'ಯಾವಾಗ ಬೇಕಾದರೂ ಕುಟುಂಬ ಗುಂಪಿನಿಂದ ಹೊರಬನ್ನಿ',
'ಪ್ರೊಫೈಲ್ ನಲ್ಲಿ ಯಾವಾಗ ಬೇಕಾದರೂ "ಅಲುಗಾಡಿಸಿದರೆ SOS" ಆಫ್ ಮಾಡಿ',
          'ಪ್ರೊಫೈಲ್ ನಲ್ಲಿ ಯಾವಾಗ ಬೇಕಾದರೂ "ಇಂಟರ್ನೆಟ್ ಇಲ್ಲದಾಗ SMS" ಆಫ್ ಮಾಡಿ, ಹೆಚ್ಚುವರಿ ಸಂಖ್ಯೆಯನ್ನು ತೆಗೆದುಹಾಕಿ',
          'ಸಂದೇಶ ಮತ್ತು ಕರೆ ಇತಿಹಾಸವನ್ನು ಆಯಾ ಪರದೆಗಳಿಂದ ತೆಗೆದುಹಾಕಿ',
          'ನಿಮ್ಮ ಖಾತೆ ಮತ್ತು ಅದರ ಡೇಟಾವನ್ನು ಪ್ರೊಫೈಲ್ → ನನ್ನ ಖಾತೆ ಅಳಿಸಿ ಇಂದ, ಅಥವಾ ಆ್ಯಪ್ ಇಲ್ಲದೆ Famora ವೆಬ್‌ಸೈಟ್‌ನ "Delete Account" ಪುಟದಿಂದ ಅಳಿಸಿ',
          'ಕ್ಯಾಮೆರಾ, ಮೈಕ್ರೊಫೋನ್, ಸ್ಥಳ, SMS ಅಥವಾ ಅಧಿಸೂಚನೆ ಅನುಮತಿಯನ್ನು Android ಸೆಟ್ಟಿಂಗ್‌ಗಳಲ್ಲಿ ಹಿಂಪಡೆಯಿರಿ',
          "Profile → ಡ್ರೈವಿಂಗ್ ಸುರಕ್ಷತೆ ನಲ್ಲಿ ಯಾವಾಗ ಬೇಕಾದರೂ ಅತಿ ವೇಗ ಎಚ್ಚರಿಕೆ, ಡ್ರೈವಿಂಗ್ ಟ್ರಿಪ್‌ಗಳು, ಅಪಘಾತ ಪತ್ತೆ, ಮತ್ತು Profile → Safety ನಲ್ಲಿ ಹವಾಮಾನ ಎಚ್ಚರಿಕೆಗಳನ್ನು ಆನ್ ಅಥವಾ ಆಫ್ ಮಾಡಿ",
          "Profile → Safety ನಲ್ಲಿ ಯಾವಾಗ ಬೇಕಾದರೂ \"ಫೋನ್ ಕಳೆದುಹೋಗಿದೆ ಅನುಮತಿ\" ಆನ್ ಅಥವಾ ಆಫ್ ಮಾಡಿ",
          "Profile → Safety ನಲ್ಲಿ ಯಾವಾಗ ಬೇಕಾದರೂ \"ನನ್ನ SOS ಜೊತೆ ಧ್ವನಿ ಕ್ಲಿಪ್\" ಆನ್ ಅಥವಾ ಆಫ್ ಮಾಡಿ",
          "SOS ಪುಟದಿಂದ ಯಾವಾಗ ಬೇಕಾದರೂ \"ಹತ್ತಿರದ ಸಹಾಯ\"ದಲ್ಲಿ ಸೇರಿ ಅಥವಾ ಹೊರಬನ್ನಿ, ಮತ್ತು ನಿಮ್ಮ ಇತಿಹಾಸದಿಂದ ನಮೂದುಗಳನ್ನು ಮರೆಮಾಡಿ",
          "Profile → ಸ್ಥಳಗಳು ನಲ್ಲಿ ಯಾವಾಗ ಬೇಕಾದರೂ ಉಳಿಸಿದ ಸ್ಥಳವನ್ನು ಅಳಿಸಿ",
          "ತಪ್ಪು ಪಾಸ್‌ವರ್ಡ್ ಎಚ್ಚರಿಕೆ ಮತ್ತು ಅದರ ಫೋಟೋ ಆಯ್ಕೆಯನ್ನು ಯಾವಾಗ ಬೇಕಾದರೂ Profile → ಕಳ್ಳತನ ರಕ್ಷಣೆ ಯಲ್ಲಿ ಆನ್ ಅಥವಾ ಆಫ್ ಮಾಡಿ, ಇದು ನಿಮ್ಮ ಫೋನ್‌ನಿಂದ Famora ನ ಡಿವೈಸ್-ಅಡ್ಮಿನ್ ಅನುಮತಿಯನ್ನೂ ತೆಗೆದುಹಾಕುತ್ತದೆ",
        ],
      },
    },
  },

  // ────────────────────────────────────────────────────────────── Malayalam ──
  // See the NOT REVIEWED BY A LAWYER note at the top of this file.
  ml: {
    lastUpdated: '26 സെപ്റ്റംബർ 2026',
    pageTitle: 'സ്വകാര്യതാ നയം',
    consentTitle: 'സ്വകാര്യതാ നയവും ഉപയോഗ നിബന്ധനകളും',
    lastUpdatedLabel: 'അവസാനം പുതുക്കിയത്',
    promiseLead: 'Famora ഒരു ലളിതമായ വാഗ്ദാനത്തിലാണ് പണിതിരിക്കുന്നത്:',
    promiseStrong: 'നിങ്ങളുടെ ഡാറ്റ നിങ്ങളുടേതും നിങ്ങളുടെ കുടുംബത്തിന്റേതുമാണ് — മറ്റാരുടേതുമല്ല.',
    promiseTail: 'നിങ്ങളുടെ കുടുംബത്തെ സുരക്ഷിതമായും ബന്ധിപ്പിച്ചും നിർത്താൻ ആവശ്യമുള്ളത് മാത്രമേ ഞങ്ങൾ ശേഖരിക്കുന്നുള്ളൂ.',
    intro:
      'കുടുംബങ്ങൾക്ക് പരസ്പരം ബന്ധപ്പെട്ടിരിക്കാനും അടിയന്തര ഘട്ടത്തിൽ വേഗത്തിൽ ' +
      'പരസ്പരം എത്തിച്ചേരാനും Famora സഹായിക്കുന്നു. നിങ്ങൾ ചേരാൻ തിരഞ്ഞെടുത്ത ' +
      'കുടുംബ ഗ്രൂപ്പുമായി മാത്രമാണ് ഇത് നിങ്ങളുടെ ലൊക്കേഷനും സന്ദേശങ്ങളും കോളുകളും ' +
      'പങ്കിടുന്നത് — കൂടാതെ, "ഇന്റർനെറ്റ് ഇല്ലാത്തപ്പോൾ SMS" ഓണാക്കിയാൽ, നിങ്ങൾ തന്നെ തിരഞ്ഞെടുക്കുന്ന ഒരു അധിക നമ്പറുമായും. എന്ത് ശേഖരിക്കുന്നു, എന്തിന്, ആരുമായി പങ്കിടുന്നു, എത്ര കാലം ' +
      'സൂക്ഷിക്കുന്നു എന്ന് ഈ പേജ് കൃത്യമായി വിശദീകരിക്കുന്നു.',
    consentNote:
      'തുടരുന്നതിലൂടെ, ഈ നയം വായിച്ച് അംഗീകരിച്ചതായും, മറ്റൊരാൾക്ക് വേണ്ടി നിങ്ങൾ ' +
      'സൃഷ്ടിച്ച ഏതൊരു അക്കൗണ്ടിന്റെയും ലൊക്കേഷൻ പങ്കിടാൻ നിങ്ങൾക്ക് അവകാശമുണ്ടെന്നും ' +
      'നിങ്ങൾ സ്ഥിരീകരിക്കുന്നു.',
    contactPrompt: 'നിങ്ങളുടെ സ്വകാര്യതയെക്കുറിച്ച് ചോദ്യങ്ങളുണ്ടോ?',
    contactPromptConsent: 'ചോദ്യമോ ഡാറ്റാ അഭ്യർഥനയോ?',
    sections: {
      collect: {
        title: 'ഞങ്ങൾ ശേഖരിക്കുന്ന വിവരങ്ങൾ',
        items: [
          'മൊബൈൽ നമ്പർ — നിങ്ങളുടെ അക്കൗണ്ട് സൃഷ്ടിക്കാനും സൈൻ ഇൻ ചെയ്യാനും',
          'പ്രദർശന നാമവും, നിങ്ങൾ ചേർത്താൽ പ്രൊഫൈൽ ഫോട്ടോയും',
          'ലൊക്കേഷൻ പങ്കിടൽ ഓണായിരിക്കുമ്പോൾ ലൊക്കേഷൻ',
'ബാറ്ററി നില, ചാർജിംഗ് അവസ്ഥ, നീങ്ങുമ്പോഴുള്ള വേഗത — നിങ്ങളുടെ ലൊക്കേഷനോടൊപ്പം കുടുംബത്തിന് കാണാം',
          'നിങ്ങളുടെ കുടുംബ ഗ്രൂപ്പിൽ നിങ്ങൾ അയയ്ക്കുന്ന സന്ദേശങ്ങൾ',
          "നിങ്ങളുടെ കുടുംബ ഗ്രൂപ്പിന്റെ ചാറ്റിലോ മറ്റൊരു അംഗവുമായുള്ള സ്വകാര്യ ഒന്നിനൊന്ന് ത്രെഡിലോ, ഒരു സന്ദേശത്തിനൊപ്പം നിങ്ങൾ ചേർക്കാൻ തിരഞ്ഞെടുക്കുന്ന ഫോട്ടോകൾ, വീഡിയോകൾ, (നിങ്ങളുടെ മൈക്രോഫോൺ ഉപയോഗിച്ച് റെക്കോർഡ് ചെയ്ത) വോയ്‌സ് നോട്ടുകൾ, ഡോക്യുമെന്റുകൾ",
          'നിങ്ങൾ അയച്ചതോ ലഭിച്ചതോ ആയ SOS മുന്നറിയിപ്പുകൾ, ആ സമയത്തെ ലൊക്കേഷൻ ഉൾപ്പെടെ',
          'കോൾ രേഖകൾ: ആര് ആരെ വിളിച്ചു, സമയം, ദൈർഘ്യം, വോയ്‌സാണോ വീഡിയോയാണോ',
          'മുന്നറിയിപ്പുകളും കോളുകളും നിങ്ങളുടെ ഫോണിൽ എത്താൻ ഒരു ഉപകരണ അറിയിപ്പ് ടോക്കൺ',
          'കോളുകളും മുന്നറിയിപ്പുകളും വിശ്വസനീയമായി എത്തിക്കാൻ വേണ്ട അടിസ്ഥാന ഉപകരണ വിവരങ്ങൾ',
'മോഷൻ സെൻസർ റീഡിംഗുകൾ, "കുലുക്കിയാൽ SOS" ഓണായിരിക്കുമ്പോൾ മാത്രം — അവ നിങ്ങളുടെ ഫോണിൽത്തന്നെ പരിശോധിക്കപ്പെടുന്നു, എങ്ങോട്ടും അയക്കുന്നില്ല',
          '"ഇന്റർനെറ്റ് ഇല്ലാത്തപ്പോൾ SMS" ഉപയോഗിക്കുന്നെങ്കിൽ, അതിനായി നിങ്ങൾ നൽകുന്ന അധിക ഫോൺ നമ്പർ',
          'ആപ്പ് പ്രവർത്തിക്കാതായാൽ ക്രാഷ്, ഡയഗ്നോസ്റ്റിക് റിപ്പോർട്ടുകൾ — താഴെ കാണുക',
          "നിങ്ങൾ ഡ്രൈവിംഗ് ട്രിപ്പുകൾ ഓണാക്കിയാൽ: ഓരോ യാത്രയുടെയും തുടക്ക, അവസാന സമയം, ദൂരം, ശരാശരി-കൂടിയ വേഗം, പെട്ടെന്നുള്ള ബ്രേക്കുകളുടെയും വേഗത്തിലുള്ള തുടക്കങ്ങളുടെയും എണ്ണം — മുകളിലെ ലൊക്കേഷൻ ഡാറ്റയിൽ നിന്നുതന്നെ കണക്കാക്കുന്നു, അധിക സെൻസർ ഇല്ല",
          "നിങ്ങൾ സേവ് ചെയ്ത സ്ഥലങ്ങൾ (പേരും സ്ഥാനവും), അമിതവേഗ മുന്നറിയിപ്പിനായി നിങ്ങൾ വെച്ച പരിധി — സേവ് ചെയ്ത സ്ഥലങ്ങൾ നിങ്ങൾക്ക് മാത്രമേ കാണാനാകൂ",
          "നിങ്ങളുടെ ഫോണിൽ \"ഫോൺ നഷ്ടപ്പെട്ടു\" ഉപയോഗിച്ചാൽ: അത് നഷ്ടപ്പെട്ടതായി അടയാളപ്പെടുത്തിയ വിവരം, ആര് അടയാളപ്പെടുത്തി, അവർ ടൈപ്പ് ചെയ്ത ചെറിയ സന്ദേശം, നഷ്ടപ്പെട്ട അവസ്ഥയിൽ ഏതാനും സെക്കൻഡിൽ ഒരിക്കൽ ഫോണിന്റെ സ്ഥാനം",
          "നിങ്ങളുടെ നെറ്റ്‌വർക്ക് തരം (Wi-Fi അല്ലെങ്കിൽ മൊബൈൽ ഡാറ്റ) സിഗ്നൽ ശക്തിയും, നിങ്ങളുടെ കാർഡിൽ നിങ്ങളുടെ കുടുംബത്തിന് കാണിക്കും",
          "നിങ്ങൾ സേവ് ചെയ്ത സ്ഥലത്ത് (വീട്, ഓഫീസ് പോലെ) എത്തുമ്പോഴോ അവിടെ നിന്ന് പുറപ്പെടുമ്പോഴോ: സ്ഥലത്തിന്റെ പേര്, എത്തിയോ പുറപ്പെട്ടോ, സമയം. ഇത് നിങ്ങളുടെ കുടുംബത്തെ അറിയിക്കും, പക്ഷേ ആ സ്ഥലത്തിന്റെ കൃത്യമായ സ്ഥാനം ഒരിക്കലും അല്ല",
          "നിങ്ങൾ \"എന്റെ SOS-നൊപ്പം വോയ്‌സ് ക്ലിപ്പ്\" ഓണാക്കിയാൽ: ആപ്പിൽ നിന്ന് SOS അയച്ച ശേഷം നിങ്ങളുടെ ഫോൺ റെക്കോർഡ് ചെയ്യുന്ന 15 സെക്കൻഡ് വരെ ഓഡിയോ, നിങ്ങൾ ചേർക്കാൻ ആഗ്രഹിച്ചാൽ ക്യാമറയിൽ നിന്നുള്ള ഒരു ഫോട്ടോ",
          "നിങ്ങൾ \"അടുത്തുള്ള സഹായം\" തിരഞ്ഞെടുത്താൽ: നിങ്ങളുടെ ഏകദേശ സ്ഥാനം (നിങ്ങളുടെ അടുത്ത് SOS അയയ്ക്കുന്നവരുമായി ചേർക്കാൻ), അടുത്തുള്ള ആളുകളുടെ മാപ്പിൽ മങ്ങിയ, പേരില്ലാത്ത ഒരു ഡോട്ട്, സഹായ അഭ്യർത്ഥനകൾക്കുള്ള നിങ്ങളുടെ മറുപടികൾ",
          "നിങ്ങൾ Profile → മോഷണ സംരക്ഷണം ൽ തെറ്റായ പാസ്‌വേഡ് മുന്നറിയിപ്പ് ഓണാക്കിയാൽ: നിങ്ങളുടെ ഫോണിൽ 10 മിനിറ്റിനുള്ളിൽ 3 അല്ലെങ്കിൽ അതിലധികം തെറ്റായ സ്ക്രീൻ-ലോക്ക് ശ്രമങ്ങൾ നടന്ന വിവരം, എത്ര ശ്രമങ്ങൾ, ആ നിമിഷത്തിലെ അതിന്റെ സ്ഥാനം; കൂടാതെ, നിങ്ങൾ ഫോട്ടോ ഓപ്ഷനും ഓണാക്കിയാൽ മാത്രം, അതിനു ശേഷം എടുക്കുന്ന ഒരു ഫ്രണ്ട്-ക്യാമറ ഫോട്ടോ",
        ],
      },
      use: {
        title: 'ഞങ്ങൾ ഇത് എങ്ങനെ ഉപയോഗിക്കുന്നു',
        items: [
          'നിങ്ങളുടെ ലൊക്കേഷൻ നിങ്ങളുടെ സ്വന്തം കുടുംബ ഗ്രൂപ്പിലെ അംഗങ്ങൾക്ക് മാത്രമേ കാണാനാകൂ',
          'കഴിഞ്ഞ 7 ദിവസം നിങ്ങൾ എവിടെയെല്ലാം ആയിരുന്നു എന്നും കുടുംബാംഗങ്ങൾക്ക് മാപ്പിലെ ടൈംലൈനിൽ കാണാം',
          'സന്ദേശങ്ങൾ ആ കുടുംബ ഗ്രൂപ്പിലെ അംഗങ്ങൾക്ക് മാത്രമേ കാണാനാകൂ',
          "നിങ്ങളുടെ കുടുംബ ഗ്രൂപ്പിന്റെ ചാറ്റിൽ ഒരു സന്ദേശത്തോടൊപ്പം ചേർത്ത ഫോട്ടോ, വീഡിയോ, വോയ്‌സ് നോട്ട് അല്ലെങ്കിൽ ഡോക്യുമെന്റ് ആ സന്ദേശം പോലെതന്നെ ആ ഗ്രൂപ്പിന് കാണാം; സ്വകാര്യ ഒന്നിനൊന്ന് സന്ദേശത്തോടൊപ്പം ചേർത്തത് നിങ്ങൾക്കും മറ്റയാൾക്കും മാത്രമേ കാണാനാകൂ, നിങ്ങളുടെ കുടുംബ ഗ്രൂപ്പിലെ മറ്റുള്ളവർക്ക് ഒരിക്കലുമില്ല",
          'അറിയിപ്പ് ടോക്കണുകൾ മുന്നറിയിപ്പുകളും സന്ദേശങ്ങളും കോളുകളും എത്തിക്കാൻ മാത്രമാണ് ഉപയോഗിക്കുന്നത്',
          'കോൾ, വീഡിയോ ഉള്ളടക്കം ഞങ്ങൾ ഒരിക്കലും റെക്കോർഡ് ചെയ്യുകയോ സൂക്ഷിക്കുകയോ ചെയ്യുന്നില്ല',
          'ഞങ്ങൾ നിങ്ങളുടെ സന്ദേശങ്ങൾ വായിക്കുന്നില്ല, നിങ്ങളുടെ ഡാറ്റ വിൽക്കുന്നുമില്ല',
          'പരസ്യത്തിനോ പ്രൊഫൈലിംഗിനോ നിങ്ങളുടെ ഡാറ്റ ഞങ്ങൾ ഉപയോഗിക്കുന്നില്ല',
          "അമിതവേഗ മുന്നറിയിപ്പും ഡ്രൈവിംഗ് ട്രിപ്പുകളും നിങ്ങൾ ഓണാക്കുന്നതുവരെ ഓഫ് ആയിരിക്കും. ഓണാക്കിയാൽ നിങ്ങളുടെ കുടുംബ ഗ്രൂപ്പിന് നിങ്ങളുടെ ട്രിപ്പുകൾ കാണാം, നിങ്ങൾ തിരഞ്ഞെടുത്ത പരിധി കടന്നാൽ അവരെ അറിയിക്കും, നിങ്ങളുടെ ഫോണിലും മുന്നറിയിപ്പ് വരും",
          "കടുത്ത കാലാവസ്ഥാ മുന്നറിയിപ്പുകൾ നിങ്ങൾക്ക് മാത്രം, നിങ്ങൾ സേവ് ചെയ്ത സ്ഥലങ്ങളെക്കുറിച്ച് വരും. ഓരോ സ്ഥലത്തിന്റെയും ഏകദേശ പ്രദേശം മാത്രം (ഏകദേശം 11 കി.മീ വരെ റൗണ്ട് ചെയ്തത്) ഞങ്ങളുടെ സെർവറിൽ നിന്ന് OpenWeatherMap ലേക്ക് അയയ്ക്കുന്നു",
          "അപകട കണ്ടെത്തൽ നിങ്ങൾ ഓണാക്കുന്നതുവരെ ഓഫ് ആയിരിക്കും. അത് സ്വയം ഒന്നും അയയ്ക്കില്ല: അപകടം തിരിച്ചറിഞ്ഞാൽ 20 സെക്കൻഡ് കൗണ്ട്ഡൗൺ മാത്രം തുടങ്ങും, നിങ്ങൾ റദ്ദാക്കിയില്ലെങ്കിൽ മാത്രമേ SOS പോകൂ",
          "Profile → Safety ൽ \"ഫോൺ നഷ്ടപ്പെട്ടു അനുവദിക്കുക\" നിങ്ങൾ ഓണാക്കുന്നതുവരെ അത് ഓഫ് ആയിരിക്കും. അതിനു ശേഷം മാത്രമേ നിങ്ങളുടെ കുടുംബങ്ങളിൽ ഒന്നിന്റെ അഡ്മിന് നിങ്ങളുടെ ഫോൺ നഷ്ടപ്പെട്ടതായി അടയാളപ്പെടുത്താൻ കഴിയൂ. അപ്പോൾ ഫോൺ ഏതാനും സെക്കൻഡിൽ ഒരിക്കൽ സ്ഥാനം അറിയിക്കും, ഓരോ 2 മിനിറ്റിലും റിംഗ് ചെയ്യും, ലോക്ക് സ്ക്രീനിൽ സന്ദേശം കാണിക്കും, കുടുംബത്തിലെ എല്ലാവർക്കും അത് നഷ്ടപ്പെട്ടതായി അടയാളപ്പെടുത്തിയിട്ടുണ്ടെന്ന് കാണാം. 12 മണിക്കൂറിന് ശേഷം അല്ലെങ്കിൽ കണ്ടെത്തി എന്ന് അടയാളപ്പെടുത്തുമ്പോൾ നിലയ്ക്കും",
          "നിങ്ങളുടെ ഫോൺ ബാറ്ററി ചാർജ് ചെയ്യാത്ത അവസ്ഥയിൽ 15% അല്ലെങ്കിൽ 5% ആയി കുറയുമ്പോൾ, ഫോൺ ഏകദേശം 45 മിനിറ്റായി ഒരു അപ്‌ഡേറ്റും അയയ്ക്കാത്തപ്പോൾ (ഫോൺ ഓഫ് അല്ലെങ്കിൽ നെറ്റ്‌വർക്ക് ഇല്ല), അത് വീണ്ടും റിപ്പോർട്ട് ചെയ്യുമ്പോൾ നിങ്ങളുടെ കുടുംബത്തെ അറിയിക്കും. ഈ മുന്നറിയിപ്പുകളിൽ ബാറ്ററി നിലയും ഫോൺ എത്ര സമയം നിശ്ശബ്ദമായിരുന്നു എന്നതും ഉണ്ടാകും. Profile → സ്വകാര്യത ൽ ലൊക്കേഷൻ പങ്കിടൽ ഓഫാക്കിയാൽ ഇവ നിലയ്ക്കും. ഓഫ്‌ലൈൻ മുന്നറിയിപ്പുകൾ ഇന്ത്യൻ സമയം രാത്രി 11 മുതൽ രാവിലെ 6 വരെ തടഞ്ഞുവയ്ക്കും",
          "SOS-നൊപ്പം ചേർത്ത വോയ്‌സ് ക്ലിപ്പോ ഫോട്ടോയോ ആ SOS അയച്ച കുടുംബങ്ങളിലേക്ക് മാത്രം പോകും. അത് സ്വകാര്യമായി സൂക്ഷിക്കും, അടുത്തുള്ള സഹായികളെ ഒരിക്കലും കാണിക്കില്ല, 7 ദിവസത്തിന് ശേഷം ഇല്ലാതാകും",
          "\"അടുത്തുള്ള സഹായം\" നിങ്ങൾ ചേരുന്നതുവരെ ഓഫ് ആയിരിക്കും. സഹായിക്കാൻ കഴിയാത്തത്ര ദൂരെയുള്ള കുടുംബത്തിലേക്ക് SOS എത്താനിടയുള്ളപ്പോൾ, ഏറ്റവും അടുത്തുള്ള ചേർന്നവരോട് (ആദ്യം 2 കി.മീ ഉള്ളിൽ, പിന്നെ 5 കി.മീ, പിന്നെ 10 കി.മീ) അയച്ചയാൾക്കായി ശരിയായ അടിയന്തര നമ്പറിൽ വിളിക്കാൻ ആവശ്യപ്പെടും. അവർ ഏകദേശ പ്രദേശവും ആവശ്യമായ സഹായത്തിന്റെ തരവും മാത്രമേ കാണൂ, പേരോ ഫോൺ നമ്പറോ അല്ല; സ്വീകരിക്കുന്ന ഒരാൾക്ക് മാത്രമേ കൃത്യമായ സ്ഥാനം കാണിക്കൂ. ആരോടും സ്ഥലത്തേക്ക് പോകാൻ ആവശ്യപ്പെടില്ല",
          "\"അടുത്തുള്ള സഹായം\" കാരണം, സ്ഥാനമുള്ള SOS നിങ്ങൾ അയയ്ക്കുമ്പോൾ, ആ SOS-ന്റെ ഏകദേശ പ്രദേശവും ആവശ്യമായ സഹായത്തിന്റെ തരവും അതിനടുത്തുള്ള, ചേർന്ന Famora ഉപയോക്താക്കൾക്ക് അയച്ചേക്കാം. നിങ്ങളുടെ പേര്, ഫോൺ നമ്പർ, സന്ദേശങ്ങൾ, വോയ്‌സ് ക്ലിപ്പ്, ഫോട്ടോ എന്നിവ അവർക്ക് ഒരിക്കലും ലഭിക്കില്ല",
          "നിങ്ങൾ സേവ് ചെയ്ത സ്ഥലങ്ങളിൽ എത്തുന്നതിന്റെയും പുറപ്പെടുന്നതിന്റെയും അറിയിപ്പുകൾ നിങ്ങളുടെ കുടുംബ ഗ്രൂപ്പിലേക്ക് പോകും; സ്ഥലത്തിന്റെ കൃത്യമായ സ്ഥാനം നിങ്ങളുടെ കൈവശം തന്നെ ഇരിക്കും",
          "ഏതെങ്കിലും കുടുംബാംഗത്തിന് നിങ്ങളുടെ ഫോൺ കണ്ടെത്താൻ സഹായിക്കാൻ അത് ഉച്ചത്തിൽ റിംഗ് ചെയ്യിക്കാം (\"Find My Phone\"); ഇത് നിങ്ങളുടെ കുടുംബത്തിന് ഇതിനകം അറിയാവുന്നതിനപ്പുറം നിങ്ങളുടെ സ്ഥാനം വെളിപ്പെടുത്തുന്നില്ല",
          "തെറ്റായ പാസ്‌വേഡ് മുന്നറിയിപ്പ് നിങ്ങൾ Profile → മോഷണ സംരക്ഷണം ൽ ഓണാക്കുന്നതുവരെ ഓഫ് ആയിരിക്കും. ഓണാക്കിയാൽ, 10 മിനിറ്റിനുള്ളിൽ 3 അല്ലെങ്കിൽ അതിലധികം തെറ്റായ സ്ക്രീൻ-ലോക്ക് ശ്രമങ്ങൾ — എത്ര ശ്രമങ്ങൾ, ഫോണിന്റെ അവസാനം അറിയപ്പെട്ട സ്ഥാനം എന്നിവയോടെ — നിങ്ങളുടെ കുടുംബ ഗ്രൂപ്പുകളുടെ അഡ്മിനുകൾക്ക് മാത്രം, 10 മിനിറ്റിൽ ഒരിക്കൽ മാത്രം അറിയിക്കും. തെറ്റായ അൺലോക്കിനെക്കുറിച്ച് അറിയാൻ മാത്രമാണ് ഇത് Android ന്റെ ഡിവൈസ്-അഡ്മിൻ അനുമതി ഉപയോഗിക്കുന്നത്; നിങ്ങളുടെ ഫോൺ ലോക്ക് ചെയ്യാനോ മായ്ക്കാനോ മറ്റേതെങ്കിലും വിധത്തിൽ നിയന്ത്രിക്കാനോ ഞങ്ങൾ ഇത് ഒരിക്കലും ഉപയോഗിക്കില്ല. നിങ്ങൾ ഫോട്ടോ ഓപ്ഷനും ഓണാക്കിയാൽ, അത്തരം റിപ്പോർട്ടിനു ശേഷം ഒരു ഫ്രണ്ട്-ക്യാമറ ഫോട്ടോ എടുക്കും; നിങ്ങൾക്കും ആ അഡ്മിനുകൾക്കും മാത്രമേ അത് കാണാനാകൂ",
        ],
      },
      calls: {
        title: 'വോയ്‌സ്, വീഡിയോ കോളുകൾ',
        items: [
          'കോളുകൾ കുടുംബാംഗങ്ങൾക്കിടയിൽ ഇന്റർനെറ്റ് വഴിയാണ് നടക്കുന്നത്, ഫോൺ നെറ്റ്‌വർക്ക് വഴിയല്ല',
          'ഓഡിയോയും വീഡിയോയും ഞങ്ങളുടെ കോളിംഗ് ദാതാവായ Agora വഹിക്കുന്നു, അവ റെക്കോർഡ് ചെയ്യപ്പെടുന്നില്ല',
          'കോൾ രേഖകൾ മാത്രമേ സൂക്ഷിക്കുന്നുള്ളൂ — സംഭാഷണം ഒരിക്കലുമില്ല',
          'കോളിനിടെ മൈക്രോഫോൺ ഉപയോഗിക്കുന്നു; ക്യാമറ വീഡിയോ കോളിനിടെ മാത്രം',
          'ഏത് കുടുംബാംഗത്തിനും കുടുംബത്തിനായുള്ള കോൾ ചരിത്രം മായ്ക്കാം',
        ],
      },
      sms: {
        title: 'ഇന്റർനെറ്റ് ഇല്ലാത്തപ്പോൾ SMS',
        items: [
          'Profile → ഇന്റർനെറ്റ് ഇല്ലാത്തപ്പോൾ SMS-ൽ നിങ്ങൾ ഓണാക്കുന്നതുവരെ ഇത് ഓഫായിരിക്കും',
          'നിങ്ങളുടെ ഫോണിന് പതിനഞ്ച് മിനിറ്റായി ഇന്റർനെറ്റ് ഇല്ലെങ്കിൽ, അവസാന ലൊക്കേഷൻ SMS ആയി അയയ്ക്കുന്നു, അതുവഴി കുടുംബത്തിന് ഊഹിക്കേണ്ടി വരില്ല',
          'ആ സന്ദേശത്തിൽ നിങ്ങളുടെ പേര്, എത്ര നേരമായി ഇന്റർനെറ്റ് ഇല്ല, ഒരു മാപ്പ് ലിങ്ക് — മറ്റൊന്നുമില്ല',
          'നിങ്ങൾ ഉള്ള ഓരോ കുടുംബത്തിന്റെയും അഡ്മിനുകൾക്കും, നിങ്ങൾ ചേർത്താൽ ഒരു അധിക നമ്പറിലേക്കും പോകും. ആ നമ്പർ നിങ്ങളുടെ തിരഞ്ഞെടുപ്പാണ്, അത് കുടുംബ ഗ്രൂപ്പിന് പുറത്തുള്ള ഒരാളുമാകാം',
          'സന്ദേശം മൊബൈൽ നെറ്റ്‌വർക്ക് വഴിയാണ് പോകുന്നത്, അതിനാൽ മറ്റേതൊരു സന്ദേശവും പോലെ നിങ്ങളുടെ മൊബൈൽ ഓപ്പറേറ്റർ ഇത് കൈകാര്യം ചെയ്യുന്നു',
          'ഓരോ അലേർട്ടിനും നിങ്ങളുടെ മൊബൈൽ പ്ലാൻ നിരക്ക് ഈടാക്കും, ഒരു തവണ ഇന്റർനെറ്റ് പോകുമ്പോൾ എട്ടിൽ കൂടുതൽ അയക്കില്ല',
          'SMS അയയ്ക്കാൻ Android അനുമതി നൽകണം, അത് എപ്പോൾ വേണമെങ്കിലും Android ക്രമീകരണങ്ങളിൽ പിൻവലിക്കാം',
          'അയയ്ക്കേണ്ട നമ്പറുകൾ നിങ്ങളുടെ ഫോണിൽത്തന്നെ സൂക്ഷിക്കുന്നു, അതിനാൽ കണക്ഷൻ ഇല്ലാതെയും പ്രവർത്തിക്കും; അവ മറ്റൊന്നിനും ഞങ്ങൾ ഉപയോഗിക്കുന്നില്ല',
        ],
      },
      onphone: {
        title: 'നിങ്ങളുടെ ഫോണിൽ മാത്രം നിൽക്കുന്നത്',
        items: [
          '"കുലുക്കിയാൽ SOS" ഓണായിരിക്കുമ്പോൾ മോഷൻ സെൻസർ വായിക്കുന്നു. ആ റീഡിംഗുകൾ ഫോണിൽത്തന്നെ പരിശോധിക്കപ്പെടുന്നു, ഒരിക്കലും അപ്‌ലോഡ് ചെയ്യുന്നില്ല — നിങ്ങൾ യഥാർത്ഥത്തിൽ അയയ്ക്കുന്ന SOS മാത്രമേ ഫോൺ വിട്ട് പോകൂ',
          '"വ്യാജ കോൾ" യഥാർത്ഥ കോൾ ചെയ്യുന്നില്ല, കുടുംബത്തോട് ഒന്നും പറയുന്നില്ല. വിളിക്കുന്നയാളുടെ പേര്, നമ്പർ, സമയം — എല്ലാം ഫോണിൽ മാത്രം സൂക്ഷിക്കുന്നു',
          'വ്യാജ കോളിന് മറുപടി നൽകിയ ശേഷം കേൾക്കുന്ന ശബ്ദം നിങ്ങളുടെ ഫോണിന്റെ സ്വന്തം ടെക്സ്റ്റ്-ടു-സ്പീച്ച് ആണ്. മൈക്രോഫോൺ ഉപയോഗിക്കുന്നില്ല, ഒന്നും റെക്കോർഡ് ചെയ്യുന്നില്ല',
          'മറ്റ് അംഗങ്ങൾക്ക് നിങ്ങൾ നൽകുന്ന വിളിപ്പേരുകളും നിങ്ങളുടെ ഭാഷാ തിരഞ്ഞെടുപ്പും നിങ്ങൾക്കായി മാത്രം ഫോണിൽ സൂക്ഷിക്കുന്നു',
          'ഈ വിഭാഗത്തിലുള്ളതെല്ലാം ആപ്പ് അൺഇൻസ്റ്റാൾ ചെയ്യുമ്പോൾ നീക്കം ചെയ്യപ്പെടും',
          "അപകട കണ്ടെത്തൽ ഓണായിരിക്കുകയും നിങ്ങൾ വേഗത്തിൽ സഞ്ചരിക്കുകയും ചെയ്യുമ്പോൾ മാത്രമേ മോഷൻ സെൻസർ വായിക്കൂ. റീഡിംഗുകൾ നിങ്ങളുടെ ഫോണിൽ തന്നെ വിലയിരുത്തുന്നു, ഒരിക്കലും അപ്‌ലോഡ് ചെയ്യില്ല",
        ],
      },
      crash: {
        title: 'ക്രാഷ്, ഡയഗ്നോസ്റ്റിക് റിപ്പോർട്ടുകൾ',
        items: [
          'ആപ്പ് ക്രാഷ് ആകുമ്പോഴോ പ്രതികരിക്കാതാകുമ്പോഴോ, തകരാർ കണ്ടെത്തി പരിഹരിക്കാൻ Firebase Crashlytics ലേക്ക് ഒരു റിപ്പോർട്ട് അയയ്ക്കുന്നു',
          'റിപ്പോർട്ടിൽ സാങ്കേതിക തകരാർ, നിങ്ങളുടെ ഉപകരണ മോഡൽ, Android പതിപ്പ്, ഒരു അജ്ഞാത അക്കൗണ്ട് തിരിച്ചറിയൽ എന്നിവയുണ്ട്',
          'അതിൽ നിങ്ങളുടെ ലൊക്കേഷനോ സന്ദേശങ്ങളോ പേരോ ഫോൺ നമ്പറോ ഇല്ല',
          'ഈ നയം അംഗീകരിക്കുന്നതുവരെ ഒന്നും ശേഖരിക്കുന്നില്ല, റിപ്പോർട്ടുകൾ പരസ്യത്തിനോ പ്രൊഫൈലിംഗിനോ ഒരിക്കലും ഉപയോഗിക്കുന്നില്ല',
        ],
      },
      providers: {
        title: 'മറ്റാരൊക്കെ ഉൾപ്പെട്ടിരിക്കുന്നു',
        items: [
          'Supabase — ഡാറ്റാബേസ് ഹോസ്റ്റ് ചെയ്യുന്നു, സൈൻ-ഇൻ കൈകാര്യം ചെയ്യുന്നു',
          'Google Firebase — പുഷ് അറിയിപ്പുകൾ എത്തിക്കുന്നു, Crashlytics വഴി ക്രാഷ് റിപ്പോർട്ടുകൾ സ്വീകരിക്കുന്നു',
          'Agora — തത്സമയ കോളിന്റെ ഓഡിയോയും വീഡിയോയും വഹിക്കുന്നു',
          'OpenWeatherMap — കുടുംബ കാർഡുകളിൽ കാണിക്കുന്ന കാലാവസ്ഥ നൽകുന്നു. ഞങ്ങളുടെ സെർവറിൽ നിന്ന് ഏകദേശ പ്രദേശം (ഏകദേശം 11 കി.മീ. ആയി ചുരുക്കിയത്) മാത്രമേ അയയ്ക്കൂ, നിങ്ങളുടെ കൃത്യമായ സ്ഥാനമോ ഫോണിന്റെ വിലാസമോ അല്ല',
          'നിങ്ങൾ അയയ്ക്കുന്ന മറ്റേതൊരു സന്ദേശവും പോലെ, "ഇന്റർനെറ്റ് ഇല്ലാത്തപ്പോൾ SMS" അലേർട്ടുകളും നിങ്ങളുടെ മൊബൈൽ ഓപ്പറേറ്റർ വഹിക്കുന്നു',
          'ഈ ദാതാക്കൾ സേവനം നടത്താൻ മാത്രമാണ് ഡാറ്റ പ്രോസസ് ചെയ്യുന്നത്, സ്വന്തം ആവശ്യങ്ങൾക്കായി ഒരിക്കലുമല്ല',
          'നിങ്ങളുടെ ഡാറ്റ വിൽക്കുന്നില്ല. ഈ ദാതാക്കൾക്കും നിങ്ങളുടെ സ്വന്തം കുടുംബ ഗ്രൂപ്പിനും അപ്പുറം, "ഇന്റർനെറ്റ് ഇല്ലാത്തപ്പോൾ SMS"-നായി നിങ്ങൾ തന്നെ തിരഞ്ഞെടുക്കുന്ന ഒരു അധിക നമ്പർ മാത്രമാണ് സ്വീകർത്താവ്',
        ],
      },
      protect: {
        title: 'ഞങ്ങൾ ഇത് എങ്ങനെ സംരക്ഷിക്കുന്നു',
        items: [
          'ഡാറ്റ SOC 2 അനുസൃതമായ Supabase അടിസ്ഥാനസൗകര്യത്തിൽ സൂക്ഷിക്കുന്നു',
          'Row Level Security ഓരോ പട്ടികയും അത് കാണാൻ അർഹതയുള്ളവർക്ക് മാത്രമായി പരിമിതപ്പെടുത്തുന്നു',
          'പാസ്‌വേഡുകൾ bcrypt ഉപയോഗിച്ച് ഹാഷ് ചെയ്യുന്നു — ഞങ്ങൾക്ക് അവ കാണാനാകില്ല',
          'എല്ലാ അഭ്യർഥനകൾക്കും ആധികാരികമാക്കിയ സെഷൻ ആവശ്യമാണ്',
          'ഏതെങ്കിലും ഡാറ്റ പ്രോസസ് ചെയ്യുന്നതിന് മുമ്പ് Edge Functions അഭ്യർഥിച്ചയാളുടെ ഐഡന്റിറ്റി പരിശോധിക്കുന്നു',
          'ഓരോ കോളും സെർവർ നൽകുന്ന ഹ്രസ്വകാല ടോക്കണുകൾ ഉപയോഗിച്ച് പ്രത്യേകം അധികാരപ്പെടുത്തുന്നു',
        ],
      },
      retention: {
        title: 'ഞങ്ങൾ ഇത് എത്ര കാലം സൂക്ഷിക്കുന്നു',
        items: [
          'സന്ദേശങ്ങൾ 90 ദിവസത്തിന് ശേഷം സ്വയമേവ ഇല്ലാതാകുന്നു',
          'ഒരു സന്ദേശത്തോടൊപ്പം ചേർത്ത ഫോട്ടോ, വീഡിയോ, വോയ്‌സ് നോട്ട് അല്ലെങ്കിൽ ഡോക്യുമെന്റ് ആ 90-ദിന നീക്കം നടക്കുമ്പോൾ സ്വയമേവ നീക്കം ചെയ്യപ്പെടില്ല',
          'പരിഹരിച്ച SOS മുന്നറിയിപ്പുകൾ 30 ദിവസത്തിന് ശേഷം സ്വയമേവ ഇല്ലാതാകുന്നു',
          'ലൊക്കേഷൻ ചരിത്രം 7 ദിവസത്തിന് ശേഷം സ്വയമേവ ഇല്ലാതാകുന്നു',
          'ഉപയോഗിക്കാത്ത ഉപകരണ അറിയിപ്പ് ടോക്കണുകൾ 60 ദിവസത്തിന് ശേഷം നീക്കം ചെയ്യുന്നു',
          'നിങ്ങളുടെ അക്കൗണ്ട് ഇല്ലാതാക്കിയാൽ ഈ രേഖകളിൽ നിന്ന് നിങ്ങളുടെ ഡാറ്റ നീക്കം ചെയ്യപ്പെടും',
'ഫോണിൽ സൂക്ഷിക്കുന്ന ക്രമീകരണങ്ങൾ — വ്യാജ കോൾ വിവരങ്ങൾ, "ഇന്റർനെറ്റ് ഇല്ലാത്തപ്പോൾ SMS" നമ്പറുകൾ, വിളിപ്പേരുകൾ — ആപ്പ് അൺഇൻസ്റ്റാൾ ചെയ്യുമ്പോൾ പോകും',
          "ഡ്രൈവിംഗ് ട്രിപ്പുകൾ 30 ദിവസത്തിനു ശേഷം സ്വയം ഇല്ലാതാകും, ഡ്രൈവിംഗ് ട്രിപ്പുകൾ ഓഫാക്കുമ്പോൾ ഉടൻ ഇല്ലാതാകും",
          "ഫോൺ നഷ്ടപ്പെട്ടു രേഖകൾ ആ മോഡ് അവസാനിക്കുമ്പോൾ, ഏതായാലും 12 മണിക്കൂറിന് ശേഷം ഇല്ലാതാകും",
          "SOS വോയ്‌സ് ക്ലിപ്പുകളും ഫോട്ടോകളും 7 ദിവസത്തിന് ശേഷം സ്വയം ഇല്ലാതാകും",
          "\"അടുത്തുള്ള സഹായം\" അഭ്യർത്ഥനകളും മറുപടികളും അവ ഉൾപ്പെടുന്ന SOS പരിഹരിച്ച് 30 ദിവസത്തിന് ശേഷം അതിനോടൊപ്പം ഇല്ലാതാകും",
          "സ്ഥലത്ത് എത്തുന്ന/പുറപ്പെടുന്ന അറിയിപ്പുകൾ, ബാറ്ററി, ഫോൺ-ഓഫ്‌ലൈൻ മുന്നറിയിപ്പുകൾ എന്നിവ നിങ്ങൾ അക്കൗണ്ട് ഇല്ലാതാക്കുന്നതുവരെ സൂക്ഷിക്കും, പിന്നീട് നീക്കം ചെയ്യും",
          "തെറ്റായ പാസ്‌വേഡ് റിപ്പോർട്ടുകൾ, അവയുടെ ഫോട്ടോ ഉൾപ്പെടെ, 7 ദിവസത്തിന് ശേഷം സ്വയമേവ ഇല്ലാതാകും",
        ],
      },
      choices: {
        title: 'നിങ്ങളുടെ തിരഞ്ഞെടുപ്പുകൾ',
        items: [
          'നിങ്ങളുടെ എല്ലാ ഡാറ്റയും കാണുക — അത് നിങ്ങളുടെ സ്വന്തം കുടുംബ ഗ്രൂപ്പിനുള്ളിൽ നിങ്ങൾക്ക് കാണാം',
          'ലൊക്കേഷൻ പങ്കിടൽ എപ്പോൾ വേണമെങ്കിലും പ്രൊഫൈൽ → സ്വകാര്യത യിൽ ഓഫ് ചെയ്യുക',
          'എപ്പോൾ വേണമെങ്കിലും കുടുംബ ഗ്രൂപ്പ് വിടുക',
'പ്രൊഫൈൽ-ൽ എപ്പോൾ വേണമെങ്കിലും "കുലുക്കിയാൽ SOS" ഓഫ് ചെയ്യുക',
          'പ്രൊഫൈൽ-ൽ എപ്പോൾ വേണമെങ്കിലും "ഇന്റർനെറ്റ് ഇല്ലാത്തപ്പോൾ SMS" ഓഫ് ചെയ്ത്, അധിക നമ്പർ നീക്കുക',
          'സന്ദേശ, കോൾ ചരിത്രം അതത് സ്ക്രീനുകളിൽ നിന്ന് മായ്ക്കുക',
          'നിങ്ങളുടെ അക്കൗണ്ടും അതിന്റെ ഡാറ്റയും പ്രൊഫൈൽ → എന്റെ അക്കൗണ്ട് ഇല്ലാതാക്കുക യിൽ നിന്ന്, അല്ലെങ്കിൽ ആപ്പ് ഇല്ലാതെ Famora വെബ്‌സൈറ്റിലെ "Delete Account" പേജിൽ നിന്ന് ഇല്ലാതാക്കുക',
          'ക്യാമറ, മൈക്രോഫോൺ, ലൊക്കേഷൻ, SMS അല്ലെങ്കിൽ അറിയിപ്പ് അനുമതി Android ക്രമീകരണങ്ങളിൽ പിൻവലിക്കുക',
          "Profile → ഡ്രൈവിംഗ് സുരക്ഷ ൽ എപ്പോൾ വേണമെങ്കിലും അമിതവേഗ മുന്നറിയിപ്പ്, ഡ്രൈവിംഗ് ട്രിപ്പുകൾ, അപകട കണ്ടെത്തൽ, കൂടാതെ Profile → Safety ൽ കാലാവസ്ഥാ മുന്നറിയിപ്പുകൾ ഓണോ ഓഫോ ആക്കാം",
          "Profile → Safety ൽ എപ്പോൾ വേണമെങ്കിലും \"ഫോൺ നഷ്ടപ്പെട്ടു അനുവദിക്കുക\" ഓണോ ഓഫോ ആക്കാം",
          "Profile → Safety ൽ എപ്പോൾ വേണമെങ്കിലും \"എന്റെ SOS-നൊപ്പം വോയ്‌സ് ക്ലിപ്പ്\" ഓണോ ഓഫോ ആക്കാം",
          "SOS പേജിൽ നിന്ന് എപ്പോൾ വേണമെങ്കിലും \"അടുത്തുള്ള സഹായ\"ത്തിൽ ചേരുകയോ ഒഴിവാകുകയോ ചെയ്യാം, നിങ്ങളുടെ ചരിത്രത്തിൽ നിന്ന് എൻട്രികൾ മറയ്ക്കാം",
          "Profile → സ്ഥലങ്ങൾ ൽ എപ്പോൾ വേണമെങ്കിലും സേവ് ചെയ്ത സ്ഥലം ഇല്ലാതാക്കാം",
          "തെറ്റായ പാസ്‌വേഡ് മുന്നറിയിപ്പും അതിന്റെ ഫോട്ടോ ഓപ്ഷനും എപ്പോൾ വേണമെങ്കിലും Profile → മോഷണ സംരക്ഷണം ൽ ഓണോ ഓഫോ ആക്കാം, ഇത് നിങ്ങളുടെ ഫോണിൽ നിന്ന് Famora യുടെ ഡിവൈസ്-അഡ്മിൻ അനുമതിയും നീക്കും",
        ],
      },
    },
  },
}

/**
 * The policy in `lang`, with the presentation merged back in.
 *
 * Falls back per field and per section rather than per language: a section the
 * translator has not reached still appears, in English. Dropping it would
 * remove a disclosure, which is the one thing this must never do.
 */
export function getPolicy(lang) {
  const t = CONTENT[lang] || CONTENT.en
  const en = CONTENT.en

  const sections = SECTION_META.map(meta => {
    const s = t.sections?.[meta.key] || en.sections[meta.key]
    return {
      key: meta.key,
      icon: meta.icon,
      color: meta.color,
      title: s.title,
      items: s.items,
    }
  })

  const field = k => (t[k] === undefined ? en[k] : t[k])

  return {
    lastUpdated: field('lastUpdated'),
    pageTitle: field('pageTitle'),
    consentTitle: field('consentTitle'),
    lastUpdatedLabel: field('lastUpdatedLabel'),
    promiseLead: field('promiseLead'),
    promiseStrong: field('promiseStrong'),
    promiseTail: field('promiseTail'),
    intro: field('intro'),
    consentNote: field('consentNote'),
    contactPrompt: field('contactPrompt'),
    contactPromptConsent: field('contactPromptConsent'),
    sections,
  }
}
