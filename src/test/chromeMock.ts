import { vi } from 'vitest'
import type { StorageSchema } from '../storage'

type StorageChange = {
  newValue?: unknown
  oldValue?: unknown
}

type StorageChangeListener = (
  changes: Record<string, StorageChange>,
  areaName: string,
) => void

export type ChromeMock = {
  data: StorageSchema
  emitStorageChange: (
    changes: Record<string, StorageChange>,
    areaName?: string,
  ) => void
  listenerCount: () => number
  openOptionsPage: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
  tabsCreate: ReturnType<typeof vi.fn>
}

const clone = <Value>(value: Value): Value =>
  JSON.parse(JSON.stringify(value)) as Value

const createDefaultStorage = (): StorageSchema => ({
  extensionStatus: {
    installedAt: null,
    lastStartedAt: null,
    version: '0.3.0',
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
    timezone: 'UTC',
  },
  pathProgress: {
    averageWindowDays: 7,
    courseUrl: null,
    detectedCourses: {},
    lastProgressSyncAt: null,
    pathName: '',
    progressPercentage: 0,
    progressSource: 'manual',
    selectedCourseId: null,
    totalEstimatedHours: 1,
  },
})

export const installChromeMock = (
  overrides: Partial<StorageSchema> = {},
): ChromeMock => {
  const data: StorageSchema = {
    ...createDefaultStorage(),
    ...clone(overrides),
  }
  const listeners = new Set<StorageChangeListener>()
  const openOptionsPage = vi.fn()
  const tabsCreate = vi.fn()
  const removeListener = vi.fn((listener: StorageChangeListener) => {
    listeners.delete(listener)
  })
  const emitStorageChange = (
    changes: Record<string, StorageChange>,
    areaName = 'local',
  ) => {
    listeners.forEach((listener) => listener(clone(changes), areaName))
  }

  const chromeMock = {
    runtime: {
      id: 'scrimtrack-test-extension',
      getManifest: () => ({ version: '0.3.0' }),
      getURL: (path: string) => `chrome-extension://scrimtrack-test-extension/${path}`,
      openOptionsPage,
    },
    storage: {
      onChanged: {
        addListener: vi.fn((listener: StorageChangeListener) => {
          listeners.add(listener)
        }),
        removeListener,
      },
      local: {
        get: vi.fn((
          keys: string | string[] | Record<string, unknown> | null,
          callback: (items: Record<string, unknown>) => void,
        ) => {
          if (typeof keys === 'string') {
            callback({ [keys]: clone(data[keys as keyof StorageSchema]) })
            return
          }

          if (Array.isArray(keys)) {
            callback(Object.fromEntries(
              keys.map((key) => [key, clone(data[key as keyof StorageSchema])]),
            ))
            return
          }

          if (keys === null) {
            callback(clone(data))
            return
          }

          callback(Object.fromEntries(
            Object.entries(keys).map(([key, fallback]) => [
              key,
              clone(data[key as keyof StorageSchema] ?? fallback),
            ]),
          ))
        }),
        set: vi.fn((items: Record<string, unknown>, callback?: () => void) => {
          const changes = Object.fromEntries(
            Object.entries(items).map(([key, value]) => {
              const storageKey = key as keyof StorageSchema
              const oldValue = clone(data[storageKey])

              data[storageKey] = clone(value) as never

              return [key, { oldValue, newValue: clone(value) }]
            }),
          )

          callback?.()
          emitStorageChange(changes)
        }),
      },
    },
    tabs: {
      create: tabsCreate,
    },
  }

  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: chromeMock,
    writable: true,
  })

  return {
    data,
    emitStorageChange,
    listenerCount: () => listeners.size,
    openOptionsPage,
    removeListener,
    tabsCreate,
  }
}

export const uninstallChromeMock = () => {
  Reflect.deleteProperty(globalThis, 'chrome')
}
