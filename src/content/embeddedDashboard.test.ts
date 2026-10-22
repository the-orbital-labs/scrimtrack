// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmbeddedDashboard } from './embeddedDashboard'

describe('embedded dashboard tab', () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('does not clone Scrimba custom elements that require app-owned state', () => {
    let connectedTabs = 0
    customElements.define('scrimba-test-tab', class extends HTMLElement {
      connectedCallback() {
        connectedTabs += 1
      }
    })
    const tabBar = document.createElement('nav')
    const issuesTab = document.createElement('scrimba-test-tab')
    issuesTab.textContent = 'Issues 9'
    issuesTab.className = 'dashboard-tab'
    issuesTab.setAttribute('role', 'tab')
    issuesTab.setAttribute('data-app-state', 'issues')
    tabBar.append(issuesTab)
    document.body.append(tabBar)
    vi.spyOn(issuesTab, 'getBoundingClientRect').mockReturnValue(
      { width: 80, height: 32 } as DOMRect,
    )
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const controller = new AbortController()
    const dashboard = createEmbeddedDashboard(controller)

    try {
      dashboard.start()
      frames.shift()!(0)

      const tab = document.getElementById('scrimtrack-dashboard-tab')!
      expect(tab).toBeInstanceOf(HTMLButtonElement)
      expect(tab).toHaveAttribute('type', 'button')
      expect(tab).toHaveAttribute('role', 'tab')
      expect(tab).toHaveTextContent('ScrimTrack')
      expect(tab).toHaveClass('dashboard-tab')
      expect(tab).not.toHaveAttribute('data-app-state')
      expect(issuesTab.nextElementSibling).toBe(tab)
      expect(connectedTabs).toBe(1)

    } finally {
      dashboard.dispose()
      controller.abort()
    }
  })
})
