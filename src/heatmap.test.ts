import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateHeatmapGrid, getHeatmapIntensity } from './heatmap'
import type { DailyActivity } from './storage'

const createActivity = (
  date: string,
  activeSeconds: number,
  goalSeconds = 1_800,
): DailyActivity => ({
  date,
  activeSeconds,
  goalSeconds,
  goalCompleted: goalSeconds > 0 && activeSeconds >= goalSeconds,
  sessions: [],
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getHeatmapIntensity', () => {
  it.each([
    [-60, 0],
    [0, 0],
    [59, 0],
    [60, 1],
    [899, 1],
    [900, 2],
    [1_799, 2],
    [1_800, 3],
    [3_599, 3],
    [3_600, 4],
    [7_199, 4],
    [7_200, 5],
  ])('maps %s seconds to intensity %s', (seconds, intensity) => {
    expect(getHeatmapIntensity(seconds)).toBe(intensity)
  })
})

describe('generateHeatmapGrid', () => {
  it('aligns the requested range to complete weeks', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 19, 12))

    const grid = generateHeatmapGrid({}, {
      days: 3,
      endDate: new Date(2026, 7, 19, 12),
      goalSeconds: 1_800,
      weekStartsOn: 0,
    })

    expect(grid.startDate).toBe('2026-08-17')
    expect(grid.endDate).toBe('2026-08-19')
    expect(grid.weeks).toHaveLength(1)
    expect(grid.weeks[0].startDate).toBe('2026-08-16')
    expect(grid.weeks[0].days).toHaveLength(7)
    expect(grid.weeks[0].days.filter(({ isOutsideRange }) => isOutsideRange))
      .toHaveLength(4)
  })

  it('combines saved activity with default days and goal values', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 19, 12))

    const grid = generateHeatmapGrid({
      '2026-08-18': createActivity('2026-08-18', 900),
      '2026-08-19': createActivity('2026-08-19', 1_800),
    }, {
      days: 3,
      endDate: '2026-08-19',
      goalSeconds: 1_800,
    })
    const days = grid.weeks.flatMap((week) => week.days)
    const monday = days.find(({ date }) => date === '2026-08-17')
    const tuesday = days.find(({ date }) => date === '2026-08-18')
    const wednesday = days.find(({ date }) => date === '2026-08-19')

    expect(monday?.activity).toMatchObject({ activeSeconds: 0, goalSeconds: 1_800 })
    expect(tuesday).toMatchObject({ activeMinutes: 15, intensity: 2 })
    expect(wednesday).toMatchObject({
      activeSeconds: 1_800,
      goalCompleted: true,
      intensity: 3,
      isToday: true,
    })
  })

  it('supports Monday as the first day of the week', () => {
    const grid = generateHeatmapGrid({}, {
      days: 1,
      endDate: '2026-08-19',
      weekStartsOn: 1,
    })

    expect(grid.weeks[0].startDate).toBe('2026-08-17')
    expect(grid.weeks[0].days.at(-1)?.date).toBe('2026-08-23')
  })
})
