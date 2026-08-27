// @vitest-environment jsdom

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Popup from './Popup'
import type { ChromeMock } from '../test/chromeMock'
import { installChromeMock, uninstallChromeMock } from '../test/chromeMock'
import { createComponentTestStorage } from '../test/fixtures'

describe('popup', () => {
  let chromeMock: ChromeMock

  beforeEach(() => {
    chromeMock = installChromeMock(createComponentTestStorage())
  })

  afterEach(() => {
    uninstallChromeMock()
  })

  it('renders the current activity, goal, streak, and projection', async () => {
    render(<Popup />)

    expect(await screen.findByRole('heading', { name: 'Learning status' })).toBeInTheDocument()

    const todayProgress = screen.getByLabelText("Today's progress")

    expect(within(todayProgress).getByText('20m 00s')).toBeInTheDocument()
    expect(within(todayProgress).getByText('30m 00s')).toBeInTheDocument()
    expect(within(todayProgress).getByText('10m 00s remaining')).toBeInTheDocument()

    const streak = screen.getByLabelText('Current streak')

    expect(within(streak).getByText('3')).toBeInTheDocument()
    expect(within(streak).getByText('days')).toBeInTheDocument()
    expect(screen.getByLabelText('Pace projection')).toHaveTextContent('remaining')
  })

  it('opens the dashboard through the Chrome extension API', async () => {
    const user = userEvent.setup()

    render(<Popup />)
    await screen.findByRole('heading', { name: 'Learning status' })

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))

    expect(chromeMock.openOptionsPage).toHaveBeenCalledOnce()
    expect(chromeMock.tabsCreate).not.toHaveBeenCalled()
  })

  it('pauses tracking and displays the paused state', async () => {
    const user = userEvent.setup()

    render(<Popup />)
    await screen.findByRole('heading', { name: 'Learning status' })

    await user.click(screen.getByRole('checkbox', { name: /Tracking/ }))

    expect(await screen.findByRole('heading', { name: 'Paused' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tracking paused')).toHaveTextContent(
      'No Scrimba activity will be counted',
    )
    expect(chromeMock.data.userSettings.trackingEnabled).toBe(false)
  })

  it('saves a custom daily goal when Enter is pressed', async () => {
    const user = userEvent.setup()

    render(<Popup />)
    await screen.findByRole('heading', { name: 'Learning status' })

    const goalControls = screen.getByRole('group', {
      name: 'Daily goal presets',
    })
    const customGoal = within(goalControls).getByRole('spinbutton')

    await user.clear(customGoal)
    await user.type(customGoal, '50{Enter}')

    expect(await screen.findByText('Saved 50m 00s daily goal.')).toBeInTheDocument()
    expect(chromeMock.data.userSettings.dailyGoalSeconds).toBe(50 * 60)
  })

  it('persists a valid timezone when its input loses focus', async () => {
    const user = userEvent.setup()

    render(<Popup />)
    const timezone = await screen.findByRole('textbox', { name: 'Timezone' })

    await user.clear(timezone)
    await user.type(timezone, 'America/New_York')
    await user.tab()

    await waitFor(() => {
      expect(chromeMock.data.userSettings.timezone).toBe('America/New_York')
    })
    expect(timezone).toHaveValue('America/New_York')
  })

  it('saves a different projection average window', async () => {
    const user = userEvent.setup()

    render(<Popup />)
    const averageWindow = await screen.findByRole('combobox', {
      name: 'Average window',
    })

    await user.selectOptions(averageWindow, '30')

    expect(await screen.findByText('Saved average window.')).toBeInTheDocument()
    expect(chromeMock.data.pathProgress.averageWindowDays).toBe(30)
  })

  it('shows validation feedback for an invalid manual path percentage', async () => {
    const user = userEvent.setup()

    render(<Popup />)
    const progress = await screen.findByRole('spinbutton', {
      name: 'Progress (manual fallback)',
    })

    await user.clear(progress)
    await user.type(progress, '101')
    await user.click(
      within(progress.parentElement!).getByRole('button', { name: 'Save' }),
    )

    expect(screen.getByText('Progress must be between 0 and 100%.')).toBeInTheDocument()
    expect(progress).toHaveValue(25)
    expect(chromeMock.data.pathProgress.progressPercentage).toBe(25)
  })

  it('responds to external settings changes from Chrome storage', async () => {
    render(<Popup />)
    await screen.findByRole('heading', { name: 'Learning status' })

    chromeMock.emitStorageChange({
      userSettings: {
        oldValue: chromeMock.data.userSettings,
        newValue: {
          ...chromeMock.data.userSettings,
          trackingEnabled: false,
        },
      },
    })

    expect(await screen.findByRole('heading', { name: 'Paused' })).toBeInTheDocument()
  })

  it('removes its Chrome storage listener when the popup closes', async () => {
    const { unmount } = render(<Popup />)

    await screen.findByRole('heading', { name: 'Learning status' })
    expect(chromeMock.listenerCount()).toBe(1)

    unmount()

    expect(chromeMock.listenerCount()).toBe(0)
    expect(chromeMock.removeListener).toHaveBeenCalledOnce()
  })
})
