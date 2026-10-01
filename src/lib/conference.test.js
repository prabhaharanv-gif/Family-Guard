import { describe, it, expect } from 'vitest'
import {
  otherLiveLegs, shouldLeave, callClock, ringingLegs, addableMembers,
  isFull, participantSummary, MAX_PARTICIPANTS,
} from './conference'

// Three people: A calls B, then A adds C. Rows share one channel.
const A = 'user-a', B = 'user-b', C = 'user-c', D = 'user-d'
const row = (id, caller_id, callee_id, status, answered_at = null) =>
  ({ id, caller_id, callee_id, status, answered_at })

const ab = (status, at = '2026-09-29T10:00:00Z') => row('ab', A, B, status, at)
const ac = (status, at = '2026-09-29T10:01:00Z') => row('ac', A, C, status, at)

describe('shouldLeave: the call goes on until nothing holds me here', () => {
  it('a plain one-to-one call closes when its row ends', () => {
    expect(shouldLeave(ab('ended'), [ab('ended')], A)).toBe(true)
    expect(shouldLeave(ab('declined'), [ab('declined')], B)).toBe(true)
    expect(shouldLeave(ab('missed'), [ab('missed')], A)).toBe(true)
  })

  it('does not leave while the primary row is still live', () => {
    expect(shouldLeave(ab('accepted'), [ab('accepted')], A)).toBe(false)
    expect(shouldLeave(ab('ringing'), [ab('ringing')], A)).toBe(false)
  })

  it('B hangs up: A stays because A is still connected to C', () => {
    const legs = [ab('ended'), ac('accepted')]
    expect(shouldLeave(ab('ended'), legs, A)).toBe(false)
  })

  it('B hangs up: B leaves, since B has no other live row', () => {
    // B only ever sees the row it is part of
    expect(shouldLeave(ab('ended'), [ab('ended')], B)).toBe(true)
  })

  it('A hangs up: everybody whose only rows are with A leaves', () => {
    const legs = [ab('ended'), ac('ended')]
    expect(shouldLeave(ab('ended'), legs, B)).toBe(true)
    expect(shouldLeave(ac('ended'), [ac('ended')], C)).toBe(true)
  })

  it('A waits for someone it is still ringing, even after B has gone', () => {
    const legs = [ab('ended'), ac('ringing')]
    expect(shouldLeave(ab('ended'), legs, A)).toBe(false)
  })

  it('A leaves once the person it was ringing times out', () => {
    const legs = [ab('ended'), ac('missed')]
    expect(shouldLeave(ab('ended'), legs, A)).toBe(true)
  })

  it('being rung by someone else is not a reason to stay', () => {
    // a ringing row where I am only the callee
    const legs = [ab('ended'), row('xb', D, B, 'ringing')]
    expect(shouldLeave(ab('ended'), legs, B)).toBe(true)
  })

  it('B added C, A leaves: B stays with C', () => {
    const bc = row('bc', B, C, 'accepted', '2026-09-29T10:02:00Z')
    expect(shouldLeave(ab('ended'), [ab('ended'), bc], B)).toBe(false)
    // and C, whose primary row is the one with B, stays too
    expect(shouldLeave(bc, [bc], C)).toBe(false)
  })

  it('no primary row yet: never leave', () => {
    expect(shouldLeave(null, [], A)).toBe(false)
  })
})

describe('otherLiveLegs', () => {
  it('ignores the primary itself and rows that are over', () => {
    const legs = [ab('accepted'), ac('ended')]
    expect(otherLiveLegs(ab('accepted'), legs, A)).toEqual([])
  })
  it('counts a connected row and a row I am ringing', () => {
    const legs = [ab('ended'), ac('accepted'), row('ad', A, D, 'ringing')]
    expect(otherLiveLegs(ab('ended'), legs, A).map(l => l.id)).toEqual(['ac', 'ad'])
  })
  it('ignores rows I am not part of', () => {
    const legs = [ab('accepted'), row('cd', C, D, 'accepted')]
    expect(otherLiveLegs(ab('accepted'), legs, A)).toEqual([])
  })
})

describe('callClock: keeps saying "in call" while connected through another row', () => {
  it('uses the primary while it is connected', () => {
    expect(callClock(ab('accepted'), [ab('accepted')], A))
      .toEqual({ status: 'accepted', since: '2026-09-29T10:00:00Z' })
  })
  it('falls back to the earliest connected row when the primary has ended', () => {
    const legs = [ab('ended'), ac('accepted', '2026-09-29T10:05:00Z')]
    expect(callClock(ab('ended'), legs, A))
      .toEqual({ status: 'accepted', since: '2026-09-29T10:05:00Z' })
  })
  it('otherwise reports the primary state with no clock', () => {
    expect(callClock(ab('ringing'), [ab('ringing')], A)).toEqual({ status: 'ringing', since: null })
    expect(callClock(ab('ended'), [ab('ended')], A)).toEqual({ status: 'ended', since: null })
  })
})

describe('ringingLegs', () => {
  it('lists only rows I started that are still ringing', () => {
    const legs = [ab('accepted'), ac('ringing'), row('bd', B, D, 'ringing')]
    expect(ringingLegs(ab('accepted'), legs, A).map(l => l.id)).toEqual(['ac'])
  })
})

describe('addableMembers', () => {
  const members = [A, B, C, D].map(u => ({ user_id: u, display_name: u }))
  it('leaves out me, people in the call and people being rung', () => {
    const participants = [
      { participant_id: A, participant_state: 'in' },
      { participant_id: B, participant_state: 'in' },
      { participant_id: C, participant_state: 'ringing' },
    ]
    expect(addableMembers(members, participants, A).map(m => m.user_id)).toEqual([D])
  })
  it('offers everyone but me when nobody else is in', () => {
    expect(addableMembers(members, [], A).map(m => m.user_id)).toEqual([B, C, D])
  })
})

describe('isFull', () => {
  it('is full at the cap', () => {
    const p = n => Array.from({ length: n }, (_, i) => ({ participant_id: 'u' + i }))
    expect(isFull(p(MAX_PARTICIPANTS - 1))).toBe(false)
    expect(isFull(p(MAX_PARTICIPANTS))).toBe(true)
  })
})

describe('participantSummary', () => {
  const nameFor = (id, fallback) => ({ [B]: 'Bala', [C]: 'Chitra', [D]: 'Devi' }[id] || fallback)
  const inCall = id => ({ participant_id: id, participant_name: id, participant_state: 'in' })
  it('never lists me and skips people still ringing', () => {
    const p = [inCall(A), inCall(B), { participant_id: C, participant_name: 'c', participant_state: 'ringing' }]
    expect(participantSummary(p, A, nameFor)).toBe('Bala')
  })
  it('lists two names', () => {
    expect(participantSummary([inCall(A), inCall(B), inCall(C)], A, nameFor)).toBe('Bala, Chitra')
  })
  it('collapses more than two', () => {
    const p = [inCall(A), inCall(B), inCall(C), inCall(D), inCall('user-e')]
    expect(participantSummary(p, A, nameFor)).toBe('Bala, Chitra +2')
  })
  it('falls back to the given name when there is none', () => {
    expect(participantSummary([inCall(A)], A, nameFor, 'Member')).toBe('')
    expect(participantSummary([{ participant_id: 'user-z', participant_name: '', participant_state: 'in' }], A, nameFor, 'Member')).toBe('Member')
  })
})
