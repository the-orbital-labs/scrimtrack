import { createWidget } from './widget'
import {
  defaultUserSettings, getExtensionUrl, getLocalDateKey, getStorageValue,
  getUserSettings, getCurrentScrimbaPage, getTodayActivity, requestWidgetMutation,
  saveTrackingEnabled, saveFloatingWidgetVisible, formatActiveTime, getGoalProgress,
} from './storage'
import type { UserSettings, WidgetPosition } from './storage'
import type { createPageTracker } from './tracker'
import type { createPlaybackMonitor } from './playbackMonitor'

type StorageChanges = Record<string, { newValue?: unknown; oldValue?: unknown }>

const widgetPositionStorageKey = 'widgetPosition'
const widgetViewportMargin = 16

export function createWidgetController(
  listenerController: AbortController,
  tracker: Pick<ReturnType<typeof createPageTracker>, 'isActive' | 'isIdle' | 'stop'>,
  playback: Pick<ReturnType<typeof createPlaybackMonitor>, 'resetHeartbeat' | 'check'>,
) {
  let widgetRefreshIntervalId: number | null = null
  let widgetDisplayIntervalId: number | null = null
  let isWidgetRefreshing = false
  let isWidgetTimerRunning = false
  const stopWidgetRefresh = () => {
    if (widgetRefreshIntervalId === null) {
      return
    }

    window.clearInterval(widgetRefreshIntervalId)
    widgetRefreshIntervalId = null
  }

  const stopWidgetDisplay = () => {
    if (widgetDisplayIntervalId === null) {
      return
    }

    window.clearInterval(widgetDisplayIntervalId)
    widgetDisplayIntervalId = null
  }

  const openDashboard = () => {
    const dashboardUrl = getExtensionUrl('dashboard.html')

    if (!dashboardUrl) {
      window.alert('ScrimTrack was updated. Refresh this Scrimba tab to reconnect it.')
      return
    }

    try {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage()
        return
      }

      window.open(dashboardUrl, '_blank', 'noopener')
    } catch {
      window.alert('ScrimTrack could not open. Refresh this Scrimba tab and try again.')
    }
  }

  const widget = createWidget()
  let hasStorageError = false
  const reportStorageError = () => {
    hasStorageError = true
    isWidgetTimerRunning = false
    if (widget) {
      widget.host.hidden = false
      widget.statusText!.textContent = 'Local data error. Reload and try again.'
      widget.statusText!.setAttribute('role', 'alert')
      widget.collapsedStatus!.textContent = 'Local data error'
    }
  }
  let widgetDisplayedActiveSeconds = 0
  let widgetTimezone = defaultUserSettings.timezone
  let widgetDisplayDate = getLocalDateKey(new Date(), widgetTimezone)
  let widgetGoalSeconds = defaultUserSettings.dailyGoalSeconds
  let widgetGoalCompleted = false
  let expandedWidgetPosition: WidgetPosition | null = null

  const setWidgetVisible = (visible: boolean) => {
    if (!widget) {
      return
    }

    widget.host.hidden = !visible

    if (visible) {
      refreshWidget()
      window.requestAnimationFrame(constrainWidgetToViewport)
    }
  }

  const getConstrainedWidgetPosition = (x: number, y: number): WidgetPosition => {
    if (!widget) {
      return { x, y }
    }

    const bounds = widget.host.getBoundingClientRect()
    const maxX = Math.max(
      widgetViewportMargin,
      window.innerWidth - bounds.width - widgetViewportMargin,
    )
    const maxY = Math.max(
      widgetViewportMargin,
      window.innerHeight - bounds.height - widgetViewportMargin,
    )

    return {
      x: Math.min(Math.max(widgetViewportMargin, x), maxX),
      y: Math.min(Math.max(widgetViewportMargin, y), maxY),
    }
  }

  const applyWidgetPosition = (position: WidgetPosition) => {
    if (!widget) {
      return
    }

    const constrainedPosition = getConstrainedWidgetPosition(
      position.x,
      position.y,
    )

    widget.host.style.setProperty('left', `${constrainedPosition.x}px`)
    widget.host.style.setProperty('top', `${constrainedPosition.y}px`)
    widget.host.style.setProperty('right', 'auto')
    widget.host.style.setProperty('bottom', 'auto')
    expandedWidgetPosition = constrainedPosition
  }

  const applyMinimizedWidgetPosition = () => {
    if (!widget) {
      return
    }

    widget.host.style.removeProperty('left')
    widget.host.style.removeProperty('top')
    widget.host.style.removeProperty('right')
    widget.host.style.removeProperty('bottom')
  }

  const constrainWidgetToViewport = () => {
    if (!widget) {
      return
    }

    if (widget.widget?.classList.contains('is-collapsed')) {
      applyMinimizedWidgetPosition()
      return
    }

    if (!widget.host.style.left || !widget.host.style.top) {
      return
    }

    const bounds = widget.host.getBoundingClientRect()
    applyWidgetPosition({ x: bounds.left, y: bounds.top })
  }

  const persistWidgetPosition = () => {
    if (!widget) {
      return
    }

    const bounds = widget.host.getBoundingClientRect()
    const position = {
      x: bounds.left,
      y: bounds.top,
    }

    expandedWidgetPosition = position
    void requestWidgetMutation<boolean>('saveWidgetPosition', position).catch(reportStorageError)
  }

  if (widget) {
    void getUserSettings().then((settings) => {
      setWidgetVisible(settings.floatingWidgetVisible)
    }).catch(reportStorageError)

    void getStorageValue<WidgetPosition | null>(
      widgetPositionStorageKey,
      null,
    ).then((position) => {
      if (
        position &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y)
      ) {
        expandedWidgetPosition = position

        if (!widget.widget?.classList.contains('is-collapsed')) {
          applyWidgetPosition(position)
        }
      }
    }).catch(reportStorageError)

    let draggedPointerId: number | null = null
    let pointerOffsetX = 0
    let pointerOffsetY = 0

    const finishWidgetDrag = (event: PointerEvent) => {
      if (draggedPointerId !== event.pointerId) {
        return
      }

      draggedPointerId = null
      widget.widget?.classList.remove('is-dragging')
      persistWidgetPosition()
    }

    widget.dragHandles.forEach((dragHandle) => {
      dragHandle.addEventListener('pointerdown', (event) => {
        if (
          event.button !== 0 ||
          widget.widget?.classList.contains('is-collapsed') ||
          (event.target instanceof Element && event.target.closest('button'))
        ) {
          return
        }

        const bounds = widget.host.getBoundingClientRect()
        draggedPointerId = event.pointerId
        pointerOffsetX = event.clientX - bounds.left
        pointerOffsetY = event.clientY - bounds.top
        widget.widget?.classList.add('is-dragging')
        dragHandle.setPointerCapture(event.pointerId)
        event.preventDefault()
      }, { signal: listenerController.signal })

      dragHandle.addEventListener('pointermove', (event) => {
        if (draggedPointerId !== event.pointerId) {
          return
        }

        applyWidgetPosition({
          x: event.clientX - pointerOffsetX,
          y: event.clientY - pointerOffsetY,
        })
      }, { signal: listenerController.signal })

      dragHandle.addEventListener('pointerup', finishWidgetDrag, {
        signal: listenerController.signal,
      })
      dragHandle.addEventListener('pointercancel', finishWidgetDrag, {
        signal: listenerController.signal,
      })
    })

    window.addEventListener('resize', constrainWidgetToViewport, {
      signal: listenerController.signal,
    })
  }

  const setWidgetCollapsed = (collapsed: boolean) => {
    if (!widget) {
      return
    }

    const wasCollapsed = widget.widget?.classList.contains('is-collapsed') ?? false

    if (collapsed) {
      if (!wasCollapsed) {
        persistWidgetPosition()
      }

      widget.widget?.classList.add('is-collapsed')
      applyMinimizedWidgetPosition()
      return
    }

    widget.widget?.classList.remove('is-collapsed')

    if (expandedWidgetPosition) {
      applyWidgetPosition(expandedWidgetPosition)
    } else {
      window.requestAnimationFrame(constrainWidgetToViewport)
    }
  }

  const renderWidgetTime = () => {
    if (!widget) {
      return
    }

    const isComplete =
      widgetGoalCompleted ||
      (widgetGoalSeconds > 0 &&
        widgetDisplayedActiveSeconds >= widgetGoalSeconds)
    const remainingSeconds = Math.max(
      0,
      widgetGoalSeconds - widgetDisplayedActiveSeconds,
    )
    const percentage =
      widgetGoalSeconds > 0
        ? Math.floor(
            (widgetDisplayedActiveSeconds / widgetGoalSeconds) * 100,
          )
        : 0
    const goalText =
      widgetGoalSeconds > 0 ? formatActiveTime(widgetGoalSeconds) : 'Not set'
    const remainingText =
      widgetGoalSeconds > 0
        ? isComplete
          ? 'Goal complete'
          : `${formatActiveTime(remainingSeconds)} remaining`
        : 'Set a goal'

    widget.today!.textContent = formatActiveTime(widgetDisplayedActiveSeconds)
    widget.goal!.textContent = goalText
    widget.progressLabel!.textContent = remainingText
    widget.progressPercent!.textContent = `${percentage}%`
    widget.progressBar!.style.width = `${Math.min(100, percentage)}%`
  }

  const tickWidgetDisplay = () => {
    const today = getLocalDateKey(new Date(), widgetTimezone)

    if (widgetDisplayDate !== today) {
      widgetDisplayDate = today
      widgetDisplayedActiveSeconds = 0
    }

    if (!widget || widget.host.hidden || !isWidgetTimerRunning) {
      return
    }

    widgetDisplayedActiveSeconds += 1
    renderWidgetTime()
  }

  const refreshWidget = () => {
    if (!widget || widget.host.hidden || isWidgetRefreshing) {
      return
    }

    isWidgetRefreshing = true

    void getUserSettings().then((settings) => Promise.all([
      Promise.resolve(settings),
      getTodayActivity(settings),
      getCurrentScrimbaPage(),
    ])).then(([settings, todayActivity, currentScrimbaPage]) => {
      const timezoneChanged = widgetTimezone !== settings.timezone
      widgetTimezone = settings.timezone
      const progress = getGoalProgress(todayActivity, settings)
      const trackingPaused = !settings.trackingEnabled
      const isCurrentPageSession =
        currentScrimbaPage?.url === window.location.href &&
        currentScrimbaPage.isActive
      const isCurrentPageIdle =
        currentScrimbaPage?.url === window.location.href &&
        currentScrimbaPage.isIdle
      const statusText = trackingPaused
        ? 'Paused'
        : tracker.isIdle || isCurrentPageIdle
          ? 'Idle'
          : isCurrentPageSession || tracker.isActive
            ? 'Tracking'
            : 'Ready'
      const today = getLocalDateKey(new Date(), widgetTimezone)

      isWidgetTimerRunning =
        !hasStorageError && !trackingPaused &&
        statusText === 'Tracking'
      widgetGoalSeconds = progress.goalSeconds
      widgetGoalCompleted = progress.isComplete

      if (timezoneChanged || widgetDisplayDate !== today) {
        widgetDisplayDate = today
        widgetDisplayedActiveSeconds = progress.activeSeconds
      } else if (isWidgetTimerRunning) {
        widgetDisplayedActiveSeconds = Math.max(
          widgetDisplayedActiveSeconds,
          progress.activeSeconds,
        )
      } else {
        // Once stopped or idle, replace the live preview with committed time.
        widgetDisplayedActiveSeconds = progress.activeSeconds
      }

      if (!hasStorageError) {
        widget.statusText!.textContent = statusText
        widget.collapsedStatus!.textContent = statusText
      }
      widget.toggleTracking!.textContent = trackingPaused ? 'Resume' : 'Pause'
      renderWidgetTime()

      widget.statusDots.forEach((dot) => {
        dot.classList.toggle('is-paused', trackingPaused)
        dot.classList.toggle('is-idle', !trackingPaused && statusText === 'Idle')
      })
    }).finally(() => {
      isWidgetRefreshing = false
    }).catch(reportStorageError)
  }

  widget?.openDashboard?.addEventListener('click', openDashboard, {
    signal: listenerController.signal,
  })
  widget?.collapse?.addEventListener('click', () => setWidgetCollapsed(true), {
    signal: listenerController.signal,
  })
  widget?.expand?.addEventListener('click', () => setWidgetCollapsed(false), {
    signal: listenerController.signal,
  })
  widget?.closeButtons.forEach((closeButton) => {
    closeButton.addEventListener('click', () => {
      void saveFloatingWidgetVisible(false).then(() => setWidgetVisible(false)).catch(reportStorageError)
    }, { signal: listenerController.signal })
  })
  widget?.toggleTracking?.addEventListener('click', () => {
    void getUserSettings().then((settings) => {
      const nextTrackingEnabled = !settings.trackingEnabled

      if (!nextTrackingEnabled) {
        void tracker.stop(false)
          .then(() => saveTrackingEnabled(false))
          .then(refreshWidget).catch(reportStorageError)
        return
      }

      void saveTrackingEnabled(true).then(() => {
        playback.resetHeartbeat()
        playback.check()
        refreshWidget()
      }).catch(reportStorageError)
    }).catch(reportStorageError)
  }, { signal: listenerController.signal })

  const settingsChanged = (changes: StorageChanges) => {
    const nextSettings = changes.userSettings?.newValue

    if (!nextSettings || typeof nextSettings !== 'object') {
      return
    }

    const { floatingWidgetVisible } = nextSettings as Partial<UserSettings>
    if ((nextSettings as Partial<UserSettings>).trackingEnabled === false) {
      void tracker.stop(false).catch(reportStorageError)
    }

    if (typeof floatingWidgetVisible === 'boolean') {
      setWidgetVisible(floatingWidgetVisible)
    }
  }

  widgetRefreshIntervalId = window.setInterval(refreshWidget, 5_000)
  widgetDisplayIntervalId = window.setInterval(tickWidgetDisplay, 1_000)
  return {
    refresh: refreshWidget,
    reportError: reportStorageError,
    settingsChanged,
    set timerRunning(running: boolean) { isWidgetTimerRunning = running },
    resetPreview: () => { widgetDisplayedActiveSeconds = 0; refreshWidget() },
    reportDelayed: () => {
      reportStorageError()
      if (widget) {
        widget.statusText!.textContent = 'Saving delayed. Retrying local data...'
        widget.collapsedStatus!.textContent = 'Saving delayed'
      }
    },
    recover: () => {
      hasStorageError = false
      widget?.statusText?.removeAttribute('role')
      refreshWidget()
    },
    dispose: () => {
      stopWidgetRefresh()
      stopWidgetDisplay()
      widget?.host.remove()
    },
  }
}
