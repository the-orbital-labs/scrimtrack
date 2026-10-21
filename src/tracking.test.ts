import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installChromeMock, uninstallChromeMock, failNextStorageOperation } from './test/chromeMock'
import { applyTrackingUpdate, deliverTrackingUpdate, replayTrackingOutbox } from './tracking'
import { resetLocalData } from './storage'
import { enableStorageHost } from './storageMutations'
import type { TrackingUpdate } from './trackingProtocol'

describe('persisted tracking receipts', () => {
  let store: ReturnType<typeof installChromeMock>
  const at = (seconds: number) => new Date(Date.UTC(2026, 9, 21, 12, 0, seconds)).toISOString()
  const update = (kind: TrackingUpdate['kind'], sequence: number, from = 0, until = from, sessionId = 'session-a'): TrackingUpdate => ({
    type: 'scrimba:tracking-update', epoch: 'initial', sessionId, sequence, kind,
    from: at(from), at: at(until), url: 'https://scrimba.com/lesson', title: 'Lesson', isMediaPlaying: false,
  })
  const total = () => Object.values(store.data.dailyActivities).reduce((sum, day) => sum + day.activeSeconds, 0)

  beforeEach(async () => {
    store = installChromeMock()
    enableStorageHost()
    await applyTrackingUpdate(update('start', 1))
  })
  afterEach(uninstallChromeMock)

  it('commits the receipt, totals, streak and page before acknowledging', async () => {
    const original = vi.mocked(chrome.storage.local.set).getMockImplementation()!
    let complete: (() => void) | undefined
    vi.mocked(chrome.storage.local.set).mockImplementationOnce((items, callback) => {
      expect(Object.keys(items).sort()).toEqual(['currentScrimbaPage', 'dailyActivities', 'streakStatus', 'trackingState'])
      complete = () => original(items, callback)
    })
    const acknowledged = vi.fn()
    const saving = applyTrackingUpdate(update('pulse', 2, 0, 5)).then(acknowledged)
    await vi.waitFor(() => expect(complete).toBeDefined())
    expect(acknowledged).not.toHaveBeenCalled()
    expect(total()).toBe(0)
    complete!()
    await saving
    expect(total()).toBe(5)
    expect(store.data.trackingState.sessions['session-a'].sequence).toBe(2)
  })

  it('replays a lost acknowledgement after a worker restart without recounting', async () => {
    const pulse = update('pulse', 2, 0, 5)
    const reply = await applyTrackingUpdate(pulse)
    vi.resetModules()
    const restarted = await import('./tracking')
    const mutations = await import('./storageMutations')
    mutations.enableStorageHost()
    expect(await restarted.applyTrackingUpdate(pulse)).toEqual(reply)
    expect(total()).toBe(5)
    expect(Object.values(store.data.dailyActivities)[0].sessions[0].activeSeconds).toBe(5)
  })

  it('retries a failed write without advancing its receipt or time', async () => {
    failNextStorageOperation('set')
    await expect(applyTrackingUpdate(update('pulse', 2, 0, 5))).rejects.toThrow()
    expect(total()).toBe(0)
    expect(store.data.trackingState.sessions['session-a'].sequence).toBe(1)
    await applyTrackingUpdate(update('pulse', 2, 0, 5))
    expect(total()).toBe(5)
  })

  it('does not count overlapping intervals or out-of-order messages twice', async () => {
    expect(await applyTrackingUpdate(update('pulse', 3, 0, 10))).toMatchObject({ error: 'out-of-order' })
    await applyTrackingUpdate(update('pulse', 2, 0, 5))
    await applyTrackingUpdate(update('pulse', 3, 0, 10))
    await applyTrackingUpdate(update('pulse', 2, 0, 5))
    expect(total()).toBe(10)
  })

  it('keeps a durable entry if delivery fails, then replays it without a tab', async () => {
    const pulse = update('pulse', 2, 0, 5)
    const key = 'tracking-outbox:session-a:2'
    await new Promise<void>((resolve) => chrome.storage.local.set({ [key]: pulse }, resolve))
    failNextStorageOperation('set')
    await expect(deliverTrackingUpdate(pulse)).rejects.toThrow()
    expect(Reflect.has(store.data, key)).toBe(true)
    await replayTrackingOutbox()
    expect(total()).toBe(5)
    expect(Reflect.has(store.data, key)).toBe(false)
  })

  it('accepts an old tab’s final interval without deactivating or recounting the new tab', async () => {
    await applyTrackingUpdate(update('pulse', 2, 0, 5))
    await applyTrackingUpdate(update('start', 1, 7, 7, 'session-b'))
    await applyTrackingUpdate(update('pulse', 2, 7, 12, 'session-b'))
    const stop = update('stop', 3, 5, 8)
    await applyTrackingUpdate(stop)
    await applyTrackingUpdate(stop)
    expect(total()).toBe(12) // a: 0–7, b: 7–12
    expect(store.data.currentScrimbaPage).toMatchObject({ sessionId: 'session-b', isActive: true })
    await applyTrackingUpdate(update('start', 4, 13))
    await applyTrackingUpdate(update('pulse', 5, 13, 18))
    expect(total()).toBe(17)
  })

  it('clips idle time, preserves its receipt, and resumes without counting the idle gap', async () => {
    store.data.userSettings.idleTimeoutSeconds = 2
    const pulse = update('pulse', 2, 0, 5)
    expect(await applyTrackingUpdate(pulse)).toMatchObject({ isIdle: true, isActive: false })
    await applyTrackingUpdate(pulse)
    expect(total()).toBe(2)
    await applyTrackingUpdate(update('activity', 3, 8))
    await applyTrackingUpdate(update('pulse', 4, 5, 13))
    expect(total()).toBe(4) // two active seconds on either side of the idle gap
  })

  it('does not duplicate time when a new tab’s start arrives after an old tab’s pulse', async () => {
    await applyTrackingUpdate(update('pulse', 2, 0, 10))
    await applyTrackingUpdate(update('start', 1, 7, 7, 'session-b'))
    await applyTrackingUpdate(update('pulse', 2, 7, 12, 'session-b'))
    expect(total()).toBe(12)
  })

  it('excludes an idle gap even when fresh input arrives before the next pulse', async () => {
    store.data.userSettings.idleTimeoutSeconds = 2
    await applyTrackingUpdate(update('activity', 2, 4))
    await applyTrackingUpdate(update('pulse', 3, 0, 5))
    expect(total()).toBe(3) // 0–2, then 4–5; 2–4 was idle.
  })

  it('rejects every old update after reset, including a retried start', async () => {
    await applyTrackingUpdate(update('pulse', 2, 0, 5))
    await resetLocalData({ resetSettings: false })
    const epoch = store.data.trackingState.epoch
    for (const message of [update('start', 1), update('pulse', 2, 0, 5), update('stop', 3, 5, 8)]) {
      expect(await applyTrackingUpdate(message)).toEqual({ ok: false, error: 'tracking-reset', epoch })
    }
    expect(total()).toBe(0)
    expect(store.data.currentScrimbaPage).toBeNull()
    await applyTrackingUpdate({ ...update('start', 1, 10, 10, 'new-session'), epoch })
    await applyTrackingUpdate({ ...update('pulse', 2, 10, 15, 'new-session'), epoch })
    expect(total()).toBe(5)
  })

  it('leaves the previous generation and totals intact if reset fails', async () => {
    await applyTrackingUpdate(update('pulse', 2, 0, 5))
    failNextStorageOperation('set')
    await expect(resetLocalData({ resetSettings: false })).rejects.toThrow()
    expect(store.data.trackingState.epoch).toBe('initial')
    expect(total()).toBe(5)
  })

  it('receipts a start while paused so its already queued tail cannot become an orphan or count later', async () => {
    store.data.userSettings.trackingEnabled = false
    expect(await applyTrackingUpdate(update('start', 1, 10, 10, 'paused-session')))
      .toMatchObject({ trackingEnabled: false, isActive: false })
    store.data.userSettings.trackingEnabled = true
    await applyTrackingUpdate(update('pulse', 2, 10, 15, 'paused-session'))
    expect(total()).toBe(0)
  })
})
