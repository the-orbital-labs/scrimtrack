import { assertStorageHost, defineStorageMutation } from './storageMutations'
import type { ScrimbaCourseProgress } from './scrimbaCourse'
import type { TrackingState } from './trackingProtocol'

export type ExtensionStatus = {
  installedAt: string | null
  lastStartedAt: string | null
  version: string | null
}

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

export type LearningSession = {
  id: string
  url: string
  title: string | null
  startedAt: string
  isActive: boolean
  endedAt: string | null
  activeSeconds: number
}

export type DailyActivity = {
  date: string
  activeSeconds: number
  goalSeconds: number
  goalCompleted: boolean
  sessions: LearningSession[]
}

export type StreakStatus = {
  currentStreak: number
  longestStreak: number
  lastCalculatedAt: string | null
}

export type UserSettings = {
  dailyGoalSeconds: number
  floatingWidgetVisible: boolean
  idleTimeoutSeconds: number
  trackingEnabled: boolean
  timezone: string
}

export type AverageWindowDays = 7 | 14 | 30 | 'all'

export type PathProgress = {
  courseUrl: string | null
  detectedCourses: Record<string, ScrimbaCourseProgress>
  lastProgressSyncAt: string | null
  pathName: string
  progressSource: 'manual' | 'scrimba'
  totalEstimatedHours: number
  progressPercentage: number
  selectedCourseId: string | null
  averageWindowDays: AverageWindowDays
}

export type StorageSchema = {
  trackingState: TrackingState
  extensionStatus: ExtensionStatus
  currentScrimbaPage: CurrentScrimbaPage
  dailyActivities: Record<string, DailyActivity>
  streakStatus: StreakStatus
  userSettings: UserSettings
  pathProgress: PathProgress
}

export type StorageKey = keyof StorageSchema

export type ResetLocalDataOptions = {
  resetSettings: boolean
}

export type LocalDataExport = {
  app: 'scrimtrack'
  data: StorageSchema
  exportedAt: string
  schemaVersion: 2
}

const defaultStorageValues: StorageSchema = {
  trackingState: { epoch: 'initial', sessions: {} },
  extensionStatus: {
    installedAt: null,
    lastStartedAt: null,
    version: null,
  },
  currentScrimbaPage: null,
  dailyActivities: {},
  streakStatus: {
    currentStreak: 0,
    longestStreak: 0,
    lastCalculatedAt: null,
  },
  userSettings: {
    dailyGoalSeconds: 30 * 60,
    floatingWidgetVisible: true,
    idleTimeoutSeconds: 2 * 60,
    trackingEnabled: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  },
  pathProgress: {
    courseUrl: null,
    detectedCourses: {},
    lastProgressSyncAt: null,
    pathName: '',
    progressSource: 'manual',
    totalEstimatedHours: 1,
    progressPercentage: 0,
    selectedCourseId: null,
    averageWindowDays: 7,
  },
}

const cloneStorageValue = <Value>(value: Value): Value => {
  if (value === null || typeof value !== 'object') {
    return value
  }

  return JSON.parse(JSON.stringify(value)) as Value
}

const getDefaultStorageValue = <Key extends StorageKey>(
  key: Key,
): StorageSchema[Key] => cloneStorageValue(defaultStorageValues[key])

const withDefaultStorageValue = <Key extends StorageKey>(
  key: Key,
  value: StorageSchema[Key] | undefined,
): StorageSchema[Key] => {
  const defaultValue = getDefaultStorageValue(key)

  if (value === undefined) {
    return defaultValue
  }

  if (
    value !== null &&
    defaultValue !== null &&
    typeof value === 'object' &&
    typeof defaultValue === 'object' &&
    !Array.isArray(value) &&
    !Array.isArray(defaultValue)
  ) {
    return {
      ...defaultValue,
      ...value,
    }
  }

  return value
}

const isExtensionContextValid = (): boolean => {
  try {
    return Boolean(chrome.runtime?.id)
  } catch {
    return false
  }
}

export class StorageError extends Error {
  readonly operation: 'read' | 'write'
  readonly key: StorageKey

