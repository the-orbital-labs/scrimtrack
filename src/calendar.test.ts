import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addCalendarDays, calendarDayCount, getDateKey, nextDateBoundary, weekStartKey } from './calendar'
import {
  addActiveSecondsForInterval, createDailyActivity, getActivityForDate,
  getActivityForDateRange, getCurrentStreakStatus, startLearningSession,
} from './activity'
import { getDashboardHeatmapGrid, getPopupHeatmapGrid } from './heatmap'
import { getAveragePace, getPathProjection } from './projection'
import { saveDailyGoal, saveTimezone } from './settings'
import { calculateStreakStatus } from './streak'
import { getCurrentWeekTimeStats, getCurrentMonthTimeStats } from './timeStats'
import { getCurrentWeekSummary } from './weeklySummary'
import { getCurrentMonthSummary } from './monthlySummary'
import { installChromeMock, uninstallChromeMock } from './test/chromeMock'

const active = (date: string, seconds = 3600) => ({
  ...createDailyActivity(date, 1800), activeSeconds: seconds,
})

describe('calendar dates', () => {
  it('converts one instant to the selected timezone without parsing date keys as UTC instants', () => {
    const instant = '2026-01-01T00:30:00Z'
    expect(getDateKey(instant, 'America/Los_Angeles')).toBe('2025-12-31')
    expect(getDateKey(instant, 'Asia/Kathmandu')).toBe('2026-01-01')
    expect(getDateKey('2026-01-01T23:30:00Z', 'Pacific/Kiritimati')).toBe('2026-01-02')
  })

  it('advances dates across leap days and year boundaries', () => {
    expect(addCalendarDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addCalendarDays('2024-02-28', 2)).toBe('2024-03-01')
    expect(addCalendarDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(weekStartKey('2026-01-01')).toBe('2025-12-28')
    expect(calendarDayCount('2026-03-07', '2026-03-09')).toBe(3)
  })

  it.each([
    ['2026-03-08T08:00:00Z', 'America/Los_Angeles', '2026-03-09T07:00:00.000Z'],
    ['2026-11-01T07:00:00Z', 'America/Los_Angeles', '2026-11-02T08:00:00.000Z'],
    ['2026-01-01T18:00:00Z', 'Asia/Kathmandu', '2026-01-01T18:15:00.000Z'],
    ['2018-11-03T12:00:00Z', 'America/Sao_Paulo', '2018-11-04T03:00:00.000Z'],
  ])('finds the next date boundary from %s in %s', (instant, zone, expected) => {
    expect(nextDateBoundary(new Date(instant), zone).toISOString()).toBe(expected)
  })

  it('counts streaks across DST, leap days, and year boundaries', () => {
    for (const dates of [
      ['2026-03-07', '2026-03-08', '2026-03-09'],
      ['2026-10-31', '2026-11-01', '2026-11-02'],
      ['2024-02-28', '2024-02-29', '2024-03-01'],
      ['2025-12-31', '2026-01-01', '2026-01-02'],
    ]) {
      const activities = Object.fromEntries(dates.map((date) => [date, active(date)]))
      expect(calculateStreakStatus(activities, dates[2])).toMatchObject({ currentStreak: 3, longestStreak: 3 })
    }
  })
})

describe('saved timezone calendar behavior', () => {
  let store: ReturnType<typeof installChromeMock>
  beforeEach(() => {
    store = installChromeMock()
    store.data.userSettings.timezone = 'America/Los_Angeles'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-01T06:30:00Z')) // March 31 locally
  })
  afterEach(() => { vi.useRealTimers(); uninstallChromeMock() })

  it('uses the saved date for sessions, daily goal edits, and daily reads', async () => {
    await startLearningSession({ id: 'session', url: 'https://scrimba.com/test', title: null,
      startedAt: new Date().toISOString(), isActive: true })
    await saveDailyGoal(900)
    expect(store.data.dailyActivities['2026-03-31']).toMatchObject({ goalSeconds: 900 })
    expect(store.data.dailyActivities['2026-04-01']).toBeUndefined()
    expect((await getActivityForDate(new Date())).date).toBe('2026-03-31')
  })

  it('splits a fractional-second interval at saved-zone midnight without losing seconds', async () => {
    await addActiveSecondsForInterval({ activeSeconds: 10, endedAt: '2026-04-01T07:00:05.500Z', sessionId: 'session' })
    expect(store.data.dailyActivities['2026-03-31'].activeSeconds).toBe(4)
    expect(store.data.dailyActivities['2026-04-01'].activeSeconds).toBe(6)
    expect(store.data.dailyActivities['2026-04-01'].sessions[0].activeSeconds).toBe(6)
  })

  it.each([
    ['2026-03-09T07:00:10Z', 23 * 3600 + 20, '2026-03-07', '2026-03-08', '2026-03-09', 23],
    ['2026-11-02T08:00:10Z', 25 * 3600 + 20, '2026-10-31', '2026-11-01', '2026-11-02', 25],
  ])('preserves elapsed tracking seconds over a DST day ending %s', async (endedAt, seconds, first, middle, last, hours) => {
    await addActiveSecondsForInterval({ activeSeconds: seconds, endedAt })
    expect(store.data.dailyActivities[first].activeSeconds).toBe(10)
    expect(store.data.dailyActivities[middle].activeSeconds).toBe(hours * 3600)
    expect(store.data.dailyActivities[last].activeSeconds).toBe(10)
  })

  it('uses the same saved date for weekly/monthly totals, summaries, and both heatmaps', async () => {
    store.data.dailyActivities = {
      '2026-03-31': active('2026-03-31', 600), '2026-04-01': active('2026-04-01', 900),
    }
    expect(await getCurrentWeekTimeStats()).toMatchObject({ endDate: '2026-03-31', activeSeconds: 600 })
    expect(await getCurrentMonthTimeStats()).toMatchObject({ startDate: '2026-03-01', endDate: '2026-03-31', activeSeconds: 600 })
    expect(await getCurrentWeekSummary()).toMatchObject({ activeSeconds: 600 })
    expect(await getCurrentMonthSummary()).toMatchObject({ activeSeconds: 600 })
    for (const grid of [await getDashboardHeatmapGrid(), await getPopupHeatmapGrid()]) {
      const days = grid.weeks.flatMap((week) => week.days)
      expect(days.find((day) => day.isToday)?.date).toBe('2026-03-31')
      expect(days.find((day) => day.date === '2026-04-01')?.isFuture).toBe(true)
      expect(days.find((day) => day.date === grid.startDate)?.isOutsideRange).toBe(false)
    }
  })

  it('enumerates calendar dates across DST and leap days without skipping or repeating dates', async () => {
    expect((await getActivityForDateRange('2026-03-07', '2026-03-09')).map((day) => day.date))
      .toEqual(['2026-03-07', '2026-03-08', '2026-03-09'])
    expect((await getActivityForDateRange('2024-02-28', '2024-03-01')).map((day) => day.date))
      .toEqual(['2024-02-28', '2024-02-29', '2024-03-01'])
  })

  it.each([
    ['2026-03-08T08:30:00Z', '2026-03-02', '2026-03-09'],
    ['2026-11-01T07:30:00Z', '2026-10-26', '2026-11-02'],
  ])('counts pace windows and finish dates in calendar days from %s', async (now, start, finish) => {
    vi.setSystemTime(new Date(now))
    store.data.pathProgress.totalEstimatedHours = 1
    store.data.dailyActivities = { [start]: active(start, 7 * 3600) }
    expect(await getAveragePace()).toMatchObject({ windowStartDate: start, dayCount: 7, totalActiveSeconds: 7 * 3600 })
    expect(await getPathProjection()).toMatchObject({ daysRemaining: 1, finishDate: finish })
    store.data.pathProgress.averageWindowDays = 'all'
    expect(await getAveragePace()).toMatchObject({ dayCount: 7 })
  })

  it('expires the current streak after midnight without requiring another tracking write', async () => {
    store.data.dailyActivities = { '2026-03-30': active('2026-03-30') }
    expect(await getCurrentStreakStatus()).toMatchObject({ currentStreak: 1 })
    vi.setSystemTime(new Date('2026-04-01T07:00:00Z'))
    expect(await getCurrentStreakStatus()).toMatchObject({ currentStreak: 0, longestStreak: 1 })
  })

  it('applies a timezone change to future reads and writes while preserving historical dates', async () => {
    store.data.dailyActivities = { '2026-03-31': active('2026-03-31') }
    const history = structuredClone(store.data.dailyActivities)
    await saveTimezone('Asia/Tokyo')
    expect((await getActivityForDate(new Date())).date).toBe('2026-04-01')
    expect(store.data.dailyActivities).toEqual(history)
    await saveDailyGoal(600)
    expect(store.data.dailyActivities['2026-04-01'].goalSeconds).toBe(600)
    expect(store.data.dailyActivities['2026-03-31']).toEqual(history['2026-03-31'])
  })
})
