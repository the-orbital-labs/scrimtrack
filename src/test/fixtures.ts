import { getLocalDateKey } from '../activity'
import type { DailyActivity, StorageSchema } from '../storage'

const addDays = (date: Date, amount: number): Date => {
  const nextDate = new Date(date)

  nextDate.setDate(nextDate.getDate() + amount)

  return nextDate
}

const createActivity = (
  date: Date,
  activeSeconds: number,
): DailyActivity => ({
  activeSeconds,
  date: getLocalDateKey(date),
  goalCompleted: activeSeconds >= 30 * 60,
  goalSeconds: 30 * 60,
  sessions: [],
})

export const createComponentTestStorage = (): Partial<StorageSchema> => {
  const today = new Date()
  const activities = [
    createActivity(addDays(today, -2), 45 * 60),
    createActivity(addDays(today, -1), 35 * 60),
    createActivity(today, 20 * 60),
  ]

  return {
    dailyActivities: Object.fromEntries(
      activities.map((activity) => [activity.date, activity]),
    ),
    pathProgress: {
      averageWindowDays: 7,
      courseUrl: 'https://scrimba.com/frontend-path-c0j',
      detectedCourses: {},
      lastProgressSyncAt: null,
      pathName: 'Frontend Developer Path',
      progressPercentage: 25,
      progressSource: 'manual',
      selectedCourseId: 'c0j',
      totalEstimatedHours: 80,
    },
    streakStatus: {
      currentStreak: 3,
      longestStreak: 3,
      lastCalculatedAt: today.toISOString(),
    },
    userSettings: {
      dailyGoalSeconds: 30 * 60,
      floatingWidgetVisible: false,
      idleTimeoutSeconds: 2 * 60,
      trackingEnabled: true,
      timezone: 'UTC',
    },
  }
}
