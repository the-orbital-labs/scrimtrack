import { getDateKey } from './calendar'
import { defineStorageMutation } from './storageMutations'
import { getStorageValue, setStorageValue, setStorageValues, updateStorageValue } from './storage'
import type { UserSettings } from './storage'
import { calculateStreakStatus } from './streak'

const maxDailyGoalSeconds = 24 * 60 * 60

const toNonNegativeSeconds = (value: number): number =>
  Math.max(0, Math.floor(value))

const normalizeDailyGoalSeconds = (value: number): number => {
  const seconds = Math.floor(value)

  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > maxDailyGoalSeconds) {
    throw new Error('Daily goal must be between 1 minute and 24 hours.')
  }

  return seconds
}

const normalizeTimezone = (timezone: string): string => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone })

    return timezone
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  }
}

export const getUserSettings = (): Promise<UserSettings> =>
  getStorageValue('userSettings')

export const saveDailyGoal = defineStorageMutation(
  'saveDailyGoal',
  async (
    dailyGoalSeconds: number,
  ): Promise<UserSettings> => {
    const normalizedDailyGoalSeconds = normalizeDailyGoalSeconds(dailyGoalSeconds)
    const settings = await updateStorageValue('userSettings', (currentSettings) => ({
      ...currentSettings,
      dailyGoalSeconds: normalizedDailyGoalSeconds,
    }))
    const today = getDateKey(new Date(), settings.timezone)

    const activities = await updateStorageValue('dailyActivities', (currentActivities) => {
      const activity = currentActivities[today] ?? {
        date: today,
        activeSeconds: 0,
        goalSeconds: normalizedDailyGoalSeconds,
        goalCompleted: false,
        sessions: [],
      }

      return {
        ...currentActivities,
        [today]: {
          ...activity,
          goalSeconds: normalizedDailyGoalSeconds,
          goalCompleted: activity.activeSeconds >= normalizedDailyGoalSeconds,
        },
      }
    })
    await setStorageValue('streakStatus', calculateStreakStatus(activities, today))

    return settings
  },
)

export const saveIdleTimeout = defineStorageMutation(
  'saveIdleTimeout',
  (
    idleTimeoutSeconds: number,
  ): Promise<UserSettings> =>
    updateStorageValue('userSettings', (settings) => ({
      ...settings,
      idleTimeoutSeconds: toNonNegativeSeconds(idleTimeoutSeconds),
    })),
)

export const saveTrackingEnabled = defineStorageMutation(
  'saveTrackingEnabled',
  async (trackingEnabled: boolean): Promise<UserSettings> => {
    const [settings, state, page, activities] = await Promise.all([
      getUserSettings(), getStorageValue('trackingState'),
      getStorageValue('currentScrimbaPage'), getStorageValue('dailyActivities'),
    ])
    const next = { ...settings, trackingEnabled }
    if (trackingEnabled) {
      await setStorageValue('userSettings', next)
    } else {
      const at = new Date().toISOString()
      await setStorageValues({
        userSettings: next,
        trackingState: { ...state, sessions: Object.fromEntries(Object.entries(state.sessions).map(([id, record]) =>
          [id, { ...record, activeUntil: record.activeUntil ?? at }])) },
        currentScrimbaPage: page ? { ...page, isActive: false, isIdle: true, lastInactiveAt: at, lastIdleAt: at } : null,
        dailyActivities: Object.fromEntries(Object.entries(activities).map(([date, day]) => [date, {
          ...day, sessions: day.sessions.map((session) => session.isActive
            ? { ...session, isActive: false, endedAt: at } : session),
        }])),
      })
    }
    return next
  },
)

export const saveFloatingWidgetVisible = defineStorageMutation(
  'saveFloatingWidgetVisible',
  (
    floatingWidgetVisible: boolean,
  ): Promise<UserSettings> =>
    updateStorageValue('userSettings', (settings) => ({
      ...settings,
      floatingWidgetVisible,
    })),
)

export const saveTimezone = defineStorageMutation(
  'saveTimezone',
  (timezone: string): Promise<UserSettings> =>
    updateStorageValue('userSettings', (settings) => ({
      ...settings,
      timezone: normalizeTimezone(timezone),
    })),
)

export const ensureUserSettings = async (): Promise<UserSettings> => {
  const settings = await getUserSettings()

  await setStorageValue('userSettings', settings)

  return settings
}
