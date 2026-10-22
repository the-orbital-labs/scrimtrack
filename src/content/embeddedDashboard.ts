import { getExtensionUrl, isExtensionContextValid } from './storage'
import { widgetHostId } from './widget'

type DashboardPlacement = {
  anchor: HTMLElement
  parent: HTMLElement
}

const dashboardTabId = 'scrimtrack-dashboard-tab'
const embeddedDashboardHostId = 'scrimtrack-embedded-dashboard'

export function createEmbeddedDashboard(listenerController: AbortController) {
  let dashboardIntegrationObserver: MutationObserver | null = null
  let dashboardIntegrationFrameId: number | null = null
  let dashboardBoundsFrameId: number | null = null
  let dashboardTabBar: HTMLElement | null = null
  let dashboardPlacement: DashboardPlacement | null = null
  let isEmbeddedDashboardOpen = false
  const hiddenScrimbaContent: Array<{
    display: string
    displayPriority: string
    element: HTMLElement
  }> = []
  const normalizeElementText = (element: Element): string =>
    (element.textContent ?? '').replace(/\s+/g, ' ').trim()

  const getIssuesTab = (): HTMLElement | null => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('a, button, [role="tab"]'),
    ).filter((candidate) => {
      if (
        candidate.id === dashboardTabId ||
        candidate.closest(`#${widgetHostId}, #${embeddedDashboardHostId}`)
      ) {
        return false
      }

      const label = normalizeElementText(candidate)
      const bounds = candidate.getBoundingClientRect()

      return (
        /^Issues(?:\s*\d+)?$/i.test(label) &&
        bounds.width > 0 &&
        bounds.width < 240 &&
        bounds.height > 0 &&
        bounds.height < 80
      )
    })

    return candidates.sort((first, second) => {
      const score = (candidate: HTMLElement) => {
        const surroundingText = normalizeElementText(
          candidate.parentElement ?? candidate,
        )

        return (
          (candidate.getAttribute('role') === 'tab' ? 10 : 0) +
          (/Recent/i.test(surroundingText) ? 3 : 0) +
          (/Completed/i.test(surroundingText) ? 3 : 0) +
          (/Discover|Started/i.test(surroundingText) ? 2 : 0)
        )
      }

      return score(second) - score(first)
    })[0] ?? null
  }

  const getTabBar = (tab: HTMLElement): HTMLElement => {
    const minimumWideWidth = Math.min(640, window.innerWidth * 0.5)
    let candidate = tab.parentElement
    let widestCompactParent = candidate ?? tab

    for (let depth = 0; candidate && depth < 5; depth += 1) {
      const bounds = candidate.getBoundingClientRect()
      const widestBounds = widestCompactParent.getBoundingClientRect()

      if (bounds.height <= 100 && bounds.width > widestBounds.width) {
        widestCompactParent = candidate
      }

      if (bounds.height <= 100 && bounds.width >= minimumWideWidth) {
        return candidate
      }

      candidate = candidate.parentElement
    }

    return widestCompactParent
  }

  const getEmbeddedDashboardHost = (): HTMLElement | null =>
    document.getElementById(embeddedDashboardHostId)

  const restoreScrimbaContent = () => {
    hiddenScrimbaContent.splice(0).forEach((entry) => {
      entry.element.style.setProperty(
        'display',
        entry.display,
        entry.displayPriority,
      )

      if (!entry.display) {
        entry.element.style.removeProperty('display')
      }
    })
  }

  const getDashboardPlacement = (tabBar: HTMLElement): DashboardPlacement => {
    const tabBarBounds = tabBar.getBoundingClientRect()
    const dashboardHost = getEmbeddedDashboardHost()
    let anchor = tabBar

    for (let depth = 0; depth < 7; depth += 1) {
      const parent = anchor.parentElement

      if (!parent || parent === document.body || parent === document.documentElement) {
        break
      }

      const followingSiblings = Array.from(parent.children).slice(
        Array.from(parent.children).indexOf(anchor) + 1,
      )
      const hasMainContentSibling = followingSiblings.some((sibling) => {
        if (
          !(sibling instanceof HTMLElement) ||
          sibling === dashboardHost ||
          (dashboardHost !== null && sibling.contains(dashboardHost))
        ) {
          return false
        }

        const bounds = sibling.getBoundingClientRect()
        const horizontalOverlap = Math.max(
          0,
          Math.min(bounds.right, tabBarBounds.right) -
            Math.max(bounds.left, tabBarBounds.left),
        )

        return (
          bounds.height > 40 &&
          bounds.width > 280 &&
          bounds.top >= tabBarBounds.bottom - 12 &&
          horizontalOverlap > Math.min(240, tabBarBounds.width * 0.4)
        )
      })

      if (hasMainContentSibling) {
        return { anchor, parent }
      }

      anchor = parent
    }

    return {
      anchor: tabBar,
      parent: tabBar.parentElement ?? document.body,
    }
  }

  const getStableDashboardPlacement = (
    tabBar: HTMLElement,
  ): DashboardPlacement => {
    const currentPlacement = dashboardPlacement
    const isCurrentPlacementValid =
      currentPlacement !== null &&
      currentPlacement.anchor.isConnected &&
      currentPlacement.parent.isConnected &&
      currentPlacement.anchor.parentElement === currentPlacement.parent &&
      (currentPlacement.anchor === tabBar || currentPlacement.anchor.contains(tabBar))

    if (isCurrentPlacementValid) {
      return currentPlacement
    }

    if (currentPlacement !== null) {
      restoreScrimbaContent()
    }

    dashboardPlacement = getDashboardPlacement(tabBar)
    return dashboardPlacement
  }

  const hideScrimbaContentAfter = (
    anchor: HTMLElement,
    host: HTMLElement,
  ) => {
    let sibling = host.nextElementSibling

    while (sibling) {
      const nextSibling = sibling.nextElementSibling

      if (
        sibling instanceof HTMLElement &&
        sibling !== anchor &&
        sibling.id !== widgetHostId
      ) {
        if (!hiddenScrimbaContent.some((entry) => entry.element === sibling)) {
          hiddenScrimbaContent.push({
            display: sibling.style.getPropertyValue('display'),
            displayPriority: sibling.style.getPropertyPriority('display'),
            element: sibling,
          })
        }

        sibling.style.setProperty('display', 'none', 'important')
      }

      sibling = nextSibling
    }
  }

  const updateDashboardTabState = () => {
    const tab = document.getElementById(dashboardTabId)

    if (!(tab instanceof HTMLElement)) {
      return
    }

    tab.setAttribute('aria-selected', String(isEmbeddedDashboardOpen))
    tab.toggleAttribute('aria-current', isEmbeddedDashboardOpen)

    if (isEmbeddedDashboardOpen) {
      tab.style.setProperty('border-bottom', '2px solid #2563eb', 'important')
      tab.style.setProperty('color', '#1d4ed8', 'important')
      tab.style.setProperty('font-weight', '600', 'important')
      return
    }

    tab.style.removeProperty('border-bottom')
    tab.style.removeProperty('color')
    tab.style.removeProperty('font-weight')
  }

  const applyEmbeddedDashboardBounds = (
    host: HTMLElement,
    tab: HTMLElement,
  ) => {
    dashboardTabBar = getTabBar(tab)
    const bounds = dashboardTabBar.getBoundingClientRect()
    const placement = getStableDashboardPlacement(dashboardTabBar)
    const parentBounds = placement.parent.getBoundingClientRect()
    const width = Math.max(320, Math.round(bounds.width))
    const height = Math.max(480, Math.round(window.innerHeight - bounds.bottom))
    const leftOffset = Math.max(0, Math.round(bounds.left - parentBounds.left))
    const frame = host.shadowRoot?.querySelector<HTMLIFrameElement>('iframe')

    if (
      host.parentElement !== placement.parent ||
      host.previousElementSibling !== placement.anchor
    ) {
      placement.anchor.insertAdjacentElement('afterend', host)
    }

    hideScrimbaContentAfter(placement.anchor, host)

    host.style.setProperty('position', 'relative', 'important')
    host.style.setProperty('display', 'block', 'important')
    host.style.setProperty('z-index', '1', 'important')
    host.style.setProperty('inset', 'auto', 'important')
    host.style.setProperty('margin', `0 0 0 ${leftOffset}px`, 'important')
    host.style.setProperty('padding', '0', 'important')
    host.style.setProperty('border', '0', 'important')
    host.style.setProperty('max-width', 'none', 'important')
    host.style.setProperty('max-height', 'none', 'important')
    host.style.setProperty('overflow', 'hidden', 'important')
    host.style.setProperty('background', '#f7f8fb', 'important')
    host.style.setProperty('width', `${width}px`, 'important')
    host.style.setProperty('height', `${height}px`, 'important')
    host.style.setProperty('transform', 'none', 'important')

    if (frame) {
      frame.width = String(width)
      frame.height = String(height)
      frame.style.setProperty('width', `${width}px`, 'important')
      frame.style.setProperty('height', `${height}px`, 'important')
    }
  }

  const updateEmbeddedDashboardBounds = () => {
    dashboardBoundsFrameId = null

    const host = getEmbeddedDashboardHost()
    const tab = document.getElementById(dashboardTabId)

    if (!host || !tab) {
      return
    }

    applyEmbeddedDashboardBounds(host, tab)
  }

  const scheduleEmbeddedDashboardBoundsUpdate = () => {
    if (!isEmbeddedDashboardOpen || dashboardBoundsFrameId !== null) {
      return
    }

    dashboardBoundsFrameId = window.requestAnimationFrame(
      updateEmbeddedDashboardBounds,
    )
  }

  const hideEmbeddedDashboard = () => {
    isEmbeddedDashboardOpen = false
    dashboardPlacement = null
    getEmbeddedDashboardHost()?.remove()
    restoreScrimbaContent()
    updateDashboardTabState()
  }

  const showEmbeddedDashboard = () => {
    const dashboardUrl = getExtensionUrl('dashboard.html?embedded=1')

    if (!dashboardUrl) {
      window.alert('ScrimTrack was updated. Refresh this Scrimba tab to reconnect it.')
      return
    }

    isEmbeddedDashboardOpen = true

    if (!getEmbeddedDashboardHost()) {
      const host = document.createElement('div')
      const shadow = host.attachShadow({ mode: 'open' })
      const style = document.createElement('style')
      const frame = document.createElement('iframe')

      host.id = embeddedDashboardHostId
      host.setAttribute('aria-label', 'ScrimTrack dashboard')
      style.textContent = `
        :host {
          all: initial !important;
          position: relative !important;
          display: block !important;
          z-index: 1 !important;
          margin: 0 !important;
          padding: 0 !important;
          border: 0 !important;
          overflow: hidden !important;
          border-top: 1px solid rgba(22, 33, 52, 0.16) !important;
          background: #f7f8fb !important;
          box-shadow: 0 -6px 18px rgba(12, 18, 31, 0.06) !important;
          color-scheme: light dark;
        }

        iframe {
          display: block;
          width: 100%;
          height: 100%;
          border: 0;
          background: #f7f8fb;
        }
      `
      frame.src = dashboardUrl
      frame.title = 'ScrimTrack dashboard'
      frame.setAttribute('allow', 'clipboard-write')
      frame.style.setProperty('display', 'block', 'important')
      frame.style.setProperty('width', '100%', 'important')
      frame.style.setProperty('height', '100%', 'important')
      frame.style.setProperty('border', '0', 'important')
      frame.style.setProperty('background', '#f7f8fb', 'important')

      shadow.append(style, frame)
      document.documentElement.append(host)
      const tab = document.getElementById(dashboardTabId)

      if (tab) {
        applyEmbeddedDashboardBounds(host, tab)
      }
    }

    updateDashboardTabState()
    updateEmbeddedDashboardBounds()
  }

  const createDashboardTab = (issuesTab: HTMLElement): HTMLElement => {
    // Scrimba tabs can be custom elements whose renderers require app-owned
    // state. Cloning one creates an uninitialized component on the host page.
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.className = issuesTab.className
    tab.setAttribute('role', 'tab')

    tab.id = dashboardTabId
    tab.textContent = 'ScrimTrack'
    tab.setAttribute('aria-label', 'Open ScrimTrack dashboard')
    tab.setAttribute('aria-selected', 'false')
    tab.setAttribute('data-scrimtrack-dashboard-tab', '')

    tab.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      showEmbeddedDashboard()
    }, { signal: listenerController.signal })
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      showEmbeddedDashboard()
    }, { signal: listenerController.signal })

    return tab
  }

  const ensureDashboardIntegration = () => {
    dashboardIntegrationFrameId = null

    const issuesTab = getIssuesTab()

    if (!issuesTab) {
      if (isEmbeddedDashboardOpen) {
        hideEmbeddedDashboard()
      }
      return
    }

    let dashboardTab = document.getElementById(dashboardTabId)

    if (!(dashboardTab instanceof HTMLElement)) {
      dashboardTab = createDashboardTab(issuesTab)
    }

    if (issuesTab.nextElementSibling !== dashboardTab) {
      issuesTab.insertAdjacentElement('afterend', dashboardTab)
    }

    dashboardTabBar = getTabBar(dashboardTab)
    updateDashboardTabState()

    if (
      isEmbeddedDashboardOpen &&
      !getEmbeddedDashboardHost() &&
      isExtensionContextValid()
    ) {
      showEmbeddedDashboard()
      return
    }

    scheduleEmbeddedDashboardBoundsUpdate()
  }

  const scheduleDashboardIntegration = () => {
    if (dashboardIntegrationFrameId !== null) {
      return
    }

    dashboardIntegrationFrameId = window.requestAnimationFrame(
      ensureDashboardIntegration,
    )
  }

  const startDashboardIntegration = () => {
    scheduleDashboardIntegration()
    dashboardIntegrationObserver = new MutationObserver(
      scheduleDashboardIntegration,
    )
    dashboardIntegrationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })
  }

  const closeDashboardForScrimbaNavigation = (event: MouseEvent) => {
    if (!isEmbeddedDashboardOpen || !(event.target instanceof Element)) {
      return
    }

    const navigationControl = event.target.closest<HTMLElement>(
      'a[href], button, [role="tab"]',
    )

    if (
      !navigationControl ||
      navigationControl.id === dashboardTabId ||
      navigationControl.closest(`#${widgetHostId}, #${embeddedDashboardHostId}`)
    ) {
      return
    }

    if (
      navigationControl instanceof HTMLAnchorElement ||
      dashboardTabBar?.contains(navigationControl)
    ) {
      hideEmbeddedDashboard()
    }
  }

  const dispose = () => {
    dashboardIntegrationObserver?.disconnect()

    if (dashboardIntegrationFrameId !== null) {
      window.cancelAnimationFrame(dashboardIntegrationFrameId)
    }

    if (dashboardBoundsFrameId !== null) {
      window.cancelAnimationFrame(dashboardBoundsFrameId)
    }

    getEmbeddedDashboardHost()?.remove()
    restoreScrimbaContent()
    document.getElementById(dashboardTabId)?.remove()
  }
  return { start: startDashboardIntegration, resize: scheduleEmbeddedDashboardBoundsUpdate, navigate: closeDashboardForScrimbaNavigation, dispose }
}
