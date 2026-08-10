import type { DailyActivity, StreakStatus } from './storage'

const padDatePart = (value: number): string => String(value).padStart(2, '0')

const getLocalDateKey = (value: Date): string =>
  [
    value.getFullYear(),
    padDatePart(value.getMonth() + 1),
    padDatePart(value.getDate()),
  ].join('-')

const parseLocalDateKey = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number)

  return new Date(year, month - 1, day)
}

const getPreviousLocalDateKey = (dateKey: string): string => {
  const date = parseLocalDateKey(dateKey)

  date.setDate(date.getDate() - 1)

  return getLocalDateKey(date)
}

const isPreviousLocalDate = (
  previousDate: Date | null,
  currentDate: Date,
): boolean => {
  if (!previousDate) {
    return false
  }

  return (
    previousDate.getTime() ===
    new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate() - 1,
    ).getTime()
  )
}

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
  let previousDate: Date | null = null

  for (const dateKey of sortedActiveDates) {
    const currentDate = parseLocalDateKey(dateKey)

    rollingStreak = isPreviousLocalDate(previousDate, currentDate)
      ? rollingStreak + 1
      : 1
    longestStreak = Math.max(longestStreak, rollingStreak)
    previousDate = currentDate
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
    : getPreviousLocalDateKey(today)

  for (
    let cursor = parseLocalDateKey(currentStreakStartDate);
    activeDates.has(getLocalDateKey(cursor));
    cursor.setDate(cursor.getDate() - 1)
  ) {
    currentStreak += 1
  }

  return {
    currentStreak,
    longestStreak,
    lastCalculatedAt: new Date().toISOString(),
  }
}
