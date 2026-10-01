/**
 * Conference-call rules, kept out of the call screen so they can be tested.
 *
 * A call is still one row per pair of people. A conference is several rows that
 * share one Agora channel: adding a person creates a new row from whoever added
 * them (see supabase/migrations/20260929160000_conference_calls.sql). So the
 * call screen holds the row it was opened with (the "primary") plus every other
 * row of the same channel it can see (the "legs"), and these functions answer
 * the questions that follow from that:
 *
 *   - Am I still in the call once my own row has ended?
 *   - What state should the screen show, and since when?
 *   - Who is being rung right now?
 *   - Who can still be added?
 *
 * A person only ever sees rows they are part of, so a leg between two OTHER
 * people is invisible here. Who else is in the call therefore comes from the
 * server (get_call_participants), not from these rows.
 */

export const TERMINAL = ['declined', 'ended', 'missed']

/** Most people in one call, matching the cap in add_call_participant. */
export const MAX_PARTICIPANTS = 6

const involves = (leg, me) => leg.caller_id === me || leg.callee_id === me

/**
 * Rows, other than the primary, that keep me in the call: one that is connected,
 * or one I started and am still waiting on. A row where I am only being rung is
 * not one of them; that is an invitation, not a place I already am.
 */
export function otherLiveLegs(primary, legs, me) {
  return (legs || []).filter(l =>
    l.id !== primary?.id && involves(l, me)
    && (l.status === 'accepted' || (l.status === 'ringing' && l.caller_id === me)))
}

/**
 * Should this screen close? Only when my own row is over and nothing else holds
 * me here. This is what lets the call go on for A and C after B hangs up.
 */
export function shouldLeave(primary, legs, me) {
  if (!primary || !TERMINAL.includes(primary.status)) return false
  return otherLiveLegs(primary, legs, me).length === 0
}

/**
 * The state to show and the moment it began. When my own row has ended but I am
 * still connected through another, the screen must keep saying "in call" and
 * keep the clock running, so it reads from the earliest connected row.
 */
export function callClock(primary, legs, me) {
  if (primary?.status === 'accepted') {
    return { status: 'accepted', since: primary.answered_at || null }
  }
  const connected = (legs || [])
    .filter(l => l.status === 'accepted' && involves(l, me))
    .sort((a, b) => new Date(a.answered_at || 0) - new Date(b.answered_at || 0))
  if (connected.length) return { status: 'accepted', since: connected[0].answered_at || null }
  return { status: primary?.status, since: null }
}

/** People I have added who have not answered yet: rows I started, still ringing. */
export function ringingLegs(primary, legs, me) {
  return (legs || []).filter(l =>
    l.id !== primary?.id && l.caller_id === me && l.status === 'ringing')
}

/**
 * Family members who can still be added: not me, not already in the call and
 * not already being rung. `participants` is what get_call_participants returned.
 */
export function addableMembers(members, participants, me) {
  const busy = new Set((participants || []).map(p => p.participant_id))
  return (members || []).filter(m => m.user_id !== me && !busy.has(m.user_id))
}

/** True once the call has as many people as allowed, counting anyone being rung. */
export function isFull(participants) {
  return (participants || []).length >= MAX_PARTICIPANTS
}

/**
 * The line under the avatar. Only people actually in the call, never me: one
 * name reads as before, two are listed, more collapse to "A, B +2".
 * `nameFor(id, fallback)` applies the nicknames I set on the family card.
 */
export function participantSummary(participants, me, nameFor, fallbackName = '') {
  const others = (participants || []).filter(p => p.participant_id !== me && p.participant_state === 'in')
  const names = others.map(p => nameFor(p.participant_id, p.participant_name) || fallbackName)
  if (names.length <= 2) return names.join(', ')
  return `${names[0]}, ${names[1]} +${names.length - 2}`
}