  constructor(
    operation: 'read' | 'write',
    key: StorageKey,
    cause: unknown,
  ) {
    super(`Could not ${operation} local data (${key}).`, { cause })
    this.name = 'StorageError'
    this.operation = operation
    this.key = key
  }
}

export const getStorageValue = <Key extends StorageKey>(
  key: Key,
): Promise<StorageSchema[Key]> =>
  new Promise((resolve, reject) => {
    try {
      if (!isExtensionContextValid()) {
        throw new Error('Extension unavailable. Reload the page and try again.')
      }

      chrome.storage.local.get(key, (items) => {
        try {
          if (chrome.runtime.lastError) {
            throw new Error(chrome.runtime.lastError.message ?? 'Storage read failed')
          }

          const value = items[key] as StorageSchema[Key] | undefined
          resolve(withDefaultStorageValue(key, value))
        } catch (error) {
          reject(new StorageError('read', key, error))
        }
      })
    } catch (error) {
      reject(new StorageError('read', key, error))
    }
  })

export const setStorageValue = <Key extends StorageKey>(
  key: Key,
  value: StorageSchema[Key],
): Promise<boolean> =>
  setStorageValues({ [key]: value })

// Commit related values and their delivery receipt in the same storage operation.
export const setStorageValues = (values: Partial<StorageSchema>): Promise<boolean> =>
  new Promise((resolve, reject) => {
    try {
      assertStorageHost()
      if (!isExtensionContextValid()) {
        throw new Error('Extension unavailable. Reload the page and try again.')
      }

      chrome.storage.local.set(values, () => {
        try {
          if (chrome.runtime.lastError) {
            throw new Error(chrome.runtime.lastError.message ?? 'Storage write failed')
          }
          resolve(true)
        } catch (error) {
          reject(new StorageError('write', Object.keys(values)[0] as StorageKey, error))
        }
      })
    } catch (error) {
      reject(new StorageError('write', Object.keys(values)[0] as StorageKey, error))
    }
  })

export const updateStorageValue = async <Key extends StorageKey>(
  key: Key,
  update: (currentValue: StorageSchema[Key]) => StorageSchema[Key],
): Promise<StorageSchema[Key]> => {
  const currentValue = await getStorageValue(key)
  const nextValue = update(currentValue)

  await setStorageValue(key, nextValue)

  return nextValue
}

export const resetLocalData = defineStorageMutation(
  'resetLocalData',
  async ({
    resetSettings,
  }: ResetLocalDataOptions): Promise<StorageSchema> => {
    const nextUserSettings = resetSettings
      ? getDefaultStorageValue('userSettings')
      : await getStorageValue('userSettings')
    const nextPathProgress = resetSettings
      ? getDefaultStorageValue('pathProgress')
      : await getStorageValue('pathProgress')

    const nextStorage: StorageSchema = {
      trackingState: { epoch: crypto.randomUUID(), sessions: {} },
      extensionStatus: await getStorageValue('extensionStatus'),
      currentScrimbaPage: getDefaultStorageValue('currentScrimbaPage'),
      dailyActivities: getDefaultStorageValue('dailyActivities'),
      streakStatus: getDefaultStorageValue('streakStatus'),
      userSettings: nextUserSettings,
      pathProgress: nextPathProgress,
    }

    await setStorageValues(nextStorage)

    return nextStorage
  },
)

export const getLocalDataExport = async (): Promise<LocalDataExport> => {
  const [
    extensionStatus,
    currentScrimbaPage,
    dailyActivities,
    streakStatus,
    userSettings,
    pathProgress,
  ] = await Promise.all([
    getStorageValue('extensionStatus'),
    getStorageValue('currentScrimbaPage'),
    getStorageValue('dailyActivities'),
    getStorageValue('streakStatus'),
    getStorageValue('userSettings'),
    getStorageValue('pathProgress'),
  ])

  return {
    app: 'scrimtrack',
    data: {
      trackingState: await getStorageValue('trackingState'),
      extensionStatus,
      currentScrimbaPage,
      dailyActivities,
      streakStatus,
      userSettings,
      pathProgress,
    },
    exportedAt: new Date().toISOString(),
    schemaVersion: 2,
  }
}
