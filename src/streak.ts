import { addCalendarDays } from './calendar'
import type { DailyActivity, StreakStatus } from './storage'

const calculateLongestActiveStreak = (
  activities: Record<string, DailyActivity>,
): number => {
  const sortedActiveDates = [
    ...new Set(
      Object.values(activities)
        .filter((activity) => activity.activeSeconds > 0)
        .map((activity) => activity.date),
    ),
  ].sort()
  let longestStreak = 0
  let rollingStreak = 0
  let previousDate: string | null = null

  for (const dateKey of sortedActiveDates) {
    rollingStreak = previousDate === addCalendarDays(dateKey, -1)
      ? rollingStreak + 1
      : 1
    longestStreak = Math.max(longestStreak, rollingStreak)
    previousDate = dateKey
  }

  return longestStreak
}

export const calculateStreakStatus = (
  activities: Record<string, DailyActivity>,
  today: string,
): StreakStatus => {
  const activeDates = new Set(
    Object.values(activities)
      .filter((activity) => activity.activeSeconds > 0)
      .map((activity) => activity.date),
  )
  const longestStreak = calculateLongestActiveStreak(activities)

  let currentStreak = 0
  const currentStreakStartDate = activeDates.has(today)
    ? today
    : addCalendarDays(today, -1)

  for (
    let cursor = currentStreakStartDate;
    activeDates.has(cursor);
    cursor = addCalendarDays(cursor, -1)
  ) {
    currentStreak += 1
  }

  return {
    currentStreak,
    longestStreak,
    lastCalculatedAt: new Date().toISOString(),
  }
}
