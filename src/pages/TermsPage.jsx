import { Link } from 'react-router-dom'
import PublicPage, { PublicCard } from '../components/PublicPage'
import { CONTACT_EMAIL } from '../lib/siteConfig'

/**
 * Terms of Use.
 *
 * Plain-language terms that only restate what the app and the Privacy Policy
 * already do. It deliberately makes no promise the product does not keep, and
 * it carries no jurisdiction, liability cap or legal-entity clause: those need
 * a lawyer and the company's real details, not a guess. English only for now;
 * the Privacy Policy is the document that is translated into all six languages.
 *
 * Bump LAST_UPDATED whenever the wording changes.
 */
const LAST_UPDATED = '3 October 2026'

export default function TermsPage() {
  return (
    <PublicPage title="Terms of Use" subtitle={`Last updated: ${LAST_UPDATED}`}>
      <PublicCard>
        By creating a Kinest account or using the app you agree to these terms.
        If you do not agree, please do not use Kinest. How we handle your
        information is explained in the{' '}
        <Link to="/privacy" style={{ color: 'var(--maroon)', fontWeight: 700 }}>Privacy Policy</Link>.
      </PublicCard>

      <PublicCard title="What Kinest is">
        Kinest is a private app that helps a family stay in touch and look out for each
        other: sharing location, sending SOS alerts, chatting and calling. It works
        inside family groups that you create or are invited to.
      </PublicCard>

      <PublicCard title="Who can use it">
        Kinest is not designed for children and is not directed at them. Use it only if
        you are old enough to accept these terms yourself. A parent or guardian is
        responsible for any account they set up for someone else.
      </PublicCard>

      <PublicCard title="Your account">
        You sign up with your mobile number and confirm it with a one-time code. Keep
        your password or PIN to yourself. You are responsible for what happens on your
        account, so tell us if you think someone else has got into it.
      </PublicCard>

      <PublicCard title="Family groups and sharing">
        Use Kinest only with people who know about it and agree to it. Do not use it to
        follow, monitor or pressure anyone who has not agreed. A person joins a family
        group only after an admin approves them, and every member can switch off what
        they share (location, online status and last seen) in the app.
      </PublicCard>

      <PublicCard title="Using Kinest properly">
        Please do not misuse the app. That includes sending false SOS alerts, harassing
        or threatening anyone, sharing content that is illegal, trying to break or bypass
        the app&rsquo;s security, or using another person&rsquo;s information without their
        permission.
      </PublicCard>

      <PublicCard title="Safety features are not emergency services">
        SOS alerts, location sharing, arrival alerts and the other safety features help
        your family stay in touch. They depend on your phone, its battery, its settings
        and permissions, and on a network connection, so we cannot promise that every alert
        or location update will arrive. Kinest does not replace the emergency services.
        <strong> In an emergency, call 112.</strong>
      </PublicCard>

      <PublicCard title="Your messages and photos">
        What you send stays yours. By sending it you let us store it and deliver it to the
        people you send it to in your family group, which is what the app is for. We do
        not sell your information or use it for advertising. Location history is deleted
        after 7 days and messages after 90 days.
      </PublicCard>

      <PublicCard title="Changes and availability">
        We may improve, change or remove features, and the app may sometimes be
        unavailable. We may update these terms; the date at the top shows when they last
        changed.
      </PublicCard>

      <PublicCard title="Ending your use of Kinest">
        You can stop using Kinest at any time and delete your account and data from the
        app, or on the{' '}
        <Link to="/delete-account" style={{ color: 'var(--maroon)', fontWeight: 700 }}>Delete Account</Link>{' '}
        page. We may suspend an account that breaks these terms or puts other people at risk.
      </PublicCard>

      <PublicCard title="Questions">
        Write to us at{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--maroon)', fontWeight: 700 }}>{CONTACT_EMAIL}</a>{' '}
        or see the <Link to="/contact" style={{ color: 'var(--maroon)', fontWeight: 700 }}>Contact</Link> page.
      </PublicCard>
    </PublicPage>
  )
}
