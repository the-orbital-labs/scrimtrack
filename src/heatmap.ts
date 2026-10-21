import { addCalendarDays, getDateKey, weekStartKey } from './calendar'
import { createDailyActivity } from './activity'
import { getUserSettings } from './settings'
import { getStorageValue } from './storage'
import type { DailyActivity } from './storage'

export type HeatmapIntensityLevel = 0 | 1 | 2 | 3 | 4 | 5

export type HeatmapDay = {
  date: string
  activity: DailyActivity
  activeMinutes: number
  activeSeconds: number
  goalCompleted: boolean
  intensity: HeatmapIntensityLevel
  isFuture: boolean
  isOutsideRange: boolean
  isToday: boolean
}

export type HeatmapWeek = {
  startDate: string
  days: HeatmapDay[]
}

export type HeatmapGrid = {
  startDate: string
  endDate: string
  weeks: HeatmapWeek[]
}

type HeatmapGridOptions = {
  days: number
  endDate?: Date | string
  goalSeconds?: number
  timezone?: string
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
}

const popupHeatmapWeeks = 12
const dashboardHeatmapDays = 365

export const getHeatmapIntensity = (
  activeSeconds: number,
): HeatmapIntensityLevel => {
  const activeMinutes = Math.floor(Math.max(0, activeSeconds) / 60)

  if (activeMinutes === 0) {
    return 0
  }

  if (activeMinutes < 15) {
    return 1
  }

  if (activeMinutes < 30) {
    return 2
  }

  if (activeMinutes < 60) {
    return 3
  }

  if (activeMinutes < 120) {
    return 4
  }

  return 5
}

export const generateHeatmapGrid = (
  activities: Record<string, DailyActivity>,
  {
    days,
    endDate = new Date(),
    timezone,
    goalSeconds = 0,
    weekStartsOn = 0,
  }: HeatmapGridOptions,
): HeatmapGrid => {
  const today = getDateKey(new Date(), timezone)
  const rangeEnd = typeof endDate === 'string' ? endDate : getDateKey(endDate, timezone)
  const rangeStart = addCalendarDays(rangeEnd, -(Math.max(1, days) - 1))
  const gridStart = weekStartKey(rangeStart, weekStartsOn)
  const gridEnd = addCalendarDays(weekStartKey(rangeEnd, weekStartsOn), 6)
  const weeks: HeatmapWeek[] = []

  for (let weekStart = gridStart; weekStart <= gridEnd; weekStart = addCalendarDays(weekStart, 7)) {
    const weekDays: HeatmapDay[] = []

    for (let offset = 0; offset < 7; offset += 1) {
      const dateKey = addCalendarDays(weekStart, offset)
      const activity = activities[dateKey] ?? createDailyActivity(dateKey, goalSeconds)
      const activeMinutes = Math.floor(activity.activeSeconds / 60)

      weekDays.push({
        date: dateKey,
        activity,
        activeMinutes,
        activeSeconds: activity.activeSeconds,
        goalCompleted: activity.goalCompleted,
        intensity: getHeatmapIntensity(activity.activeSeconds),
        isFuture: dateKey > today,
        isOutsideRange: dateKey < rangeStart || dateKey > rangeEnd,
        isToday: dateKey === today,
      })
    }

    weeks.push({
      startDate: weekStart,
      days: weekDays,
    })
  }

  return {
    startDate: rangeStart,
    endDate: rangeEnd,
    weeks,
  }
}

export const getPopupHeatmapGrid = async (): Promise<HeatmapGrid> => {
  const [activities, settings] = await Promise.all([
    getStorageValue('dailyActivities'),
    getUserSettings(),
  ])

  return generateHeatmapGrid(activities, {
    days: popupHeatmapWeeks * 7,
    endDate: addCalendarDays(weekStartKey(getDateKey(new Date(), settings.timezone)), 6),
    goalSeconds: settings.dailyGoalSeconds,
    timezone: settings.timezone,
  })
}

export const getDashboardHeatmapGrid = async (): Promise<HeatmapGrid> => {
  const [activities, settings] = await Promise.all([
    getStorageValue('dailyActivities'),
    getUserSettings(),
  ])

  return generateHeatmapGrid(activities, {
    days: dashboardHeatmapDays,
    goalSeconds: settings.dailyGoalSeconds,
    timezone: settings.timezone,
  })
}
