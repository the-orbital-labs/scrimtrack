import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPathProgress } from './pathProgress'
import {
  calculatePathHourEstimate,
  formatHoursPerDay,
  formatPathHours,
  getAveragePace,
  getFinishEstimateText,
  getPathProjection,
} from './projection'
import { getStorageValue } from './storage'
import type {
  DailyActivity,
  PathProgress,
} from './storage'

vi.mock('./pathProgress', () => ({
  getPathProgress: vi.fn(),
}))

vi.mock('./settings', () => ({
  getUserSettings: vi.fn(),
}))

vi.mock('./storage', () => ({
  getStorageValue: vi.fn(),
  setStorageValue: vi.fn(),
  updateStorageValue: vi.fn(),
}))

const mockedGetPathProgress = vi.mocked(getPathProgress)
const mockedGetStorageValue = vi.mocked(getStorageValue)

const basePathProgress: PathProgress = {
  courseUrl: null,
  detectedCourses: {},
  lastProgressSyncAt: null,
  pathName: 'Frontend Developer Path',
  progressSource: 'manual',
  totalEstimatedHours: 100,
  progressPercentage: 25,
  selectedCourseId: null,
  averageWindowDays: 7,
}

const createActivity = (date: string, activeSeconds: number): DailyActivity => ({
  date,
  activeSeconds,
  goalSeconds: 1_800,
  goalCompleted: activeSeconds >= 1_800,
  sessions: [],
})

beforeEach(() => {
  mockedGetPathProgress.mockResolvedValue({ ...basePathProgress })
  mockedGetStorageValue.mockResolvedValue({})
})

describe('projection formatting', () => {
  it.each([
    [-1, '0h/day'],
    [0, '0h/day'],
    [300, '<0.1h/day'],
    [1_800, '0.5h/day'],
    [3_600, '1h/day'],
    [36_000, '10h/day'],
  ])('formats %s seconds per day as %s', (seconds, formatted) => {
    expect(formatHoursPerDay(seconds)).toBe(formatted)
  })

  it.each([
    [-1, '0h'],
    [0, '0h'],
    [0.05, '<0.1h'],
    [1.25, '1.3h'],
    [10.4, '10h'],
  ])('formats %s path hours as %s', (hours, formatted) => {
    expect(formatPathHours(hours)).toBe(formatted)
  })

  it('returns the requested projection message variant', () => {
    const projection = {
      averageDailySeconds: 3_600,
      completedHours: 5,
      daysRemaining: 5,
      finishDate: '2026-08-31',
      finishDateLabel: 'August 31, 2026',
      pace: {
        averageDailySeconds: 3_600,
        dayCount: 7,
        endDate: '2026-08-26',
        totalActiveSeconds: 25_200,
        windowDays: 7 as const,
        windowStartDate: '2026-08-20',
      },
      projectionFullMessage: 'Full projection',
      projectionMessage: 'Legacy projection',
      projectionShortMessage: 'Short projection',
      remainingHours: 5,
    }

    expect(getFinishEstimateText(projection)).toBe('Short projection')
    expect(getFinishEstimateText(projection, 'full')).toBe('Full projection')
  })
})

describe('calculatePathHourEstimate', () => {
  it('splits total hours using the completion percentage', () => {
    expect(calculatePathHourEstimate(100, 25)).toEqual({
      completedHours: 25,
      remainingHours: 75,
    })
  })

  it('clamps progress to the supported range', () => {
    expect(calculatePathHourEstimate(40, 150)).toEqual({
      completedHours: 40,
      remainingHours: 0,
    })
    expect(calculatePathHourEstimate(40, -20)).toEqual({
      completedHours: 0,
      remainingHours: 40,
    })
  })

  it('does not return negative hours', () => {
    expect(calculatePathHourEstimate(-10, 50)).toEqual({
      completedHours: 0,
      remainingHours: 0,
    })
  })
})

describe('getAveragePace', () => {
  it('averages activity across the complete configured window', async () => {
    mockedGetStorageValue.mockResolvedValue({
      '2026-08-20': createActivity('2026-08-20', 600),
      '2026-08-26': createActivity('2026-08-26', 300),
      '2026-08-27': createActivity('2026-08-27', 9_999),
    })

    await expect(getAveragePace(new Date(2026, 7, 26, 12))).resolves.toEqual({
      averageDailySeconds: 128,
      dayCount: 7,
      endDate: '2026-08-26',
      totalActiveSeconds: 900,
      windowDays: 7,
      windowStartDate: '2026-08-20',
    })
  })

  it('uses the first activity date for an all-time window', async () => {
    mockedGetPathProgress.mockResolvedValue({
      ...basePathProgress,
      averageWindowDays: 'all',
    })
    mockedGetStorageValue.mockResolvedValue({
      '2026-08-23': createActivity('2026-08-23', 400),
      '2026-08-26': createActivity('2026-08-26', 400),
    })

    await expect(getAveragePace(new Date(2026, 7, 26, 12))).resolves.toEqual({
      averageDailySeconds: 200,
      dayCount: 4,
      endDate: '2026-08-26',
      totalActiveSeconds: 800,
      windowDays: 'all',
      windowStartDate: '2026-08-23',
    })
  })

  it('returns an empty all-time pace without recorded activity', async () => {
    mockedGetPathProgress.mockResolvedValue({
      ...basePathProgress,
      averageWindowDays: 'all',
    })

    await expect(getAveragePace(new Date(2026, 7, 26, 12))).resolves.toMatchObject({
      averageDailySeconds: 0,
      dayCount: 0,
      totalActiveSeconds: 0,
      windowStartDate: null,
    })
  })
})

describe('getPathProjection', () => {
  it('reports a completed path without requiring a learning pace', async () => {
    mockedGetPathProgress.mockResolvedValue({
      ...basePathProgress,
      progressPercentage: 100,
    })

    await expect(getPathProjection(new Date(2026, 7, 26, 12))).resolves.toMatchObject({
      daysRemaining: 0,
      finishDate: '2026-08-26',
      projectionShortMessage: 'Path complete',
      remainingHours: 0,
    })
  })

  it('withholds an estimate until activity establishes a pace', async () => {
    await expect(getPathProjection(new Date(2026, 7, 26, 12))).resolves.toMatchObject({
      averageDailySeconds: 0,
      daysRemaining: null,
      finishDate: null,
      projectionShortMessage: 'Study today to estimate',
    })
  })

  it('calculates a finish date from remaining hours and average pace', async () => {
    mockedGetPathProgress.mockResolvedValue({
      ...basePathProgress,
      totalEstimatedHours: 10,
      progressPercentage: 75,
    })
    mockedGetStorageValue.mockResolvedValue({
      '2026-08-26': createActivity('2026-08-26', 25_200),
    })

    await expect(getPathProjection(new Date(2026, 7, 26, 12))).resolves.toMatchObject({
      averageDailySeconds: 3_600,
      completedHours: 7.5,
      daysRemaining: 3,
      finishDate: '2026-08-29',
      projectionShortMessage: 'Finish in 3 days',
      remainingHours: 2.5,
    })
  })
})
