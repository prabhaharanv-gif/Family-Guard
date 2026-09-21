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
    lastUpdated: '18 September 2026',
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
          'SOS alerts you send or receive, including location at that moment',
          'Call records: who called whom, time, duration and whether voice or video',
          'A device notification token, so alerts and calls can reach your phone',
          'Basic device details needed to deliver calls and alerts reliably',
          'Motion sensor readings, only while Shake for SOS is switched on — they are judged on your phone and never sent anywhere',
          'The extra phone number you enter for offline SMS alerts, if you use that feature',
          'Crash and diagnostic reports, if the app stops working — see below',
        ],
      },
      use: {
        title: 'How We Use It',
        items: [
          'Your location is visible only to members of your own family group',
          'Messages are visible only to members of that family group',
          'Notification tokens are used solely to deliver alerts, messages and calls',
          'Call and video content is never recorded or stored by us',
          'We do not read your messages, and we do not sell your data',
          'We do not use your data for advertising or profiling',
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
          'Resolved SOS alerts are deleted automatically after 30 days',
          'Location history is deleted automatically after 7 days',
          'Unused device notification tokens are removed after 60 days',
          'Deleting your account removes your data from these records',
          'Settings kept on your phone — fake call details, offline SMS numbers, nicknames — go when you uninstall the app',
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
        ],
      },
    },
  },

  // ────────────────────────────────────────────────────────────────── Tamil ──
  // See the NOT REVIEWED BY A LAWYER note at the top of this file.
  ta: {
    lastUpdated: '18 செப்டம்பர் 2026',
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
          'நீங்கள் அனுப்பும் அல்லது பெறும் SOS எச்சரிக்கைகள், அந்த நேரத்திய இருப்பிடம் உட்பட',
          'அழைப்புப் பதிவுகள்: யார் யாரை அழைத்தார்கள், நேரம், கால அளவு, மற்றும் அது குரல் அழைப்பா வீடியோ அழைப்பா என்பது',
          'எச்சரிக்கைகளும் அழைப்புகளும் உங்கள் தொலைபேசியை அடைவதற்கான ஒரு சாதன அறிவிப்பு டோக்கன்',
          'அழைப்புகளையும் எச்சரிக்கைகளையும் நம்பகமாக வழங்கத் தேவையான அடிப்படை சாதன விவரங்கள்',
'இயக்க உணரி அளவீடுகள், "குலுக்கினால் SOS" இயக்கத்தில் இருக்கும்போது மட்டும் — அவை உங்கள் கைபேசியிலேயே ஆராயப்படுகின்றன, எங்கும் அனுப்பப்படுவதில்லை',
          '"இணையம் இல்லாதபோது SMS" பயன்படுத்தினால், அதற்காக நீங்கள் உள்ளிடும் கூடுதல் தொலைபேசி எண்',
          'செயலி வேலை செய்யாமல் நின்றால், செயலிழப்பு மற்றும் கண்டறிதல் அறிக்கைகள் — கீழே காண்க',
        ],
      },
      use: {
        title: 'அதை நாங்கள் எப்படிப் பயன்படுத்துகிறோம்',
        items: [
          'உங்கள் இருப்பிடம் உங்கள் சொந்தக் குடும்பக் குழு உறுப்பினர்களுக்கு மட்டுமே தெரியும்',
          'செய்திகள் அந்தக் குடும்பக் குழு உறுப்பினர்களுக்கு மட்டுமே தெரியும்',
          'அறிவிப்பு டோக்கன்கள் எச்சரிக்கைகள், செய்திகள் மற்றும் அழைப்புகளை வழங்க மட்டுமே பயன்படுகின்றன',
          'அழைப்பு மற்றும் வீடியோ உள்ளடக்கம் எங்களால் ஒருபோதும் பதிவு செய்யப்படுவதோ சேமிக்கப்படுவதோ இல்லை',
          'உங்கள் செய்திகளை நாங்கள் படிப்பதில்லை, உங்கள் தரவை விற்பதுமில்லை',
          'விளம்பரத்திற்கோ சுயவிவரத் தொகுப்பிற்கோ உங்கள் தரவை நாங்கள் பயன்படுத்துவதில்லை',
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
          'முடிக்கப்பட்ட SOS எச்சரிக்கைகள் 30 நாட்களுக்குப் பிறகு தானாகவே நீக்கப்படும்',
          'இருப்பிட வரலாறு 7 நாட்களுக்குப் பிறகு தானாகவே நீக்கப்படும்',
          'பயன்படுத்தப்படாத சாதன அறிவிப்பு டோக்கன்கள் 60 நாட்களுக்குப் பிறகு அகற்றப்படும்',
          'உங்கள் கணக்கை நீக்கினால், இந்தப் பதிவுகளிலிருந்து உங்கள் தரவு அகற்றப்படும்',
'உங்கள் கைபேசியில் சேமிக்கப்படும் அமைப்புகள் — போலி அழைப்பு விவரங்கள், "இணையம் இல்லாதபோது SMS" எண்கள், செல்லப்பெயர்கள் — செயலியை நீக்கும்போது போய்விடும்',
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
        ],
      },
    },
  },

  // ────────────────────────────────────────────────────────────────── Hindi ──
  // See the NOT REVIEWED BY A LAWYER note at the top of this file.
  hi: {
    lastUpdated: '18 सितंबर 2026',
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
          'आपके भेजे या पाए गए SOS अलर्ट, उस समय की लोकेशन सहित',
          'कॉल रिकॉर्ड: किसने किसे कॉल किया, समय, अवधि और वह वॉइस थी या वीडियो',
          'डिवाइस का नोटिफ़िकेशन टोकन, ताकि अलर्ट और कॉल आपके फ़ोन तक पहुँच सकें',
          'कॉल और अलर्ट भरोसेमंद ढंग से पहुँचाने के लिए ज़रूरी बुनियादी डिवाइस जानकारी',
'मोशन सेंसर की रीडिंग, केवल तब जब "हिलाकर SOS" चालू हो — इन्हें आपके फ़ोन पर ही परखा जाता है, कहीं भेजा नहीं जाता',
          '"इंटरनेट न होने पर SMS" इस्तेमाल करने पर, उसके लिए आपका दिया हुआ अतिरिक्त फ़ोन नंबर',
          'ऐप के काम करना बंद कर देने पर क्रैश और डायग्नोस्टिक रिपोर्ट — नीचे देखें',
        ],
      },
      use: {
        title: 'हम इसका उपयोग कैसे करते हैं',
        items: [
          'आपकी लोकेशन केवल आपके अपने परिवार समूह के सदस्यों को दिखती है',
          'संदेश केवल उसी परिवार समूह के सदस्यों को दिखते हैं',
          'नोटिफ़िकेशन टोकन केवल अलर्ट, संदेश और कॉल पहुँचाने के लिए इस्तेमाल होते हैं',
          'कॉल और वीडियो की सामग्री हमारे द्वारा कभी रिकॉर्ड या संग्रहीत नहीं की जाती',
          'हम आपके संदेश नहीं पढ़ते, और हम आपका डेटा नहीं बेचते',
          'हम आपके डेटा का उपयोग विज्ञापन या प्रोफ़ाइलिंग के लिए नहीं करते',
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
          'सुलझे हुए SOS अलर्ट 30 दिनों बाद अपने आप हट जाते हैं',
          'लोकेशन इतिहास 7 दिनों बाद अपने आप हट जाता है',
          'उपयोग में न आने वाले डिवाइस नोटिफ़िकेशन टोकन 60 दिनों बाद हटा दिए जाते हैं',
          'खाता हटाने पर इन रिकॉर्ड से आपका डेटा हट जाता है',
'आपके फ़ोन पर रखी सेटिंग्स — नकली कॉल का विवरण, "इंटरनेट न होने पर SMS" के नंबर, उपनाम — ऐप अनइंस्टॉल करने पर चली जाती हैं',
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
        ],
      },
    },
  },

  // ───────────────────────────────────────────────────────────────── Telugu ──
  // See the NOT REVIEWED BY A LAWYER note at the top of this file.
  te: {
    lastUpdated: '18 సెప్టెంబర్ 2026',
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
          'మీరు పంపిన లేదా అందుకున్న SOS హెచ్చరికలు, ఆ సమయంలోని లొకేషన్‌తో సహా',
          'కాల్ రికార్డులు: ఎవరు ఎవరికి కాల్ చేశారు, సమయం, వ్యవధి, వాయిస్ లేదా వీడియో',
          'హెచ్చరికలు, కాల్‌లు మీ ఫోన్‌కు చేరడానికి పరికర నోటిఫికేషన్ టోకెన్',
          'కాల్‌లు, హెచ్చరికలు నమ్మకంగా అందించడానికి అవసరమైన ప్రాథమిక పరికర వివరాలు',
'మోషన్ సెన్సార్ రీడింగ్‌లు, "ఊపితే SOS" ఆన్‌లో ఉన్నప్పుడు మాత్రమే — అవి మీ ఫోన్‌లోనే పరిశీలించబడతాయి, ఎక్కడికీ పంపబడవు',
          '"ఇంటర్నెట్ లేనప్పుడు SMS" వాడితే, దాని కోసం మీరు ఇచ్చే అదనపు ఫోన్ నంబర్',
          'యాప్ పనిచేయడం ఆగిపోతే క్రాష్, డయాగ్నొస్టిక్ నివేదికలు — కింద చూడండి',
        ],
      },
      use: {
        title: 'మేము దీన్ని ఎలా ఉపయోగిస్తాము',
        items: [
          'మీ లొకేషన్ మీ సొంత కుటుంబ గ్రూప్ సభ్యులకు మాత్రమే కనిపిస్తుంది',
          'సందేశాలు ఆ కుటుంబ గ్రూప్ సభ్యులకు మాత్రమే కనిపిస్తాయి',
          'నోటిఫికేషన్ టోకెన్‌లు హెచ్చరికలు, సందేశాలు, కాల్‌లు అందించడానికే వాడతారు',
          'కాల్, వీడియో కంటెంట్‌ను మేము ఎప్పుడూ రికార్డ్ చేయము లేదా నిల్వ చేయము',
          'మేము మీ సందేశాలను చదవము, మీ డేటాను అమ్మము',
          'ప్రకటనలు లేదా ప్రొఫైలింగ్ కోసం మీ డేటాను మేము ఉపయోగించము',
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
          'పరిష్కరించిన SOS హెచ్చరికలు 30 రోజుల తర్వాత స్వయంచాలకంగా తొలగించబడతాయి',
          'లొకేషన్ చరిత్ర 7 రోజుల తర్వాత స్వయంచాలకంగా తొలగించబడుతుంది',
          'ఉపయోగించని పరికర నోటిఫికేషన్ టోకెన్‌లు 60 రోజుల తర్వాత తీసివేయబడతాయి',
          'మీ ఖాతాను తొలగిస్తే ఈ రికార్డుల నుండి మీ డేటా తీసివేయబడుతుంది',
'మీ ఫోన్‌లో ఉంచిన సెట్టింగ్‌లు — నకిలీ కాల్ వివరాలు, "ఇంటర్నెట్ లేనప్పుడు SMS" నంబర్లు, ముద్దుపేర్లు — యాప్‌ను అన్‌ఇన్‌స్టాల్ చేసినప్పుడు పోతాయి',
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
        ],
      },
    },
  },

  // ──────────────────────────────────────────────────────────────── Kannada ──
  // See the NOT REVIEWED BY A LAWYER note at the top of this file.
  kn: {
    lastUpdated: '18 ಸೆಪ್ಟೆಂಬರ್ 2026',
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
          'ನೀವು ಕಳುಹಿಸಿದ ಅಥವಾ ಸ್ವೀಕರಿಸಿದ SOS ಎಚ್ಚರಿಕೆಗಳು, ಆ ಕ್ಷಣದ ಸ್ಥಳ ಸೇರಿದಂತೆ',
          'ಕರೆ ದಾಖಲೆಗಳು: ಯಾರು ಯಾರಿಗೆ ಕರೆ ಮಾಡಿದರು, ಸಮಯ, ಅವಧಿ ಮತ್ತು ಧ್ವನಿಯೋ ವೀಡಿಯೊವೋ',
          'ಎಚ್ಚರಿಕೆಗಳು ಮತ್ತು ಕರೆಗಳು ನಿಮ್ಮ ಫೋನ್ ತಲುಪಲು ಸಾಧನ ಅಧಿಸೂಚನೆ ಟೋಕನ್',
          'ಕರೆಗಳು ಮತ್ತು ಎಚ್ಚರಿಕೆಗಳನ್ನು ವಿಶ್ವಾಸಾರ್ಹವಾಗಿ ತಲುಪಿಸಲು ಬೇಕಾದ ಮೂಲಭೂತ ಸಾಧನ ವಿವರಗಳು',
'ಚಲನೆ ಸಂವೇದಕದ ಓದುವಿಕೆಗಳು, "ಅಲುಗಾಡಿಸಿದರೆ SOS" ಆನ್ ಇರುವಾಗ ಮಾತ್ರ — ಅವು ನಿಮ್ಮ ಫೋನಿನಲ್ಲೇ ಪರಿಶೀಲಿಸಲ್ಪಡುತ್ತವೆ, ಎಲ್ಲಿಗೂ ಕಳುಹಿಸಲ್ಪಡುವುದಿಲ್ಲ',
          '"ಇಂಟರ್ನೆಟ್ ಇಲ್ಲದಾಗ SMS" ಬಳಸಿದರೆ, ಅದಕ್ಕಾಗಿ ನೀವು ನಮೂದಿಸುವ ಹೆಚ್ಚುವರಿ ಫೋನ್ ಸಂಖ್ಯೆ',
          'ಅಪ್ಲಿಕೇಶನ್ ಕೆಲಸ ಮಾಡುವುದನ್ನು ನಿಲ್ಲಿಸಿದರೆ ಕ್ರ್ಯಾಶ್ ಮತ್ತು ರೋಗನಿರ್ಣಯ ವರದಿಗಳು — ಕೆಳಗೆ ನೋಡಿ',
        ],
      },
      use: {
        title: 'ನಾವು ಇದನ್ನು ಹೇಗೆ ಬಳಸುತ್ತೇವೆ',
        items: [
          'ನಿಮ್ಮ ಸ್ಥಳ ನಿಮ್ಮ ಸ್ವಂತ ಕುಟುಂಬ ಗುಂಪಿನ ಸದಸ್ಯರಿಗೆ ಮಾತ್ರ ಕಾಣಿಸುತ್ತದೆ',
          'ಸಂದೇಶಗಳು ಆ ಕುಟುಂಬ ಗುಂಪಿನ ಸದಸ್ಯರಿಗೆ ಮಾತ್ರ ಕಾಣಿಸುತ್ತವೆ',
          'ಅಧಿಸೂಚನೆ ಟೋಕನ್‌ಗಳನ್ನು ಎಚ್ಚರಿಕೆ, ಸಂದೇಶ ಮತ್ತು ಕರೆ ತಲುಪಿಸಲು ಮಾತ್ರ ಬಳಸಲಾಗುತ್ತದೆ',
          'ಕರೆ ಮತ್ತು ವೀಡಿಯೊ ವಿಷಯವನ್ನು ನಾವು ಎಂದಿಗೂ ರೆಕಾರ್ಡ್ ಅಥವಾ ಸಂಗ್ರಹಿಸುವುದಿಲ್ಲ',
          'ನಾವು ನಿಮ್ಮ ಸಂದೇಶಗಳನ್ನು ಓದುವುದಿಲ್ಲ, ನಿಮ್ಮ ಡೇಟಾವನ್ನು ಮಾರುವುದಿಲ್ಲ',
          'ಜಾಹೀರಾತು ಅಥವಾ ಪ್ರೊಫೈಲಿಂಗ್‌ಗೆ ನಿಮ್ಮ ಡೇಟಾವನ್ನು ನಾವು ಬಳಸುವುದಿಲ್ಲ',
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
          'ಪರಿಹರಿಸಿದ SOS ಎಚ್ಚರಿಕೆಗಳು 30 ದಿನಗಳ ನಂತರ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಅಳಿಸಲ್ಪಡುತ್ತವೆ',
          'ಸ್ಥಳ ಇತಿಹಾಸ 7 ದಿನಗಳ ನಂತರ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಅಳಿಸಲ್ಪಡುತ್ತದೆ',
          'ಬಳಕೆಯಾಗದ ಸಾಧನ ಅಧಿಸೂಚನೆ ಟೋಕನ್‌ಗಳನ್ನು 60 ದಿನಗಳ ನಂತರ ತೆಗೆದುಹಾಕಲಾಗುತ್ತದೆ',
          'ನಿಮ್ಮ ಖಾತೆಯನ್ನು ಅಳಿಸಿದರೆ ಈ ದಾಖಲೆಗಳಿಂದ ನಿಮ್ಮ ಡೇಟಾ ತೆಗೆದುಹಾಕಲ್ಪಡುತ್ತದೆ',
'ನಿಮ್ಮ ಫೋನಿನಲ್ಲಿ ಉಳಿಯುವ ಸೆಟ್ಟಿಂಗ್‌ಗಳು — ನಕಲಿ ಕರೆ ವಿವರಗಳು, "ಇಂಟರ್ನೆಟ್ ಇಲ್ಲದಾಗ SMS" ಸಂಖ್ಯೆಗಳು, ಅಡ್ಡಹೆಸರುಗಳು — ಆ್ಯಪ್ ಅನ್‌ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಿದಾಗ ಹೋಗುತ್ತವೆ',
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
        ],
      },
    },
  },

  // ────────────────────────────────────────────────────────────── Malayalam ──
  // See the NOT REVIEWED BY A LAWYER note at the top of this file.
  ml: {
    lastUpdated: '2026 സെപ്റ്റംബർ 18',
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
          'നിങ്ങൾ അയച്ചതോ ലഭിച്ചതോ ആയ SOS മുന്നറിയിപ്പുകൾ, ആ സമയത്തെ ലൊക്കേഷൻ ഉൾപ്പെടെ',
          'കോൾ രേഖകൾ: ആര് ആരെ വിളിച്ചു, സമയം, ദൈർഘ്യം, വോയ്‌സാണോ വീഡിയോയാണോ',
          'മുന്നറിയിപ്പുകളും കോളുകളും നിങ്ങളുടെ ഫോണിൽ എത്താൻ ഒരു ഉപകരണ അറിയിപ്പ് ടോക്കൺ',
          'കോളുകളും മുന്നറിയിപ്പുകളും വിശ്വസനീയമായി എത്തിക്കാൻ വേണ്ട അടിസ്ഥാന ഉപകരണ വിവരങ്ങൾ',
'മോഷൻ സെൻസർ റീഡിംഗുകൾ, "കുലുക്കിയാൽ SOS" ഓണായിരിക്കുമ്പോൾ മാത്രം — അവ നിങ്ങളുടെ ഫോണിൽത്തന്നെ പരിശോധിക്കപ്പെടുന്നു, എങ്ങോട്ടും അയക്കുന്നില്ല',
          '"ഇന്റർനെറ്റ് ഇല്ലാത്തപ്പോൾ SMS" ഉപയോഗിക്കുന്നെങ്കിൽ, അതിനായി നിങ്ങൾ നൽകുന്ന അധിക ഫോൺ നമ്പർ',
          'ആപ്പ് പ്രവർത്തിക്കാതായാൽ ക്രാഷ്, ഡയഗ്നോസ്റ്റിക് റിപ്പോർട്ടുകൾ — താഴെ കാണുക',
        ],
      },
      use: {
        title: 'ഞങ്ങൾ ഇത് എങ്ങനെ ഉപയോഗിക്കുന്നു',
        items: [
          'നിങ്ങളുടെ ലൊക്കേഷൻ നിങ്ങളുടെ സ്വന്തം കുടുംബ ഗ്രൂപ്പിലെ അംഗങ്ങൾക്ക് മാത്രമേ കാണാനാകൂ',
          'സന്ദേശങ്ങൾ ആ കുടുംബ ഗ്രൂപ്പിലെ അംഗങ്ങൾക്ക് മാത്രമേ കാണാനാകൂ',
          'അറിയിപ്പ് ടോക്കണുകൾ മുന്നറിയിപ്പുകളും സന്ദേശങ്ങളും കോളുകളും എത്തിക്കാൻ മാത്രമാണ് ഉപയോഗിക്കുന്നത്',
          'കോൾ, വീഡിയോ ഉള്ളടക്കം ഞങ്ങൾ ഒരിക്കലും റെക്കോർഡ് ചെയ്യുകയോ സൂക്ഷിക്കുകയോ ചെയ്യുന്നില്ല',
          'ഞങ്ങൾ നിങ്ങളുടെ സന്ദേശങ്ങൾ വായിക്കുന്നില്ല, നിങ്ങളുടെ ഡാറ്റ വിൽക്കുന്നുമില്ല',
          'പരസ്യത്തിനോ പ്രൊഫൈലിംഗിനോ നിങ്ങളുടെ ഡാറ്റ ഞങ്ങൾ ഉപയോഗിക്കുന്നില്ല',
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
          'പരിഹരിച്ച SOS മുന്നറിയിപ്പുകൾ 30 ദിവസത്തിന് ശേഷം സ്വയമേവ ഇല്ലാതാകുന്നു',
          'ലൊക്കേഷൻ ചരിത്രം 7 ദിവസത്തിന് ശേഷം സ്വയമേവ ഇല്ലാതാകുന്നു',
          'ഉപയോഗിക്കാത്ത ഉപകരണ അറിയിപ്പ് ടോക്കണുകൾ 60 ദിവസത്തിന് ശേഷം നീക്കം ചെയ്യുന്നു',
          'നിങ്ങളുടെ അക്കൗണ്ട് ഇല്ലാതാക്കിയാൽ ഈ രേഖകളിൽ നിന്ന് നിങ്ങളുടെ ഡാറ്റ നീക്കം ചെയ്യപ്പെടും',
'ഫോണിൽ സൂക്ഷിക്കുന്ന ക്രമീകരണങ്ങൾ — വ്യാജ കോൾ വിവരങ്ങൾ, "ഇന്റർനെറ്റ് ഇല്ലാത്തപ്പോൾ SMS" നമ്പറുകൾ, വിളിപ്പേരുകൾ — ആപ്പ് അൺഇൻസ്റ്റാൾ ചെയ്യുമ്പോൾ പോകും',
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
