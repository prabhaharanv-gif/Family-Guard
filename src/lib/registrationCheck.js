import { getCaptchaToken } from './captcha'

/**
 * Asks the check-registration function whether a mobile number already has an
 * account, before an SMS code is sent.
 *
 * Returns true (registered), false (free) or null (could not tell).
 *
 * null is deliberate and NOT an error: this is a courtesy that saves the person
 * a wasted SMS and a confusing wait. The real guarantee is
 * registration_number_taken, which runs after the code is verified, so when
 * this cannot answer (no CAPTCHA token, function not deployed, no network)
 * registration simply carries on to the SMS step and is caught there.
 *
 * getToken is a parameter only so the tests can supply one.
 */
export async function isNumberRegistered(supabase, digits, getToken = getCaptchaToken) {
  try {
    const captchaToken = await getToken()
    if (!captchaToken) return null
    const { data, error } = await supabase.functions.invoke('check-registration', {
      body: { phone: digits, captchaToken },
    })
    if (error) return null
    if (data?.registered === true) return true
    if (data?.registered === false) return false
    return null
  } catch {
    return null
  }
}
