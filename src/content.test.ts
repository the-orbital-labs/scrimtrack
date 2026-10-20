// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://scrimba.com/test"}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  failNextStorageOperation,
  installChromeMock,
  uninstallChromeMock,
} from './test/chromeMock'

describe('widget storage feedback', () => {
  beforeEach(() => {
    vi.resetModules()
    installChromeMock()
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
    failNextStorageOperation('set')
    widget().shadowRoot!.querySelector<HTMLButtonElement>('[data-close]')!.click()
    await vi.waitFor(() => expect(status()).toHaveTextContent('Local data error'))
    expect(widget().hidden).toBe(false)
  })
})
