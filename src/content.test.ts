// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://scrimba.com/test"}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  failNextStorageOperation,
  installChromeMock,
  uninstallChromeMock,
} from './test/chromeMock'

describe('widget storage feedback', () => {
  let store: ReturnType<typeof installChromeMock>
  beforeEach(() => {
    vi.resetModules()
    store = installChromeMock()
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const originalGet = vi.mocked(chrome.storage.local.get).getMockImplementation()!
    vi.spyOn(chrome.storage.local, 'get').mockImplementation((keys, callback) => {
      if (keys === 'widgetPosition') callback({})
      else originalGet(keys, callback)
    })
    Object.assign(chrome.runtime, {
      sendMessage: vi.fn((_, callback) => callback?.({ ok: true })),
    })
  })

  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'))
    delete document.documentElement.dataset.scrimbaLearningTracker
    uninstallChromeMock()
    vi.useRealTimers()
  })

  const widget = () => document.getElementById('scrimtrack-page-widget')!
  const status = () => widget().shadowRoot!.querySelector('[data-status-text]')!

  it('shows failed reads instead of pretending local data is empty', async () => {
    failNextStorageOperation('get')
    await import('./content')
    await vi.waitFor(() => expect(status()).toHaveTextContent('Local data error'))
    expect(status()).toHaveAttribute('role', 'alert')
  })

  it('keeps the widget visible when saving its visibility fails', async () => {
    await import('./content')
    await vi.waitFor(() => expect(status()).toHaveTextContent('Ready'))
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((_, callback) => callback?.({ ok: false, error: 'storage-failure' }))
    widget().shadowRoot!.querySelector<HTMLButtonElement>('[data-close]')!.click()
    await vi.waitFor(() => expect(status()).toHaveTextContent('Local data error'))
    expect(widget().hidden).toBe(false)
  })

  it('loads widget time from the saved timezone rather than the host calendar date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-04-01T06:30:00Z'))
    store.data.userSettings.timezone = 'America/Los_Angeles'
    store.data.dailyActivities = {
      '2026-03-31': { date: '2026-03-31', activeSeconds: 600, goalSeconds: 1800, goalCompleted: false, sessions: [] },
      '2026-04-01': { date: '2026-04-01', activeSeconds: 900, goalSeconds: 1800, goalCompleted: false, sessions: [] },
    }
    await import('./content')
    await vi.waitFor(() => expect(widget().shadowRoot!.querySelector('[data-today]')).toHaveTextContent('10m 00s'))
  })

})
