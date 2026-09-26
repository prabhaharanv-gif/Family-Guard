/**
 * captcha.js
 *
 * Cloudflare Turnstile tokens for Supabase Auth's CAPTCHA protection.
 *
 * Supabase applies its CAPTCHA switch to EVERY sign-in and OTP call, not just
 * sign-up, so every such call in the app passes a token through withCaptcha().
 * Each token is single use, so every call asks for a fresh one.
 *
 * Off until VITE_TURNSTILE_SITE_KEY is set at build time: with no key,
 * withCaptcha() hands the options back untouched and no script is loaded. That
 * lets this ship before CAPTCHA is switched on in Supabase, and lets the
 * switch go on later without another release.
 *
 * Fails open on the client, deliberately. If the widget cannot load or times
 * out, no token is sent, and it is Supabase that then refuses the request when
 * CAPTCHA is enforced. The client is not the place a security check can live.
 *
 * The widget is invisible unless Cloudflare wants proof of a human
 * (appearance 'interaction-only'), in which case a small box is shown over the
 * page just long enough to solve it.
 */

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** Give up on a token after this long when nothing needs the person. */
const SILENT_TIMEOUT_MS = 15_000
/** ...and after this long once a challenge is on screen. */
const INTERACTIVE_TIMEOUT_MS = 90_000

export const captchaEnabled = () => !!SITE_KEY

let scriptPromise = null

function loadScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.turnstile) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SCRIPT_URL
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => { scriptPromise = null; reject(new Error('captcha script failed to load')) }
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

/** A fresh single-use token, or undefined when CAPTCHA is off or could not run. */
export async function getCaptchaToken() {
  if (!SITE_KEY) return undefined
  try { await loadScript() } catch { return undefined }

  return new Promise(resolve => {
    const box = document.createElement('div')
    box.setAttribute('data-captcha-box', '')
    Object.assign(box.style, {
      position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
      zIndex: '100000', display: 'none', background: '#fff', padding: '12px',
      borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    })
    document.body.appendChild(box)

    let widgetId = null
    let timer = null
    let done = false
    const finish = token => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { if (widgetId != null) window.turnstile.remove(widgetId) } catch { /* already gone */ }
      box.remove()
      resolve(token || undefined)
    }
    const arm = ms => { clearTimeout(timer); timer = setTimeout(() => finish(undefined), ms) }
    arm(SILENT_TIMEOUT_MS)

    try {
      widgetId = window.turnstile.render(box, {
        sitekey: SITE_KEY,
        appearance: 'interaction-only',
        theme: 'light',
        callback: token => finish(token),
        'error-callback': () => { finish(undefined); return true },
        'expired-callback': () => finish(undefined),
        'timeout-callback': () => finish(undefined),
        'before-interactive-callback': () => { box.style.display = 'block'; arm(INTERACTIVE_TIMEOUT_MS) },
        'after-interactive-callback': () => { box.style.display = 'none' },
      })
    } catch {
      finish(undefined)
    }
  })
}

/**
 * The `options` argument for a supabase.auth call, with a captcha token added
 * when CAPTCHA is on: signInWithOtp({ phone, options: await withCaptcha() }).
 * Pass the call's own options (e.g. { shouldCreateUser: false }) to keep them.
 */
export async function withCaptcha(options = {}) {
  const captchaToken = await getCaptchaToken()
  return captchaToken ? { ...options, captchaToken } : options
}
