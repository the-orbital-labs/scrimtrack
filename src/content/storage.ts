// Keep runtime helpers in the content-only graph so Vite can inline them into
// Chrome's classic content script. Validated shared-data reads run in the worker.
const scrimbaHosts = new Set(['scrimba.com', 'v2.scrimba.com'])

export type CurrentScrimbaPage = {
  sessionId: string
  url: string
  title: string | null
  startedAt: string
  isActive: boolean
  isIdle: boolean
  lastActiveAt: string | null
  lastInactiveAt: string | null
  lastActivityAt: string | null
  lastIdleAt: string | null
} | null

export type DailyActivity = {
  date: string
  activeSeconds: number
  goalSeconds: number
  goalCompleted: boolean
  sessions: unknown[]
}

export type UserSettings = {
  dailyGoalSeconds: number
  floatingWidgetVisible: boolean
  idleTimeoutSeconds: number
  trackingEnabled: boolean
  timezone: string
}

export type WidgetPosition = {
  x: number
  y: number
}

export const defaultUserSettings: UserSettings = {
  dailyGoalSeconds: 30 * 60,
  floatingWidgetVisible: true,
  idleTimeoutSeconds: 2 * 60,
  trackingEnabled: true,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
}

export const isExtensionContextValid = (): boolean => {
  try {
    return Boolean(chrome.runtime?.id)
  } catch {
    return false
  }
}

export const getExtensionUrl = (path: string): string | null => {
  try {
    return isExtensionContextValid() ? chrome.runtime.getURL(path) : null
  } catch {
    return null
  }
}

export const getLocalDateKey = (
  value: Date = new Date(),
  timezone = defaultUserSettings.timezone,
): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export const getStorageValue = <Value>(
  key: string,
  fallbackValue: Value,
): Promise<Value> => {
  if (['userSettings', 'dailyActivities', 'currentScrimbaPage', 'trackingState'].includes(key)) {
    return requestWidgetMutation<Value>('readStorageValue', key)
  }
  return new Promise((resolve, reject) => {
    try {
      if (!isExtensionContextValid()) {
        throw new Error('Extension unavailable. Reload and try again.')
      }

      chrome.storage.local.get(key, (items) => {
        try {
          if (chrome.runtime.lastError) {
            throw new Error(chrome.runtime.lastError.message ?? 'Storage read failed')
          }
        } catch (error) {
          reject(error)
          return
        }

        resolve((items[key] as Value | undefined) ?? fallbackValue)
      })
    } catch (error) {
      reject(error)
    }
  })
}

export const getUserSettings = async (): Promise<UserSettings> => ({
  ...defaultUserSettings,
  ...(await getStorageValue<Partial<UserSettings>>('userSettings', {})),
})

export const getCurrentScrimbaPage = (): Promise<CurrentScrimbaPage> =>
  getStorageValue<CurrentScrimbaPage>('currentScrimbaPage', null)

export const getTodayActivity = async (
  settings: UserSettings,
): Promise<DailyActivity> => {
  const today = getLocalDateKey(new Date(), settings.timezone)
  const activities = await getStorageValue<Record<string, DailyActivity>>(
    'dailyActivities',
    {},
  )

  return activities[today] ?? {
    date: today,
    activeSeconds: 0,
    goalSeconds: settings.dailyGoalSeconds,
    goalCompleted: false,
    sessions: [],
  }
}

export const requestWidgetMutation = <Result>(command: string, value: unknown): Promise<Result> =>
  new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: 'storage:mutate', command, args: [value] }, (response) => {
        const result = response as { ok?: boolean; value?: Result } | undefined
        if (chrome.runtime.lastError || !result?.ok || result.value === undefined) {
          reject(new Error(chrome.runtime.lastError?.message ?? 'Could not save local data.'))
        } else {
          resolve(result.value)
        }
      })
    } catch (error) {
      reject(error)
    }
  })

export const saveTrackingEnabled = (value: boolean): Promise<UserSettings> =>
  requestWidgetMutation<UserSettings>('saveTrackingEnabled', value)

export const saveFloatingWidgetVisible = (value: boolean): Promise<UserSettings> =>
  requestWidgetMutation<UserSettings>('saveFloatingWidgetVisible', value)

const secondsToMinutes = (seconds: number): number =>
  Math.floor(Math.max(0, seconds) / 60)

export const formatActiveTime = (seconds: number): string => {
  const normalizedSeconds = Math.max(0, Math.floor(seconds))
  const totalMinutes = secondsToMinutes(normalizedSeconds)
  const remainingSeconds = normalizedSeconds % 60

  if (totalMinutes === 0) {
    return `${remainingSeconds}s`
  }

  const secondsText = String(remainingSeconds).padStart(2, '0')

  if (totalMinutes < 60) {
    return `${totalMinutes}m ${secondsText}s`
  }

  const hours = Math.floor(totalMinutes / 60)
  const remainingMinutes = totalMinutes % 60

  return `${hours}h ${remainingMinutes}m ${secondsText}s`
}

export const getGoalProgress = (
  todayActivity: DailyActivity,
  settings: UserSettings,
) => {
  const activeSeconds = todayActivity.activeSeconds
  const goalSeconds = todayActivity.goalSeconds || settings.dailyGoalSeconds
  const isComplete =
    todayActivity.goalCompleted || (goalSeconds > 0 && activeSeconds >= goalSeconds)
  const percentage =
    goalSeconds > 0 ? Math.floor((activeSeconds / goalSeconds) * 100) : 0

  return {
    activeSeconds,
    goalSeconds,
    isComplete,
    remainingSeconds: Math.max(0, goalSeconds - activeSeconds),
    percentage,
    visualPercentage: Math.min(100, percentage),
  }
}

export const isScrimbaUrl = (value: string): boolean => {
  try {
    const url = new URL(value)

    return url.protocol === 'https:' && scrimbaHosts.has(url.hostname)
  } catch {
    return false
  }
}
