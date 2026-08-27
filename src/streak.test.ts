import { describe, expect, it } from 'vitest'
import { calculateStreakStatus } from './streak'
import type { DailyActivity } from './storage'

const createActivity = (date: string, activeSeconds = 60): DailyActivity => ({
  date,
  activeSeconds,
  goalSeconds: 1_800,
  goalCompleted: activeSeconds >= 1_800,
  sessions: [],
})

const calculate = (
  activities: DailyActivity[],
  today = '2026-08-26',
) => calculateStreakStatus(
  Object.fromEntries(activities.map((activity) => [activity.date, activity])),
  today,
)

describe('calculateStreakStatus', () => {
  it('returns zero streaks without activity', () => {
    expect(calculate([])).toMatchObject({ currentStreak: 0, longestStreak: 0 })
  })

  it('counts a streak ending today', () => {
    expect(calculate([
      createActivity('2026-08-24'),
      createActivity('2026-08-25'),
      createActivity('2026-08-26'),
    ])).toMatchObject({ currentStreak: 3, longestStreak: 3 })
  })

  it('keeps the current streak alive when the last activity was yesterday', () => {
    expect(calculate([
      createActivity('2026-08-24'),
      createActivity('2026-08-25'),
    ])).toMatchObject({ currentStreak: 2, longestStreak: 2 })
  })

  it('resets the current streak after a missed day while retaining the longest streak', () => {
    expect(calculate([
      createActivity('2026-08-10'),
      createActivity('2026-08-11'),
      createActivity('2026-08-12'),
      createActivity('2026-08-24'),
    ])).toMatchObject({ currentStreak: 0, longestStreak: 3 })
  })

  it('ignores days without active learning time', () => {
    expect(calculate([
      createActivity('2026-08-24'),
      createActivity('2026-08-25', 0),
      createActivity('2026-08-26'),
    ])).toMatchObject({ currentStreak: 1, longestStreak: 1 })
  })

  it('handles streaks across a year boundary', () => {
    expect(calculate([
      createActivity('2025-12-30'),
      createActivity('2025-12-31'),
      createActivity('2026-01-01'),
    ], '2026-01-01')).toMatchObject({ currentStreak: 3, longestStreak: 3 })
  })

  it('records when the calculation occurred', () => {
    expect(Number.isNaN(Date.parse(calculate([]).lastCalculatedAt ?? ''))).toBe(false)
  })
})
