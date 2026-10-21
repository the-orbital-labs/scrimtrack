import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  failNextStorageOperation,
  installChromeMock,
  uninstallChromeMock,
} from './test/chromeMock'

type MessageListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0]

describe('background storage failure responses', () => {
  let listener: MessageListener
  const sessionId = 'test-session'
  const url = 'https://scrimba.com/test'
  const startedAt = '2026-10-20T12:00:00.000Z'
  const update = (kind: string, sequence: number, from = startedAt, at = from) => ({
    type: 'scrimba:tracking-update', epoch: 'initial', sessionId, sequence,
    kind, from, at, url, title: null, isMediaPlaying: false,
  })

  beforeEach(async () => {
    vi.resetModules()
    installChromeMock({
      currentScrimbaPage: {
        sessionId, url, title: null, startedAt,
        isActive: true, isIdle: false,
        lastActivityAt: startedAt, lastActiveAt: startedAt,
        lastInactiveAt: null, lastIdleAt: null,
      },
    })
    Object.assign(chrome.runtime, {
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: {
        addListener: (callback: MessageListener) => { listener = callback },
      },
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await import('./background')
    await new Promise((resolve) => listener(update('start', 1), {}, resolve))
  })

  afterEach(uninstallChromeMock)

  it.each(['get', 'set'] as const)('returns a failure response when session %s fails', async (operation) => {
    failNextStorageOperation(operation)
    const response = vi.fn()
    expect(listener(update('start', 2), {}, response)).toBe(true)

    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({
      ok: false, error: 'storage-failure',
    }))
    expect(response).toHaveBeenCalledTimes(1)
  })

  it('waits for idle-state writes before acknowledging a pulse', async () => {
    const originalSet = vi.mocked(chrome.storage.local.set).getMockImplementation()!
    vi.spyOn(chrome.storage.local, 'set').mockImplementation((items, callback) => {
      if ('currentScrimbaPage' in items) {
        chrome.runtime.lastError = { message: 'Write failed' }
        try { callback?.() } finally { delete chrome.runtime.lastError }
      } else {
        originalSet(items, callback)
      }
    })
    const response = vi.fn()
    listener(update('pulse', 2, '2026-10-20T12:01:57.000Z', '2026-10-20T12:02:02.000Z'), {}, response)

    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({
      ok: false, error: 'storage-failure',
    }))
    expect(response).toHaveBeenCalledTimes(1)
  })

  const send = (message: unknown): Promise<unknown> =>
    new Promise((resolve) => { listener(message, {}, resolve) })

  const connectClient = async () => {
    Object.assign(chrome.runtime, {
      sendMessage: vi.fn((message, callback) => { listener(message, {}, callback) }),
    })
    // A fresh module graph represents the popup/dashboard JS context. The
    // service worker retains its own host flag and registered implementations.
    vi.resetModules()
    return import('./settings')
  }

  it('preserves both overlapping activity pulses and their session totals', async () => {
    const responses = await Promise.all([
      send(update('pulse', 2, startedAt, '2026-10-20T12:00:05.000Z')),
      send(update('pulse', 3, '2026-10-20T12:00:05.000Z', '2026-10-20T12:00:12.000Z')),
    ])
    expect(responses).toEqual([
      expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true }),
    ])
    const activities = await new Promise<Record<string, { activeSeconds: number; sessions: { activeSeconds: number }[] }>>((resolve) =>
      chrome.storage.local.get('dailyActivities', (items) => resolve(items.dailyActivities as never)))
    const activity = Object.values(activities)[0]
    expect(activity.activeSeconds).toBe(12)
    expect(activity.sessions[0].activeSeconds).toBe(12)
  })

  it('merges settings changes from separate contexts and the floating widget', async () => {
    const client = await connectClient()
    await Promise.all([
      client.saveDailyGoal(2700), client.saveIdleTimeout(300),
      send({ type: 'storage:mutate', command: 'saveFloatingWidgetVisible', args: [false] }),
    ])
    expect(await client.getUserSettings()).toMatchObject({
      dailyGoalSeconds: 2700, idleTimeoutSeconds: 300, floatingWidgetVisible: false,
    })
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'storage:mutate', command: 'saveDailyGoal' }), expect.any(Function),
    )
  })

  it('continues processing queued mutations after a storage failure', async () => {
    const client = await connectClient()
    failNextStorageOperation('set')
    const results = await Promise.allSettled([client.saveIdleTimeout(300), client.saveDailyGoal(2700)])
    expect(results[0].status).toBe('rejected')
    expect(results[1].status).toBe('fulfilled')
    expect(await client.getUserSettings()).toMatchObject({ dailyGoalSeconds: 2700, idleTimeoutSeconds: 120 })
  })

  it('orders a reset after an in-flight pulse and before subsequent settings saves', async () => {
    const client = await connectClient()
    const storage = await import('./storage')
    await Promise.all([
      send(update('pulse', 2, startedAt, '2026-10-20T12:00:05.000Z')),
      storage.resetLocalData({ resetSettings: true }),
      client.saveIdleTimeout(300),
    ])
    const exported = await storage.getLocalDataExport()
    expect(exported.data.dailyActivities).toEqual({})
    expect(exported.data.currentScrimbaPage).toBeNull()
    expect(exported.data.streakStatus.currentStreak).toBe(0)
    expect(exported.data.userSettings.idleTimeoutSeconds).toBe(300)
  })


  it('preserves path edits alongside a detected course', async () => {
    await connectClient()
    const client = await import('./pathProgress')
    await Promise.all([
      client.savePathName('My learning plan'), client.saveTotalEstimatedHours(90),
      send({ type: 'scrimba:course-progress-detected', course: {
        id: 'c0j', name: 'Frontend Developer Path',
        url: 'https://scrimba.com/frontend-path-c0j', totalEstimatedHours: 81.6,
        completedItems: 10, totalItems: 100, progressPercentage: 10, detectedAt: startedAt,
      } }),
    ])
    expect(await client.getPathProgress()).toMatchObject({
      pathName: 'My learning plan', totalEstimatedHours: 90,
      detectedCourses: { c0j: { progressPercentage: 10 } },
    })
  })

})
