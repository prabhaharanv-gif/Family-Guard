# Famora hardening checklist

Written 2026-09-26 from a review of this codebase and the earlier security audits. Ordered by how much risk each item removes per hour spent. Tick items off as you go.

Legend: **[you]** needs your Supabase, Twilio, GitHub or Play login. **[code]** needs a change in this repo, which Claude can do when asked. **[both]** needs one then the other.

---

## Do this week

### 1. Prove the live database matches the repo **[you]**
The last two real holes (a nearby-user search and a debug function) existed because a migration in the repo never reached the database, or a new function was left open to every signed-in user.

- [ ] Run `docs/security-sweep.sql` in the Supabase SQL Editor. Expect A (tables without RLS) and B (open policies) empty, and C to list only `avatars`.
- [ ] Run `docs/migration-drift-check.sql`. Anything listed as in the repo but not live, or live but not in the repo, needs an answer.
- [ ] Check every recent definer function. New functions are executable by any signed-in user by default. This lists the ones that are:

```sql
select p.oid::regprocedure as fn
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('authenticated', p.oid, 'execute')
order by 1;
```

  Every name in the result must be a function the app calls on purpose. Anything internal (helpers, trigger functions, cron jobs) needs `revoke execute ... from public, anon, authenticated` and a grant to `service_role` only.
- [ ] Pay special attention to the features run by hand recently: place weather alerts, overspeed, trips, Phone lost, SOS voice and photo, battery and offline alerts.

### 2. Stop SMS and OTP abuse **[you] then [code]**
Sign-up is open and the OTP step is what proves a phone number, so this is the cheapest route into your budget and into fake accounts.

- [ ] **Twilio:** Console → Messaging → Settings → Geo permissions: allow India only.
- [ ] **Twilio:** set a usage alert and a spend cap (Billing → Usage triggers).
- [ ] **Supabase:** Authentication → Rate Limits. Lower the SMS-per-hour limit to something real families need, for example 5 to 10 per hour.
- [ ] **Supabase:** Authentication → Attack Protection → enable CAPTCHA (hCaptcha or Cloudflare Turnstile). This is not just a switch: the app must send a CAPTCHA token with sign-up, sign-in and OTP requests. Ask Claude to wire it in once you pick a provider.

### 3. Secrets in git history **[you]**
`log.txt` and `google-services.json` are no longer tracked, but four earlier commits contain them. `log.txt` is about 180,000 lines. The current copy has no keys or passwords, but the old ones weren't checked.

- [ ] Confirm the GitHub repo `prabhaharanv-gif/Family-Guard` is **private** (Settings → General → bottom of the page). If it is public, treat everything ever committed as leaked and rotate first.
- [ ] Search the old `log.txt` for tokens before deciding whether history needs rewriting:
  `git log -p --all -- log.txt | grep -iE "eyJ|sb_secret|sb_publishable|apikey|password" | head`
- [ ] The Firebase API key inside `google-services.json` is not secret, but restrict it in Google Cloud → Credentials to the package `com.scoopfamily.familyguard` and its SHA-1 fingerprints.

---

## Do this month

### 4. Revoke the five legacy RPCs **[you]**
`change_member_role`, `clear_family_messages`, `set_location_sharing`, `update_member_privacy`, `update_member_profile` are still callable for old test builds.

- [ ] Once everyone is on the current app, revoke `execute` from `authenticated` on those five, then recheck with the query in item 1.

### 5. Website headers **[code]**
`vercel.json` already sets `nosniff`, `X-Frame-Options`, a referrer policy and a permissions policy. It has no Content-Security-Policy, which is the main protection against injected script.

- [ ] Add a CSP in **report-only** mode first, allowing this app's own origin plus Supabase, Firebase, Agora, Google Maps and OpenStreetMap tiles. Watch the browser console for a week, then enforce it. A wrong CSP breaks calls and maps, so do not enforce it blind.
- [ ] Add `Strict-Transport-Security`.

### 6. Supabase Auth housekeeping **[you]**
- [ ] Set Authentication → URL Configuration → Site URL to the real production URL (it was still `http://localhost:3000`) and empty the redirect allow-list unless you use it.
- [ ] Decide on brute force: passwords are 6 characters by your choice, so guessing is the easy attack. Confirm Supabase's per-IP sign-in rate limit is on, and consider an app-side lockout after repeated wrong passwords. **[code]**
- [ ] Review each Edge Function's "Verify JWT" setting. Functions called by clients must verify. Functions called by database triggers rely on the service-key token check, so confirm that check is present.

### 7. Release signing hygiene **[you]**
- [ ] The real release keystore sits inside the project folder, next to two decoys with the same name. Move the real one outside the repo, back it up offline in two places, and delete the decoys so the wrong key can never sign a build.
- [ ] Losing that key means users cannot update the app. Keep the password in a password manager, not in a file in the folder.
- [ ] Give sideload APKs only to people you trust. They are signed with the real release key.

### 8. Dependencies **[code]**
`npm audit --omit=dev` shows 4 issues (1 high, 3 moderate). All come through `@capacitor/cli` (a build tool) and `@xmldom/xmldom`. None of them ships inside the app, so the risk is to your own build machine, not to users.

- [ ] Run `npm audit fix` and rebuild. Upgrade `@capacitor/cli` only in a separate, tested step because it is a major-version change.
- [ ] Run `npm audit` before every Play upload.

---

## Ongoing

- [ ] After every new SQL migration: run the item 1 query, and never trust "the migration is in the repo" as proof.
- [ ] Any new definer function gets an explicit revoke and grant in the same migration that creates it.
- [ ] Any new edge function that a trigger calls must check the service token, and its secrets belong in Vault or function secrets, never in a trigger or a file.
- [ ] Keep the service-role key out of the client, out of logs and out of chat.
- [ ] Turn on Supabase log alerts for repeated 401/403 spikes and for a sudden rise in OTP requests.
- [ ] Re-run the full audit (`docs/security-sweep.sql`) after each release, and before any large user-acquisition push.

## Deliberate choices, not to re-flag
- 6-character minimum password, with no leaked-password check, so PINs work.
- `is_family_member` and `is_family_admin` executable by anon, kept on purpose.
- About 56 signed-in-user RPCs are the app's API by design.
