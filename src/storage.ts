import { assertStorageHost, defineStorageMutation } from './storageMutations'
import type { ScrimbaCourseProgress } from './scrimbaCourse'
import type { TrackingState } from './trackingProtocol'
import { DataValidationError, storageVersion, validateStorageValue, validateVersion } from './storageValidation'
import { getDateKey } from './calendar'
import { calculateStreakStatus } from './streak'

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
  storageVersion: typeof storageVersion
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
  schemaVersion: typeof storageVersion
}

const defaultStorageValues: StorageSchema = {
  storageVersion,
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
  value: unknown,
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
    const merged = {
      ...defaultValue,
      ...value,
    }
    validateStorageValue(key, merged)
    return merged
  }

  validateStorageValue(key, value)
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

      chrome.storage.local.get([key, 'storageVersion'], (items) => {
        try {
          if (chrome.runtime.lastError) {
            throw new Error(chrome.runtime.lastError.message ?? 'Storage read failed')
          }

          validateVersion(items.storageVersion)
          if (items.storageVersion === storageVersion && items[key] !== undefined) {
            validateStorageValue(key, items[key])
            resolve(items[key])
          } else {
            resolve(withDefaultStorageValue(key, items[key]))
          }
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
      for (const key of Object.keys(values) as StorageKey[]) validateStorageValue(key, values[key])
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
      storageVersion,
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

// Read one snapshot so an export cannot mix values from different commits.
const readStorageSnapshot = (): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
  try {
    if (!isExtensionContextValid()) throw new Error('Extension unavailable. Reload the page and try again.')
    chrome.storage.local.get(null, (items) => {
      if (chrome.runtime.lastError) reject(new StorageError('read', 'storageVersion', chrome.runtime.lastError))
      else resolve(items)
    })
  } catch (error) { reject(new StorageError('read', 'storageVersion', error)) }
})

// Versions 0 (unversioned), 1 and 2 used the same activity/session shape.
// Their additive settings/path fields and tracking ledger were introduced over
// time. Fill only missing fields; malformed present values must still fail.
export const migrateStorageSnapshot = (raw: Record<string, unknown>): StorageSchema => {
  validateVersion(raw.storageVersion)
  const legacy = raw.storageVersion !== storageVersion
  const migrated = Object.fromEntries((Object.keys(defaultStorageValues) as StorageKey[]).map((key) => {
    if (key === 'storageVersion') return [key, storageVersion]
    const value = legacy ? withDefaultStorageValue(key, raw[key]) : raw[key]
    validateStorageValue(key, value)
    return [key, value]
  })) as StorageSchema
  return migrated
}

export const ensureStorageMigrated = async (): Promise<void> => {
  const raw = await readStorageSnapshot()
  const migrated = migrateStorageSnapshot(raw)
  if (raw.storageVersion !== storageVersion) await setStorageValues(migrated)
}

// Content scripts stay classic, self-contained scripts. Route their reads
// through the worker rather than bundling the dashboard's storage modules.
defineStorageMutation('readStorageValue', async (key: StorageKey) => {
  if (!Object.hasOwn(defaultStorageValues, key)) throw new DataValidationError('storage key')
  return getStorageValue(key)
})

export const getLocalDataExport = defineStorageMutation('getLocalDataExport', async (): Promise<LocalDataExport> => ({
  app: 'scrimtrack',
  data: migrateStorageSnapshot(await readStorageSnapshot()),
  exportedAt: new Date().toISOString(),
  schemaVersion: storageVersion,
}))

export const maxImportBytes = 10 * 1024 * 1024

export const parseLocalDataImport = (json: string): StorageSchema => {
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > maxImportBytes) {
    throw new Error('Import must be a JSON export smaller than 10 MB. No data was changed.')
  }
  let file: unknown
  try {
    file = JSON.parse(json, (key, value: unknown) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe key')
      return value
    })
  } catch { throw new Error('This file is not valid ScrimTrack JSON. No data was changed.') }
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new DataValidationError('export')
  const envelope = file as Record<string, unknown>
  if (![1, 2, storageVersion].includes(envelope.schemaVersion as number) ||
    !(envelope.app === 'scrimtrack' || (envelope.schemaVersion === 1 && envelope.app === 'scrimba-learning-tracker'))) {
    throw new Error('Unsupported ScrimTrack export or version. No data was changed.')
  }
  if (typeof envelope.exportedAt !== 'string' || !Number.isFinite(Date.parse(envelope.exportedAt)) ||
    !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) throw new DataValidationError('export')
  const raw = envelope.data as Record<string, unknown>
  // An export must contain the user's durable data. A random/incomplete object
  // must never become a valid empty replacement through migration defaults.
  for (const key of ['dailyActivities', 'userSettings', 'pathProgress']) {
    if (!Object.hasOwn(raw, key)) throw new DataValidationError(`export.data.${key}`)
  }
  if (envelope.schemaVersion !== storageVersion) {
    for (const [key, fields] of Object.entries({
      userSettings: ['dailyGoalSeconds', 'idleTimeoutSeconds', 'trackingEnabled', 'timezone'],
      pathProgress: ['pathName', 'totalEstimatedHours', 'progressPercentage', 'averageWindowDays'],
    })) {
      const value = raw[key]
      if (!value || typeof value !== 'object' || fields.some((field) => !Object.hasOwn(value, field))) throw new DataValidationError(key)
    }
  }
  if (envelope.schemaVersion === storageVersion && raw.storageVersion !== storageVersion) throw new DataValidationError('storageVersion')
  if (envelope.schemaVersion !== storageVersion && raw.storageVersion !== undefined) throw new DataValidationError('storageVersion')
  return migrateStorageSnapshot(raw)
}

// Replace, never merge: re-importing the same file cannot double history.
// The worker validates again rather than trusting a preview in another context.
export const importLocalData = defineStorageMutation('importLocalData', async (json: string): Promise<StorageSchema> => {
  const imported = parseLocalDataImport(json)
  const now = new Date().toISOString()
  const activities = Object.fromEntries(Object.entries(imported.dailyActivities).map(([key, day]) => [key, {
    ...day,
    goalCompleted: day.goalSeconds > 0 && day.activeSeconds >= day.goalSeconds,
    sessions: day.sessions.map((session) => ({ ...session, isActive: false,
      endedAt: session.endedAt ?? (session.startedAt > now ? session.startedAt : now) })),
  }]))
  const next: StorageSchema = {
    ...imported,
    extensionStatus: await getStorageValue('extensionStatus'),
    trackingState: { epoch: crypto.randomUUID(), sessions: {} },
    currentScrimbaPage: null,
    dailyActivities: activities,
    streakStatus: calculateStreakStatus(activities, getDateKey(now, imported.userSettings.timezone)),
  }
  await setStorageValues(next)
  return next
})
