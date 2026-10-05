import { describe, it, expect } from 'vitest'
import { orderMembers } from './memberOrder'

const m = (id, joined, role = 'member') => ({ user_id: id, joined_at: joined, role })

describe('orderMembers', () => {
  it('puts the owner first, then the rest in the order they joined', () => {
    const list = [
      m('third',  '2026-03-03T00:00:00Z'),
      m('owner',  '2026-01-01T00:00:00Z', 'admin'),
      m('fourth', '2026-04-04T00:00:00Z'),
      m('second', '2026-02-02T00:00:00Z'),
    ]
    expect(orderMembers(list, 'owner').map(x => x.user_id)).toEqual(['owner', 'second', 'third', 'fourth'])
  })

  it('keeps the owner first even when they joined after others (ownership was transferred)', () => {
    const list = [
      m('first',  '2026-01-01T00:00:00Z'),
      m('newOwner', '2026-02-01T00:00:00Z', 'admin'),
      m('last',   '2026-03-01T00:00:00Z'),
    ]
    expect(orderMembers(list, 'newOwner').map(x => x.user_id)).toEqual(['newOwner', 'first', 'last'])
  })

  it('does not promote other admins above join order', () => {
    const list = [
      m('owner', '2026-01-01T00:00:00Z', 'admin'),
      m('b',     '2026-02-01T00:00:00Z'),
      m('c',     '2026-03-01T00:00:00Z', 'admin'),
    ]
    expect(orderMembers(list, 'owner').map(x => x.user_id)).toEqual(['owner', 'b', 'c'])
  })

  it('treats the admin as the owner until the owner is known', () => {
    const list = [m('b', '2026-02-01T00:00:00Z'), m('a', '2026-01-01T00:00:00Z', 'admin')]
    expect(orderMembers(list, null).map(x => x.user_id)).toEqual(['a', 'b'])
  })

  it('puts a member with no join date last, and is stable on ties', () => {
    const list = [m('x', undefined), m('o', '2026-01-01T00:00:00Z', 'admin'), m('b', '2026-02-01T00:00:00Z'), m('a', '2026-02-01T00:00:00Z')]
    expect(orderMembers(list, 'o').map(x => x.user_id)).toEqual(['o', 'a', 'b', 'x'])
  })

  it('does not change the list it is given, and copes with nothing', () => {
    const list = [m('b', '2026-02-01T00:00:00Z'), m('a', '2026-01-01T00:00:00Z')]
    const before = list.map(x => x.user_id).join()
    orderMembers(list, null)
    expect(list.map(x => x.user_id).join()).toBe(before)
    expect(orderMembers(undefined, 'x')).toEqual([])
  })
})
