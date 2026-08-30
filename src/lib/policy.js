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
 * ── Translations ──────────────────────────────────────────────────────────
 * NOT REVIEWED BY A LAWYER. The Tamil below was produced alongside the UI
 * translation, not by a qualified legal translator. It is a faithful rendering
 * of the English, which remains the authoritative version — but before relying
 * on it for a compliance obligation, have someone qualified read it.
 *
 * Structure mirrors i18n/manual.js: presentation (icon, colour, order) is
 * defined once in SECTION_META, and only text is per-language. A missing
 * translation therefore falls back to the English sentence rather than dropping
 * a disclosure, which is the one failure mode a policy must not have.
 */

// Order and presentation, shared by every language.
export const SECTION_META = [
  { key: 'collect',   icon: '📋',  color: '#4F46E5' },
  { key: 'use',       icon: '🔒',  color: '#059669' },
  { key: 'calls',     icon: '📞',  color: '#B01650' },
  { key: 'crash',     icon: '🐞',  color: '#DC2626' },
  { key: 'providers', icon: '🤝',  color: '#0EA5E9' },
  { key: 'protect',   icon: '🛡️', color: '#7C3AED' },
  { key: 'retention', icon: '🗑️', color: '#D97706' },
  { key: 'choices',   icon: '✅',  color: '#16A34A' },
]

export const CONTACT_EMAIL = 'info@scoopinnovations.in'

const CONTENT = {
  // ──────────────────────────────────────────────────────────────── English ──
  en: {
    lastUpdated: '30 August 2026',
    pageTitle: 'Privacy Policy',
    consentTitle: 'Privacy Policy & Terms of Use',
    lastUpdatedLabel: 'Last updated',
    promiseLead: 'Famora is built on a simple promise:',
    promiseStrong: 'your data belongs to you and your family — nobody else.',
    promiseTail: 'We collect only what is necessary to keep your family safe and connected.',
    intro:
      'Famora helps families stay connected and reach each other quickly in an ' +
      'emergency. It shares your location, messages and calls only with the family ' +
      'group you choose to join. This page explains exactly what is collected, why, ' +
      'who it is shared with, and how long it is kept.',
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
          'Messages you send within your family group',
          'SOS alerts you send or receive, including location at that moment',
          'Call records: who called whom, time, duration and whether voice or video',
          'A device notification token, so alerts and calls can reach your phone',
          'Basic device details needed to deliver calls and alerts reliably',
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
          'Your data is not sold, and is not shared with anyone outside these providers and your own family group',
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
        ],
      },
      choices: {
        title: 'Your Choices',
        items: [
          'View all your data — it is visible to you inside your own family group',
          'Turn location sharing off at any time in Profile → Privacy',
          'Leave a family group at any time',
          'Clear message and call history from their respective screens',
          'Delete your account and its data from Profile → Delete My Account',
          'Withdraw camera, microphone, location or notification access in Android settings',
        ],
      },
    },
  },

  // ────────────────────────────────────────────────────────────────── Tamil ──
  // See the NOT REVIEWED BY A LAWYER note at the top of this file.
  ta: {
    lastUpdated: '30 ஆகஸ்ட் 2026',
    pageTitle: 'தனியுரிமைக் கொள்கை',
    consentTitle: 'தனியுரிமைக் கொள்கை & பயன்பாட்டு விதிமுறைகள்',
    lastUpdatedLabel: 'கடைசியாகப் புதுப்பிக்கப்பட்டது',
    promiseLead: 'Famora ஒரு எளிய உறுதிமொழியின் மீது கட்டப்பட்டுள்ளது:',
    promiseStrong: 'உங்கள் தரவு உங்களுக்கும் உங்கள் குடும்பத்திற்கும் மட்டுமே சொந்தம் — வேறு யாருக்கும் அல்ல.',
    promiseTail: 'உங்கள் குடும்பத்தைப் பாதுகாப்பாகவும் இணைந்தும் வைத்திருக்கத் தேவையானதை மட்டுமே நாங்கள் சேகரிக்கிறோம்.',
    intro:
      'Famora குடும்பங்கள் இணைந்திருக்கவும், அவசர நேரத்தில் ஒருவரை ஒருவர் விரைவாக ' +
      'அடையவும் உதவுகிறது. நீங்கள் இணையத் தேர்ந்தெடுக்கும் குடும்பக் குழுவுடன் மட்டுமே ' +
      'உங்கள் இருப்பிடம், செய்திகள் மற்றும் அழைப்புகள் பகிரப்படுகின்றன. என்ன ' +
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
          'உங்கள் குடும்பக் குழுவினுள் நீங்கள் அனுப்பும் செய்திகள்',
          'நீங்கள் அனுப்பும் அல்லது பெறும் SOS எச்சரிக்கைகள், அந்த நேரத்திய இருப்பிடம் உட்பட',
          'அழைப்புப் பதிவுகள்: யார் யாரை அழைத்தார்கள், நேரம், கால அளவு, மற்றும் அது குரல் அழைப்பா வீடியோ அழைப்பா என்பது',
          'எச்சரிக்கைகளும் அழைப்புகளும் உங்கள் தொலைபேசியை அடைவதற்கான ஒரு சாதன அறிவிப்பு டோக்கன்',
          'அழைப்புகளையும் எச்சரிக்கைகளையும் நம்பகமாக வழங்கத் தேவையான அடிப்படை சாதன விவரங்கள்',
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
          'இந்த வழங்குநர்கள் சேவையை இயக்குவதற்காக மட்டுமே தரவைக் கையாள்கிறார்கள், தங்கள் சொந்த நோக்கங்களுக்காக ஒருபோதும் அல்ல',
          'உங்கள் தரவு விற்கப்படுவதில்லை; இந்த வழங்குநர்கள் மற்றும் உங்கள் சொந்தக் குடும்பக் குழுவைத் தவிர வேறு யாருடனும் பகிரப்படுவதில்லை',
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
        ],
      },
      choices: {
        title: 'உங்கள் தேர்வுகள்',
        items: [
          'உங்கள் தரவு அனைத்தையும் பார்க்கலாம் — அது உங்கள் சொந்தக் குடும்பக் குழுவினுள் உங்களுக்குத் தெரியும்',
          'எப்போது வேண்டுமானாலும் "சுயவிவரம்" → "தனியுரிமை"-யில் இருப்பிடப் பகிர்வை நிறுத்தலாம்',
          'எப்போது வேண்டுமானாலும் ஒரு குடும்பக் குழுவிலிருந்து விலகலாம்',
          'செய்தி மற்றும் அழைப்பு வரலாற்றை அந்தந்தத் திரைகளிலிருந்து நீக்கலாம்',
          '"சுயவிவரம்" → "என் கணக்கை நீக்கு" மூலம் உங்கள் கணக்கையும் அதன் தரவையும் நீக்கலாம்',
          'Android அமைப்புகளில் கேமரா, ஒலிவாங்கி, இருப்பிடம் அல்லது அறிவிப்பு அனுமதிகளைத் திரும்பப் பெறலாம்',
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
    contactEmail: CONTACT_EMAIL,
    sections,
  }
}
