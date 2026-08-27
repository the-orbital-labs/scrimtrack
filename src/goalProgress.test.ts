import { describe, expect, it } from 'vitest'
import {
  formatActiveTime,
  getGoalProgress,
  secondsToMinutes,
} from './goalProgress'
import type { DailyActivity, UserSettings } from './storage'

const settings: UserSettings = {
  dailyGoalSeconds: 1_800,
  floatingWidgetVisible: true,
  idleTimeoutSeconds: 120,
  trackingEnabled: true,
  timezone: 'America/Los_Angeles',
}

const createActivity = (
  activeSeconds: number,
  goalSeconds = 1_800,
  goalCompleted = false,
): DailyActivity => ({
  date: '2026-08-26',
  activeSeconds,
  goalSeconds,
  goalCompleted,
  sessions: [],
})

describe('secondsToMinutes', () => {
  it.each([
    [-60, 0],
    [0, 0],
    [59, 0],
    [60, 1],
    [3_599, 59],
  ])('converts %s seconds to %s whole minutes', (seconds, minutes) => {
    expect(secondsToMinutes(seconds)).toBe(minutes)
  })
})

describe('formatActiveTime', () => {
  it.each([
    [-1, '0s'],
    [59.9, '59s'],
    [60, '1m 00s'],
    [3_599, '59m 59s'],
    [3_600, '1h 0m 00s'],
    [3_661, '1h 1m 01s'],
  ])('formats %s seconds as %s', (seconds, formatted) => {
    expect(formatActiveTime(seconds)).toBe(formatted)
  })
})

describe('getGoalProgress', () => {
  it('returns empty progress without activity or settings', () => {
    expect(getGoalProgress(null, null)).toEqual({
      activeSeconds: 0,
      goalSeconds: 0,
      isComplete: false,
      remainingSeconds: 0,
      percentage: 0,
      visualPercentage: 0,
    })
  })

  it('uses the saved setting before a daily activity exists', () => {
    expect(getGoalProgress(null, settings)).toMatchObject({
      activeSeconds: 0,
      goalSeconds: 1_800,
      remainingSeconds: 1_800,
      percentage: 0,
    })
  })

  it('uses the goal stored with the daily activity', () => {
    expect(getGoalProgress(createActivity(300, 600), settings)).toMatchObject({
      goalSeconds: 600,
      remainingSeconds: 300,
      percentage: 50,
    })
  })

  it('marks a goal complete when active time reaches the goal', () => {
    expect(getGoalProgress(createActivity(1_800), settings)).toMatchObject({
      isComplete: true,
      remainingSeconds: 0,
      percentage: 100,
      visualPercentage: 100,
    })
  })

  it('preserves completion stored on the daily activity', () => {
    expect(getGoalProgress(createActivity(1_200, 1_800, true), settings).isComplete)
      .toBe(true)
  })

  it('caps visual progress without discarding the actual percentage', () => {
    expect(getGoalProgress(createActivity(2_700), settings)).toMatchObject({
      percentage: 150,
      visualPercentage: 100,
      remainingSeconds: 0,
    })
  })
})
