import { createPageTracker } from './content/tracker'
import { createPlaybackMonitor } from './content/playbackMonitor'
import { createWidgetController } from './content/widgetController'
import { createEmbeddedDashboard } from './content/embeddedDashboard'
import { isExtensionContextValid, isScrimbaUrl } from './content/storage'
import { detectScrimbaCourseProgress } from './scrimbaCourseDetection'

type RuntimeResponse = {
  error?: string
  isIdle?: boolean
  ok?: boolean
  trackingEnabled?: boolean
}

type StorageChanges = Record<
  string,
  { newValue?: unknown; oldValue?: unknown }
>

const isRuntimeResponse = (response: unknown): response is RuntimeResponse =>
  typeof response === 'object' && response !== null

const courseProgressCheckIntervalMs = 15_000
const codeEditorSelector = [
  '.cm-editor',
  '.cm-content',
  '.CodeMirror',
  '.CodeMirror-code',
  '.monaco-editor',
  '.ace_editor',
  '.ace_text-input',
  '[data-testid*="code-editor" i]',
  '[data-test*="code-editor" i]',
  '[data-cy*="code-editor" i]',
  '[data-component*="code-editor" i]',
  '[id*="code-editor" i]',
  '[id*="codeeditor" i]',
  '[class*="code-editor" i]',
  '[class*="codeeditor" i]',
  '[aria-label*="code editor" i]',
  '[aria-label*="code input" i]',
  '[role="textbox"][aria-multiline="true"][spellcheck="false"]',
  'textarea[spellcheck="false"][autocapitalize="off"]',
].join(', ')

if (
  isScrimbaUrl(window.location.href) &&
  document.documentElement.dataset.scrimbaLearningTracker !== 'active'
) {
  const listenerController = new AbortController()
  let courseProgressCheckIntervalId: number | null = null
  let lastCourseProgressSignature: string | null = null
  document.documentElement.dataset.scrimbaLearningTracker = 'active'

  const sendRuntimeMessage = (
    message: unknown,
    callback?: (response: unknown) => void,
  ): boolean => {
    try {
      if (!isExtensionContextValid()) {
        reportStorageError()
        return false
      }

      chrome.runtime.sendMessage(message, (response) => {
        try {
          if (chrome.runtime.lastError) {
            reportStorageError()
            callback?.(undefined)
            return
          }
        } catch {
          reportStorageError()
          callback?.(undefined)
          return
        }

        if (isRuntimeResponse(response) && response.error === 'storage-failure') {
          reportStorageError()
        }
        callback?.(response)
      })
      return true
    } catch {
      reportStorageError()
      return false
    }
  }

  const detectAndSyncCourseProgress = () => {
    const course = detectScrimbaCourseProgress(document, window.location.href)

    if (!course) {
      return
    }

    const signature = JSON.stringify({
      completedItems: course.completedItems,
      id: course.id,
      name: course.name,
      progressPercentage: course.progressPercentage,
      totalEstimatedHours: course.totalEstimatedHours,
      totalItems: course.totalItems,
      url: course.url,
    })

    if (signature === lastCourseProgressSignature) {
      return
    }

    lastCourseProgressSignature = signature
    sendRuntimeMessage({
      type: 'scrimba:course-progress-detected',
      course,
    })
  }

  const isPageActive = () =>
    document.visibilityState === 'visible' && document.hasFocus()

  const isCodeEditorActivity = (event: Event): boolean =>
    event.composedPath().some(
      (eventTarget) =>
        eventTarget instanceof Element && eventTarget.matches(codeEditorSelector),
    )

  const tracker = createPageTracker({
    isPageActive,
    isMediaPlaying: () => playback.isPlaying,
    onTimerChange: (running) => { widget.timerRunning = running },
    onRefresh: () => widget.refresh(),
    onError: () => reportStorageError(),
    onDelayed: () => widget.reportDelayed(),
    onRecovered: () => widget.recover(),
  })
  const playback = createPlaybackMonitor(isPageActive, () => tracker.activity())

  const dashboard = createEmbeddedDashboard(listenerController)
  const widget = createWidgetController(listenerController, tracker, playback)
  const reportStorageError = () => widget.reportError()
  const handleWidgetSettingsChange = (changes: StorageChanges, areaName: string) => {
    if (areaName !== 'local') return
    const state = changes.trackingState?.newValue as { epoch?: string } | undefined
    const previousState = changes.trackingState?.oldValue as { epoch?: string } | undefined
    if (tracker.reset(state?.epoch, previousState?.epoch)) widget.resetPreview()
    widget.settingsChanged(changes)
  }

  console.info('ScrimTrack content script ready')

  const cleanup = () => {
    void tracker.stop(false).catch(reportStorageError)
    tracker.dispose()
    playback.stop()
    widget.dispose()
    if (courseProgressCheckIntervalId !== null) {
      window.clearInterval(courseProgressCheckIntervalId)
      courseProgressCheckIntervalId = null
    }
    listenerController.abort()
    try {
      chrome.storage.onChanged.removeListener(handleWidgetSettingsChange)
    } catch {
      // The extension context may already be invalidated during cleanup.
    }
    dashboard.dispose()
  }

  const syncTrackingState = () => {
    if (isPageActive()) {
      playback.check()
      return
    }

    void tracker.stop().catch(reportStorageError)
  }

  const handleCodeEditorActivity = (event: Event) => {
    if (isCodeEditorActivity(event)) {
      tracker.activity()
    }
  }

  const listenerOptions = { signal: listenerController.signal }
  const passiveListenerOptions = {
    passive: true,
    signal: listenerController.signal,
  }

  playback.start()
  detectAndSyncCourseProgress()
  widget.refresh()
  dashboard.start()
  chrome.storage.onChanged.addListener(handleWidgetSettingsChange)
  courseProgressCheckIntervalId = window.setInterval(
    detectAndSyncCourseProgress,
    courseProgressCheckIntervalMs,
  )

  window.addEventListener('pagehide', cleanup, listenerOptions)
  window.addEventListener('focus', syncTrackingState, listenerOptions)
  window.addEventListener('resize', dashboard.resize, listenerOptions)
  window.addEventListener('blur', () => {
    window.setTimeout(syncTrackingState, 0)
  }, listenerOptions)
  document.addEventListener(
    'click',
    dashboard.navigate,
    { capture: true, signal: listenerController.signal },
  )
  document.addEventListener('visibilitychange', syncTrackingState, listenerOptions)
  window.addEventListener('message', playback.handleMessage, listenerOptions)
  document.addEventListener('pointerdown', handleCodeEditorActivity, listenerOptions)
  document.addEventListener('keydown', handleCodeEditorActivity, listenerOptions)
  document.addEventListener('beforeinput', handleCodeEditorActivity, listenerOptions)
  document.addEventListener('paste', handleCodeEditorActivity, listenerOptions)
  document.addEventListener('wheel', handleCodeEditorActivity, passiveListenerOptions)
}
