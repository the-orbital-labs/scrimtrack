// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import Popup from './popup/Popup'
import {
  failNextStorageOperation,
  installChromeMock,
  uninstallChromeMock,
} from './test/chromeMock'
import { createComponentTestStorage } from './test/fixtures'

describe.each([['dashboard', App], ['popup', Popup]] as const)('%s storage feedback', (_, Component) => {
  beforeEach(() => { installChromeMock(createComponentTestStorage()) })
  afterEach(uninstallChromeMock)

  const load = async () => {
    render(<Component />)
    await screen.findByDisplayValue('25')
    if (Component === Popup) {
      await userEvent.setup().click(screen.getByText('Settings', { selector: 'summary' }))
    }
  }

  it('shows a visible load error', async () => {
    failNextStorageOperation('get')
    render(<Component />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load local data.')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('reports a failed goal save and allows retry', async () => {
    const user = userEvent.setup()
    await load()
    failNextStorageOperation('set')
    const preset = within(screen.getByRole('group', { name: 'Daily goal presets' }))
      .getByRole('button', { name: '45m' })
    await user.click(preset)
    expect(await screen.findByText('Could not save the daily goal. Reload and try again.')).toBeInTheDocument()
    expect(screen.queryByText('Saved 45m 00s daily goal.')).not.toBeInTheDocument()
    expect(screen.queryByText('Enter 1-1440 minutes.')).not.toBeInTheDocument()
    await user.click(preset)
    expect(await screen.findByText('Saved 45m 00s daily goal.')).toBeInTheDocument()
  })

  it('does not claim a failed reset succeeded', async () => {
    const user = userEvent.setup()
    await load()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    failNextStorageOperation('set')
    await user.click(screen.getByRole('button', { name: 'Reset activity only' }))
    expect(await screen.findByText(/Reset could not be completed/)).toBeInTheDocument()
    expect(screen.queryByText('Activity data, sessions, and streaks were reset. Settings were kept.')).not.toBeInTheDocument()
  })

  it('does not claim tracking was paused when saving failed', async () => {
    const user = userEvent.setup()
    await load()
    failNextStorageOperation('set')
    await user.click(screen.getByRole('checkbox', { name: /Tracking/ }))
    expect(await screen.findByText(/Could not update tracking/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Tracking/ })).toBeChecked()
  })
})
