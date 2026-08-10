import type { StreakStatus } from './storage'

export type StreakDisplayState = {
  currentLabel: string
  longestLabel: string
  message: string
  tone: 'complete' | 'pending' | 'empty'
}

const pluralizeDay = (days: number): string => (days === 1 ? 'day' : 'days')

export const getStreakDisplayState = (
  streakStatus: StreakStatus | null,
  todayActiveSeconds: number,
): StreakDisplayState => {
  const currentStreak = streakStatus?.currentStreak ?? 0
  const longestStreak = streakStatus?.longestStreak ?? 0
  const currentLabel = `${currentStreak}-${pluralizeDay(currentStreak)} streak`
  const longestLabel = `${longestStreak}-${pluralizeDay(longestStreak)} best`

  if (todayActiveSeconds > 0) {
    return {
      currentLabel,
      longestLabel,
      message: 'Active today - streak protected',
      tone: 'complete',
    }
  }

  return {
    currentLabel,
    longestLabel,
    message:
      currentStreak > 0
        ? 'Practice today to keep your streak'
        : 'Practice today to start a streak',
    tone: currentStreak > 0 ? 'pending' : 'empty',
  }
}
