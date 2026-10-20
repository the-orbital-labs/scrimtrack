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
  })

  afterEach(uninstallChromeMock)

  it.each(['get', 'set'] as const)('returns a failure response when session %s fails', async (operation) => {
    failNextStorageOperation(operation)
    const response = vi.fn()
    expect(listener({
      type: 'scrimba:tracking-started',
      sessionId, url, title: null, startedAt,
      isActive: true, lastActivityAt: startedAt,
    }, {}, response)).toBe(true)

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
    listener({
      type: 'scrimba:activity-pulse',
      sessionId, url, title: null,
      activeSeconds: 5,
      recordedAt: '2026-10-20T12:02:02.000Z',
    }, {}, response)

    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({
      ok: false, error: 'storage-failure',
    }))
    expect(response).toHaveBeenCalledTimes(1)
  })
})
