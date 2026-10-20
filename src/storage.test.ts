import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLocalDataExport,
  getStorageValue,
  resetLocalData,
  setStorageValue,
  StorageError,
  updateStorageValue,
} from './storage'
import { saveDailyGoal } from './settings'
import {
  failNextStorageOperation,
  installChromeMock,
  uninstallChromeMock,
} from './test/chromeMock'

describe('storage failures', () => {
  beforeEach(() => { installChromeMock() })
  afterEach(uninstallChromeMock)

  it('uses defaults for an absent key after a successful read', async () => {
    vi.spyOn(chrome.storage.local, 'get').mockImplementationOnce((_, callback) => callback({}))
    expect(await getStorageValue('userSettings')).toMatchObject({ dailyGoalSeconds: 1800 })
  })

  it('rejects failed reads instead of returning an empty history', async () => {
    failNextStorageOperation('get')
    await expect(getStorageValue('dailyActivities')).rejects.toMatchObject({
      name: 'StorageError', operation: 'read', key: 'dailyActivities',
    })
  })

  it('does not run an update or write defaults after a failed read', async () => {
    failNextStorageOperation('get')
    const update = vi.fn((value) => value)
    await expect(updateStorageValue('dailyActivities', update)).rejects.toBeInstanceOf(StorageError)
    expect(update).not.toHaveBeenCalled()
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
  })

  it('rejects updates when persistence fails', async () => {
    failNextStorageOperation('set')
    await expect(saveDailyGoal(2700)).rejects.toMatchObject({ operation: 'write' })
    expect((await getStorageValue('userSettings')).dailyGoalSeconds).toBe(1800)
  })

  it('rejects reset if any write fails', async () => {
    failNextStorageOperation('set')
    await expect(resetLocalData({ resetSettings: false })).rejects.toBeInstanceOf(StorageError)
  })

  it('rejects exports instead of exporting fallback data after a failed read', async () => {
    failNextStorageOperation('get')
    await expect(getLocalDataExport()).rejects.toBeInstanceOf(StorageError)
  })

  it('rejects unavailable extension contexts', async () => {
    uninstallChromeMock()
    await expect(getStorageValue('userSettings')).rejects.toBeInstanceOf(StorageError)
    await expect(setStorageValue('dailyActivities', {})).rejects.toBeInstanceOf(StorageError)
  })

  it('rejects synchronous API errors with their original cause', async () => {
    const cause = new Error('Extension context invalidated')
    vi.spyOn(chrome.storage.local, 'set').mockImplementationOnce(() => { throw cause })
    await expect(setStorageValue('dailyActivities', {})).rejects.toMatchObject({
      operation: 'write', cause,
    })
  })
})
