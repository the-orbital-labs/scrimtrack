import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureStorageMigrated, getLocalDataExport, getStorageValue, importLocalData,
  maxImportBytes, migrateStorageSnapshot, parseLocalDataImport, setStorageValue } from './storage'
import { applyTrackingUpdate } from './tracking'
import { failNextStorageOperation, installChromeMock, uninstallChromeMock } from './test/chromeMock'
import type { StorageSchema } from './storage'

describe('storage validation, migration and import', () => {
  let store: ReturnType<typeof installChromeMock>
  let backup: { app: string; schemaVersion: number; exportedAt: string; data: StorageSchema }
  beforeEach(async () => {
    store = installChromeMock()
    store.data.dailyActivities = { '2026-10-20': { date: '2026-10-20', activeSeconds: 120,
      goalSeconds: 60, goalCompleted: true, sessions: [{ id: 's1', url: 'https://scrimba.com/lesson',
        title: null, startedAt: '2026-10-20T12:00:00.000Z', endedAt: null, isActive: true, activeSeconds: 120 }] } }
    backup = await getLocalDataExport()
    vi.mocked(chrome.storage.local.set).mockClear()
  })
  afterEach(uninstallChromeMock)
  const json = (value: unknown) => JSON.stringify(value)

  it('migrates an unversioned installation once without changing history or unrelated keys', async () => {
    Reflect.deleteProperty(store.data, 'storageVersion')
    Reflect.deleteProperty(store.data, 'trackingState')
    Reflect.deleteProperty(store.data.userSettings, 'floatingWidgetVisible')
    Object.assign(store.data, { widgetPosition: { x: 10, y: 20 } })
    const history = structuredClone(store.data.dailyActivities)
    await ensureStorageMigrated()
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1)
    expect(store.data).toMatchObject({ storageVersion: 3, trackingState: { epoch: 'initial', sessions: {} },
      userSettings: { floatingWidgetVisible: true }, widgetPosition: { x: 10, y: 20 } })
    expect(store.data.dailyActivities).toEqual(history)
    await ensureStorageMigrated()
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1)
  })

  it('does not advance the version after a failed migration and can retry', async () => {
    Reflect.deleteProperty(store.data, 'storageVersion')
    const before = structuredClone(store.data)
    failNextStorageOperation('set')
    await expect(ensureStorageMigrated()).rejects.toThrow()
    expect(store.data).toEqual(before)
    await ensureStorageMigrated()
    expect(store.data.storageVersion).toBe(3)
  })

  it.each([99, -1, '3', null, 2.5])('refuses unsupported stored version %s without writing', async (version) => {
    Object.assign(store.data, { storageVersion: version })
    await expect(ensureStorageMigrated()).rejects.toThrow('unsupported storage version')
    await expect(getStorageValue('dailyActivities')).rejects.toThrow()
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
  })

  it('reports corrupted stored history instead of erasing it during migration', async () => {
    Reflect.deleteProperty(store.data, 'storageVersion')
    store.data.dailyActivities['2026-10-20'].activeSeconds = -1
    const before = structuredClone(store.data)
    await expect(ensureStorageMigrated()).rejects.toThrow('Invalid local data')
    expect(store.data).toEqual(before)
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
  })

  it('rejects malformed reads and writes at the storage boundary', async () => {
    store.data.userSettings.timezone = 'Bad/Zone'
    await expect(getStorageValue('userSettings')).rejects.toThrow()
    await expect(setStorageValue('dailyActivities', [] as never)).rejects.toThrow()
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
  })

  it.each([1, 2])('migrates historical export version %s with missing additive fields', (version) => {
    const data = structuredClone(backup.data) as Partial<StorageSchema>
    delete data.storageVersion
    delete data.trackingState
    if (version === 1) {
      Reflect.deleteProperty(data.userSettings!, 'floatingWidgetVisible')
      for (const field of ['courseUrl', 'detectedCourses', 'lastProgressSyncAt', 'progressSource', 'selectedCourseId']) {
        Reflect.deleteProperty(data.pathProgress!, field)
      }
    }
    const migrated = parseLocalDataImport(json({ ...backup, data, schemaVersion: version,
      app: version === 1 ? 'scrimba-learning-tracker' : 'scrimtrack' }))
    expect(migrated).toMatchObject({ storageVersion: 3, userSettings: { floatingWidgetVisible: true },
      pathProgress: { detectedCourses: {}, progressSource: 'manual' } })
    expect(migrated.dailyActivities).toEqual(backup.data.dailyActivities)
    expect(migrateStorageSnapshot(migrated)).toEqual(migrated)
  })

  const invalidCases: [string, (data: StorageSchema) => void][] = [
    ['negative time', (data) => { data.dailyActivities['2026-10-20'].activeSeconds = -1 }],
    ['fractional time', (data) => { data.dailyActivities['2026-10-20'].activeSeconds = 1.5 }],
    ['unsafe integer', (data) => { data.dailyActivities['2026-10-20'].activeSeconds = 1e30 }],
    ['invalid date', (data) => { data.dailyActivities['2026-02-30'] = data.dailyActivities['2026-10-20'] }],
    ['mismatched date', (data) => { data.dailyActivities['2026-10-20'].date = '2026-10-21' }],
    ['sessions shape', (data) => { data.dailyActivities['2026-10-20'].sessions = {} as never }],
    ['duplicate session', (data) => { const day = data.dailyActivities['2026-10-20']; day.sessions.push(day.sessions[0]) }],
    ['session time exceeds total', (data) => { data.dailyActivities['2026-10-20'].sessions[0].activeSeconds = 121 }],
    ['invalid URL', (data) => { data.dailyActivities['2026-10-20'].sessions[0].url = 'https://scrimba.com.evil.test/lesson' }],
    ['invalid timestamp', (data) => { data.dailyActivities['2026-10-20'].sessions[0].startedAt = 'yesterday' }],
    ['invalid timezone', (data) => { data.userSettings.timezone = 'Bad/Zone' }],
    ['invalid boolean', (data) => { data.userSettings.trackingEnabled = 'yes' as never }],
    ['invalid goal', (data) => { data.userSettings.dailyGoalSeconds = 0 }],
    ['invalid path', (data) => { data.pathProgress.progressPercentage = 101 }],
    ['invalid course', (data) => { data.pathProgress.detectedCourses = { c0j: {} as never } }],
    ['invalid receipt', (data) => { data.trackingState.sessions = { s1: {} as never } }],
    ['missing current field', (data) => { Reflect.deleteProperty(data.userSettings, 'timezone') }],
    ['missing history', (data) => { Reflect.deleteProperty(data, 'dailyActivities') }],
  ]
  it.each(invalidCases)('rejects %s before changing any data', async (_, corrupt) => {
    corrupt(backup.data)
    const before = structuredClone(store.data)
    await expect(importLocalData(json(backup))).rejects.toThrow()
    expect(store.data).toEqual(before)
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
  })

  it.each(['{broken', '{}', '[]', '{"app":"other"}',
    '{"__proto__":{"polluted":true}}'])('rejects invalid envelopes and unsafe keys: %s', (value) => {
    expect(() => parseLocalDataImport(value)).toThrow()
  })

  it('rejects oversized files and future export versions', () => {
    expect(() => parseLocalDataImport(' '.repeat(maxImportBytes + 1))).toThrow('10 MB')
    expect(() => parseLocalDataImport(json({ ...backup, schemaVersion: 99 }))).toThrow('Unsupported')
  })

  it('replaces history and settings atomically, recomputes derived data and stops imported sessions', async () => {
    backup.data.userSettings.dailyGoalSeconds = 600
    backup.data.streakStatus.longestStreak = 999
    backup.data.dailyActivities['2026-10-20'].goalCompleted = false
    store.data.dailyActivities['2026-10-19'] = { ...store.data.dailyActivities['2026-10-20'], date: '2026-10-19' }
    const next = await importLocalData(json(backup))
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1)
    expect(next.trackingState.epoch).not.toBe('initial')
    expect(next.trackingState.sessions).toEqual({})
    expect(next.currentScrimbaPage).toBeNull()
    expect(Object.keys(next.dailyActivities)).toEqual(['2026-10-20'])
    expect(next.dailyActivities['2026-10-20']).toMatchObject({ goalCompleted: true, sessions: [{ isActive: false, endedAt: expect.any(String) }] })
    expect(next.userSettings.dailyGoalSeconds).toBe(600)
    expect(next.streakStatus.longestStreak).toBe(1)
    expect(next.extensionStatus).toEqual(store.data.extensionStatus)
    await importLocalData(json(backup))
    expect(store.data.dailyActivities['2026-10-20'].activeSeconds).toBe(120)
    const reply = await applyTrackingUpdate({ type: 'scrimba:tracking-update', epoch: 'initial', sessionId: 'old',
      sequence: 1, kind: 'start', from: '2026-10-20T12:00:00.000Z', at: '2026-10-20T12:00:00.000Z',
      url: 'https://scrimba.com/lesson', title: null, isMediaPlaying: false })
    expect(reply.error).toBe('tracking-reset')
    expect(store.data.currentScrimbaPage).toBeNull()
  })

  it('leaves every existing value and tracking generation intact when import persistence fails', async () => {
    const before = structuredClone(store.data)
    backup.data.userSettings.dailyGoalSeconds = 600
    failNextStorageOperation('set')
    await expect(importLocalData(json(backup))).rejects.toThrow()
    expect(store.data).toEqual(before)
  })
})
