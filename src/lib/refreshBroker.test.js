import { describe, it, expect, vi } from 'vitest'
import { createBrokeredFetch, isRefreshRequest } from './refreshBroker'

const URL_REFRESH = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token'
const init = (token = 'R1') => ({ method: 'POST', body: JSON.stringify({ refresh_token: token }) })

function setup({ native = true, redeem } = {}) {
  const fetchImpl = vi.fn(async () => new Response('{"plain":true}', { status: 200 }))
  const redeemFn = vi.fn(redeem ?? (async () => ({ status: 200, body: '{"access_token":"A2"}' })))
  const f = createBrokeredFetch({ isNative: () => native, redeem: redeemFn, fetchImpl })
  return { f, fetchImpl, redeem: redeemFn }
}

describe('refreshBroker', () => {
  it('recognises only the refresh endpoint', () => {
    expect(isRefreshRequest(URL_REFRESH)).toBe(true)
    expect(isRefreshRequest('https://x.supabase.co/auth/v1/token?grant_type=password')).toBe(false)
    expect(isRefreshRequest('https://x.supabase.co/rest/v1/rpc/foo')).toBe(false)
  })

  it('sends a native refresh to the broker, never to the network', async () => {
    const { f, fetchImpl, redeem } = setup()
    const res = await f(URL_REFRESH, init('R1'))
    expect(redeem).toHaveBeenCalledWith('R1')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ access_token: 'A2' })
  })

  it('leaves every other request alone', async () => {
    const { f, fetchImpl, redeem } = setup()
    await f('https://x.supabase.co/rest/v1/rpc/foo', { method: 'POST', body: '{}' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(redeem).not.toHaveBeenCalled()
  })

  it('uses plain fetch on the web', async () => {
    const { f, fetchImpl, redeem } = setup({ native: false })
    await f(URL_REFRESH, init())
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(redeem).not.toHaveBeenCalled()
  })

  it('passes a server rejection through unchanged, so a dead token stays dead', async () => {
    const body = '{"code":"refresh_token_already_used"}'
    const { f } = setup({ redeem: async () => ({ status: 400, body }) })
    const res = await f(URL_REFRESH, init())
    expect(res.status).toBe(400)
    expect(await res.text()).toBe(body)
  })

  it('throws (retryable, session kept) when the server was never reached', async () => {
    const { f } = setup({ redeem: async () => ({ status: 0 }) })
    await expect(f(URL_REFRESH, init())).rejects.toBeInstanceOf(TypeError)
  })

  it('throws (retryable, session kept) when the bridge call fails', async () => {
    const { f, fetchImpl } = setup({ redeem: async () => { throw new Error('bridge gone') } })
    await expect(f(URL_REFRESH, init())).rejects.toBeInstanceOf(TypeError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('falls back to fetch on a native build without the broker', async () => {
    const err = Object.assign(new Error('not implemented'), { code: 'UNIMPLEMENTED' })
    const { f, fetchImpl } = setup({ redeem: async () => { throw err } })
    await f(URL_REFRESH, init())
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
