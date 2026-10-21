// @vitest-environment jsdom

import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import Popup from './popup/Popup'
import { useLiveActivitySeconds } from './useLiveActivitySeconds'
import { createDailyActivity } from './activity'
import { installChromeMock, uninstallChromeMock } from './test/chromeMock'

describe.each([['dashboard', App], ['popup', Popup]] as const)('%s calendar refresh', (_, Component) => {
  let store: ReturnType<typeof installChromeMock>
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-04-01T06:59:59Z'))
    store = installChromeMock()
    store.data.userSettings.timezone = 'America/Los_Angeles'
    store.data.dailyActivities = {
      '2026-03-30': { ...createDailyActivity('2026-03-30'), activeSeconds: 600 },
    }
  })
  afterEach(() => { cleanup(); vi.useRealTimers(); uninstallChromeMock() })

  it('expires a stale streak when an open view refreshes after midnight', async () => {
    render(<Component />)
    expect((await screen.findAllByText('Practice today to keep your streak')).length).toBeGreaterThan(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.queryByText('Practice today to keep your streak')).not.toBeInTheDocument()
    expect((await screen.findAllByText('Practice today to start a streak')).length).toBeGreaterThan(0)
  })

  it('refreshes the current day immediately when the saved timezone changes', async () => {
    store.data.dailyActivities['2026-03-31'] = {
      ...createDailyActivity('2026-03-31'), activeSeconds: 600,
    }
    render(<Component />)
    expect((await screen.findAllByText('Active today - streak protected')).length).toBeGreaterThan(0)
    await act(async () => {
      const settings = { ...store.data.userSettings, timezone: 'Asia/Tokyo' }
      store.data.userSettings = settings
      store.emitStorageChange({ userSettings: { newValue: settings } })
    })
    expect(screen.queryByText('Active today - streak protected')).not.toBeInTheDocument()
    expect((await screen.findAllByText('Practice today to keep your streak')).length).toBeGreaterThan(0)
  })
})

it('advances the live timer in the saved timezone when the host date differs', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-01T06:30:00Z'))
  try {
    const activity = { ...createDailyActivity('2026-03-31'), activeSeconds: 600 }
    const { result, unmount } = renderHook(() =>
      useLiveActivitySeconds(activity, true, 'America/Los_Angeles'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(result.current).toBe(601)
    unmount()
  } finally { vi.useRealTimers() }
})
