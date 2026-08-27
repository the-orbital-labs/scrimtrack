import { describe, expect, it } from 'vitest'
import { createDailyActivity, getLocalDateKey } from './activity'

describe('activity helpers', () => {
  it('formats local dates as stable date keys', () => {
    expect(getLocalDateKey(new Date(2026, 0, 5, 12))).toBe('2026-01-05')
    expect(getLocalDateKey(new Date(2026, 10, 23, 12))).toBe('2026-11-23')
  })

  it('creates an empty daily activity with the supplied goal', () => {
    expect(createDailyActivity('2026-08-26', 1_800)).toEqual({
      date: '2026-08-26',
      activeSeconds: 0,
      goalSeconds: 1_800,
      goalCompleted: false,
      sessions: [],
    })
  })

  it('defaults a new daily activity to no goal', () => {
    expect(createDailyActivity('2026-08-26').goalSeconds).toBe(0)
  })
})
