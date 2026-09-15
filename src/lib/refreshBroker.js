/**
 * Routes supabase-js token refreshes through the native TokenBroker.
 *
 * Why. A Supabase refresh token is single-use, and presenting a spent one makes
 * the server revoke the whole session. The WebView and the native location/SOS
 * code both hold the token. Splitting ownership by foreground/background did not
 * hold, because supabase-js renews from inside getSession() — and the Realtime
 * heartbeat calls getSession() every ~25s even with the app backgrounded. So
 * both sides kept redeeming the same token, and users were signed out at no
 * moment they could point to.
 *
 * Passing every refresh through one native lock ends that: the broker redeems
 * one token at a time and answers a stale token with the session that replaced
 * it. See android/.../RefreshPlan.java.
 *
 * Failure handling keeps supabase-js's own rules intact:
 *   · the broker's HTTP status and body are returned as a real Response, so a
 *     dead token is still treated as dead and a 5xx is still retryable;
 *   · a broker that cannot be reached throws, which supabase-js treats as a
 *     network error and keeps the session;
 *   · a native build without the method falls through to a normal fetch.
 */

const REFRESH_PATH = '/auth/v1/token?grant_type=refresh_token'

export function isRefreshRequest(input) {
  const url = typeof input === 'string' ? input : input?.url
  return typeof url === 'string' && url.includes(REFRESH_PATH)
}

/**
 * @param {object}   opts
 * @param {() => boolean} opts.isNative
 * @param {(refreshToken: string) => Promise<{status:number, body?:string}>} opts.redeem
 * @param {typeof fetch} [opts.fetchImpl]
 */
export function createBrokeredFetch({ isNative, redeem, fetchImpl }) {
  const plainFetch = fetchImpl ?? ((...args) => fetch(...args))

  return async (input, init) => {
    if (!isNative() || !isRefreshRequest(input)) return plainFetch(input, init)

    let refreshToken
    try { refreshToken = JSON.parse(init?.body ?? '{}').refresh_token } catch { /* not JSON */ }
    if (!refreshToken) return plainFetch(input, init)

    let res
    try {
      res = await redeem(refreshToken)
    } catch (e) {
      // Installed native code predates the broker.
      if (e?.code === 'UNIMPLEMENTED') return plainFetch(input, init)
      throw new TypeError(`refresh broker unavailable: ${e?.message ?? e}`)
    }

    const status = Number(res?.status)
    if (!(status >= 200 && status <= 599)) {
      throw new TypeError('refresh broker: no response from server')
    }
    return new Response(res.body ?? '', {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
}
