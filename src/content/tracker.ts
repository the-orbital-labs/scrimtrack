import { createTrackingDelivery } from '../trackingDelivery'
import type { TrackingReply, TrackingUpdate } from '../trackingProtocol'
import { getStorageValue } from './storage'

const createSessionId = (): string =>
  `scrimba-${Date.now()}-${Math.random().toString(36).slice(2)}`

const codeActivityMessageIntervalMs = 2_000
const sessionResumeGraceMs = 60_000

const getPageTitle = (): string | null => {
  const title = document.title.trim()

  return title || null
}

type TrackerOptions = {
  isPageActive: () => boolean
  isMediaPlaying: () => boolean
  onTimerChange: (running: boolean) => void
  onRefresh: () => void
  onError: () => void
  onDelayed: () => void
  onRecovered: () => void
}

export function createPageTracker({
  isPageActive, isMediaPlaying, onTimerChange, onRefresh, onError, onDelayed, onRecovered,
}: TrackerOptions) {
  let currentSessionId: string | null = null
  let currentSessionStartedAt: string | null = null
  let pausedSession:
    | {
        id: string
        startedAt: string
        stoppedAt: number
      }
    | null = null
  let lastActivityAt = Date.now()
  let lastActivityMessageAt = 0
  let lastAccountedAt = 0
  let lastQueuedAt = 0
  let trackingEpoch: string | null = null
  let startingSession = false
  let resetVersion = 0
  const sequences = new Map<string, number>()
  let hasTrackingDeliveryError = false
  let trackingTickIntervalId: number | null = null
  let isTrackingActive = false
  let isTrackingIdle = false
  const stopTrackingTick = () => {
    if (trackingTickIntervalId === null) {
      return
    }

    window.clearInterval(trackingTickIntervalId)
    trackingTickIntervalId = null
  }

  const markSessionStopped = (sessionId: string) => {
    if (currentSessionId !== sessionId) {
      return
    }

    isTrackingActive = false
    isTrackingIdle = true
    onTimerChange(false)
    currentSessionId = null
    currentSessionStartedAt = null
    pausedSession = null
    lastAccountedAt = 0
    lastQueuedAt = 0
    stopTrackingTick()
  }

  const delivery = createTrackingDelivery((update, reply) => {
    if (reply.ok && hasTrackingDeliveryError) {
      hasTrackingDeliveryError = false
      onRecovered()
    }
    if (reply.error === 'tracking-reset') {
      trackingEpoch = reply.epoch ?? null
      delivery.cancel()
      if (currentSessionId) markSessionStopped(currentSessionId)
      pausedSession = null
      return
    }
    if (currentSessionId !== update.sessionId) return
    if (reply.ok && (update.kind === 'pulse' || update.kind === 'stop')) {
      // Capturing an interval never advances this acknowledged cursor.
      lastAccountedAt = Math.max(lastAccountedAt, Date.parse(update.at))
    }
    if (reply.trackingEnabled === false ||
      (reply.isActive === false && lastActivityAt <= Date.parse(update.at))) {
      markSessionStopped(update.sessionId)
      onRefresh()
    }
  }, () => {
    hasTrackingDeliveryError = true
    onDelayed()
  })

  const queueTrackingUpdate = (
    kind: TrackingUpdate['kind'], sessionId: string, at: number, from = at,
  ): Promise<TrackingReply> => {
    const sequence = (sequences.get(sessionId) ?? 0) + 1
    sequences.set(sessionId, sequence)
    return delivery.send({
      type: 'scrimba:tracking-update', epoch: trackingEpoch!, sessionId, sequence,
      kind, at: new Date(at).toISOString(), from: new Date(from).toISOString(),
      url: window.location.href, title: getPageTitle(), isMediaPlaying: isMediaPlaying(),
    })
  }

  const sendTrackingTick = () => {
    if (!currentSessionId || !isTrackingActive || isTrackingIdle) {
      stopTrackingTick()
      return
    }
    const from = Math.max(lastQueuedAt, lastAccountedAt)
    // Keep subsecond time for the next interval rather than discarding it at
    // each pulse. Retries keep these exact bounds, not a fresh elapsed delta.
    const at = from + Math.floor((Date.now() - from) / 1000) * 1000
    if (at <= from) return
    lastQueuedAt = at
    void queueTrackingUpdate('pulse', currentSessionId, at, from)
  }

  const startTrackingTick = () => {
    if (!isTrackingActive || isTrackingIdle || trackingTickIntervalId !== null) return
    trackingTickIntervalId = window.setInterval(sendTrackingTick, 5_000)
  }

  const startActiveSession = () => {
    if (currentSessionId || startingSession || !isPageActive()) return
    const now = Date.now()
    const version = resetVersion
    startingSession = true
    // Read the reset generation before capturing this session. A reset racing
    // this read is caught again by the worker and by storage.onChanged.
    void getStorageValue('trackingState', { epoch: 'initial' }).then((state) => {
      if (!isPageActive() || currentSessionId || version !== resetVersion) return
      trackingEpoch = state.epoch
      const reusable = pausedSession && now - pausedSession.stoppedAt <= sessionResumeGraceMs
        ? pausedSession : null
      const sessionId = reusable?.id ?? createSessionId()
      currentSessionId = sessionId
      currentSessionStartedAt = reusable?.startedAt ?? new Date(now).toISOString()
      pausedSession = null
      lastActivityAt = now
      lastAccountedAt = now
      lastQueuedAt = now
      isTrackingActive = true
      isTrackingIdle = false
      void queueTrackingUpdate('start', sessionId, now).then((reply) => {
        if (currentSessionId !== sessionId) return
        if (!reply.ok) { markSessionStopped(sessionId); return }
        onTimerChange(true)
        onRefresh()
      })
      // Capture intervals while delivery is interrupted; the durable outbox,
      // rather than a successful reply, controls when the next interval starts.
      startTrackingTick()
    }).catch(onError).finally(() => { startingSession = false })
  }

  const stopActiveSession = (rememberForGrace = true): Promise<void> => {
    if (!currentSessionId) return Promise.resolve()
    const at = Date.now()
    const sessionId = currentSessionId
    const startedAt = currentSessionStartedAt
    const from = Math.max(lastQueuedAt, lastAccountedAt)
    // Queue the final interval before clearing local state. The worker can
    // finish it even if a new tab takes ownership or this document closes.
    const stopped = queueTrackingUpdate('stop', sessionId, at, from)
    currentSessionId = null
    currentSessionStartedAt = null
    isTrackingActive = false
    isTrackingIdle = false
    onTimerChange(false)
    lastAccountedAt = 0
    lastQueuedAt = 0
    stopTrackingTick()
    pausedSession = rememberForGrace && startedAt ? { id: sessionId, startedAt, stoppedAt: at } : null
    return stopped.then(() => {})
  }

  const sendUserActivity = () => {
    const now = Date.now()
    if (!currentSessionId) {
      lastActivityMessageAt = now
      startActiveSession()
      return
    }
    lastActivityAt = now
    isTrackingIdle = false
    if (now - lastActivityMessageAt < codeActivityMessageIntervalMs) return
    lastActivityMessageAt = now
    void queueTrackingUpdate('activity', currentSessionId, now)
  }

  const reset = (epoch?: string, previousEpoch?: string): boolean => {
    if (epoch && epoch !== (trackingEpoch ?? previousEpoch ?? 'initial')) {
      resetVersion++
      trackingEpoch = epoch
      delivery.cancel()
      if (currentSessionId) markSessionStopped(currentSessionId)
      pausedSession = null
      return true
    }
    return false
  }
  return {
    get isActive() { return isTrackingActive },
    get isIdle() { return isTrackingIdle },
    activity: sendUserActivity, stop: stopActiveSession, reset,
    dispose: () => delivery.dispose(),
  }
}
