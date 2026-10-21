import { getDateKey, weekStartKey } from './calendar'
import { getUserSettings } from './settings'
import { getActivityForDateRange } from './activity'
import { getStorageValue } from './storage'

export type WeeklyTimeStats = {
  activeSeconds: number
  averageSecondsPerDay: number
  dayCount: number
  endDate: string
  startDate: string
}

export type MonthlyTimeStats = {
  activeDays: number
  activeSeconds: number
  dayCount: number
  endDate: string
  startDate: string
}

export type AllTimeStats = {
  activeDays: number
  activeSeconds: number
  dayCount: number
}

export const getWeekStart = (date: Date = new Date()): Date => {
  const weekStart = new Date(date)

  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())

  return weekStart
}

export const getMonthStart = (date: Date = new Date()): Date =>
  new Date(date.getFullYear(), date.getMonth(), 1)

export const getCurrentWeekTimeStats = async (
  today: Date = new Date(),
): Promise<WeeklyTimeStats> => {
  const { timezone } = await getUserSettings()
  const todayKey = getDateKey(today, timezone)
  const startKey = weekStartKey(todayKey)
  const activities = await getActivityForDateRange(startKey, todayKey)
  const activeSeconds = activities.reduce(
    (total, activity) => total + activity.activeSeconds,
    0,
  )
  const dayCount = activities.length

  return {
    activeSeconds,
    averageSecondsPerDay:
      dayCount > 0 ? Math.floor(activeSeconds / dayCount) : 0,
    dayCount,
    startDate: startKey,
    endDate: todayKey,
  }
}

export const getAllTimeStats = async (): Promise<AllTimeStats> => {
  const activities = Object.values(await getStorageValue('dailyActivities'))
  const activeSeconds = activities.reduce(
    (total, activity) => total + activity.activeSeconds,
    0,
  )

  return {
    activeDays: activities.filter((activity) => activity.activeSeconds > 0).length,
    activeSeconds,
    dayCount: activities.length,
  }
}

export const getCurrentMonthTimeStats = async (
  today: Date = new Date(),
): Promise<MonthlyTimeStats> => {
  const { timezone } = await getUserSettings()
  const todayKey = getDateKey(today, timezone)
  const startKey = `${todayKey.slice(0, 7)}-01`
  const activities = await getActivityForDateRange(startKey, todayKey)
  const activeSeconds = activities.reduce(
    (total, activity) => total + activity.activeSeconds,
    0,
  )

  return {
    activeDays: activities.filter((activity) => activity.activeSeconds > 0).length,
    activeSeconds,
    dayCount: activities.length,
    startDate: startKey,
    endDate: todayKey,
  }
}
