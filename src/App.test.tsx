// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { ChromeMock } from './test/chromeMock'
import { installChromeMock, uninstallChromeMock } from './test/chromeMock'
import { createComponentTestStorage } from './test/fixtures'

describe('dashboard', () => {
  let chromeMock: ChromeMock

  beforeEach(() => {
    chromeMock = installChromeMock(createComponentTestStorage())
  })

  afterEach(() => {
    uninstallChromeMock()
  })

  it('renders stored learning progress and path details', async () => {
    render(<App />)

    expect(await screen.findByText('20m 00s / 30m 00s')).toBeInTheDocument()
    expect(
      screen.getByText('Frontend Developer Path - 25% complete'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'Open Frontend Developer Path on Scrimba',
      }),
    ).toHaveAttribute('href', 'https://scrimba.com/frontend-path-c0j')

    const stats = screen.getByLabelText('Key learning stats')

    expect(within(stats).getByText('Today')).toBeInTheDocument()
    expect(within(stats).getByText('20m 00s')).toBeInTheDocument()
    expect(within(stats).getByText('3 days')).toBeInTheDocument()
  })

  it('changes the selected heatmap summary period', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByText('20m 00s / 30m 00s')

    const periodControl = screen.getByRole('group', {
      name: 'Heatmap summary period',
    })

    await user.click(within(periodControl).getByRole('button', { name: 'week' }))

    expect(
      within(screen.getByLabelText('Selected period totals')).getByText(
        'This week',
      ),
    ).toBeInTheDocument()
  })

  it('saves a daily goal preset to local extension storage', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByText('20m 00s / 30m 00s')

    await user.click(
      within(screen.getByRole('group', { name: 'Daily goal presets' })).getByRole(
        'button',
        { name: '45m' },
      ),
    )

    expect(await screen.findByText('Saved 45m 00s daily goal.')).toBeInTheDocument()
    expect(chromeMock.data.userSettings.dailyGoalSeconds).toBe(45 * 60)
    expect(
      chromeMock.data.dailyActivities[Object.keys(chromeMock.data.dailyActivities).at(-1)!]
        .goalSeconds,
    ).toBe(45 * 60)
  })

  it('rejects an invalid custom daily goal', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByText('20m 00s / 30m 00s')

    const goalControls = screen.getByRole('group', {
      name: 'Daily goal presets',
    })
    const customGoal = within(goalControls).getByRole('spinbutton')

    await user.clear(customGoal)
    await user.type(customGoal, '0')
    await user.click(within(goalControls).getByRole('button', { name: 'Save' }))

    expect(screen.getByText('Enter 1-1440 minutes.')).toBeInTheDocument()
    expect(customGoal).toHaveValue(30)
    expect(chromeMock.data.userSettings.dailyGoalSeconds).toBe(30 * 60)
  })

  it('pauses tracking from the dashboard settings', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByText('20m 00s / 30m 00s')

    await user.click(screen.getByRole('checkbox', { name: /Tracking on/ }))

    expect(
      await screen.findByText(
        'Tracking is paused. No Scrimba activity will be counted.',
      ),
    ).toBeInTheDocument()
    expect(chromeMock.data.userSettings.trackingEnabled).toBe(false)
  })

  it('opens the floating widget and persists the setting', async () => {
    const user = userEvent.setup()

    render(<App />)
    const openWidget = await screen.findByRole('button', { name: 'Open widget' })

    await user.click(openWidget)

    expect(await screen.findByRole('button', { name: 'Widget open' })).toBeDisabled()
    expect(chromeMock.data.userSettings.floatingWidgetVisible).toBe(true)
  })

  it('keeps local data when reset confirmation is declined', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const originalActivities = structuredClone(chromeMock.data.dailyActivities)

    render(<App />)
    await screen.findByText('20m 00s / 30m 00s')
    await user.click(screen.getByRole('button', { name: 'Reset activity only' }))

    expect(confirm).toHaveBeenCalledOnce()
    expect(chromeMock.data.dailyActivities).toEqual(originalActivities)
    expect(screen.queryByText('Resetting local data...')).not.toBeInTheDocument()
  })

  it('reacts to Chrome storage changes and removes its listener on unmount', async () => {
    const { unmount } = render(<App />)

    await screen.findByText('20m 00s / 30m 00s')
    expect(chromeMock.listenerCount()).toBe(1)

    chromeMock.emitStorageChange({
      userSettings: {
        oldValue: chromeMock.data.userSettings,
        newValue: {
          ...chromeMock.data.userSettings,
          trackingEnabled: false,
        },
      },
    })

    expect(await screen.findAllByText('Tracking paused')).not.toHaveLength(0)

    unmount()

    expect(chromeMock.listenerCount()).toBe(0)
    expect(chromeMock.removeListener).toHaveBeenCalledOnce()
  })

  it('validates path estimates before saving them', async () => {
    const user = userEvent.setup()

    render(<App />)
    const totalEstimate = await screen.findByRole('spinbutton', {
      name: 'Total estimate',
    })

    await user.clear(totalEstimate)
    await user.type(totalEstimate, '0')
    await user.click(
      within(totalEstimate.parentElement!).getByRole('button', { name: 'Save' }),
    )

    expect(
      screen.getByText('Total estimate must be greater than 0 hours.'),
    ).toBeInTheDocument()
    expect(totalEstimate).toHaveValue(80)
    expect(chromeMock.data.pathProgress.totalEstimatedHours).toBe(80)
  })

  it('updates the idle timeout preset', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByText('20m 00s / 30m 00s')

    await user.click(
      within(screen.getByRole('group', { name: 'Idle timeout presets' })).getByRole(
        'button',
        { name: '3m' },
      ),
    )

    expect(await screen.findByText('Saved 3m idle timeout.')).toBeInTheDocument()
    expect(chromeMock.data.userSettings.idleTimeoutSeconds).toBe(3 * 60)
  })
})
