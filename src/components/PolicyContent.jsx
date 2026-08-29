/**
 * PolicyContent
 *
 * Condensed privacy policy content reused inside ConsentGate's
 * "Read Full Policy" view. Stateless display component.
 *
 * Extracted from App.jsx.
 */

const LAST_UPDATED = '30 August 2026'

// Every retention period below is stated to match the scheduled cleanup jobs
// that actually run on the database, rather than an aspirational figure:
//   messages 90d · resolved SOS 30d · location history 7d · device tokens 60d
const SECTIONS = [
  {
    icon: '📋', title: 'Information We Collect', color: '#4F46E5',
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
  {
    icon: '🔒', title: 'How We Use It', color: '#059669',
    items: [
      'Your location is visible only to members of your own family group',
      'Messages are visible only to members of that family group',
      'Notification tokens are used solely to deliver alerts, messages and calls',
      'Call and video content is never recorded or stored by us',
      'We do not read your messages, and we do not sell your data',
      'We do not use your data for advertising or profiling',
    ],
  },
  {
    icon: '📞', title: 'Voice and Video Calls', color: '#B01650',
    items: [
      'Calls run over the internet between family members, not the phone network',
      'Audio and video are carried by Agora, our calling provider, and are not recorded',
      'Only call records are stored — never the conversation itself',
      'Microphone is used during a call; camera only during a video call',
      'Any family member can clear the call history for the family',
    ],
  },
  {
    icon: '🐞', title: 'Crash and Diagnostic Reports', color: '#DC2626',
    items: [
      'When the app crashes or stops responding, a report is sent to Firebase Crashlytics so the fault can be found and fixed',
      'A report contains the technical fault, your device model and Android version, and an anonymous account identifier',
      'It does not contain your location, your messages, your name or your phone number',
      'Nothing is collected until you accept this policy, and reports are never used for advertising or profiling',
    ],
  },
  {
    icon: '🤝', title: 'Who Else Is Involved', color: '#0EA5E9',
    items: [
      'Supabase — hosts the database and handles sign-in',
      'Google Firebase — delivers push notifications, and receives crash reports via Crashlytics',
      'Agora — carries live call audio and video',
      'These providers process data only to run the service, never for their own purposes',
    ],
  },
  {
    icon: '🛡️', title: 'How We Protect It', color: '#7C3AED',
    items: [
      'Data is held on SOC 2 compliant Supabase infrastructure',
      'Row Level Security restricts every table to the people entitled to see it',
      'All requests require an authenticated session',
      'Calls are authorised per call with short-lived, server-issued tokens',
    ],
  },
  {
    icon: '🗑️', title: 'How Long We Keep It', color: '#D97706',
    items: [
      'Messages are deleted automatically after 90 days',
      'Resolved SOS alerts are deleted automatically after 30 days',
      'Location history is deleted automatically after 7 days',
      'Unused device notification tokens are removed after 60 days',
      'Deleting your account removes your data from these records',
    ],
  },
  {
    icon: '✅', title: 'Your Choices', color: '#16A34A',
    items: [
      'Turn location sharing off at any time in Profile → Privacy',
      'Leave a family group at any time',
      'Clear message and call history from their respective screens',
      'Delete your account and its data from Profile → Delete My Account',
      'Withdraw camera, microphone, location or notification access in Android settings',
    ],
  },
]

export default function PolicyContent() {
  return (
    <div>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '14px 16px',
        marginBottom: 10, border: '1px solid #F0EAF5',
      }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#0D0C1D', marginBottom: 6 }}>
          Privacy Policy &amp; Terms of Use
        </div>
        <div style={{ fontSize: 12, color: '#9C6B7A', marginBottom: 10 }}>
          Last updated {LAST_UPDATED}
        </div>
        <div style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.55 }}>
          Famora helps families stay connected and reach each other quickly in an
          emergency. It shares your location, messages and calls only with the family
          group you choose to join. This page explains exactly what is collected, why,
          who it is shared with, and how long it is kept.
        </div>
      </div>

      {SECTIONS.map(s => (
        <div key={s.title} style={{
          background: '#fff', borderRadius: 16, padding: '14px 16px',
          marginBottom: 10, border: '1px solid #F0EAF5',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>{s.icon}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#0D0C1D' }}>{s.title}</span>
          </div>
          {s.items.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: s.color, marginTop: 6, flexShrink: 0,
              }} />
              <div style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.5 }}>{item}</div>
            </div>
          ))}
        </div>
      ))}
      <div style={{
        background: '#fff', borderRadius: 16, padding: '14px 16px',
        textAlign: 'center', border: '1px solid #F0EAF5',
      }}>
        <div style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.55 }}>
          By continuing you confirm you have read and accept this policy, and that you
          have the right to share the location of any account you set up on someone
          else's behalf.
        </div>
        <div style={{ fontSize: 13, color: '#6B7280', marginTop: 10 }}>
          Questions or a data request?{' '}
          <a href="mailto:info@scoopinnovations.in" style={{ color: '#951345', fontWeight: 700 }}>
            info@scoopinnovations.in
          </a>
        </div>
      </div>
    </div>
  )
}
